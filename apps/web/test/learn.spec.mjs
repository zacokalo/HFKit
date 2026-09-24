// The Learn page. It teaches, so the checks are about whether it teaches the
// right thing: that each simulator shows the behaviour its chapter describes,
// that the wording follows the state, that nothing is drawn with a hardcoded
// colour, and that live space weather is offered with its age — or its absence
// stated — rather than slipped in.
//
// Needs no engine run, so it is quick. It does need a built site (vendor/).

import { reporter, watchErrors } from './harness.mjs';

const THEMES = ['field-dark', 'field-light', 'night-ops'];

export default async function run(browser, origin) {
  const t = reporter('learn page');

  const open = async ({ viewport = { width: 1300, height: 1000 }, worker = null, body = null,
    blockSnapshot = false, prefs = null, reducedMotion = 'no-preference' } = {}) => {
    const ctx = await browser.newContext({ viewport, reducedMotion });
    const page = await ctx.newPage();
    if (body) {
      await page.route('https://spacewx.test/**', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
    }
    await page.addInitScript((u) => { globalThis.__HFKIT_SPACEWX_URL__ = u; }, worker);
    if (prefs) {
      await page.addInitScript((p) => {
        if (!sessionStorage.getItem('seeded')) {
          localStorage.setItem('hfkit.learn.v1', JSON.stringify(p));
          sessionStorage.setItem('seeded', '1');
        }
      }, prefs);
    }
    if (blockSnapshot) await page.route('**/data/space-weather.json', (r) => r.abort());
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'warning') errs.push(`warning: ${m.text()}`); });
    const pageErrs = watchErrors(page);
    await page.goto(`${origin}/learn.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#i-plot svg');
    return { ctx, page, errs: () => [...pageErrs, ...errs] };
  };

  const text = (page, id) => page.textContent(`#${id}`);
  const setRange = (page, id, v) => page.evaluate(([i, val]) => {
    const e = document.getElementById(i);
    e.value = String(val);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const pick = async (page, group, value) => {
    await page.click(`#${group} button[data-v="${value}"]`);
    await frame(page);
  };

  // --- loads clean, links in, and every term resolves ---------------------------
  {
    const { ctx, page, errs } = await open();
    t.check(errs().length === 0, 'loads with no errors or warnings', errs().slice(0, 3).join('; '));
    const nav = await page.$eval('.sitenav a[aria-current="page"]', (a) => a.textContent);
    t.check(nav === 'Learn', 'the site nav marks Learn as the current page', nav);
    const home = await (await browser.newContext()).newPage();
    await home.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    t.check(await home.$('a.card[href="./learn.html"]') !== null, 'the landing page links to it');
    await home.context().close();

    const terms = await page.$$eval('a.term', (as) => as.map((a) => ({ term: a.dataset.term, href: a.getAttribute('href') })));
    const dead = terms.filter((x) => !x.href);
    t.check(terms.length >= 20 && dead.length === 0, 'every underlined term has a glossary entry',
      `${terms.length} terms${dead.length ? `, missing: ${dead.map((d) => d.term).join(', ')}` : ''}`);
    const ids = await page.$$eval('#g-list dt', (d) => d.map((x) => x.id));
    t.check(terms.every((x) => ids.includes(x.href.slice(1))), 'and every link lands on a glossary entry');

    const chapters = await page.$$eval('#toc li', (l) => l.length);
    const quizzes = await page.$$eval('.quiz fieldset', (f) => f.length);
    t.check(chapters === 6 && quizzes === 12, 'six chapters, two questions each', `${chapters} / ${quizzes}`);

    // No hardcoded colour anywhere in the drawings; everything is a token.
    const inline = await page.evaluate(() => [...document.querySelectorAll('svg.lp, svg.lp *')]
      .filter((e) => e.getAttribute('style') || /^#|^rgb/.test(e.getAttribute('fill') ?? '')
        || /^#|^rgb/.test(e.getAttribute('stroke') ?? '')).length);
    t.check(inline === 0, 'no drawing carries a hardcoded colour', `${inline} found`);

    // ...and each theme resolves every drawing colour to something visible.
    const seen = [];
    for (const theme of THEMES) {
      const got = await page.evaluate((th) => {
        document.documentElement.setAttribute('data-theme', th);
        const cs = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
        return {
          ray: cs('#i-plot .ray', 'stroke'),
          layer: cs('#i-plot .layer-f', 'fill'),
          muf: cs('#d-plot .muf', 'stroke'),
          window: cs('#d-plot .usable', 'fill'),
          lobe: cs('#a-plot .lobe', 'stroke'),
          needle: cs('#m-plot .needle', 'stroke'),
          wave: cs('#w-wave polyline.wave', 'stroke'),
          sun: cs('#s-sunplot .sunbody', 'stroke'),
          bg: getComputedStyle(document.body).backgroundColor,
        };
      }, theme);
      const bad = Object.entries(got).filter(([, v]) => !v || v === 'none' || v === 'rgba(0, 0, 0, 0)');
      t.check(bad.length === 0, `${theme}: every drawing colour resolves`, bad.map(([k]) => k).join(', '));
      t.check(got.ray !== got.bg && got.needle !== got.bg, `${theme}: marks are not the background colour`);
      seen.push(got.bg);
    }
    t.check(new Set(seen).size === 3, 'and the three themes are actually different', seen.join(' / '));
    await ctx.close();
  }

  // --- chapter 1: wavelength explorer -------------------------------------------
  {
    const { ctx, page } = await open();
    await pick(page, 'w-bands', '20m');
    t.check((await text(page, 'w-fout')) === '14.150 MHz', 'a band chip tunes to that band', await text(page, 'w-fout'));
    t.check((await text(page, 'w-say')).includes('20 m amateur band'), 'and says which band it is in');
    t.check((await text(page, 'w-stats')).includes('21.2 m'), 'wavelength is 300 / f', await text(page, 'w-stats'));
    await setRange(page, 'w-f', 708);   // log scale: 20.00 MHz, between bands, on WWV
    await frame(page);
    const say = await text(page, 'w-say');
    t.check(say.includes('outside the amateur bands') && say.includes('WWV'),
      'between bands it names the nearest one and who else lives there', say.slice(0, 120));
    await ctx.close();
  }

  // --- chapter 2: bounce simulator ------------------------------------------------
  {
    const { ctx, page } = await open();
    const say = () => text(page, 'i-say');
    t.check((await say()).includes('bounces off the F layer'), '20 m at 15° at noon bounces off the F layer');

    await pick(page, 'i-bands', '10m');
    await setRange(page, 'i-e', 40);
    await frame(page);
    t.check((await say()).includes('passes through into space'), '10 m at a steep angle escapes into space');
    t.check(await page.$('#i-plot .ray.escape') !== null, 'and is drawn as an escaping ray');

    await pick(page, 'i-bands', '80m');
    await setRange(page, 'i-e', 15);
    await frame(page);
    t.check((await say()).includes('soaks up'), '80 m at a low angle at noon is absorbed');
    t.check(await page.$('#i-plot .ray.lost') !== null && await page.$('#i-plot .ray.heard') === null,
      'and is drawn as too weak to hear');
    await setRange(page, 'i-h', 1);
    await frame(page);
    t.check((await say()).includes('bounces off the F layer'), 'at 01:00 the same signal gets through');
    t.check((await text(page, 'i-plot')).includes('D layer — faded'), 'with the D layer labelled as faded');

    await setRange(page, 'i-h', 12);
    await pick(page, 'i-bands', '20m');
    await page.check('#i-fan');
    await frame(page);
    t.check((await say()).includes('skip zone') && await page.$('#i-plot .zone.skip') !== null,
      'all angles on 20 m at noon show a skip zone');
    t.check((await text(page, 'i-stats')).includes('Skip zone'), 'and the stats measure it');
    t.check(await page.$eval('#i-e', (e) => e.disabled), 'the single-angle slider is disabled meanwhile');
    await pick(page, 'i-bands', '40m');
    t.check((await say()).includes('no skip zone'), '40 m at noon comes straight back down: NVIS');

    // Play a day runs once and puts the clock back where it started.
    await page.uncheck('#i-fan');
    await setRange(page, 'i-h', 9);
    await page.click('#i-play');
    await page.waitForTimeout(1500);
    const mid = Number(await page.$eval('#i-h', (e) => e.value));
    t.check(mid !== 9, 'Play a day moves the clock', `at ${mid}`);
    await page.waitForFunction(() => document.getElementById('i-play').getAttribute('aria-pressed') === 'false',
      null, { timeout: 15000 });
    t.check(Number(await page.$eval('#i-h', (e) => e.value)) === 9, 'and stops back where it started');
    await ctx.close();
  }

  // Reduced motion: steps an hour at a time, never sweeps.
  {
    const { ctx, page } = await open({ reducedMotion: 'reduce' });
    await page.click('#i-play');
    await page.waitForTimeout(800);
    const v = Number(await page.$eval('#i-h', (e) => e.value));
    t.check(Number.isInteger(v), 'with reduced motion it steps whole hours', `${v}`);
    await page.click('#i-play');
    await ctx.close();
  }

  // --- chapter 3: band clock --------------------------------------------------------
  {
    const { ctx, page } = await open();
    const chip = (label) => page.$$eval('#d-status .st', (s, l) => {
      const x = s.find((e) => e.querySelector('b').textContent === l);
      return x ? `${x.className} ${x.querySelector('span').textContent}` : null;
    }, label);
    await pick(page, 'd-dist', '3000');
    t.check((await chip('20 m')).includes('open'), 'noon, 3000 km: 20 m is open', await chip('20 m'));
    t.check((await chip('80 m')).includes('absorbed'), 'and 80 m is absorbed', await chip('80 m'));
    await pick(page, 'd-dist', '800');
    await setRange(page, 'd-h', 1);
    await frame(page);
    t.check((await chip('80 m')).includes('open'), '01:00, 800 km: 80 m is open', await chip('80 m'));
    t.check((await chip('10 m')).includes('skips'), 'and 10 m skips over', await chip('10 m'));
    t.check((await chip('80 m')).includes('good') && (await chip('10 m')).includes('closed'),
      'status carries a word as well as a colour');

    const shape = await page.$$eval('#d-table tbody tr', (r) => [r.length, r[0].cells.length]);
    t.check(shape[0] === 10 && shape[1] === 13, 'the table twin has every band and every two hours', JSON.stringify(shape));

    // Clicking the chart sets the hour.
    const box = await page.$eval('#d-plot .hit', (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
    await page.mouse.click(box[0] + box[2] * 0.75, box[1] + box[3] / 2);
    await frame(page);
    const hr = Number(await page.$eval('#d-h', (e) => e.value));
    t.check(Math.abs(hr - 18) <= 0.5, 'clicking the chart moves the clock', `${hr}`);
    await ctx.close();
  }

  // --- chapter 4: raise the dipole ---------------------------------------------------
  {
    const { ctx, page } = await open();
    await pick(page, 'a-band', '40m');
    await setRange(page, 'a-h', 5);
    await frame(page);
    const low = await text(page, 'a-say');
    t.check(low.includes('almost straight up') && low.includes('NVIS'), 'a low 40 m dipole is an NVIS antenna', low.slice(0, 90));
    t.check(low.includes('good match'), 'and a good match for 150 km');
    await pick(page, 'a-band', '20m');
    await setRange(page, 'a-h', 20);
    await pick(page, 'a-dist', '3000');
    const high = await text(page, 'a-say');
    t.check(high.includes('low angle (15°)'), 'a 20 m dipole a wavelength up leads with its low lobe', high.slice(0, 90));
    t.check(high.includes('equally strong lobe points higher'), 'and says the energy splits', high.slice(90, 220));
    t.check(await page.$$eval('#a-plot .need', (n) => n.length) >= 2, 'the needed angle is marked');
    await ctx.close();
  }

  // --- chapter 5: S-meter --------------------------------------------------------------
  {
    const { ctx, page } = await open();
    const dbm = async () => Number((await page.$$eval('#m-stats .u', (u) => u[0].textContent)).replace(/[^\d.-]/g, ''));
    t.check((await page.$$eval('#m-stats .v', (v) => v[0].textContent)) === 'S8', '100 W into a dipole reads S8');
    const before = await dbm();
    await pick(page, 'm-wchips', '1500');
    const after = await dbm();
    t.check(Math.abs(after - before - 12) <= 1, '15x the power is about +12 dB, two S-units', `${before} -> ${after}`);
    await pick(page, 'm-wchips', '100');
    await pick(page, 'm-ant', 'whip');
    await pick(page, 'm-env', 'city');
    const s = await text(page, 'm-say');
    t.check(s.includes('Buried') && s.includes('FT8 would still decode it'), 'a car whip into a city is buried, but FT8 gets through', s.slice(0, 100));
    await pick(page, 'm-env', 'quiet');
    t.check(!(await text(page, 'm-say')).includes('Buried'), 'the same signal into quiet countryside is not');
    await ctx.close();
  }

  // --- chapter 6: sun and storms --------------------------------------------------------
  {
    const { ctx, page } = await open();
    await setRange(page, 's-kp', 7);
    await frame(page);
    const paths = await text(page, 's-paths');
    t.check(paths.includes('Polar pathlikely closed') && paths.includes('Low-latitude pathdegraded'),
      'Kp 7 closes polar paths and only degrades low-latitude ones', paths);
    t.check((await text(page, 's-kpout')).includes('G3'), 'and names the G-scale');
    t.check((await text(page, 's-say')).includes('storm'), 'the summary leads with the storm');
    await ctx.close();
  }

  // --- live space weather: offered with its age, or its absence stated ------------------
  {
    const { ctx, page, errs } = await open({ blockSnapshot: true });
    await page.waitForFunction(() => document.getElementById('s-live').textContent.length > 0, null, { timeout: 15000 });
    const hint = await text(page, 'i-today');
    t.check(hint.includes('No figures'), 'with no feed, the tools say so', hint);
    t.check(await page.$('#i-today button') === null, 'and offer no "today" button');
    t.check(errs().every((e) => e.includes('space-weather.json')), 'and nothing else breaks', errs().join('; '));
    await ctx.close();
  }
  {
    const body = {
      schema: 1, generatedAt: new Date(Date.now() - 120_000).toISOString(),
      solar: { ssn: 142.7, sfi: 190.2, engineSsn: 145, observedAt: new Date(Date.now() - 20 * 60_000).toISOString() },
      geomag: { kp: 4.3, observedAt: new Date(Date.now() - 3600_000).toISOString(), forecast: [] },
      flux: { f107: 188, observedAt: new Date().toISOString() },
      alerts: [], sources: {}, degraded: false,
    };
    const { ctx, page } = await open({ worker: 'https://spacewx.test/space-weather.json', body });
    await page.waitForSelector('#i-today button', { timeout: 15000 });
    const hint = await text(page, 'i-today');
    t.check(hint.includes('SSN 143') && hint.includes('KC2G') && hint.includes('ago'),
      'live SSN is offered with its source and age', hint);
    t.check(Number(await page.$eval('#i-s', (e) => e.value)) === 100, 'but not applied until asked');
    await page.click('#i-today button');
    await frame(page);
    t.check(Number(await page.$eval('#i-s', (e) => e.value)) === 145, 'and applied when asked');
    const live = await text(page, 's-live');
    t.check(live.includes('solar flux 190') && live.includes('Kp 4.3') && live.includes('ago'),
      'the sun chapter shows today’s figures with their ages', live);
    await page.click('#s-live button');
    await frame(page);
    t.check(Number(await page.$eval('#s-kp', (e) => e.value)) === 4, 'and can set its sliders to them');
    await ctx.close();
  }

  // --- quiz progress, preferences, definitions --------------------------------------------
  {
    const { ctx, page } = await open({ prefs: {} });
    const qs = await page.$$('#waves fieldset.q');
    await (await qs[0].$$('button'))[0].click();
    t.check((await qs[0].textContent()).includes('Not quite'), 'a wrong answer says so and allows another go');
    t.check(await page.$eval('#waves .ch-done', (e) => e.hidden), 'and does not complete the chapter');
    await (await qs[0].$$('button'))[1].click();
    await (await qs[1].$$('button'))[1].click();
    t.check(!(await page.$eval('#waves .ch-done', (e) => e.hidden)), 'two right answers complete the chapter');
    t.check((await text(page, 'toc')).includes('done'), 'and tick it off in the contents');

    await page.click('#pref-theme button[data-v="night-ops"]');
    await page.click('#pref-text button[data-v="large"]');
    const size = await page.$eval('#waves .prose', (e) => parseFloat(getComputedStyle(e).fontSize));
    await page.reload({ waitUntil: 'networkidle' });
    const after = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      text: document.documentElement.getAttribute('data-text'),
      done: !document.querySelector('#waves .ch-done').hidden,
    }));
    t.check(after.theme === 'night-ops' && after.text === 'large' && after.done,
      'theme, text size and progress survive a reload', JSON.stringify(after));
    t.check(size >= 22, 'larger text really is larger', `${size}px`);
    await page.click('#reset-progress');
    t.check(await page.$eval('#waves .ch-done', (e) => e.hidden), 'Start over clears progress');

    const term = page.locator('#ionosphere a.term[data-term="MUF"]').first();
    await term.hover();
    const tip = await page.textContent('#termtip');
    t.check(tip.startsWith('MUF') && tip.includes('Maximum Usable Frequency') && !tip.includes('null'),
      'hovering a term shows its definition', tip.slice(0, 60));
    await term.click();
    t.check(await page.$('#termtip a[data-gloss]') !== null, 'tapping pins it, with a link to the glossary');
    await page.keyboard.press('Escape');
    t.check(await page.$eval('#termtip', (e) => e.hidden), 'Escape closes it');

    await page.fill('#g-q', 'skip');
    const shown = await page.$$eval('#g-list dt', (d) => d.map((x) => x.textContent));
    t.check(shown.includes('Skip zone') && shown.length < 6, 'the glossary search filters', shown.join(', '));
    await ctx.close();
  }

  // --- on a phone ----------------------------------------------------------------------------
  {
    const { ctx, page, errs } = await open({ viewport: { width: 360, height: 780 } });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t.check(over <= 0, 'no sideways scrolling at 360 px', `${over}px`);
    const widths = await page.$$eval('svg.lp', (s) => s.map((x) => x.getBoundingClientRect().right));
    t.check(widths.every((r) => r <= 360), 'every drawing fits the screen', `max ${Math.max(...widths)}`);
    t.check(errs().length === 0, 'and no errors', errs().slice(0, 2).join('; '));
    await ctx.close();
  }

  return t.failures;
}
