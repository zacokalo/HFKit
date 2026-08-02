// The mothership.
//
// Clients never contact NOAA or KC2G. This Worker does, once an hour, and fans
// the result out from KV — so upstream load is a fixed 24 hits per source per
// day no matter how many people use HFKit. That is the O(1) invariant in
// docs/05, made structural rather than promised.
//
// Two halves, deliberately split:
//   scheduled() does the fetching and parsing, where the CPU budget is generous
//   fetch()     only reads KV and returns bytes, where it is 10 ms
//
// Doing the parse in the request path would work until it did not, and then it
// would fail for a user rather than for a cron job.

import { buildAurora, buildBundle, SCHEMA_VERSION } from '@hfkit/spacewx';

const KEY = 'bundle:v1';
const AURORA_KEY = 'aurora:v1';

/** Long enough that the edge absorbs traffic, short enough to pick up a refresh
 *  promptly. `stale-while-revalidate` means a cold edge never blocks a reader. */
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';

const json = (body, { status = 200, extra = {} } = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': CACHE_CONTROL,
      // The site is served from a different origin to this Worker.
      'access-control-allow-origin': '*',
      ...extra,
    },
  });

async function refresh(env, reason) {
  const bundle = await buildBundle();
  bundle.refreshedBy = reason;
  await env.SPACEWX.put(KEY, JSON.stringify(bundle));
  return bundle;
}

/** The aurora grid is refreshed alongside the bundle but stored separately: it
 *  is ten times the size and only wanted when someone turns the overlay on, so
 *  making every visitor download it would be a poor trade. */
async function refreshAurora(env, reason) {
  const aurora = await buildAurora();
  aurora.refreshedBy = reason;
  await env.SPACEWX.put(AURORA_KEY, JSON.stringify(aurora));
  return aurora;
}

export default {
  async scheduled(event, env, ctx) {
    // Independent of the bundle: an OVATION outage must not cost us the
    // sunspot number, which is the one thing predictions actually need.
    ctx.waitUntil(refreshAurora(env, `cron:${event.cron}`).catch(
      (e) => { console.warn('aurora refresh failed:', e?.message ?? e); }));
    ctx.waitUntil(refresh(env, `cron:${event.cron}`).then(
      (b) => {
        const bad = Object.entries(b.sources).filter(([, s]) => !s.ok || s.stale);
        // Log only when something is wrong. A cron that narrates every success
        // trains you to ignore it.
        if (bad.length) {
          console.warn('space weather refresh degraded:',
            bad.map(([k, s]) => `${k}=${s.error ?? 'stale'}`).join(', '));
        }
      },
      (e) => { console.error('space weather refresh failed outright:', e?.stack ?? e); },
    ));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-max-age': '86400',
        },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method not allowed' }, { status: 405 });
    }

    if (url.pathname === '/health') {
      const raw = await env.SPACEWX.get(KEY);
      if (!raw) return json({ ok: false, reason: 'no bundle in KV yet' }, { status: 503 });
      const b = JSON.parse(raw);
      const ageSeconds = Math.round((Date.now() - Date.parse(b.generatedAt)) / 1000);
      // Two missed refreshes: one may be a blip, two is a pattern.
      const ok = ageSeconds < 3 * 3600 && !b.degraded;
      return json({ ok, ageSeconds, degraded: b.degraded, generatedAt: b.generatedAt,
                    schema: b.schema, sources: b.sources }, { status: ok ? 200 : 503 });
    }

    if (url.pathname === '/aurora.json') {
      let raw = await env.SPACEWX.get(AURORA_KEY);
      if (!raw) {
        try {
          return json(await refreshAurora(env, 'cold-start'));
        } catch (e) {
          return json({ error: 'aurora unavailable', detail: String(e?.message ?? e) },
            { status: 503, extra: { 'cache-control': 'no-store' } });
        }
      }
      const a = JSON.parse(raw);
      const age = Math.round((Date.now() - Date.parse(a.generatedAt)) / 1000);
      if (age > 2 * 3600) ctx.waitUntil(refreshAurora(env, 'stale-on-read').catch(() => {}));
      return json({ ...a, ageSeconds: age });
    }

    if (url.pathname !== '/' && url.pathname !== '/space-weather.json') {
      return json({ error: 'not found' }, { status: 404 });
    }

    let raw = await env.SPACEWX.get(KEY);

    // Cold start, or KV cleared. Build once now so the first visitor after a
    // deploy is not told to come back later.
    if (!raw) {
      try {
        const bundle = await refresh(env, 'cold-start');
        return json(bundle);
      } catch (e) {
        return json({ error: 'no bundle available', detail: String(e?.message ?? e) },
          { status: 503, extra: { 'cache-control': 'no-store' } });
      }
    }

    const bundle = JSON.parse(raw);
    const ageSeconds = Math.round((Date.now() - Date.parse(bundle.generatedAt)) / 1000);

    // If the cron has clearly stopped, refresh in the background rather than
    // making this reader wait — they still get data, just a cycle behind.
    if (ageSeconds > 2 * 3600) {
      ctx.waitUntil(refresh(env, 'stale-on-read').catch(() => {}));
    }

    return json({ ...bundle, ageSeconds, schema: SCHEMA_VERSION });
  },
};
