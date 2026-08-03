// The point of these tests is that the model is *checkable*. Antenna software
// is easy to write and hard to trust: a plausible-looking polar plot can be
// wrong by 6 dB and nobody notices. So the model is pinned against results that
// were established long before this code existed and cannot quietly drift.
//
// If one of these fails, the model is wrong, not the textbook.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyse, buildSegments, countLobes, feetInches, halfPowerElevation, halfWave,
  lowestLobe, maxHopDistanceKm, metresToFeet, minimumHops, quarterWave,
  takeoffAngle, wavelength, VELOCITY_FACTOR,
} from '../physics.mjs';

const F = 14.1;
const LAM = wavelength(F);
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(3)} vs ${b} (±${tol})`);

/** A horizontal wire along the x (east–west) axis, centre-fed. */
const wire = (h, L = LAM / 2) => [{ points: [[-L / 2, 0, h], [L / 2, 0, h]], feedAt: L / 2 }];
/** A base-fed vertical. */
const vert = (H, base = 0) => [{ points: [[0, 0, base], [0, 0, base + H]], feedAt: 0 }];

describe('dimensions', () => {
  test('a half wave comes out at the handbook 468/f feet', () => {
    // 468/f is 0.95 * lambda/2 expressed in feet. If this drifts, every
    // dimension on the page drifts with it.
    for (const f of [3.65, 7.1, 14.1, 28.4]) {
      near(metresToFeet(halfWave(f)) * f, 467.2, 0.5, `${f} MHz`);
    }
  });

  test('a quarter wave comes out at 234/f feet', () => {
    near(metresToFeet(quarterWave(7.1)) * 7.1, 233.6, 0.3, '40 m');
  });

  test('the end-effect factor is applied, not forgotten', () => {
    near(halfWave(F) / (LAM / 2), VELOCITY_FACTOR, 1e-9, 'shortening');
  });

  test('lengths render the way wire actually gets measured', () => {
    assert.equal(feetInches(0.3048), '1 ft 0 in');
    assert.equal(feetInches(10), '32 ft 10 in');
  });
});

describe('hop geometry', () => {
  test('a 2000 km hop off the F2 layer needs 11.8 degrees', () => {
    near(takeoffAngle(2000, { layerHeightKm: 300 }), 11.81, 0.02, 'take-off');
  });

  test('the earth is not flat, and it matters at HF distances', () => {
    // The flat-earth approximation atan(h / (d/2)) says 16.7 degrees for the
    // same path. Believing it would have you hang a dipole for the wrong lobe.
    const flat = (Math.atan(300 / 1000) * 180) / Math.PI;
    near(flat, 16.7, 0.1, 'flat-earth angle');
    assert.ok(takeoffAngle(2000) < flat - 4,
      'spherical geometry must give a materially lower angle');
  });

  test('shorter paths need steeper angles', () => {
    const angles = [500, 1000, 2000, 3000].map((d) => takeoffAngle(d));
    for (let i = 1; i < angles.length; i++) {
      assert.ok(angles[i] < angles[i - 1], `${angles[i]} should be below ${angles[i - 1]}`);
    }
  });

  test('a single F2 hop reaches about 3800 km and no further', () => {
    near(maxHopDistanceKm(300), 3836, 20, 'max hop');
    near(takeoffAngle(maxHopDistanceKm(300)), 0, 0.01, 'angle at max hop');
  });

  test('an impossible single hop reports a negative angle rather than lying', () => {
    assert.ok(takeoffAngle(6000, { layerHeightKm: 300 }) < 0);
    assert.equal(minimumHops(6000, 300), 2);
    assert.ok(takeoffAngle(6000, { layerHeightKm: 300, hops: 2 }) > 0);
  });

  test('a low layer means a shallow angle and a short reach', () => {
    // Both directions of the same fact, and the direction is easy to get
    // backwards: the E layer is low, so a given distance off it is a *flatter*
    // shot than the same distance off F2 — and a single E hop runs out of
    // geometry at about 2350 km where F2 keeps going to 3800.
    near(takeoffAngle(1500, { layerHeightKm: 110 }), 4.89, 0.05, 'E layer');
    near(takeoffAngle(1500, { layerHeightKm: 300 }), 17.95, 0.05, 'F2 layer');
    near(maxHopDistanceKm(110), 2351, 15, 'max E hop');
  });
});

// --- the load-bearing validations ------------------------------------------
//
// Directivity here is computed by integrating the modelled pattern over the
// sphere. These four numbers are textbook constants; hitting them to a tenth
// of a dB is what earns the model the right to draw anything else.

describe('directivity against known values', () => {
  test('a half-wave dipole in free space is 2.15 dBi', () => {
    const a = analyse(wire(0), F, { ground: false, perWavelength: 40 });
    near(a.directivityDbi, 2.15, 0.05, 'free-space dipole');
  });

  test('a quarter-wave monopole over perfect ground is 5.15 dBi', () => {
    const a = analyse(vert(quarterWave(F, 1)), F, { perWavelength: 40 });
    near(a.directivityDbi, 5.15, 0.06, 'monopole');
    near(a.peak.elevationDeg, 0, 0.2, 'peak elevation');
  });

  test('a dipole high over perfect ground approaches 8.15 dBi', () => {
    const a = analyse(wire(4 * LAM), F, { perWavelength: 40 });
    near(a.directivityDbi, 8.15, 0.15, 'high dipole');
  });

  test('a full-wave centre-fed dipole is 3.8 dBi and broadside, not a null', () => {
    // The distribution that gets this right is the one that is continuous
    // through the feed. Assume the wrong one and this comes out as a null.
    const a = analyse(wire(0, LAM), F, { ground: false, perWavelength: 40 });
    near(a.directivityDbi, 3.82, 0.08, 'full-wave dipole');
    const az = a.azCut(0, 361);
    const broadside = az[0], endfire = az[90];
    assert.ok(broadside - endfire > 15,
      `broadside ${broadside.toFixed(1)} should dominate endfire ${endfire.toFixed(1)}`);
  });
});

describe('height sets the take-off angle', () => {
  // The single most useful fact this page can teach, so it is pinned exactly.
  // Over perfect ground the ground factor is 2 sin(k h sin e), which peaks
  // where k h sin e = pi/2 — at the zenith for h = lambda/4 and at 30 degrees
  // for h = lambda/2.
  test('a dipole a quarter wave up fires straight upward', () => {
    const a = analyse(wire(LAM / 4), F, { perWavelength: 40 });
    near(a.peak.elevationDeg, 90, 0.5, 'peak');
  });

  test('a dipole a half wave up peaks at 30 degrees', () => {
    const a = analyse(wire(LAM / 2), F, { perWavelength: 40 });
    near(a.peak.elevationDeg, 30, 0.5, 'peak');
  });

  test('a dipole one wavelength up peaks at 14.5 degrees', () => {
    // asin(1/4) = 14.48 degrees for the lowest lobe.
    const a = analyse(wire(LAM), F, { perWavelength: 40 });
    near(a.lowestLobe.elevationDeg, 14.48, 0.5, 'lowest lobe');
  });

  test('raising the antenna lowers its lowest lobe, monotonically', () => {
    const angles = [0.35, 0.5, 0.75, 1.0, 1.5, 2.0].map(
      (h) => analyse(wire(h * LAM), F, { perWavelength: 24 }).lowestLobe.elevationDeg);
    for (let i = 1; i < angles.length; i++) {
      assert.ok(angles[i] < angles[i - 1],
        `lobe should keep dropping: ${angles.map((a) => a.toFixed(1))}`);
    }
  });

  test('a low dipole has no useful low-angle radiation at all', () => {
    const a = analyse(wire(0.15 * LAM), F, { perWavelength: 32 });
    const low = a.gainAt(10, a.peak.azimuthDeg);
    assert.ok(a.peak.gainDbi - low > 8,
      `expected a big penalty at 10 degrees, got ${(a.peak.gainDbi - low).toFixed(1)} dB`);
    near(a.peak.elevationDeg, 90, 1, 'a low dipole is a cloud warmer');
  });
});

describe('pattern shape', () => {
  test('a dipole is broadside to the wire, and symmetric about it', () => {
    const a = analyse(wire(LAM / 2), F, { perWavelength: 32 });
    const az = a.azCut(30, 361);
    // Wire runs east–west, so broadside is north (0) and south (180).
    near(az[0], a.peak.gainDbi, 0.1, 'north');
    near(az[180], a.peak.gainDbi, 0.1, 'south');
    near(az[45], az[315], 0.05, 'pattern is symmetric about broadside');
    assert.equal(countLobes(az, { wrap: true }), 2, 'two lobes, not three');
  });

  test('the famous null off the ends of a dipole only exists at the horizon', () => {
    // Worth pinning, because the folklore ("a dipole hears nothing off its
    // ends") is only true along the wire itself. The element factor is
    // cos(90 deg * cos(theta)) / sin(theta) with cos(theta) = cos(elev) *
    // sin(az), so looking 30 degrees up the null has already filled to within
    // 7.6 dB of broadside — a difference you would struggle to notice on air.
    const a = analyse(wire(LAM / 2), F, { perWavelength: 32 });
    const drop = (elev) => {
      const az = a.azCut(elev, 361);
      return az[0] - az[90];
    };
    near(drop(30), 7.59, 0.15, 'endfire rejection 30 degrees up');
    near(drop(5), 23.29, 0.2, 'endfire rejection near the horizon');
    assert.ok(drop(5) > drop(30), 'the null deepens as you approach the horizon');
  });

  test('a vertical is omnidirectional and hugs the horizon', () => {
    const a = analyse(vert(quarterWave(F, 1)), F, { perWavelength: 32 });
    const az = a.azCut(15, 73);
    const spread = Math.max(...az) - Math.min(...az);
    assert.ok(spread < 0.05, `azimuth spread ${spread.toFixed(3)} dB should be nil`);
    assert.ok(a.gainAt(5, 0) > a.gainAt(45, 0), 'low angles must dominate');
    assert.ok(a.gainAt(90, 0) < -40, 'and there is a hard null at the zenith');
  });

  test('a half-wave vertical beats a quarter wave at low angles', () => {
    const q = analyse(vert(quarterWave(F, 1)), F, { perWavelength: 32 });
    const h = analyse(vert(LAM / 2), F, { perWavelength: 32 });
    const gain = h.gainAt(5, 0) - q.gainAt(5, 0);
    near(gain, 1.7, 0.4, 'half-wave advantage at 5 degrees');
  });

  test('an end-fed half wave radiates exactly like a centre-fed one', () => {
    // Same wire, same current distribution, different feed point. If this ever
    // fails, the assumed-current code has lost the property that makes an EFHW
    // work, and the page would be teaching something false.
    const centre = analyse(wire(LAM / 2), F, { perWavelength: 32 });
    const L = halfWave(F);
    const end = analyse(
      [{ points: [[-L / 2, 0, LAM / 2], [L / 2, 0, LAM / 2]], feedAt: 0 }],
      F, { perWavelength: 32 });
    near(end.directivityDbi, centre.directivityDbi, 0.02, 'directivity');
    for (const e of [5, 15, 30, 60]) {
      near(end.gainAt(e, 0), centre.gainAt(e, 0), 0.02, `gain at ${e} degrees`);
    }
  });

  test('a long wire breaks into lobes, which is the multiband penalty', () => {
    const half = analyse(wire(LAM / 2, halfWave(F)), F, { perWavelength: 32 });
    const long = analyse(wire(LAM / 2, 3 * LAM), F, { perWavelength: 32 });
    const lobes = (a) => countLobes(a.azCut(20, 361), { wrap: true });
    assert.equal(lobes(half), 2, 'a dipole has two lobes');
    assert.ok(lobes(long) >= 6, `a 3-wavelength wire should have many, got ${lobes(long)}`);
    assert.ok(long.peak.gainDbi > half.peak.gainDbi + 1,
      'and more gain in the strongest one — the lobes are the price, not the loss');
    // The nulls between them are the part that costs a contact.
    const az = long.azCut(20, 361);
    assert.ok(Math.max(...az) - Math.min(...az) > 30, 'with deep nulls between');
  });

  test('an inverted V fills in the nulls a flat dipole has off its ends', () => {
    const L = halfWave(F), leg = L / 2, h = 0.4 * LAM;
    const droop = (45 * Math.PI) / 180;
    const dx = leg * Math.cos(droop), dz = leg * Math.sin(droop);
    const v = analyse([{
      points: [[-dx, 0, h], [0, 0, h + dz], [dx, 0, h]], feedAt: leg,
    }], F, { perWavelength: 32 });
    const flat = analyse(wire(h + dz / 2), F, { perWavelength: 32 });
    const ratio = (a) => {
      const az = a.azCut(25, 361);
      return Math.max(...az) - az[90];
    };
    assert.ok(ratio(v) < ratio(flat) - 2,
      `V front-to-side ${ratio(v).toFixed(1)} should be below flat ${ratio(flat).toFixed(1)}`);
  });

  test('a drooping ground plane keeps a vertical pattern', () => {
    // The radials carry current *into* the feed. Get the sign wrong and their
    // vertical components subtract, which shows up as a collapsed low lobe.
    const H = quarterWave(F, 1), base = 0.25 * LAM, n = 4;
    const paths = [{ points: [[0, 0, base], [0, 0, base + H]], feedAt: 0 }];
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2, d = Math.PI / 4;
      paths.push({
        points: [[0, 0, base], [
          H * Math.cos(d) * Math.sin(az), H * Math.cos(d) * Math.cos(az),
          base - H * Math.sin(d)]],
        feedAt: 0, amp: -1 / n,
      });
    }
    const a = analyse(paths, F, { perWavelength: 32 });
    assert.ok(a.peak.elevationDeg < 25, `peak at ${a.peak.elevationDeg.toFixed(1)} should be low`);
    assert.ok(a.directivityDbi > 3 && a.directivityDbi < 9,
      `directivity ${a.directivityDbi.toFixed(2)} dBi is out of physical range`);
    const az = a.azCut(15, 73);
    assert.ok(Math.max(...az) - Math.min(...az) < 0.6, 'and stay near-omnidirectional');
  });
});

describe('reported summaries', () => {
  test('the half-power points bracket the peak', () => {
    const a = analyse(wire(LAM / 2), F, { perWavelength: 32 });
    const hp = halfPowerElevation(a.peakCut, a.peak.gainDbi);
    near(hp.peakDeg, 30, 0.6, 'peak');
    assert.ok(hp.lowDeg < hp.peakDeg && hp.highDeg > hp.peakDeg);
  });

  test('the lowest lobe is not always the strongest one', () => {
    const a = analyse(wire(1.5 * LAM), F, { perWavelength: 32 });
    assert.ok(a.lowestLobe.elevationDeg < a.peak.elevationDeg - 3,
      'a high dipole has a low lobe under its strongest one');
    assert.ok(a.lowestLobe.belowPeakDb > 0);
  });

  test('a vertical reports its lowest lobe as the horizon', () => {
    const a = analyse(vert(quarterWave(F, 1)), F, { perWavelength: 32 });
    near(a.lowestLobe.elevationDeg, 0, 0.3, 'horizon');
  });
});

describe('gates', () => {
  test('an antenna that cannot radiate is refused, not reported as zero', () => {
    // A horizontal wire lying on perfect ground is exactly cancelled by its
    // image. That is a real physical result and a useless plot, so it throws.
    assert.throws(() => analyse(wire(0), F, { perWavelength: 16 }), /radiates no power/);
  });

  test('segment count scales with electrical length, not physical length', () => {
    const lo = buildSegments(wire(10, halfWave(3.65)), 3.65, { perWavelength: 32 });
    const hi = buildSegments(wire(10, halfWave(28.4)), 28.4, { perWavelength: 32 });
    assert.equal(lo.driven, hi.driven, 'a half wave is a half wave on any band');
  });

  test('the ground image doubles the element count, and only when asked', () => {
    const g = buildSegments(wire(10), F);
    const f = buildSegments(wire(10), F, { ground: false });
    assert.equal(g.n, g.driven * 2);
    assert.equal(f.n, f.driven);
  });
});

describe('lowestLobe', () => {
  test('finds the first maximum, not the biggest', () => {
    const cut = Float64Array.from([0, 3, 5, 4, 2, 6, 9, 6]);
    const l = lowestLobe(cut);
    near(l.gainDbi, 5, 1e-9, 'first lobe');
    near(l.belowPeakDb, 4, 1e-9, 'below the peak');
  });

  test('treats a monotonically falling cut as peaking at the horizon', () => {
    near(lowestLobe(Float64Array.from([9, 7, 4, 1])).elevationDeg, 0, 1e-9, 'horizon');
  });
});
