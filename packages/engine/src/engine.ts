// Public runtime wrapper: HFEngine.create({ dataProvider }) -> engine.predict(request).

import type { DataProvider } from './dataProvider.js';
import { pathDistanceKm } from './geo.js';
import { buildInputFile } from './inputFile.js';
import { parseOutputFile, REPORT_FORMAT_COLUMNS } from './outputParser.js';
import {
  P533_MAX_VALID_DISTANCE_KM,
  type CircuitGeometry,
  type EngineTimings,
  type PredictionRequest,
  type PredictionResult,
} from './types.js';
import { validatePredictionRequest } from './validation.js';
import { WasmRuntime } from './wasmModule.js';

export interface HFEngineOptions {
  dataProvider: DataProvider;
}

function buildCircuitGeometry(request: PredictionRequest, engineReportedDistanceKm: number): CircuitGeometry {
  const pathDirection = request.pathDirection ?? 'short';
  const distanceKm = pathDistanceKm(request.transmitter, request.receiver, pathDirection);
  const exceedsValidRange = distanceKm > P533_MAX_VALID_DISTANCE_KM;
  return {
    distanceKm,
    pathDirection,
    exceedsValidRange,
    validityWarning: exceedsValidRange
      ? `Path distance is ${distanceKm.toFixed(0)} km, beyond ITU-R P.533's documented valid range of ` +
        `${P533_MAX_VALID_DISTANCE_KM.toLocaleString()} km. The engine does not refuse to compute long paths -- ` +
        `it silently keeps producing numbers outside its validated regime (see spike/engine-compare/FINDINGS.md ` +
        `#2 for the same defect in a sibling engine). Treat every value in this result as low-confidence.`
      : undefined,
    distanceMismatchKm: Math.abs(distanceKm - engineReportedDistanceKm),
  };
}

/**
 * Owns one reusable WASM engine instance. Construct via `HFEngine.create()`,
 * not directly, so the WASM module is guaranteed compiled/instantiated
 * before the first `predict()` call.
 */
export class HFEngine {
  private readonly runtime: WasmRuntime;
  private lastTimings: EngineTimings = { initMs: 0, dataLoadMs: 0, runMs: 0 };

  private constructor(runtime: WasmRuntime) {
    this.runtime = runtime;
  }

  static async create(options: HFEngineOptions): Promise<HFEngine> {
    const runtime = new WasmRuntime(options.dataProvider);
    await runtime.init();
    const engine = new HFEngine(runtime);
    engine.lastTimings = { initMs: runtime.initMs, dataLoadMs: 0, runMs: 0 };
    return engine;
  }

  /** Timings from the most recently completed operation (init or predict). */
  get timings(): EngineTimings {
    return this.lastTimings;
  }

  async predict(request: PredictionRequest): Promise<PredictionResult> {
    validatePredictionRequest(request);
    const inputText = buildInputFile(request);
    const { outputText, dataLoadMs, runMs } = await this.runtime.run(inputText, request.time.month);
    // fallbackColumns: this package's HFEngine reuses one WASM instance
    // across calls (see wasmModule.ts), which trips a known upstream defect
    // where only the FIRST call on an instance gets a report header/Data
    // Format section (see outputParser.ts REPORT_FORMAT_COLUMNS docstring
    // for the full root-cause citation and why this is safe). inputFile.ts
    // always requests exactly the REPORT_FORMAT column set, so this fallback
    // column list is always correct for output this class produces.
    const parsed = parseOutputFile(outputText, { fallbackColumns: REPORT_FORMAT_COLUMNS });

    if (parsed.predictions.length === 0) {
      // parseOutputFile already throws on zero rows; this is an extra guard
      // in case that invariant is ever loosened without updating this call site.
      throw new Error('HFEngine.predict: parsed output contained zero predictions');
    }

    const engineReportedDistanceKm = parsed.predictions[0]?.distanceKm;
    if (engineReportedDistanceKm === undefined) {
      throw new Error('HFEngine.predict: could not determine engine-reported distance from output');
    }
    const circuit = buildCircuitGeometry(request, engineReportedDistanceKm);

    this.lastTimings = { initMs: this.runtime.initMs, dataLoadMs, runMs };

    return {
      request,
      circuit,
      predictions: parsed.predictions,
      engine: parsed.engine,
    };
  }
}
