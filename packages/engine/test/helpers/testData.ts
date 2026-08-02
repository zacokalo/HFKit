// Locates a real ITU-R-HF data directory for tests that need to actually run
// the WASM engine (golden regression test, validity-warning test, timing
// measurement). Those files are ~11 MB/month and are deliberately NOT
// committed to this repo (see CLAUDE.md and README.md "Known limitations").
//
// Point HFKIT_ITU_DATA_DIR at a local checkout of ITU-R-HF's
// ITURHFProp/Data/ directory to run these tests. When unset (or the expected
// file isn't found there), the affected tests report as skipped rather than
// failed -- this keeps `vitest run` hermetic and green in an environment
// (e.g. CI) that hasn't provisioned the data, per CLAUDE.md's "CI is
// hermetic (no network, fixtures only)".
//
// Tests that don't touch the WASM engine at all (input-file generator,
// output parser, validation) never depend on this and always run.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function findItuDataDir(): string | undefined {
  const candidate = process.env.HFKIT_ITU_DATA_DIR;
  if (candidate && existsSync(join(candidate, 'P1239-3 Decile Factors.txt'))) {
    return candidate;
  }
  return undefined;
}
