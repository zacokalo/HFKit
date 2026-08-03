// The coverage footprint on the antenna page.
//
// This is the picture the earlier work was missing: everything before it said
// "your antenna is 4.5 dB down at 12°", which is true and invisible. The checks
// here are mostly about whether the *shape* on screen matches the physics —
// a vertical must have a hole in the middle, a dipole must not.

import { reporter, watchErrors } from './harness.mjs';

const SITE = { lat: 51.5, lon: -0.1, name: 'London' };

const open = async (browser, origin, { withSite = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  const page = await ctx.newPage();
  if (withSite) {
    await page.addInitScript((tx) => {
      localStorage.setItem('hfkit.reach.session.v1', JSON.stringify({ tx }));
    }, SITE);
  }
  const errs = watchErrors(page);
  await page.goto(`${origin}/antenna.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null,
    { timeout: 20000 });
  await page.waitForTimeout(900);
  return { ctx, page, errs };
};

/** Mean brightness of a small patch of the footprint, in canvas coordinates. */
const patch = (page, fx, fy) => page.evaluate(([px, py]) => {
  const c = document.getElementById('cov');
  const x = Math.round(c.width * px), y = Math.round(c.height * py);
  const d = c.getContext('2d').getImageData(x - 6, y - 6, 12, 12).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    // Weight by alpha so the faded low-gain region reads as dark, not as
    // whatever is behind it.
    sum += ((d[i] + d[i + 1] + d[i + 2]) / 3) * (d[i + 3] / 255);
    n++;
  }
  return sum / n;
}, [fx, fy]);

const setRange = (page, id, v) => page.evaluate(([i, val]) => {
  const e = document.getElementById(i);
  e.value = String(val);
  e.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, v]);

export default async function run(browser, origin) {
  const t = reporter('coverage footprint');
  const { ctx, page, errs } = await open(browser, origin);

  // --- it draws at all ---
  {
    const painted = await page.evaluate(() => {
      const c = document.getElementById('cov');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 10) n++;
      return n;
    });
    t.check(painted > 1000, 'the footprint paints', `${painted} sampled pixels`);
    t.check((await page.textContent('#covcap')).includes('antenna gain only'),
      'and says it is antenna gain, not propagation');
    t.check(/ionosphere will put it down/.test(await page.textContent('#covcap')),
      'naming exactly what it cannot tell you');
  }

  // --- the shape has to match the physics ---
  {
    // A *low* dipole radiates straight up, so the middle of its disc — short
    // range, steep take-off — is bright. The height matters and the default
    // does not qualify: 10 m on 20 m is 0.47 λ, which peaks at about 32° and is
    // well down overhead. Set it deliberately rather than assuming.
    await page.selectOption('#ant', 'dipole');
    await page.selectOption('#cut', '20m');
    await page.selectOption('#op', '20m');
    await setRange(page, 'p_height', 5);           // ≈ 0.24 λ, fires upward
    await setRange(page, 'covrange', 4000);
    await page.waitForTimeout(700);
    const dipoleCentre = await patch(page, 0.5, 0.5);
    const dipoleMid = await patch(page, 0.5, 0.30);

    // A ground-mounted vertical has a hard null straight up, so the centre of
    // its footprint is a hole. This is the single most useful thing the picture
    // shows, and the reason a flat gain figure misleads.
    await page.selectOption('#ant', 'vertical-ground');
    await page.waitForTimeout(900);
    const vertCentre = await patch(page, 0.5, 0.5);
    const vertMid = await patch(page, 0.5, 0.30);

    t.check(vertMid > vertCentre * 1.4,
      'a vertical has a hole in the middle of its coverage',
      `centre ${vertCentre.toFixed(0)} vs mid ${vertMid.toFixed(0)}`);
    t.check(dipoleCentre > vertCentre * 1.4,
      'and a low dipole fills that hole where the vertical cannot',
      `dipole ${dipoleCentre.toFixed(0)} vs vertical ${vertCentre.toFixed(0)}`);
    t.check(dipoleMid > 0 && vertMid > 0, 'both cover the mid ranges');
  }

  // --- direction ---
  {
    await page.selectOption('#ant', 'dipole');
    await setRange(page, 'covorient', 90);          // wire east–west
    await page.waitForTimeout(700);
    t.check(await page.evaluate(() => !document.getElementById('covorow').hidden),
      'a wire antenna offers an orientation control');
    const northEW = await patch(page, 0.5, 0.28);
    const eastEW = await patch(page, 0.72, 0.5);
    t.check(northEW > eastEW * 1.2,
      'an east–west wire is brightest to the north and south',
      `N ${northEW.toFixed(0)} vs E ${eastEW.toFixed(0)}`);

    await setRange(page, 'covorient', 0);           // wire north–south
    await page.waitForTimeout(700);
    const northNS = await patch(page, 0.5, 0.28);
    const eastNS = await patch(page, 0.72, 0.5);
    t.check(eastNS > northNS * 1.2,
      'turning the wire through 90° turns the footprint with it',
      `N ${northNS.toFixed(0)} vs E ${eastNS.toFixed(0)}`);

    await page.selectOption('#ant', 'vertical-ground');
    await page.waitForTimeout(900);
    t.check(await page.evaluate(() => document.getElementById('covorow').hidden),
      'an omnidirectional antenna hides the control it has no use for');
  }

  // --- the map and the verdict above it are the same question ---
  {
    await page.selectOption('#ant', 'dipole');
    await setRange(page, 'covrange', 4000);
    await setRange(page, 'dist', 2000);
    await page.waitForTimeout(700);
    t.check((await page.textContent('#covcap')).includes('2,000 km'),
      'the caption names the distance the target ring marks',
      (await page.textContent('#covcap')).slice(0, 80));
    await setRange(page, 'dist', 6000);
    await page.waitForTimeout(600);
    t.check((await page.textContent('#covcap')).includes('6,000 km'),
      'and follows the distance slider');
  }

  // --- range control ---
  {
    await setRange(page, 'covrange', 20000);
    await page.waitForTimeout(700);
    t.check((await page.textContent('#covrangeval')).includes('20,000'),
      'the range readout tracks the slider', await page.textContent('#covrangeval'));
    await setRange(page, 'covrange', 1000);
    await page.waitForTimeout(700);
    t.check((await page.textContent('#covrangeval')).includes('1,000'), 'in both directions');
  }

  // --- geography, and its absence ---
  {
    t.check(/reach-map transmitter/.test(await page.textContent('#covsite')),
      'with a saved transmitter the map is centred on it');
    t.check(/never sent anywhere/.test(await page.textContent('#covsite')),
      'and says the location does not leave the browser');
    await ctx.close();
  }
  {
    const { ctx: c2, page: p2 } = await open(browser, origin, { withSite: false });
    t.check(/Set a transmitter on the reach map/.test(await p2.textContent('#covsite')),
      'without one it says how to get geography');
    t.check(/still the correct footprint/.test(await p2.textContent('#covsite')),
      'and that the plot is valid regardless');
    const painted = await p2.evaluate(() => {
      const c = document.getElementById('cov');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 10) n++;
      return n;
    });
    t.check(painted > 1000, 'and it still draws', `${painted} pixels`);
    await c2.close();
  }

  // --- field mode gets a field-sized map ---
  {
    const { ctx: c3, page: p3, errs: e3 } = await open(browser, origin);
    await p3.click('#mode button[data-mode=field]');
    await p3.waitForTimeout(1100);
    const range = Number((await p3.textContent('#covrangeval')).replace(/[^\d]/g, ''));
    t.check(range <= 3000, 'field mode opens on a short range, not an intercontinental one',
      `${range} km`);
    t.check(await p3.evaluate(() => Number(document.getElementById('covrange').max) <= 3000),
      'and the slider cannot be dragged out to 20,000 km');
    const painted = await p3.evaluate(() => {
      const c = document.getElementById('cov');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 10) n++;
      return n;
    });
    t.check(painted > 1000, 'and the NVIS footprint draws');
    t.check(e3.length === 0, 'no page errors in field mode', e3.slice(0, 2).join('; '));
    await c3.close();
  }

  t.check(errs.length === 0, 'no page errors throughout', errs.slice(0, 2).join('; '));
  return t.failures;
}
