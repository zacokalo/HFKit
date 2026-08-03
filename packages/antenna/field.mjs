// Expeditionary antennas: what is actually in a rucksack, on a vehicle, or can
// be built from a spool of wire and whatever is standing nearby.
//
// This catalogue exists because the amateur one asks the wrong questions of
// this user. An operator working from a frequency assignment does not think in
// bands, cannot choose an antenna that is not in the kit, and usually needs to
// talk 40 km through terrain rather than 4000 km across an ocean. That last
// point inverts the advice: for NVIS the antenna wants to be *low*, and every
// instinct the amateur page trains — get it higher, get the lobe down — is
// exactly wrong.
//
// Heights here are given in wavelengths rather than metres, because that is the
// only form of the NVIS rule that survives a change of frequency. "A fifth of a
// wavelength" is right on 3 MHz and on 9 MHz; "ten metres" is right on neither.
//
// A note on nomenclature: where an issued item exists, it is named as the
// pattern it belongs to rather than reproduced dimension for dimension. If you
// have the real thing, its manual governs — these are cut lengths for building
// the same pattern from wire at your frequency.

import { halfWave, quarterWave, wavelength } from './physics.mjs';
import { clampDroop, m, rad, t } from './shared.mjs';

export const FIELD_GROUPS = [
  'NVIS — short range',
  'Whips and verticals',
  'Long wire and inverted-L',
  'Broadband — no retuning',
];

const NVIS_NOTE = 'NVIS sends the signal almost straight up and takes the '
  + 'reflection straight back down, filling the ground-wave gap and the skip '
  + 'zone out to roughly 300 km. It does not care about terrain, which is the '
  + 'entire reason to use it in mountains, jungle or a built-up area.';

// --- NVIS ------------------------------------------------------------------

const nvisDipole = {
  id: 'nvis-dipole',
  nvis: true,
  name: 'NVIS dipole',
  group: 'NVIS — short range',
  audience: 'field',
  blurb: 'A half-wave dipole hung deliberately low. The simplest thing that '
    + 'works for short-range HF, and the fastest to put up.',
  params: [
    { id: 'heightWl', label: 'Height', type: 'wavelengths', min: 0.05, max: 0.35,
      step: 0.01, value: 0.18, help: 'Fraction of a wavelength above ground' },
  ],
  build({ designMHz, params }) {
    const L = halfWave(designMHz), leg = L / 2;
    const h = params.heightWl * wavelength(designMHz);
    return {
      paths: [{ points: [[-leg, 0, h], [leg, 0, h]], feedAt: leg, role: 'element' }],
      dims: [
        m('Total wire', L),
        m('Each leg', leg, 'from the centre insulator'),
        m('Height', h, `${params.heightWl.toFixed(2)} wavelengths`),
        t('Feedpoint', '50–70 Ω at resonance', 'coax direct, with a choke'),
      ],
      notes: [
        NVIS_NOTE,
        'Between about 0.1 and 0.25 wavelengths up, essentially all the '
        + 'radiation goes upward and the pattern barely changes with height. '
        + 'That tolerance is what makes NVIS practical in the field: you do not '
        + 'have to measure the height, you have to be in the band.',
        'Higher is worse here, not better. Past about a quarter wavelength the '
        + 'pattern starts to split and energy leaves at angles that overfly the '
        + 'people you are trying to talk to.',
        'Lower than about a tenth of a wavelength still works, and the pattern '
        + 'is still right — but more of the power goes into the ground instead '
        + 'of the sky. Waist height is a usable emergency configuration.',
        'Orientation barely matters for NVIS. The pattern overhead is broad '
        + 'enough that pointing is not a planning factor at these ranges.',
      ],
    };
  },
};

const nvisInvertedV = {
  id: 'nvis-inverted-v',
  nvis: true,
  name: 'NVIS inverted-V',
  group: 'NVIS — short range',
  audience: 'field',
  blurb: 'The same wire over a single mast or tree. One support instead of '
    + 'two, which is usually the difference between getting it up and not.',
  params: [
    { id: 'heightWl', label: 'Apex height', type: 'wavelengths', min: 0.05, max: 0.35,
      step: 0.01, value: 0.2 },
    { id: 'droop', label: 'Leg droop', type: 'angle', min: 5, max: 60, step: 1, value: 25,
      help: 'Keep this shallow for NVIS' },
  ],
  build({ designMHz, params }) {
    const L = halfWave(designMHz), leg = L / 2;
    const apex = params.heightWl * wavelength(designMHz);
    const droop = clampDroop(apex, leg, params.droop);
    const dx = leg * Math.cos(rad(droop)), dz = leg * Math.sin(rad(droop));
    return {
      paths: [{
        points: [[-dx, 0, apex - dz], [0, 0, apex], [dx, 0, apex - dz]],
        feedAt: leg, role: 'element',
      }],
      dims: [
        m('Total wire', L),
        m('Each leg', leg),
        m('Apex height', apex, `${params.heightWl.toFixed(2)} wavelengths`),
        m('End height', apex - dz),
        m('Ground span needed', dx * 2),
        t('Leg droop', `${droop.toFixed(0)}°`,
          droop < params.droop - 0.5 ? 'limited by apex height' : null),
      ],
      warnings: droop < params.droop - 0.5
        ? [`Droop limited to ${droop.toFixed(0)}° — steeper puts the ends on the ground.`]
        : [],
      notes: [
        NVIS_NOTE,
        'Keep the droop shallow. Every degree of slope adds vertical '
        + 'polarisation, which radiates at low angles — the opposite of what '
        + 'this antenna is for. Under about 30° the penalty is small; at 45° you '
        + 'are giving away a useful fraction of your overhead signal.',
        'Only the apex needs the height, and the apex is the current maximum, so '
        + 'a V with a good centre beats a flat dipole strung low between two '
        + 'poor supports.',
        'One mast, two ground stakes, one length of wire. This is the fastest '
        + 'NVIS antenna to erect and the easiest to repair in the dark.',
        'It also tolerates a change of frequency far better than a flat dipole, '
        + 'which is the real reason to prefer it on a net that works a day and a '
        + 'night frequency. Cut one for 3.1 MHz and use it on 7.85 and the apex '
        + 'is half a wavelength up — a flat dipole at that height loses about '
        + '10 dB straight overhead, while this loses under 2, because the '
        + 'drooping legs are still low and still radiating upward. Put both in '
        + 'this tool and step the frequency to see it.',
      ],
    };
  },
};

const crossedV = {
  id: 'crossed-v',
  nvis: true,
  name: 'Crossed inverted-V (AS-2259 pattern)',
  group: 'NVIS — short range',
  audience: 'field',
  blurb: 'Two inverted-Vs at right angles on one mast, fed together. The '
    + 'pattern the issued AS-2259/GR uses: it fills the overhead hemisphere '
    + 'more evenly than one wire can and is less sensitive to how it is pitched.',
  params: [
    { id: 'heightWl', label: 'Mast height', type: 'wavelengths', min: 0.05, max: 0.3,
      step: 0.01, value: 0.15 },
    { id: 'droop', label: 'Leg droop', type: 'angle', min: 10, max: 60, step: 1, value: 35 },
  ],
  build({ designMHz, params }) {
    const L = halfWave(designMHz), leg = L / 2;
    const apex = params.heightWl * wavelength(designMHz);
    const droop = clampDroop(apex, leg, params.droop);
    const dx = leg * Math.cos(rad(droop)), dz = leg * Math.sin(rad(droop));
    const end = apex - dz;
    return {
      paths: [
        { points: [[-dx, 0, end], [0, 0, apex], [dx, 0, end]], feedAt: leg, role: 'element' },
        { points: [[0, -dx, end], [0, 0, apex], [0, dx, end]], feedAt: leg, role: 'element' },
      ],
      dims: [
        m('Wire per element', L, 'two elements — double this for the total'),
        m('Each leg', leg, 'four legs in all'),
        m('Mast height', apex, `${params.heightWl.toFixed(2)} wavelengths`),
        m('Stake radius', dx, 'four stakes, at 90° to each other'),
        t('Total wire', `${(2 * L).toFixed(1)} m for both elements`),
      ],
      warnings: droop < params.droop - 0.5
        ? [`Droop limited to ${droop.toFixed(0)}° by the mast height.`] : [],
      notes: [
        NVIS_NOTE,
        'The issued AS-2259/GR is this pattern on a 15 ft mast with fixed-length '
        + 'elements and an antenna coupler, so it covers the whole HF range '
        + 'without re-cutting. If you have one, its manual governs — the lengths '
        + 'here are for building the same pattern from wire at your frequency.',
        'Crossing the elements makes the overhead pattern rounder and the antenna '
        + 'less fussy about being pitched on sloping ground. That robustness is '
        + 'the reason it is the issued design rather than a single wire.',
        'Both elements are fed from the same point. Keep the four legs '
        + 'symmetrical — an asymmetric layout tilts the pattern off vertical, '
        + 'which is the one thing NVIS cannot afford.',
        'Four stakes at 90°. On rock or frozen ground, weight the ends instead '
        + 'and keep them off the soil.',
      ],
    };
  },
};

const bentWhip = {
  id: 'whip-nvis',
  nvis: true,
  name: 'Bent whip (NVIS)',
  group: 'NVIS — short range',
  audience: 'field',
  blurb: 'A vehicle or manpack whip tied over toward horizontal. Not a good '
    + 'antenna. It is the one you can have working in thirty seconds without '
    + 'dismounting, and it turns a whip that talks to nobody nearby into one '
    + 'that talks to the next valley.',
  params: [
    { id: 'length', label: 'Whip length', type: 'length', min: 0.9, max: 6, step: 0.1, value: 3 },
    { id: 'base', label: 'Base height', type: 'length', min: 0, max: 3, step: 0.1, value: 1.5 },
    { id: 'bend', label: 'Bend from vertical', type: 'angle', min: 0, max: 85, step: 5, value: 70 },
  ],
  build({ params }) {
    const { length: L, base, bend } = params;
    const lower = L * 0.3, upper = L * 0.7;
    const midZ = base + lower;
    const tipR = upper * Math.sin(rad(bend));
    const tipZ = Math.max(0.3, midZ + upper * Math.cos(rad(bend)));
    return {
      paths: [{
        points: [[0, 0, base], [0, 0, midZ], [tipR, 0, tipZ]],
        feedAt: 0, role: 'element',
      }],
      dims: [
        m('Whip length', L),
        m('Base height', base, 'radio, or the vehicle roof'),
        m('Tip height', tipZ),
        m('Tie-down reach', tipR, 'horizontal distance to the tie-down point'),
        t('Bend', `${bend}° from vertical`),
      ],
      notes: [
        NVIS_NOTE,
        'A vertical whip puts its energy at the horizon, where the ground wave '
        + 'dies in a few kilometres and the sky wave overflies everyone within '
        + 'a few hundred. Bending it over converts some of that into the upward '
        + 'radiation short-range work needs.',
        'Use non-conductive cord to tie the tip, and do not let the whip touch '
        + 'the vehicle body, foliage or the ground. A bent whip resting on '
        + 'anything conductive is a dummy load.',
        'Bending changes the feedpoint impedance, so retune after tying it down '
        + 'rather than before. Expect the coupler to work harder than it does '
        + 'with the whip upright.',
        'This is a compromise and the efficiency figures below say how much of '
        + 'one. If you have ten minutes and a length of wire, a dipole or an '
        + 'inverted-V will beat it by a wide margin.',
      ],
    };
  },
};

// --- whips and verticals ---------------------------------------------------

const whipCommon = [
  'A whip that is short compared to the wavelength has very little radiation '
  + 'resistance, so most of the transmitter output is dissipated in the '
  + 'matching network, the coupler and the ground return rather than radiated. '
  + 'The efficiency figures below are the honest part of this antenna.',
  'The counterpoise is what you are working against, and in the field it is '
  + 'whatever is bonded to the radio: the vehicle body, the operator, a ground '
  + 'stake, or a few wires thrown on the soil. Improving it is usually the '
  + 'cheapest gain available.',
  'A vertical radiates at low angles, which makes it the right choice for '
  + 'reach-back over hundreds or thousands of kilometres and the wrong choice '
  + 'for anyone in the next valley.',
];

const manpackWhip = {
  id: 'whip-manpack',
  name: 'Manpack whip',
  group: 'Whips and verticals',
  audience: 'field',
  blurb: 'The whip on the radio. Always available, needs no set-up, and is '
    + 'electrically tiny on the lower frequencies.',
  params: [
    { id: 'length', label: 'Whip length', type: 'length', min: 0.9, max: 4, step: 0.1, value: 3,
      help: 'Short whip ≈ 0.9 m, tape whip ≈ 3 m' },
    { id: 'base', label: 'Base height', type: 'length', min: 0, max: 2.5, step: 0.1, value: 1.2 },
  ],
  build({ params, operatingMHz }) {
    const { length: L, base } = params;
    return {
      paths: [{ points: [[0, 0, base], [0, 0, base + L]], feedAt: 0, role: 'element' }],
      dims: [
        m('Whip length', L),
        m('Base height', base),
        t('Electrical length', `${(L / wavelength(operatingMHz)).toFixed(3)} wavelengths`,
          'a quarter wave would be 0.25 — see the efficiency note'),
        m('Resonant quarter wave here', quarterWave(operatingMHz),
          'how long the whip would have to be to resonate'),
      ],
      notes: [
        ...whipCommon,
        'Standing on a hilltop helps a vertical far more than it helps a dipole, '
        + 'because the low-angle radiation a vertical produces is the part '
        + 'terrain blocks.',
        'If the traffic is short-range, tie the whip over. The bent-whip entry '
        + 'in the NVIS group shows what that buys.',
      ],
    };
  },
};

const vehicleWhip = {
  id: 'whip-vehicle',
  name: 'Vehicle whip',
  group: 'Whips and verticals',
  audience: 'field',
  blurb: 'A longer whip on a vehicle mount, working against the hull. Longer '
    + 'than a manpack whip and standing on a much better counterpoise.',
  params: [
    { id: 'length', label: 'Whip length', type: 'length', min: 2, max: 10, step: 0.1, value: 4.6,
      help: '15 ft is the common vehicle length' },
    { id: 'base', label: 'Mount height', type: 'length', min: 0.5, max: 4, step: 0.1, value: 2 },
  ],
  build({ params, operatingMHz }) {
    const { length: L, base } = params;
    return {
      paths: [{ points: [[0, 0, base], [0, 0, base + L]], feedAt: 0, role: 'element' }],
      dims: [
        m('Whip length', L),
        m('Mount height', base, 'above ground, on the vehicle'),
        m('Overall height', base + L, 'check this against overhead clearance'),
        t('Electrical length', `${(L / wavelength(operatingMHz)).toFixed(3)} wavelengths`),
        m('Resonant quarter wave here', quarterWave(operatingMHz)),
      ],
      notes: [
        ...whipCommon,
        'The vehicle body is the counterpoise and it is a good one — this is '
        + 'why a vehicle whip outperforms a manpack whip by more than the extra '
        + 'length alone would explain. Bonding matters: check the mount, the '
        + 'braid and the hull joints.',
        'Overall height is a route-planning number as much as a radio one. '
        + 'Under power lines and bridges, the whip is the tallest thing you have.',
      ],
    };
  },
};

// --- long wire and inverted-L ----------------------------------------------

const longWire = {
  id: 'field-longwire',
  name: 'Long wire with counterpoise',
  group: 'Long wire and inverted-L',
  audience: 'field',
  blurb: 'A length of wire run out to whatever will hold the far end, fed at '
    + 'one end through a coupler. No cut length to get right — which is the '
    + 'point when the frequency changes.',
  params: [
    { id: 'length', label: 'Wire length', type: 'length', min: 10, max: 120, step: 1, value: 40 },
    { id: 'feedHeight', label: 'Feed height', type: 'length', min: 0.5, max: 8, step: 0.5, value: 2 },
    { id: 'farHeight', label: 'Far-end height', type: 'length', min: 1, max: 25, step: 0.5, value: 8 },
  ],
  build({ params, operatingMHz }) {
    const L = params.length;
    let dz = params.farHeight - params.feedHeight;
    dz = Math.max(-L + 1, Math.min(L - 1, dz));
    const dx = Math.sqrt(Math.max(0, L * L - dz * dz));
    const waves = L / wavelength(operatingMHz);
    return {
      paths: [{
        points: [[0, 0, params.feedHeight], [dx, 0, params.feedHeight + dz]],
        feedAt: 0, role: 'element',
      }],
      dims: [
        m('Wire length', L),
        m('Ground run needed', dx),
        m('Feed height', params.feedHeight),
        m('Far-end height', params.feedHeight + dz),
        t('Electrical length', `${waves.toFixed(2)} wavelengths`,
          waves < 0.25 ? 'short — efficiency will suffer, run out more wire if you can'
            : waves < 0.5 ? 'workable' : 'long enough to develop lobes, see the notes'),
        m('Counterpoise', Math.max(5, 0.25 * wavelength(operatingMHz)),
          'at least one wire this long on the ground under the feedpoint'),
      ],
      notes: [
        'Length is not critical and does not need to resonate — that is the '
        + 'whole reason to use one. Longer is better, up to the point where the '
        + 'pattern breaks up. Aim for at least a quarter wavelength at your '
        + 'lowest frequency.',
        'The counterpoise is not optional. An end-fed wire has to push against '
        + 'something, and if you do not lay out a counterpoise the coupler will '
        + 'use the feedline, the equipment case and the operator instead. Lay at '
        + 'least one quarter-wave wire on the ground under the feedpoint; more '
        + 'is better.',
        'Sloping the wire upward puts the high-current end low, which trades '
        + 'some efficiency for a lower take-off angle. Sloping it down does the '
        + 'reverse. Neither is wrong — pick for the range you need.',
        'Above about one wavelength the pattern splits into lobes that point off '
        + 'the ends rather than broadside, and the nulls between them get deep. '
        + 'On a long wire used across several frequencies, the strong directions '
        + 'move every time you change frequency.',
        'Keep the far end well clear of anything conductive and out of reach. '
        + 'The end of an end-fed wire is a voltage maximum and will burn.',
      ],
    };
  },
};

const invertedL = {
  id: 'field-inverted-l',
  name: 'Inverted-L',
  group: 'Long wire and inverted-L',
  audience: 'field',
  blurb: 'A vertical section for low-angle radiation with the rest run '
    + 'horizontally to make up the length. What a long wire becomes when there '
    + 'is only one tall support.',
  params: [
    { id: 'vertical', label: 'Vertical section', type: 'length', min: 3, max: 25, step: 0.5, value: 9 },
    { id: 'horizontal', label: 'Horizontal section', type: 'length', min: 3, max: 60, step: 1, value: 20 },
  ],
  build({ params, operatingMHz }) {
    const { vertical: v, horizontal: hz } = params;
    return {
      paths: [{
        points: [[0, 0, 0.3], [0, 0, v], [hz, 0, v]],
        feedAt: 0, role: 'element',
      }],
      dims: [
        m('Vertical section', v, 'this is the part that does the low-angle work'),
        m('Horizontal section', hz),
        m('Total wire', v + hz),
        t('Electrical length', `${((v + hz) / wavelength(operatingMHz)).toFixed(2)} wavelengths`),
        m('Counterpoise', Math.max(5, 0.25 * wavelength(operatingMHz)),
          'radials or a counterpoise wire at the base — mandatory'),
      ],
      notes: [
        'Fed at the base against a ground system, so it needs radials or a '
        + 'counterpoise exactly as a vertical does. The base is a current '
        + 'maximum and the return current is real.',
        'While the whole wire is under about half a wavelength, make the vertical '
        + 'section as tall as the support allows: the vertical part does the '
        + 'low-angle radiating and the top just makes up the electrical length. '
        + 'Going from 4 m of vertical to 18 m, on a 28 m wire at 5 MHz, is worth '
        + 'about 10 dB at low angles.',
        'That rule stops holding once the total wire passes roughly 0.6 '
        + 'wavelengths. The current then reverses along the wire, the pattern '
        + 'breaks into lobes, and which split is best depends on the frequency '
        + 'rather than on a rule of thumb. Above that point, change frequency in '
        + 'this tool and read the plot rather than trusting the heuristic.',
        'A useful compromise: it has a low-angle component for reach-back and '
        + 'enough horizontal wire to put something overhead for short range. '
        + 'Neither job is done as well as a dedicated antenna would.',
        'One mast or tree, one ground stake, one run of wire. Quick to put up '
        + 'and forgiving about the exact dimensions.',
      ],
    };
  },
};

// --- broadband -------------------------------------------------------------

const tfd = {
  id: 'field-tfd',
  terminated: true,
  name: 'Terminated folded dipole',
  group: 'Broadband — no retuning',
  audience: 'field',
  blurb: 'A folded wire with a resistor at the far end. Covers the whole HF '
    + 'range with no tuning and no retuning between frequencies — and pays for '
    + 'it by turning a large share of your power into heat.',
  params: [
    { id: 'length', label: 'Overall length', type: 'length', min: 12, max: 45, step: 1, value: 25 },
    { id: 'heightWl', label: 'Height', type: 'wavelengths', min: 0.05, max: 0.4, step: 0.01,
      value: 0.2 },
  ],
  build({ designMHz, params }) {
    const L = params.length;
    const h = params.heightWl * wavelength(designMHz);
    return {
      paths: [{ points: [[-L / 2, 0, h], [L / 2, 0, h]], feedAt: L / 2, role: 'element' }],
      dims: [
        m('Overall length', L),
        m('Height', h, `${params.heightWl.toFixed(2)} wavelengths at the design frequency`),
        t('Termination', '390–900 Ω non-inductive', 'rated for a good fraction of your output'),
        t('Balun', '4:1 or 6:1', 'to bring the feedpoint near 50 Ω'),
        t('Tuning', 'none', 'that is the entire point'),
      ],
      notes: [
        'Change frequency and transmit. No coupler cycle, no retuning, no '
        + 're-cutting. On a net that hops across a frequency list, or where the '
        + 'operator cannot be asked to tune, that is worth real power.',
        'The terminating resistor absorbs the energy that would otherwise be '
        + 'reflected, which is what makes the match flat — and that energy is '
        + 'gone. Expect to lose somewhere between a third and two-thirds of your '
        + 'output, worst at the low-frequency end where the antenna is '
        + 'electrically shortest. In dB: roughly 3 to 6 down, and more below '
        + 'about 4 MHz on a short one.',
        'That resistor is dissipating a serious fraction of your transmitter '
        + 'output continuously. It must be non-inductive and rated for the duty '
        + 'cycle you actually run, not the average one.',
        'The pattern drawn here is approximated from an unterminated wire of the '
        + 'same length and height. A real terminated antenna carries a '
        + 'travelling wave rather than a standing one, so its true pattern is '
        + 'smoother with shallower nulls. Treat the shape as indicative and the '
        + 'loss figure above as the number that matters.',
        'Hung low it behaves as a lossy NVIS antenna, which for short-range work '
        + 'on a busy net is often the right trade. Hung high it is a lossy '
        + 'general-purpose wire.',
      ],
    };
  },
};

export const FIELD_ANTENNAS = [
  nvisDipole, nvisInvertedV, crossedV, bentWhip,
  manpackWhip, vehicleWhip,
  longWire, invertedL,
  tfd,
];
