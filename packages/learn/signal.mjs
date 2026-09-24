// Decibels, S-meters and noise, for the Learn page.
//
// The lesson this module exists to teach is counter-intuitive and worth getting
// right: power buys surprisingly little, and noise costs surprisingly much.
// Ten times the power is 10 dB, under two S-units. Moving a receiver from a
// city to quiet countryside can be worth 20 dB or more.
//
// The S-meter scale and the noise figures are real standards. The station
// scenario on top of them — what a dipole at 100 W "arrives at" — is an
// illustrative round number, and the page labels it as one.

/** IARU Region 1 recommendation for HF: S9 is -73 dBm (50 µV into 50 ohms). */
export const S9_DBM = -73;
export const DB_PER_S_UNIT = 6;

/** Thermal noise, kT0 at 290 K, in dBm per hertz. */
const KT0_DBM_HZ = -174;

/** The bandwidth every SNR here is quoted in: the WSJT-X convention. */
export const REFERENCE_BANDWIDTH_HZ = 2500;

export const dbFromRatio = (ratio) => 10 * Math.log10(ratio);
export const ratioFromDb = (db) => 10 ** (db / 10);

/**
 * A received level as an S-meter reading. Below S9 in S-units; above S9 in
 * decibels, the way meters are marked ("S9+20").
 */
export function sMeter(dbm) {
  const s = 9 + (dbm - S9_DBM) / DB_PER_S_UNIT;
  if (dbm <= S9_DBM) {
    return { s, overS9Db: 0, label: `S${Math.max(0, Math.round(s))}` };
  }
  const over = dbm - S9_DBM;
  const rounded = Math.round(over / 5) * 5;
  return { s, overS9Db: over, label: rounded > 0 ? `S9+${rounded}` : 'S9' };
}

/**
 * Man-made noise environments from ITU-R P.372, Table 1: Fam = c - d log10(f),
 * in dB above kT0. These are the official medians, not guesses — and the gap
 * between them is the most useful number on the Learn page.
 */
export const NOISE_ENVIRONMENTS = [
  { id: 'quiet', label: 'Quiet countryside', c: 53.6, d: 28.6 },
  { id: 'rural', label: 'Rural', c: 67.2, d: 27.7 },
  { id: 'residential', label: 'Suburb', c: 72.5, d: 27.7 },
  { id: 'city', label: 'City', c: 76.8, d: 27.7 },
];

/**
 * Noise power at a receiver, dBm in `bandwidthHz`: man-made noise for the
 * environment plus galactic noise (P.372: 52 - 23 log10 f), added as powers.
 * Galactic noise only matters in the quietest places, where it sets the floor.
 * Lightning static is left out; on summer nights it dominates the low bands.
 */
export function noiseDbm(environmentId, fMHz, bandwidthHz = REFERENCE_BANDWIDTH_HZ) {
  const env = NOISE_ENVIRONMENTS.find((e) => e.id === environmentId);
  if (!env) throw new Error(`unknown noise environment: ${environmentId}`);
  const lf = Math.log10(fMHz);
  const manMade = env.c - env.d * lf;
  const galactic = 52 - 23 * lf;
  const fa = dbFromRatio(ratioFromDb(manMade) + ratioFromDb(galactic));
  return fa + KT0_DBM_HZ + dbFromRatio(bandwidthHz);
}

/**
 * Roughly how much signal each mode needs above the noise, in 2500 Hz. A
 * receiver's filter and a decoder's integration are why the numbers differ so
 * much: FT8 averages over 13 seconds, and a CW filter is a tenth the width of
 * a voice one.
 */
export const MODES = [
  { id: 'ssb', label: 'Voice (SSB)', readableDb: 6, comfortableDb: 15 },
  { id: 'cw', label: 'Morse (CW)', readableDb: -3, comfortableDb: 6 },
  { id: 'ft8', label: 'FT8 (digital)', readableDb: -20, comfortableDb: -10 },
];

/** 'comfortable' | 'readable' | 'buried' */
export function copyVerdict(snrDb, modeId) {
  const m = MODES.find((x) => x.id === modeId);
  if (!m) throw new Error(`unknown mode: ${modeId}`);
  if (snrDb >= m.comfortableDb) return 'comfortable';
  if (snrDb >= m.readableDb) return 'readable';
  return 'buried';
}

/**
 * Transmit antennas, as gain relative to a dipole. Round, typical figures for
 * the 40 m scenario on the page; a real whip or attic wire varies by 10 dB
 * with how it is installed.
 */
export const TX_ANTENNAS = [
  { id: 'whip', label: 'Car whip', gainDb: -15 },
  { id: 'attic', label: 'Wire in the attic', gainDb: -6 },
  { id: 'dipole', label: 'Dipole outdoors', gainDb: 0 },
  { id: 'beam', label: 'Beam antenna (Yagi)', gainDb: 6 },
];

/** Illustrative: 100 W into a dipole arriving at S8 some 1,500 km away on 40 m. */
export const REFERENCE_WATTS = 100;
export const REFERENCE_SIGNAL_DBM = -79;

export function receivedDbm({ watts, antennaId }) {
  const ant = TX_ANTENNAS.find((a) => a.id === antennaId);
  if (!ant) throw new Error(`unknown antenna: ${antennaId}`);
  return REFERENCE_SIGNAL_DBM + dbFromRatio(watts / REFERENCE_WATTS) + ant.gainDb;
}
