// Loads and drives the vendored Emscripten module (vendor/iturhfprop.js +
// vendor/iturhfprop.wasm), copied unmodified from the Phase 0 spike
// (spike/engine-wasm/artifact/). See vendor/package.json for why
// createRequire is needed here: that glue file is CommonJS
// ("module.exports = Module"), vendored into an ESM package.
//
// IMPORTANT KNOWN LIMITATION (see README "Known limitations"): the vendored
// artifact was built with `-sENVIRONMENT=node` (spike/engine-wasm/build-wasm.sh
// line ~70), which hardcodes `ENVIRONMENT_IS_NODE = true` and unconditionally
// `require("node:fs")`s inside the glue. That means this loader -- and
// therefore this package as shipped -- only runs under Node today, despite
// the wrapper API being designed to also work in a browser. A browser build
// needs Phase 0's WASM artifact rebuilt with `-sENVIRONMENT=web` (or
// `web,worker`) and swapped in here; nothing in this file's *interface*
// would need to change, but the vendored artifact itself would.

import { createRequire } from 'node:module';

import type { DataProvider } from './dataProvider.js';
import { monthFileSuffix } from './dataProvider.js';

interface EmscriptenFS {
  mkdir(path: string): void;
  chdir(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
}

interface EmscriptenModule {
  FS: EmscriptenFS;
  callMain(args: string[]): number;
}

type ModuleFactory = (moduleArg?: Record<string, unknown>) => Promise<EmscriptenModule>;

let cachedFactory: ModuleFactory | undefined;

function loadFactory(): ModuleFactory {
  if (cachedFactory === undefined) {
    // createRequire, not a static/dynamic `import`, because the vendored
    // glue is CommonJS and does not have an ESM-compatible export shape
    // (`module.exports = Module` with no named exports Node's CJS/ESM
    // interop can reliably pick up as a default export in every resolver
    // configuration). Explicit is more robust here than relying on interop.
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedFactory = require('../vendor/iturhfprop.js') as ModuleFactory;
  }
  return cachedFactory;
}

function now(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

const WORK_BIN_DIR = '/work/Bin';
const WORK_DATA_DIR = '/work/Data';
const IN_FILE_NAME = 'input.in';
const OUT_FILE_NAME = 'output.out';

/**
 * Owns one instantiated WASM module instance and its virtual filesystem, so
 * repeated predictions reuse the ~6-7 ms compile+instantiate cost instead of
 * paying it per call. Also caches which month's data files are currently
 * staged in the virtual filesystem, so repeated predictions for the same
 * month skip the ~11 MB / ~13 ms re-write too.
 */
export class WasmRuntime {
  private modulePromise: Promise<EmscriptenModule> | undefined;
  private loadedMonth: number | undefined;
  private lastInitMs = 0;
  private readonly dataProvider: DataProvider;

  constructor(dataProvider: DataProvider) {
    this.dataProvider = dataProvider;
  }

  /** Compile + instantiate the module if not already done. Idempotent. */
  async init(): Promise<void> {
    await this.getModule();
  }

  /** Cold-init time of the most recent (or only) module instantiation, ms. */
  get initMs(): number {
    return this.lastInitMs;
  }

  private async getModule(): Promise<EmscriptenModule> {
    if (this.modulePromise === undefined) {
      const factory = loadFactory();
      const t0 = now();
      this.modulePromise = factory().then((mod) => {
        this.lastInitMs = now() - t0;
        mod.FS.mkdir('/work');
        mod.FS.mkdir(WORK_BIN_DIR);
        mod.FS.mkdir(WORK_DATA_DIR);
        mod.FS.chdir(WORK_BIN_DIR);
        return mod;
      });
    }
    return this.modulePromise;
  }

  private async ensureMonthData(month: number): Promise<number> {
    if (this.loadedMonth === month) return 0;
    const mod = await this.getModule();
    const t0 = now();
    const files = await this.dataProvider.getMonthData(month);
    const mm = monthFileSuffix(month);
    mod.FS.writeFile(`${WORK_DATA_DIR}/P1239-3 Decile Factors.txt`, files.decileFactors);
    mod.FS.writeFile(`${WORK_DATA_DIR}/ionos${mm}.bin`, files.ionosphere);
    mod.FS.writeFile(`${WORK_DATA_DIR}/COEFF${mm}W.txt`, files.noiseCoefficients);
    this.loadedMonth = month;
    return now() - t0;
  }

  /**
   * Runs one ITURHFProp invocation: stages `inputText` as the .in file,
   * ensures the requested month's data is staged, invokes main(), and
   * returns the raw .out text plus timings. Throws if the engine exits
   * non-zero or produces no output file -- a missing/short-circuited output
   * is never treated as an empty-but-valid result.
   */
  async run(inputText: string, month: number): Promise<{ outputText: string; dataLoadMs: number; runMs: number }> {
    const mod = await this.getModule();
    const dataLoadMs = await this.ensureMonthData(month);

    mod.FS.writeFile(`${WORK_BIN_DIR}/${IN_FILE_NAME}`, new TextEncoder().encode(inputText));
    try {
      mod.FS.unlink(`${WORK_BIN_DIR}/${OUT_FILE_NAME}`);
    } catch {
      // No previous output file to remove -- expected on the first run.
    }

    const t0 = now();
    const exitCode = mod.callMain([IN_FILE_NAME, OUT_FILE_NAME]);
    const runMs = now() - t0;

    let outBytes: Uint8Array;
    try {
      outBytes = mod.FS.readFile(`${WORK_BIN_DIR}/${OUT_FILE_NAME}`);
    } catch {
      throw new Error(
        `ITURHFProp produced no output file (engine exit code ${exitCode}). This usually means the engine's ` +
          `own input validation rejected something this package's pre-flight validation did not catch.`,
      );
    }
    if (exitCode !== 0) {
      throw new Error(
        `ITURHFProp exited with non-zero code ${exitCode}. An output file was present but a non-zero exit is ` +
          `treated as failure rather than trusting partial output (never present possibly-wrong data confidently).`,
      );
    }

    return { outputText: new TextDecoder().decode(outBytes), dataLoadMs, runMs };
  }
}
