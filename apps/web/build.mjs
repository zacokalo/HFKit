// Assembles apps/web/vendor/ and apps/web/data/itu/ from the workspace
// packages and the ITU source tree. Both directories are gitignored: they are
// generated artifacts, and the ITU ionosphere files are ~10.7 MB per month.
//
// ITU_DATA_DIR must point at a checkout of
// github.com/ITU-R-Study-Group-3/ITU-R-HF -> ITURHFProp/Data.
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const vendor = path.join(here, 'vendor');
const dataOut = path.join(here, 'data/itu');

const ituDir = process.env.ITU_DATA_DIR;
if (!ituDir || !existsSync(ituDir)) {
  console.error('ITU_DATA_DIR is not set or does not exist.\n' +
    'Point it at ITURHFProp/Data from github.com/ITU-R-Study-Group-3/ITU-R-HF.');
  process.exit(1);
}

await mkdir(path.join(vendor, 'engine'), { recursive: true });
await mkdir(dataOut, { recursive: true });

await cp(path.join(repo, 'packages/theme/dist/tokens.css'), path.join(vendor, 'tokens.css'));
for (const f of ['iturhfprop.js', 'iturhfprop.wasm']) {
  await cp(path.join(repo, 'packages/engine/vendor', f), path.join(vendor, f));
}
await cp(path.join(repo, 'packages/engine/dist'), path.join(vendor, 'engine'), { recursive: true });

// Only the months we intend to serve. Default: current month. Set
// ITU_MONTHS=all to publish all twelve (~128 MB, still well inside Cloudflare
// Pages' 10 GB storage and 25 MiB-per-file limits).
const months = process.env.ITU_MONTHS === 'all'
  ? Array.from({ length: 12 }, (_, i) => i + 1)
  : [new Date().getUTCMonth() + 1];

await cp(path.join(ituDir, 'P1239-3 Decile Factors.txt'),
         path.join(dataOut, 'P1239-3 Decile Factors.txt'));
for (const m of months) {
  const mm = String(m).padStart(2, '0');
  await cp(path.join(ituDir, `ionos${mm}.bin`), path.join(dataOut, `ionos${mm}.bin`));
  await cp(path.join(ituDir, `COEFF${mm}W.txt`), path.join(dataOut, `COEFF${mm}W.txt`));
}

const files = await readdir(dataOut);
console.log(`vendor/ assembled; data/itu/ has ${files.length} files for month(s) ${months.join(',')}`);
