# hfkit-spacewx

The mothership. Fetches space weather hourly and fans it out, so that a browser
running HFKit never contacts NOAA or KC2G — their load is a fixed 24 requests
per source per day no matter how many people use the site.

See `docs/adr/0003-space-weather-delivery.md` for why this exists rather than a
build-time fetch.

## Deploy

```sh
npx wrangler kv namespace create SPACEWX   # once; paste the id into wrangler.jsonc
npm run deploy -w @hfkit/spacewx-worker
```

`wrangler deploy` prints the Worker's URL. Point the site at it by setting a
build environment variable on the Pages project — **not** by editing source:

```
HFKIT_SPACEWX_URL = https://hfkit-spacewx.<subdomain>.workers.dev/space-weather.json
```

(Cloudflare dashboard → the Pages project → Settings → Variables and secrets.)
Then redeploy. `build.mjs` writes it into `vendor/config.mjs`, which is
generated and gitignored, so a build never dirties tracked files.

Leaving it unset is a supported state, not a broken one: the site falls back to
the snapshot published with the build and says so on the page.

## Endpoints

| Path | What |
|---|---|
| `/space-weather.json` | The bundle. `access-control-allow-origin: *`, cached 5 min at the edge with `stale-while-revalidate`. |
| `/health` | 200 when the bundle is fresh and complete, 503 otherwise. Suitable for an uptime check. |

## Shape

`packages/spacewx/index.mjs` owns it, and its tests are the specification.
Everything carries provenance: each source reports `ok`, `observedAt`,
`ageSeconds` and `stale`, and `degraded` is true if any source is missing or
old. A partial bundle is deliberate — KC2G being down must not cost us NOAA's
geomagnetic data.

## Failure

Designed to fail quietly into the tier below rather than loudly at a user:

- Cron does not fire → a reader older than 2 h triggers a background refresh.
- KV empty (fresh deploy) → the first request builds the bundle synchronously.
- Worker unreachable, over quota, or serving nonsense → the client uses the
  build snapshot, then its own last-seen copy, then a stated placeholder.

Exceeding a free-plan limit makes requests fail, not bill.
