// Which antenna, which band, pointed where — and why the others fall short.
//
// This is the reasoning behind the comms planner page. It is pure: it takes
// the geometry of the paths someone needs to work, the antennas they could put
// up, and (optionally) the per-band margins the propagation engine computed
// for each path, and returns a ranking with every reason spelled out. Nothing
// in here touches the DOM or the engine, so the browser imports the same file
// the unit tests run against.
//
// Two different questions are kept separate on purpose, because they have
// different answers and different owners:
//
//   1. Will the ionosphere carry this band to that site at this hour?
//      That is the engine's answer (ITU-R P.533), expressed as an SNR margin
//      for an isotropic antenna. This module never guesses at it. With no
//      engine result it says so and ranks on geometry alone.
//
//   2. Does this antenna put its power where that path needs it?
//      That is the thin-wire model's answer: the take-off angle the distance
//      demands, the gain the pattern delivers there, and the real-world loss
//      the perfect-ground model leaves out (see cautions() in catalogue.mjs).
//
// The combined figure is simply (1) + gain − loss. It is an SNR margin, not a
// probability, and the page labels it as such.

import {
  analyse, candidateElevations, currentMaximum, greatCircleKm, initialBearingDeg,
  minimumHops, wavelength,
} from './physics.mjs';
import { buildAntenna, defaultParams } from './catalogue.mjs';

/** A modelled null is infinitely deep; a real one rarely passes −20 dBi. */
export const GAIN_FLOOR_DBI = -20;

/** Below this azimuth spread at the working elevation, orientation is moot. */
export const DIRECTIONAL_DB = 3;

/** Combined-margin thresholds, in dB, shared with the planner page's legend. */
export const VERDICT = [
  { id: 'works', minDb: 6, word: 'Works', token: 'good' },
  { id: 'marginal', minDb: 0, word: 'Marginal', token: 'fair' },
  { id: 'weak', minDb: -10, word: 'Weak', token: 'poor' },
  { id: 'no', minDb: -Infinity, word: 'Won’t work', token: 'closed' },
];

export const verdictFor = (marginDb) =>
  VERDICT.find((v) => marginDb >= v.minDb) ?? VERDICT[VERDICT.length - 1];

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassName = (deg) =>
  COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

const norm360 = (d) => ((d % 360) + 360) % 360;
/** Smallest angle between two bearings, 0–180. */
const angleBetween = (a, b) => {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
};
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const fmt0 = (n) => Math.round(n).toString();
const hh = (h) => `${String(h).padStart(2, '0')}Z`;

// --- paths -----------------------------------------------------------------

/**
 * Everything the antenna reasoning needs to know about one path: how far,
 * which way, and the take-off angles that could carry it.
 */
export function describePath(from, to, { layerHeightKm = 300 } = {}) {
  const distanceKm = greatCircleKm(from, to);
  return {
    distanceKm,
    bearingDeg: initialBearingDeg(from, to),
    hops: minimumHops(distanceKm, layerHeightKm),
    elevations: candidateElevations(distanceKm, { layerHeightKm }),
  };
}

// --- loss the pattern cannot see ------------------------------------------

/**
 * Sum of the numeric losses the catalogue's cautions carry, as a range and a
 * midpoint. Capped, because the individual figures are each conservative and
 * stacking three of them can overstate a bad antenna past the point of being
 * informative. The whole thing is an estimate and is labelled as one.
 */
export function estimatedLoss(built, { capDb = 12 } = {}) {
  const items = built.cautions.filter((c) => Array.isArray(c.lossDb));
  let lo = 0, hi = 0;
  for (const c of items) { lo += c.lossDb[0]; hi += c.lossDb[1]; }
  lo = Math.min(capDb, lo); hi = Math.min(capDb, hi);
  return { lo, hi, mid: (lo + hi) / 2, items };
}

// --- one antenna against every path, on every band -------------------------

/**
 * Where the wire should run so that no site is left in a null.
 *
 * The model lays a wire along x (east–west when `orientationDeg` is 90), so a
 * site at true bearing B sits at pattern azimuth B − (orientation − 90). The
 * search maximises the *worst* site's gain, not the average: a plan that
 * reaches two sites brilliantly and the third not at all is not a plan.
 */
export function bestOrientation(pattern, paths, { stepDeg = 5 } = {}) {
  let best = { orientationDeg: 90, minGainDbi: -Infinity };
  for (let o = 0; o < 180; o += stepDeg) {
    let worst = Infinity;
    for (const p of paths) {
      const g = gainToward(pattern, p, o).gainDbi;
      if (g < worst) worst = g;
    }
    if (worst > best.minGainDbi) best = { orientationDeg: o, minGainDbi: worst };
  }
  return best;
}

/** Gain toward a path, taking whichever hop geometry the pattern favours. */
function gainToward(pattern, path, orientationDeg) {
  const rel = path.bearingDeg - (orientationDeg - 90);
  let gainDbi = -Infinity, elevationDeg = path.elevations[0];
  for (const e of path.elevations) {
    const g = Math.max(GAIN_FLOOR_DBI, pattern.gainAt(e, rel));
    if (g > gainDbi) { gainDbi = g; elevationDeg = e; }
  }
  return { gainDbi, elevationDeg, relAzDeg: norm360(rel) };
}

/** Is orientation worth choosing? Azimuth spread at the working elevations. */
function isDirectional(pattern, paths) {
  const elev = paths.length
    ? paths.reduce((s, p) => s + p.elevations[0], 0) / paths.length
    : pattern.peak.elevationDeg;
  if (elev > 75) return false;              // straight up: direction is moot
  const cut = pattern.azCut(elev, 73);
  let lo = Infinity, hi = -Infinity;
  for (const g of cut) { const v = Math.max(GAIN_FLOOR_DBI, g); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return hi - lo >= DIRECTIONAL_DB;
}

/**
 * Evaluate one antenna, as built with `params`, on each of `freqsMHz`, against
 * every path. Returns plain data (no closures), so the result can cross a
 * worker boundary.
 *
 * `designMHz` is what the wire is cut for. Left null, the wire is assumed cut
 * for whichever band is being evaluated — the planner's recommendation includes
 * "cut it for this band", so that is the honest comparison. Multiband
 * compromises and fixed-length antennas pass a design frequency, because
 * nobody re-cuts a G5RV per band.
 */
export function evaluateAntenna({
  antenna, params = {}, freqsMHz, paths, orientationDeg = null, designMHz = null,
  perWavelength = 16, siteNames = null,
}) {
  const p = { ...defaultParams(antenna), ...params };
  const bands = freqsMHz.map((f) => {
    const built = buildAntenna(antenna, {
      designMHz: designMHz ?? f, operatingMHz: f, params: p,
    });
    let pattern;
    try {
      pattern = analyse(built.paths, f, { perWavelength });
    } catch (e) {
      return { mhz: f, error: e.message, perSite: [], loss: { lo: 0, hi: 0, mid: 0, items: [] } };
    }
    const loss = estimatedLoss(built);
    const cm = currentMaximum(built.paths, f);
    const directional = isDirectional(pattern, paths);
    const orient = orientationDeg !== null ? orientationDeg
      : directional ? bestOrientation(pattern, paths).orientationDeg : 90;

    const perSite = paths.map((path, i) => {
      const { gainDbi, elevationDeg, relAzDeg } = gainToward(pattern, path, orient);
      // How much is lost to pointing, split into the two things a person can
      // change: height (elevation) and orientation (azimuth).
      const downFromPeakDb = pattern.peak.gainDbi - gainDbi;
      let bestAtElev = -Infinity;
      for (let a = 0; a < 360; a += 5) {
        bestAtElev = Math.max(bestAtElev, pattern.gainAt(elevationDeg, a));
      }
      const offAxisDb = Math.max(0, Math.max(GAIN_FLOOR_DBI, bestAtElev) - gainDbi);
      const name = siteNames?.[i] ?? `site ${i + 1}`;
      return {
        name, elevationDeg, gainDbi, downFromPeakDb, offAxisDb, relAzDeg,
        effectiveDbi: gainDbi - loss.mid,
        reasons: siteReasons({
          name, path, elevationDeg, gainDbi, downFromPeakDb, offAxisDb, directional,
          pattern, cm, built, f, orient,
        }),
      };
    });

    return {
      mhz: f,
      orientationDeg: orient,
      directional,
      peak: { gainDbi: pattern.peak.gainDbi, elevationDeg: pattern.peak.elevationDeg },
      heightWavelengths: cm.heightWavelengths,
      vertical: cm.vertical,
      loss,
      perSite,
      minEffectiveDbi: perSite.length ? Math.min(...perSite.map((s) => s.effectiveDbi)) : null,
      worstDownDb: perSite.length ? Math.max(...perSite.map((s) => s.downFromPeakDb)) : 0,
      warnings: built.warnings,
      antennaReasons: antennaReasons(built, loss, f),
    };
  });
  return { antennaId: antenna.id, name: antenna.name, params: p, bands };
}

/** Why this site, on this band, is not getting the antenna's best. */
function siteReasons({
  name, path, elevationDeg, downFromPeakDb, offAxisDb, directional, pattern, cm, built, f, orient,
}) {
  const out = [];
  const need = elevationDeg;
  const peakE = pattern.peak.elevationDeg;
  const lam = wavelength(f);
  const elevDown = downFromPeakDb - offAxisDb;     // the part height could fix

  if (elevDown >= 3) {
    const tooLow = need > peakE + 2;              // path wants a steeper angle
    let fix;
    if (cm.vertical) {
      fix = need >= 55
        ? 'A vertical cannot fire that steeply. For this site use a low horizontal '
          + 'wire (NVIS) instead.'
        : 'A better ground system or counterpoise is what lifts a vertical’s '
          + 'low-angle lobe.';
    } else if (tooLow) {
      fix = `Lower it: at 0.15–0.25 wavelengths (${fmt1(0.15 * lam)}–`
        + `${fmt1(0.25 * lam)} m here) a horizontal wire fires almost straight up.`;
    } else {
      fix = `Raise it: at half a wavelength (${fmt1(0.5 * lam)} m here) the lobe `
        + 'drops to about 30°, and it keeps dropping with more height.';
    }
    out.push({
      code: tooLow ? 'angle-too-low' : 'angle-too-high',
      severity: elevDown >= 8 ? 'blocker' : 'warn',
      text: `${name} needs a ${fmt0(need)}° take-off (${fmt0(path.distanceKm)} km, `
        + `${path.hops} hop${path.hops > 1 ? 's' : ''}); this antenna is ${fmt1(elevDown)} dB `
        + `down there — it favours ${fmt0(peakE)}°.`,
      fix,
    });
  }

  if (directional && offAxisDb >= 3) {
    const broadside = norm360(orient - 90);
    const off = Math.min(angleBetween(path.bearingDeg, broadside),
      angleBetween(path.bearingDeg, broadside + 180));
    out.push({
      code: 'off-axis',
      severity: offAxisDb >= 8 ? 'blocker' : 'warn',
      text: `${name} lies ${fmt0(off)}° off the wire’s broadside, costing `
        + `${fmt1(offAxisDb)} dB.`,
      fix: `Turning the wire so its broadside faces ${fmt0(path.bearingDeg)}° `
        + `(${compassName(path.bearingDeg)}) recovers it — at the expense of any `
        + 'site that direction leaves off the ends. A second wire, or an inverted V, '
        + 'softens the nulls.',
    });
  }
  return out;
}

/** Losses that belong to the antenna rather than to any one path. */
function antennaReasons(built, loss, f) {
  const out = [];
  for (const c of loss.items) {
    if (c.code === 'ground-nvis') continue;       // the design, not a defect
    const [lo, hi] = c.lossDb;
    const sev = hi >= 6 ? 'blocker' : 'warn';
    const base = { code: c.code, severity: sev, lossDb: c.lossDb };
    switch (c.code) {
      case 'short':
        out.push({ ...base,
          text: `Electrically short on ${fmt1(f)} MHz: roughly ${fmt1(lo)}–${fmt1(hi)} dB `
            + 'is lost in the coupler and ground return before anything radiates.',
          fix: 'A longer radiator, a better counterpoise, or a higher band where the '
            + 'same metal is a larger fraction of a wavelength.' });
        break;
      case 'terminated':
        out.push({ ...base,
          text: `The terminating resistor eats ${lo}–${hi} dB on every band.`,
          fix: 'Accept it for the no-tune convenience, or use a resonant wire where you '
            + 'have time to trim one.' });
        break;
      case 'ground-radials':
        out.push({ ...base,
          text: `Ground return through ${built.radials?.count ?? 'few'} radials costs `
            + `about ${lo}–${hi} dB over average soil.`,
          fix: 'More radials — sixteen is a big step up from four, and thirty-two '
            + 'is close to the limit of what helps.' });
        break;
      case 'ground-return':
        out.push({ ...base,
          text: `No counterpoise to speak of: expect ${lo}–${hi} dB lost in the return path.`,
          fix: 'Lay out a few radials or a counterpoise wire; even a short one is far '
            + 'better than the coax shield.' });
        break;
      case 'ground-low':
        out.push({ ...base,
          text: `At ${fmt1(built.cautions.length ? currentMaximum(built.paths, f).heightWavelengths : 0)} `
            + `wavelengths up the ground takes ${lo}–${hi} dB the model does not show.`,
          fix: 'Raise it — unless the plan is NVIS, in which case this is the price '
            + 'of the overhead pattern and worth paying.' });
        break;
      default:
        out.push({ ...base, text: c.text, fix: null });
    }
  }
  return out;
}

// --- engine margins + antenna gain -----------------------------------------

/** Power is an exact offset on an SNR margin: 10·log10(W / W₀). */
export const powerOffsetDb = (watts, engineWatts = 100) =>
  10 * Math.log10(Math.max(0.1, watts) / engineWatts);

/**
 * Per-hour combined margin for one antenna on one band.
 *
 * `engineBand[siteIndex][hourIndex]` is the engine's SNR margin for an
 * isotropic antenna at the power the engine was run at, or null where it could
 * not predict. The combined figure adds the power offset and the antenna's
 * effective gain toward that site. The minimum across sites is the number that
 * answers "can I reach everyone".
 */
export function combine(bandEval, engineBand, powerOffsetDb = 0) {
  const hours = engineBand[0]?.length ?? 0;
  const out = [];
  for (let h = 0; h < hours; h++) {
    let min = Infinity;
    const perSite = bandEval.perSite.map((s, i) => {
      const m = engineBand[i]?.[h];
      if (m === null || m === undefined) { min = -Infinity; return null; }
      const v = m + powerOffsetDb + s.effectiveDbi;
      if (v < min) min = v;
      return v;
    });
    out.push({ min: Number.isFinite(min) ? min : null, perSite });
  }
  return out;
}

/** Contiguous runs of hours whose value passes `test`, as "06–11Z" strings. */
export function windows(values, test = (v) => v !== null && v >= 0) {
  const n = values.length;
  if (!n) return [];
  const runs = [];
  let start = null;
  for (let h = 0; h < n; h++) {
    const ok = test(values[h]);
    if (ok && start === null) start = h;
    if (!ok && start !== null) { runs.push([start, h - 1]); start = null; }
  }
  if (start !== null) runs.push([start, n - 1]);
  // A run that wraps midnight is one window, not two.
  if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === n - 1) {
    const last = runs.pop();
    runs[0] = [last[0], runs[0][1]];
  }
  return runs.map(([a, b]) => ({ from: a, to: b, text: a === b ? hh(a) : `${hh(a)}–${hh(b)}` }));
}

/**
 * Rank antennas, and for each pick the band that serves every site best right
 * now. With engine results the score is the combined margin at `nowHour`,
 * with hours-open as the tie-break; without them it is the geometry alone,
 * and the result says so.
 */
export function recommend({
  evaluations, engine = null, nowHour = 0, bandLabels = null, powerOffsetDb = 0,
}) {
  const label = (i, mhz) => bandLabels?.[i] ?? `${fmt1(mhz)} MHz`;
  const ranked = evaluations.map((ev) => {
    const perBand = ev.bands.map((b, bi) => {
      if (b.error) return { bandIndex: bi, mhz: b.mhz, label: label(bi, b.mhz), error: b.error, score: -Infinity };
      if (!engine) {
        // Geometry only: how far below its own best does the worst site sit,
        // plus what the ground really charges.
        const penalty = b.worstDownDb + b.loss.mid;
        return {
          bandIndex: bi, mhz: b.mhz, label: label(bi, b.mhz),
          score: -penalty, geometryOnly: true,
          verdict: penalty < 3 ? VERDICT[0] : penalty < 6 ? VERDICT[1] : penalty < 10 ? VERDICT[2] : VERDICT[3],
          hours: null, nowMargin: null, open: [], hoursOpen: 0,
        };
      }
      const hours = combine(b, engine.map((site) => site.map((hour) => hour[bi])), powerOffsetDb);
      const mins = hours.map((h) => h.min);
      const now = mins[nowHour];
      const hoursOpen = mins.filter((m) => m !== null && m >= 0).length;
      const score = (now === null ? -99 : now) + hoursOpen / 100;
      return {
        bandIndex: bi, mhz: b.mhz, label: label(bi, b.mhz),
        score, hours, nowMargin: now, hoursOpen, open: windows(mins),
        verdict: now === null ? VERDICT[3] : verdictFor(now),
        bestHour: mins.reduce((best, m, h) => (m !== null && (best === null || m > mins[best]) ? h : best), null),
      };
    });
    const sorted = [...perBand].sort((a, b) => b.score - a.score);
    const best = sorted[0];
    return {
      antennaId: ev.antennaId, name: ev.name, params: ev.params,
      best, perBand, alternatives: sorted.slice(1, 3),
      reasons: best?.error ? [] : reasonsFor(ev.bands[best.bandIndex], best, engine, nowHour, powerOffsetDb),
    };
  }).sort((a, b) => (b.best?.score ?? -Infinity) - (a.best?.score ?? -Infinity));

  return {
    ranked,
    best: ranked[0] ?? null,
    geometryOnly: !engine,
  };
}

/** Every reason the chosen band on this antenna is not better, engine included. */
function reasonsFor(bandEval, bandPick, engine, nowHour, powerOffsetDb = 0) {
  const out = [];
  if (engine && bandPick.hours) {
    bandEval.perSite.forEach((s, i) => {
      // At the chosen power, for an isotropic antenna: what the band does on
      // its own, before this antenna helps or hurts.
      const raw = engine[i].map((hour) => {
        const m = hour[bandPick.bandIndex];
        return m === null || m === undefined ? null : m + powerOffsetDb;
      });
      const now = raw[nowHour];
      if (now === null || now === undefined) {
        out.push({ code: 'no-prediction', severity: 'blocker', site: s.name,
          text: `The engine could not predict the path to ${s.name} on this band.`, fix: null });
      } else if (now < 0) {
        const open = windows(raw);
        out.push({
          code: 'band-closed', severity: now < -10 ? 'blocker' : 'warn', site: s.name,
          text: `The band itself is ${now < -10 ? 'closed' : 'weak'} to ${s.name} at ${hh(nowHour)} `
            + `(${fmt0(now)} dB for an isotropic antenna) — no antenna fixes that.`,
          fix: open.length ? `It opens ${open.map((w) => w.text).join(', ')}.`
            : 'It does not open to that site today on this band; try another band.',
        });
      }
    });
  }
  for (const s of bandEval.perSite) for (const r of s.reasons) out.push({ ...r, site: s.name });
  for (const r of bandEval.antennaReasons) out.push(r);
  const rank = { blocker: 0, warn: 1 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// --- the build sheet -------------------------------------------------------

/** Does the geometry follow the design frequency, or is it a fixed shape? */
export function geometryFollowsDesign(antenna, params, operatingMHz) {
  if (antenna.cutPerBand) return true;
  const shape = (f) => JSON.stringify(
    buildAntenna(antenna, { designMHz: f, operatingMHz, params }).paths
      .map((p) => p.points.map((pt) => pt.map((n) => Math.round(n * 1000)))));
  try { return shape(3.5) !== shape(21); } catch { return true; }
}

/**
 * The setup guide: a short ordered list a person can follow with wire, a tape
 * and a compass. `fmt` renders metres in whichever unit they chose.
 */
export function setupSteps({
  antenna, built, band, orientationDeg, directional, paths, siteNames = [], loss,
  fmt = (m) => `${m.toFixed(2)} m`,
}) {
  const steps = [];
  const f = built.operatingMHz;
  const lam = wavelength(f);
  const lengths = built.dims.filter((d) => d.metres !== undefined);
  const facts = built.dims.filter((d) => d.text !== undefined);
  const feedFact = (d) => /feed|imped|match|balun|coupler|transformer|ohm|Ω/i.test(`${d.label} ${d.text} ${d.note ?? ''}`);
  const follows = geometryFollowsDesign(antenna, built.params, f);

  steps.push({
    title: 'Cut',
    body: follows
      ? `Cut for ${band.label} (${fmt1(f)} MHz). Cut every wire 2–3 % long and trim it in place `
        + '— wire stretches, insulators add length, and you can always shorten.'
      : 'This antenna is a fixed length: nothing here is cut to a frequency.',
    items: [
      ...lengths.map((d) => ({ label: d.label, value: fmt(d.metres), note: d.note ?? null })),
      ...facts.filter((d) => !feedFact(d)).map((d) => ({ label: d.label, value: d.text, note: d.note ?? null })),
    ],
  });

  const o = norm360(orientationDeg);
  const broadside = norm360(o - 90);
  steps.push({
    title: 'Point',
    body: directional
      ? `Run the wire along ${fmt0(o)}°–${fmt0(o + 180)}° (${compassName(o)}–`
        + `${compassName(o + 180)}). Its broadside faces ${fmt0(broadside)}° and `
        + `${fmt0(broadside + 180)}°, which is the compromise that keeps every site out of a null.`
      : 'Direction does not matter for this antenna at the angles these paths use. '
        + 'Put it where it is clearest of metal, buildings and foliage.',
    items: paths.map((p, i) => ({
      label: siteNames[i] ?? `Site ${i + 1}`,
      value: `${fmt0(p.bearingDeg)}° ${compassName(p.bearingDeg)}`,
      note: `${fmt0(p.distanceKm)} km · ${fmt0(p.elevations[0])}° take-off`,
    })),
  });

  const heightSpec = antenna.params.find((s) => s.type === 'length' && /height|apex/i.test(s.id))
    ?? antenna.params.find((s) => s.type === 'wavelengths');
  if (heightSpec) {
    const v = built.params[heightSpec.id];
    const metres = heightSpec.type === 'wavelengths' ? v * lam : v;
    const wl = metres / lam;
    const why = wl < 0.25
      ? 'Low in wavelengths, so the pattern fires upward: right for short range (NVIS), wrong for distance.'
      : wl < 0.45
        ? 'A quarter to half a wavelength up: a broad lobe at medium angles, the all-round compromise.'
        : 'Half a wavelength or more: the lobe drops toward the horizon, which is what long paths need.';
    steps.push({
      title: 'Raise',
      body: `${heightSpec.label}: ${fmt(metres)} — ${wl.toFixed(2)} wavelengths on ${band.label}. ${why}`,
      items: [],
    });
  }

  const feedNotes = built.notes.filter((n) => /feed|balun|choke|coupler|transformer|tuner|counterpoise|radial/i.test(n)).slice(0, 2);
  steps.push({
    title: 'Feed',
    body: feedNotes[0] ?? 'Feed it as the catalogue describes; keep the feedline leaving at right angles for the first few metres.',
    items: facts.filter(feedFact).map((d) => ({ label: d.label, value: d.text, note: d.note ?? null })),
    extra: feedNotes.slice(1),
  });

  const cautions = built.cautions.filter((c) => c.severity !== 'info');
  steps.push({
    title: 'Expect',
    body: loss && loss.hi > 0
      ? `Real ground and matching will take roughly ${fmt1(loss.lo)}–${fmt1(loss.hi)} dB `
        + 'that the pattern figures do not show; the plan above already subtracts the midpoint.'
      : 'This installation is close to what the model assumes; only the usual 1–2 dB of real ground applies.',
    items: cautions.map((c) => ({ label: c.severity, value: c.text, note: null })),
    extra: ['Trust an antenna analyser over any model, including this one. '
      + 'Where an issued antenna exists, its manual governs.'],
  });

  return steps;
}
