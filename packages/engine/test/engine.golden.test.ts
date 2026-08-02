// Golden regression test: runs the COMMITTED, UNMODIFIED bench_24h_10f.in
// fixture (Phase 0's own benchmark circuit) directly through the WASM
// runtime -- bypassing this package's own .in generator entirely -- and
// checks the parsed numbers against the committed reference .out. This is
// the test that would catch a WASM plumbing regression, an output-format
// change, or a parser bug independent of anything this package's generator
// chooses to do.
//
// Needs real ITU data (HFKIT_ITU_DATA_DIR) to run the WASM engine; skips
// (does not fail) when data isn't available -- see test/helpers/testData.ts.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NodeFsDataProvider } from '../src/nodeDataProvider.js';
import { parseOutputFile } from '../src/outputParser.js';
import { WasmRuntime } from '../src/wasmModule.js';
import { findItuDataDir } from './helpers/testData.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_IN = readFileSync(join(here, 'fixtures/bench_24h_10f.in'), 'utf8');
const REFERENCE_OUT = readFileSync(join(here, 'fixtures/bench_24h_10f.reference.out'), 'utf8');

const dataDir = findItuDataDir();

describe.skipIf(!dataDir)('golden: bench_24h_10f fixture through the real WASM engine', () => {
  it('produces predictions numerically matching the committed reference output', async () => {
    const dataProvider = new NodeFsDataProvider({ dataDir: dataDir! });
    const runtime = new WasmRuntime(dataProvider);
    await runtime.init();

    const { outputText } = await runtime.run(FIXTURE_IN, 8);
    const actual = parseOutputFile(outputText);
    const expected = parseOutputFile(REFERENCE_OUT);

    expect(actual.predictions).toHaveLength(240);
    expect(actual.predictions).toHaveLength(expected.predictions.length);

    for (let i = 0; i < expected.predictions.length; i++) {
      const a = actual.predictions[i]!;
      const e = expected.predictions[i]!;
      expect(a.month, `row ${i} month`).toBe(e.month);
      expect(a.hourUtc, `row ${i} hourUtc`).toBe(e.hourUtc);
      expect(a.frequencyMHz, `row ${i} frequencyMHz`).toBeCloseTo(e.frequencyMHz, 6);
      expect(a.distanceKm, `row ${i} distanceKm`).toBeCloseTo(e.distanceKm, 2);
      expect(a.fieldStrengthDbuVm, `row ${i} fieldStrengthDbuVm`).toBeCloseTo(e.fieldStrengthDbuVm, 2);
      expect(a.medianReceivedPowerDbW, `row ${i} medianReceivedPowerDbW`).toBeCloseTo(e.medianReceivedPowerDbW, 2);
      expect(a.snrAtReliabilityDb, `row ${i} snrAtReliabilityDb`).toBeCloseTo(e.snrAtReliabilityDb, 2);
      expect(a.overallReliability, `row ${i} overallReliability`).toBeCloseTo(e.overallReliability, 4);
      expect(a.overallReliabilityWithScatter, `row ${i} overallReliabilityWithScatter`).toBeCloseTo(
        e.overallReliabilityWithScatter,
        4,
      );
      expect(a.scatterProbability, `row ${i} scatterProbability`).toBeCloseTo(e.scatterProbability, 4);
    }
  });

  it('reports the same engine version banner as the committed reference', async () => {
    const dataProvider = new NodeFsDataProvider({ dataDir: dataDir! });
    const runtime = new WasmRuntime(dataProvider);
    const { outputText } = await runtime.run(FIXTURE_IN, 8);
    const actual = parseOutputFile(outputText);
    const expected = parseOutputFile(REFERENCE_OUT);
    expect(actual.engine.p533Version).toBe(expected.engine.p533Version);
    expect(actual.engine.p372Version).toBe(expected.engine.p372Version);
  });
});

if (!dataDir) {
  // eslint-disable-next-line no-console
  console.warn(
    '[engine.golden.test] SKIPPED: set HFKIT_ITU_DATA_DIR to a local ITU-R-HF ITURHFProp/Data/ directory ' +
      '(containing "P1239-3 Decile Factors.txt") to run the golden regression test against the real WASM engine.',
  );
}
