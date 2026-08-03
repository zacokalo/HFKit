// Field mode: the frequency-driven view for expeditionary operators.
//
// The physics is pinned in packages/antenna/test. What is checked here is that
// the page speaks the right language — frequencies not bands, a short antenna
// list, cut lengths in the units asked for — and that the two places it could
// mislead someone are covered: a whip's efficiency, and an NVIS antenna being
// told it is "too low" when its height is the whole design.

import { reporter, watchErrors } from './harness.mjs';

const boot = async (page, origin) => {
  await page.goto(`${origin}/antenna.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null,
    { timeout: 20000 });
};
const toField = async (page) => {
  await page.click('#mode button[data-mode=field]');
  await page.waitForTimeout(400);
};
const setRange = (page, id, value) => page.evaluate(([i, v]) => {
  const e = document.getElementById(i);
  e.value = String(v);
  e.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, value]);
const cutItem = (page, label) => page.evaluate((l) => {
  for (const it of document.querySelectorAll('#cutlist .item')) {
    if (it.querySelector('.k').textContent === l) {
      return { value: it.querySelector('.v').textContent, alt: it.querySelector('.alt').textContent };
    }
  }
  return null;
}, label);
const chips = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#freqs .chip .pick')].map((b) => b.textContent));
const cautionText = (page) => page.textContent('#cautions');

export default async function run(browser, origin) {
  const t = reporter('field mode');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await boot(page, origin);

  // --- the mode switch ---
  {
    t.check(await page.$('#freqbox:not([hidden])') === null,
      'frequency entry is hidden in band mode');
    const amateurCount = await page.evaluate(() =>
      document.querySelectorAll('#ant option').length);
    await toField(page);
    t.check(await page.$('#freqbox:not([hidden])') !== null,
      'switching to Frequencies reveals the frequency list');
    const fieldCount = await page.evaluate(() =>
      document.querySelectorAll('#ant option').length);
    t.check(fieldCount < amateurCount,
      'and the antenna list gets shorter, which is the point',
      `${amateurCount} -> ${fieldCount}`);
    t.check(await page.$('#cut') === null && await page.$('#op') === null,
      'the band selectors are gone entirely');
    t.check((await page.textContent('#lede')).includes('frequencies you have been assigned'),
      'and the page describes itself in field terms');
  }

  // --- frequency entry, in the forms an assignment sheet actually uses ---
  {
    const type = async (v) => {
      await page.fill('#addfreq', v);
      await page.click('#addbtn');
      await page.waitForTimeout(250);
    };
    await type('4125');
    t.check((await chips(page)).includes('4.125 MHz'),
      'a bare kHz figure is understood', (await chips(page)).join(' '));
    await type('9.412');
    t.check((await chips(page)).includes('9.412 MHz'), 'and a bare MHz figure');
    await type('2182 kHz');
    t.check((await chips(page)).includes('2.182 MHz'), 'and an explicit kHz suffix');

    const before = (await chips(page)).length;
    await type('9.412');
    t.check((await chips(page)).length === before, 'a duplicate is refused');
    t.check((await page.textContent('#freqerr')).includes('Already'), 'and says why');
    await type('148.5');
    t.check((await chips(page)).length === before, 'and so is something outside HF');
    t.check(/outside HF/.test(await page.textContent('#freqerr')),
      'naming the range', await page.textContent('#freqerr'));

    const sorted = (await chips(page)).map((c) => parseFloat(c));
    t.check(sorted.every((v, i) => i === 0 || v >= sorted[i - 1]),
      'the list stays in frequency order', sorted.join(','));

    // Removing gets you back to a workable list, and the last one is protected.
    for (const f of ['2.182 MHz', '4.125 MHz', '9.412 MHz']) {
      await page.evaluate((label) => {
        for (const chip of document.querySelectorAll('#freqs .chip')) {
          if (chip.querySelector('.pick').textContent === label) chip.querySelector('.x').click();
        }
      }, f);
      await page.waitForTimeout(200);
    }
    t.check(!(await chips(page)).includes('9.412 MHz'), 'frequencies can be removed');
  }

  // --- cut lengths, in the units asked for ---
  {
    await page.selectOption('#ant', 'nvis-dipole');
    await page.waitForTimeout(400);
    // Select 7.850 and cut for it, so the arithmetic is checkable by hand:
    // 0.95 * (299.792458 / 7.85) / 2 = 18.14 m = 59 ft 6 in.
    await page.evaluate(() => {
      for (const c of document.querySelectorAll('#freqs .chip')) {
        if (c.querySelector('.pick').textContent === '7.850 MHz') c.querySelector('.pick').click();
      }
    });
    await page.waitForTimeout(300);
    const cutf = await page.$('#cutf');
    if (cutf) {
      await page.selectOption('#cutf', { label: '7.850 MHz' });
      await page.waitForTimeout(400);
    }
    const total = await cutItem(page, 'Total wire');
    t.check(total?.value === '59 ft 6 in', 'a 7.850 MHz dipole is 59 ft 6 in', total?.value);
    t.check(total?.alt === '18.14 m', 'with metric alongside it', total?.alt);

    await page.click('#units button[data-unit=m]');
    await page.waitForTimeout(400);
    const metric = await cutItem(page, 'Total wire');
    t.check(metric?.value === '18.14 m', 'the unit switch flips the primary figure', metric?.value);
    t.check(metric?.alt === '59 ft 6 in', 'and demotes the other one');
    const diagram = await page.textContent('#diagram');
    t.check(diagram.includes('18.14 m') || diagram.includes(' m'),
      'and the diagram follows the same units');

    await page.click('#units button[data-unit=ft]');
    await page.waitForTimeout(400);
    t.check((await cutItem(page, 'Total wire')).value === '59 ft 6 in', 'and switches back');
  }

  // --- distance stays metric, whatever the tape measure says ---
  {
    await setRange(page, 'dist', 120);
    await page.waitForTimeout(400);
    const label = await page.textContent('#distval');
    t.check(label.startsWith('120 km'), 'path length leads in km even in imperial mode', label);
    t.check(label.includes('75 mi'), 'with miles as the secondary figure');
    t.check((await page.textContent('#reachhead')).includes('120 km'),
      'and the heading names the target');
    t.check(/300 km F2 layer/.test(await page.textContent('#hopcap')),
      'the hop note stays metric too');
  }

  // --- the NVIS answer ---
  {
    await page.selectOption('#ant', 'nvis-inverted-v');
    await page.waitForTimeout(600);
    const verdict = await page.textContent('#verdict');
    t.check(/78°\s*needed/.test(verdict), 'a 120 km path needs 78°', verdict.slice(0, 60));
    t.check(/NVIS, straight up/.test(verdict),
      'and is named as NVIS rather than left as a number');
    const cls = await page.getAttribute('#verdict .verdict', 'class');
    t.check(/good/.test(cls), 'an NVIS antenna is judged good for it', cls);

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#freqverdicts .freqrow')].map((r) => r.textContent));
    t.check(rows.length >= 3, 'every frequency in the list gets its own verdict',
      `${rows.length} rows`);
    t.check(rows.every((r) => /dB down/.test(r)), 'each with a number, not a tick');
    t.check(rows.some((r) => /cut for this one/.test(r)),
      'and the one it was cut for is marked');
    t.check(/separate\s+question/.test(await page.textContent('#freqverdicts')),
      'with the propagation boundary stated');
  }

  // --- a whip on the same task: the comparison the page exists to make ---
  {
    await page.selectOption('#ant', 'whip-manpack');
    await page.waitForTimeout(700);
    const cls = await page.getAttribute('#verdict .verdict', 'class');
    t.check(/poor|closed/.test(cls), 'a whip is judged wrong for a 120 km path', cls);
    t.check(/steeper angle/.test(await page.textContent('#verdict')),
      'and the advice says to get the wire low, not high');

    const c = await cautionText(page);
    t.check(/Electrically short/.test(c), 'the efficiency caution fires on a short whip');
    t.check(/radiation resistance of about \d/.test(c),
      'with a real radiation resistance', c.match(/radiation resistance of about [\d.]+ Ω/)?.[0]);
    t.check(/loss of \d+\.\d to \d+\.\d dB/.test(c),
      'and a stated loss range', c.match(/loss of [\d.]+ to [\d.]+ dB/)?.[0]);
    const peak = await page.evaluate(() =>
      document.querySelector('#stats .stat .v').textContent);
    t.check(Number(peak) > 4,
      'precisely because the headline gain still looks healthy', `${peak} dBi`);

    // A whip is a fixed object; asking what it is "cut for" is meaningless.
    t.check(await page.$('#cutf') === null, 'a fixed-length antenna hides "cut for"');
    t.check(!/Cut for .* and used on/.test(c), 'and carries no off-frequency caution');
    t.check(/fixed length/.test(await page.textContent('#cutcap')),
      'saying plainly that there is nothing to cut');
  }

  // --- NVIS height is the design, not a fault ---
  {
    await page.selectOption('#ant', 'nvis-dipole');
    await page.waitForTimeout(600);
    const c = await cautionText(page);
    t.check(/right height for NVIS/.test(c),
      'a low NVIS antenna is told it is correct', c.slice(0, 90));
    t.check(/do not raise the antenna/.test(c),
      'and warned against the obvious wrong fix');
    t.check(await page.$('#cautions .caution.info') !== null,
      'marked informational, not as a fault');
    t.check(await page.$('#cautions .caution.high') === null,
      'and definitely not as a serious one');
  }

  // --- the interactive construction diagram ---
  {
    await page.selectOption('#ant', 'nvis-inverted-v');
    await page.waitForTimeout(500);
    const parts = await page.evaluate(() =>
      [...document.querySelectorAll('#diagram .part')].map((g) => g.dataset.part));
    for (const want of ['feed', 'element', 'ground', 'end']) {
      t.check(parts.includes(want), `the diagram exposes its ${want}`, parts.join(','));
    }
    t.check((await page.textContent('#partinfo')).includes('Select any part'),
      'and starts with an invitation rather than a wall of text');

    await page.click('#diagram .part-feed');
    await page.waitForTimeout(200);
    const feed = await page.textContent('#partinfo');
    t.check(/Feedpoint/.test(feed) && /current maximum/.test(feed),
      'clicking the feed explains it', feed.slice(0, 70));
    t.check(await page.$('#diagram .part-feed.sel') !== null, 'and highlights it');

    await page.click('#diagram .part-ground');
    await page.waitForTimeout(200);
    const ground = await page.textContent('#partinfo');
    t.check(/perfect mirror/.test(ground) && /upper bound/.test(ground),
      'and the ground explains why the gain is optimistic', ground.slice(0, 70));
    t.check(await page.$('#diagram .part-feed.sel') === null,
      'selecting one part deselects the last');

    // End-fed and centre-fed feedpoints are different things and must not
    // share a paragraph.
    await page.selectOption('#ant', 'field-longwire');
    await page.waitForTimeout(500);
    await page.click('#diagram .part-feed');
    await page.waitForTimeout(200);
    t.check(/voltage maximum/.test(await page.textContent('#partinfo')),
      'an end-fed wire gets the end-fed explanation');

    const focusable = await page.evaluate(() =>
      [...document.querySelectorAll('#diagram .part')].every((g) => g.tabIndex === 0));
    t.check(focusable, 'every part is reachable from the keyboard');
  }

  // --- state survives, per mode ---
  {
    await page.selectOption('#ant', 'crossed-v');
    await setRange(page, 'dist', 250);
    await boot(page, origin);
    t.check(await page.evaluate(() =>
      document.querySelector('#mode button[data-mode=field]').getAttribute('aria-pressed'))
      === 'true', 'the mode is remembered');
    t.check(await page.inputValue('#ant') === 'crossed-v', 'and the field antenna');
    t.check(await page.inputValue('#dist') === '250', 'and the field target distance');

    await page.click('#mode button[data-mode=amateur]');
    await page.waitForTimeout(500);
    t.check(await page.inputValue('#ant') === 'dipole',
      'band mode keeps its own antenna, not the field one');
    t.check(Number(await page.inputValue('#dist')) > 1000,
      'and its own distance', await page.inputValue('#dist'));
  }

  t.check(errs.length === 0, 'no page errors throughout', errs.slice(0, 2).join('; '));
  await ctx.close();
  return t.failures;
}
