// Every antenna, on every band, has to produce something physical. The
// visualiser lets someone put a 160 m dipole two metres up or run a 5/8 vertical
// on 6 m, and neither may return a plot that quietly means nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANTENNAS, BANDS, FIELD_GROUPS, GROUPS, buildAntenna, byId, defaultParams,
} from '../catalogue.mjs';
import { analyse, countLobes, halfWave, wavelength } from '../physics.mjs';

const at = (id, band, params = {}, design = band) => buildAntenna(byId(id), {
  designMHz: design, operatingMHz: band, params,
});

describe('the catalogue itself', () => {
  test('ids are unique across both catalogues, so byId cannot be ambiguous', () => {
    const ids = ANTENNAS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate id');
  });

  test('every antenna lands in a group its own mode offers', () => {
    for (const a of ANTENNAS) {
      const groups = a.audience === 'field' ? FIELD_GROUPS : GROUPS;
      assert.ok(groups.includes(a.group), `${a.id} has group "${a.group}"`);
      assert.ok(a.name && a.blurb, `${a.id} needs a name and a blurb`);
      assert.ok(a.params.length > 0, `${a.id} has no parameters`);
    }
  });

  test('all three groups are populated', () => {
    for (const g of GROUPS) {
      assert.ok(ANTENNAS.some((a) => a.group === g), `nothing in "${g}"`);
    }
  });

  test('every parameter is usable by a slider or a select', () => {
    for (const a of ANTENNAS) {
      for (const p of a.params) {
        assert.ok(p.id && p.label && p.type, `${a.id}.${p.id} is underspecified`);
        if (p.type === 'choice') {
          assert.ok(p.options?.length >= 2, `${a.id}.${p.id} needs options`);
          assert.ok(p.options.some((o) => o.value === p.value), 'default must be an option');
        } else {
          assert.ok(Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min,
            `${a.id}.${p.id} has no usable range`);
          assert.ok(p.value >= p.min && p.value <= p.max,
            `${a.id}.${p.id} default ${p.value} is outside ${p.min}..${p.max}`);
        }
      }
    }
  });

  test('byId returns null rather than undefined for a bad id', () => {
    assert.equal(byId('no-such-antenna'), null);
  });
});

describe('every antenna on every band', () => {
  for (const a of ANTENNAS) {
    test(`${a.name} builds and radiates across the spectrum`, () => {
      for (const band of BANDS) {
        const built = buildAntenna(a, {
          designMHz: band.mhz, operatingMHz: band.mhz, params: defaultParams(a),
        });
        const where = `${a.id} @ ${band.label}`;

        assert.ok(built.paths.length > 0, `${where}: no wire`);
        for (const p of built.paths) {
          for (const [, , z] of p.points) {
            assert.ok(z >= 0, `${where}: a wire is ${z.toFixed(2)} m underground`);
          }
          assert.ok(p.points.length >= 2, `${where}: degenerate path`);
        }
        assert.ok(built.dims.length >= 2, `${where}: needs dimensions`);
        assert.ok(built.notes.length >= 2, `${where}: needs explanatory notes`);
        for (const d of built.dims) {
          assert.ok(d.label, `${where}: unlabelled dimension`);
          assert.ok(d.metres !== undefined || d.text !== undefined,
            `${where}: dimension "${d.label}" has no value`);
          if (d.metres !== undefined) {
            assert.ok(Number.isFinite(d.metres) && d.metres > 0,
              `${where}: "${d.label}" is ${d.metres}`);
          }
        }

        const pattern = analyse(built.paths, band.mhz, { perWavelength: 24 });
        assert.ok(pattern.directivityDbi > -1 && pattern.directivityDbi < 14,
          `${where}: ${pattern.directivityDbi.toFixed(2)} dBi is not physical`);
        assert.ok(pattern.peak.elevationDeg >= 0 && pattern.peak.elevationDeg <= 90,
          `${where}: peak elevation ${pattern.peak.elevationDeg}`);
      }
    });
  }
});

describe('honesty about real ground', () => {
  test('a low horizontal antenna says the gain figure is unreachable', () => {
    // Two metres up on 160 m is 0.01 wavelengths. Perfect ground reflects it
    // all and reports a healthy directivity; real soil would eat most of it.
    const built = at('dipole', 1.9, { height: 2 });
    const c = built.cautions.find((x) => /wavelengths up/.test(x.text));
    assert.ok(c, 'no ground-loss caution on a 0.01 λ dipole');
    assert.equal(c.severity, 'high');
    const pattern = analyse(built.paths, 1.9, { perWavelength: 24 });
    assert.ok(pattern.directivityDbi > 5,
      'the point of the caution is that this number still looks good');
  });

  test('a dipole at a useful height carries no such caution', () => {
    const built = at('dipole', 14.15, { height: 12 });
    assert.equal(built.cautions.length, 0, JSON.stringify(built.cautions));
  });

  test('a ground-mounted vertical always warns, and scales it to the radials', () => {
    const few = at('vertical-ground', 7.1, { radials: 4 });
    const many = at('vertical-ground', 7.1, { radials: 32 });
    assert.match(few.cautions[0].text, /4–6 dB/);
    assert.match(many.cautions[0].text, /2–3 dB/);
  });

  test('an elevated ground plane does not inherit the buried-radial penalty', () => {
    const built = at('ground-plane', 14.15, { baseHeight: 6 });
    assert.ok(!built.cautions.some((c) => /average ground/.test(c.text)));
  });
});

describe('geometry clamps rather than burying wire', () => {
  test('an inverted V refuses to droop its ends into the ground, and says so', () => {
    const built = at('inverted-v', 3.65, { height: 8, droop: 70 });
    assert.ok(built.warnings.length > 0, 'silent clamping is worse than none');
    assert.match(built.warnings[0], /Droop limited/);
    for (const [, , z] of built.paths[0].points) assert.ok(z >= 0.4, `end at ${z}`);
  });

  test('a ground plane keeps its radial tips airborne', () => {
    const built = at('ground-plane', 3.65, { baseHeight: 2, radials: 4, droop: 60 });
    for (const p of built.paths) {
      for (const [, , z] of p.points) assert.ok(z >= 0, `radial tip at ${z.toFixed(2)}`);
    }
  });

  test('a sloper on a low support keeps its bottom end above ground', () => {
    const built = at('sloper', 3.65, { topHeight: 10, slope: 75 });
    for (const [, , z] of built.paths[0].points) assert.ok(z >= 0.4);
  });
});

describe('what each group is meant to teach', () => {
  test('a fan dipole is a plain dipole on whichever band you are on', () => {
    // The whole reason to build one. It also proves cutPerBand works: the
    // design frequency is 80 m and the element is still a 20 m element.
    const fan = at('multi-dipole', 14.15, { height: 12 }, 3.65);
    const plain = at('dipole', 14.15, { height: 12 });
    assert.equal(fan.paths[0].points[1][0].toFixed(4),
      plain.paths[0].points[1][0].toFixed(4), 'same element length');
    const a = analyse(fan.paths, 14.15, { perWavelength: 24 });
    const b = analyse(plain.paths, 14.15, { perWavelength: 24 });
    assert.ok(Math.abs(a.directivityDbi - b.directivityDbi) < 0.02);
  });

  test('a fan dipole lists an element for every band it could cover', () => {
    const built = at('multi-dipole', 14.15);
    const eighty = built.dims.find((d) => d.label === '80 m element');
    assert.ok(eighty, 'the construction list is the point of the table');
    assert.match(eighty.text, /39\.\d\d m/);
  });

  test('a doublet gets lobier the higher you take it', () => {
    const lobes = [3.65, 7.1, 14.15, 28.4].map((f) => {
      const built = at('doublet', f, { length: 40, height: 12 });
      return countLobes(analyse(built.paths, f, { perWavelength: 24 }).azCut(20, 361),
        { wrap: true });
    });
    assert.equal(lobes[0], 2, `80 m should be a plain figure of eight, got ${lobes[0]}`);
    assert.ok(lobes.at(-1) >= 6, `10 m should be a fan of lobes, got ${lobes.at(-1)}`);
    assert.ok(lobes.at(-1) > lobes[0], `lobes should multiply: ${lobes}`);
  });

  test('a G5RV is 102 feet whatever else changes', () => {
    for (const f of [3.65, 14.15, 28.4]) {
      const built = at('g5rv', f);
      const top = built.dims.find((d) => d.label === 'Flat top');
      assert.ok(Math.abs(top.metres - 31.09) < 0.01, `${f} MHz: ${top.metres}`);
    }
  });

  test('an OCF puts its feed off centre, and the balun follows the position', () => {
    const third = at('ocf', 3.65, { fraction: 0.33 });
    assert.match(third.dims.find((d) => d.label === 'Balun').text, /4:1/);
    assert.match(at('ocf', 3.65, { fraction: 0.2 }).dims.find(
      (d) => d.label === 'Balun').text, /6:1/);
    const short = third.dims.find((d) => d.label === 'Short leg').metres;
    const long = third.dims.find((d) => d.label === 'Long leg').metres;
    assert.ok(long > short * 1.8, 'the asymmetry is the antenna');
    assert.ok(Math.abs((short + long) - halfWave(3.65)) < 0.01, 'still a half wave overall');
  });

  test('an end-fed half wave tells you when you are between harmonics', () => {
    // Cut for 40 m: 20 m is the second harmonic and works; 17 m is not and does
    // not. Saying so is the difference between a tool and a toy.
    const onHarmonic = at('efhw-multi', 14.15, {}, 7.1);
    const between = at('efhw-multi', 18.118, {}, 7.1);
    assert.match(onHarmonic.dims.find((d) => d.label === 'On this band').note, /should cope/);
    assert.match(between.dims.find((d) => d.label === 'On this band').note, /not near a harmonic/);
  });

  test('the verticals rank the way the physics says they should', () => {
    const low = (id, params) => {
      const b = at(id, 14.15, params);
      return analyse(b.paths, 14.15, { perWavelength: 32 }).gainAt(8, 0);
    };
    const quarter = low('vertical-ground', {});
    const half = low('vertical-halfwave', { baseHeight: 0.5 });
    const fiveEighths = low('vertical-58', { baseHeight: 0.5 });
    assert.ok(half > quarter, `half-wave ${half.toFixed(2)} > quarter ${quarter.toFixed(2)}`);
    assert.ok(fiveEighths > quarter,
      `5/8 ${fiveEighths.toFixed(2)} > quarter ${quarter.toFixed(2)}`);
  });

  test('an inverted V trades gain for coverage against a flat dipole', () => {
    const v = at('inverted-v', 14.15, { height: 12, droop: 45 });
    const d = at('dipole', 14.15, { height: 12 });
    const pv = analyse(v.paths, 14.15, { perWavelength: 24 });
    const pd = analyse(d.paths, 14.15, { perWavelength: 24 });
    assert.ok(pv.directivityDbi < pd.directivityDbi, 'the V gives up peak gain');
    const spread = (p) => {
      const az = p.azCut(25, 361);
      return Math.max(...az) - Math.min(...az);
    };
    assert.ok(spread(pv) < spread(pd), 'and buys a rounder pattern with it');
  });
});

describe('cost of a redraw', () => {
  // Measured against a baseline rather than against the clock.
  //
  // The page recomputes on every slider move, so the cost matters — but a
  // wall-clock threshold is a flaky test by construction: it passes on the
  // machine it was written on and fails on a slower one for no reason anyone
  // can act on. This started at 700 ms and began failing at ~780 ms on a
  // sandbox, which said nothing about the code.
  //
  // What is worth guarding is the *shape* of the cost. Analysis scales with
  // electrical length, so the worst entry in the catalogue — a 40 m doublet on
  // 10 m, about 3.8 wavelengths — should stay a bounded multiple of a plain
  // dipole. If that ratio blows out, something has gone superlinear, and that
  // is true on any machine.
  const timeOne = (id, f, params) => {
    const built = at(id, f, params);
    const t0 = performance.now();
    analyse(built.paths, f, { perWavelength: 24 });
    return performance.now() - t0;
  };
  const median = (id, f, params) => {
    timeOne(id, f, params);                        // warm up the JIT first
    const runs = [timeOne(id, f, params), timeOne(id, f, params), timeOne(id, f, params)];
    return runs.sort((a, b) => a - b)[1];
  };

  test('the worst case stays a bounded multiple of the simplest', () => {
    const base = median('dipole', 14.1, { height: 10 });
    const worst = median('doublet', 28.4, { length: 40, height: 12 });
    const ratio = worst / base;
    assert.ok(ratio < 12,
      `worst case is ${ratio.toFixed(1)}x the baseline `
      + `(${worst.toFixed(0)} ms vs ${base.toFixed(0)} ms) — expected under 12x`);
  });

  test('and a plain dipole stays interactive on any plausible machine', () => {
    // A single generous ceiling, kept only to catch a catastrophic regression.
    // Deliberately far above anything a working implementation produces.
    const ms = median('dipole', 14.1, { height: 10 });
    assert.ok(ms < 2000, `${ms.toFixed(0)} ms for a half-wave dipole`);
  });
});
