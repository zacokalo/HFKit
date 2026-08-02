// Space weather reaching the map — and, more importantly, what happens when it
// does not. The fallback chain is the whole point of this feature's design, so
// each tier is exercised rather than assumed.

import { reporter, watchErrors, dismissHint, sample, coverage } from './harness.mjs';

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

  // --- the aurora overlay ---
  // Off by default and lazily loaded: 40 KB nobody asked for is 40 KB wasted.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { globalThis.__HFKIT_SPACEWX_URL__ = null; });
    let auroraFetches = 0;
    page.on('request', (r) => { if (r.url().includes('aurora.json')) auroraFetches++; });
    await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
    await dismissHint(page);
    await page.waitForTimeout(500);

    t.check((await page.textContent('#auroraval')).trim() === 'off',
      'aurora overlay starts off', await page.textContent('#auroraval'));
    t.check(auroraFetches === 0, 'and its 40 KB is not fetched until asked for',
      `${auroraFetches} request(s)`);

    const before = await sample(page);
    const setAurora = async (v) => {
      await page.evaluate((val) => {
        const e = document.getElementById('aurora');
        e.value = val;
        e.dispatchEvent(new Event('input', { bubbles: true }));
      }, v);
    };
    await setAurora('70');
    await page.waitForFunction(
      () => !document.getElementById('auroraval').textContent.includes('loading'),
      null, { timeout: 30000 });
    await page.waitForTimeout(600);

    t.check(auroraFetches === 1, 'switching it on fetches it exactly once',
      `${auroraFetches} request(s)`);
    t.check((await page.textContent('#auroraval')).includes('70'),
      'and the label reports the opacity', await page.textContent('#auroraval'));

    const painted = coverage(await sample(page), before);
    t.check(painted > 0.02, 'the overlay actually paints on the map',
      `${(painted * 100).toFixed(1)}% of sampled pixels changed`);
    t.check((await page.textContent('#lg')).includes('aurora'),
      'and explains itself in the legend', await page.textContent('#lg'));

    // The artifact check, against the live grid rather than a fixture: OVATION
    // publishes non-zero cells at the equator, and there is no aurora there.
    //
    // Tested as a *difference* rather than by colour. An absolute "is anything
    // yellow here" test flagged 26 pixels of the terminator, which is drawn in
    // --hf-status-fair-fill and passes any plausible aurora colour filter.
    // Diffing overlay-on against overlay-off isolates what the overlay drew.
    const tropicalBand = () => page.evaluate(() => {
      const c = document.getElementById('cv');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const y0 = Math.round(c.height * 0.39), y1 = Math.round(c.height * 0.61);
      const out = [];
      for (let y = y0; y < y1; y += 2) {
        for (let x = 0; x < c.width; x += 5) {
          const i = (y * c.width + x) * 4;
          out.push(d[i], d[i + 1], d[i + 2]);
        }
      }
      return out;
    });
    const tropicsOn = await tropicalBand();
    await setAurora('0');
    await page.waitForTimeout(400);
    const tropicsOff = await tropicalBand();
    let changed = 0;
    for (let i = 0; i < tropicsOn.length; i += 3) {
      if (Math.abs(tropicsOn[i] - tropicsOff[i])
        + Math.abs(tropicsOn[i + 1] - tropicsOff[i + 1])
        + Math.abs(tropicsOn[i + 2] - tropicsOff[i + 2]) > 12) changed++;
    }
    t.check(changed === 0, 'the overlay draws nothing in the tropics',
      `${changed} of ${tropicsOn.length / 3} sampled px changed`);

    t.check(coverage(await sample(page), before) < 0.01, 'turning it off removes it');
    t.check((await page.textContent('#auroraval')).trim() === 'off', 'and says off');
    await ctx.close();
  }

  return t.failures;
}