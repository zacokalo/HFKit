// The expeditionary catalogue.
//
// The stakes are different here than in the amateur catalogue. Someone may cut
// wire from these numbers in the dark and find out whether they were right when
// a net call goes unanswered, so the tests lean on the claims the page makes in
// prose — if the model does not support a sentence, the sentence has to change.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { FIELD_ANTENNAS, FIELD_GROUPS, antennasFor, buildAntenna, byId, defaultParams }
  from '../catalogue.mjs';
import { analyse, halfWave, shortMonopole, wavelength } from '../physics.mjs';

const at = (id, fMHz, params = {}) =>
  buildAntenna(byId(id), { designMHz: fMHz, operatingMHz: fMHz, params });
const pattern = (built, fMHz) => analyse(built.paths, fMHz, { perWavelength: 28 });
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(2)} vs ${b} (±${tol})`);

// Real assignments, not band centres — the whole point of field mode.
const FREQS = [2.3, 3.1, 4.55, 5.357, 7.85, 9.2, 13.6, 18.4, 24.1, 29.7];

describe('the field catalogue', () => {
  test('is a short list, which is the point', () => {
    assert.ok(FIELD_ANTENNAS.length <= 12,
      `${FIELD_ANTENNAS.length} antennas — field mode must stay choosable under pressure`);
    assert.equal(antennasFor('field'), FIELD_ANTENNAS);
    assert.notEqual(antennasFor('amateur'), FIELD_ANTENNAS);
  });

  test('every group is populated and every antenna is in one', () => {
    for (const g of FIELD_GROUPS) {
      assert.ok(FIELD_ANTENNAS.some((a) => a.group === g), `nothing in "${g}"`);
    }
    for (const a of FIELD_ANTENNAS) {
      assert.ok(FIELD_GROUPS.includes(a.group), `${a.id} has group "${a.group}"`);
      assert.equal(a.audience, 'field', `${a.id} must be marked field-only`);
    }
  });

  test('builds at every frequency an operator might be assigned', () => {
    for (const a of FIELD_ANTENNAS) {
      for (const f of FREQS) {
        const built = buildAntenna(a, {
          designMHz: f, operatingMHz: f, params: defaultParams(a),
        });
        const where = `${a.id} @ ${f} MHz`;
        for (const p of built.paths) {
          for (const [, , z] of p.points) {
            assert.ok(z >= 0, `${where}: wire ${z.toFixed(2)} m underground`);
          }
        }
        assert.ok(built.dims.length >= 3, `${where}: needs dimensions to cut from`);
        assert.ok(built.notes.length >= 3, `${where}: needs field notes`);
        const pat = analyse(built.paths, f, { perWavelength: 20 });
        assert.ok(pat.directivityDbi > -1 && pat.directivityDbi < 14,
          `${where}: ${pat.directivityDbi.toFixed(1)} dBi is not physical`);
      }
    }
  });
});

describe('NVIS antennas point where NVIS needs them', () => {
  for (const id of ['nvis-dipole', 'nvis-inverted-v', 'crossed-v']) {
    test(`${id} fires straight up on every frequency`, () => {
      for (const f of FREQS) {
        const p = pattern(at(id, f), f);
        assert.ok(p.peak.elevationDeg >= 80,
          `${id} @ ${f} MHz peaks at ${p.peak.elevationDeg.toFixed(0)}°, not overhead`);
        // The angle that matters for a 50 km link is essentially straight up.
        assert.ok(p.peak.gainDbi - p.gainAt(85, 0) < 1,
          `${id} @ ${f} MHz is down ${(p.peak.gainDbi - p.gainAt(85, 0)).toFixed(1)} dB at 85°`);
      }
    });
  }

  test('height in wavelengths keeps the antenna right across the spectrum', () => {
    // The reason field mode expresses height as a fraction of a wavelength: a
    // fixed metre height is correct on one frequency and wrong on the rest.
    const heights = FREQS.map((f) => {
      const built = at('nvis-dipole', f);
      return built.dims.find((d) => d.label === 'Height').metres / wavelength(f);
    });
    for (const h of heights) near(h, 0.18, 0.001, 'height in wavelengths');
    const metres = FREQS.map((f) => at('nvis-dipole', f).dims
      .find((d) => d.label === 'Height').metres);
    assert.ok(Math.max(...metres) / Math.min(...metres) > 10,
      'the physical height must vary hugely across the range');
  });

  test('raising an NVIS antenna past a quarter wave breaks it', () => {
    const f = 5.357;
    const overhead = (hwl) => pattern(at('nvis-dipole', f, { heightWl: hwl }), f).gainAt(88, 0);
    assert.ok(overhead(0.18) > overhead(0.35) + 3,
      `0.18 λ (${overhead(0.18).toFixed(1)}) must beat 0.35 λ (${overhead(0.35).toFixed(1)}) overhead`);
    // And the tolerance claim: anywhere in the sweet spot is fine.
    const band = [0.1, 0.15, 0.2, 0.25].map(overhead);
    assert.ok(Math.max(...band) - Math.min(...band) < 1.5,
      `0.1–0.25 λ should barely matter, spread was ${(Math.max(...band) - Math.min(...band)).toFixed(1)} dB`);
  });

  test('an inverted-V survives a frequency change that ruins a flat dipole', () => {
    // The operational reason to prefer the V on a net with a day and a night
    // frequency, and a claim the notes make in dB — so it is checked in dB.
    // Cut for 3.1 MHz, used on 7.85: the apex is half a wavelength up, which is
    // where a flat dipole's overhead radiation collapses. The V's legs are
    // still low and still radiating upward.
    const overheadLoss = (id) => {
      const own = buildAntenna(byId(id), { designMHz: 7.85, operatingMHz: 7.85, params: {} });
      const cut = buildAntenna(byId(id), { designMHz: 3.1, operatingMHz: 7.85, params: {} });
      const ideal = analyse(own.paths, 7.85, { perWavelength: 28 });
      const real = analyse(cut.paths, 7.85, { perWavelength: 28 });
      return ideal.gainAt(78, 0) - real.gainAt(78, 0);
    };
    const v = overheadLoss('nvis-inverted-v');
    const flat = overheadLoss('nvis-dipole');
    assert.ok(flat > 5, `a flat dipole should suffer badly, lost ${flat.toFixed(1)} dB`);
    assert.ok(v < 2.5, `the V should hold up, lost ${v.toFixed(1)} dB`);
    assert.ok(flat - v > 4,
      `the V's advantage is the point: flat ${flat.toFixed(1)} vs V ${v.toFixed(1)} dB`);
  });

  test('a shallow droop beats a steep one for NVIS', () => {
    const f = 5.357;
    const overhead = (d) => pattern(at('nvis-inverted-v', f, { droop: d }), f).gainAt(88, 0);
    assert.ok(overhead(25) > overhead(55),
      `25° (${overhead(25).toFixed(1)}) should beat 55° (${overhead(55).toFixed(1)}) overhead`);
  });

  test('a low NVIS antenna is told it is correct, not that it is too low', () => {
    // The amateur catalogue calls 0.18 λ a fault. For NVIS it is the design,
    // and the wrong wording here gets a working antenna raised into uselessness.
    const nvis = at('nvis-dipole', 5.357);
    const c = nvis.cautions.find((x) => /wavelengths up/.test(x.text));
    assert.ok(c, 'the ground-loss fact must still be stated');
    assert.equal(c.severity, 'info');
    assert.match(c.text, /right height for NVIS/);
    assert.match(c.text, /do not raise the antenna/);

    const amateur = at('dipole', 5.357, { height: 10 });
    const ac = amateur.cautions.find((x) => /wavelengths up/.test(x.text));
    assert.equal(ac.severity, 'moderate', 'the same height on a general-purpose dipole is a fault');
  });
});

describe('whips, and the truth about them', () => {
  test('a whip radiates at the horizon, not overhead', () => {
    for (const id of ['whip-manpack', 'whip-vehicle']) {
      for (const f of [3.1, 7.85, 24.1]) {
        const p = pattern(at(id, f), f);
        near(p.peak.elevationDeg, 0, 2, `${id} @ ${f} MHz peak elevation`);
      }
    }
  });

  test('directivity hides the whole problem, so a caution carries it', () => {
    // A 3 m whip on 3.1 MHz reports about the same dBi as a full quarter wave.
    // Nothing in the pattern says most of the power never got there.
    const built = at('whip-manpack', 3.1, { length: 3, base: 1.2 });
    const p = pattern(built, 3.1);
    assert.ok(p.directivityDbi > 4,
      `directivity is ${p.directivityDbi.toFixed(1)} dBi — healthy-looking, which is the trap`);
    const c = built.cautions.find((x) => /Electrically short/.test(x.text));
    assert.ok(c, 'no efficiency caution on a 0.03 λ whip');
    assert.equal(c.severity, 'high');
    assert.match(c.text, /radiation resistance of about 0\.\d Ω/);
    assert.match(c.text, /loss of \d+\.\d to \d+\.\d dB/);
  });

  test('the caution fades as the whip becomes electrically real', () => {
    const short = at('whip-vehicle', 3.1).cautions.some((c) => /Electrically short/.test(c.text));
    const fine = at('whip-vehicle', 24.1).cautions.some((c) => /Electrically short/.test(c.text));
    assert.ok(short, '4.6 m on 3.1 MHz is short');
    assert.ok(!fine, '4.6 m on 24.1 MHz is most of a quarter wave and must not be flagged');
  });

  test('radiation resistance follows the square of electrical length', () => {
    const a = shortMonopole(3, 5), b = shortMonopole(6, 5);
    near(b.radiationResistanceOhms / a.radiationResistanceOhms, 4, 0.01, 'doubling the whip');
    near(shortMonopole(3, 5).radiationResistanceOhms, 0.99, 0.02, '3 m at 5 MHz');
    assert.equal(shortMonopole(15, 5), null, 'a quarter wave is not a short antenna');
  });
});

describe('the bent whip, which is a claim the model has to support', () => {
  const overhead = (bend, f) =>
    pattern(at('whip-nvis', f, { length: 3, base: 1.5, bend }), f).gainAt(85, 0);

  test('bending a whip really does buy overhead signal', () => {
    const gain = overhead(70, 7.85) - overhead(0, 7.85);
    assert.ok(gain > 8, `expected a large gain at 7.85 MHz, got ${gain.toFixed(1)} dB`);
  });

  test('and buys least exactly where NVIS is needed most', () => {
    // Worth knowing before you tie a whip down on a low night frequency: the
    // technique works, but its benefit shrinks as the whip gets electrically
    // shorter and closer to the ground.
    const low = overhead(70, 3.1) - overhead(0, 3.1);
    const high = overhead(70, 13.6) - overhead(0, 13.6);
    assert.ok(low < high - 3,
      `3.1 MHz gains ${low.toFixed(1)} dB, 13.6 MHz gains ${high.toFixed(1)} — should differ`);
    assert.ok(low > 2, `still worth doing at 3.1 MHz, got ${low.toFixed(1)} dB`);
  });

  test('but a bent whip stays far below a real NVIS wire', () => {
    // The notes say a dipole "will beat it by a wide margin". Hold them to it.
    const f = 5.357;
    const bent = overhead(70, f);
    const wire = pattern(at('nvis-dipole', f), f).gainAt(85, 0);
    assert.ok(wire - bent > 12,
      `a dipole should dominate: wire ${wire.toFixed(1)} vs bent whip ${bent.toFixed(1)} dBi`);
  });
});

describe('long wire, inverted-L and broadband', () => {
  test('a long wire develops lobes as the frequency climbs', () => {
    const lobed = (f) => pattern(at('field-longwire', f, { length: 40 }), f);
    assert.ok(lobed(24.1).peak.elevationDeg < lobed(3.1).peak.elevationDeg,
      'the peak should drop toward the horizon as the wire gets electrically longer');
  });

  test('a long wire always demands a counterpoise, sized to frequency', () => {
    for (const f of [3.1, 13.6]) {
      const cp = at('field-longwire', f).dims.find((d) => d.label === 'Counterpoise');
      assert.ok(cp && cp.metres > 0, `no counterpoise dimension at ${f} MHz`);
      assert.match(cp.note, /under the feedpoint/);
    }
    const lo = at('field-longwire', 3.1).dims.find((d) => d.label === 'Counterpoise').metres;
    const hi = at('field-longwire', 13.6).dims.find((d) => d.label === 'Counterpoise').metres;
    assert.ok(lo > hi, 'a lower frequency needs more counterpoise');
  });

  test('an inverted-L under half a wave wants its vertical section as tall as possible', () => {
    // 28 m of wire is 0.29 λ at 3.1 MHz and 0.50 λ at 5.357 — the region where
    // "more vertical is better" is a rule you can rely on in the dark.
    for (const f of [3.1, 5.357]) {
      const low = (v, h) =>
        pattern(at('field-inverted-l', f, { vertical: v, horizontal: h }), f).gainAt(10, 0);
      const series = [[4, 24], [9, 19], [14, 14], [18, 10]].map(([v, h]) => low(v, h));
      for (let i = 1; i < series.length; i++) {
        assert.ok(series[i] > series[i - 1],
          `${f} MHz: low-angle gain must keep rising, got ${series.map((s) => s.toFixed(1))}`);
      }
    }
    assert.ok(pattern(at('field-inverted-l', 5.357, { vertical: 18, horizontal: 10 }), 5.357)
      .gainAt(10, 0)
      - pattern(at('field-inverted-l', 5.357, { vertical: 4, horizontal: 24 }), 5.357)
        .gainAt(10, 0) > 8, 'and the note claims about 10 dB for that swing');
  });

  test('and the notes admit the rule stops holding on a long wire', () => {
    // At 13.6 MHz the same 28 m is 1.27 λ, the current reverses along it, and
    // taller-is-better is no longer monotonic. A note that claimed otherwise
    // would be teaching a rule that quietly fails on the higher day frequencies.
    const f = 13.6;
    const low = (v, h) =>
      pattern(at('field-inverted-l', f, { vertical: v, horizontal: h }), f).gainAt(10, 0);
    const series = [[4, 24], [9, 19], [14, 14], [18, 10]].map(([v, h]) => low(v, h));
    const monotonic = series.every((s, i) => i === 0 || s > series[i - 1]);
    assert.ok(!monotonic,
      `expected the heuristic to break at 1.27 λ, but it held: ${series.map((s) => s.toFixed(1))}`);
    const notes = byId('field-inverted-l').build({
      designMHz: f, operatingMHz: f, params: { vertical: 9, horizontal: 19 },
    }).notes.join(' ');
    assert.match(notes, /stops holding/);
    assert.match(notes, /0\.6\s*\n?\s*wavelengths|0\.6 wavelengths/);
  });

  test('the terminated dipole states what the resistor costs', () => {
    const built = at('field-tfd', 5.357);
    const c = built.cautions.find((x) => /terminating resistor/.test(x.text));
    assert.ok(c, 'a terminated antenna must declare its loss');
    assert.equal(c.severity, 'high');
    assert.match(c.text, /3–6 dB/);
    assert.match(c.text, /approximated from an unterminated wire/,
      'and must admit the pattern is an approximation');
  });

  test('the terminated dipole needs no re-cutting, which is why it exists', () => {
    const lengths = FREQS.map((f) => at('field-tfd', f).dims
      .find((d) => d.label === 'Overall length').metres);
    assert.equal(new Set(lengths).size, 1, 'its length must not change with frequency');
  });
});
