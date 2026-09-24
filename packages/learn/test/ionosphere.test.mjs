// The teaching model is not a prediction, but it must never teach something
// false. These tests pin the *behaviours* a beginner is meant to take away —
// each one is a sentence the Learn page says out loud — plus the handful of
// published formulas the model uses verbatim.
//
// If one fails, the page is now teaching the wrong lesson.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  absorptionDb, bandStatus, dayCurve, daylight, elevationForHopDeg, f2Activity,
  hopDistanceKm, hopsFor, incidenceDeg, ionosphere, legPoints, lufMHz, mufAtAngleMHz,
  mufMHz, reflection, skipDistanceKm, solarZenithDeg, traceRay, EARTH_RADIUS_KM,
  MIN_ELEVATION_DEG,
} from '../ionosphere.mjs';

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

const NOON = ionosphere({ hour: 12, ssn: 100 });
const MIDNIGHT = ionosphere({ hour: 0, ssn: 100 });

describe('the sun', () => {
  test('rises at 06:00, peaks at noon and sets at 18:00', () => {
    near(solarZenithDeg(12), 45, 1e-9, 'noon zenith at 45° latitude');
    near(solarZenithDeg(6), 90, 1e-9, 'sunrise');
    near(solarZenithDeg(18), 90, 1e-9, 'sunset');
    assert.equal(daylight(0), 0);
    near(daylight(12), 1, 1e-9, 'noon is full daylight');
  });

  test('the F layer lags the sun: weakest before dawn, strongest after noon', () => {
    const hours = Array.from({ length: 24 * 4 }, (_, i) => i / 4);
    const lo = hours.reduce((a, h) => (f2Activity(h) < f2Activity(a) ? h : a));
    const hi = hours.reduce((a, h) => (f2Activity(h) > f2Activity(a) ? h : a));
    assert.ok(lo >= 4 && lo <= 6.5, `minimum at ${lo} h`);
    assert.ok(hi > 12 && hi <= 15.5, `maximum at ${hi} h`);
  });

  test('the day wraps: 24:00 is midnight again', () => {
    near(f2Activity(24), f2Activity(0), 1e-6, 'F2 activity');
    near(ionosphere({ hour: 24, ssn: 50 }).foF2, ionosphere({ hour: 0, ssn: 50 }).foF2, 1e-6, 'foF2');
  });
});

describe('the layers', () => {
  test('foF2 is higher by day than by night, and higher with an active sun', () => {
    assert.ok(NOON.foF2 > MIDNIGHT.foF2 * 1.5, `${NOON.foF2} vs ${MIDNIGHT.foF2}`);
    assert.ok(ionosphere({ hour: 12, ssn: 200 }).foF2 > ionosphere({ hour: 12, ssn: 0 }).foF2 + 4);
  });

  test('stays in the range real mid-latitude ionosondes report', () => {
    for (const ssn of [0, 100, 200]) {
      for (let h = 0; h < 24; h += 0.5) {
        const io = ionosphere({ hour: h, ssn });
        assert.ok(io.foF2 >= 2.5 && io.foF2 <= 13, `foF2 ${io.foF2} at ${h} h, SSN ${ssn}`);
        assert.ok(io.hF >= 290 && io.hF <= 340, `hF ${io.hF}`);
      }
    }
  });

  test('foE follows the published CCIR formula at noon', () => {
    // 0.9 [(180 + 1.44 R) cos chi]^0.25 with R = 100, chi = 45°.
    near(NOON.foE, 0.9 * ((180 + 144) * Math.SQRT1_2) ** 0.25, 1e-9, 'foE');
    near(NOON.foE, 3.5, 0.1, 'about 3.5 MHz, as ionosondes see');
  });

  test('the D layer is there by day and all but gone at night', () => {
    assert.ok(NOON.absorptionIndex > 0.8);
    assert.ok(MIDNIGHT.absorptionIndex < 0.05);
  });
});

describe('hop geometry', () => {
  test('matches the antenna package: 2000 km off 300 km needs 11.8°', () => {
    // Pinned in packages/antenna/test/physics.test.mjs too. The two models
    // must agree on geometry or the Learn page contradicts the antenna page.
    near(elevationForHopDeg(2000, 300), 11.8, 0.1, 'take-off angle');
  });

  test('hop distance and take-off angle are inverses', () => {
    for (const d of [100, 500, 1500, 3000]) {
      near(hopDistanceKm(elevationForHopDeg(d, 300), 300), d, 1e-6, `${d} km`);
    }
  });

  test('straight up lands where it started; low angles land far away', () => {
    near(hopDistanceKm(90, 300), 0, 1e-6, 'vertical');
    const far = hopDistanceKm(MIN_ELEVATION_DEG, 300);
    assert.ok(far > 3000 && far < 4000, `lowest-angle hop ${far} km`);
  });

  test('a curved Earth makes the layer meet the ray at a slant', () => {
    assert.ok(incidenceDeg(0, 300) < 90);
    near(incidenceDeg(90, 300), 0, 1e-9, 'vertical incidence');
  });

  test('long paths take more than one hop', () => {
    assert.equal(hopsFor(1000, 300), 1);
    assert.ok(hopsFor(8000, 300) >= 3);
  });

  test('a drawn leg starts on the ground and ends at the layer', () => {
    const pts = legPoints(20, 300);
    near(pts[0][1], 0, 1e-6, 'start altitude');
    near(pts.at(-1)[1], 300, 1e-6, 'apex altitude');
    near(pts.at(-1)[0], hopDistanceKm(20, 300) / 2, 1e-6, 'apex is half a hop out');
  });
});

describe('what happens to a ray', () => {
  test('above the MUF for its angle, it escapes into space', () => {
    const muf = mufAtAngleMHz(30, NOON);
    assert.equal(traceRay({ fMHz: muf * 1.05, elevationDeg: 30, iono: NOON }).fate, 'escapes');
    assert.notEqual(traceRay({ fMHz: muf * 0.95, elevationDeg: 30, iono: NOON }).fate, 'escapes');
  });

  test('below foF2 even a vertical ray comes back — which is NVIS', () => {
    const r = traceRay({ fMHz: NOON.foF2 * 0.8, elevationDeg: 85, iono: NOON });
    assert.equal(r.fate, 'reflects');
    assert.ok(r.hops[0].landKm < 200, `lands at ${r.hops[0].landKm} km`);
  });

  test('80 m at a low angle at noon is absorbed; at midnight it is heard', () => {
    assert.equal(traceRay({ fMHz: 3.6, elevationDeg: 15, iono: NOON }).fate, 'absorbed');
    assert.equal(traceRay({ fMHz: 3.6, elevationDeg: 15, iono: MIDNIGHT }).fate, 'reflects');
  });

  test('20 m at noon crosses a continent in a few hops', () => {
    const r = traceRay({ fMHz: 14.2, elevationDeg: 10, iono: NOON });
    assert.equal(r.fate, 'reflects');
    assert.ok(r.hops.filter((h) => h.heard).at(-1).landKm > 4000);
  });

  test('absorption falls steeply with frequency', () => {
    // Four times the frequency, about a seventh of the loss: the formula's
    // constant term softens a pure inverse square at the low end.
    const a4 = absorptionDb(3.6, 20, NOON), a14 = absorptionDb(14.2, 20, NOON);
    assert.ok(a4 > 6 * a14, `${a4} vs ${a14}`);
  });

  test('absorption gets worse at low angles, which spend longer in the D layer', () => {
    assert.ok(absorptionDb(7.1, 5, NOON) > 3 * absorptionDb(7.1, 80, NOON));
  });

  test('the E layer can turn a daytime low-band ray back before it reaches F', () => {
    assert.equal(reflection(3.6, 15, NOON)?.layer, 'E');
    assert.equal(reflection(3.6, 15, MIDNIGHT)?.layer, 'F');
  });

  test('loss accumulates hop by hop, so each landing is weaker', () => {
    const r = traceRay({ fMHz: 14.2, elevationDeg: 10, iono: NOON });
    for (let i = 1; i < r.hops.length; i++) assert.ok(r.hops[i].lossDb > r.hops[i - 1].lossDb);
  });
});

describe('the usable window', () => {
  test('the MUF climbs with distance — about three times foF2 at 3000 km', () => {
    assert.ok(mufMHz(100, NOON) < mufMHz(1000, NOON));
    assert.ok(mufMHz(1000, NOON) < mufMHz(3000, NOON));
    const m = mufMHz(3000, NOON) / NOON.foF2;
    assert.ok(m > 2.8 && m < 3.6, `M(3000) = ${m}`);
  });

  test('the LUF is a daytime phenomenon', () => {
    assert.ok(lufMHz(1000, NOON) > 4);
    assert.ok(lufMHz(1000, MIDNIGHT) < 2);
  });

  test('the skip zone grows with frequency, and vanishes below foF2', () => {
    assert.equal(skipDistanceKm(NOON.foF2 * 0.9, NOON), 0);
    const s14 = skipDistanceKm(14.2, NOON), s21 = skipDistanceKm(21.2, NOON);
    assert.ok(s14 > 0 && s21 > s14, `${s14} then ${s21}`);
    assert.equal(skipDistanceKm(60, NOON), Infinity);
  });

  test('the skip distance is where a ray at exactly the MUF lands', () => {
    const f = 14.2, skip = skipDistanceKm(f, NOON);
    const angle = elevationForHopDeg(skip, NOON.hF);
    near(mufAtAngleMHz(angle, NOON), f, 0.01, 'MUF at the skip angle');
  });

  test('the classic lessons hold at moderate solar activity', () => {
    // 20 m open to 3000 km at noon; 80 m absorbed on the same path.
    assert.equal(bandStatus(14.2, 3000, NOON).status, 'open');
    assert.equal(bandStatus(3.6, 3000, NOON).status, 'absorbed');
    // 80 m regional works at night; 10 m to the same place skips.
    assert.equal(bandStatus(3.6, 800, MIDNIGHT).status, 'open');
    assert.equal(bandStatus(28.4, 800, MIDNIGHT).status, 'skips');
    // NVIS on 40 m at noon, but not on 20 m.
    assert.notEqual(bandStatus(7.1, 150, NOON).status, 'skips');
    assert.equal(bandStatus(14.2, 150, NOON).status, 'skips');
  });

  test('a day curve covers 00:00 to 24:00 with a daytime window above the night one', () => {
    const c = dayCurve(2000, 100, { stepHours: 1 });
    assert.equal(c.length, 25);
    assert.ok(c[13].muf > c[4].muf);
    assert.ok(c[12].luf > c[0].luf);
  });

  test('the Earth radius is the one the antenna package uses', () => {
    assert.equal(EARTH_RADIUS_KM, 6371);
  });
});
