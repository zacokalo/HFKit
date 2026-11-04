// The comms planner in a real browser, against the real engine.
//
// The reasoning is pinned in packages/antenna/test/recommend.test.mjs; what is
// checked here is that the page gets an answer onto the screen from the engine
// and the antenna worker together, that power changes the verdict without a
// recompute, that a user's override is honoured, and that the whole thing
// renders in every theme without a hardcoded colour.

import { reporter, watchErrors } from './harness.mjs';

const ready = async (page, origin) => {
  await page.goto(`${origin}/comms.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
};

const pickPlace = async (page, inputId, sugId, query) => {
  await page.fill(`#${inputId}`, query);
  await page.waitForSelector(`#${sugId} [role=option]`, { timeout: 10000 });
  await page.click(`#${sugId} [role=option]`);
};

const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();

const setRange = (page, id, value) => page.evaluate(([i, v]) => {
  const e = document.getElementById(i);
  e.value = String(v);
  e.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, value]);

export default async function run(browser, origin) {
  const t = reporter('comms planner');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await ready(page, origin);

  // --- empty state refuses to plan, and says why ---
  t.check(await page.isDisabled('#go'), 'Plan is disabled with nothing filled in');
  t.check((await text(page, '#status')).startsWith('Start with where you are'), 'and the status says what is missing');

  // --- inputs: a station, two sites, a custom frequency ---
  await pickPlace(page, 'stn', 'stnsug', 'Denver');
  t.check((await text(page, '#stnnow')).includes('Denver'), 'station set from the gazetteer');
  await page.fill('#stn', '42.36, -71.06');
  await page.waitForSelector('#stnsug [role=option]');
  const coordOpt = await text(page, '#stnsug [role=option]');
  t.check(coordOpt.includes('42.360') && coordOpt.includes('FN42'), 'coordinates are offered with their grid square', coordOpt);
  await page.fill('#stn', 'DM79mr');
  await page.waitForSelector('#stnsug [role=option]');
  t.check((await text(page, '#stnsug [role=option]')).includes('Grid DM79mr'), 'a Maidenhead locator is recognised');
  await page.keyboard.press('Escape');

  await pickPlace(page, 'site', 'sitesug', 'Boise');
  await pickPlace(page, 'site', 'sitesug', 'Albuquerque');
  const sites = await page.$$eval('#sites .site', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ')));
  t.check(sites.length === 2, 'two sites listed', `${sites.length}`);
  t.check(/1,0\d\d km · 29\d° · needs 2\d° take-off/.test(sites[0]), 'each with distance, bearing and take-off', sites[0]);

  await page.fill('#addfreq', '5357');
  await page.click('#addbtn');
  t.check((await page.$$eval('#bands .chip', (e) => e.map((x) => x.textContent))).some((x) => x.startsWith('5.357 MHz')),
    'an assigned frequency in kHz becomes a planned band');
  await page.fill('#addfreq', '45');
  await page.click('#addbtn');
  t.check((await text(page, '#freqerr')).includes('outside HF'), 'and an out-of-band one is refused');

  await page.click('[data-preset="field"]');
  const ticked = await page.$$eval('#ants input:checked', (e) => e.length);
  t.check(ticked === 6, 'the field-kit preset ticks six antennas', `${ticked}`);
  await page.click('#ants input[data-ant="whip-manpack"]');       // keep the whip in: it should lose
  await page.click('#ants input[data-ant="whip-manpack"]');
  t.check(!(await page.isDisabled('#go')), 'Plan is enabled once everything is set');

  // --- the plan ---
  const t0 = Date.now();
  await page.click('#go');
  await page.waitForFunction(() => document.body.dataset.planned === 'true', null, { timeout: 240000 });
  t.note(`planned in ${Date.now() - t0} ms`);

  const said = await text(page, '#answer .said');
  t.check(/^Use .+ now, on the .+\.$/.test(said), 'the answer names a band and an antenna', said);
  t.check(!(await text(page, '#answer')).includes('geometry only'), 'and it is the engine answer, not geometry only');
  t.check((await text(page, '#answer .prov')).includes('SSN'), 'with the sunspot number and its source on it');
  t.check((await text(page, '#answer .prov')).includes('not a probability'), 'and the margin labelled as not a probability');

  const names = await page.$$eval('#ranking .rcard .name', (e) => e.map((x) => x.textContent));
  t.check(names.length === 6, 'every ticked antenna is ranked', names.join(', '));
  t.check(names.indexOf('Manpack whip') > names.indexOf('NVIS inverted-V'),
    'a 3 m whip ranks below an NVIS wire for a 500–1000 km plan', names.join(' > '));
  const whipReasons = await page.$$eval('#ranking .rcard', (cards) => {
    const c = cards.find((x) => x.querySelector('.name').textContent === 'Manpack whip');
    return [...c.querySelectorAll('.reasons li')].map((li) => ({
      text: li.textContent, fix: li.querySelector('.fix')?.textContent ?? null,
    }));
  });
  t.check(whipReasons.some((r) => /Electrically short/.test(r.text)), 'and the whip is told why: electrically short', whipReasons[0]?.text);
  t.check(whipReasons.some((r) => r.fix && /counterpoise/.test(r.fix)), 'with a fix attached', whipReasons[0]?.fix);

  const rows = await page.$$eval('#timeline tbody tr, #timeline tr', (e) => e.length);
  t.check(rows === 11, 'the timeline has a header and ten band rows', `${rows}`);
  const cells = await page.$$eval('#timeline td.c', (e) => e.length);
  t.check(cells === 240, 'with 24 hours for each band', `${cells}`);
  const nowCells = await page.$$eval('#timeline td.c.now', (e) => e.length);
  t.check(nowCells === 10, 'and the current hour marked in every row', `${nowCells}`);
  const coloured = await page.$$eval('#timeline td.c', (e) => e.filter((x) => x.style.background.includes('--hf-status-')).length);
  t.check(coloured === 240, 'every cell is a status token, not a hex colour', `${coloured}`);

  t.check((await page.$$eval('#gsteps h3', (e) => e.map((x) => x.textContent))).join(',') === 'Cut,Point,Raise,Feed,Expect',
    'the setup guide has its five steps');
  t.check((await page.$$eval('#diagram svg', (e) => e.length)) === 1, 'and draws the antenna');
  t.check((await page.$$eval('#elev svg .marker', (e) => e.length)) >= 2, 'with each site\'s take-off angle marked on the pattern');
  t.check((await page.$$eval('#map svg .site', (e) => e.length)) === 2, 'the map shows both sites');
  t.check((await page.$$eval('#map svg .arc', (e) => e.length)) === 2, 'and both great-circle paths');

  // --- power is an offset: QRP drops the margin by 13 dB and nothing recomputes ---
  const before = Number((await text(page, '#answer .sub')).match(/([+-]\d+) dB of margin/)[1]);
  const planned = await page.evaluate(() => document.body.dataset.planned);
  await setRange(page, 'pwr', 0);
  const after = Number((await text(page, '#answer .sub')).match(/([+-]\d+) dB of margin/)[1]);
  t.check(before - after === 13, 'QRP (5 W) is exactly 13 dB below 100 W', `${before} → ${after}`);
  t.check((await text(page, '#answer')).includes('QRP'), 'and labelled QRP');
  t.check(await page.evaluate(() => document.getElementById('progress').hidden), 'without any recompute');
  await setRange(page, 'pwr', 10);
  const kw = Number((await text(page, '#answer .sub')).match(/([+-]\d+) dB of margin/)[1]);
  t.check(kw - before === 10, 'and a kilowatt is exactly +10 dB', `${before} → ${kw}`);
  await setRange(page, 'pwr', 5);

  // --- an override is honoured and flagged ---
  await page.click('#ranking .rcard:nth-child(2)');
  const second = await text(page, '#ranking .rcard:nth-child(2) .name');
  t.check((await text(page, '#answer .said')).includes(second), 'clicking another antenna re-plans around it', second);
  t.check((await text(page, '#answer .head')).includes('your pick'), 'and the answer says it was your pick');
  t.check((await text(page, '#guidefor')).startsWith(second), 'and the setup guide follows');

  // --- a directional wire gets a bearing and the map draws it ---
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#ranking .rcard')]
      .find((c) => c.dataset.ant === 'field-longwire' || c.dataset.ant === 'field-inverted-l');
    card?.click();
  });
  const pointBody = await page.$$eval('#gsteps li', (e) => e[1].textContent);
  const directional = /Run the wire along \d+°/.test(pointBody);
  t.check(directional || /Direction does not matter/.test(pointBody),
    'the Point step either gives a run bearing or says direction is moot', pointBody.slice(0, 80));
  if (directional) {
    t.check((await page.$$eval('#map svg .wire', (e) => e.length)) === 1, 'and the map draws the wire with broadside arrows');
  }

  // --- changing an input marks the plan stale ---
  await setRange(page, 'height', 12);
  t.check(!(await page.evaluate(() => document.getElementById('stale').hidden)), 'changing the support height flags the plan as stale');

  // --- every theme resolves, and nothing is hardcoded ---
  const seen = [];
  for (const theme of ['field-dark', 'field-light', 'night-ops']) {
    const got = await page.evaluate((th) => {
      document.documentElement.setAttribute('data-theme', th);
      const cs = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
      return {
        answer: cs('#answer', 'borderLeftColor'),
        coast: cs('#map svg .coast', 'stroke'),
        cell: cs('#timeline td.c', 'backgroundColor'),
        bg: getComputedStyle(document.body).backgroundColor,
      };
    }, theme);
    const bad = Object.entries(got).filter(([, v]) => !v || v === 'none' || v === 'rgba(0, 0, 0, 0)');
    t.check(bad.length === 0, `${theme}: every colour resolves`, bad.map(([k]) => k).join(','));
    seen.push(got.bg);
  }
  t.check(new Set(seen).size === 3, 'and the three themes differ');
  const inline = await page.evaluate(() =>
    [...document.querySelectorAll('#map svg *, #diagram svg *, #elev svg *')]
      .filter((e) => e.getAttribute('fill')?.startsWith('#') || e.getAttribute('stroke')?.startsWith('#')).length);
  t.check(inline === 0, 'no SVG element carries a hardcoded colour', `${inline}`);

  // --- inputs survive a reload; results do not pretend to ---
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  t.check((await text(page, '#stnnow')).includes('Denver'), 'station restored on reload');
  t.check((await page.$$eval('#sites .site', (e) => e.length)) === 2, 'sites restored');
  t.check(await page.evaluate(() => document.getElementById('results').hidden), 'and no stale result is shown as if fresh');

  t.check(errs.length === 0, 'no page errors', errs.join(' | '));
  await ctx.close();
  return t.failures;
}
