// Real antenna patterns applied to the reach map.
//
// The claim being guarded is specific: selecting a modelled antenna changes the
// coverage across the map, does *not* re-run P.533, and keeps the fixed-gain
// path working exactly as it did. Each of those is a way this could go wrong
// without looking wrong.

import {
  reporter, watchErrors, clickCanvas, dismissHint, runToCompletion, sample, coverage,
} from './harness.mjs';

const settled = (page) => page.waitForFunction(
  () => !document.getElementById('gainval').textContent.includes('computing'),
  null, { timeout: 40000 });

export default async function run(browser, origin) {
  const t = reporter('pattern gain');
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1100 }, colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  const setAnt = async (v) => { await page.selectOption('#ant', v); await settled(page); };
  const gainval = () => page.textContent('#gainval');
  const hidden = (id) => page.evaluate((i) => document.getElementById(i).hidden, id);

  await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
  await dismissHint(page);

  // --- the fixed path is untouched ---
  {
    t.check((await gainval()).trim() === '+12.1 dB',
      'the default is still a fixed-gain dipole, arithmetic unchanged', await gainval());
    t.check(await hidden('anthrow') && await hidden('antorow'),
      'and the pattern controls stay out of the way');
    const beams = await page.evaluate(() =>
      [...document.querySelectorAll('#ant option')].map((o) => o.textContent)
        .filter((x) => /Yagi|Log-periodic|hex/.test(x)).length);
    t.check(beams >= 4, 'beams are still offered as fixed gain', `${beams} found`);
    const modelled = await page.evaluate(() =>
      [...document.querySelectorAll('#ant option')].filter((o) => o.value.startsWith('pattern:')).length);
    t.check(modelled >= 5, 'alongside the modelled patterns', `${modelled} found`);
    t.check(await page.evaluate(() =>
      [...document.querySelectorAll('#ant optgroup')].map((g) => g.label)
        .some((l) => /applied flat/.test(l))),
      'and the fixed group still says it is applied flat');
  }

  // --- compute a grid to lay the pattern over ---
  await clickCanvas(page, 700, 300);
  await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
  await page.click('#popbtns button:has-text("Set as transmitter")');
  await page.waitForTimeout(400);
  await page.selectOption('#detail', '24');
  await page.click('#go');
  await runToCompletion(page);
  await page.evaluate(() => { document.getElementById('pop').hidden = true; });
  await page.waitForTimeout(400);

  // --- switching to a pattern changes the map, without recomputing ---
  {
    const before = await sample(page);
    let reran = false;
    const watch = () => { reran = true; };
    page.on('request', watch);
    await setAnt('pattern:dipole');
    await page.waitForTimeout(700);
    page.off('request', watch);

    t.check(await page.evaluate(() => document.getElementById('run').hidden),
      'selecting a modelled antenna does not start a new grid run');
    const changed = coverage(await sample(page), before);
    t.check(changed > 0.02, 'but the coverage really does change',
      `${(changed * 100).toFixed(1)}% of sampled pixels`);

    const g = await gainval();
    t.check(/antenna .* to \+.* dBi by direction/.test(g),
      'and the readout stops pretending there is one number', g);
    t.check(!await hidden('anthrow'), 'a wire antenna exposes its height');
    t.check(!await hidden('antorow'), 'and which way it runs');
  }

  // --- height and orientation both move the map ---
  {
    const base = await sample(page);
    await page.evaluate(() => {
      const e = document.getElementById('anth');
      e.value = '25';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settled(page);
    await page.waitForTimeout(600);
    t.check(coverage(await sample(page), base) > 0.01,
      'raising the antenna redraws the coverage');

    const raised = await sample(page);
    await page.evaluate(() => {
      const e = document.getElementById('anto');
      e.value = '0';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settled(page);
    await page.waitForTimeout(600);
    t.check(coverage(await sample(page), raised) > 0.01,
      'and so does turning the wire through 90°');
    t.check((await page.textContent('#antoval')).includes('000°–180°'),
      'with the bearing pair spelled out', await page.textContent('#antoval'));
  }

  // --- a vertical is a different antenna, and the map should say so ---
  {
    const dipole = await sample(page);
    await setAnt('pattern:vertical-ground');
    await page.waitForTimeout(700);
    t.check(coverage(await sample(page), dipole) > 0.02,
      'a vertical gives materially different coverage from a dipole');
    t.check(await hidden('anthrow'),
      'a ground-mounted vertical has no height to set, so the slider hides');
    t.check(await hidden('antorow'), 'and no orientation, because it is omnidirectional');
  }

  // --- the popup explains where the number came from ---
  {
    await setAnt('pattern:dipole');
    await page.waitForTimeout(600);
    await clickCanvas(page, 1000, 420);
    await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
    const txt = await page.textContent('#pop');
    t.check(/Take-off needed/.test(txt), 'the popup names the angle that path needs',
      txt.replace(/\s+/g, ' ').slice(0, 120));
    t.check(/Antenna here/.test(txt) && /dBi on \d+m/.test(txt),
      'and the gain the antenna actually gives there');

    // The number must differ between two points at different distances —
    // otherwise nothing has really been applied.
    const readGain = () => page.evaluate(() => {
      const dts = [...document.querySelectorAll('#pop dt')];
      const i = dts.findIndex((d) => d.textContent === 'Antenna here');
      return i < 0 ? null : document.querySelectorAll('#pop dd')[i].textContent;
    });
    const near = await readGain();
    await page.evaluate(() => { document.getElementById('pop').hidden = true; });
    await clickCanvas(page, 250, 500);
    await page.waitForSelector('#pop:not([hidden])', { timeout: 8000 });
    const far = await readGain();
    t.check(near !== null && far !== null && near !== far,
      'and it differs between two points on the same map', `${near} vs ${far}`);
    await page.evaluate(() => { document.getElementById('pop').hidden = true; });
  }

  // --- going back to fixed restores the old exact behaviour ---
  {
    await setAnt('2.1');
    await page.waitForTimeout(500);
    t.check((await gainval()).trim() === '+12.1 dB',
      'switching back to fixed gain restores the single figure', await gainval());
    t.check(await hidden('anthrow') && await hidden('antorow'),
      'and puts the pattern controls away');
  }

  // --- the choice survives a reload ---
  {
    await setAnt('pattern:inverted-v');
    await page.evaluate(() => {
      const e = document.getElementById('anth');
      e.value = '18';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settled(page);
    await page.waitForTimeout(400);
    await page.goto(`${origin}/reach.html`, { waitUntil: 'networkidle' });
    // Not dismissHint(): the restored session already has a transmitter, so the
    // first-visit card never appears and waiting for it would hang.
    await page.waitForFunction(
      () => document.getElementById('ant').value.startsWith('pattern:'),
      null, { timeout: 20000 });
    await settled(page);
    t.check(await page.inputValue('#ant') === 'pattern:inverted-v',
      'the modelled antenna is remembered');
    t.check(await page.inputValue('#anth') === '18', 'and its height');
    t.check(/by direction/.test(await gainval()),
      'and its tables are rebuilt on boot rather than left empty', await gainval());
  }

  t.check(errs.length === 0, 'no page errors throughout', errs.slice(0, 2).join('; '));
  await ctx.close();
  return t.failures;
}
