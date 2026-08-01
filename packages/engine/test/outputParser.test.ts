import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HFEngineOutputParseError, parseOutputFile } from '../src/outputParser.js';

const here = dirname(fileURLToPath(import.meta.url));
const REFERENCE_OUT = readFileSync(join(here, 'fixtures/bench_24h_10f.reference.out'), 'utf8');

describe('parseOutputFile', () => {
  it('parses the committed reference report end to end', () => {
    const parsed = parseOutputFile(REFERENCE_OUT);
    expect(parsed.predictions).toHaveLength(240); // 24 hours x 10 frequencies
    expect(parsed.engine.p533Version).toBe('14.2');
    expect(parsed.engine.p372Version).toBe('14.3');
    expect(parsed.engine.ituRHFPropVersion).toBe('Aug  1 2026');
  });

  it('converts the engine 1-24 hour convention back to 0-23 UTC', () => {
    const parsed = parseOutputFile(REFERENCE_OUT);
    const hours = new Set(parsed.predictions.map((p) => p.hourUtc));
    expect(Math.min(...hours)).toBe(0);
    expect(Math.max(...hours)).toBe(23);
  });

  it('converts percentage reliability/scatter fields to 0-1 fractions', () => {
    const parsed = parseOutputFile(REFERENCE_OUT);
    for (const p of parsed.predictions) {
      expect(p.overallReliability).toBeGreaterThanOrEqual(0);
      expect(p.overallReliability).toBeLessThanOrEqual(1);
      expect(p.overallReliabilityWithScatter).toBeGreaterThanOrEqual(0);
      expect(p.overallReliabilityWithScatter).toBeLessThanOrEqual(1);
      expect(p.scatterProbability).toBeGreaterThanOrEqual(0);
      expect(p.scatterProbability).toBeLessThanOrEqual(1);
    }
  });

  it('parses known first-row values from the committed reference file exactly', () => {
    // Row: "08, 01,    3.500,  51.1167,   7.2667,   174.73,  35.17, -82.92,  41.60,   0.00,   0.00,   0.00"
    const parsed = parseOutputFile(REFERENCE_OUT);
    const first = parsed.predictions[0];
    expect(first).toBeDefined();
    expect(first?.month).toBe(8);
    expect(first?.hourUtc).toBe(0);
    expect(first?.frequencyMHz).toBeCloseTo(3.5, 6);
    expect(first?.receiver.latitude).toBeCloseTo(51.1167, 6);
    expect(first?.receiver.longitude).toBeCloseTo(7.2667, 6);
    expect(first?.distanceKm).toBeCloseTo(174.73, 6);
    expect(first?.fieldStrengthDbuVm).toBeCloseTo(35.17, 6);
    expect(first?.medianReceivedPowerDbW).toBeCloseTo(-82.92, 6);
    expect(first?.snrAtReliabilityDb).toBeCloseTo(41.6, 6);
    // This fixture's RptFileFormat doesn't request BMUF/OPMUF/SNR/DOMMODE.
    expect(first?.basicMufMHz).toBeUndefined();
    expect(first?.operationalMufMHz).toBeUndefined();
    expect(first?.snrDb).toBeUndefined();
    expect(first?.dominantMode).toBeUndefined();
  });

  it('rejects empty input', () => {
    expect(() => parseOutputFile('')).toThrow(HFEngineOutputParseError);
    expect(() => parseOutputFile('   \n  ')).toThrow(HFEngineOutputParseError);
  });

  it('rejects output missing the Data Format section', () => {
    const broken = REFERENCE_OUT.replace(/Data Format \*+/, 'Something Else ***');
    expect(() => parseOutputFile(broken)).toThrow(/Data Format/);
  });

  it('rejects output missing the Calculated Parameters section', () => {
    const broken = REFERENCE_OUT.replace(/Calculated Parameters \*+/g, 'Nonsense ***');
    expect(() => parseOutputFile(broken)).toThrow(/Calculated Parameters/);
  });

  it('rejects an unrecognized report column rather than silently ignoring it', () => {
    const broken = REFERENCE_OUT.replace('Column 07: E - Path Field Strength (dB(1uV/m))', 'Column 07: Something New (units)');
    expect(() => parseOutputFile(broken)).toThrow(/unrecognized report column/);
  });

  it('rejects a data row with the wrong number of fields', () => {
    const lines = REFERENCE_OUT.split('\n');
    const rowIdx = lines.findIndex((l) => l.startsWith('08, 01,    3.500,'));
    expect(rowIdx).toBeGreaterThan(-1);
    lines[rowIdx] = lines[rowIdx]!.replace(/,\s*0\.00\s*$/, ''); // drop the last field
    expect(() => parseOutputFile(lines.join('\n'))).toThrow(/fields but the report declared/);
  });

  it('rejects a data row with a non-numeric value in a numeric column', () => {
    const lines = REFERENCE_OUT.split('\n');
    const rowIdx = lines.findIndex((l) => l.startsWith('08, 01,    3.500,'));
    expect(rowIdx).toBeGreaterThan(-1);
    lines[rowIdx] = lines[rowIdx]!.replace('174.73', 'NOT_A_NUMBER');
    expect(() => parseOutputFile(lines.join('\n'))).toThrow(/expected a finite number/);
  });

  it('rejects a report whose Calculated Parameters section has zero rows', () => {
    const broken = REFERENCE_OUT.replace(
      /\*+ Calculated Parameters \*+[\s\S]*?\*+End Calculated Parameters \*+/,
      '************************ Calculated Parameters ****************************\n\n' +
        '**************************End Calculated Parameters ***********************',
    );
    expect(() => parseOutputFile(broken)).toThrow(/zero data rows/);
  });

  it('parses a hand-built report requesting the richer BMUF/OPMUF/DOMMODE column set', () => {
    const richOut = [
      '***************************** P533 Input Parameters ****************************',
      '',
      '************************ End P533 Input Parameters *****************************',
      '',
      '******************************** Data Format ***********************************',
      '',
      'Column 01: Month',
      'Column 02: Hour',
      'Column 03: Frequency (MHz)',
      'Column 04: Receiver latitude (deg)',
      'Column 05: Receiver longitude (deg)',
      'Column 06: D - Path distance (km)',
      'Column 07: BMUF - Path basic MUF (MHz)',
      'Column 08: OPMUF - Operation MUF (MHz)',
      'Column 09: E - Path Field Strength (dB(1uV/m))',
      'Column 10: Pr - Median receiver power (dB)',
      'Column 11: SNR - Median signal-to-noise ratio (dB)',
      'Column 12: SNRXXp - Signal-to-noise ratio at 10% of month',
      'Column 13: OCR - Overall circuit reliability not considering scattering (%)',
      'Column 14: OCRs - Overall circuit reliability considering scattering (%)',
      'Column 15: Probocc - Probability of scattering (%)',
      'Column 16: Dominant mode',
      'Column 17: Dominant mode - Elevation angle (deg)',
      'Column 18: Dominant mode - Delay (mS)',
      'Column 19: Dominant mode - Loss (dB)',
      'Column 20: Dominant mode - Propagation probability (%)',
      'Column 21: Dominant mode - Virtual height (km)',
      'Column 22: Dominant mode - Median received power (dB)',
      'Column 23: Dominant mode - Receiver Antenna Gain (dBi)',
      'Column 24: Dominant mode - Field Strength (dB(1uV/m))',
      'Column 25: Dominant mode - Basic MUF (MHz)',
      '',
      '************************** End Data Format ********************************',
      '',
      '************************ Calculated Parameters ****************************',
      '',
      '08, 01,    3.500,  51.1167,   7.2667,   174.73,   5.05,   6.06,  35.17, -82.92,  31.33,  41.60,   0.00,   0.00,   0.00,  1F2 ,  75.65,   0.00, 113.10,   1.00, 365.49, -83.70,   0.00,  34.38,   5.05',
      '',
      '**************************End Calculated Parameters ***********************',
    ].join('\n');

    const parsed = parseOutputFile(richOut);
    expect(parsed.predictions).toHaveLength(1);
    const row = parsed.predictions[0];
    expect(row?.basicMufMHz).toBeCloseTo(5.05, 6);
    expect(row?.operationalMufMHz).toBeCloseTo(6.06, 6);
    expect(row?.snrDb).toBeCloseTo(31.33, 6);
    expect(row?.dominantMode).toEqual({
      mode: '1F2',
      elevationAngleDeg: 75.65,
      delayMs: 0,
      lossDb: 113.1,
      propagationProbabilityPercent: 1,
      virtualHeightKm: 365.49,
      medianReceivedPowerDbW: -83.7,
      receiverAntennaGainDbi: 0,
      fieldStrengthDbuVm: 34.38,
      basicMufMHz: 5.05,
    });
  });
});
