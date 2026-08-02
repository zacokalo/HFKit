// The space weather page. Mostly a display, so the checks are about honesty:
// that every figure carries provenance, that absence is stated rather than
// blank, and that the page never implies these numbers change a prediction.

import { reporter, watchErrors } from './harness.mjs';

const bundle = (over = {}) => ({
  schema: 1,
  generatedAt: new Date(Date.now() - 300_000).toISOString(),
  solar: { ssn: 99.8, ssn6h: 98.3, sfi: 137.3, engineSsn: 100,
           observedAt: new Date(Date.now() - 600_000).toISOString() },
  geomag: {
    kp: 1,
    observedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    forecast: [
      { time: '2026-08-03T00:00:00.000Z', kp: 3.7, scale: null },
      { time: '2026-08-03T03:00:00.000Z', kp: 5.3, scale: 'G1' },
      { time: '2026-08-03T06:00:00.000Z', kp: 3, scale: null },
    ],
  },
  flux: { f107: 139, observedAt: new Date(Date.now() - 14 * 3600_000).toISOString() },
  alerts: [{ id: 'P11S', issuedAt: new Date(Date.now() - 1800_000).toISOString(),
             headline: 'Proton Event 10MeV Integral Flux exceeded 10pfu',
             message: 'Space Weather Message Code: SUMPX1\nSerial Number: 133\nVERBATIM BODY' }],
  sources: {
    essn: { ok: true, observedAt: new Date().toISOString(), ageSeconds: 600, stale: false,
            staleAfterSeconds: 10800 },
    kp: { ok: true, observedAt: new Date().toISOString(), ageSeconds: 11271, stale: false,
          staleAfterSeconds: 21600 },
    kpForecast: { ok: true, observedAt: null, ageSeconds: 0, stale: false,
                  staleAfterSeconds: null },
    f107: { ok: true, observedAt: new Date().toISOString(), ageSeconds: 50871, stale: false,
            staleAfterSeconds: 108000 },
    alerts: { ok: true, observedAt: new Date().toISOString(), ageSeconds: 1649, stale: false,
              staleAfterSeconds: null },
  },
  degraded: false,
  ...over,
});

export default async function run(browser, origin) {
  const t = reporter('space weather page');

  const open = async (body) => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 1200 } });
    const page = await ctx.newPage();
    await page.route('https://spacewx.test/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
    await page.addInitScript(() => {
      globalThis.__HFKIT_SPACEWX_URL__ = 'https://spacewx.test/space-weather.json';
    });
    const errs = watchErrors(page);
    await page.goto(`${origin}/space.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#content:not([hidden])', { timeout: 20000 });
    return { ctx, page, errs };
  };

  // --- the healthy case ---
  {
    const { ctx, page, errs } = await open(bundle());

    const cards = await page.$$eval('#cards .card', (c) => c.map((x) => ({
      k: x.querySelector('.k').textContent,
      v: x.querySelector('.v').textContent,
      age: x.querySelector('.age').textContent,
    })));
    t.check(cards.length === 4, 'four headline figures', cards.map((c) => c.k).join(' | '));
    t.check(cards.every((c) => c.age.trim().length > 0),
      'every figure carries its source and age', cards[0].age);
    t.check(cards.some((c) => c.v === '99.8'), 'effective SSN shown unrounded',
      cards.map((c) => c.v).join(' '));
    t.check(cards.some((c) => c.k.includes('KC2G')) && cards.some((c) => c.k.includes('NOAA')),
      'both flux estimates are shown, and attributed');

    const summary = await page.textContent('#summary');
    t.check(summary.length > 20, 'a plain-language summary at the top', summary);
    t.check(/quiet/i.test(summary), 'summary reflects the quiet Kp in the fixture', summary);

    t.check((await page.textContent('#fluxhead')).includes('Good'),
      'SFI 137 reads as "Good"', await page.textContent('#fluxhead'));
    t.check((await page.textContent('#kphead')).includes('Quiet'),
      'Kp 1 reads as "Quiet"', await page.textContent('#kphead'));

    // The forecast is the thing you cannot get from the map at all.
    const bars = await page.$$eval('#fc .bar', (b) => b.map((x) => x.querySelector('.kp').textContent));
    t.check(bars.length === 3, 'a bar per forecast period', bars.join(' '));
    t.check(bars.includes('5.3'), 'including the storm period', bars.join(' '));

    // Alerts must be reproduced, not summarised.
    const pre = await page.textContent('#alerts pre');
    t.check(pre.includes('VERBATIM BODY'), 'alert text is reproduced verbatim');

    const rows = await page.$$eval('#prov tbody tr',
      (r) => r.map((x) => [...x.cells].map((c) => c.textContent.trim())));
    t.check(rows.length === 5, 'provenance row per source', `${rows.length} rows`);
    t.check(rows.every((r) => r[1] === 'ok'), 'all sources ok in the healthy fixture');
    t.check(rows.some((r) => r[4] === 'not judged by age'),
      'event-driven feeds say so rather than showing a blank threshold',
      rows.map((r) => `${r[0]}=${r[4]}`).join(' | '));

    const foot = await page.textContent('footer');
    t.check(/do not change the predictions/i.test(foot),
      'page states these figures do not affect predictions');
    t.check(/rules of thumb/i.test(foot), 'and that the interpretations are rules of thumb');
    t.check(/quiet/i.test(foot), 'and that predictions assume quiet conditions');

    t.check(errs.length === 0, 'no page errors', errs.slice(0, 3).join('; '));
    await ctx.close();
  }

  // --- a storm reads as a storm, and names the latitude dependence ---
  {
    const { ctx, page } = await open(bundle({
      geomag: { kp: 6.3, observedAt: new Date().toISOString(), forecast: [] },
    }));
    t.check((await page.textContent('#kphead')).includes('G2'),
      'Kp 6.3 is labelled a moderate storm (G2)', await page.textContent('#kphead'));
    const body = await page.textContent('#kpbody');
    t.check(/latitude/i.test(body), 'and explains it depends on latitude', body.slice(0, 90));
    t.check(/storm/i.test(await page.textContent('#summary')),
      'the summary leads with the storm rather than the flux',
      await page.textContent('#summary'));
    t.check(await page.isHidden('#fcwrap'), 'the forecast section hides when there is none');
    await ctx.close();
  }

  // --- a missing source is stated, not blanked ---
  {
    const { ctx, page } = await open(bundle({
      solar: null,
      sources: { ...bundle().sources,
                 essn: { ok: false, error: 'connect ETIMEDOUT' } },
      degraded: true,
    }));
    const cards = await page.$$eval('#cards .card', (c) => c.map((x) => ({
      v: x.querySelector('.v').textContent,
      bad: x.className.includes('bad'),
    })));
    t.check(cards.some((c) => c.v === '—' && c.bad),
      'a missing figure shows an explicit dash and is marked');
    const rows = await page.$$eval('#prov tbody tr',
      (r) => r.map((x) => [...x.cells].map((c) => c.textContent.trim())));
    t.check(rows.some((r) => r[1] === 'failed'), 'the failure is named in the table',
      rows.map((r) => `${r[0]}=${r[1]}`).join(' | '));
    t.check((await page.textContent('#content')).includes('some sources missing'),
      'and the bundle line says it is degraded');
    await ctx.close();
  }

  return t.failures;
}
