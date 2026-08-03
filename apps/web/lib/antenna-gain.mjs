// Real antenna gain across a coverage map.
//
// The reach map computes its grid once at 100 W into an isotropic antenna and
// then adds the station on top as a single scalar. That is exact for power and
// wrong for antennas: a real antenna's gain depends on the elevation angle, and
// the elevation angle a path needs depends on how far away it is. A Yagi rated
// +7 dBi does not deliver +7 dBi to a station 400 km away, and a vertical
// delivers far less than its rating straight overhead.
//
// The fix does not need the propagation engine re-run. Every grid cell has a
// known position, so its distance and bearing from the transmitter are free;
// distance gives the take-off angle the path needs, and the antenna's pattern
// gives the gain at that angle. The correction is pure geometry laid over an
// unchanged P.533 grid, which is what preserves the property the reach map
// depends on: changing your antenna never regenerates the map.
//
// What this cannot do: beams. Their gain does not follow from the thin-wire
// model, so they stay on the fixed-gain list, still labelled as the
// approximation they are.

import {
  analyse, buildAntenna, byId, defaultParams, minimumHops, takeoffAngle,
} from '../vendor/antenna.mjs';

const LAYER_KM = 300;
const ELEV_STEPS = 91;      // 0…90° in 1° steps
const AZ_STEP = 5;          // 5° in azimuth is finer than any HF pattern needs
const AZ_STEPS = 360 / AZ_STEP;

/**
 * The antennas offered on the reach map, and which of their parameters the
 * single "height" slider drives. Deliberately a short list: the reach map is
 * about coverage, not about antenna design — the antenna page is for that.
 *
 * A ground-mounted vertical has no height to set, which is the point of it, so
 * it maps to null and the slider hides.
 */
export const MODELLED = [
  { id: 'dipole', label: 'Half-wave dipole', height: 'height', directional: true },
  { id: 'inverted-v', label: 'Inverted V', height: 'height', directional: true },
  { id: 'efhw', label: 'End-fed half-wave', height: 'farHeight', directional: true },
  { id: 'doublet', label: 'Doublet (40 m of wire)', height: 'height', directional: true },
  { id: 'vertical-ground', label: 'Ground-mounted vertical', height: null, directional: false },
  { id: 'ground-plane', label: 'Elevated ground plane', height: 'baseHeight', directional: false },
];

export const modelled = (id) => MODELLED.find((m) => m.id === id) ?? null;

/**
 * Below this the perfect-ground model stops describing anything real.
 *
 * A horizontal antenna over a perfect mirror has an absolute null at the
 * horizon — the ground factor 2·sin(kh·sin ε) goes to zero — so a path needing
 * 0.2° computes as −99 dBi. Over real ground there is no such null; the lobe
 * rolls off smoothly instead. Looking up gain below this angle would black out
 * whole regions of the map on the strength of an artifact, so the lookup is
 * clamped here and the map says it is.
 */
export const MIN_ELEVATION_DEG = 3;

/**
 * Floor for any modelled gain figure.
 *
 * Pattern nulls are infinitely deep only in the model. A real antenna's nulls
 * are filled by ground reflection, nearby objects and the feedline, and are
 * rarely deeper than about 20 dB below isotropic. Without this floor a single
 * null direction would remove a swathe of the map entirely.
 */
export const GAIN_FLOOR_DBI = -20;

/**
 * Elevations a path of this length could plausibly use, one per hop count.
 *
 * Two options — the fewest hops that can span the distance, and one more — is
 * the depth that survives measurement. Taking only the minimum draws an 11 dB
 * discontinuity across the map where the hop count ticks over at about 3800 km,
 * which is an artifact of picking a single mode. Allowing three or four options
 * lets every path find a favourable angle and flattens the distance dependence
 * to nothing, which defeats the entire point of modelling the pattern. At two,
 * a 20 m dipole still spans 13 dB from its best distance to its worst.
 */
export function elevationsForDistance(km, maxHops = 2) {
  if (!(km > 1)) return [90];
  const first = minimumHops(km, LAYER_KM);
  const out = [];
  for (let h = first; h < first + maxHops; h++) {
    const e = takeoffAngle(km, { layerHeightKm: LAYER_KM, hops: h });
    if (e > 0 && e <= 90) out.push(Math.max(MIN_ELEVATION_DEG, e));
  }
  return out.length ? out : [MIN_ELEVATION_DEG];
}

/** The single angle a path most likely uses — the fewest hops that can span it. */
export function elevationForDistance(km) {
  return elevationsForDistance(km, 1)[0];
}

/**
 * Gain lookup tables, one per band.
 *
 * Built once when the antenna changes and then read O(1) per cell. Each table
 * is azimuth-major so a whole bearing's elevation profile is contiguous.
 */
export class PatternGain {
  #tables;          // Float32Array per band, AZ_STEPS * ELEV_STEPS
  #meta;

  constructor(tables, meta) {
    this.#tables = tables;
    this.#meta = meta;
  }

  get antennaId() { return this.#meta.antennaId; }
  get heightM() { return this.#meta.heightM; }
  get orientationDeg() { return this.#meta.orientationDeg; }
  get minDbi() { return this.#meta.minDbi; }
  get maxDbi() { return this.#meta.maxDbi; }
  get peakElevationDeg() { return this.#meta.peakElevationDeg; }
  get key() { return this.#meta.key; }

  /**
   * Gain toward a point, in dBi.
   *
   * `bearingDeg` is a true bearing; the table is in the antenna's own frame, so
   * the wire's orientation is subtracted here. A wire laid east–west (the
   * default) is broadside to north.
   */
  gainDb(distanceKm, bearingDeg, bandIndex) {
    const table = this.#tables[bandIndex];
    if (!table) return 0;
    const rel = bearingDeg - (this.#meta.orientationDeg - 90);
    const ai = ((Math.round(rel / AZ_STEP) % AZ_STEPS) + AZ_STEPS) % AZ_STEPS;
    // Best over the hop counts that can span this distance, not just the
    // fewest. Taking only the minimum draws a hard discontinuity ring across
    // the map wherever the hop count ticks over — at about 3800 km for the F2
    // layer — and real propagation does not work that way: energy arrives by
    // whichever mode supports it, often several at once.
    let best = -99;
    for (const e of elevationsForDistance(distanceKm)) {
      const ei = Math.max(0, Math.min(ELEV_STEPS - 1, Math.round(e)));
      const g = table[ai * ELEV_STEPS + ei];
      if (g > best) best = g;
    }
    return best;
  }

  /** Gain straight along the best bearing, for a summary readout. */
  bestGainDb(distanceKm, bandIndex) {
    const table = this.#tables[bandIndex];
    if (!table) return 0;
    let best = -99;
    for (const e of elevationsForDistance(distanceKm)) {
      const ei = Math.max(0, Math.min(ELEV_STEPS - 1, Math.round(e)));
      for (let a = 0; a < AZ_STEPS; a++) best = Math.max(best, table[a * ELEV_STEPS + ei]);
    }
    return best;
  }

  /**
   * Build the tables. Async and yielding between bands: nine pattern analyses
   * is a few hundred milliseconds, and blocking the map for that long while
   * someone drags a slider feels broken.
   */
  static async build({ antennaId, heightM, orientationDeg = 90, freqs, onProgress }) {
    const spec = modelled(antennaId);
    const antenna = byId(antennaId);
    if (!spec || !antenna) throw new Error(`not a modelled antenna: ${antennaId}`);

    const params = { ...defaultParams(antenna) };
    if (spec.height && Number.isFinite(heightM)) params[spec.height] = heightM;

    const tables = [];
    let minDbi = Infinity, maxDbi = -Infinity;
    const peakElevationDeg = [];

    for (let b = 0; b < freqs.length; b++) {
      const f = freqs[b];
      const built = buildAntenna(antenna, {
        designMHz: f, operatingMHz: f, params,
      });
      // Coarser than the antenna page: this runs nine times and feeds a 1°
      // table, where a tenth of a dB of extra precision would not survive the
      // rounding the map does anyway.
      const pattern = analyse(built.paths, f, { perWavelength: 16 });
      const table = new Float32Array(AZ_STEPS * ELEV_STEPS);
      for (let a = 0; a < AZ_STEPS; a++) {
        const az = a * AZ_STEP;
        for (let e = 0; e < ELEV_STEPS; e++) {
          // Floored: a modelled null is infinitely deep, a real one is not, and
          // an unfloored value would subtract 99 dB from a map cell on the
          // strength of an idealisation.
          const g = Math.max(GAIN_FLOOR_DBI, pattern.gainAt(e, az));
          table[a * ELEV_STEPS + e] = g;
          if (e >= MIN_ELEVATION_DEG) {
            if (g > maxDbi) maxDbi = g;
            if (g < minDbi) minDbi = g;
          }
        }
      }
      tables.push(table);
      peakElevationDeg.push(pattern.peak.elevationDeg);
      if (onProgress) onProgress((b + 1) / freqs.length);
      await new Promise((r) => setTimeout(r, 0));
    }

    return new PatternGain(tables, {
      antennaId,
      heightM: spec.height ? params[spec.height] : null,
      orientationDeg: spec.directional ? orientationDeg : 90,
      minDbi: Number.isFinite(minDbi) ? minDbi : -30,
      maxDbi,
      peakElevationDeg,
      key: `${antennaId}|${spec.height ? params[spec.height] : '-'}`
        + `|${spec.directional ? orientationDeg : '-'}|${freqs.join(',')}`,
    });
  }
}

/**
 * One-line description of what the pattern does to the map, for the readout.
 * Deliberately a range rather than a single figure: the whole point is that
 * there is no longer one number, and printing one would undo the change.
 */
export function describePattern(pg, bandLabel) {
  return `${pg.minDbi.toFixed(1)} to +${pg.maxDbi.toFixed(1)} dBi across the map`
    + (bandLabel ? ` · peak overhead angle varies by band` : '');
}
