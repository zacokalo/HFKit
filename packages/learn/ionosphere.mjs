// A teaching model of the ionosphere, for the Learn page.
//
// WHAT THIS IS
// ------------
// The mirror-and-secant picture every HF primer draws: layers at fixed virtual
// heights, a critical frequency for each, the secant law for a ray that meets a
// layer at a slant, and a D layer that soaks up low frequencies in daylight.
// Where a classical CCIR/ITU formula exists it is used as published — foE, and
// the George–Bradley D-layer absorption. Where one does not, round mid-latitude
// textbook values stand in: foF2 by day and by night.
//
// WHAT THIS IS NOT
// ----------------
// A prediction. It has one ionosphere, identical along the whole path, at a
// notional 45° latitude at an equinox. It knows nothing of geography, season,
// the geomagnetic field, noise, or anyone's station. Its job is to get the
// *shapes* right — the MUF climbs with distance, the skip zone grows with
// frequency, the low bands die at noon and wake at night — so that when someone
// meets the real engine's output on the planner it already makes sense.
//
// Real circuits go to ITU-R P.533 via the planner and the reach map. Every
// widget that draws from this module says so, and nothing outside the Learn
// page imports it.
//
// Geometry: Earth centre at the origin, a ray leaving the ground at elevation
// `elevationDeg` (0 = horizon, 90 = straight up). Distances are ground range
// in km along the surface. Hours are local solar time, 0–24.

export const EARTH_RADIUS_KM = 6371;

/** Height the D-layer absorption formula takes its incidence angle at. */
export const D_LAYER_KM = 100;
export const E_LAYER_KM = 110;

/** The notional latitude the whole model sits at. */
export const LATITUDE_DEG = 45;

/** Rays leaving below this are treated as lost to terrain and ground loss. */
export const MIN_ELEVATION_DEG = 3;

/** Electron gyrofrequency, the fH in the absorption formula. Mid-latitude. */
const GYRO_MHZ = 1.2;

/**
 * How much D-layer absorption a signal survives, in dB, before it is called
 * too weak. Roughly what separates a readable 100 W voice signal from nothing;
 * it stands in for the whole link budget the model does not compute.
 */
export const DEFAULT_BUDGET_DB = 30;

/** Lost at each ground reflection on a multi-hop path. Average land, rounded. */
export const GROUND_LOSS_DB = 2;

// foF2 at local noon and pre-dawn as a function of sunspot number: round
// mid-latitude equinox values, not a model of anywhere in particular.
// SSN 0 -> 6 MHz by day, 2.8 by night; SSN 200 -> 12 and 6.
const dayFoF2 = (ssn) => 6 + 0.03 * ssn;
const nightFoF2 = (ssn) => 2.8 + 0.016 * ssn;

// foE never quite reaches zero after dark; this residual only matters for
// 160 m at grazing angles, which is also true of the real night-time E region.
const NIGHT_FOE = 0.5;

// A little D-region ionisation survives the night. Without a floor the model
// would claim zero absorption at midnight, which no one has ever observed.
const NIGHT_ABSORPTION_INDEX = 0.02;

// The F2 layer lags the sun: it builds for an hour or two after sunrise and
// decays over several hours after sunset, so its minimum is just before dawn
// and its peak is early afternoon. A first-order lag reproduces that.
const F2_RISE_HOURS = 1.5;
const F2_DECAY_HOURS = 3;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const wrapHour = (h) => ((h % 24) + 24) % 24;

// --- the sun ---------------------------------------------------------------

/**
 * Solar zenith angle at LATITUDE_DEG on an equinox: 45° at noon, 90° at 06:00
 * and 18:00, 135° at midnight.
 */
export function solarZenithDeg(hour) {
  const hourAngle = rad(15 * (wrapHour(hour) - 12));
  return deg(Math.acos(Math.cos(rad(LATITUDE_DEG)) * Math.cos(hourAngle)));
}

/** 0 at night, 1 at local noon: how high the sun is, normalised. */
export function daylight(hour) {
  const c = Math.cos(rad(solarZenithDeg(hour)));
  return Math.max(0, c) / Math.cos(rad(LATITUDE_DEG));
}

const STEPS_PER_HOUR = 12;
const F2_LAG = (() => {
  const n = 24 * STEPS_PER_HOUR;
  const dt = 1 / STEPS_PER_HOUR;
  const out = new Float64Array(n);
  let g = 0;
  // Three days is enough for the lag to settle into its daily cycle.
  for (let day = 0; day < 3; day++) {
    for (let i = 0; i < n; i++) {
      const target = daylight(i * dt);
      const tau = target > g ? F2_RISE_HOURS : F2_DECAY_HOURS;
      g += (target - g) * (1 - Math.exp(-dt / tau));
      out[i] = g;
    }
  }
  return out;
})();

/** 0–1: how built-up the F layer is at this hour, lagging the sun. */
export function f2Activity(hour) {
  const x = wrapHour(hour) * STEPS_PER_HOUR;
  const i = Math.floor(x);
  const a = F2_LAG[i % F2_LAG.length], b = F2_LAG[(i + 1) % F2_LAG.length];
  return a + (b - a) * (x - i);
}

// --- the layers ------------------------------------------------------------

/**
 * The ionosphere at one hour and one level of solar activity.
 *
 *   foF2, foE        critical frequencies, MHz: the highest that comes back
 *                    when sent straight up
 *   hF, hE           virtual reflection heights, km
 *   absorptionIndex  the I in the George–Bradley formula: how much the D
 *                    layer is absorbing, 0 at night-ish, ~1 at noon
 */
export function ionosphere({ hour, ssn }) {
  const g = f2Activity(hour);
  const chi = solarZenithDeg(hour);
  const cosChi = Math.cos(rad(chi));
  const foE = cosChi > 0
    ? Math.max(NIGHT_FOE, 0.9 * ((180 + 1.44 * ssn) * cosChi) ** 0.25)
    : NIGHT_FOE;
  // cos(0.881 chi) reaches zero at chi = 102 degrees, which gives the D layer
  // the short twilight tail it really has rather than vanishing at sunset.
  const sunTerm = chi < 102 ? Math.cos(rad(0.881 * chi)) ** 1.3 : 0;
  return {
    hour: wrapHour(hour),
    ssn,
    daylight: daylight(hour),
    solarZenithDeg: chi,
    foF2: nightFoF2(ssn) + (dayFoF2(ssn) - nightFoF2(ssn)) * g,
    foE,
    hF: 300 + 30 * (1 - g),      // the F layer rises a little at night
    hE: E_LAYER_KM,
    absorptionIndex: (1 + 0.0037 * ssn) * Math.max(NIGHT_ABSORPTION_INDEX, sunTerm),
  };
}

// --- geometry of a hop -----------------------------------------------------

/**
 * The angle from the vertical at which a ray leaving the ground at
 * `elevationDeg` meets a layer at `heightKm`. On a curved Earth this is always
 * steeper than the take-off angle suggests, which is why the MUF is higher for
 * long hops.
 */
export function incidenceDeg(elevationDeg, heightKm) {
  const R = EARTH_RADIUS_KM;
  return deg(Math.asin((R * Math.cos(rad(elevationDeg))) / (R + heightKm)));
}

/** Ground distance covered by one hop off a layer at `heightKm`. */
export function hopDistanceKm(elevationDeg, heightKm) {
  const halfCentralDeg = 90 - elevationDeg - incidenceDeg(elevationDeg, heightKm);
  return 2 * EARTH_RADIUS_KM * rad(halfCentralDeg);
}

/** The inverse: take-off angle for a hop of `hopKm`. Negative = impossible. */
export function elevationForHopDeg(hopKm, heightKm) {
  const R = EARTH_RADIUS_KM;
  const half = hopKm / (2 * R);
  if (half <= 0) return 90;
  return deg(Math.atan2(Math.cos(half) - R / (R + heightKm), Math.sin(half)));
}

/** Fewest hops that span `distanceKm` while leaving above MIN_ELEVATION_DEG. */
export function hopsFor(distanceKm, heightKm) {
  let n = 1;
  while (elevationForHopDeg(distanceKm / n, heightKm) < MIN_ELEVATION_DEG) n++;
  return n;
}

// --- what happens to a ray -------------------------------------------------

/**
 * D-layer absorption for one hop — down through the layer and back up —
 * in dB. George & Bradley's CCIR formula: it falls off roughly as the square
 * of frequency, which is the whole reason 80 m is a night band.
 */
export function absorptionDb(fMHz, elevationDeg, iono) {
  const sec = 1 / Math.cos(rad(incidenceDeg(elevationDeg, D_LAYER_KM)));
  return (677.2 * iono.absorptionIndex * sec) / ((fMHz + GYRO_MHZ) ** 1.98 + 10.2);
}

/**
 * Which layer, if any, turns a ray back. The secant law: a layer that returns
 * foF2 straight up returns foF2 / cos(i) at incidence i. The E layer is tested
 * first because a ray it reflects never reaches the F layer.
 */
export function reflection(fMHz, elevationDeg, iono) {
  const iE = incidenceDeg(elevationDeg, iono.hE);
  if (fMHz <= iono.foE / Math.cos(rad(iE))) return { layer: 'E', heightKm: iono.hE };
  const iF = incidenceDeg(elevationDeg, iono.hF);
  if (fMHz <= iono.foF2 / Math.cos(rad(iF))) return { layer: 'F', heightKm: iono.hF };
  return null;
}

/** Highest frequency the layers return at this take-off angle. */
export function mufAtAngleMHz(elevationDeg, iono) {
  const iF = incidenceDeg(elevationDeg, iono.hF);
  const iE = incidenceDeg(elevationDeg, iono.hE);
  return Math.max(iono.foF2 / Math.cos(rad(iF)), iono.foE / Math.cos(rad(iE)));
}

/**
 * Follow one ray out to `rangeKm`.
 *
 *   fate   'escapes'   above the MUF for this angle; gone into space
 *          'absorbed'  comes back, but the D layer took more than the budget
 *                      before the first landing
 *          'reflects'  comes back, heard at least once
 *   hops   every landing, each with the loss accumulated to reach it and
 *          whether that is still inside the budget
 */
export function traceRay({
  fMHz, elevationDeg, iono, rangeKm = 12000,
  budgetDb = DEFAULT_BUDGET_DB, maxHops = 40,
}) {
  const perHopDb = absorptionDb(fMHz, elevationDeg, iono);
  const r = reflection(fMHz, elevationDeg, iono);
  if (!r) {
    return {
      fate: 'escapes', layer: null, apexKm: null, hopKm: null,
      perHopDb, escapeLossDb: perHopDb / 2, hops: [],
    };
  }
  const hopKm = hopDistanceKm(elevationDeg, r.heightKm);
  const hops = [];
  let lost = 0, at = 0;
  while (hops.length < maxHops && at < rangeKm) {
    lost += perHopDb + (hops.length ? GROUND_LOSS_DB : 0);
    at += hopKm;
    hops.push({ landKm: at, lossDb: lost, heard: lost <= budgetDb });
  }
  return {
    fate: hops[0].heard ? 'reflects' : 'absorbed',
    layer: r.layer, apexKm: r.heightKm, hopKm, perHopDb, hops,
  };
}

/**
 * One leg of a ray, ground to `apexKm`, as [groundKm, altitudeKm] pairs. The
 * ray is straight in space; sampling it lets a caller draw it through any
 * mapping, including one that exaggerates height.
 */
export function legPoints(elevationDeg, apexKm, samples = 24) {
  const R = EARTH_RADIUS_KM, b = rad(elevationDeg);
  const sinB = Math.sin(b), cosB = Math.cos(b);
  const sMax = -R * sinB + Math.sqrt((R * sinB) ** 2 + (R + apexKm) ** 2 - R * R);
  const out = [];
  for (let k = 0; k <= samples; k++) {
    const s = (sMax * k) / samples;
    const x = s * cosB, y = R + s * sinB;
    out.push([R * Math.atan2(x, y), Math.hypot(x, y) - R]);
  }
  return out;
}

// --- a path over a day -----------------------------------------------------

/** Maximum usable frequency for a path of `distanceKm`, via the F layer. */
export function mufMHz(distanceKm, iono) {
  const n = hopsFor(distanceKm, iono.hF);
  const e = elevationForHopDeg(distanceKm / n, iono.hF);
  return iono.foF2 / Math.cos(rad(incidenceDeg(e, iono.hF)));
}

/**
 * Lowest usable frequency: the lowest that survives the D layer over every hop
 * within `budgetDb`. Solves the absorption formula for f. Returns 0 when the
 * D layer is too weak to set a limit, which at night it usually is.
 */
export function lufMHz(distanceKm, iono, budgetDb = DEFAULT_BUDGET_DB) {
  const n = hopsFor(distanceKm, iono.hF);
  const e = elevationForHopDeg(distanceKm / n, iono.hF);
  const sec = 1 / Math.cos(rad(incidenceDeg(e, D_LAYER_KM)));
  const available = budgetDb - (n - 1) * GROUND_LOSS_DB;
  if (available <= 0) return Infinity;
  const need = (n * 677.2 * iono.absorptionIndex * sec) / available - 10.2;
  if (need <= 0) return 0;
  return Math.max(0, need ** (1 / 1.98) - GYRO_MHZ);
}

/**
 * The skip distance: the nearest ground range a sky wave on `fMHz` can land at.
 * Zero when the frequency is below foF2 — every angle comes back, including
 * straight up, which is NVIS. Infinity when no angle comes back at all.
 */
export function skipDistanceKm(fMHz, iono) {
  if (fMHz <= iono.foF2) return 0;
  const R = EARTH_RADIUS_KM;
  // The steepest ray the layer still returns meets it at cos(i) = foF2 / f.
  const i = Math.acos(iono.foF2 / fMHz);
  const cosB = ((R + iono.hF) * Math.sin(i)) / R;
  if (cosB >= 1) return Infinity;
  const beta = deg(Math.acos(cosB));
  if (beta < MIN_ELEVATION_DEG) return Infinity;
  return hopDistanceKm(beta, iono.hF);
}

/**
 * Is a frequency usable on this path at this moment, and if not, why not.
 *   'open'      comfortably inside the window
 *   'marginal'  inside, but within 15% of the MUF (above the FOT) or within
 *               20% of the LUF — works some days, not others
 *   'skips'     above the MUF: passes over, or out into space
 *   'absorbed'  below the LUF: the D layer takes it
 */
export function bandStatus(fMHz, distanceKm, iono, budgetDb = DEFAULT_BUDGET_DB) {
  const muf = mufMHz(distanceKm, iono);
  const luf = lufMHz(distanceKm, iono, budgetDb);
  let status;
  if (fMHz > muf) status = 'skips';
  else if (fMHz < luf) status = 'absorbed';
  else if (fMHz > 0.85 * muf || fMHz < 1.2 * luf) status = 'marginal';
  else status = 'open';
  return { status, muf, luf };
}

/** MUF and LUF through a whole day, for charting. */
export function dayCurve(distanceKm, ssn, { stepHours = 0.25, budgetDb = DEFAULT_BUDGET_DB } = {}) {
  const out = [];
  for (let h = 0; h <= 24 + 1e-9; h += stepHours) {
    const iono = ionosphere({ hour: h, ssn });
    out.push({ hour: h, muf: mufMHz(distanceKm, iono), luf: lufMHz(distanceKm, iono, budgetDb) });
  }
  return out;
}
