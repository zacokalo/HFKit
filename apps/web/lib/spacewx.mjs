// Client access to the space weather bundle.
//
// Three tiers, in order, because the point of this file is that the page keeps
// working when the live path does not:
//
//   1. the Worker          — current, refreshed hourly
//   2. the build snapshot  — shipped with the site, as old as the last deploy
//   3. a stated default    — SSN 60, clearly labelled as a placeholder
//
// Every tier reports which one it is and how old it is, and the caller is
// expected to show that. Stale-and-labelled beats fresh-looking-and-wrong; a
// map that quietly reverts to a default sun is exactly the failure this project
// says is the worst it can produce.

const SNAPSHOT_URL = './data/space-weather.json';
const CACHE_KEY = 'hfkit.spacewx.v1';

/** The value the app used before any live feed existed. Kept as the last
 *  resort so a first visit with no network still predicts something. */
export const FALLBACK_SSN = 60;

const TIERS = {
  live: { label: 'live', trust: 3 },
  snapshot: { label: 'published with this build', trust: 2 },
  cached: { label: 'last seen on this device', trust: 1 },
  default: { label: 'placeholder — no space weather available', trust: 0 },
};

function shape(bundle, tier) {
  const generatedAt = bundle?.generatedAt ?? null;
  const ageSeconds = generatedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(generatedAt)) / 1000))
    : null;
  return {
    tier,
    tierLabel: TIERS[tier].label,
    trust: TIERS[tier].trust,
    generatedAt,
    ageSeconds,
    degraded: bundle?.degraded ?? true,
    solar: bundle?.solar ?? null,
    geomag: bundle?.geomag ?? null,
    flux: bundle?.flux ?? null,
    alerts: bundle?.alerts ?? [],
    sources: bundle?.sources ?? {},
    // What the engine should actually be given, and whether it is real.
    ssn: bundle?.solar?.engineSsn ?? FALLBACK_SSN,
    ssnRaw: bundle?.solar?.ssn ?? null,
    ssnIsReal: Number.isFinite(bundle?.solar?.engineSsn),
  };
}

/**
 * Where the mothership lives. Deploy-time config, not a constant: the Worker URL
 * differs per account and the site must be publishable without editing source.
 *
 * In order: a pinned global (tests), then vendor/config.mjs written by the build
 * from HFKIT_SPACEWX_URL, then a meta tag as a manual override. None of them set
 * is a supported state — there is simply no live tier, and the snapshot is the
 * best available.
 */
export async function workerUrl() {
  // Tests pin it, including to null to skip the live tier entirely.
  if ('__HFKIT_SPACEWX_URL__' in globalThis) return globalThis.__HFKIT_SPACEWX_URL__;
  try {
    const { SPACEWX_URL } = await import('../vendor/config.mjs');
    if (SPACEWX_URL) return SPACEWX_URL;
  } catch {
    // No build config — running from source, or an older deploy.
  }
  return document.querySelector('meta[name="hfkit-spacewx"]')?.content?.trim() || null;
}

async function getJson(url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Same gate as everywhere else: a 200 carrying an error page is not data.
    if (/^\s*(<!doctype|<html)/i.test(text)) throw new Error('HTML, not JSON');
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || !body.generatedAt) {
      throw new Error('not a space weather bundle');
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the best available bundle.
 *
 * `timeoutMs` is short on purpose: this sits in front of a map the user is
 * waiting for, and a slow mothership must cost a second, not a page load.
 */
export async function loadSpaceWeather({ timeoutMs = 2500, allowNetwork = true } = {}) {
  const live_url = allowNetwork ? await workerUrl() : null;
  if (live_url) {
    try {
      const live = await getJson(live_url, timeoutMs);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(live)); } catch { /* private mode */ }
      return shape(live, 'live');
    } catch { /* fall through — every tier below is a real answer */ }
  }

  try {
    return shape(await getJson(SNAPSHOT_URL, timeoutMs), 'snapshot');
  } catch { /* fall through */ }

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return shape(JSON.parse(raw), 'cached');
  } catch { /* fall through */ }

  return shape(null, 'default');
}

/** "3 minutes ago", "2 hours ago" — for labelling a value with its age. */
export function describeAge(seconds) {
  if (seconds === null || seconds === undefined) return 'age unknown';
  if (seconds < 90) return 'just now';
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * One line describing where the sunspot number came from and how much to trust
 * it. Callers put this next to any prediction driven by it.
 */
export function describeSource(sw) {
  if (!sw.ssnIsReal) {
    return `Solar activity is a fixed placeholder (SSN ${FALLBACK_SSN}) — `
      + 'no space weather feed reached this device, so predictions do not reflect today.';
  }
  const raw = sw.ssnRaw !== null && Math.abs(sw.ssnRaw - sw.ssn) > 0.05
    ? ` (measured ${sw.ssnRaw}, rounded for cache stability)` : '';
  const degraded = sw.degraded ? ' Some sources are missing or stale.' : '';
  return `Effective SSN ${sw.ssn}${raw} from KC2G, ${sw.tierLabel}, `
    + `${describeAge(sw.ageSeconds)}.${degraded}`;
}
