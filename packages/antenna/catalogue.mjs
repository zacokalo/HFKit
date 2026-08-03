// The antennas themselves: what to cut, where to hang it, and what it does.
//
// Each entry turns a design frequency and a few parameters into wire geometry
// that packages/antenna/physics.mjs can analyse, plus the dimensions someone
// would actually take out to the garden with a tape measure.
//
// Two frequencies matter and they are not the same thing:
//   designMHz     what the wire is cut for
//   operatingMHz  what you are transmitting on
// For a single-band antenna they are usually equal. For a multiband wire they
// are deliberately not, and the gap between them is the entire subject of the
// "multiband compromises" group. Entries with `cutPerBand` ignore designMHz —
// a fan dipole has an element for whichever band you are on.

import {
  currentMaximum, halfWave, quarterWave, shortMonopole, wavelength, VELOCITY_FACTOR,
} from './physics.mjs';
import { FIELD_ANTENNAS, FIELD_GROUPS } from './field.mjs';
import { clampDroop, m, rad, t } from './shared.mjs';

export { FIELD_ANTENNAS, FIELD_GROUPS };

export const BANDS = [
  { id: '160m', label: '160 m', mhz: 1.900 },
  { id: '80m', label: '80 m', mhz: 3.650 },
  { id: '60m', label: '60 m', mhz: 5.358 },
  { id: '40m', label: '40 m', mhz: 7.100 },
  { id: '30m', label: '30 m', mhz: 10.125 },
  { id: '20m', label: '20 m', mhz: 14.150 },
  { id: '17m', label: '17 m', mhz: 18.118 },
  { id: '15m', label: '15 m', mhz: 21.200 },
  { id: '12m', label: '12 m', mhz: 24.940 },
  { id: '10m', label: '10 m', mhz: 28.400 },
  { id: '6m', label: '6 m', mhz: 50.150 },
];

export const GROUPS = ['Wire basics', 'Verticals', 'Multiband compromises'];


// --- wire basics -----------------------------------------------------------

const dipole = {
  id: 'dipole',
  name: 'Half-wave dipole',
  group: 'Wire basics',
  blurb: 'Two equal legs, fed in the middle. Everything else on this page is '
    + 'either a variation on it or a compromise measured against it.',
  params: [
    { id: 'height', label: 'Height', type: 'length', min: 2, max: 40, step: 0.5, value: 10 },
  ],
  build({ designMHz, params }) {
    const L = halfWave(designMHz), leg = L / 2, h = params.height;
    return {
      paths: [{ points: [[-leg, 0, h], [leg, 0, h]], feedAt: leg, role: 'element' }],
      dims: [
        m('Total length', L),
        m('Each leg', leg, 'measured from the centre insulator'),
        m('Height', h, `${(h / wavelength(designMHz)).toFixed(2)} wavelengths`),
      ],
      notes: [
        'Cut both legs long by 2–3 % and trim them equally. Wire stretches, '
        + 'insulators and end loops add length, and nearby objects lower the '
        + 'resonant frequency — you can always shorten, never lengthen.',
        'The centre is a current maximum, so that is where the radiation comes '
        + 'from. Keeping the middle high and in the clear matters more than what '
        + 'the ends do.',
        'The ends are a voltage maximum: several kilovolts at full legal power. '
        + 'Terminate them out of reach of people and animals.',
        'Feed with a 1:1 current balun or a coax choke. Without one the coax '
        + 'shield radiates, which distorts the pattern this page draws and puts '
        + 'RF back in the shack.',
      ],
    };
  },
};

const invertedV = {
  id: 'inverted-v',
  name: 'Inverted V',
  group: 'Wire basics',
  blurb: 'A dipole with one support instead of three. The legs slope down from '
    + 'a central mast — by far the most common wire antenna in practice.',
  params: [
    { id: 'height', label: 'Apex height', type: 'length', min: 3, max: 40, step: 0.5, value: 12 },
    { id: 'droop', label: 'Leg droop', type: 'angle', min: 5, max: 70, step: 1, value: 45,
      help: 'Angle of each leg below horizontal' },
  ],
  build({ designMHz, params }) {
    const L = halfWave(designMHz), leg = L / 2, apex = params.height;
    const droop = clampDroop(apex, leg, params.droop);
    const dx = leg * Math.cos(rad(droop)), dz = leg * Math.sin(rad(droop));
    const endZ = apex - dz;
    return {
      paths: [{
        points: [[-dx, 0, endZ], [0, 0, apex], [dx, 0, endZ]],
        feedAt: leg, role: 'element',
      }],
      dims: [
        m('Total wire', L),
        m('Each leg', leg),
        m('Apex height', apex),
        m('End height', endZ),
        m('End-to-end span', dx * 2, 'the ground you actually need'),
        t('Leg droop', `${droop.toFixed(0)}°`,
          droop < params.droop - 0.5 ? 'limited by apex height' : null),
      ],
      warnings: droop < params.droop - 0.5
        ? [`Droop limited to ${droop.toFixed(0)}° — any steeper and the ends `
          + 'reach the ground. Raise the apex or accept the shallower angle.']
        : [],
      notes: [
        'Feedpoint impedance falls as the legs droop — around 50 Ω near 45°, '
        + 'which is why an inverted V often matches coax better than a flat '
        + 'dipole does.',
        'The sloping legs put a vertical component into the radiation, so the '
        + 'deep off-the-ends nulls of a flat dipole partly fill in. It hears '
        + 'more directions and favours none of them as strongly.',
        'Only the apex needs height. Because the apex is the current maximum, '
        + 'an inverted V with a high centre outperforms a flat dipole strung '
        + 'low between two trees.',
      ],
    };
  },
};

const efhw = {
  id: 'efhw',
  name: 'End-fed half-wave',
  group: 'Wire basics',
  blurb: 'The same half wavelength of wire, fed at one end through a 49:1 '
    + 'transformer. One support, no coax in the middle of the span.',
  params: [
    { id: 'feedHeight', label: 'Feed height', type: 'length', min: 0.5, max: 20, step: 0.5, value: 2 },
    { id: 'farHeight', label: 'Far-end height', type: 'length', min: 1, max: 40, step: 0.5, value: 12 },
  ],
  build({ designMHz, params }) {
    const L = halfWave(designMHz);
    let dz = params.farHeight - params.feedHeight;
    dz = Math.max(-L + 1, Math.min(L - 1, dz));
    const dx = Math.sqrt(Math.max(0, L * L - dz * dz));
    return {
      paths: [{
        points: [[0, 0, params.feedHeight], [dx, 0, params.feedHeight + dz]],
        feedAt: 0, role: 'element',
      }],
      dims: [
        m('Wire length', L),
        m('Horizontal span', dx, 'less than the wire, because it slopes'),
        m('Feed height', params.feedHeight),
        m('Far-end height', params.feedHeight + dz),
        t('Transformer', '49:1 (7:1 turns ratio)', 'roughly 2400 Ω down to 50 Ω'),
        m('Counterpoise', quarterWave(designMHz) * 0.05 + 0.3,
          'a short 0.05 λ wire at the transformer is typical; see the notes'),
      ],
      notes: [
        'The current distribution is identical to a centre-fed dipole — maximum '
        + 'in the middle of the wire, zero at both ends. That is why the pattern '
        + 'drawn here is a dipole’s pattern. Where you feed a standing wave does '
        + 'not change its shape.',
        'The feedpoint sits on a voltage maximum, so the impedance is very high '
        + '(1500–4000 Ω, varying with height and surroundings). The 49:1 '
        + 'transformer is doing real work and will get warm on a long over.',
        'It still needs something to push against. A short counterpoise at the '
        + 'transformer, or the coax shield acting as one, completes the circuit. '
        + 'If you do not choose a counterpoise deliberately, your feedline is it.',
        'A common-mode choke roughly a quarter wave down the coax from the '
        + 'transformer is close to mandatory. Without it the feedline radiates '
        + 'and the pattern is no longer the one shown.',
      ],
    };
  },
};

const sloper = {
  id: 'sloper',
  name: 'Half-wave sloper',
  group: 'Wire basics',
  blurb: 'A centre-fed half wave hung at an angle from a single high support. '
    + 'What you build when you have one tower and no second anchor point.',
  params: [
    { id: 'topHeight', label: 'Top height', type: 'length', min: 5, max: 45, step: 0.5, value: 15 },
    { id: 'slope', label: 'Slope', type: 'angle', min: 10, max: 75, step: 1, value: 35,
      help: 'Angle of the wire below horizontal' },
  ],
  build({ designMHz, params }) {
    const L = halfWave(designMHz), top = params.topHeight;
    const slope = clampDroop(top, L, params.slope);
    const dx = L * Math.cos(rad(slope)), dz = L * Math.sin(rad(slope));
    return {
      paths: [{
        points: [[0, 0, top], [dx, 0, top - dz]],
        feedAt: L / 2, role: 'element',
      }],
      dims: [
        m('Total length', L),
        m('Each leg', L / 2),
        m('Top height', top),
        m('Bottom height', top - dz),
        m('Horizontal span', dx),
        t('Slope', `${slope.toFixed(0)}°`,
          slope < params.slope - 0.5 ? 'limited by top height' : null),
      ],
      warnings: slope < params.slope - 0.5
        ? [`Slope limited to ${slope.toFixed(0)}° by the available height.`] : [],
      notes: [
        'A sloper radiates both polarisations, and the mix changes with the '
        + 'slope angle. Steeper is more vertical, which lowers the take-off '
        + 'angle but couples more energy into lossy ground.',
        'It is mildly directional toward the low end — typically a couple of dB, '
        + 'not the 6–10 dB folklore sometimes claims.',
        'If the support is a metal tower, the tower is part of the antenna. This '
        + 'model does not include it, and a real sloper off a tower will not '
        + 'match the pattern drawn here.',
      ],
    };
  },
};

// --- verticals -------------------------------------------------------------

const verticalGround = {
  id: 'vertical-ground',
  name: 'Ground-mounted quarter wave',
  group: 'Verticals',
  blurb: 'A quarter wavelength of vertical conductor working against a radial '
    + 'field in the soil. The classic low-angle DX antenna, and the one most '
    + 'often built badly.',
  params: [
    { id: 'radials', label: 'Radials', type: 'count', min: 4, max: 64, step: 1, value: 32 },
  ],
  build({ designMHz, params }) {
    const H = quarterWave(designMHz);
    const radial = wavelength(designMHz) * 0.25;
    return {
      paths: [{ points: [[0, 0, 0], [0, 0, H]], feedAt: 0, role: 'element' }],
      radials: { count: params.radials, length: radial, droopDeg: 90, onGround: true },
      dims: [
        m('Vertical height', H),
        t('Radials', `${params.radials} × ${radial.toFixed(2)} m `
          + `(${(radial / 0.3048).toFixed(1)} ft)`, 'laid on or just under the soil'),
        m('Total wire in radials', radial * params.radials, 'usually the larger shopping list'),
        t('Feedpoint', '≈ 36 Ω over perfect ground',
          'rises toward 50 Ω as ground losses add resistance — a "good" match here '
          + 'can mean a bad radial field'),
      ],
      notes: [
        'Ground-mounted radial length is not critical and does not need to '
        + 'resonate — they are a shield between the antenna’s return current and '
        + 'lossy soil, not radiating elements. Count beats length: 32 short '
        + 'radials outperform 8 long ones.',
        'This is where the perfect-ground assumption is at its most flattering. '
        + 'Over average soil with a sparse radial field, expect 3–6 dB less than '
        + 'the figure shown, and the low-angle lobe rolling off below about 10° '
        + 'instead of holding to the horizon.',
        'The improvement from adding radials flattens out around 60; going from '
        + '4 to 16 is worth several dB, from 32 to 64 a fraction of one.',
        'Everything about a vertical is about the return path. The vertical '
        + 'element is the easy half.',
      ],
    };
  },
};

const groundPlane = {
  id: 'ground-plane',
  name: 'Elevated ground plane',
  group: 'Verticals',
  blurb: 'A quarter-wave vertical up in the air with a few resonant radials '
    + 'instead of a buried field. Fewer radials, far less ground loss.',
  params: [
    { id: 'baseHeight', label: 'Base height', type: 'length', min: 1, max: 25, step: 0.5, value: 6 },
    { id: 'radials', label: 'Radials', type: 'count', min: 2, max: 8, step: 1, value: 4 },
    { id: 'droop', label: 'Radial droop', type: 'angle', min: 0, max: 60, step: 1, value: 45 },
  ],
  build({ designMHz, params }) {
    const H = quarterWave(designMHz);
    const R = quarterWave(designMHz);
    const base = params.baseHeight;
    const droop = clampDroop(base, R, params.droop);
    const paths = [{ points: [[0, 0, base], [0, 0, base + H]], feedAt: 0, role: 'element' }];
    const n = params.radials;
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2;
      paths.push({
        points: [[0, 0, base], [
          R * Math.cos(rad(droop)) * Math.sin(az),
          R * Math.cos(rad(droop)) * Math.cos(az),
          base - R * Math.sin(rad(droop)),
        ]],
        feedAt: 0, amp: -1 / n, role: 'radial',
      });
    }
    return {
      paths,
      dims: [
        m('Vertical height', H),
        t('Radials', `${n} × ${R.toFixed(2)} m (${(R / 0.3048).toFixed(1)} ft)`,
          'resonant — cut these to length, unlike buried ones'),
        m('Base height', base),
        m('Radial tip height', base - R * Math.sin(rad(droop))),
        t('Radial droop', `${droop.toFixed(0)}°`,
          droop < params.droop - 0.5 ? 'limited by base height' : null),
        t('Feedpoint', droop < 10 ? '≈ 21 Ω (flat radials)' : '≈ 50 Ω near 45° droop',
          'drooping the radials is a matching technique, not just a mounting one'),
      ],
      warnings: droop < params.droop - 0.5
        ? [`Radial droop limited to ${droop.toFixed(0)}° — steeper would put the `
          + 'radial tips on the ground, which turns them back into a buried field.']
        : [],
      notes: [
        'Elevated radials must be resonant. Two will work, four is the usual '
        + 'compromise, and beyond about four the returns are small — the '
        + 'opposite of the ground-mounted case.',
        'Drooping the radials to 45° raises the feedpoint from about 21 Ω to '
        + 'about 50 Ω. That is a free coax match, and it is why so many '
        + 'commercial verticals arrive with radials angled down.',
        'Getting the feedpoint a quarter wave up removes most of the ground '
        + 'loss that dominates a ground-mounted vertical. This is generally the '
        + 'better antenna if you can support it.',
        'Keep the radials symmetrical. An asymmetric radial field skews the '
        + 'pattern and turns the feedline into a radiator.',
      ],
    };
  },
};

const halfWaveVertical = {
  id: 'vertical-halfwave',
  name: 'Half-wave vertical',
  group: 'Verticals',
  blurb: 'A half wavelength standing on end, fed at the bottom. Twice the '
    + 'height of a quarter wave, and almost indifferent to what is under it.',
  params: [
    { id: 'baseHeight', label: 'Base height', type: 'length', min: 0, max: 12, step: 0.5, value: 0.5 },
  ],
  build({ designMHz, params }) {
    const H = halfWave(designMHz);
    return {
      paths: [{
        points: [[0, 0, params.baseHeight], [0, 0, params.baseHeight + H]],
        feedAt: 0, role: 'element',
      }],
      dims: [
        m('Height', H),
        m('Base height', params.baseHeight),
        m('Total top height', params.baseHeight + H),
        t('Feedpoint', 'roughly 1000–3000 Ω', 'a voltage feed — needs a matching network'),
      ],
      notes: [
        'The base is a *current node*. Almost no current flows into the ground '
        + 'connection, so ground losses barely matter — this is the vertical to '
        + 'build if you cannot lay radials.',
        'It still wants a counterpoise or a few radials, but as a reference for '
        + 'the matching network rather than as a return path for current.',
        'Roughly 1.7 dB more gain at low angles than a quarter wave over the '
        + 'same ground, before you count the ground loss the quarter wave '
        + 'suffers and this one largely does not.',
        'The price is height: on 40 m that is 20 metres of self-supporting '
        + 'vertical, which is a structural problem before it is a radio one.',
      ],
    };
  },
};

const fiveEighths = {
  id: 'vertical-58',
  name: '5/8-wave vertical',
  group: 'Verticals',
  blurb: 'Taller again, and the lowest take-off angle of any of these — at the '
    + 'cost of a loading coil at the base and a rising minor lobe.',
  params: [
    { id: 'baseHeight', label: 'Base height', type: 'length', min: 0, max: 12, step: 0.5, value: 0.5 },
    { id: 'radials', label: 'Radials', type: 'count', min: 4, max: 64, step: 1, value: 32 },
  ],
  build({ designMHz, params }) {
    const H = VELOCITY_FACTOR * wavelength(designMHz) * 0.625;
    const radial = wavelength(designMHz) * 0.25;
    return {
      paths: [{
        points: [[0, 0, params.baseHeight], [0, 0, params.baseHeight + H]],
        feedAt: 0, role: 'element',
      }],
      radials: { count: params.radials, length: radial, droopDeg: 90, onGround: true },
      dims: [
        m('Height', H),
        t('Base loading coil', 'required', 'the element is not resonant by itself'),
        t('Radials', `${params.radials} × ${radial.toFixed(2)} m`, 'a current feed — '
          + 'ground loss matters as much as it does for a quarter wave'),
        m('Base height', params.baseHeight),
      ],
      notes: [
        '5/8 λ is close to the height that maximises low-angle radiation from a '
        + 'ground-mounted element. Push past about 0.65 λ and the pattern splits: '
        + 'a second lobe climbs while the low one shrinks.',
        'The element is inductive at 5/8 λ, so it needs a base coil to resonate. '
        + 'That coil has loss, and on the lower bands it is not negligible.',
        'The base is a high-current point again, so this needs the same serious '
        + 'radial field as a quarter wave — the ground-loss advantage of the '
        + 'half-wave vertical does not apply.',
      ],
    };
  },
};

// --- multiband compromises -------------------------------------------------

const fanTrapLinked = {
  id: 'multi-dipole',
  name: 'Fan, trap and linked dipoles',
  group: 'Multiband compromises',
  blurb: 'Three ways to put a resonant half wave on several bands. All of them '
    + 'radiate like a plain dipole on whichever band is active, which is exactly '
    + 'why they are worth the trouble.',
  cutPerBand: true,
  params: [
    { id: 'kind', label: 'Type', type: 'choice', value: 'fan',
      options: [
        { value: 'fan', label: 'Fan (parallel elements)' },
        { value: 'trap', label: 'Trap (LC traps)' },
        { value: 'linked', label: 'Linked (manual links)' },
      ] },
    { id: 'height', label: 'Height', type: 'length', min: 2, max: 40, step: 0.5, value: 10 },
  ],
  build({ operatingMHz, params }) {
    const L = halfWave(operatingMHz), leg = L / 2, h = params.height;
    const kind = params.kind;
    const perBand = BANDS.filter((b) => b.mhz >= 3 && b.mhz <= 30).map(
      (b) => t(`${b.label} element`, `${halfWave(b.mhz).toFixed(2)} m `
        + `(${(halfWave(b.mhz) / 0.3048).toFixed(1)} ft), legs `
        + `${(halfWave(b.mhz) / 2).toFixed(2)} m`));
    const NOTES = {
      fan: [
        'Several dipoles share one feedpoint, spread apart so they do not couple '
        + 'too strongly. The band you transmit on is near resonance and takes '
        + 'nearly all the current; the others are off-resonance and largely idle.',
        'They do interact. Expect to retrim after adding each element, working '
        + 'from the lowest band up, and to end up with the higher-band elements '
        + 'a few percent shorter than the table says.',
        'Spreaders every couple of metres keep the elements apart. If they touch '
        + 'or hang together in the wind, the tuning moves with the weather.',
      ],
      trap: [
        'A parallel LC trap resonant at the higher band acts as a high impedance '
        + 'there, so the antenna ends at the trap. Below its resonance the trap '
        + 'behaves as an inductor and the wire beyond it stays in circuit.',
        'That trailing inductance electrically lengthens the antenna, so the '
        + 'outer section for the lower band is *shorter* than a plain dipole for '
        + 'that band — typically 5–15 %. The table below gives full-size '
        + 'lengths; a trapped design has to be modelled or trimmed.',
        'Traps have loss and they limit power. They also narrow the usable '
        + 'bandwidth on the lower bands, sometimes considerably.',
      ],
      linked: [
        'The simplest and the most efficient: one dipole with connectors part '
        + 'way along each leg. Connect the links for the low band, disconnect '
        + 'them for the high band.',
        'No traps means no trap loss and no trap-induced narrow bandwidth. Full '
        + 'efficiency on every band it covers.',
        'The catch is mechanical: changing bands means lowering the antenna. '
        + 'Fine for a portable set-up on a hillside, tedious in a back garden.',
      ],
    };
    return {
      paths: [{ points: [[-leg, 0, h], [leg, 0, h]], feedAt: leg, role: 'element' }],
      dims: [
        t('Active element', `${L.toFixed(2)} m for the operating band`),
        m('Each leg', leg),
        m('Height', h, `${(h / wavelength(operatingMHz)).toFixed(2)} wavelengths `
          + 'on this band'),
        ...perBand,
      ],
      notes: [
        ...NOTES[kind],
        'Because only the resonant element carries significant current, the '
        + 'pattern on each band is a plain half-wave dipole’s pattern at that '
        + 'band. There is no multiband penalty in the *shape* — only in '
        + 'construction effort, loss and bandwidth.',
        'Note what changes as you step up the bands: the wire gets shorter but '
        + 'the mast stays put, so the height in wavelengths rises and the '
        + 'take-off angle drops. One fixed support is a different antenna on '
        + 'every band.',
      ],
    };
  },
};

const g5rv = {
  id: 'g5rv',
  name: 'G5RV',
  group: 'Multiband compromises',
  blurb: 'A 102-foot flat top with a matched-line section beneath it. Designed '
    + 'in 1946 for 20 m, and used on everything since — with mixed results.',
  params: [
    { id: 'height', label: 'Height', type: 'length', min: 3, max: 40, step: 0.5, value: 10 },
    { id: 'feeder', label: 'Matching section', type: 'choice', value: '450',
      options: [
        { value: '300', label: '300 Ω twin lead — 34 ft' },
        { value: '450', label: '450 Ω ladder line — 31 ft' },
      ] },
  ],
  build({ params }) {
    const L = 102 * 0.3048;             // the defining dimension, in feet
    const feeder = params.feeder === '300' ? 34 * 0.3048 : 31 * 0.3048;
    return {
      paths: [{ points: [[-L / 2, 0, params.height], [L / 2, 0, params.height]],
                feedAt: L / 2, role: 'element' }],
      dims: [
        m('Flat top', L, '102 ft — the number that defines a G5RV'),
        m('Each leg', L / 2, '51 ft'),
        m('Matching section', feeder,
          params.feeder === '300' ? '300 Ω twin lead' : '450 Ω ladder line'),
        m('Height', params.height),
        t('Below the matching section', 'coax to the shack',
          'with a choke at the junction, and usually a tuner at the far end'),
      ],
      notes: [
        'On 20 m the flat top is 1.5 wavelengths and the matching section '
        + 'transforms it to something near 50 Ω. That single band is what the '
        + 'antenna was designed for and it does it well.',
        'On every other band it is a doublet with an awkward length of feeder, '
        + 'and it needs a tuner. It is not a resonant multiband antenna; it is a '
        + 'doublet with a fixed matching stub.',
        'It is a poor performer on 80 m — the flat top is under a half wave '
        + 'there — and it does not work usefully on 160 m at all.',
        'The matching section radiates. This model draws only the flat top, so '
        + 'the real pattern has a vertically polarised component the plot does '
        + 'not show, particularly on the bands where the match is worst.',
        'Watch the pattern break into lobes as you step up the bands. At 1.5 '
        + 'wavelengths and beyond, the strongest lobes are no longer broadside, '
        + 'and there are deep nulls where broadside used to be.',
      ],
    };
  },
};

const doublet = {
  id: 'doublet',
  name: 'Doublet with a tuner',
  group: 'Multiband compromises',
  blurb: 'Any convenient length of wire, centre-fed with ladder line into a '
    + 'balanced tuner. No resonance, no traps, no compromise dimensions — the '
    + 'most honest multiband wire there is.',
  params: [
    { id: 'length', label: 'Total length', type: 'length', min: 8, max: 80, step: 0.5, value: 40 },
    { id: 'height', label: 'Height', type: 'length', min: 3, max: 40, step: 0.5, value: 12 },
  ],
  build({ params, operatingMHz }) {
    const L = params.length, h = params.height;
    return {
      paths: [{ points: [[-L / 2, 0, h], [L / 2, 0, h]], feedAt: L / 2, role: 'element' }],
      dims: [
        m('Total length', L),
        m('Each leg', L / 2),
        m('Height', h),
        t('Length on this band', `${(L / wavelength(operatingMHz)).toFixed(2)} wavelengths`),
        t('Feedline', 'ladder line or window line, any length',
          'low loss even at high SWR, which is the whole trick'),
      ],
      notes: [
        'The wire is never resonant and never needs to be. Ladder line has such '
        + 'low loss that a 10:1 or 20:1 SWR on it costs a fraction of a dB, and '
        + 'the tuner sorts out the rest at the shack end.',
        'Longer is better, up to a point. Make it at least a half wave on the '
        + 'lowest band you want — below that, efficiency falls away and the '
        + 'tuner is asked to match an impedance it may not reach.',
        'Avoid lengths that put a very high or very low impedance at the tuner '
        + 'on a band you care about. A half wave on 80 m (about 40 m of wire) is '
        + 'a common, well-behaved choice.',
        'Use a genuinely balanced tuner, or a 1:1 current balun feeding a '
        + 'conventional one. A 4:1 voltage balun in front of an unbalanced tuner '
        + 'is the usual reason a doublet disappoints.',
        'Above about one wavelength the pattern breaks into lobes and it gets '
        + 'sharper with every band. Stepping up the bands here shows exactly '
        + 'that happening.',
      ],
    };
  },
};

const ocf = {
  id: 'ocf',
  name: 'Off-centre-fed (Windom)',
  group: 'Multiband compromises',
  blurb: 'A half wave for the lowest band, fed about a third of the way along. '
    + 'That feedpoint lands on a usable impedance on several harmonically '
    + 'related bands at once.',
  params: [
    { id: 'fraction', label: 'Feed position', type: 'fraction', min: 0.2, max: 0.5, step: 0.01,
      value: 0.33, help: 'Fraction of the total length from one end' },
    { id: 'height', label: 'Height', type: 'length', min: 3, max: 40, step: 0.5, value: 12 },
  ],
  build({ designMHz, params, operatingMHz }) {
    const L = halfWave(designMHz), h = params.height;
    const feedAt = L * params.fraction;
    return {
      paths: [{ points: [[-feedAt, 0, h], [L - feedAt, 0, h]], feedAt, role: 'element' }],
      dims: [
        m('Total length', L, 'a half wave on the design band'),
        m('Short leg', feedAt, `${(params.fraction * 100).toFixed(0)} % of the total`),
        m('Long leg', L - feedAt),
        m('Height', h),
        t('Balun', params.fraction > 0.28 ? '4:1 current balun' : '6:1 current balun',
          'chosen to land the feedpoint near 50 Ω'),
        t('Length on this band', `${(L / wavelength(operatingMHz)).toFixed(2)} wavelengths`),
      ],
      notes: [
        'Feeding off centre trades the neat 50 Ω of a centre feed for an '
        + 'impedance that stays within tuner range on the design band and its '
        + 'even harmonics — typically 80/40/20/10 m from an 80 m wire.',
        'The impedance at the 1/3 point is roughly 200 Ω, hence the 4:1 balun. '
        + 'At 1/5 it is closer to 300 Ω and wants 6:1. Neither is exact on every '
        + 'band; a tuner is still expected.',
        'The asymmetry is the problem as well as the point. Common-mode current '
        + 'on the feedline is much harder to control than on a centre-fed '
        + 'antenna — use a current balun at the feedpoint and a choke further '
        + 'down as well.',
        'The odd harmonics land on a very high impedance and are not usable. An '
        + '80 m OCF does not work on 15 m, which surprises people who expect a '
        + '"multiband" antenna to cover the bands in between.',
      ],
    };
  },
};

const efhwMulti = {
  id: 'efhw-multi',
  name: 'End-fed half-wave on harmonics',
  group: 'Multiband compromises',
  blurb: 'The same end-fed wire as before, used on its harmonics. A high '
    + 'impedance appears at the end on every harmonic, so one transformer '
    + 'covers several bands.',
  params: [
    { id: 'feedHeight', label: 'Feed height', type: 'length', min: 0.5, max: 20, step: 0.5, value: 2 },
    { id: 'farHeight', label: 'Far-end height', type: 'length', min: 1, max: 40, step: 0.5, value: 12 },
  ],
  build({ designMHz, params, operatingMHz }) {
    const L = halfWave(designMHz);
    let dz = params.farHeight - params.feedHeight;
    dz = Math.max(-L + 1, Math.min(L - 1, dz));
    const dx = Math.sqrt(Math.max(0, L * L - dz * dz));
    const harmonic = L / (halfWave(operatingMHz));
    return {
      paths: [{
        points: [[0, 0, params.feedHeight], [dx, 0, params.feedHeight + dz]],
        feedAt: 0, role: 'element',
      }],
      dims: [
        m('Wire length', L),
        m('Horizontal span', dx),
        t('On this band', `${harmonic.toFixed(2)} half waves`,
          Math.abs(harmonic - Math.round(harmonic)) < 0.08
            ? 'close to a harmonic — the transformer should cope'
            : 'not near a harmonic — expect a poor match and use a tuner'),
        t('Transformer', '49:1, sometimes 64:1 on the higher bands'),
        m('Counterpoise', 0.05 * wavelength(designMHz), 'about 0.05 λ at the design band'),
      ],
      notes: [
        'Every integer number of half waves puts a voltage maximum at the fed '
        + 'end, so the impedance stays high and one transformer serves several '
        + 'bands. A 40 m wire covers 40, 20, 15 and 10 m this way.',
        'The impedance is not the *same* on each band — it climbs with the '
        + 'harmonic number — so the match gets worse as you go up. Many designs '
        + 'add a small capacitor across the transformer primary to compensate.',
        'On the higher bands the wire is several wavelengths long and the '
        + 'pattern is a lobed fan, not a dipole’s figure of eight. The gain in '
        + 'the strongest lobe is real, and so are the nulls beside it.',
        'The bands in between — where the wire is an odd number of quarter waves '
        + '— present a low impedance at the end and will not match. That is why '
        + 'an EFHW covers a *harmonic series*, not a continuous range.',
      ],
    };
  },
};

/** The band-oriented catalogue, for someone exploring rather than deploying. */
export const AMATEUR_ANTENNAS = [
  dipole, invertedV, efhw, sloper,
  verticalGround, groundPlane, halfWaveVertical, fiveEighths,
  fanTrapLinked, g5rv, doublet, ocf, efhwMulti,
];

/** Everything, so byId() resolves an antenna whichever mode named it. */
export const ANTENNAS = [...AMATEUR_ANTENNAS, ...FIELD_ANTENNAS];

/** The catalogue for a given mode. Field mode is deliberately a short list. */
export const antennasFor = (mode) =>
  (mode === 'field' ? FIELD_ANTENNAS : AMATEUR_ANTENNAS);

export const groupsFor = (mode) => (mode === 'field' ? FIELD_GROUPS : GROUPS);

export const byId = (id) => ANTENNAS.find((a) => a.id === id) ?? null;

/** Default parameter object for an antenna. */
export const defaultParams = (antenna) =>
  Object.fromEntries(antenna.params.map((p) => [p.id, p.value]));

/**
 * Build an antenna's geometry, filling in defaults and normalising the result
 * so callers never have to check whether the optional keys are present.
 */
export function buildAntenna(antenna, { designMHz, operatingMHz, params = {} }) {
  const p = { ...defaultParams(antenna), ...params };
  const out = antenna.build({
    designMHz: antenna.cutPerBand ? operatingMHz : designMHz,
    operatingMHz,
    params: p,
  });
  const built = {
    antenna, params: p, designMHz, operatingMHz,
    paths: out.paths,
    radials: out.radials ?? null,
    dims: (out.dims ?? []).filter(Boolean),
    notes: out.notes ?? [],
    warnings: out.warnings ?? [],
  };
  built.cautions = cautions(built);
  return built;
}

/**
 * Where the perfect-ground model stops being a simplification and starts
 * overstating the antenna. These are not decoration: a dipole two metres up on
 * 160 m still reports about 7 dBi here, because perfect ground reflects
 * everything and the power has to go *somewhere*. Real soil takes most of it.
 * Directivity cannot see that, so it has to be said in words.
 */
export function cautions(built) {
  const out = [];
  const cm = currentMaximum(built.paths, built.operatingMHz);
  const lam = wavelength(built.operatingMHz);
  const buried = built.radials?.onGround;

  // A low horizontal antenna is either a mistake or the entire design intent,
  // and the same sentence cannot serve both. Telling an NVIS operator their
  // antenna is too low — when 0.18 λ is exactly where it belongs — would get a
  // correctly built antenna raised into uselessness.
  if (!cm.vertical && cm.heightWavelengths < 0.2 && built.antenna.nvis) {
    out.push({
      severity: 'info',
      text: `${cm.heightWavelengths.toFixed(2)} wavelengths up `
        + `(${cm.heightM.toFixed(1)} m against a ${lam.toFixed(1)} m wavelength) is `
        + 'the right height for NVIS — this is the design, not a compromise. Real '
        + 'ground under it still costs you 1–3 dB that this perfect-ground model '
        + 'does not charge for. Accept that; do not raise the antenna to avoid it, '
        + 'because height is what breaks the overhead pattern you are here for.',
    });
  } else if (!cm.vertical && cm.heightWavelengths < 0.2) {
    out.push({
      severity: cm.heightWavelengths < 0.1 ? 'high' : 'moderate',
      text: `The current maximum is ${cm.heightWavelengths.toFixed(2)} wavelengths up `
        + `(${cm.heightM.toFixed(1)} m against a ${lam.toFixed(1)} m wavelength). `
        + 'Below about 0.2 λ a horizontal antenna couples strongly into the soil '
        + 'beneath it, and real ground will take several dB that this '
        + 'perfect-ground model does not charge you for. Treat the gain figure as '
        + 'an upper bound you will not reach.',
    });
  }
  if (buried) {
    out.push({
      severity: 'high',
      text: 'A ground-mounted vertical returns its current through the soil. Over '
        + `average ground with ${built.radials.count} radials, expect roughly `
        + `${built.radials.count >= 32 ? '2–3' : built.radials.count >= 16 ? '3–4' : '4–6'} dB `
        + 'below the figure shown, and the low-angle lobe rolling off below about '
        + '10° rather than holding all the way to the horizon.',
    });
  }
  if (cm.vertical && !buried && cm.heightWavelengths < 0.05 && !built.antenna.nvis) {
    out.push({
      severity: 'moderate',
      text: 'A vertical this close to the ground still needs a return path. '
        + 'Without radials or a counterpoise, the loss goes wherever the current '
        + 'can find a way back — usually the coax shield and the soil.',
    });
  }

  // The one that matters most in the field. Directivity is nearly blind to
  // electrical length — a 3 m whip on 5 MHz reports about the same dBi as a
  // full quarter wave, because the *shape* of a short monopole's pattern is
  // barely different. What collapses is how much power reaches that shape.
  const wireM = wireLength(built.paths);
  const short = shortMonopole(wireM, built.operatingMHz);
  if (short && cm.vertical) {
    const [best, worst] = short.lossDb;
    out.push({
      severity: short.heightWavelengths < 0.08 ? 'high' : 'moderate',
      text: `Electrically short: ${wireM.toFixed(1)} m is `
        + `${short.heightWavelengths.toFixed(3)} wavelengths here, giving a radiation `
        + `resistance of about ${short.radiationResistanceOhms.toFixed(1)} Ω. Against the `
        + `${short.lossOhms[0]}–${short.lossOhms[1]} Ω of coupler, matching and ground-return `
        + 'loss a field installation really presents, that radiates roughly '
        + `${(short.efficiency[0] * 100).toFixed(0)}–${(short.efficiency[1] * 100).toFixed(0)} % `
        + `of your output — a loss of ${(-best).toFixed(1)} to ${(-worst).toFixed(1)} dB `
        + 'on top of the figure shown. The pattern is right; the power is not '
        + 'reaching it. A better counterpoise is the cheapest fix.',
    });
  }

  if (built.antenna.terminated) {
    out.push({
      severity: 'high',
      text: 'The terminating resistor absorbs the power that would otherwise be '
        + 'reflected — that is what keeps the match flat across the whole range, '
        + 'and that power is gone. Expect to lose a third to two-thirds of your '
        + 'output, roughly 3–6 dB, worst at the low-frequency end. The pattern '
        + 'here is approximated from an unterminated wire of the same size; a '
        + 'real terminated antenna has a smoother one with shallower nulls.',
    });
  }
  return out;
}

/** Total length of the driven wire, following every bend. */
function wireLength(paths) {
  let total = 0;
  for (const p of paths) {
    if (p.role === 'radial') continue;
    for (let i = 1; i < p.points.length; i++) {
      const [ax, ay, az] = p.points[i - 1], [bx, by, bz] = p.points[i];
      total += Math.hypot(bx - ax, by - ay, bz - az);
    }
  }
  return total;
}
