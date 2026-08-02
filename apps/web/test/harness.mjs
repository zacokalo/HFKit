// Shared plumbing for the browser tests.
//
// These are end-to-end tests against the real engine, so they are deliberately
// NOT part of the hermetic CI run: they need a built site (vendor/ and ~11 MB of
// ITU data) and a real browser. See test/README.md.

import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json',
  '.wasm': 'application/wasm', '.txt': 'text/plain', '.bin': 'application/octet-stream',
};

/** Static server for apps/web on an ephemeral port, so a stale process from an
 *  earlier run cannot make the suite pass or fail for the wrong reason. */
export async function serve() {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(SITE, rel);
    // Refuse anything that climbs out of the site root.
    if (!file.startsWith(SITE) || !existsSync(file) || !(await stat(file)).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/** Launch Chromium. Prefers Playwright's own resolution; falls back to the
 *  pre-installed browser some sandboxes provide at PLAYWRIGHT_BROWSERS_PATH. */
export async function launch(chromium) {
  const args = ['--no-sandbox'];
  try {
    return await chromium.launch({ args });
  } catch (first) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (root) {
      const { globSync } = await import('node:fs');
      const hits = globSync
        ? globSync(path.join(root, 'chromium*', 'chrome-linux', 'chrome'))
        : [];
      if (hits.length) return chromium.launch({ executablePath: hits[0], args });
    }
    throw first;
  }
}

export function reporter(suite) {
  const failures = [];
  return {
    check(ok, label, extra = '') {
      if (!ok) failures.push(label);
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(42)} ${extra}`);
      return ok;
    },
    note(msg) { console.log(`  --    ${msg}`); },
    get failures() { return failures; },
    get name() { return suite; },
  };
}

/** Collects the errors a passing-looking page can still be producing. */
export function watchErrors(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // A missing favicon is the browser asking, not the page failing.
    if (m.type() === 'error' && !m.text().includes('favicon')) errs.push('console: ' + m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) errs.push(`${r.status()} ${r.url()}`);
  });
  return errs;
}

// --- canvas helpers -------------------------------------------------------
export const CANVAS_W = 1440, CANVAS_H = 648;

/** Every 53rd pixel as flat RGB. Small enough to ship to Node, which lets a
 *  baseline survive a page reload — where an in-page one would be lost. */
export const sample = (page) => page.evaluate(() => {
  const c = document.getElementById('cv');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const out = [];
  for (let i = 0; i < d.length; i += 4 * 53) out.push(d[i], d[i + 1], d[i + 2]);
  return out;
});

/** Fraction of sampled pixels that differ from a baseline. */
export function coverage(now, base) {
  let diff = 0;
  for (let i = 0; i < now.length; i += 3)
    if (Math.abs(now[i] - base[i]) + Math.abs(now[i + 1] - base[i + 1])
      + Math.abs(now[i + 2] - base[i + 2]) > 24) diff++;
  return diff / (now.length / 3);
}

export async function canvasRect(page) {
  return page.evaluate(() => {
    const b = document.getElementById('cv').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
}

/** Canvas coordinates -> viewport coordinates. */
export async function atCanvas(page, cx, cy) {
  const r = await canvasRect(page);
  return [r.x + cx * (r.w / CANVAS_W), r.y + cy * (r.h / CANVAS_H)];
}
export const clickCanvas = async (page, cx, cy) =>
  page.mouse.click(...await atCanvas(page, cx, cy));
export const hoverCanvas = async (page, cx, cy) =>
  page.mouse.move(...await atCanvas(page, cx, cy));

/** Waits for a run to actually start before waiting for it to finish. Checking
 *  only for "finished" passes instantly, because the panel is still hidden while
 *  generate() awaits the cache lookup. */
export async function runToCompletion(page, timeout = 240000) {
  await page.waitForSelector('#run:not([hidden])', { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('run').hidden, null, { timeout });
}
