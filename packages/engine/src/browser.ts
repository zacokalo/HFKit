/**
 * Browser entry point.
 *
 * The main `index.ts` barrel re-exports `NodeFsDataProvider`, which statically
 * imports `node:fs/promises` and `node:path`. A browser cannot resolve those,
 * and a bundler would either fail or ship a shim, so browsers must import this
 * module instead of the barrel.
 *
 * Usage:
 *   <script src="/vendor/iturhfprop.js"></script>   <!-- defines global Module -->
 *   import { HFEngine, BrowserDataProvider, setModuleFactory } from '@hfkit/engine/browser';
 *   setModuleFactory(window.Module);
 *   const engine = await HFEngine.create({ dataProvider: new BrowserDataProvider('/data/itu') });
 */
export { HFEngine, type HFEngineOptions } from './engine.js';
export type { DataProvider, EngineDataFiles } from './dataProvider.js';
export { monthFileSuffix } from './dataProvider.js';
export { BrowserDataProvider } from './browserDataProvider.js';
export { setModuleFactory } from './wasmModule.js';
export { greatCircleDistanceKm, pathDistanceKm, EARTH_RADIUS_KM } from './geo.js';
export { HFEngineValidationError, validatePredictionRequest } from './validation.js';
export { P533_MAX_VALID_DISTANCE_KM } from './types.js';
export type * from './types.js';
