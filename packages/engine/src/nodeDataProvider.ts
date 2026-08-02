// Node filesystem DataProvider. Reads the three needed files per month from
// a local directory laid out like the upstream repo's Data/ directory (this
// is exactly what spike/engine-wasm/run.js does, minus the WASM staging).
//
// This package never bundles or vendors the actual ~11 MB/month data files
// (see CLAUDE.md: "Do NOT copy the 10.68 MB data files into the package or
// the repo") -- callers point this at wherever their pipeline/cache put them.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DataProvider, EngineDataFiles } from './dataProvider.js';
import { monthFileSuffix } from './dataProvider.js';

export interface NodeFsDataProviderOptions {
  /** Directory containing "P1239-3 Decile Factors.txt", "ionosNN.bin" and
   *  "COEFFNNW.txt" (upstream's ITURHFProp/Data layout). */
  dataDir: string;
}

export class NodeFsDataProvider implements DataProvider {
  private readonly dataDir: string;

  constructor(options: NodeFsDataProviderOptions) {
    this.dataDir = options.dataDir;
  }

  async getMonthData(month: number): Promise<EngineDataFiles> {
    const mm = monthFileSuffix(month);
    const [decileFactors, ionosphere, noiseCoefficients] = await Promise.all([
      this.readOrThrow('P1239-3 Decile Factors.txt'),
      this.readOrThrow(`ionos${mm}.bin`),
      this.readOrThrow(`COEFF${mm}W.txt`),
    ]);
    return { decileFactors, ionosphere, noiseCoefficients };
  }

  private async readOrThrow(fileName: string): Promise<Uint8Array> {
    const fullPath = join(this.dataDir, fileName);
    try {
      const buf = await readFile(fullPath);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `NodeFsDataProvider: could not read "${fullPath}" (${cause}). Expected the upstream ITU-R-HF ` +
          `ITURHFProp/Data/ layout -- see @hfkit/engine's README for what this directory must contain.`,
      );
    }
  }
}
