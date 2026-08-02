// Assembles the deployable site into apps/web/.
//
// Generated output (vendor/, data/) is gitignored: it is derived from the
// workspace packages plus the ITU data files, which are ~11 MB per month and
// belong on a CDN rather than in git.
//
// ITU data resolution, in order:
//   1. ITU_DATA_DIR  -- a local checkout of ITU-R-HF/ITURHFProp/Data
//   2. otherwise fetched from GitHub, so this works unchanged in CI
//      (Cloudflare Pages has no local checkout).
import { cp, mkdir, readdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const vendor = path.join(here, 'vendor');
const dataOut = path.join(here, 'data/itu');
const geoOut = path.join(here, 'data/geo');

const ITU_RAW =
  'https://raw.githubusercontent.com/ITU-R-Study-Group-3/ITU-R-HF/master/ITURHFProp/Data';

// Default: current month only. ITU_MONTHS=all publishes all twelve (~128 MB,
// still inside Cloudflare Pages' 10 GB storage and 25 MiB-per-file limits).
const months =
  process.env.ITU_MONTHS === 'all'
    ? Array.from({ length: 12 }, (_, i) => i + 1)
    : [new Date().getUTCMonth() + 1];

await mkdir(path.join(vendor, 'engine'), { recursive: true });
await mkdir(dataOut, { recursive: true });
await mkdir(geoOut, { recursive: true });

// --- workspace outputs ---
await cp(path.join(repo, 'packages/theme/dist/tokens.css'), path.join(vendor, 'tokens.css'));
for (const f of ['iturhfprop.js', 'iturhfprop.wasm']) {
  await cp(path.join(repo, 'packages/engine/vendor', f), path.join(vendor, f));
}
await cp(path.join(repo, 'packages/engine/dist'), path.join(vendor, 'engine'), { recursive: true });
await cp(path.join(repo, 'packages/theme/styleguide.html'), path.join(here, 'styleguide.html'));

// --- geodata (coastline, gazetteer) ---
// coverage-sample.json is deliberately NOT shipped: the reach map computes its
// own grid on-device now, so publishing an 838 KB precomputed one would cost
// every visitor bandwidth for data the page never reads.
for (const f of ['coastline.geojson', 'gazetteer-compact.json']) {
  const src = path.join(repo, 'packages/geodata/data', f);
  if (existsSync(src)) await cp(src, path.join(geoOut, f));
}

// --- space weather snapshot ---
// A static fallback for when the Worker is unreachable, over quota, or broken.
// Built from the same code the Worker runs, so it cannot drift from the thing
// it stands in for. A failure here must NOT fail the build: shipping a site
// with a stale-but-labelled snapshot beats shipping nothing, and the client
// degrades again to a stated default if the file is absent entirely.
try {
  const { buildBundle } = await import('@hfkit/spacewx');
  const bundle = await buildBundle();
  bundle.refreshedBy = 'build-snapshot';
  await writeFile(path.join(here, 'data/space-weather.json'), JSON.stringify(bundle));
  const bad = Object.entries(bundle.sources).filter(([, v]) => !v.ok);
  console.log(bad.length
    ? `space weather snapshot written, ${bad.length} source(s) unavailable: `
      + bad.map(([k, v]) => `${k} (${v.error})`).join(', ')
    : `space weather snapshot written: SSN ${bundle.solar?.ssn}, Kp ${bundle.geomag?.kp}`);
} catch (e) {
  console.warn(`space weather snapshot skipped: ${e.message}`);
  console.warn('the site will fall back to a stated placeholder until the Worker is reachable');
}

// --- ITU data ---
async function fetchTo(name, dest) {
  const url = `${ITU_RAW}/${encodeURIComponent(name)}`;
  process.stdout.write(`  fetching ${name} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`${name}: suspiciously small (${buf.length} B)`);
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1048576).toFixed(1)} MB`);
}

const ituDir = process.env.ITU_DATA_DIR;
const local = ituDir && existsSync(ituDir);
console.log(local ? `ITU data: local ${ituDir}` : 'ITU data: fetching from GitHub');

const needed = ['P1239-3 Decile Factors.txt'];
for (const m of months) {
  const mm = String(m).padStart(2, '0');
  needed.push(`ionos${mm}.bin`, `COEFF${mm}W.txt`);
}
for (const name of needed) {
  const dest = path.join(dataOut, name);
  if (local) await cp(path.join(ituDir, name), dest);
  else await fetchTo(name, dest);
}

// --- sanity: refuse to ship a build whose engine data is missing or truncated ---
for (const name of needed) {
  const s = await stat(path.join(dataOut, name));
  if (s.size < 1024) throw new Error(`ITU data ${name} is ${s.size} B — build would ship broken`);
}
const files = await readdir(dataOut);
console.log(`\nvendor/ assembled; data/itu/ has ${files.length} files for month(s) ${months.join(',')}`);
console.log('site ready to deploy from apps/web/');
