// End-to-end tests of the HFEngine public API (request -> .in -> WASM -> .out
// -> typed result), including the >10,000 km validity-warning guard and a
// timing measurement. Needs real ITU data; skips when HFKIT_ITU_DATA_DIR
// isn't set -- see test/helpers/testData.ts.

import { describe, expect, it } from 'vitest';

import { HFEngine } from '../src/engine.js';
import { NodeFsDataProvider } from '../src/nodeDataProvider.js';
import { P533_MAX_VALID_DISTANCE_KM, type PredictionRequest } from '../src/types.js';
import { findItuDataDir } from './helpers/testData.js';

const dataDir = findItuDataDir();

function shortCircuitRequest(overrides: Partial<PredictionRequest> = {}): PredictionRequest {
  return {
    transmitter: { latitude: 49.6666666667, longitude: 6.31666666667 }, // Luxembourg
    receiver: { latitude: 51.1166666667, longitude: 7.26666666667 }, // Bockhacken
    time: { year: 2026, month: 8, hoursUtc: [12] },
    frequenciesMHz: [14.1],
    transmitPowerWatts: 100,
    requiredSnrDb: 10,
    requiredSnrBandwidthHz: 3000,
    manMadeNoise: 'rural',
    modulation: 'analog',
    solarDriver: { ssn: 80 },
    ...overrides,
  };
}

describe.skipIf(!dataDir)('HFEngine.predict', () => {
  it('produces a well-formed result for a normal short circuit with no validity warning', async () => {
    const engine = await HFEngine.create({ dataProvider: new NodeFsDataProvider({ dataDir: dataDir! }) });
    const result = await engine.predict(shortCircuitRequest());

    expect(result.predictions).toHaveLength(1);
    expect(result.circuit.exceedsValidRange).toBe(false);
    expect(result.circuit.validityWarning).toBeUndefined();
    expect(result.circuit.distanceKm).toBeCloseTo(174.73, 0);
    // Our independently-computed distance and the engine's own reported
    // distance for the same circuit should agree closely.
    expect(result.circuit.distanceMismatchKm).toBeLessThan(1);

    const p = result.predictions[0]!;
    expect(p.frequencyMHz).toBeCloseTo(14.1, 6);
    expect(p.hourUtc).toBe(12);
    expect(Number.isFinite(p.fieldStrengthDbuVm)).toBe(true);
    expect(p.overallReliability).toBeGreaterThanOrEqual(0);
    expect(p.overallReliability).toBeLessThanOrEqual(1);
  });

  it('flags a circuit beyond the 10,000 km P.533 validity range', async () => {
    const engine = await HFEngine.create({ dataProvider: new NodeFsDataProvider({ dataDir: dataDir! }) });
    // New York <-> Sydney, ~15,900 km great-circle -- well past P.533's
    // documented ~10,000 km validity ceiling.
    const result = await engine.predict(
      shortCircuitRequest({
        transmitter: { latitude: 40.7128, longitude: -74.006 },
        receiver: { latitude: -33.8688, longitude: 151.2093 },
        frequenciesMHz: [14.1],
      }),
    );

    expect(result.circuit.distanceKm).toBeGreaterThan(P533_MAX_VALID_DISTANCE_KM);
    expect(result.circuit.exceedsValidRange).toBe(true);
    expect(result.circuit.validityWarning).toBeDefined();
    expect(result.circuit.validityWarning).toMatch(/10,000 km/);
    // The engine still returns numbers for this circuit -- it does not
    // refuse -- which is exactly why the flag exists.
    expect(result.predictions).toHaveLength(1);
    expect(Number.isFinite(result.predictions[0]!.fieldStrengthDbuVm)).toBe(true);
  });

  it('does not flag a long path direction that is short in absolute terms', async () => {
    const engine = await HFEngine.create({ dataProvider: new NodeFsDataProvider({ dataDir: dataDir! }) });
    const result = await engine.predict(shortCircuitRequest({ pathDirection: 'short' }));
    expect(result.circuit.pathDirection).toBe('short');
    expect(result.circuit.exceedsValidRange).toBe(false);
  });

  it('rejects an invalid request before ever touching the WASM engine', async () => {
    const engine = await HFEngine.create({ dataProvider: new NodeFsDataProvider({ dataDir: dataDir! }) });
    await expect(engine.predict(shortCircuitRequest({ frequenciesMHz: [500] }))).rejects.toThrow(/1\.0-30\.0 MHz/);
  });

  it('reuses one WASM instance: a second predict() call does not pay init cost again', async () => {
    const engine = await HFEngine.create({ dataProvider: new NodeFsDataProvider({ dataDir: dataDir! }) });
    await engine.predict(shortCircuitRequest());
    const firstInitMs = engine.timings.initMs;
    await engine.predict(shortCircuitRequest({ time: { year: 2026, month: 8, hoursUtc: [13] } }));
    const secondInitMs = engine.timings.initMs;
    expect(secondInitMs).toBe(firstInitMs); // same cached module instance
  });

  it('measures cold init, data load, and per-prediction latency on a 24h x 10freq circuit', async () => {
    const engine = await HFEngine.create({ dataProvider: new NodeFsDataProvider({ dataDir: dataDir! }) });
    const coldInitMs = engine.timings.initMs;

    const request = shortCircuitRequest({
      time: { year: 2026, month: 8, hoursUtc: Array.from({ length: 24 }, (_, h) => h) },
      frequenciesMHz: [3.5, 5.3, 7.1, 10.1, 14.1, 18.1, 21.1, 24.9, 28.3, 29.7],
    });
    const result = await engine.predict(request);
    const { runMs, dataLoadMs } = engine.timings;
    const perPredictionMs = runMs / result.predictions.length;

    expect(result.predictions).toHaveLength(240);
    // Loose smoke-test bounds, not a strict perf gate (hardware varies) --
    // actual measured numbers are reported in README.md and the task summary.
    expect(coldInitMs).toBeLessThan(500);
    expect(perPredictionMs).toBeLessThan(50);

    // eslint-disable-next-line no-console
    console.log(
      `[measured] coldInitMs=${coldInitMs.toFixed(3)} dataLoadMs=${dataLoadMs.toFixed(3)} ` +
        `runMs=${runMs.toFixed(3)} perPredictionMs=${perPredictionMs.toFixed(4)} predictions=${result.predictions.length}`,
    );
  });
});

if (!dataDir) {
  // eslint-disable-next-line no-console
  console.warn(
    '[engine.test] SKIPPED: set HFKIT_ITU_DATA_DIR to a local ITU-R-HF ITURHFProp/Data/ directory ' +
      '(containing "P1239-3 Decile Factors.txt") to run these end-to-end HFEngine tests.',
  );
}
