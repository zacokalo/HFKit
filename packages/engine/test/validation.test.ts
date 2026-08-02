import { describe, expect, it } from 'vitest';

import { HFEngineValidationError, validatePredictionRequest } from '../src/validation.js';
import type { PredictionRequest } from '../src/types.js';

function baseRequest(overrides: Partial<PredictionRequest> = {}): PredictionRequest {
  return {
    transmitter: { latitude: 49.6666666667, longitude: 6.31666666667 },
    receiver: { latitude: 51.1166666667, longitude: 7.26666666667 },
    time: { year: 2026, month: 8, hoursUtc: [0, 12] },
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

describe('validatePredictionRequest', () => {
  it('accepts a well-formed request', () => {
    expect(() => validatePredictionRequest(baseRequest())).not.toThrow();
  });

  it.each([
    ['latitude too high', { transmitter: { latitude: 91, longitude: 0 } }],
    ['latitude too low', { transmitter: { latitude: -91, longitude: 0 } }],
    ['longitude too high', { receiver: { latitude: 0, longitude: 181 } }],
    ['longitude too low', { receiver: { latitude: 0, longitude: -181 } }],
  ] as const)('rejects %s', (_name, overrides) => {
    expect(() => validatePredictionRequest(baseRequest(overrides as Partial<PredictionRequest>))).toThrow(
      HFEngineValidationError,
    );
  });

  it('rejects a frequency below the engine valid range (1.0 MHz)', () => {
    expect(() => validatePredictionRequest(baseRequest({ frequenciesMHz: [0.5] }))).toThrow(/1\.0-30\.0 MHz/);
  });

  it('rejects a frequency above the engine valid range (30.0 MHz)', () => {
    expect(() => validatePredictionRequest(baseRequest({ frequenciesMHz: [35] }))).toThrow(/1\.0-30\.0 MHz/);
  });

  it('accepts the boundary frequencies 1.0 and 30.0 MHz', () => {
    expect(() => validatePredictionRequest(baseRequest({ frequenciesMHz: [1.0, 30.0] }))).not.toThrow();
  });

  it('rejects more than 32 frequencies', () => {
    const freqs = Array.from({ length: 33 }, (_, i) => 1 + i * 0.5);
    expect(() => validatePredictionRequest(baseRequest({ frequenciesMHz: freqs }))).toThrow(/NMBOFFREQS/);
  });

  it('rejects an empty frequency list', () => {
    expect(() => validatePredictionRequest(baseRequest({ frequenciesMHz: [] }))).toThrow();
  });

  it('rejects more than 24 hours', () => {
    const hours = Array.from({ length: 25 }, (_, i) => i % 24);
    expect(() =>
      validatePredictionRequest(baseRequest({ time: { year: 2026, month: 8, hoursUtc: hours } })),
    ).toThrow(/NMBOFHOURS/);
  });

  it('rejects a duplicate hour', () => {
    expect(() =>
      validatePredictionRequest(baseRequest({ time: { year: 2026, month: 8, hoursUtc: [5, 5] } })),
    ).toThrow(/repeated/);
  });

  it('rejects an out-of-range hour (24 -- must be 0-23, not 1-24)', () => {
    expect(() =>
      validatePredictionRequest(baseRequest({ time: { year: 2026, month: 8, hoursUtc: [24] } })),
    ).toThrow();
  });

  it('rejects month 0 and month 13', () => {
    expect(() =>
      validatePredictionRequest(baseRequest({ time: { year: 2026, month: 0, hoursUtc: [0] } })),
    ).toThrow();
    expect(() =>
      validatePredictionRequest(baseRequest({ time: { year: 2026, month: 13, hoursUtc: [0] } })),
    ).toThrow();
  });

  it('rejects zero or negative transmit power', () => {
    expect(() => validatePredictionRequest(baseRequest({ transmitPowerWatts: 0 }))).toThrow(/> 0 watts/);
    expect(() => validatePredictionRequest(baseRequest({ transmitPowerWatts: -5 }))).toThrow(/> 0 watts/);
  });

  it('rejects transmit power outside the engine dB(1kW) range', () => {
    // -30 dB(1kW) => 1 W is the floor; something far below that should fail.
    expect(() => validatePredictionRequest(baseRequest({ transmitPowerWatts: 1e-6 }))).toThrow(/dB\(1kW\)/);
  });

  it('accepts a realistic ham-radio power range', () => {
    expect(() => validatePredictionRequest(baseRequest({ transmitPowerWatts: 100 }))).not.toThrow();
    expect(() => validatePredictionRequest(baseRequest({ transmitPowerWatts: 1500 }))).not.toThrow();
  });

  it('rejects SSN outside [1, 311]', () => {
    expect(() => validatePredictionRequest(baseRequest({ solarDriver: { ssn: 0 } }))).toThrow(/\[1, 311\]/);
    expect(() => validatePredictionRequest(baseRequest({ solarDriver: { ssn: 312 } }))).toThrow(/\[1, 311\]/);
  });

  it('rejects a non-integer SSN', () => {
    expect(() => validatePredictionRequest(baseRequest({ solarDriver: { ssn: 80.5 } }))).toThrow();
  });

  it('rejects an out-of-range requiredReliabilityPercentOfMonth', () => {
    expect(() =>
      validatePredictionRequest(baseRequest({ requiredReliabilityPercentOfMonth: 0 })),
    ).toThrow(/RTN_ERRSNRXXP/);
    expect(() =>
      validatePredictionRequest(baseRequest({ requiredReliabilityPercentOfMonth: 100 })),
    ).toThrow(/RTN_ERRSNRXXP/);
  });

  it('rejects an unsupported antenna kind', () => {
    expect(() =>
      validatePredictionRequest(baseRequest({ transmitAntenna: { kind: 'yagi' } as unknown as { kind: 'isotropic' } })),
    ).toThrow(/only 'isotropic' is supported/);
  });

  it('rejects a bogus man-made noise category', () => {
    expect(() =>
      validatePredictionRequest(
        baseRequest({ manMadeNoise: 'space' as unknown as PredictionRequest['manMadeNoise'] }),
      ),
    ).toThrow();
  });

  it('rejects non-finite numeric fields', () => {
    expect(() => validatePredictionRequest(baseRequest({ transmitPowerWatts: Number.NaN }))).toThrow();
    expect(() =>
      validatePredictionRequest(baseRequest({ transmitter: { latitude: Number.POSITIVE_INFINITY, longitude: 0 } })),
    ).toThrow();
  });
});
