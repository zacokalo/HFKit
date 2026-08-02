// Reach map: first visit, progressive computation, view controls, persistence.

import {
  reporter, watchErrors, sample, coverage,
} from './harness.mjs';

export default async function run(browser, origin) {
  const t = reporter('reach map');
  const ctx = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: -33.87, longitude: 151.21 },   // Sydney
    viewport: { width: 1400, height: 1000 },
  });
  const page = await ctx.newPage();
  const errs = watchErrors(page);

  // --- a fresh visitor gets a map and a prompt, and nothing is computed ---
  await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.getElementById('hint').hidden, null, { timeout: 20000 });
  t.check(await page.isVisible('#hint'), 'fresh visit shows the prompt',
    await page.textContent('#hinttitle'));
  t.check((await page.textContent('#txnow')).trim() === 'not set', 'no transmitter set');
  t.check(await page.getAttribute('#go', 'disabled') !== null, 'Generate disabled with no transmitter');

  // The blank map is blank of *data*, not of the world: coastline and graticule
  // are still drawn, which is what makes it read as a map rather than a failure.
  const ink = await page.evaluate(() => {
    const c = document.getElementById('cv');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 37) if (d[i + 3] > 0) n++;
    return n;
  });
  t.check(ink > 0, 'blank map still draws the world', `${ink} sampled px`);

  // --- geolocation sets the transmitter ---
  await page.click('#hintloc');
  await page.waitForFunction(
    () => document.getElementById('txnow').textContent.includes('My location'),
    null, { timeout: 15000 });
  t.check(true, 'geolocation sets the transmitter', await page.textContent('#txnow'));
  t.check((await page.textContent('#go')).includes('≈'), 'Generate estimates its own cost',
    await page.textContent('#go'));

  // --- the map fills in while the run proceeds ---
  await page.selectOption('#detail', '24');
  const blank = await sample(page);
  await page.click('#go');
  await page.waitForSelector('#run:not([hidden])', { timeout: 20000 });
  t.check(await page.isVisible('.rl'), 'radio loader visible while computing');

  const seen = [];
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 240000 && !done) {
    seen.push({ t: ((Date.now() - t0) / 1000).toFixed(1),
                cov: coverage(await sample(page), blank) });
    done = await page.evaluate(() => document.getElementById('run').hidden);
    if (!done) await page.waitForTimeout(700);
  }
  const last = seen[seen.length - 1].cov;
  t.check(seen[0].cov < 0.02, 'map starts empty of data', `${(seen[0].cov * 100).toFixed(1)}%`);
  // The point of the progressive render: at least one frame is partly filled.
  // A single jump from 0% to done would mean the user watched a spinner.
  t.check(seen.some((s) => s.cov > 0.05 && s.cov < last - 0.05),
    'map fills in progressively, not all at once',
    seen.slice(0, 8).map((s) => `${s.t}s:${(s.cov * 100).toFixed(0)}%`).join(' '));
  t.check(done, 'run completes and the status panel clears',
    `${seen[seen.length - 1].t}s, ${(last * 100).toFixed(0)}% covered`);
  t.check((await page.textContent('#lg')).length > 0, 'legend appears once data exists');
  t.check(!(await page.textContent('#explain')).includes('Nothing computed'),
    'footer explains the colour scale');

  // --- night shading must darken in whatever theme is active ---
  const luma = () => page.evaluate(() => {
    const c = document.getElementById('cv');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 11) { sum += d[i] + d[i + 1] + d[i + 2]; n++; }
    return sum / n / 3;
  });
  const setNight = async (v) => {
    await page.evaluate((val) => {
      const el = document.getElementById('night');
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await page.waitForTimeout(250);
  };
  await setNight('0');
  const lum0 = await luma();
  await setNight('100');
  const lum100 = await luma();
  // Regression guard: an earlier version shaded with a surface token, which is
  // near-white in the light theme and *brightened* the night side.
  t.check(lum100 < lum0 - 2, 'night shading darkens as opacity rises',
    `0%: ${lum0.toFixed(1)} → 100%: ${lum100.toFixed(1)}`);
  await setNight('70');

  // --- receivers ---
  await page.fill('#rx', 'Manila');
  await page.waitForSelector('#rxsugg div', { timeout: 8000 });
  await page.click('#rxsugg div');
  await page.waitForTimeout(300);
  t.check((await page.$$eval('#tbl tbody tr', (r) => r.length)) === 1,
    'adding a receiver adds a circuit row');
  const cells = await page.$$eval('#tbl tbody tr td', (c) => c.map((x) => x.textContent.trim()));
  t.check(cells.some((c) => /km$/.test(c)), 'circuit shows a distance',
    cells.slice(0, 4).join(' | '));

  // --- a return visit restores, and does not recompute ---
  const was = await page.textContent('#txnow');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  t.check((await page.textContent('#txnow')) === was, 'transmitter restored on reload', was);
  t.check(await page.isHidden('#hint'), 'cached grid restored, no prompt');
  t.check(await page.isHidden('#run'), 'nothing recomputed on load');
  t.check((await page.$$eval('#tbl tbody tr', (r) => r.length)) === 1, 'receivers restored');
  const restored = coverage(await sample(page), blank);
  t.check(restored > 0.1, 'restored map has data on it', `${(restored * 100).toFixed(0)}%`);

  // --- a new transmitter invalidates the old grid ---
  await page.fill('#tx', 'Reykjav');
  await page.waitForSelector('#txsugg div', { timeout: 8000 });
  await page.click('#txsugg div');
  await page.waitForTimeout(500);
  t.check(!(await page.isHidden('#hint')), 'new transmitter prompts to recompute',
    await page.textContent('#hinttitle'));
  t.check((await page.textContent('#explain')).includes('Nothing computed'),
    'stale grid discarded with the old transmitter');

  t.check(errs.length === 0, 'no page errors', errs.slice(0, 3).join('; '));
  await ctx.close();
  return t.failures;
}
