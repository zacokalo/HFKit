// Antenna physics: dimensions, radiation patterns, and the take-off angle a
// path actually needs.
//
// WHAT THIS IS
// ------------
// A thin-wire far-field calculator using the classical *assumed sinusoidal
// current* distribution, with a perfect-ground image. It is the textbook
// hand-calculation, done numerically so it can handle bent wires (inverted V,
// drooping radials, slopers) that the closed-form expressions cannot.
//
// WHAT THIS IS NOT
// ----------------
// It is not NEC. NEC solves for the current distribution with a method of
// moments; we assume it. That assumption is good for *pattern shape* and
// respectable for directivity, and it is useless for feedpoint impedance —
// which is why this module does not report impedance, SWR, or bandwidth. It
// also assumes a perfectly conducting ground, which no ground is:
//
//   * Horizontal antennas: real ground fills in the deep nulls and shaves
//     roughly 1-2 dB off the lobe peaks. Lobe *angles* are close to right.
//   * Vertical antennas: real ground is where verticals lose their reputation.
//     A ground-mounted quarter wave over average soil with a sparse radial
//     field runs 3-6 dB below what this model shows, and the low-angle lobe
//     rolls off below about 10 degrees instead of peaking at the horizon.
//
// Every number this module returns is therefore an optimistic upper bound, and
// callers are expected to say so where they display it.
//
// Coordinates: x east, y north, z up, metres. Azimuth 0 = north, 90 = east.
// Elevation 0 = horizon, 90 = zenith.

/** Speed of light such that wavelength(MHz) comes out in metres. */
export const LIGHT_MHZ_M = 299.792458;

/**
 * End-effect factor for a real wire. A half-wave dipole resonates a few percent
 * short of a free-space half wavelength because the wire has thickness and the
 * ends have capacitance. 0.95 is the classic value; it is what turns lambda/2
 * into the 468/f feet every handbook prints.
 */
export const VELOCITY_FACTOR = 0.95;

export const EARTH_RADIUS_KM = 6371;
export const METRES_PER_FOOT = 0.3048;

const TAU = Math.PI * 2;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const wavelength = (fMHz) => LIGHT_MHZ_M / fMHz;

/** Total length of a resonant half-wave element, metres. */
export const halfWave = (fMHz, k = VELOCITY_FACTOR) => (k * wavelength(fMHz)) / 2;

/** Height of a resonant quarter-wave element, metres. */
export const quarterWave = (fMHz, k = VELOCITY_FACTOR) => (k * wavelength(fMHz)) / 4;

export const metresToFeet = (m) => m / METRES_PER_FOOT;

/** "46 ft 8 in" — how wire actually gets measured in a back garden. */
export function feetInches(metres) {
  const totalIn = Math.round((metres / METRES_PER_FOOT) * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  return `${ft} ft ${inch} in`;
}

// --- geometry of a hop -----------------------------------------------------

/**
 * The elevation angle a signal must leave at to reach `distanceKm` in `hops`
 * reflections from a layer at `layerHeightKm`.
 *
 * Spherical, not flat: over HF distances the curvature is the whole story. A
 * 2000 km path off the F2 layer at 300 km needs 11.8 degrees; the flat-earth
 * approximation atan(h / (d/2)) says 16.7, which would have you believe a low
 * dipole is fine when it is not.
 *
 * Returns degrees. A *negative* result means the geometry is impossible —
 * the hop is longer than the layer can reach — so check `maxHopDistanceKm`
 * or ask for more hops.
 */
export function takeoffAngle(distanceKm, {
  layerHeightKm = 300, hops = 1, earthRadiusKm = EARTH_RADIUS_KM,
} = {}) {
  const R = earthRadiusKm;
  const half = distanceKm / hops / (2 * R);      // half-hop central angle, rad
  if (half <= 0) return 90;
  return deg(Math.atan2(Math.cos(half) - R / (R + layerHeightKm), Math.sin(half)));
}

/** Longest single hop off a layer, i.e. the distance at a zero-degree take-off. */
export function maxHopDistanceKm(layerHeightKm = 300, earthRadiusKm = EARTH_RADIUS_KM) {
  return 2 * earthRadiusKm * Math.acos(earthRadiusKm / (earthRadiusKm + layerHeightKm));
}

/** Fewest hops that can span a distance off a given layer. */
export function minimumHops(distanceKm, layerHeightKm = 300) {
  return Math.max(1, Math.ceil(distanceKm / maxHopDistanceKm(layerHeightKm)));
}

// --- current distribution --------------------------------------------------

/**
 * Chop a set of wire paths into current elements.
 *
 * Each path is a polyline (a single continuous conductor) with a feed point at
 * arc position `feedAt` metres from its first point. The assumed current is a
 * standing wave that is zero at each free end and *continuous across the feed*:
 *
 *   I(u) = A1 sin(k u)        for u below the feed   (zero at the near end)
 *   I(u) = A2 sin(k (L - u))  for u above the feed   (zero at the far end)
 *
 * with A1 = sin(k (L - sf)) and A2 = sin(k sf), which is exactly the pair that
 * makes the two expressions agree at u = sf without dividing by a value that
 * goes to zero when the feed lands on a current node. An end feed (sf = 0) uses
 * the far-end branch alone, which is why an end-fed half wave comes out with
 * the same current distribution — and so the same pattern — as a centre-fed
 * dipole. That is not a coincidence; it is the point.
 *
 * `amp` scales a path, and carries the sign: ground-plane radials are given
 * -1/N so their current flows *into* the feed while the vertical's flows out,
 * which is what Kirchhoff requires and what makes a drooping ground plane
 * behave like a distorted vertical dipole.
 *
 * With `ground`, each element gets a perfect-electric-conductor image: mirrored
 * in z, horizontal current reversed, vertical current kept.
 */
export function buildSegments(paths, fMHz, { perWavelength = 32, ground = true } = {}) {
  const lambda = wavelength(fMHz);
  const k = TAU / lambda;
  const step = lambda / perWavelength;
  const rx = [], ry = [], rz = [], sx = [], sy = [], sz = [], w = [];

  for (const path of paths) {
    const pts = path.points;
    const edges = [];
    let L = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len <= 1e-9) continue;
      edges.push({ a, u: [d[0] / len, d[1] / len, d[2] / len], len, start: L });
      L += len;
    }
    if (!edges.length) continue;

    const amp = path.amp ?? 1;
    const sf = Math.min(Math.max(path.feedAt ?? L / 2, 0), L);
    let a1, a2;
    if (sf <= 1e-9) { a1 = 0; a2 = 1; }                    // fed at the near end
    else if (sf >= L - 1e-9) { a1 = 1; a2 = 0; }           // fed at the far end
    else { a1 = Math.sin(k * (L - sf)); a2 = Math.sin(k * sf); }
    // Both branches vanish when the feed sits on a node of a full-wave wire
    // (L = n lambda, n even, fed at the centre). The physical distribution is
    // the two halves at equal amplitude; the continuity condition is satisfied
    // trivially there, so it cannot pick the scale for us.
    if (Math.abs(a1) < 1e-6 && Math.abs(a2) < 1e-6) { a1 = 1; a2 = 1; }
    const current = (u) => (u < sf ? a1 * Math.sin(k * u) : a2 * Math.sin(k * (L - u)));

    for (const e of edges) {
      const n = Math.max(1, Math.ceil(e.len / step));
      const dl = e.len / n;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * dl;
        rx.push(e.a[0] + e.u[0] * t);
        ry.push(e.a[1] + e.u[1] * t);
        rz.push(e.a[2] + e.u[2] * t);
        sx.push(e.u[0]); sy.push(e.u[1]); sz.push(e.u[2]);
        w.push(amp * current(e.start + t) * dl);
      }
    }
  }

  const driven = w.length;
  if (ground) {
    for (let i = 0; i < driven; i++) {
      rx.push(rx[i]); ry.push(ry[i]); rz.push(-rz[i]);
      sx.push(-sx[i]); sy.push(-sy[i]); sz.push(sz[i]);
      w.push(w[i]);
    }
  }

  return {
    k, ground, driven, n: w.length,
    rx: Float64Array.from(rx), ry: Float64Array.from(ry), rz: Float64Array.from(rz),
    sx: Float64Array.from(sx), sy: Float64Array.from(sy), sz: Float64Array.from(sz),
    w: Float64Array.from(w),
  };
}

/**
 * Radiated power density toward a unit direction, in arbitrary units.
 *
 * Sums the current elements into a complex vector, then keeps only the part
 * transverse to the direction of travel — the far field has no radial
 * component, and subtracting it is cheaper than resolving into theta/phi.
 */
export function power(seg, dx, dy, dz) {
  const { k, rx, ry, rz, sx, sy, sz, w, n } = seg;
  let fxr = 0, fxi = 0, fyr = 0, fyi = 0, fzr = 0, fzi = 0;
  for (let i = 0; i < n; i++) {
    const ph = k * (rx[i] * dx + ry[i] * dy + rz[i] * dz);
    const wc = w[i] * Math.cos(ph), ws = w[i] * Math.sin(ph);
    fxr += wc * sx[i]; fxi += ws * sx[i];
    fyr += wc * sy[i]; fyi += ws * sy[i];
    fzr += wc * sz[i]; fzi += ws * sz[i];
  }
  const dr = fxr * dx + fyr * dy + fzr * dz;
  const di = fxi * dx + fyi * dy + fzi * dz;
  const ax = fxr - dr * dx, bx = fxi - di * dx;
  const ay = fyr - dr * dy, by = fyi - di * dy;
  const az = fzr - dr * dz, bz = fzi - di * dz;
  return ax * ax + bx * bx + ay * ay + by * by + az * az + bz * bz;
}

/**
 * Height of the current maximum, metres, and whether that current is mostly
 * vertical there.
 *
 * This is how far off the ground the antenna actually radiates from, which is
 * not the same as how high the wire is — an inverted V's current maximum is at
 * its apex, not at the average of its ends. Callers use it to decide when the
 * perfect-ground assumption has stopped being a simplification and started
 * being a lie: directivity over perfect ground says nothing at all about the
 * power a low antenna dumps into real soil.
 */
export function currentMaximum(paths, fMHz) {
  const seg = buildSegments(paths, fMHz, { perWavelength: 32, ground: false });
  let best = -1, z = 0, vert = 0;
  for (let i = 0; i < seg.driven; i++) {
    const a = Math.abs(seg.w[i]);
    if (a > best) { best = a; z = seg.rz[i]; vert = Math.abs(seg.sz[i]); }
  }
  return { heightM: z, heightWavelengths: z / wavelength(fMHz), vertical: vert > 0.7 };
}

/** Unit vector for an azimuth/elevation pair, in the site frame. */
export function direction(elevDeg, azDeg) {
  const e = rad(elevDeg), a = rad(azDeg), ce = Math.cos(e);
  return [ce * Math.sin(a), ce * Math.cos(a), Math.sin(e)];
}

// --- pattern analysis ------------------------------------------------------

/**
 * Compute the pattern and the directivity it implies.
 *
 * Directivity comes from numerically integrating the power over the hemisphere
 * (or the whole sphere in free space) rather than from a table, which is what
 * lets it be checked: a free-space half wave lands on 2.15 dBi and a quarter
 * wave over perfect ground on 5.15 dBi, both to within a tenth of a dB. See the
 * tests. It is *directivity*, so it assumes no conductor, ground, or matching
 * loss whatsoever.
 */
export function analyse(paths, fMHz, {
  perWavelength = 32, ground = true, elevSteps = 361, azSteps = 721,
} = {}) {
  const seg = buildSegments(paths, fMHz, { perWavelength, ground });

  // Integration grid: 1 degree in elevation, 2 in azimuth, midpoint rule.
  const nE = ground ? 90 : 180, nA = 180;
  const span = ground ? Math.PI / 2 : Math.PI;
  const e0 = ground ? 0 : -Math.PI / 2;
  const dE = span / nE, dA = TAU / nA;
  let total = 0, peakP = 0, peakE = 0, peakA = 0;
  for (let i = 0; i < nE; i++) {
    const eps = e0 + (i + 0.5) * dE;
    const ce = Math.cos(eps), se = Math.sin(eps);
    for (let j = 0; j < nA; j++) {
      const az = (j + 0.5) * dA;
      const p = power(seg, ce * Math.sin(az), ce * Math.cos(az), se);
      total += p * ce * dE * dA;
      if (p > peakP) { peakP = p; peakE = deg(eps); peakA = deg(az); }
    }
  }
  // A geometry can cancel itself exactly: a horizontal wire lying on perfect
  // ground is annulled by its own image. Floating point leaves a residue of
  // around 1e-30 rather than a clean zero, so testing `total > 0` would sail
  // past it and go on to normalise that noise into a confident-looking plot.
  // The gate is therefore relative to the current on the wire. A real antenna
  // clears it by thirty orders of magnitude; a cancelled one cannot.
  let scaleRef = 0;
  for (let i = 0; i < seg.driven; i++) scaleRef += Math.abs(seg.w[i]);
  if (!(total > 1e-9 * scaleRef * scaleRef) || !(peakP > 0)) {
    throw new Error('antenna radiates no power — its own ground image cancels it. '
      + 'A horizontal wire needs height; check the geometry.');
  }

  // Refine the peak: the coarse grid is sized for the integral, not the answer.
  for (const [stepE, stepA] of [[0.25, 0.5], [0.05, 0.1]]) {
    for (let de = -10 * stepE; de <= 10 * stepE; de += stepE) {
      for (let da = -10 * stepA; da <= 10 * stepA; da += stepA) {
        const e = Math.min(90, Math.max(ground ? 0 : -90, peakE + de));
        const a = peakA + da;
        const p = power(seg, ...direction(e, a));
        if (p > peakP) { peakP = p; peakE = e; peakA = a; }
      }
    }
  }
  peakA = ((peakA % 360) + 360) % 360;

  const directivity = (4 * Math.PI * peakP) / total;
  const scale = directivity / peakP;
  // Floored at -99: a true null computes as -320 dB, which is arithmetically
  // correct and useless to plot against. Anything below -99 dBi is a null.
  const dbi = (p) => (p > 0 ? Math.max(-99, 10 * Math.log10(p * scale)) : -99);
  const gainAt = (elevDeg, azDeg) => dbi(power(seg, ...direction(elevDeg, azDeg)));

  // Elevation cut at the peak azimuth, plus the envelope over all azimuths —
  // an omnidirectional-looking elevation plot from a directional antenna is a
  // good way to mislead someone, and drawing both makes the difference visible.
  const elevCut = (azDeg, steps = elevSteps) => {
    const out = new Float64Array(steps);
    for (let i = 0; i < steps; i++) out[i] = gainAt((i * 90) / (steps - 1), azDeg);
    return out;
  };
  const envelope = new Float64Array(elevSteps);
  for (let i = 0; i < elevSteps; i++) {
    const e = (i * 90) / (elevSteps - 1);
    let best = -99;
    for (let a = 0; a < 360; a += 2) best = Math.max(best, gainAt(e, a));
    envelope[i] = best;
  }
  const azCut = (elevDeg, steps = azSteps) => {
    const out = new Float64Array(steps);
    for (let i = 0; i < steps; i++) out[i] = gainAt(elevDeg, (i * 360) / (steps - 1));
    return out;
  };

  // The *lowest* lobe, which for HF is usually the one that matters. Raise a
  // dipole high enough and its strongest lobe climbs toward the zenith while a
  // useful low lobe appears underneath it; reporting only the strongest would
  // recommend the wrong height for DX.
  const peakCut = elevCut(peakA);
  const lowest = lowestLobe(peakCut);

  return {
    segments: seg.driven,
    directivityDbi: 10 * Math.log10(directivity),
    peak: { gainDbi: 10 * Math.log10(directivity), elevationDeg: peakE, azimuthDeg: peakA },
    lowestLobe: lowest,
    elevSteps,
    azSteps,
    gainAt,
    elevCut,
    azCut,
    envelope,
    peakCut,
  };
}

/**
 * The lowest-elevation local maximum in an elevation cut, and how far down it
 * is from the best one. Returns null for a cut with no interior maximum (a
 * vertical, whose maximum is the horizon itself, reports 0 degrees).
 */
export function lowestLobe(cut) {
  const n = cut.length;
  const at = (i) => (i * 90) / (n - 1);
  let best = -Infinity;
  for (const v of cut) best = Math.max(best, v);
  for (let i = 0; i < n - 1; i++) {
    const rising = i === 0 ? cut[1] < cut[0] : cut[i] > cut[i - 1];
    if (rising && cut[i] >= cut[i + 1]) {
      return { elevationDeg: at(i), gainDbi: cut[i], belowPeakDb: best - cut[i] };
    }
  }
  return null;
}

/** Elevation angles bounding the main lobe at -3 dB, or null if it never drops. */
export function halfPowerElevation(cut, peakDbi) {
  const n = cut.length;
  let iPeak = 0;
  for (let i = 1; i < n; i++) if (cut[i] > cut[iPeak]) iPeak = i;
  const edge = (dir) => {
    for (let i = iPeak; i >= 0 && i < n; i += dir) {
      if (cut[i] <= peakDbi - 3) return (i * 90) / (n - 1);
    }
    return null;
  };
  return { lowDeg: edge(-1), highDeg: edge(1), peakDeg: (iPeak * 90) / (n - 1) };
}

/**
 * Count distinct lobes in a cut. Used to say out loud what happens to a
 * multiband wire on its higher bands: the pattern does not merely narrow, it
 * breaks into lobes with nulls between them, and the nulls are where the
 * contact you wanted is.
 *
 * `wrap` for an azimuth cut, whose first and last samples are the same
 * bearing. Without it a lobe sitting on due north is cut in half by the ends of
 * the array and counted twice — which reports a plain dipole as having three.
 */
export function countLobes(cut, { floorDb = 6, wrap = false } = {}) {
  const vals = wrap ? Array.from(cut).slice(0, -1) : Array.from(cut);
  const n = vals.length;
  if (!n) return 0;
  let peak = -Infinity;
  for (const v of vals) peak = Math.max(peak, v);
  const thr = peak - floorDb;
  const above = vals.map((v) => v >= thr);
  if (above.every(Boolean)) return 1;
  let lobes = 0;
  for (let i = 0; i < n; i++) {
    if (!above[i]) continue;
    const prev = i === 0 ? (wrap ? above[n - 1] : false) : above[i - 1];
    if (!prev) lobes++;
  }
  return lobes;
}
