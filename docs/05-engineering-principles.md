# Engineering Principles

Non-negotiables decided during planning, before the first line of product code.
Goals: **resilient, modular, updateable, customizable, clean** — and zero burden
pushed onto the open data sources we depend on.

---

## 1. The Mothership pattern (single aggregation point)

**Rule zero: client apps never talk to an upstream data source. Ever.**

All upstream fetching happens exactly once, on our server ("the mothership").
Clients — web, PWA, phone app, future widgets, even third parties if we open an
API — only ever talk to HFKit's API/CDN.

```
                 ┌────────── upstreams ──────────┐
                 │ NOAA · GIRO/KC2G · PSKReporter│
                 │ MQTT · wspr.live · RBN        │
                 └───────────────┬───────────────┘
                        one fetcher per source,
                        one fetch per interval
                                 ▼
                        ┌─────────────────┐
                        │   MOTHERSHIP    │  normalize → score → package
                        │  (our servers)  │  into versioned data bundles
                        └────────┬────────┘
                                 ▼
                        CDN / edge cache (immutable, cacheable artifacts)
                                 ▼
              ┌───────────┬───────────┬───────────┐
              web app    phone app   widgets/API consumers
```

Why this is the whole ballgame:

- **Upstream load is O(1), not O(users).** Whether we have 10 users or 100,000,
  NOAA sees one poller, GIRO/KC2G sees one fetcher, PSKReporter sees one MQTT
  subscriber. We can *never* be the reason an open-source service adds rate limits.
- **Users can't be rate-limited** because they never present themselves to an
  upstream — no per-user API keys to upstream services, no CORS hacks, no
  "app went viral and hammered a volunteer's server" incident.
- **One place to normalize.** Upstream quirks, format changes, and outages are
  absorbed in one adapter; clients see one stable schema.
- **Everything downstream is cacheable.** The processed output is the same for
  everyone (personalization happens client-side or in cheap API params), so it
  can sit on a CDN.

### Data bundle design

The mothership's output is a small set of **versioned, immutable, timestamped
artifacts** rather than thousands of bespoke API calls:

| Bundle | Contents | Refresh | Approx size |
|---|---|---|---|
| `conditions` | indices, alerts, band-health scores, forecast timeline | 1–5 min | a few KB |
| `ionosphere` | assimilated foF2/MUF grid | 15 min | tens–hundreds KB |
| `activity` | spot-density aggregates per band/region | 5–15 min | tens KB |
| `climatology/{month}` | precomputed model baselines | monthly | static |

- Served with proper `Cache-Control`/ETag from a CDN; a global spike in traffic
  costs us CDN bandwidth, not compute, and costs upstreams **nothing**.
- Clients poll the tiny `conditions` manifest (which carries pointers + hashes
  to the rest) — cheap, resumable, offline-friendly (the phone app just keeps
  its last bundles; every bundle carries its own `generated_at` so staleness is
  always displayable).
- Point-to-point predictions and coverage jobs are the only true per-user API
  calls, and they hit *our* compute with *our* caching — upstreams uninvolved.

### Being a good upstream citizen (enforced, not aspirational)

- Per-adapter fetch budgets, conservative intervals, `User-Agent` identifying
  HFKit + contact email, exponential backoff with jitter, honor `Retry-After`.
- Circuit breaker per upstream: repeated failures → stop calling, serve cached,
  flag stale. Never retry-storm a struggling volunteer server.
- Before launch: contact KC2G/GIRO maintainers; attribute all sources in-app.

## 2. Resilience

- **Stale-but-labeled beats missing.** Every datum carries `generated_at`; the UI
  shows data age. When an upstream dies we serve the last good bundle with a
  staleness badge and degrade the affected A-score components (weights renormalize
  to the surviving components, and the score's "why" panel says so).
- **Graceful degradation ladder** (ionosphere example): live assimilated grid →
  last cached grid → pure IRI climatology → model-only mode. Each rung is labeled
  in the UI. No rung is a crash.
- **Isolation:** each ingestion adapter is an independent job; one source's outage
  or schema change cannot take down ingestion of the others or the API.
- **Health surface:** `/status` endpoint + internal dashboard showing per-source
  freshness — also user-visible as a simple "data sources" page (transparency
  doubles as trust-building).

## 3. Modularity (add features without refactoring)

The unit of organization is the **module**: band-health, path-planner, coverage,
frequencies, and every future feature (net planner, contest mode, Es nowcasting)
is a module with the same shape:

```
modules/<name>/
  ingest/     optional: upstream adapters it owns
  domain/     pure logic — no I/O, fully unit-testable
  api/        route handlers it contributes
  bundle/     what it adds to published data bundles
  ui/         front-end feature folder (screens, components)
  manifest    name, version, bundle keys, routes, nav entry, feature flag
```

Contracts that make this work:

- **Modules depend on core, never on each other.** Cross-module needs go through
  core interfaces (event bus / shared stores). Core = ingestion framework,
  bundle publisher, scoring engine interfaces, map shell, design system, routing.
- **The A-score is a pluggable pipeline:** each component (model, ionosphere,
  disturbance, activity) implements one interface (`score(circuit, freq, t) →
  {value, confidence, explanation}`); the blender weights and renormalizes.
  Adding a sporadic-E component later = one new class + registry entry, not a
  rewrite. Missing/stale components drop out cleanly (see Resilience).
- **Map layers are plugins:** every overlay (MUF heatmap, coverage, spots, gray
  line, aurora) implements one layer interface (id, source, style, legend,
  min/max zoom, settings). New data = new layer registration, not map surgery.
- **Feature flags from day one:** every module ships behind a flag → safe
  incremental rollout, per-user experiments, kill switch when a data source dies.
- **Versioned everything:** API (`/v1/`), bundle schemas (`schema_version` field),
  DB migrations (Alembic). Old mobile clients keep working against frozen
  contracts; new fields are additive.

## 4. Updateability

- **Server:** containerized services deployed independently (API, workers,
  prediction pool); blue-green or rolling deploys; bundles are immutable so a
  deploy never corrupts in-flight clients.
- **Web/PWA:** service-worker update flow with a gentle "new version available"
  prompt — never a hard refresh mid-planning-session.
- **Mobile:** Expo OTA updates for JS-level changes (theming, copy, UI fixes)
  without store review; store releases only for native-module changes. Clients
  send their bundle-schema version; server can serve down-level shapes during
  transitions.
- **Config over code:** band plans, scoring weights, upstream endpoints, refresh
  intervals, and feature flags live in versioned config the server can update at
  runtime — a NOAA URL change should be a config push, not a release.

## 5. Clean

- **Boring, explicit code.** Thin adapters, pure domain logic, I/O at the edges.
  Type hints + mypy (Python), strict TypeScript. Formatters (ruff/black, prettier,
  eslint) enforced in CI from the first commit.
- **Tests where they pay:** golden-file tests for every upstream parser (recorded
  real payloads), reference-circuit suite for the prediction engine, unit tests
  for scoring math. UI: a handful of Playwright smoke flows, not snapshot soup.
- **Docs as code:** each module's manifest + a short README; architecture decision
  records (`docs/adr/`) for choices like "engine: dvoacap vs ITURHFProp" so future
  contributors know *why*, not just *what*.
