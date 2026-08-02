# 3. Space weather is fetched by a scheduled Worker, not at build time

Date: 2026-08-02

## Status

Accepted.

## Context

The prediction engine needs a solar activity driver. Until now it was hardcoded
to an effective sunspot number of 60, so every prediction described a made-up
sun. Wiring in real data means deciding how it reaches the browser, and two
project invariants constrain that: clients never contact upstream sources
(`docs/05`), and operating overhead must stay near zero (`docs/11`).

The obvious Tier 0 answer — fetch at build time, commit the result, let the
static host serve it — was measured and rejected:

- **Cloudflare Pages allows 500 builds/month on the free plan.** That is ~16 a
  day, and it is the same budget code pushes draw on. Hourly refresh needs 720.
- The data does not move slowly enough for a daily build to be honest. Measured
  over one real day from KC2G's own feed, the effective sunspot number ranged
  **79.3 to 101.6 — a 22.4 point swing**, with individual steps up to 13 points.
  A daily snapshot would leave the map up to ~20 SSN wrong, which moves
  predicted MUF enough to change which bands read as open.

Freshness beyond hourly was also considered and rejected. Kp is published in
fixed 3-hour blocks; F10.7 a few times a day. Fifteen-minute polling would only
improve flare and alert latency, and nothing in the product consumes those yet.

## Decision

A Cloudflare Worker refreshes the bundle **hourly** into KV and serves it.

- `scheduled()` fetches, validates and writes; `fetch()` only reads KV. The
  split matters: the free plan allows 10 ms CPU on the request path, so parsing
  upstream payloads there would work until it did not, and then it would fail
  for a user rather than for a cron job.
- Upstream load is **24 requests per source per day regardless of user count**.
  That is the O(1) invariant made structural, and it is a number we can state to
  KC2G rather than an assurance we hope holds.
- `packages/spacewx` holds the fetching, gates and assembly, and is shared by
  the Worker and by `apps/web/build.mjs`, which writes a static snapshot into
  the deploy. The fallback therefore cannot drift from what it stands in for.
- The client tries Worker, then build snapshot, then a device cache, then a
  stated placeholder — and always says which one it used and how old it is.

The value handed to the engine is **quantised to the nearest 5 SSN**. Reach-map
cache keys include the SSN, so an unquantised driver would discard a returning
visitor's cached map every time the fit twitched by a point. P.533's own
uncertainty dwarfs 2.5 SSN, so this costs nothing real. The unrounded value is
kept and displayed; the rounding is a caching decision, not a claim about the
sun.

KC2G publishes two fits, over 24 and 6 hours of ionosonde history. The **24-hour
fit** is used: it is the steadier of the two (sd 6.04 vs 6.86, largest step 13.1
vs 21.6 over the measured day), and P.533 is a monthly-median model — feeding it
the jumpier driver would imply a precision the model does not have.

## Consequences

- This is the first always-on component in the project. Its failure modes are
  covered by the fallback chain (a Worker outage degrades to the build snapshot,
  labelled), by the Python contract canary in `pipeline/` catching upstream
  shape drift, and by `scripts/check-live.sh`.
- Free at every tier used: 24 of 1,000 daily KV writes, 24 of 100,000 daily
  Worker invocations. Exceeding a free limit causes requests to **fail rather
  than bill**, so this cannot generate a surprise invoice.
- `docs/11` describes Tier 0 as having no server. That is now inaccurate and
  should be revised: the accurate claim is that no server computes a prediction.
- A courtesy note to KC2G is now due. It was moot while nothing was fetched.
- Staleness thresholds are per-source and some sources have none. Alerts are
  event-driven: judging that feed by the age of its newest item would report a
  fault precisely when space weather is calm. Kp's threshold must exceed its own
  3-hour publication interval or it fires every cycle. Both were found by
  testing against real captured payloads rather than by reasoning.
