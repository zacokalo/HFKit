# Spike: ingest-smoke — Findings

**VERDICT: 3 of 4 sources fully usable. PSKReporter untestable in this sandbox.
The KC2G numeric grid does not appear to be public — but a better input was found
instead, and it removes the dependency.**

Run 2026-08-01. All 15 fixtures under `out/fixtures/` are real responses,
verified by content (not by filename — see "Process note" below).

---

## Source status

| Source | Status | What we get |
|---|---|---|
| **NOAA SWPC** | ✅ Fully working | 10 products: F10.7 flux (+30-day history, 45-day forecast), planetary K-index observed and forecast, alerts/warnings, Kyoto Dst, NOAA G/R/S scales, solar cycle 25 SSN and F10.7 predictions. Consistent JSON, ISO 8601 UTC, no parser surprises. |
| **wspr.live** | ✅ Fully working | `wspr.rx` schema (20 fields incl. time, frequency, tx/rx callsign and grid, SNR, distance, azimuth, power), table list, live spot sample. Clean ClickHouse HTTP API, no auth. |
| **KC2G** | ✅ Usable, ⚠️ not as planned | `stations.json` (~150 ionosonde stations: foF2, MUFD, M(D), hmF2, foE, TEC, confidence, lat/lon) and **`essn.json`** (see below). **No public numeric MUF/foF2 grid** — only rendered SVG maps. |
| **PSKReporter** | ❌ Untestable here | MQTT :1883 blocked by sandbox (raw TCP egress). No documented public HTTP API found; probed paths 404. Must be validated on real infrastructure. |

### Endpoints that do NOT exist (probed and confirmed 404)
Recording these so nobody re-probes them: `/api/muf.json`, `/api/mufd.json`,
`/api/grid.json`, `/api/assimilated`, `/api/current.json`, `/api/irimap.json`,
`/irimap.h5`, `/renders/current/mufd-normal-now.json` on prop.kc2g.com; and on
SWPC, `/products/solar-wind.json` (likely renamed) and any D-RAP product in a
machine-readable form.

## ⭐ The important find: `prop.kc2g.com/api/essn.json`

Missed on the first pass, found by probing. Structure:

```json
{ "24h": [{ "time": <unix>, "ssn": 59.28, "sfi": 107.22 }, ...],   // 547 points
  "6h":  [{ "time": <unix>, "ssn": 64.79, "sfi": 111.29 }, ...],   // 547 points
  "diffusion": [] }
```

This is the **effective sunspot number** — the SSN that makes the ionospheric
model agree with what the ionosondes actually measured, at ~15-minute cadence
over roughly the last 5.5 days, in two smoothing windows.

**Why this matters architecturally:** VOACAP and ITU-R P.533 both take SSN as
their primary solar driver. Feeding them the *effective* SSN rather than the raw
observed F10.7 is precisely how you convert a climatological prediction into a
今-day nowcast. So the highest-value piece of KC2G's assimilation is available as
a 78 KB JSON file, without needing his grid at all.

## Consequence: the ionosphere layer is fine, via a different route

The plan assumed we'd consume KC2G's assimilated grid. That grid isn't public.
Two viable paths remain, and the first is enough for Phase 1:

1. **Phase 1 — drive the engine with `essn`.** Feed effective SSN into the
   prediction engine. This yields live-corrected predictions with no grid
   required, and no dependency on KC2G's render pipeline. ~78 KB per refresh.
2. **Phase 2/3 — assimilate `stations.json` ourselves.** ~150 stations reporting
   foF2/MUFD/hmF2 with confidence scores is the *input* to assimilation; building
   our own interpolated grid from it was already the Phase 3 plan
   (`docs/04-roadmap.md`), just pulled forward. Tractable: it's an interpolation
   over ~150 scattered points.

Net effect: **less coupling to a volunteer's server, not more.** We consume two
small JSON files and do our own math, which is exactly the posture
`docs/05-engineering-principles.md` argues for.

## Risks

- **PSKReporter remains unvalidated.** The MQTT firehose powers the A-score's
  `activity` component. It is deliberately the lowest-weighted component and is
  designed to drop out cleanly, so Phase 1 does not depend on it — but its
  feasibility is still an open question that this sandbox cannot answer.
- **KC2G is one person's project.** We now depend on two small endpoints rather
  than a render pipeline, which is better, but the courtesy email before public
  launch (`docs/09-legal-privacy.md`) still applies.
- **D-RAP absorption** has no machine-readable endpoint we could find. The LUF
  calculation in `docs/07-scoring-spec.md` §3.2 assumed it. Alternative: compute
  absorption from solar zenith angle plus X-ray flux ourselves.

## Process note

An earlier pass wrote 404 HTML error pages to disk as `.json` files, and they
were briefly committed as if they were data. **Fixtures must be validated by
content, not by the presence of a file.** `fetch_all.py` should assert both HTTP
200 and a successful parse before writing anything — worth carrying into the real
ingest adapters as a sanity gate, per `docs/12-ai-maintainability.md`.

## Deliverables

- `out/fixtures/` — 15 verified fixtures (13 JSON, 1 SVG, plus `kc2g-essn.json`)
- `SOURCES.md` — endpoint table
- `SCHEMAS.md` — field definitions, types, units, parser gotchas
- `fetch_all.py` — reproducible fetch script
