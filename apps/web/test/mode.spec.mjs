// Beginner and experienced modes. A first visit must land on the beginner
// home; a returning expert must be remembered; and no mode may drop the
// caveats — beginners get them folded, experienced visitors open.

import { reporter, watchErrors } from './harness.mjs';

const TOOL_PAGES = [
  ['planner.html', 'daynight'],
  ['reach.html', 'ionosphere'],
  ['antenna.html', 'antennas'],
  ['space.html', 'sun'],
];

export default async function run(browser, origin) {
  const t = reporter('modes');
  // Hidden by display:none, or inside something that is, means no boxes at all.
  const visible = (page, sel) => page.$eval(sel, (e) => e.getClientRects().length > 0).catch(() => false);

  // --- a first visit lands in beginner mode ----------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
  t.check(await page.getAttribute('html', 'data-mode') === 'beginner', 'a first visit is in beginner mode');
  t.check(await visible(page, '#beg-title'), 'and lands on the beginner welcome');
  t.check(!(await visible(page, 'header.exp-only')), 'not the tools hub');
  t.check(await visible(page, 'a.card.door[href="./learn.html"]'), 'with Learn as the main way in');
  const chapters = await page.$$eval('#chapters a', (a) => a.map((x) => x.getAttribute('href')));
  t.check(chapters.length === 6 && chapters.every((h) => h.startsWith('./learn.html#')),
    'and every chapter one click away', chapters.join(' '));
  const pressed = await page.$eval('.sitenav .modesw [aria-pressed="true"]', (b) => b.dataset.mode);
  t.check(pressed === 'beginner', 'the menu shows beginner selected', pressed);

  // The caveats are folded, not gone.
  const real = await page.$eval('#real', (d) => ({ open: d.open, text: d.textContent }));
  t.check(!real.open && real.text.includes('reliability') && real.text.includes('A-score'),
    'the "what is real" notes are present but folded', `open=${real.open}`);
  t.check(await visible(page, '#real > summary'), 'with their heading in view');

  // Tool pages carry a guide that points at the chapter behind them.
  for (const [file, chapter] of TOOL_PAGES) {
    const p = await ctx.newPage();
    const e = watchErrors(p);
    await p.goto(`${origin}/${file}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('details.guide', { timeout: 15000 });
    const g = await p.$eval('details.guide', (d) => ({
      open: d.open, link: d.querySelector('a[href^="./learn.html"]')?.getAttribute('href'),
      afterHeader: d.previousElementSibling?.tagName,
    }));
    t.check(!g.open && g.link === `./learn.html#${chapter}` && g.afterHeader === 'HEADER',
      `${file}: folded guide under the header, linking to its chapter`, JSON.stringify(g));
    t.check(e.filter((x) => !x.includes('space-weather') && !x.includes('aurora')).length === 0,
      `${file}: no errors from the guide`, e.slice(0, 2).join('; '));
    await p.close();
  }
  const lp = await ctx.newPage();
  await lp.goto(`${origin}/learn.html`, { waitUntil: 'domcontentloaded' });
  await lp.waitForSelector('.sitenav');
  t.check(await lp.$('details.guide') === null, 'the Learn page needs no guide of its own');
  await lp.close();

  // --- switching to experienced ------------------------------------------------
  await page.click('#to-exp');
  t.check(await page.getAttribute('html', 'data-mode') === 'experienced', 'the welcome can switch to experienced');
  t.check(await visible(page, 'header.exp-only') && !(await visible(page, '#beg-title')),
    'which shows the tools hub instead');
  t.check(await page.$eval('#real', (d) => d.open), 'with the "what is real" notes open');
  t.check(await page.$eval('.sitenav .modesw [aria-pressed="true"]', (b) => b.dataset.mode) === 'experienced',
    'and the menu follows');

  await page.reload({ waitUntil: 'networkidle' });
  t.check(await page.getAttribute('html', 'data-mode') === 'experienced'
    && await visible(page, 'header.exp-only'), 'experienced mode is remembered');
  const tp = await ctx.newPage();
  await tp.goto(`${origin}/planner.html`, { waitUntil: 'domcontentloaded' });
  await tp.waitForSelector('.sitenav');
  t.check(!(await visible(tp, 'details.guide')), 'and tool pages drop their guides');
  await tp.click('.sitenav .modesw [data-mode="beginner"]');
  t.check(await visible(tp, 'details.guide'), 'switching back from any page brings them back');
  await tp.close();

  await page.reload({ waitUntil: 'networkidle' });
  t.check(await visible(page, '#beg-title'), 'and the home page is the welcome again');
  t.check(errs.length === 0, 'no errors on the home page', errs.slice(0, 2).join('; '));
  await ctx.close();

  // --- on a phone ------------------------------------------------------------------
  {
    const c = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const p = await c.newPage();
    await p.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t.check(over <= 0, 'the welcome fits a 360 px phone', `${over}px`);
    await c.close();
  }

  return t.failures;
}
