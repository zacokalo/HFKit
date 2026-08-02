// The station controls: power in watts and transmit antenna as separate inputs,
// applied to an already-computed grid as a flat offset.

import {
  reporter, watchErrors, clickCanvas, dismissHint, runToCompletion,
} from './harness.mjs';

export default async function run(browser, origin) {
  const t = reporter('station controls');
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1100 }, colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  const total = () => page.textContent('#gainval');
  const setPwr = async (w) => { await page.fill('#pwr', String(w)); await page.waitForTimeout(250); };
  const setAnt = async (g) => { await page.selectOption('#ant', g); await page.waitForTimeout(250); };

  await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
  await dismissHint(page);

  // --- the arithmetic is the whole point, so check it exactly ---
  t.check((await total()).trim() === '+12.1 dB', 'default is 1 kW into a dipole',
    await total());

  await setPwr(100); await setAnt('0');
  t.check((await total()).trim() === '+0.0 dB', '100 W isotropic is the baseline',
    await total());

  // The case that prompted this: 400 W is not on any fixed dropdown.
  await setPwr(400);
  t.check((await total()).trim() === '+6.0 dB', '400 W is +6.0 dB over 100 W', await total());
  await setAnt('2.1');
  t.check((await total()).trim() === '+8.1 dB', '400 W into a dipole is +8.1 dB', await total());
  await setAnt('7');
  t.check((await total()).trim() === '+13.0 dB', '400 W into a 3-el Yagi is +13.0 dB',
    await total());

  await setPwr(5); await setAnt('-6');
  t.check((await total()).trim() === '-19.0 dB', 'QRP into a whip goes negative', await total());

  // Rubbish input must fall back, not produce NaN dB.
  await page.fill('#pwr', '');
  await page.waitForTimeout(250);
  t.check(!(await total()).includes('NaN'), 'empty power falls back rather than reading NaN',
    await total());

  // --- and it must actually move the map, without recomputing ---
  await setPwr(100); await setAnt('0');
  await clickCanvas(page, 700, 300);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  await page.click('#popbtns button:has-text("Set as transmitter")');
  await page.waitForTimeout(400);
  await page.selectOption('#detail', '24');
  await page.click('#go');
  await runToCompletion(page);

  const strip = () => page.$$eval('#popbands .bands:nth-child(2) span',
    (s) => s.map((x) => x.textContent.trim()));
  await clickCanvas(page, 900, 380);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  const low = await strip();
  t.check(low.length === 9, 'popup shows the band strip', low.join(' '));

  await setPwr(1000);
  await page.waitForTimeout(400);
  const high = await strip();
  const deltas = low
    .map((v, i) => (v === '—' || high[i] === '—' ? null : Number(high[i]) - Number(v)))
    .filter((d) => d !== null);
  t.check(deltas.length > 0 && deltas.every((d) => d === 10),
    '10x power lifts every band by exactly 10 dB',
    `${deltas.length} bands, deltas ${[...new Set(deltas)].join(',')}`);

  // Nothing above should have triggered a recompute: the grid is power-agnostic.
  t.check(await page.isHidden('#run'), 'changing the station never recomputes the grid');

  // --- and it survives a reload ---
  await setAnt('5');
  await page.waitForTimeout(300);
  const before = (await total()).trim();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  t.check((await total()).trim() === before, 'station restored on reload',
    `${before} -> ${(await total()).trim()}`);
  t.check((await page.inputValue('#pwr')) === '1000', 'power restored',
    await page.inputValue('#pwr'));
  t.check((await page.inputValue('#ant')) === '5', 'antenna restored',
    await page.inputValue('#ant'));

  // --- a session saved before the split still maps to a station ---
  await page.evaluate(() => {
    const key = 'hfkit.reach.session.v1';
    const s = JSON.parse(localStorage.getItem(key));
    delete s.pwr; delete s.ant;
    s.station = '18';                       // old "1 kW + 3-el beam"
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  t.check((await page.inputValue('#pwr')) === '1000' && (await page.inputValue('#ant')) === '7',
    'a pre-split session maps onto power and antenna',
    `${await page.inputValue('#pwr')} W / ${await page.inputValue('#ant')} dBi`);

  t.check(errs.length === 0, 'no page errors', errs.slice(0, 3).join('; '));
  await ctx.close();
  return t.failures;
}
