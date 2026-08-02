// Plain-language interpretation of space weather, for HF operators.
//
// Separated from the page so it can be tested. These are **rules of thumb**,
// not predictions: they describe what a given index usually means for the
// bands, in the way an experienced operator would tell you. The actual
// answer for an actual circuit comes from the engine, and the copy says so.
//
// Everything here is deliberately conservative in wording. It is easy to write
// space weather copy that sounds authoritative and means nothing; the test is
// whether a statement would still be defensible if someone missed a contact
// because they believed it.

/** NOAA's G-scale, which is defined in terms of Kp. */
export function geomagneticScale(kp) {
  if (kp === null || kp === undefined) return null;
  if (kp < 5) return null;               // below storm level, no G number
  if (kp < 6) return 'G1';
  if (kp < 7) return 'G2';
  if (kp < 8) return 'G3';
  if (kp < 9) return 'G4';
  return 'G5';
}

/** Status token for colouring a Kp value. */
export function kpToken(kp) {
  if (kp === null || kp === undefined) return 'stale';
  if (kp < 3) return 'good';
  if (kp < 5) return 'fair';
  if (kp < 7) return 'poor';
  return 'closed';
}

/**
 * What a Kp value means for HF.
 *
 * The load-bearing detail, and the one most summaries omit: disturbance scales
 * with **geomagnetic** latitude. A storm that closes a transpolar path barely
 * touches an equatorial one, so a single global adjective would mislead half
 * the audience.
 */
export function describeKp(kp) {
  if (kp === null || kp === undefined) {
    return { headline: 'Unknown', detail: 'No recent planetary K index was available.' };
  }
  if (kp < 3) {
    return {
      headline: 'Quiet',
      detail: 'The geomagnetic field is settled. Paths at all latitudes behave close to '
        + 'their undisturbed climatology, including polar routes.',
    };
  }
  if (kp < 4) {
    return {
      headline: 'Unsettled',
      detail: 'Slight degradation possible on high-latitude and transpolar paths. '
        + 'Mid and low latitude circuits are effectively unaffected.',
    };
  }
  if (kp < 5) {
    return {
      headline: 'Active',
      detail: 'High-latitude paths degraded and auroral absorption is possible. '
        + 'Transpolar circuits may be unreliable. Equatorial paths largely normal.',
    };
  }
  if (kp < 6) {
    return {
      headline: 'Minor storm (G1)',
      detail: 'High-latitude HF degraded; polar paths may close entirely. Expect lower '
        + 'MUF than predicted at high geomagnetic latitudes. Low-latitude paths usually '
        + 'still workable, sometimes better than usual.',
    };
  }
  if (kp < 7) {
    return {
      headline: 'Moderate storm (G2)',
      detail: 'HF fading and absorption at higher latitudes, polar routes closed. '
        + 'Mid-latitude paths noticeably degraded. Work lower in frequency than the '
        + 'undisturbed prediction suggests.',
    };
  }
  return {
    headline: 'Strong storm or worse (G3+)',
    detail: 'Widespread HF degradation, polar blackout, and aurora reaching well toward '
      + 'the equator. Predictions on this site assume quiet conditions and will read '
      + 'optimistic — treat them as an upper bound.',
  };
}

/**
 * What a solar flux level means for band openings.
 *
 * Solar flux drives ionisation, which drives the MUF, which decides how high in
 * frequency you can work. The bands named are the conventional rules of thumb;
 * the page points at the planner for anything that matters.
 */
export function describeFlux(sfi) {
  if (sfi === null || sfi === undefined) {
    return { headline: 'Unknown', detail: 'No recent solar flux figure was available.',
             topBand: null };
  }
  if (sfi < 70) {
    return {
      headline: 'Very low',
      detail: 'The high bands are mostly shut. 40 m and 80 m carry the traffic, and 20 m '
        + 'opens only around midday.',
      topBand: '20 m',
    };
  }
  if (sfi < 90) {
    return {
      headline: 'Low',
      detail: '20 m is the workhorse. 17 m and 15 m open occasionally in daylight; '
        + '10 m rarely, and then usually via sporadic E rather than the F layer.',
      topBand: '17 m',
    };
  }
  if (sfi < 120) {
    return {
      headline: 'Moderate',
      detail: '17 m and 15 m open regularly in daylight. 12 m and 10 m come and go, '
        + 'best around local noon on north–south paths.',
      topBand: '15 m',
    };
  }
  if (sfi < 150) {
    return {
      headline: 'Good',
      detail: '15 m and 12 m open reliably in daylight and 10 m is worth checking, '
        + 'especially toward the equator. The low bands remain good after dark.',
      topBand: '12 m',
    };
  }
  if (sfi < 200) {
    return {
      headline: 'High',
      detail: '10 m open regularly in daylight, often long into the evening on '
        + 'north–south paths. This is when the high bands are worth living on.',
      topBand: '10 m',
    };
  }
  return {
    headline: 'Very high',
    detail: '10 m wide open, and 6 m F2 propagation becomes possible at these levels — '
      + 'rare, and worth watching for.',
    topBand: '10 m and up',
  };
}

/**
 * The one-line summary at the top of the page: what today is like, overall.
 * Deliberately combines both drivers, because either alone misleads — a high
 * flux during a severe storm is not a good day.
 */
export function summarise({ sfi, kp }) {
  const f = describeFlux(sfi);
  const k = describeKp(kp);
  if (kp !== null && kp !== undefined && kp >= 5) {
    return `Solar flux is ${f.headline.toLowerCase()}, but a geomagnetic storm is in `
      + `progress (Kp ${kp}). High-latitude paths are the ones to worry about.`;
  }
  if (kp !== null && kp !== undefined && kp >= 4) {
    return `Solar flux is ${f.headline.toLowerCase()} and the field is active `
      + `(Kp ${kp}) — high-latitude paths may disappoint.`;
  }
  return `Solar flux is ${f.headline.toLowerCase()} and the geomagnetic field is `
    + `${k.headline.toLowerCase()}${f.topBand ? `. Highest band worth trying in daylight: ${f.topBand}` : ''}.`;
}
