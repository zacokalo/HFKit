// Runs the browser tests against a freshly served copy of apps/web.
//
//   npm run build:web && npm run test:web
//
// Exits non-zero if any check fails, so it can gate a release even though it is
// not part of the hermetic CI run.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { serve, launch, SITE } from './harness.mjs';
import reachSpec from './reach.spec.mjs';
import popupSpec from './popup.spec.mjs';
import chartSpec from './chart.spec.mjs';
import stationSpec from './station.spec.mjs';
import spacewxSpec from './spacewx.spec.mjs';
import spaceSpec from './space.spec.mjs';

// Fail loudly on an unbuilt site rather than reporting a wall of confusing
// element-not-found errors.
for (const [rel, why] of [
  ['vendor/tokens.css', 'design tokens'],
  ['vendor/engine/browser.js', 'engine bundle'],
  ['data/geo/coastline.geojson', 'coastline'],
  ['data/space-weather.json', 'space weather snapshot'],
  ['data/itu', 'ITU coefficient data'],
]) {
  if (!existsSync(path.join(SITE, rel))) {
    console.error(`apps/web/${rel} is missing (${why}).`);
    console.error('Run `npm run build:web` first — these tests exercise the real engine.');
    process.exit(2);
  }
}

// Local install first; a global one second, since playwright is deliberately not
// a declared dependency (see README) and some environments preinstall it.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    const { execFileSync } = await import('node:child_process');
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    // Resolve the package entry point: ESM cannot import a bare directory.
    const entry = createRequire(path.join(root, '_')).resolve('playwright');
    const mod = await import(pathToFileURL(entry).href);
    // playwright is CommonJS, so a file-URL import lands its exports on .default
    chromium = mod.chromium ?? mod.default?.chromium;
    if (!chromium) throw new Error('resolved playwright but found no chromium export');
  } catch {
    console.error('playwright is not installed. `npm i -D playwright` (the browser itself');
    console.error('is already present if PLAYWRIGHT_BROWSERS_PATH is set).');
    process.exit(2);
  }
}

const { origin, close } = await serve();
const browser = await launch(chromium);
const failed = [];

for (const [name, spec] of [['reach map', reachSpec], ['map popups', popupSpec],
                            ['circuit chart', chartSpec],
                            ['station controls', stationSpec],
                            ['space weather', spacewxSpec],
                            ['space weather page', spaceSpec]]) {
  console.log(`\n${name}`);
  try {
    failed.push(...(await spec(browser, origin)));
  } catch (e) {
    console.log(`  FAIL  suite threw: ${e.message}`);
    failed.push(`${name}: ${e.message}`);
  }
}

await browser.close();
await close();

console.log(failed.length
  ? `\n${failed.length} check(s) failed:\n  - ${failed.join('\n  - ')}`
  : '\nall checks passed');
process.exit(failed.length ? 1 : 0);
