// The antenna visualiser in a real browser.
//
// The physics is pinned in packages/antenna/test; what is checked here is that
// the page puts the right numbers on screen, keeps its honesty warnings
// attached to the thing they qualify, and does not fall over on any antenna in
// the catalogue.

import { reporter, watchErrors } from './harness.mjs';

const ready = async (page, origin, url = '/antenna.html') => {
  await page.goto(`${origin}${url}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null,
    { timeout: 20000 });
};

const setRange = (page, id, value) => page.evaluate(([i, v]) => {
  const e = document.getElementById(i);
  e.value = String(v);
  e.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, value]);

const statValue = (page, key) => page.evaluate((k) => {
  for (const s of document.querySelectorAll('#stats .stat')) {
    if (s.querySelector('.k').textContent === k) return s.querySelector('.v').textContent;
  }
  return null;
}, key);

const dimRow = (page, label) => page.evaluate((l) => {
  for (const tr of document.querySelectorAll('#dims tbody tr')) {
    const first = tr.cells[0].childNodes[0].textContent.trim();
    if (first === l) return [...tr.cells].map((c) => c.textContent.trim());
  }
  return null;
}, label);

export default async function run(browser, origin) {
  const t = reporter('antenna visualiser');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await ready(page, origin);

  // --- dimensions, which is the part someone will cut wire from ---
  {
    await page.selectOption('#ant', 'dipole');
    await page.selectOption('#cut', '20m');
    // 0.95 * lambda/2 at 14.15 MHz is 10.06 m, i.e. 467.2/f feet. The handbook
    // prints 468/f, which is the same rule at 0.9515 — two centimetres apart on
    // 20 m, and both of them shorter than the wire you should actually cut.
    const total = await dimRow(page, 'Total length');
    t.check(total?.[1] === '10.06 m', 'a 20 m dipole is 10.06 m', total?.[1]);
    t.check(total?.[2] === '33 ft 0 in', 'and 33 ft for a tape measure', total?.[2]);
    const leg = await dimRow(page, 'Each leg');
    t.check(leg?.[1] === '5.03 m', 'with the leg length spelled out separately', leg?.[1]);

    await page.selectOption('#cut', '40m');
    const forty = await dimRow(page, 'Total length');
    t.check(forty?.[1] === '20.06 m', 'and 40 m gives 20.06 m', forty?.[1]);
  }

  // --- the pattern facts the page exists to teach ---
  {
    await page.selectOption('#ant', 'dipole');
    await page.selectOption('#cut', '20m');
    await page.selectOption('#op', '20m');
    // lambda = 21.19 m on 20 m, so lambda/2 is 10.59 m and lambda/4 is 5.30 m.
    // At or below a quarter wave the ground factor never reaches its maximum
    // before the zenith, so the peak pins there.
    await setRange(page, 'p_height', 5);
    const zenith = Number((await statValue(page, 'At elevation')).replace('°', ''));
    t.check(zenith >= 88, 'a dipole a quarter wave up fires straight up', `${zenith}°`);

    await setRange(page, 'p_height', 10.5);
    const thirty = await statValue(page, 'At elevation');
    t.check(Math.abs(Number(thirty.replace('°', '')) - 30) <= 1,
      'a dipole a half wave up peaks at 30 degrees', thirty);

    await setRange(page, 'p_height', 21);
    const high = await statValue(page, 'Lowest lobe');
    t.check(Math.abs(Number(high.replace('°', '')) - 14.5) <= 1.5,
      'and one wavelength up its lowest lobe is near 14.5 degrees', high);

    const gain = Number((await statValue(page, 'Peak gain')));
    t.check(gain > 7 && gain < 9, 'peak gain lands in the physical range', `${gain} dBi`);
  }

  // --- the take-off verdict, which is the whole point of the page ---
  {
    await page.selectOption('#ant', 'dipole');
    await page.selectOption('#cut', '20m');
    await setRange(page, 'p_height', 10.5);       // peaks at 30 degrees
    await setRange(page, 'dist', 2000);           // needs 11.8 degrees

    const verdict = await page.textContent('#verdict');
    t.check(/12°\s*needed/.test(verdict), 'a 2000 km path is reported as needing 12°', verdict);
    t.check(/dB below/.test(verdict), 'and says how far down the antenna is there');
    const cls = await page.getAttribute('#verdict .verdict', 'class');
    t.check(/poor|closed/.test(cls), 'a half-wave-high dipole is judged poor for 2000 km', cls);
    t.check(/needs a lower angle/.test(verdict),
      'and the advice names height as the fix', verdict.slice(-160));

    // Raising it must actually improve the verdict — the causal claim the page
    // makes to every visitor.
    await setRange(page, 'p_height', 21);
    const better = await page.textContent('#verdict');
    const down = (s) => Number(s.match(/([\d.]+) dB below/)?.[1] ?? 99);
    t.check(down(better) < down(verdict),
      'raising the antenna closes the gap on that path',
      `${down(verdict)} dB -> ${down(better)} dB`);

    // A short path wants a steep angle, which flips the advice.
    await setRange(page, 'p_height', 5.5);
    await setRange(page, 'dist', 400);
    const nvis = await page.textContent('#verdict');
    t.check(/good|fair/.test(await page.getAttribute('#verdict .verdict', 'class')),
      'and a low dipole is the right answer for a 400 km path', nvis.slice(0, 90));

    // Beyond one hop the page must not silently pretend otherwise.
    await setRange(page, 'dist', 9000);
    const far = await page.textContent('#hopcap');
    t.check(/^3 hops|^[2-9] hops/.test(far), 'a 9000 km path is broken into hops', far.slice(0, 40));
  }

  // --- honesty gates ---
  {
    await page.selectOption('#ant', 'dipole');
    await page.selectOption('#cut', '160m');
    await page.selectOption('#op', '160m');
    await setRange(page, 'p_height', 2);
    const c = await page.textContent('#cautions');
    t.check(/wavelengths up/.test(c) && /upper bound/.test(c),
      'a 2 m dipole on 160 m warns the gain is unreachable', c.slice(0, 120));
    t.check(await page.$('#cautions .caution.high') !== null,
      'and marks it as the serious kind');
    const gain = Number(await statValue(page, 'Peak gain'));
    t.check(gain > 5, 'precisely because the number still looks healthy', `${gain} dBi`);

    await page.selectOption('#ant', 'vertical-ground');
    const v = await page.textContent('#cautions');
    t.check(/average ground/.test(v) && /dB below the figure shown/.test(v),
      'a ground-mounted vertical always carries its ground-loss caution', v.slice(0, 120));

    await page.selectOption('#ant', 'ground-plane');
    await page.selectOption('#op', '20m');
    t.check(!/average ground/.test(await page.textContent('#cautions')),
      'an elevated ground plane does not inherit that penalty');

    // Off-design use has to be labelled, and labelled differently depending on
    // whether it is the intended use of the antenna or a mistake.
    await page.selectOption('#ant', 'dipole');
    await page.selectOption('#cut', '40m');
    await page.selectOption('#op', '20m');
    t.check(/off its design band/.test(await page.textContent('#cautions')),
      'a dipole used off its band says so');
    await page.selectOption('#ant', 'doublet');
    t.check(/intended use/.test(await page.textContent('#cautions')),
      'but a doublet on the same pair of bands is doing its job');
  }

  // --- the multiband lesson ---
  {
    await page.selectOption('#ant', 'doublet');
    await page.selectOption('#cut', '80m');
    await page.selectOption('#op', '80m');
    await setRange(page, 'p_length', 40);
    const low = await page.textContent('#azimcap');
    t.check(/2 lobes/.test(low), 'a doublet is a figure of eight on its own band', low.slice(0, 80));

    await page.selectOption('#op', '10m');
    const high = await page.textContent('#azimcap');
    t.check(/[4-9] lobes|1\d lobes/.test(high),
      'and breaks into many lobes four bands up', high.slice(0, 80));
    t.check(/no longer favours broadside/.test(high),
      'and the caption explains what that costs');

    // A fan dipole is the counter-example: same bands, no lobing.
    await page.selectOption('#ant', 'multi-dipole');
    t.check(await page.$('#cut') === null,
      'a fan dipole hides "cut for" — it is cut for whichever band you are on');
    const fan = await page.textContent('#azimcap');
    t.check(/2 lobes/.test(fan), 'and stays a plain dipole on 10 m', fan.slice(0, 80));
    const eighty = await dimRow(page, '80 m element');
    t.check(eighty !== null && /39\.\d\d m/.test(eighty[1]),
      'while still listing every element you would have to build', eighty?.[1]);
  }

  // --- geometry clamps, visibly ---
  {
    await page.selectOption('#ant', 'inverted-v');
    await page.selectOption('#cut', '80m');
    await page.selectOption('#op', '80m');
    await setRange(page, 'p_height', 8);
    await setRange(page, 'p_droop', 70);
    const c = await page.textContent('#cautions');
    t.check(/Droop limited/.test(c), 'a V that would bury its ends says so', c.slice(0, 100));
    const wires = await page.evaluate(() =>
      [...document.querySelectorAll('#diagram polyline.wire')].length);
    t.check(wires >= 1, 'and still draws', `${wires} wire path(s)`);
  }

  // --- drawing ---
  {
    await page.selectOption('#ant', 'dipole');
    await page.selectOption('#cut', '20m');
    await page.selectOption('#op', '20m');
    const counts = await page.evaluate(() => ({
      diagram: document.querySelectorAll('#diagram svg polyline.wire').length,
      feed: document.querySelectorAll('#diagram svg circle.feed').length,
      elev: document.querySelectorAll('#elev svg polyline.trace').length,
      marker: document.querySelectorAll('#elev svg line.marker').length,
      azim: document.querySelectorAll('#azim svg polygon.trace').length,
    }));
    t.check(counts.diagram === 1 && counts.feed === 1, 'the construction diagram draws',
      JSON.stringify(counts));
    t.check(counts.elev === 2, 'the elevation plot draws its trace and its envelope');
    t.check(counts.marker === 2, 'with the required take-off angle marked on both sides');
    t.check(counts.azim === 1, 'and the azimuth plot draws');

    // No hardcoded colour may appear in the plots: everything comes from tokens
    // via CSS, which is what makes the page work in all three themes.
    const inline = await page.evaluate(() =>
      [...document.querySelectorAll('#diagram svg *, #elev svg *, #azim svg *')]
        .filter((e) => e.getAttribute('style') || e.getAttribute('fill')?.startsWith('#')
          || e.getAttribute('stroke')?.startsWith('#')).length);
    t.check(inline === 0, 'and no element carries a hardcoded colour', `${inline} found`);

    const stroke = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#elev svg polyline.trace.main')).stroke);
    t.check(stroke !== '' && stroke !== 'none', 'the trace resolves to a real colour', stroke);
  }

  // --- and it has to work in all three themes, not just the one it was built in ---
  {
    const seen = [];
    for (const theme of ['field-dark', 'field-light', 'night-ops']) {
      const got = await page.evaluate((th) => {
        document.documentElement.setAttribute('data-theme', th);
        const cs = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
        return {
          trace: cs('#elev svg polyline.trace.main', 'stroke'),
          ring: cs('#elev svg .ring', 'stroke'),
          wire: cs('#diagram svg polyline.wire', 'stroke'),
          bg: getComputedStyle(document.body).backgroundColor,
        };
      }, theme);
      const unresolved = Object.entries(got).filter(
        ([, v]) => !v || v === 'none' || v === 'rgba(0, 0, 0, 0)');
      t.check(unresolved.length === 0, `${theme}: every plot colour resolves`,
        unresolved.map(([k]) => k).join(', '));
      t.check(got.trace !== got.bg, `${theme}: the trace is not the background colour`, got.trace);
      seen.push(got.bg);
    }
    t.check(new Set(seen).size === 3, 'and the three themes are actually different',
      seen.join(' / '));
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'field-dark'));
  }

  // --- every antenna in the catalogue survives the page ---
  {
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('#ant option')].map((o) => o.value));
    t.check(ids.length >= 12, 'the catalogue is populated', `${ids.length} antennas`);
    let broke = null;
    for (const id of ids) {
      for (const band of ['160m', '20m', '6m']) {
        await page.selectOption('#ant', id);
        await page.selectOption('#op', band);
        const ok = await page.evaluate(() => {
          const g = document.querySelector('#stats .stat .v')?.textContent;
          return document.querySelectorAll('#elev svg polyline.trace').length === 2
            && g !== undefined && Number.isFinite(Number(g));
        });
        if (!ok) { broke = `${id} @ ${band}`; break; }
      }
      if (broke) break;
    }
    t.check(broke === null, 'every antenna renders on every band', broke ?? '');
  }

  // --- state survives a reload, so a session is not thrown away ---
  {
    await page.selectOption('#ant', 'ground-plane');
    await page.selectOption('#op', '15m');
    await setRange(page, 'dist', 5500);
    await ready(page, origin);
    t.check(await page.inputValue('#ant') === 'ground-plane', 'the antenna is remembered');
    t.check(await page.inputValue('#op') === '15m', 'and the band');
    t.check(await page.inputValue('#dist') === '5500', 'and the path length');

    // Parameters are per-antenna: an inverted V's apex height must not follow
    // you to a dipole, which shares the parameter's id but not its meaning.
    await page.selectOption('#ant', 'dipole');
    await page.selectOption('#op', '20m');
    await setRange(page, 'p_height', 9);
    await page.selectOption('#ant', 'inverted-v');
    await setRange(page, 'p_height', 20);
    await page.selectOption('#ant', 'dipole');
    const h = await page.inputValue('#p_height');
    t.check(h === '9', 'and each antenna keeps its own parameters', `dipole height ${h}`);
  }

  t.check(errs.length === 0, 'no page errors throughout', errs.slice(0, 2).join('; '));
  await ctx.close();
  return t.failures;
}
