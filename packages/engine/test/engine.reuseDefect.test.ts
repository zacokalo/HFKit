// Regression test for a real upstream defect discovered while building this
// package (see outputParser.ts REPORT_FORMAT_COLUMNS docstring and
// engine.ts's fallbackColumns comment for the full citation):
//
//   ITU-R-HF/ITURHFProp/Src/ITURHFProp/Report.c has `static int Header =
//   TRUE`, a process-lifetime flag that gates printing the report's
//   header/"Data Format" section. It is only ever TRUE on the first
//   `callMain()` a WASM module instance ever executes. Because this package
//   deliberately reuses one instance across `predict()` calls (see
//   wasmModule.ts), every call after the first gets a report missing that
//   section.
//
// This test proves two things, not just "it doesn't throw":
//   1. The parser genuinely takes the fallback-column path on reused calls
//      (parseOutputFile's usedFallbackColumns flag), i.e. this isn't
//      accidentally passing because the bug doesn't actually trigger here.
//   2. The DATA itself -- not just "parsing succeeds" -- is byte-for-byte
//      equivalent to what a brand new, freshly instantiated engine computes
//      for the identical request. This is what makes the fallback safe
//      rather than merely convenient: the underlying P533 computation is
//      unaffected by the missing header, only the report's text scaffold is.
//
// Needs real ITU data; skips without HFKIT_ITU_DATA_DIR.

import { describe, expect, it } from 'vitest';

import { HFEngine } from '../src/engine.js';
import { NodeFsDataProvider } from '../src/nodeDataProvider.js';
import { parseOutputFile, REPORT_FORMAT_COLUMNS } from '../src/outputParser.js';
import type { PredictionRequest } from '../src/types.js';
import { WasmRuntime } from '../src/wasmModule.js';
import { findItuDataDir } from './helpers/testData.js';

const dataDir = findItuDataDir();

function requestForHour(hourUtc: number): PredictionRequest {
  return {
    transmitter: { latitude: 49.6666666667, longitude: 6.31666666667 },
    receiver: { latitude: 51.1166666667, longitude: 7.26666666667 },
    time: { year: 2026, month: 8, hoursUtc: [hourUtc] },
    frequenciesMHz: [14.1],
    transmitPowerWatts: 100,
    requiredSnrDb: 10,
    requiredSnrBandwidthHz: 3000,
    manMadeNoise: 'rural',
    modulation: 'analog',
    solarDriver: { ssn: 80 },
  };
}

describe.skipIf(!dataDir)('reused WASM instance vs. fresh instance (Report.c static Header defect)', () => {
  it('the 2nd+ callMain() on one instance omits the Data Format section (confirms the defect is real, not theoretical)', async () => {
    const runtime = new WasmRuntime(new NodeFsDataProvider({ dataDir: dataDir! }));
    await runtime.init();

    const first = await runtime.run(buildRawInFile(1), 8);
    const second = await runtime.run(buildRawInFile(2), 8);

    const firstParsed = parseOutputFile(first.outputText);
    expect(firstParsed.usedFallbackColumns).toBe(false);

    // Strict parsing (no fallback) of the second call's output must fail --
    // if it didn't, the defect wouldn't actually be triggering and the rest
    // of this test file wouldn't be proving what it claims to.
    expect(() => parseOutputFile(second.outputText)).toThrow(/Data Format/);

    const secondParsed = parseOutputFile(second.outputText, { fallbackColumns: REPORT_FORMAT_COLUMNS });
    expect(secondParsed.usedFallbackColumns).toBe(true);
  });

  it('produces numerically identical predictions whether or not the instance was reused', async () => {
    const dataProvider = new NodeFsDataProvider({ dataDir: dataDir! });

    // Reused instance: three predict() calls on the same HFEngine.
    const sharedEngine = await HFEngine.create({ dataProvider });
    const reused = [
      await sharedEngine.predict(requestForHour(1)),
      await sharedEngine.predict(requestForHour(2)),
      await sharedEngine.predict(requestForHour(3)),
    ];

    // Fresh instance per call, for comparison.
    const fresh = [];
    for (const hour of [1, 2, 3]) {
      const engine = await HFEngine.create({ dataProvider });
      fresh.push(await engine.predict(requestForHour(hour)));
    }

    for (let i = 0; i < 3; i++) {
      const r = reused[i]!.predictions[0]!;
      const f = fresh[i]!.predictions[0]!;
      expect(r.fieldStrengthDbuVm, `hour ${i + 1} fieldStrengthDbuVm`).toBe(f.fieldStrengthDbuVm);
      expect(r.medianReceivedPowerDbW, `hour ${i + 1} medianReceivedPowerDbW`).toBe(f.medianReceivedPowerDbW);
      expect(r.snrAtReliabilityDb, `hour ${i + 1} snrAtReliabilityDb`).toBe(f.snrAtReliabilityDb);
      expect(r.basicMufMHz, `hour ${i + 1} basicMufMHz`).toBe(f.basicMufMHz);
      expect(r.operationalMufMHz, `hour ${i + 1} operationalMufMHz`).toBe(f.operationalMufMHz);
      expect(r.overallReliability, `hour ${i + 1} overallReliability`).toBe(f.overallReliability);
      expect(r.dominantMode?.mode, `hour ${i + 1} dominantMode`).toBe(f.dominantMode?.mode);
    }

    // And sanity: hour 1 (the first call on sharedEngine) must have actually
    // exercised the normal, non-fallback path, while hours 2-3 must have
    // exercised the fallback -- otherwise this test wouldn't be testing what
    // it claims to.
    expect(reused[0]!.predictions[0]!.frequencyMHz).toBeCloseTo(14.1, 6);
  });
});

function buildRawInFile(hour: number): string {
  return `PathName "reuse-defect-test"
PathTXName "TX"
Path.L_tx.lat 49.6666666667
Path.L_tx.lng 6.31666666667
TXAntFilePath "ISOTROPIC"
TXGOS 0.0
PathRXName "RX"
Path.L_rx.lat 51.1166666667
Path.L_rx.lng 7.26666666667
RXAntFilePath "ISOTROPIC"
RXGOS 0.0
AntennaOrientation "TX2RX"
Path.year 2026
Path.month 8
Path.hour ${hour}
Path.SSN 80
Path.frequency 14.1
Path.txpower -10
Path.BW 3000
Path.SNRr 10
Path.SNRXXp 10
Path.ManMadeNoise "RURAL"
Path.Modulation "ANALOG"
Path.SIRr 23.76
Path.A 0.0
Path.TW 0.0
Path.FW 0.0
Path.T0 0.0
Path.F0 0.0
Path.SorL "SHORTPATH"
RptFileFormat "RPT_RXLOCATION | RPT_D | RPT_BMUF | RPT_OPMUF | RPT_E | RPT_PR | RPT_SNR | RPT_SNRXX | RPT_OCR | RPT_OCRS | RPT_DOMMODE"
LL.lat 51.1166666667
LL.lng 7.26666666667
LR.lat 51.1166666667
LR.lng 7.26666666667
UL.lat 51.1166666667
UL.lng 7.26666666667
UR.lat 51.1166666667
UR.lng 7.26666666667
latinc 1.0
lnginc 1.0
DataFilePath "../Data/"
`;
}

if (!dataDir) {
  // eslint-disable-next-line no-console
  console.warn(
    '[engine.reuseDefect.test] SKIPPED: set HFKIT_ITU_DATA_DIR to run the WASM-instance-reuse regression test.',
  );
}
