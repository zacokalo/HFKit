// Reach map popups: click for location detail and actions, hover for a
// receiver's circuit.

import {
  reporter, watchErrors, clickCanvas, hoverCanvas, canvasRect, runToCompletion, dismissHint,
} from './harness.mjs';

export default async function run(browser, origin) {
  const t = reporter('map popups');
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1100 }, colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  const btnLabels = () => page.$$eval('#popbtns button', (b) => b.map((x) => x.textContent));

  await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
  await dismissHint(page);

  // --- clicking before anything is computed ---
  await clickCanvas(page, 700, 320);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  t.check(true, 'click opens a popup', await page.textContent('#poptitle'));
  t.check((await page.textContent('#popcoords')).includes('°'), 'popup shows coordinates',
    await page.textContent('#popcoords'));
  // Absence of data is stated, not shown as blanks the user has to interpret.
  t.check((await page.textContent('#popbands')).includes('Set a transmitter'),
    'says what is missing before any run', await page.textContent('#popbands'));
  let labels = (await btnLabels()).join(' / ');
  t.check(labels.includes('Set as transmitter') && labels.includes('Add as receiver'),
    'offers both actions', labels);

  // --- the popup can set the transmitter ---
  await page.click('#popbtns button:has-text("Set as transmitter")');
  await page.waitForTimeout(400);
  t.check(!(await page.textContent('#txnow')).includes('not set'),
    'popup sets the transmitter', await page.textContent('#txnow'));
  t.check(await page.isHidden('#pop'), 'popup closes after setting the transmitter');

  // --- compute, then click for real signal detail ---
  await page.selectOption('#detail', '24');
  await page.click('#go');
  await runToCompletion(page);

  await clickCanvas(page, 600, 300);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  const facts = await page.$$eval('#popfacts dt', (d) => d.map((x) => x.textContent));
  t.check(facts.includes('Path MUF') && facts.includes('Best band')
    && facts.includes('Usable range'), 'popup carries signal detail', facts.join(', '));
  const bands = await page.$$eval('#popbands .bands:nth-child(2) span',
    (s) => s.map((x) => x.textContent));
  t.check(bands.length === 9, 'per-band margins shown', bands.join(' '));
  const coloured = await page.$$eval('#popbands .bands:nth-child(2) span',
    (s) => s.filter((x) => x.style.background).length);
  t.check(coloured === 9, 'each band cell is colour-coded', `${coloured}/9`);

  // --- add as receiver, from the popup ---
  await page.click('#popbtns button:has-text("Add as receiver")');
  await page.waitForTimeout(500);
  t.check((await page.$$eval('#tbl tbody tr', (r) => r.length)) === 1, 'popup adds a receiver');
  labels = (await btnLabels()).join(' / ');
  t.check(labels.includes('Remove receiver'), 'popup switches to the receiver view', labels);

  await page.click('#popclose');
  await page.waitForTimeout(250);
  t.check(await page.isHidden('#pop'), 'close button dismisses the popup');

  // --- hovering that receiver ---
  await hoverCanvas(page, 600, 300);
  await page.waitForTimeout(400);
  const hovering = await page.isVisible('#pop');
  t.check(hovering, 'hovering a receiver shows a popup');
  if (hovering) {
    // A hover panel with buttons is a trap: it disappears as you reach for them.
    t.check((await btnLabels()).length === 0, 'hover popup has no buttons');
    t.check((await page.getAttribute('#pop', 'class')).includes('transient'),
      'hover popup is transient', await page.getAttribute('#pop', 'class'));
    t.check((await page.textContent('#poptitle')).length > 0,
      'hover popup names the receiver', await page.textContent('#poptitle'));
  }
  await hoverCanvas(page, 200, 550);
  await page.waitForTimeout(400);
  t.check(await page.isHidden('#pop'), 'hover popup disappears on leaving the marker');

  // --- clicking it pins the same panel, with actions ---
  await clickCanvas(page, 600, 300);
  await page.waitForTimeout(400);
  t.check(await page.isVisible('#pop'), 'clicking a receiver pins its popup');
  labels = (await btnLabels()).join(' / ');
  t.check(labels.includes('Remove receiver'), 'pinned receiver popup has actions', labels);

  // --- the panel tracks the map when it moves ---
  const before = await page.evaluate(() => document.getElementById('pop').style.left);
  const r = await canvasRect(page);
  // Grab clear of the panel: it is a real element and swallows the pointer where
  // it sits, exactly as a map popup should.
  const grabY = await page.evaluate(() => {
    const b = document.getElementById('pop').getBoundingClientRect();
    const c = document.getElementById('cv').getBoundingClientRect();
    return b.bottom + 30 < c.bottom ? b.bottom + 30 : c.top + 20;
  });
  await page.mouse.move(r.x + r.w * 0.5, grabY);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.25, grabY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => document.getElementById('pop').style.left);
  t.check(before !== after, 'popup follows the map when panning', `${before} -> ${after}`);

  // --- and can remove the receiver it describes ---
  if (await page.isVisible('#pop') && (await btnLabels()).some((l) => l.includes('Remove'))) {
    await page.click('#popbtns button:has-text("Remove receiver")');
    await page.waitForTimeout(400);
    t.check((await page.$$eval('#tbl tbody tr', (x) => x.length)) === 0,
      'popup removes the receiver');
    t.check(await page.isHidden('#pop'), 'popup closes after removal');
  }

  t.check(errs.length === 0, 'no page errors', errs.slice(0, 3).join('; '));
  await ctx.close();
  return t.failures;
}
