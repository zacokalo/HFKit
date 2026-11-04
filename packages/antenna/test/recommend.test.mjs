// The comms planner's reasoning, pinned against numbers that can be checked.
//
// Nothing here needs the propagation engine: where an engine result is needed
// it is a synthetic margin table, which is the point — the ranking logic has to
// be right independently of what the ionosphere does.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  candidateElevations, greatCircleKm, initialBearingDeg,
} from '../physics.mjs';
import { buildAntenna, byId, cautions } from '../catalogue.mjs';
import {
  VERDICT, bestOrientation, combine, compassName, describePath, estimatedLoss,
  evaluateAntenna, geometryFollowsDesign, powerOffsetDb, recommend, setupSteps,
  verdictFor, windows,
} from '../recommend.mjs';
import { analyse } from '../physics.mjs';

const BOSTON = { lat: 42.36, lon: -71.06 };
const LONDON = { lat: 51.51, lon: -0.13 };
const DENVER = { lat: 39.74, lon: -104.99 };

describe('path geometry', () => {
  test('Boston to London is about 5,260 km on a bearing near 53°', () => {
    const km = greatCircleKm(BOSTON, LONDON);
    assert.ok(Math.abs(km - 5260) < 30, `${km} km`);
    const brg = initialBearingDeg(BOSTON, LONDON);
    assert.ok(Math.abs(brg - 53) < 1, `${brg}°`);
  });

  test('bearing is directional: the reverse path points back west', () => {
    const back = initialBearingDeg(LONDON, BOSTON);
    assert.ok(back > 270 && back < 300, `${back}°`);
  });

  test('candidate elevations: one and two hops for a 2,000 km path', () => {
    const e = candidateElevations(2000);
    assert.equal(e.length, 2);
    assert.ok(Math.abs(e[0] - 11.8) < 0.5, `${e[0]}°`);   // the number in physics.mjs
    assert.ok(e[1] > e[0]);
  });

  test('a very short path is straight up and nothing is below 3°', () => {
    assert.deepEqual(candidateElevations(0.5), [90]);
    for (const km of [500, 3800, 9000]) for (const e of candidateElevations(km)) assert.ok(e >= 3);
  });

  test('describePath bundles distance, bearing, hops and elevations', () => {
    const p = describePath(BOSTON, DENVER);
    assert.ok(p.distanceKm > 2800 && p.distanceKm < 2900, `${p.distanceKm}`);
    assert.equal(p.hops, 1);
    assert.equal(compassName(p.bearingDeg), 'W');
  });
});

describe('losses the pattern cannot see', () => {
  test('every caution that states a loss carries it as a number', () => {
    const whip = buildAntenna(byId('whip-manpack'), { designMHz: 3.5, operatingMHz: 3.5 });
    const short = whip.cautions.find((c) => c.code === 'short');
    assert.ok(short, 'a 3 m whip on 80 m is electrically short');
    assert.equal(short.lossDb.length, 2);
    assert.ok(short.lossDb[0] > 0 && short.lossDb[1] >= short.lossDb[0]);
    // The numbers in the prose are the numbers in the field.
    assert.ok(short.text.includes(short.lossDb[0].toFixed(1)), short.text);

    const tfd = buildAntenna(byId('field-tfd'), { designMHz: 5, operatingMHz: 5 });
    assert.deepEqual(tfd.cautions.find((c) => c.code === 'terminated').lossDb, [3, 6]);
  });

  test('a ground-mounted vertical loses less with more radials', () => {
    const few = buildAntenna(byId('vertical-ground'), { designMHz: 7.1, operatingMHz: 7.1, params: { radials: 4 } });
    const many = buildAntenna(byId('vertical-ground'), { designMHz: 7.1, operatingMHz: 7.1, params: { radials: 32 } });
    assert.ok(estimatedLoss(few).mid > estimatedLoss(many).mid);
  });

  test('NVIS height is the design, not a loss to be fixed', () => {
    const nvis = buildAntenna(byId('nvis-dipole'), { designMHz: 5, operatingMHz: 5 });
    const info = cautions(nvis).find((c) => c.code === 'ground-nvis');
    assert.equal(info.severity, 'info');
    const ev = evaluateAntenna({ antenna: byId('nvis-dipole'), freqsMHz: [5], paths: [describePath(BOSTON, { lat: 42.9, lon: -71.6 })] });
    assert.ok(!ev.bands[0].antennaReasons.some((r) => r.code === 'ground-nvis'));
  });

  test('the sum is capped so three cautions cannot bury an antenna', () => {
    const fake = { cautions: [{ lossDb: [5, 8] }, { lossDb: [5, 8] }, { lossDb: [5, 8] }] };
    const l = estimatedLoss(fake);
    assert.equal(l.hi, 12);
    assert.equal(l.lo, 12);
  });
});

describe('orientation', () => {
  test('a dipole is turned broadside to a single site', () => {
    const east = { distanceKm: 1500, bearingDeg: 90, elevations: candidateElevations(1500), hops: 1 };
    const built = buildAntenna(byId('dipole'), { designMHz: 14.15, operatingMHz: 14.15, params: { height: 12 } });
    const pattern = analyse(built.paths, 14.15, { perWavelength: 16 });
    const o = bestOrientation(pattern, [east]);
    // Broadside to east means the wire runs north–south: 0° (or 180°, same wire).
    assert.ok(o.orientationDeg === 0 || o.orientationDeg === 180, `${o.orientationDeg}°`);
  });

  test('two sites 90° apart get a compromise, and the result names it', () => {
    const north = { distanceKm: 1500, bearingDeg: 0, elevations: candidateElevations(1500), hops: 1 };
    const east = { distanceKm: 1500, bearingDeg: 90, elevations: candidateElevations(1500), hops: 1 };
    const ev = evaluateAntenna({ antenna: byId('dipole'), params: { height: 12 }, freqsMHz: [14.15], paths: [north, east] });
    const b = ev.bands[0];
    assert.ok(b.directional, 'a dipole 0.57 λ up is directional at 12°');
    assert.ok(b.orientationDeg % 45 === 0 && (b.orientationDeg === 45 || b.orientationDeg === 135), `${b.orientationDeg}°`);
    // Both sites then sit 45° off broadside and pay about the same.
    assert.ok(Math.abs(b.perSite[0].gainDbi - b.perSite[1].gainDbi) < 1);
  });

  test('a vertical is not directional and keeps the default orientation', () => {
    const east = { distanceKm: 1500, bearingDeg: 90, elevations: candidateElevations(1500), hops: 1 };
    const ev = evaluateAntenna({ antenna: byId('vertical-ground'), freqsMHz: [7.1], paths: [east] });
    assert.equal(ev.bands[0].directional, false);
    assert.equal(ev.bands[0].orientationDeg, 90);
  });
});

describe('why an antenna will not work', () => {
  const near = describePath(BOSTON, { lat: 42.9, lon: -71.6 });     // ~75 km
  const far = describePath(BOSTON, LONDON);                            // ~5,260 km

  test('a ground-mounted vertical cannot serve the next valley', () => {
    const ev = evaluateAntenna({ antenna: byId('vertical-ground'), freqsMHz: [5.3], paths: [near], siteNames: ['Camp'] });
    const r = ev.bands[0].perSite[0].reasons.find((x) => x.code === 'angle-too-low');
    assert.ok(r, JSON.stringify(ev.bands[0].perSite[0].reasons));
    assert.equal(r.severity, 'blocker');
    assert.match(r.fix, /NVIS/);
    assert.match(r.text, /Camp needs a 8\d° take-off/);
  });

  test('a low dipole is told to go higher for London, with the height in metres', () => {
    const ev = evaluateAntenna({ antenna: byId('dipole'), params: { height: 5 }, freqsMHz: [14.15], paths: [far] });
    const r = ev.bands[0].perSite[0].reasons.find((x) => x.code === 'angle-too-high');
    assert.ok(r, JSON.stringify(ev.bands[0].perSite[0].reasons));
    assert.match(r.fix, /Raise it: at half a wavelength \(10\.6 m here\)/);
  });

  test('an NVIS inverted V on 60 m reaches the next valley with nothing to complain about', () => {
    const ev = evaluateAntenna({ antenna: byId('nvis-inverted-v'), freqsMHz: [5.3], paths: [near] });
    assert.equal(ev.bands[0].perSite[0].reasons.length, 0);
    assert.ok(ev.bands[0].perSite[0].downFromPeakDb < 1);
  });

  test('a site off the end of the wire is named, with the bearing that would fix it', () => {
    const east = { distanceKm: 1500, bearingDeg: 90, elevations: candidateElevations(1500), hops: 1 };
    const ev = evaluateAntenna({ antenna: byId('dipole'), params: { height: 12 }, freqsMHz: [14.15], paths: [east], orientationDeg: 90, siteNames: ['Relay'] });
    const r = ev.bands[0].perSite[0].reasons.find((x) => x.code === 'off-axis');
    assert.ok(r, 'a wire laid east–west has Relay off its end');
    assert.match(r.text, /Relay lies 90° off/);
    assert.match(r.fix, /faces 90° \(E\)/);
  });

  test('a manpack whip on 80 m is flagged as electrically short, with the loss', () => {
    const ev = evaluateAntenna({ antenna: byId('whip-manpack'), freqsMHz: [3.65], paths: [far] });
    const r = ev.bands[0].antennaReasons.find((x) => x.code === 'short');
    assert.ok(r);
    assert.ok(r.lossDb[1] > 5, `${r.lossDb}`);
    assert.match(r.fix, /counterpoise/);
  });
});

describe('combining with the engine', () => {
  test('power is an exact offset', () => {
    assert.equal(powerOffsetDb(100), 0);
    assert.ok(Math.abs(powerOffsetDb(1000) - 10) < 1e-9);
    assert.ok(Math.abs(powerOffsetDb(5) + 13.01) < 0.01);
  });

  test('the per-hour minimum across sites is what counts, and a null hour is null', () => {
    const bandEval = { perSite: [{ effectiveDbi: 2 }, { effectiveDbi: -4 }] };
    const engine = [[10, 0, null], [8, 5, 3]];
    const out = combine(bandEval, engine);
    assert.deepEqual(out.map((h) => h.min), [4, 1, null]);
    assert.deepEqual(combine(bandEval, engine, 10).map((h) => h.min), [14, 11, null]);
  });

  test('windows merge across midnight and read as UTC ranges', () => {
    const v = [1, 1, -1, -1, 2, 2, 2, -5, 1];
    assert.deepEqual(windows(v).map((w) => w.text), ['08Z–01Z', '04Z–06Z']);
    assert.deepEqual(windows([-1, -1]), []);
  });

  test('verdict thresholds are the ones the page legend states', () => {
    assert.equal(verdictFor(6).id, 'works');
    assert.equal(verdictFor(0).id, 'marginal');
    assert.equal(verdictFor(-5).id, 'weak');
    assert.equal(verdictFor(-30).id, 'no');
    assert.equal(VERDICT.length, 4);
  });
});

describe('recommend', () => {
  const near = describePath(BOSTON, { lat: 42.9, lon: -71.6 });
  const freqs = [3.65, 7.1, 14.15];
  const labels = ['80 m', '40 m', '20 m'];
  const evals = [
    evaluateAntenna({ antenna: byId('nvis-inverted-v'), freqsMHz: freqs, paths: [near], siteNames: ['Camp'] }),
    evaluateAntenna({ antenna: byId('vertical-ground'), freqsMHz: freqs, paths: [near], siteNames: ['Camp'] }),
  ];

  test('with no engine it ranks on geometry and says so', () => {
    const r = recommend({ evaluations: evals, bandLabels: labels });
    assert.equal(r.geometryOnly, true);
    assert.equal(r.best.antennaId, 'nvis-inverted-v');
    assert.equal(r.ranked[1].best.verdict.id, 'no');
  });

  test('with an engine it picks the band that is open now, and explains a closed one', () => {
    // 80 m: +12 all day; 40 m: closed at hour 0, open later; 20 m: closed.
    const hours = (a, b, c) => Array.from({ length: 24 }, (_, h) => [a, h < 6 ? -20 : b, c]);
    const engine = [hours(12, 15, -25)];
    const r = recommend({ evaluations: evals, engine, nowHour: 2, bandLabels: labels });
    assert.equal(r.best.antennaId, 'nvis-inverted-v');
    assert.equal(r.best.best.label, '80 m');
    assert.equal(r.best.best.verdict.id, 'works');
    assert.equal(r.best.best.hoursOpen, 24);
    assert.equal(r.best.perBand[1].open[0].text, '06Z–23Z');

    // At QRP the same band may drop a tier, and the reason names the power.
    const qrp = recommend({ evaluations: evals, engine, nowHour: 2, bandLabels: labels, powerOffsetDb: powerOffsetDb(5) });
    assert.ok(qrp.best.best.nowMargin < r.best.best.nowMargin - 12);
  });

  test('a band closed by the ionosphere is blamed on the band, not the antenna', () => {
    const engine = [Array.from({ length: 24 }, () => [-30, -30, -30])];
    const r = recommend({ evaluations: evals.slice(0, 1), engine, nowHour: 12, bandLabels: labels });
    const closed = r.best.reasons.find((x) => x.code === 'band-closed');
    assert.ok(closed);
    assert.match(closed.text, /no antenna fixes that/);
    assert.match(closed.fix, /try another band/);
  });
});

describe('setup steps', () => {
  test('a 40 m dipole gets cut lengths, a bearing, a height and a feed note', () => {
    const far = describePath(BOSTON, LONDON);
    const antenna = byId('dipole');
    const ev = evaluateAntenna({ antenna, params: { height: 12 }, freqsMHz: [7.1], paths: [far], siteNames: ['London'] });
    const built = buildAntenna(antenna, { designMHz: 7.1, operatingMHz: 7.1, params: { height: 12 } });
    const steps = setupSteps({
      antenna, built, band: { label: '40 m' }, orientationDeg: ev.bands[0].orientationDeg,
      directional: ev.bands[0].directional, paths: [far], siteNames: ['London'], loss: ev.bands[0].loss,
    });
    assert.deepEqual(steps.map((s) => s.title), ['Cut', 'Point', 'Raise', 'Feed', 'Expect']);
    const total = steps[0].items.find((i) => i.label === 'Total length');
    assert.equal(total.value, '20.06 m');
    assert.match(steps[1].body, /Run the wire along/);
    assert.match(steps[1].items[0].value, /^53° NE$/);
    assert.match(steps[2].body, /0\.28 wavelengths on 40 m/);
    assert.match(steps[3].body, /balun|choke/);
  });

  test('a fixed-length antenna is not told to cut', () => {
    assert.equal(geometryFollowsDesign(byId('whip-manpack'), {}, 7.1), false);
    assert.equal(geometryFollowsDesign(byId('dipole'), {}, 7.1), true);
  });
});
