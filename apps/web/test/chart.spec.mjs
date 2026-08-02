// The on-demand 24-hour circuit chart reachable from a map popup.

import {
  reporter, watchErrors, clickCanvas, dismissHint,
} from './harness.mjs';

export default async function run(browser, origin) {
  const t = reporter('circuit chart');
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1100 }, colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  const btnLabels = () => page.$$eval('#popbtns button', (b) => b.map((x) => x.textContent));

  await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
  await dismissHint(page);

  // Set a transmitter, then pick a point well away from it.
  await clickCanvas(page, 620, 260);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  await page.click('#popbtns button:has-text("Set as transmitter")');
  await page.waitForTimeout(400);

  await clickCanvas(page, 880, 380);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  t.check((await btnLabels()).some((l) => l.includes('24-hour chart')),
    'popup offers the 24-hour chart', (await btnLabels()).join(' / '));

  // --- the chart computes without a grid run ever having happened ---
  await page.click('#popbtns button:has-text("24-hour chart")');
  await page.waitForFunction(() => document.getElementById('chart').open, null, { timeout: 8000 });
  t.check(true, 'chart opens as a modal');
  await page.waitForFunction(
    () => document.querySelector('#chgrid table') !== null, null, { timeout: 200000 });
  t.check(await page.isHidden('#chwait'), 'loader clears once the circuit is computed');

  const rows = await page.$$eval('#chgrid table tbody tr', (r) => r.length);
  t.check(rows === 24, 'one row per UTC hour', `${rows} rows`);
  const cols = await page.$$eval('#chgrid table thead th', (h) => h.map((x) => x.textContent));
  t.check(cols.length === 11, 'hour column, nine bands, MUF', cols.join(' '));
  t.check(cols[0] === 'UTC' && cols[10] === 'MUF', 'header labels', `${cols[0]} … ${cols[10]}`);

  // Every data cell must be a margin or an explicit em dash — never blank, which
  // would read as "zero" rather than "not predicted".
  const cells = await page.$$eval('#chgrid table tbody tr td:not(.h)',
    (td) => td.map((x) => x.textContent.trim()));
  t.check(cells.length === 24 * 9, 'a cell per hour and band', `${cells.length}`);
  t.check(cells.every((c) => c === '—' || /^[+-]?\d+$/.test(c)),
    'every cell is a margin or an explicit dash');
  t.check(cells.some((c) => c !== '—'), 'the circuit has real predictions in it',
    cells.filter((c) => c !== '—').slice(0, 8).join(' '));

  const hours = await page.$$eval('#chgrid table tbody tr td.h:first-child',
    (td) => td.map((x) => x.textContent.trim()));
  t.check(hours[0] === '00Z' && hours[23] === '23Z', 'covers the full day',
    `${hours[0]} … ${hours[23]}`);
  t.check((await page.$$eval('#chgrid table tbody tr.now', (r) => r.length)) === 1,
    'the current UTC hour is marked');

  const note = await page.textContent('#chnote');
  t.check(note.includes('exact path'), 'note says this is the exact path, not a grid cell');
  t.check(/Best window|No hour/.test(note), 'note calls out the best window', note.slice(0, 80));
  t.check((await page.textContent('#chlegend')).length > 0, 'chart carries its own legend');

  // --- station gain re-renders the open chart ---
  const beforeCells = cells.join(',');
  await page.selectOption('#station', '0');       // 100 W isotropic, 12 dB lower
  await page.waitForTimeout(500);
  const after = await page.$$eval('#chgrid table tbody tr td:not(.h)',
    (td) => td.map((x) => x.textContent.trim()));
  t.check(after.join(',') !== beforeCells, 'station setting re-renders the open chart');

  // --- reopening is instant, from cache ---
  await page.click('#chclose');
  await page.waitForFunction(() => !document.getElementById('chart').open, null, { timeout: 5000 });
  t.check(true, 'close button dismisses the chart');

  await clickCanvas(page, 880, 380);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  const t0 = Date.now();
  await page.click('#popbtns button:has-text("24-hour chart")');
  await page.waitForFunction(
    () => document.querySelector('#chgrid table') !== null, null, { timeout: 20000 });
  const reopenMs = Date.now() - t0;
  t.check(reopenMs < 3000, 'reopening the same circuit is served from cache', `${reopenMs} ms`);
  await page.evaluate(() => document.getElementById('chart').close());

  // --- and it is offered for receivers too, which is what it is for ---
  await clickCanvas(page, 880, 380);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  await page.click('#popbtns button:has-text("Add as receiver")');
  await page.waitForTimeout(400);
  t.check((await btnLabels()).some((l) => l.includes('24-hour chart')),
    'receiver popup offers the chart', (await btnLabels()).join(' / '));

  t.check(errs.length === 0, 'no page errors', errs.slice(0, 3).join('; '));
  await ctx.close();
  return t.failures;
}
