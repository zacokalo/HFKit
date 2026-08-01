// Input validation for PredictionRequest.
//
// Ranges below are not guesses -- they are transcribed from the engine's own
// bounds checks in ITU-R-HF/P533/Src/P533/ValidatePath.c (RTN_ERR* codes) and
// ITU-R-HF/ITURHFProp/Src/ITURHFProp/ReadInputConfiguration.c, so that we
// reject bad input with an actionable TypeScript error *before* spending a
// WASM call on it, instead of getting back an opaque engine exit code.
//
// Frequency: [1.0, 30.0] MHz         (ValidatePath.c: RTN_ERRFREQUENCY)
// SSN:       [1, 311]                (RTN_ERRSSN -- note: minimum is 1, not 0)
// Bandwidth: [0.005, 3_000_000] Hz   (RTN_ERRBW)
// TX power:  [-30, 60] dB(1kW)       (RTN_ERRTXPOWER) -> watts [1, 1e9]
// SNRr:      [-30, 200] dB           (RTN_ERRSNRR)
// SIRr:      [-30, 200] dB           (RTN_ERRSIRR)
// SNRXXp:    [1, 99] (%)             (RTN_ERRSNRXXP)
// lat/lon:   |lat|<=90, |lon|<=180   (RTN_ERRLTX / RTN_ERRLRX)
// year:      [1900, 2100]            (RTN_ERRYEAR)
// hours/months arrays: max 24 / 12 entries (NMBOFHOURS / NMBOFMONTHS)
// frequency array: max 32 entries (NMBOFFREQS)

import type { PredictionRequest } from './types.js';

export class HFEngineValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`Invalid PredictionRequest.${field}: ${message}`);
    this.name = 'HFEngineValidationError';
    this.field = field;
  }
}

function fail(field: string, message: string): never {
  throw new HFEngineValidationError(field, message);
}

function checkFiniteNumber(field: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(field, `must be a finite number, got ${JSON.stringify(value)}`);
  }
}

function checkPosition(field: string, pos: { latitude: number; longitude: number }): void {
  checkFiniteNumber(`${field}.latitude`, pos.latitude);
  checkFiniteNumber(`${field}.longitude`, pos.longitude);
  if (pos.latitude < -90 || pos.latitude > 90) {
    fail(`${field}.latitude`, `must be in [-90, 90] degrees, got ${pos.latitude}`);
  }
  if (pos.longitude < -180 || pos.longitude > 180) {
    fail(`${field}.longitude`, `must be in [-180, 180] degrees, got ${pos.longitude}`);
  }
}

export const MAX_HOURS_PER_REQUEST = 24;
export const MAX_FREQUENCIES_PER_REQUEST = 32;

export function validatePredictionRequest(request: PredictionRequest): void {
  checkPosition('transmitter', request.transmitter);
  checkPosition('receiver', request.receiver);

  const { time } = request;
  checkFiniteNumber('time.year', time.year);
  if (!Number.isInteger(time.year) || time.year < 1900 || time.year > 2100) {
    fail('time.year', `must be an integer in [1900, 2100] (engine calendar bound), got ${time.year}`);
  }
  if (!Number.isInteger(time.month) || time.month < 1 || time.month > 12) {
    fail('time.month', `must be an integer in [1, 12], got ${time.month}`);
  }
  if (!Array.isArray(time.hoursUtc) || time.hoursUtc.length === 0) {
    fail('time.hoursUtc', 'must be a non-empty array of UTC hours');
  }
  if (time.hoursUtc.length > MAX_HOURS_PER_REQUEST) {
    fail(
      'time.hoursUtc',
      `must have at most ${MAX_HOURS_PER_REQUEST} entries (engine's NMBOFHOURS limit), got ${time.hoursUtc.length}`,
    );
  }
  const seenHours = new Set<number>();
  for (const h of time.hoursUtc) {
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      fail('time.hoursUtc', `every entry must be an integer in [0, 23] (UTC hour-of-day), got ${h}`);
    }
    if (seenHours.has(h)) {
      fail('time.hoursUtc', `hour ${h} is repeated -- each hour must appear at most once`);
    }
    seenHours.add(h);
  }

  if (!Array.isArray(request.frequenciesMHz) || request.frequenciesMHz.length === 0) {
    fail('frequenciesMHz', 'must be a non-empty array of MHz values');
  }
  if (request.frequenciesMHz.length > MAX_FREQUENCIES_PER_REQUEST) {
    fail(
      'frequenciesMHz',
      `must have at most ${MAX_FREQUENCIES_PER_REQUEST} entries (engine's NMBOFFREQS limit), got ${request.frequenciesMHz.length}`,
    );
  }
  for (const f of request.frequenciesMHz) {
    checkFiniteNumber('frequenciesMHz[]', f);
    if (f < 1.0 || f > 30.0) {
      fail(
        'frequenciesMHz',
        `${f} MHz is outside ITU-R P.533's valid range of 1.0-30.0 MHz (ValidatePath.c RTN_ERRFREQUENCY)`,
      );
    }
  }

  checkFiniteNumber('transmitPowerWatts', request.transmitPowerWatts);
  if (request.transmitPowerWatts <= 0) {
    fail('transmitPowerWatts', `must be > 0 watts, got ${request.transmitPowerWatts}`);
  }
  // Engine wants dB(1kW): dBkW = 10*log10(W / 1000). Valid range [-30, 60] dBkW.
  const txPowerDbkW = 10 * Math.log10(request.transmitPowerWatts / 1000);
  if (txPowerDbkW < -30 || txPowerDbkW > 60) {
    fail(
      'transmitPowerWatts',
      `${request.transmitPowerWatts} W is outside the engine's valid power range of roughly 1 W to 1e9 W ` +
        `(internally -30..60 dB relative to 1 kW; ValidatePath.c RTN_ERRTXPOWER), got ${txPowerDbkW.toFixed(2)} dB(1kW)`,
    );
  }

  checkFiniteNumber('requiredSnrDb', request.requiredSnrDb);
  if (request.requiredSnrDb < -30 || request.requiredSnrDb > 200) {
    fail('requiredSnrDb', `must be in [-30, 200] dB (ValidatePath.c RTN_ERRSNRR), got ${request.requiredSnrDb}`);
  }

  checkFiniteNumber('requiredSnrBandwidthHz', request.requiredSnrBandwidthHz);
  if (request.requiredSnrBandwidthHz < 0.005 || request.requiredSnrBandwidthHz > 3_000_000) {
    fail(
      'requiredSnrBandwidthHz',
      `must be in [0.005, 3000000] Hz (ValidatePath.c RTN_ERRBW), got ${request.requiredSnrBandwidthHz}`,
    );
  }

  if (request.requiredReliabilityPercentOfMonth !== undefined) {
    const p = request.requiredReliabilityPercentOfMonth;
    if (!Number.isInteger(p) || p < 1 || p > 99) {
      fail(
        'requiredReliabilityPercentOfMonth',
        `must be an integer in [1, 99] (ValidatePath.c RTN_ERRSNRXXP), got ${p}`,
      );
    }
  }

  if (request.requiredSirDb !== undefined) {
    checkFiniteNumber('requiredSirDb', request.requiredSirDb);
    if (request.requiredSirDb < -30 || request.requiredSirDb > 200) {
      fail('requiredSirDb', `must be in [-30, 200] dB (ValidatePath.c RTN_ERRSIRR), got ${request.requiredSirDb}`);
    }
  }

  checkFiniteNumber('solarDriver.ssn', request.solarDriver.ssn);
  if (!Number.isInteger(request.solarDriver.ssn) || request.solarDriver.ssn < 1 || request.solarDriver.ssn > 311) {
    fail(
      'solarDriver.ssn',
      `must be an integer in [1, 311] (ValidatePath.c RTN_ERRSSN), got ${request.solarDriver.ssn}`,
    );
  }

  const validNoiseCategories = ['quiet', 'quietRural', 'rural', 'residential', 'city', 'noisy'];
  if (!validNoiseCategories.includes(request.manMadeNoise)) {
    fail('manMadeNoise', `must be one of ${validNoiseCategories.join(', ')}, got ${JSON.stringify(request.manMadeNoise)}`);
  }

  if (request.modulation !== 'analog' && request.modulation !== 'digital') {
    fail('modulation', `must be 'analog' or 'digital', got ${JSON.stringify(request.modulation)}`);
  }

  if (
    request.pathDirection !== undefined &&
    request.pathDirection !== 'short' &&
    request.pathDirection !== 'long'
  ) {
    fail('pathDirection', `must be 'short' or 'long', got ${JSON.stringify(request.pathDirection)}`);
  }

  for (const [field, antenna] of [
    ['transmitAntenna', request.transmitAntenna] as const,
    ['receiveAntenna', request.receiveAntenna] as const,
  ]) {
    if (antenna === undefined) continue;
    if (antenna.kind !== 'isotropic') {
      fail(
        field,
        `only 'isotropic' is supported in this phase (pattern-file antennas are deferred; see docs/08-domain-model.md), got ${JSON.stringify(antenna.kind)}`,
      );
    }
    if (antenna.gainOffsetDb !== undefined) {
      checkFiniteNumber(`${field}.gainOffsetDb`, antenna.gainOffsetDb);
    }
  }
}
