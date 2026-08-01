# Architecture

Proposed system design. Optimized for: small team, cheap to run, every expensive
thing precomputed and cached, one codebase serving web + mobile.

```
┌─────────────────────────────────────────────────────────────┐
│                        Data Ingestion                       │
│  (scheduled workers, one thin adapter per upstream source)  │
│  NOAA SWPC ── GIRO/KC2G ── PSKReporter MQTT ── wspr.live    │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Storage                                │
│  Postgres+TimescaleDB (indices, ionosonde, precomputed      │
│  grids/scores) · Redis (hot cache, pub/sub) · spots kept    │
│  as rolling aggregates, raw history stays in wspr.live      │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Prediction / Scoring Service                │
│  dvoacap-python / ITURHFProp workers · A-score engine ·     │
│  precomputed global grids + on-demand point-to-point        │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│        API (FastAPI): REST + WebSocket (live layer)         │
└──────┬───────────────────────────────┬──────────────────────┘
       ▼                               ▼
  Web app (React + MapLibre)      Mobile (Expo/React Native,
  installable PWA                 same TS API client + design system)
```

## Backend — Python

Python because the entire prediction ecosystem (dvoacap-python, proppy/ITURHFProp
bindings, iri2016, scientific stack) is Python. FastAPI for the API layer.

### Ingestion workers (async jobs, e.g. APScheduler/arq)
- **SWPC poller** (1–15 min per product) → indices timeseries. Trivial JSON fetches.
- **Ionosphere poller** (15 min): Phase 1 fetch KC2G grids; Phase 3+ fetch GIRO DIDBase directly and run our own assimilation (KC2G's pipeline is open source as a reference). Staleness flag when upstream dies → degrade to IRI-only with a UI badge, never silently lie.
- **PSKReporter MQTT consumer**: subscribe `pskr/filter/v2/#`, aggregate in memory to per-(band, tx-grid4, rx-grid4, 15-min) buckets. **Never store raw spots** — 26M/day is a storage trap and we only need densities/SNR aggregates.
- **wspr.live client**: on-demand SQL for historical path statistics; nightly job precomputes "climatology" tables for popular paths.

### Prediction service
- **Point-to-point:** on-demand, ~tens of ms per circuit-month with dvoacap-python; cache by (tx grid4, rx grid4, month, SSN bucket, power, antenna class). 24h × N-freq matrix per call.
- **Area/coverage:** expensive (one prediction per grid cell). Precompute per-user-request as an async job on a coarse grid (e.g. 5°, ~2,600 cells → parallelized, seconds-to-a-minute), cache aggressively; global "popular TX regions" grids precomputed on schedule like DR2W does.
- **Validation harness:** every engine change re-runs a fixed circuit suite vs voacapl reference outputs.

## The A-score (the core product idea)

A 0–100 score for **a specific frequency, between two points (or from one point,
azimuth-averaged), at a specific time**. Composite of four sub-scores, each
independently explainable in the UI ("why this score"):

| Component | Source | What it captures |
|---|---|---|
| **Model reliability** | P.533/VOACAP REL & SNR for the circuit at that freq/hour | Climatological expectation (baseline) |
| **Ionosphere now** | Live MUF/foF2 along the path (KC2G/GIRO), freq vs path MUF & LUF margin | Is the freq actually below today's MUF and above absorption LUF |
| **Disturbance** | Kp/storm alerts, GOES X-ray (SID), D-RAP absorption, auroral oval crossing | Penalties for geomagnetic/solar events, path-latitude aware |
| **Observed activity** | PSKReporter/RBN aggregates near endpoints on that band | Reality check: is anyone actually making it work right now |

- Start with a **hand-tuned weighted blend** (transparent, debuggable). Backtest
  against wspr.live history (did high scores correlate with completed WSPR paths?).
  A learned model is a Phase-5+ nicety, not a prerequisite.
- Forecast mode: beyond ~now+2h the live components fade out and the score converges
  to model + SWPC forecast indices — show widening uncertainty honestly.
- Same engine scores **bands** (score the band's center/representative freqs) →
  the band-health dashboard is just A-scores rolled up per band.

## Frontend — React + TypeScript

- **Map:** MapLibre GL JS (open source, no Google/Mapbox lock-in) + deck.gl for
  raster/contour overlays (MUF heatmaps, coverage grids, spot density). Self-hosted
  or free vector tiles (OpenFreeMap/Protomaps).
- **UI:** Tailwind + a component kit; dark-mode-first (shack/night use). Charts
  with visx or Recharts: the signature visual is the **24h × frequency reliability
  matrix** ("prop wheel, but readable") and band-health sparkline rows.
- **State/data:** TanStack Query against the REST API; WebSocket for live spot layer.
- **Key screens:**
  1. **Dashboard** — band-health rows (score now + 24h sparkline + trend arrow), current indices with plain-English explanations, alerts.
  2. **Path planner** — map with two draggable pins, gray line, great-circle arc; side panel: best-freq-by-hour matrix, A-scores for the user's saved frequency list, "best window" callouts.
  3. **Coverage** — pick a location + band/freq/power → reach heatmap overlay, time scrubber for hour-of-day.
  4. **Frequencies** — user's saved channel lists (any freq, not just ham bands) with live A-scores; this serves ham, EMCOMM/SHARES/MARS, and ALE-style users alike.

## Mobile strategy

1. **Phase 1–3: installable PWA.** The web app ships responsive + service-worker
   from day one. Zero extra codebase, covers "check conditions on my phone."
2. **Phase 4: Expo/React Native app** reusing the TypeScript API client, scoring
   display logic, and design tokens. Native adds: push notifications ("20 m opening
   to VK predicted 02:00–04:00", "Kp storm in progress"), home-screen widgets
   (band-health glance — the N0NBH-banner replacement), offline cached forecasts
   for field/portable ops. Maps via MapLibre React Native.

## Operational notes
- Deploy: containers (API, workers, prediction pool) on a small VPS/Fly.io/Hetzner —
  precompute-and-cache keeps steady-state cost tiny; prediction pool scales horizontally.
- Every upstream gets: thin adapter, staleness monitoring, and a visible data-age
  indicator in the UI. Upstream fragility is the #1 operational risk (see roadmap risks).
- Attribution page for every data source; be a good citizen (this community is small).
