// Generates ITURHFProp's text `.in` input format from a typed PredictionRequest.
//
// Field-by-field correspondence was read out of the vendored source, not
// guessed:
//   - Path.hour / Path.month are 1-based in the file, decremented to 0-based
//     internally by ReadInputConfiguration.c (`ITURHFP->hrs[i] -= 1`), and
//     re-incremented when printed back in the report. We accept 0-23 UTC
//     hours in the public API (matching docs/08-domain-model.md's "UTC
//     always" convention) and add 1 here.
//   - Path.txpower is dB relative to 1 kW, NOT watts and NOT dBW
//     (DumpPathData.c: "Tx power = %lf (dB(1kW))"). We accept watts in the
//     public API and convert: dBkW = 10*log10(W / 1000).
//   - AntennaOrientation "TX2RX" makes the engine compute TXBearing/RXBearing
//     itself from the tx/rx positions (ITURHFProp.c: `if (AntennaOrientation
//     == TX2RX) { TXBearing = dllBearing(...) }`), so this package never
//     needs to supply bearings for the isotropic-only antenna support we
//     ship in this phase.
//   - The RptFileFormat below is a fixed, intentionally rich flag set chosen
//     to surface MUF, SNR, reliability, field strength and dominant mode in
//     one pass. It differs from the narrower flag set used by the committed
//     bench_24h_10f.in fixture (that fixture is only used, unmodified, by the
//     golden regression test -- see test/engine.golden.test.ts).

import {
  type ManMadeNoiseEnvironment,
  type Modulation,
  type PathDirection,
  type PredictionRequest,
} from './types.js';

const MAN_MADE_NOISE_TO_ENGINE: Record<ManMadeNoiseEnvironment, string> = {
  quiet: 'QUIET',
  quietRural: 'QUIETRURAL',
  rural: 'RURAL',
  residential: 'RESIDENTIAL',
  city: 'CITY',
  noisy: 'NOISY',
};

const MODULATION_TO_ENGINE: Record<Modulation, string> = {
  analog: 'ANALOG',
  digital: 'DIGITAL',
};

const PATH_DIRECTION_TO_ENGINE: Record<PathDirection, string> = {
  short: 'SHORTPATH',
  long: 'LONGPATH',
};

/** The fixed report column set this package's parser knows how to read back. */
export const REPORT_FORMAT =
  'RPT_RXLOCATION | RPT_D | RPT_BMUF | RPT_OPMUF | RPT_E | RPT_PR | RPT_SNR | RPT_SNRXX | RPT_OCR | RPT_OCRS | RPT_DOMMODE';

function sanitizeLabel(value: string, fallback: string): string {
  const cleaned = value.replace(/["\r\n]/g, '').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function num(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`inputFile: refusing to write non-finite number (${value}) into .in file`);
  }
  return String(value);
}

/**
 * Builds an ITURHFProp `.in` file body for the given request. Assumes
 * `validatePredictionRequest(request)` has already been called -- this
 * function does not re-validate ranges, only guards against non-finite
 * numbers reaching the generated text.
 */
export function buildInputFile(request: PredictionRequest): string {
  const pathName = sanitizeLabel(request.label?.pathName ?? '', 'HFKit prediction');
  const txName = sanitizeLabel(request.label?.transmitterName ?? '', 'TX');
  const rxName = sanitizeLabel(request.label?.receiverName ?? '', 'RX');

  const txPowerDbkW = 10 * Math.log10(request.transmitPowerWatts / 1000);
  const snrxxp = request.requiredReliabilityPercentOfMonth ?? 10;
  const sirr = request.requiredSirDb ?? 23.76;
  const pathDirection = request.pathDirection ?? 'short';
  const txGos = request.transmitAntenna?.gainOffsetDb ?? 0;
  const rxGos = request.receiveAntenna?.gainOffsetDb ?? 0;

  // Engine's internal representation is 0-based hours; the file format is
  // 1-based (see module docstring).
  const engineHours = request.time.hoursUtc.map((h) => h + 1);

  const lines: string[] = [
    `PathName "${pathName}"`,
    `PathTXName "${txName}"`,
    `Path.L_tx.lat ${num(request.transmitter.latitude)}`,
    `Path.L_tx.lng ${num(request.transmitter.longitude)}`,
    `TXAntFilePath "ISOTROPIC"`,
    `TXGOS ${num(txGos)}`,
    `PathRXName "${rxName}"`,
    `Path.L_rx.lat ${num(request.receiver.latitude)}`,
    `Path.L_rx.lng ${num(request.receiver.longitude)}`,
    `RXAntFilePath "ISOTROPIC"`,
    `RXGOS ${num(rxGos)}`,
    `AntennaOrientation "TX2RX"`,
    `Path.year ${num(request.time.year)}`,
    `Path.month ${num(request.time.month)}`,
    `Path.hour ${engineHours.map(num).join(',')}`,
    `Path.SSN ${num(request.solarDriver.ssn)}`,
    `Path.frequency ${request.frequenciesMHz.map(num).join(',')}`,
    `Path.txpower ${num(txPowerDbkW)}`,
    `Path.BW ${num(request.requiredSnrBandwidthHz)}`,
    `Path.SNRr ${num(request.requiredSnrDb)}`,
    `Path.SNRXXp ${num(snrxxp)}`,
    `Path.ManMadeNoise "${MAN_MADE_NOISE_TO_ENGINE[request.manMadeNoise]}"`,
    `Path.Modulation "${MODULATION_TO_ENGINE[request.modulation]}"`,
    `Path.SIRr ${num(sirr)}`,
    `Path.A 0.0`,
    `Path.TW 0.0`,
    `Path.FW 0.0`,
    `Path.T0 0.0`,
    `Path.F0 0.0`,
    `Path.SorL "${PATH_DIRECTION_TO_ENGINE[pathDirection]}"`,
    `RptFileFormat "${REPORT_FORMAT}"`,
    `LL.lat ${num(request.receiver.latitude)}`,
    `LL.lng ${num(request.receiver.longitude)}`,
    `LR.lat ${num(request.receiver.latitude)}`,
    `LR.lng ${num(request.receiver.longitude)}`,
    `UL.lat ${num(request.receiver.latitude)}`,
    `UL.lng ${num(request.receiver.longitude)}`,
    `UR.lat ${num(request.receiver.latitude)}`,
    `UR.lng ${num(request.receiver.longitude)}`,
    `latinc 1.0`,
    `lnginc 1.0`,
    `DataFilePath "../Data/"`,
    '',
  ];

  return lines.join('\n');
}
