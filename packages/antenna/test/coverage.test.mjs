// The distance-to-elevation mapping that turns an antenna pattern into map
// coverage, and the two clamps that keep an idealisation from erasing the map.
//
// The lookup tables themselves live in apps/web/lib/antenna-gain.mjs because
// they import from vendor/, but the physics they rest on is here and is the
// part that can be got wrong quietly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyse, buildAntenna, byId, maxHopDistanceKm, minimumHops, takeoffAngle,
} from '../index.mjs';

const LAYER_KM = 300;
const MIN_ELEV = 3;
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(2)} vs ${b} (±${tol})`);

/** The same two-option rule apps/web/lib/antenna-gain.mjs applies. */
const elevations = (km, maxHops = 2) => {
  if (!(km > 1)) return [90];
  const first = minimumHops(km, LAYER_KM);
  const out = [];
  for (let h = first; h < first + maxHops; h++) {
    const e = takeoffAngle(km, { layerHeightKm: LAYER_KM, hops: h });
    if (e > 0 && e <= 90) out.push(Math.max(MIN_ELEV, e));
  }
  return out.length ? out : [MIN_ELEV];
};

describe('distance to take-off angle, across a whole map', () => {
  test('every distance a map can hold produces a usable angle', () => {
    for (let km = 0; km <= 20000; km += 137) {
      const es = elevations(km);
      assert.ok(es.length > 0, `${km} km produced nothing`);
      for (const e of es) {
        assert.ok(Number.isFinite(e) && e >= MIN_ELEV && e <= 90,
          `${km} km gave ${e}°`);
      }
    }
  });

  test('the angle falls as the path lengthens, within one hop count', () => {
    const single = [500, 1000, 1500, 2000, 2500, 3000]
      .map((d) => takeoffAngle(d, { layerHeightKm: LAYER_KM, hops: 1 }));
    for (let i = 1; i < single.length; i++) {
      assert.ok(single[i] < single[i - 1], `not monotonic: ${single.map((v) => v.toFixed(1))}`);
    }
  });

  test('a second hop option exists everywhere beyond the shortest paths', () => {
    // This is what removes the discontinuity ring: on either side of the
    // single-hop limit there are always two plausible angles to choose from.
    for (const km of [1000, 3500, 3800, 3900, 6000, 12000]) {
      assert.equal(elevations(km).length, 2, `${km} km offered only one option`);
    }
  });

  test('the hop boundary is no longer a cliff', () => {
    // With one hop only, 3700 km wants 3° and 3900 km wants 12.3° — a jump that
    // draws a hard ring across the map. Allowing the next hop count up puts a
    // common angle on both sides of the boundary.
    const below = elevations(3700), above = elevations(3900);
    const limit = maxHopDistanceKm(LAYER_KM);
    assert.ok(3700 < limit && 3900 > limit, 'the test straddles the real boundary');
    const overlap = below.some((b) => above.some((a) => Math.abs(a - b) < 3));
    assert.ok(overlap,
      `expected a shared angle across the boundary: ${below.map((v) => v.toFixed(1))} vs `
      + `${above.map((v) => v.toFixed(1))}`);
  });

  test('very long paths clamp rather than asking for zero degrees', () => {
    // A 19,000 km path wants 0.2°, where a perfect-ground model has an absolute
    // null. Clamping is what stops that null erasing the far side of the map.
    const raw = takeoffAngle(19000, { layerHeightKm: LAYER_KM, hops: minimumHops(19000, LAYER_KM) });
    assert.ok(raw < MIN_ELEV, `expected a sub-3° raw angle, got ${raw.toFixed(2)}`);
    assert.ok(elevations(19000).every((e) => e >= MIN_ELEV), 'and it must be clamped');
  });
});

describe('why the clamp is needed at all', () => {
  test('a horizontal antenna really does null out at the horizon', () => {
    // The justification for MIN_ELEVATION_DEG, stated as a test so nobody
    // removes the clamp thinking it was arbitrary.
    const built = buildAntenna(byId('dipole'), {
      designMHz: 14.1, operatingMHz: 14.1, params: { height: 10 },
    });
    const p = analyse(built.paths, 14.1, { perWavelength: 20 });
    assert.ok(p.gainAt(0, 0) < -40,
      `perfect ground should null the horizon, got ${p.gainAt(0, 0).toFixed(1)} dBi`);
    assert.ok(p.gainAt(MIN_ELEV, 0) > -12,
      `and 3° should already be usable, got ${p.gainAt(MIN_ELEV, 0).toFixed(1)} dBi`);
  });

  test('a vertical does not, which is why it wins at distance', () => {
    const built = buildAntenna(byId('vertical-ground'), {
      designMHz: 14.1, operatingMHz: 14.1, params: {},
    });
    const p = analyse(built.paths, 14.1, { perWavelength: 20 });
    assert.ok(p.gainAt(MIN_ELEV, 0) > 3,
      `a vertical should be strong at 3°, got ${p.gainAt(MIN_ELEV, 0).toFixed(1)} dBi`);
  });
});

describe('the spread the map is meant to reveal', () => {
  const gainAt = (id, params, f, km) => {
    const built = buildAntenna(byId(id), { designMHz: f, operatingMHz: f, params });
    const p = analyse(built.paths, f, { perWavelength: 20 });
    let best = -99;
    for (const e of elevations(km)) best = Math.max(best, p.gainAt(e, 0));
    return best;
  };

  test('a low dipole varies by more than 10 dB across a map', () => {
    // If this collapses, the feature has stopped saying anything and a flat
    // offset would do just as well.
    const gains = [500, 1500, 3000, 6000, 12000, 18000]
      .map((km) => gainAt('dipole', { height: 10 }, 14.1, km));
    const spread = Math.max(...gains) - Math.min(...gains);
    assert.ok(spread > 10,
      `expected a wide spread, got ${spread.toFixed(1)} dB from ${gains.map((g) => g.toFixed(1))}`);
  });

  test('a vertical beats a low dipole at long range and loses up close', () => {
    // The single most useful thing an antenna-aware coverage map can show.
    const near_ = 400, far = 12000;
    const dipoleNear = gainAt('dipole', { height: 10 }, 14.1, near_);
    const vertNear = gainAt('vertical-ground', {}, 14.1, near_);
    const dipoleFar = gainAt('dipole', { height: 10 }, 14.1, far);
    const vertFar = gainAt('vertical-ground', {}, 14.1, far);
    assert.ok(dipoleNear > vertNear,
      `close in, dipole ${dipoleNear.toFixed(1)} should beat vertical ${vertNear.toFixed(1)}`);
    assert.ok(vertFar > dipoleFar,
      `far out, vertical ${vertFar.toFixed(1)} should beat dipole ${dipoleFar.toFixed(1)}`);
  });

  test('bearing matters as much as distance for a wire', () => {
    const built = buildAntenna(byId('dipole'), {
      designMHz: 14.1, operatingMHz: 14.1, params: { height: 10 },
    });
    const p = analyse(built.paths, 14.1, { perWavelength: 20 });
    const e = elevations(8000)[0];
    const broadside = p.gainAt(e, 0), endfire = p.gainAt(e, 90);
    assert.ok(broadside - endfire > 6,
      `a flat offset hides this: ${broadside.toFixed(1)} vs ${endfire.toFixed(1)} dBi`);
  });
});
