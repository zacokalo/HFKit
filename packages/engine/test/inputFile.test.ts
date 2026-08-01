import { describe, expect, it } from 'vitest';

import { buildInputFile, REPORT_FORMAT } from '../src/inputFile.js';
import type { PredictionRequest } from '../src/types.js';

function baseRequest(overrides: Partial<PredictionRequest> = {}): PredictionRequest {
  return {
    transmitter: { latitude: 49.6666666667, longitude: 6.31666666667 },
    receiver: { latitude: 51.1166666667, longitude: 7.26666666667 },
    time: { year: 2026, month: 8, hoursUtc: [0] },
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

describe('buildInputFile', () => {
  it('converts UTC hour 0-23 to the engine 1-24 convention', () => {
    const text = buildInputFile(baseRequest({ time: { year: 2026, month: 8, hoursUtc: [0, 5, 23] } }));
    expect(text).toContain('Path.hour 1,6,24');
  });

  it('converts transmit power from watts to dB(1kW)', () => {
    const text = buildInputFile(baseRequest({ transmitPowerWatts: 1000 }));
    // 1000 W = 1 kW -> 0 dB(1kW)
    expect(text).toMatch(/Path\.txpower 0(\.0+)?\n/);
  });

  it('converts a fractional-watt-relative power correctly', () => {
    const text = buildInputFile(baseRequest({ transmitPowerWatts: 100 }));
    const match = /Path\.txpower (-?[\d.]+)/.exec(text);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeCloseTo(10 * Math.log10(100 / 1000), 6);
  });

  it('maps man-made noise categories to engine strings', () => {
    expect(buildInputFile(baseRequest({ manMadeNoise: 'quietRural' }))).toContain('Path.ManMadeNoise "QUIETRURAL"');
    expect(buildInputFile(baseRequest({ manMadeNoise: 'city' }))).toContain('Path.ManMadeNoise "CITY"');
    expect(buildInputFile(baseRequest({ manMadeNoise: 'noisy' }))).toContain('Path.ManMadeNoise "NOISY"');
  });

  it('maps modulation and path direction', () => {
    expect(buildInputFile(baseRequest({ modulation: 'digital' }))).toContain('Path.Modulation "DIGITAL"');
    expect(buildInputFile(baseRequest({ pathDirection: 'long' }))).toContain('Path.SorL "LONGPATH"');
    expect(buildInputFile(baseRequest())).toContain('Path.SorL "SHORTPATH"');
  });

  it('always uses TX2RX antenna orientation (isotropic-only support)', () => {
    const text = buildInputFile(baseRequest());
    expect(text).toContain('AntennaOrientation "TX2RX"');
    expect(text).not.toMatch(/TXBearing/);
    expect(text).not.toMatch(/RXBearing/);
  });

  it('requests the fixed, documented report column set', () => {
    const text = buildInputFile(baseRequest());
    expect(text).toContain(`RptFileFormat "${REPORT_FORMAT}"`);
  });

  it('defaults SNRXXp to 10 and SIRr to 23.76 when not provided', () => {
    const text = buildInputFile(baseRequest());
    expect(text).toContain('Path.SNRXXp 10');
    expect(text).toContain('Path.SIRr 23.76');
  });

  it('honors explicit SNRXXp and SIRr overrides', () => {
    const text = buildInputFile(baseRequest({ requiredReliabilityPercentOfMonth: 50, requiredSirDb: 12.5 }));
    expect(text).toContain('Path.SNRXXp 50');
    expect(text).toContain('Path.SIRr 12.5');
  });

  it('writes comma-separated frequency lists in the given order', () => {
    const text = buildInputFile(baseRequest({ frequenciesMHz: [3.5, 5.3, 7.1] }));
    expect(text).toContain('Path.frequency 3.5,5.3,7.1');
  });

  it('sanitizes labels to prevent quote/newline injection into the .in format', () => {
    const text = buildInputFile(
      baseRequest({ label: { pathName: 'evil"\ninjected line', transmitterName: 'TX"', receiverName: 'RX' } }),
    );
    // The embedded quote and newline must not produce a second, attacker-
    // controlled line in the generated file (e.g. a forged "Path.SSN 999").
    expect(text).toContain('PathName "evilinjected line"');
    expect(text.split('\n').filter((l) => l.startsWith('PathName'))).toHaveLength(1);
    expect(text).toContain('PathTXName "TX"');
  });

  it('falls back to default labels when none supplied', () => {
    const text = buildInputFile(baseRequest());
    expect(text).toContain('PathName "HFKit prediction"');
    expect(text).toContain('PathTXName "TX"');
    expect(text).toContain('PathRXName "RX"');
  });

  it('places the single receiver point as a degenerate LL/LR/UL/UR grid', () => {
    const text = buildInputFile(baseRequest());
    const rxLatLine = 'LL.lat 51.1166666667';
    expect(text).toContain(rxLatLine);
    expect((text.match(/51\.1166666667/g) ?? []).length).toBeGreaterThanOrEqual(5); // Path.L_rx + 4 grid corners
  });

  it('throws rather than emitting a non-finite number', () => {
    expect(() => buildInputFile(baseRequest({ transmitPowerWatts: Number.NaN }))).toThrow();
  });
});
