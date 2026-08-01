export { HFEngine, type HFEngineOptions } from './engine.js';

export type { DataProvider, EngineDataFiles } from './dataProvider.js';
export { monthFileSuffix } from './dataProvider.js';

export { NodeFsDataProvider, type NodeFsDataProviderOptions } from './nodeDataProvider.js';
export { BrowserDataProvider } from './browserDataProvider.js';
// Browsers must inject the Emscripten factory: the vendored glue is CommonJS
// and is loaded via a classic <script> tag, which defines a global `Module`.
export { setModuleFactory } from './wasmModule.js';

export { greatCircleDistanceKm, pathDistanceKm, EARTH_RADIUS_KM } from './geo.js';

export { HFEngineValidationError, validatePredictionRequest } from './validation.js';

export {
  HFEngineOutputParseError,
  parseOutputFile,
  REPORT_FORMAT_COLUMNS,
  type ParsedOutputFile,
  type ParseOutputFileOptions,
  type ResolvedColumn,
} from './outputParser.js';

export type {
  AntennaSpec,
  CircuitGeometry,
  DominantMode,
  EngineMeta,
  EngineTimings,
  FrequencyHourPrediction,
  GeoPosition,
  ManMadeNoiseEnvironment,
  Modulation,
  PathDirection,
  PredictionRequest,
  PredictionResult,
  PredictionTime,
  SolarDriver,
} from './types.js';
export { P533_MAX_VALID_DISTANCE_KM } from './types.js';
