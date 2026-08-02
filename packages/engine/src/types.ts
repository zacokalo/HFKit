// Domain types for @hfkit/engine.
//
// Units follow docs/08-domain-model.md exactly and are binding:
//   - Time: UTC always.
//   - Frequency: MHz.
//   - Power: watts, TX PEP.
//   - SNR: dB, always with a stated bandwidth.
//   - Position: decimal degrees WGS84.
//   - Distance: km.
//   - "Reliability" (0-1, from the engine) and "score" (0-100, HFKit's own A-score)
//     are different things -- this package only ever produces the former.

/** A position in decimal degrees, WGS84. Latitude north-positive, longitude east-positive. */
export interface GeoPosition {
  /** Decimal degrees, WGS84, north-positive. Range: -90..90. */
  latitude: number;
  /** Decimal degrees, WGS84, east-positive. Range: -180..180. */
  longitude: number;
}

/**
 * ITU-R P.372 man-made noise environment category. These are the engine's own
 * six categories (see ITU-R-HF ReadInputConfiguration.c) -- there is no lossless
 * mapping from these onto the four-bucket `quiet_rural | rural | residential |
 * industrial` vocabulary in docs/08-domain-model.md, so we expose the engine's
 * real categories rather than inventing an approximate translation. Suggested
 * mapping for UI copy: quiet_rural -> "quietRural", rural -> "rural",
 * residential -> "residential", industrial -> "noisy".
 */
export type ManMadeNoiseEnvironment =
  | 'quiet'
  | 'quietRural'
  | 'rural'
  | 'residential'
  | 'city'
  | 'noisy';

export type PathDirection = 'short' | 'long';

export type Modulation = 'analog' | 'digital';

/**
 * Antenna selection. Phase 1 only wires up ISOTROPIC (matches
 * docs/08-domain-model.md's layered AntennaProfile: "simple class" and
 * "pattern file" tiers are later-phase work). Bearing is computed
 * automatically (transmitter pointed at receiver and vice versa) -- ITURHFProp
 * calls this "TX2RX" orientation -- so it never needs to be supplied by the
 * caller for an isotropic antenna.
 */
export interface AntennaSpec {
  kind: 'isotropic';
  /** Antenna gain offset relative to isotropic, dB. Default 0. */
  gainOffsetDb?: number;
}

export interface SolarDriver {
  /** Sunspot number (R12, smoothed 12-month running mean). Engine valid range: 1-311. */
  ssn: number;
}

export interface PredictionTime {
  /** Calendar year. Used only for report labeling; the engine's ionospheric
   *  model is climatological (indexed by month + SSN), not by specific date. */
  year: number;
  /** Calendar month, 1-12 (matches ITU ionosNN.bin file naming). */
  month: number;
  /**
   * UTC hours to predict, each 0-23, each appearing at most once. 1-24 entries.
   * ITURHFProp predicts the monthly-median circuit for each UTC hour-of-day
   * requested (not a specific date/time).
   */
  hoursUtc: number[];
}

export interface PredictionRequest {
  transmitter: GeoPosition;
  receiver: GeoPosition;
  time: PredictionTime;
  /** MHz. 1-32 entries, each in the engine's documented valid range 1.0-30.0 MHz
   *  (ITU-R P.533 / ValidatePath.c RTN_ERRFREQUENCY bound). */
  frequenciesMHz: number[];
  /** TX power, watts (PEP), > 0. Internally converted to dB(1kW) for the engine
   *  (0 dB(1kW) = 1000 W); engine valid range is -30..60 dB(1kW), i.e. roughly
   *  1 W to 1 GW -- validated against that bound, not against a "realistic"
   *  ham-radio range. */
  transmitPowerWatts: number;
  /** Required SNR, dB, in the bandwidth given by requiredSnrBandwidthHz. Engine
   *  valid range: -30..200 dB. */
  requiredSnrDb: number;
  /** Reference bandwidth for requiredSnrDb and the reported SNR figures, Hz.
   *  Engine valid range: 0.005-3,000,000 Hz. */
  requiredSnrBandwidthHz: number;
  /**
   * Required percentage of the month the circuit must meet requiredSnrDb,
   * i.e. the "SNRXXp" reliability target (engine calls this "days per month").
   * Integer 1-99. Default 10 (a conventional VOACAP-family default).
   */
  requiredReliabilityPercentOfMonth?: number;
  /** Required signal-to-interference ratio, dB. Engine valid range: -30..200 dB.
   *  Default 23.76 dB (ITU-R P.533's own worked-example default, used across
   *  its reference test cases). Only affects circuits where SIR is limiting;
   *  point-to-point predictions without a specified interferer are largely
   *  insensitive to this. */
  requiredSirDb?: number;
  manMadeNoise: ManMadeNoiseEnvironment;
  modulation: Modulation;
  solarDriver: SolarDriver;
  /** Great-circle path to predict. Default 'short'. */
  pathDirection?: PathDirection;
  /** Default: isotropic, no gain offset. */
  transmitAntenna?: AntennaSpec;
  receiveAntenna?: AntennaSpec;
  /** Optional human-readable labels, echoed into the engine's report only. */
  label?: {
    pathName?: string;
    transmitterName?: string;
    receiverName?: string;
  };
}

/** ITU-R P.533's documented short/long-path validity ceiling. Predictions
 *  beyond this are not refused (the engine keeps computing and does not fail
 *  loudly), but are flagged -- see docs/CLAUDE.md "never hide uncertainty"
 *  and spike/engine-compare/FINDINGS.md #2 for the sibling engine's version
 *  of the same defect. */
export const P533_MAX_VALID_DISTANCE_KM = 10_000;

export interface CircuitGeometry {
  /** Great-circle path distance actually used for this prediction (short or
   *  long path per the request), km. Computed independently by this package
   *  (haversine), not merely copied from the engine's own report -- see
   *  `distanceMismatchKm` for the cross-check. */
  distanceKm: number;
  pathDirection: PathDirection;
  /** True if distanceKm exceeds P533_MAX_VALID_DISTANCE_KM. When true, every
   *  prediction in this result carries validityWarning and must not be
   *  presented to a user without it. */
  exceedsValidRange: boolean;
  /** Present only when exceedsValidRange is true. Plain-language, suitable for
   *  direct display next to the affected data. */
  validityWarning: string | undefined;
  /** |our independently-computed distance - the engine's own reported
   *  distance|, km. Large values would indicate a geometry bug (ours or the
   *  engine's); this is a self-consistency check, not user-facing. */
  distanceMismatchKm: number;
}

export interface DominantMode {
  /** Engine mode label, e.g. "1F2", "2E", "Sp" (scatter). Verbatim from the
   *  engine, trimmed of padding. */
  mode: string;
  elevationAngleDeg: number;
  delayMs: number;
  lossDb: number;
  propagationProbabilityPercent: number;
  virtualHeightKm: number;
  medianReceivedPowerDbW: number;
  receiverAntennaGainDbi: number;
  fieldStrengthDbuVm: number;
  basicMufMHz: number;
}

/** One (hour, frequency) prediction cell. */
export interface FrequencyHourPrediction {
  /** Calendar month, 1-12 (matches the request). */
  month: number;
  /** UTC hour, 0-23 (converted from the engine's internal 1-24 convention --
   *  see src/inputFile.ts / src/outputParser.ts for the mapping). */
  hourUtc: number;
  frequencyMHz: number;
  receiver: GeoPosition;
  /** Path distance as reported by the engine itself, km. */
  distanceKm: number;
  /** Basic (day) MUF for this hour, MHz. Present only if requested (always,
   *  via this package's default report format). */
  basicMufMHz: number | undefined;
  /** Operational MUF for this hour, MHz (basic MUF adjusted for the required
   *  reliability). */
  operationalMufMHz: number | undefined;
  /** Median path field strength, dB(1uV/m). */
  fieldStrengthDbuVm: number;
  /** Median received power, dBW. */
  medianReceivedPowerDbW: number;
  /** Median predicted SNR, dB, in requiredSnrBandwidthHz. */
  snrDb: number | undefined;
  /** SNR available at the requested reliability (requiredReliabilityPercentOfMonth), dB. */
  snrAtReliabilityDb: number;
  /** Overall circuit reliability without scatter modes considered, 0-1 (engine
   *  reports 0-100%; converted here -- see docs/08-domain-model.md: reliability
   *  is 0.0-1.0 and is NOT the same thing as HFKit's 0-100 "score"). */
  overallReliability: number;
  /** Overall circuit reliability with scatter modes considered, 0-1. */
  overallReliabilityWithScatter: number;
  /** Probability of scatter propagation being the dominant mode, 0-1. */
  scatterProbability: number;
  dominantMode: DominantMode | undefined;
}

export interface EngineMeta {
  ituRHFPropVersion: string | undefined;
  p533Version: string | undefined;
  p372Version: string | undefined;
  /** As reported by the engine; not parsed to a Date because it has no
   *  timezone and its accuracy depends on the host clock inside the sandboxed
   *  WASM runtime, which is not a guarantee we want to make. */
  preparedAtRaw: string | undefined;
}

export interface PredictionResult {
  request: PredictionRequest;
  circuit: CircuitGeometry;
  /** One entry per (requested hour x requested frequency) pair, in the order
   *  the engine emitted them (hour-major, frequency-minor). */
  predictions: FrequencyHourPrediction[];
  engine: EngineMeta;
}

export interface EngineTimings {
  /** WASM module compile + instantiate, once per HFEngine instance. */
  initMs: number;
  /** Writing this month's ITU data files into the WASM virtual filesystem.
   *  Zero on calls that reuse an already-loaded month. */
  dataLoadMs: number;
  /** The actual prediction run (write .in, callMain, read .out). */
  runMs: number;
}
