// Space weather bundle: fetch, validate, and assemble.
//
// Shared deliberately. The Cloudflare Worker runs this hourly to refresh the
// live bundle, and apps/web/build.mjs runs the same code at build time to
// publish a static fallback. One implementation, so the fallback cannot drift
// from the thing it is standing in for.
//
// Endpoints and refresh intervals mirror pipeline/hfkit_pipeline/sources.py,
// which verified them against live servers in Phase 0. The Python package stays
// as the contract canary; the gates here are the lean in-path versions.

export const USER_AGENT =
  'HFKit/0.1 (+https://github.com/zacokalo/HFKit; me@zachc.net)';

/** Bump when the shape changes in a way a client must notice. */
export const SCHEMA_VERSION = 1;

// `staleAfterSeconds` must exceed the upstream's own publication interval, or
// it fires on healthy data every cycle. Sources whose content age carries no
// signal about our health set `ageFromObservation: false` — see below.
export const SOURCES = {
  essn: {
    url: 'https://prop.kc2g.com/api/essn.json',
    licence: 'Open project, non-commercial use; attribute KC2G',
    // Republished about every 2.6 minutes, so hours of silence is a real fault.
    staleAfterSeconds: 3 * 3600,
    ageFromObservation: true,
  },
  kp: {
    url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
    licence: 'US Government work — public domain',
    // Published in fixed 3-hour blocks, so age legitimately approaches 3 h just
    // before each one lands. A 3-hour threshold would cry wolf every cycle.
    staleAfterSeconds: 6 * 3600,
    ageFromObservation: true,
  },
  kpForecast: {
    url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
    licence: 'US Government work — public domain',
    // Its timestamps are in the future by construction; age says nothing.
    ageFromObservation: false,
  },
  f107: {
    url: 'https://services.swpc.noaa.gov/json/f107_cm_flux.json',
    licence: 'US Government work — public domain',
    // A few readings a day, clustered in daylight, so an overnight gap of well
    // over 12 hours is normal operation.
    staleAfterSeconds: 30 * 3600,
    ageFromObservation: true,
  },
  alerts: {
    url: 'https://services.swpc.noaa.gov/products/alerts.json',
    licence: 'US Government work — public domain',
    // Event-driven: no alert for six hours means quiet space weather, not a
    // broken feed. Judging this feed by the age of its newest item would report
    // a fault precisely when conditions are calm.
    ageFromObservation: false,
  },
};

// --- gates ---------------------------------------------------------------

/** Plausible ranges. Outside these the upstream is wrong, not the sun. */
const RANGES = {
  ssn: [0, 400],
  sfi: [60, 400],
  kp: [0, 9],
  f107: [60, 400],
};

function checkRange(kind, value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}: expected a finite number, got ${JSON.stringify(value)}`);
  }
  const [lo, hi] = RANGES[kind];
  if (value < lo || value > hi) {
    throw new Error(`${label}: ${value} is outside the plausible range ${lo}–${hi}`);
  }
  return value;
}

/** SWPC serves timestamps without a zone; they are UTC. */
export function parseUtc(text) {
  if (typeof text !== 'string') throw new Error(`expected a timestamp, got ${typeof text}`);
  const iso = text.trim().replace(' ', 'T');
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(ms)) throw new Error(`unparseable timestamp ${JSON.stringify(text)}`);
  return new Date(ms);
}

// --- parsers -------------------------------------------------------------
// Each is a gate as much as a parser: it fails loudly on an unexpected shape
// rather than quietly yielding undefined, because a bundle that silently omits
// the sunspot number would leave the map running on a default that looks real.

/**
 * KC2G effective sunspot number.
 *
 * Two fits are published: `24h` and `6h`, over that much ionosonde history.
 * The 24-hour fit is used because it is the steadier of the two (measured over
 * one real day: sd 6.04 vs 6.86, largest step 13.1 vs 21.6) and because P.533
 * is a monthly-median model — feeding it a jumpier driver implies a precision
 * the model does not have.
 */
export function parseEssn(payload) {
  const series = payload?.['24h'];
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error('essn: expected a non-empty "24h" array');
  }
  const last = series[series.length - 1];
  const ssn = checkRange('ssn', last?.ssn, 'essn.ssn');
  const sfi = checkRange('sfi', last?.sfi, 'essn.sfi');
  if (typeof last.time !== 'number') throw new Error('essn: record has no numeric "time"');
  const fast = payload?.['6h'];
  const ssn6h = Array.isArray(fast) && fast.length
    ? checkRange('ssn', fast[fast.length - 1]?.ssn, 'essn.6h.ssn')
    : null;
  return {
    ssn: round1(ssn),
    ssn6h: ssn6h === null ? null : round1(ssn6h),
    sfi: round1(sfi),
    observedAt: new Date(last.time * 1000).toISOString(),
  };
}

/** SWPC planetary K index — the record form, verified in Phase 0. */
export function parseKp(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('kp: expected a non-empty array');
  }
  const last = payload[payload.length - 1];
  if (!last || typeof last !== 'object') throw new Error('kp: malformed final record');
  const key = Object.keys(last).find((k) => k.toLowerCase() === 'kp');
  if (!key) throw new Error(`kp: no Kp field in ${JSON.stringify(Object.keys(last))}`);
  return {
    kp: round1(checkRange('kp', Number(last[key]), 'kp')),
    observedAt: parseUtc(last.time_tag).toISOString(),
  };
}

/** SWPC Kp forecast. Rows carry observed-vs-predicted; only the future matters. */
export function parseKpForecast(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('kpForecast: expected a non-empty array');
  }
  const out = [];
  for (const row of payload) {
    if (!row || typeof row !== 'object' || row.observed !== 'predicted') continue;
    const kp = Number(row.kp);
    if (!Number.isFinite(kp)) continue;
    out.push({
      time: parseUtc(row.time_tag).toISOString(),
      kp: round1(checkRange('kp', kp, 'kpForecast.kp')),
      scale: row.noaa_scale ?? null,
    });
  }
  if (out.length === 0) throw new Error('kpForecast: no predicted rows');
  return out;
}

/** SWPC 10.7 cm flux. Newest first, several observations per day. */
export function parseF107(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('f107: expected a non-empty array');
  }
  const row = payload[0];
  return {
    f107: round1(checkRange('f107', Number(row?.flux), 'f107.flux')),
    observedAt: parseUtc(row.time_tag).toISOString(),
  };
}

/**
 * SWPC alerts. The message body is a fixed-width bulletin, so the first
 * SUMMARY/WARNING line is pulled out for display and the rest kept verbatim —
 * paraphrasing a space weather alert is not our job.
 */
export function parseAlerts(payload, { limit = 8 } = {}) {
  if (!Array.isArray(payload)) throw new Error('alerts: expected an array');
  const out = [];
  for (const row of payload.slice(0, limit)) {
    if (!row || typeof row.message !== 'string') continue;
    const lines = row.message.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const headline = lines.find((l) => /^(SUMMARY|WARNING|ALERT|WATCH|EXTENDED)\b/i.test(l))
      ?? lines.find((l) => /^Space Weather Message Code/i.test(l))
      ?? lines[0] ?? '';
    out.push({
      id: row.product_id ?? null,
      issuedAt: parseUtc(row.issue_datetime).toISOString(),
      headline: headline.replace(/^(SUMMARY|WARNING|ALERT|WATCH):?\s*/i, ''),
      message: row.message,
    });
  }
  return out;
}

// --- assembly ------------------------------------------------------------

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Sunspot number as fed to the prediction engine.
 *
 * Quantised to the nearest 5 so a cached reach map is not thrown away every
 * time the fit twitches by a point. P.533's own uncertainty dwarfs a 2.5-point
 * SSN difference, so this costs nothing real and keeps a returning visitor's
 * map instant. The unrounded value is kept in the bundle and shown in the UI —
 * the rounding is a caching decision, not a claim about the sun.
 */
export function engineSsn(ssn) {
  return Math.max(0, Math.min(400, Math.round(ssn / 5) * 5));
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // A 200 carrying an HTML error page is the failure mode that matters; the
  // same one that would have fed an error page to P.533 as ionospheric data.
  if (/^\s*(<!doctype|<html)/i.test(text)) {
    throw new Error('responded with HTML, not JSON');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`responded with unparseable JSON (${text.length} bytes)`);
  }
}

/**
 * Fetch every source and assemble one bundle.
 *
 * A single upstream failing must not lose the others: each is settled
 * independently and its outcome recorded. A bundle that reports "KC2G is down,
 * here is the geomagnetic data" is far more useful than no bundle at all, and
 * the client can decide what to do without guessing.
 */
export async function buildBundle({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const at = now();
  const results = {};

  const jobs = Object.entries(SOURCES).map(async ([key, src]) => {
    try {
      results[key] = { ok: true, value: await getJson(fetchImpl, src.url) };
    } catch (e) {
      results[key] = { ok: false, error: String(e?.message ?? e) };
    }
  });
  await Promise.all(jobs);

  const bundle = {
    schema: SCHEMA_VERSION,
    generatedAt: at.toISOString(),
    solar: null,
    geomag: null,
    flux: null,
    alerts: [],
    sources: {},
    degraded: false,
  };

  const take = (key, parse, assign) => {
    const src = SOURCES[key];
    const r = results[key];
    if (!r.ok) {
      bundle.sources[key] = { ok: false, error: r.error };
      bundle.degraded = true;
      return;
    }
    try {
      const parsed = parse(r.value);
      const observedAt = assign(parsed);
      const ageSeconds = observedAt
        ? Math.max(0, Math.round((at.getTime() - Date.parse(observedAt)) / 1000))
        : null;
      // Only sources whose content age reflects our own freshness can go stale.
      // For the rest, the bundle's generatedAt is the honest freshness signal.
      const stale = src.ageFromObservation && ageSeconds !== null
        && ageSeconds > src.staleAfterSeconds;
      bundle.sources[key] = {
        ok: true, observedAt, ageSeconds, stale,
        staleAfterSeconds: src.ageFromObservation ? src.staleAfterSeconds : null,
      };
      if (stale) bundle.degraded = true;
    } catch (e) {
      // A shape we do not understand is a failure, not a value to guess at.
      bundle.sources[key] = { ok: false, error: `parse failed: ${e?.message ?? e}` };
      bundle.degraded = true;
    }
  };

  take('essn', parseEssn, (p) => {
    bundle.solar = {
      ssn: p.ssn, ssn6h: p.ssn6h, sfi: p.sfi,
      engineSsn: engineSsn(p.ssn),
      observedAt: p.observedAt,
    };
    return p.observedAt;
  });
  take('kp', parseKp, (p) => {
    bundle.geomag = { ...(bundle.geomag ?? {}), kp: p.kp, observedAt: p.observedAt };
    return p.observedAt;
  });
  take('kpForecast', parseKpForecast, (p) => {
    bundle.geomag = { ...(bundle.geomag ?? {}), forecast: p.slice(0, 24) };
    return p[0]?.time ?? null;
  });
  take('f107', parseF107, (p) => {
    bundle.flux = { f107: p.f107, observedAt: p.observedAt };
    return p.observedAt;
  });
  take('alerts', parseAlerts, (p) => {
    bundle.alerts = p;
    return p[0]?.issuedAt ?? null;
  });

  return bundle;
}

// --- aurora ---------------------------------------------------------------
// Kept out of the main bundle and fetched separately, because it is an order of
// magnitude larger than everything else combined and only wanted when someone
// switches the overlay on.

export const AURORA_SOURCE = {
  url: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
  licence: 'US Government work — public domain',
  // OVATION publishes roughly every 20 minutes and forecasts ~30 minutes ahead.
  staleAfterSeconds: 3 * 3600,
};

/** Degrees per output cell. Finer than the reach map's own 6° propagation grid,
 *  so the overlay never implies more precision than the data beneath it. */
export const AURORA_STEP = 2;

/** Below this the model is reporting noise, and drawing it would put a haze
 *  over half the planet that means nothing. */
export const AURORA_FLOOR = 2;

/**
 * Aurora is confined to the auroral ovals. OVATION's published grid is not:
 * measured on one real payload it carried 325 non-zero cells between 0° and
 * 10°N (peaking at 4%) and 635 between 0° and 10°S, which drew a bright band
 * straight across the equator on the map. There is no aurora at the equator;
 * that is an artifact of the model output, and rendering it would discredit the
 * overlay wherever it *is* right.
 *
 * 25° is deliberately generous — well below the ~40° that even a severe storm
 * reaches — so a genuine extreme event is never clipped.
 */
export const AURORA_MIN_ABS_LAT = 25;

/**
 * Downsample OVATION's 1° global grid.
 *
 * 65,160 points and ~726 KB as published; ~4,200 cells and ~40 KB after this,
 * because two thirds of the grid is zero and the rest is confined to high
 * latitudes. Cells are **max**-pooled rather than averaged: an aurora present
 * in part of a cell is the fact worth keeping, and averaging would dilute a
 * sharp oval into a smear.
 */
export function parseAurora(payload) {
  const coords = payload?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) {
    throw new Error('aurora: expected a non-empty "coordinates" array');
  }
  const obs = payload['Observation Time'];
  const fc = payload['Forecast Time'];
  if (typeof fc !== 'string') throw new Error('aurora: no "Forecast Time"');

  const pooled = new Map();
  let maxSeen = 0;
  for (const row of coords) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [lon, lat, p] = row;
    if (!Number.isFinite(p) || p <= 0) continue;
    if (p > 100) throw new Error(`aurora: probability ${p} is out of range`);
    maxSeen = Math.max(maxSeen, p);
    // OVATION publishes longitude 0–359; the map works in -180..180.
    const lo = Math.floor((((lon + 180) % 360) + 360) % 360 / AURORA_STEP) * AURORA_STEP;
    const la = Math.floor(lat / AURORA_STEP) * AURORA_STEP;
    const key = `${la}:${lo}`;
    const prev = pooled.get(key);
    if (prev === undefined || p > prev) pooled.set(key, p);
  }
  if (maxSeen === 0) throw new Error('aurora: every cell is zero, which is not plausible');

  // Flat triples rather than objects: a third of the bytes for the same data.
  const cells = [];
  let dropped = 0;
  for (const [key, p] of pooled) {
    if (p < AURORA_FLOOR) continue;
    const [la, lo] = key.split(':').map(Number);
    if (Math.abs(la) < AURORA_MIN_ABS_LAT) { dropped++; continue; }
    cells.push(lo - 180, la, Math.round(p));
  }

  return {
    schema: SCHEMA_VERSION,
    step: AURORA_STEP,
    floor: AURORA_FLOOR,
    observedAt: typeof obs === 'string' ? new Date(obs).toISOString() : null,
    forecastFor: new Date(fc).toISOString(),
    max: Math.round(maxSeen),
    // Reported rather than hidden: if this ever grows large the upstream has
    // changed and someone should look.
    droppedEquatorial: dropped,
    // [lonWest, latSouth, probability] repeating; lon/lat are the cell's corner.
    cells,
  };
}

/** Fetch and downsample the aurora grid. Throws; the caller decides what a
 *  failure means, because a missing overlay is not a missing prediction. */
export async function buildAurora({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const payload = await getJson(fetchImpl, AURORA_SOURCE.url);
  const a = parseAurora(payload);
  a.generatedAt = now().toISOString();
  return a;
}
