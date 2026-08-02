// Space weather reaching the map — and, more importantly, what happens when it
// does not. The fallback chain is the whole point of this feature's design, so
// each tier is exercised rather than assumed.

import { reporter, watchErrors, dismissHint } from './harness.mjs';

export default async function run(browser, origin) {
  const t = reporter('space weather');

  // Each case gets a fresh context: localStorage is one of the tiers.
  const open = async ({ workerUrl, blockSnapshot = false, seedCache = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    await page.addInitScript((u) => { globalThis.__HFKIT_SPACEWX_URL__ = u; }, workerUrl ?? null);
    if (seedCache) {
      await page.addInitScript((b) => {
        localStorage.setItem('hfkit.spacewx.v1', JSON.stringify(b));
      }, seedCache);
    }
    if (blockSnapshot) await page.route('**/data/space-weather.json', (r) => r.abort());
    const errs = watchErrors(page);
    await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
    await dismissHint(page);
    await page.waitForFunction(
      () => document.getElementById('swline').textContent.length > 0, null, { timeout: 20000 });
    return { ctx, page, errs };
  };

  const line = (page) => page.textContent('#swline');

  // --- the shipped snapshot, which is the live path with no Worker deployed ---
  {
    const { ctx, page, errs } = await open();
    const text = await line(page);
    t.check(/Effective SSN \d+/.test(text), 'snapshot supplies a real sunspot number', text);
    t.check(text.includes('published with this build'), 'and says where it came from');
    t.check(!text.includes('placeholder'), 'and does not claim to be a placeholder');
    const ssn = Number(text.match(/Effective SSN (\d+)/)?.[1]);
    t.check(ssn % 5 === 0, 'the value handed to the engine is quantised', `SSN ${ssn}`);
    t.check(ssn !== 60, 'it is no longer the old hardcoded 60', `SSN ${ssn}`);
    t.check(errs.length === 0, 'no page errors on the snapshot path', errs.slice(0, 2).join('; '));
    await ctx.close();
  }

  // --- a live Worker takes precedence, and is labelled as live ---
  {
    const fake = {
      schema: 1,
      generatedAt: new Date(Date.now() - 120_000).toISOString(),
      solar: { ssn: 142.7, ssn6h: 145.0, sfi: 190.2, engineSsn: 145,
               observedAt: new Date(Date.now() - 180_000).toISOString() },
      geomag: { kp: 4.3, observedAt: new Date().toISOString(), forecast: [] },
      flux: { f107: 190, observedAt: new Date().toISOString() },
      alerts: [], sources: {}, degraded: false,
    };
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    await page.route('https://spacewx.test/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake) }));
    await page.addInitScript(() => {
      globalThis.__HFKIT_SPACEWX_URL__ = 'https://spacewx.test/space-weather.json';
    });
    await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => document.getElementById('swline').textContent.length > 0, null, { timeout: 20000 });
    const text = await page.textContent('#swline');
    t.check(text.includes('145'), 'live bundle wins over the snapshot', text);
    t.check(text.includes('live'), 'and is labelled live');
    t.check(/just now|min ago/.test(text), 'and carries its age', text);
    // The device cache is the third tier; a live fetch must fill it.
    const cached = await page.evaluate(() => localStorage.getItem('hfkit.spacewx.v1'));
    t.check(cached !== null && JSON.parse(cached).solar.engineSsn === 145,
      'a live fetch seeds the device cache');
    await ctx.close();
  }

  // --- a broken Worker falls through rather than failing ---
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    // The exact failure this project cares about: 200 carrying an error page.
    await page.route('https://spacewx.test/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html>nope' }));
    await page.addInitScript(() => {
      globalThis.__HFKIT_SPACEWX_URL__ = 'https://spacewx.test/space-weather.json';
    });
    await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => document.getElementById('swline').textContent.length > 0, null, { timeout: 20000 });
    const text = await page.textContent('#swline');
    t.check(text.includes('published with this build'),
      'HTML-with-200 from the Worker falls through to the snapshot', text);
    await ctx.close();
  }

  // --- device cache covers a Worker outage on a stale build ---
  {
    const seeded = {
      schema: 1,
      generatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
      solar: { ssn: 77.2, sfi: 110, engineSsn: 75, observedAt: new Date().toISOString() },
      geomag: null, flux: null, alerts: [], sources: {}, degraded: true,
    };
    const { ctx, page } = await open({ blockSnapshot: true, seedCache: seeded });
    const text = await line(page);
    t.check(text.includes('75'), 'device cache is used when nothing else is reachable', text);
    t.check(text.includes('last seen on this device'), 'and says so plainly');
    await ctx.close();
  }

  // --- nothing at all: a stated placeholder, never a silent default ---
  {
    const { ctx, page } = await open({ blockSnapshot: true });
    const text = await line(page);
    t.check(text.includes('placeholder'), 'with no source at all it says placeholder', text);
    t.check(text.includes('60'), 'and names the value it fell back to');
    t.check(/do not reflect today/.test(text),
      'and states the consequence rather than just the fact');
    await ctx.close();
  }

  // --- the number actually reaches the engine, via the cache key ---
  {
    const { ctx, page } = await open();
    await page.fill('#tx', 'Sydney');
    await page.waitForSelector('#txsugg div', { timeout: 8000 });
    await page.click('#txsugg div');
    await page.waitForTimeout(300);
    await page.selectOption('#detail', '24');
    await page.click('#go');
    await page.waitForSelector('#run:not([hidden])', { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('run').hidden, null,
      { timeout: 240000 });
    const keys = await page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('hfkit', 1);
      r.onsuccess = () => {
        const db = r.result;
        const g = db.transaction('reach-grids', 'readonly').objectStore('reach-grids').getAllKeys();
        g.onsuccess = () => res(g.result.map(String));
      };
      r.onerror = () => res([]);
    }));
    const ssn = Number((await line(page)).match(/Effective SSN (\d+)/)?.[1]);
    t.check(keys.some((k) => k.includes(`|s${ssn}|`)),
      'the grid was computed at the live SSN, not the placeholder',
      `${keys[0]} vs s${ssn}`);
    await ctx.close();
  }

  return t.failures;
}
