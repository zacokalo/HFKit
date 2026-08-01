# Project Setup

The concrete shape of the repo, so Phase 0/1 starts by writing code rather than
debating layout.

---

## 1. Monorepo layout

One repo, mixed Python + TypeScript. A monorepo is right here because the API
contract, design tokens, and domain vocabulary are shared across four consumers
(API, web, mobile, workers) and would drift instantly if split.

```
HFKit/
├─ docs/                      planning + ADRs (this directory)
├─ packages/                  shared, published-internally
│  ├─ theme/                  tokens.json + generators  → CSS, Tailwind, TS, MapLibre
│  ├─ api-client/             generated TS client from the OpenAPI schema
│  └─ ui/                     design-system components + style guide
├─ services/                  Python
│  ├─ core/                   ingestion framework, bundle publisher, scoring
│  │                          interfaces, config, module registry
│  ├─ ingest/                 one thin adapter per upstream (swpc/, giro/, pskr/, wspr/)
│  ├─ predict/                engine adapters (dvoacap/, iturhfprop/) + worker pool
│  ├─ api/                    FastAPI app; routes contributed by modules
│  └─ modules/                feature modules (band_health/, path_planner/,
│                             coverage/, frequencies/) per the module contract
├─ apps/
│  ├─ web/                    React + Vite + MapLibre (PWA)
│  └─ mobile/                 Expo (Phase 4)
├─ data/                      versioned config: band plans, mode SNR table,
│                             scoring weights, upstream endpoints, feature flags
└─ infra/                     containers, deploy, CI
```

Note that `data/` is a first-class directory, not a folder of magic constants:
scoring weights, band plans, and upstream URLs are config that ships and updates
independently of code, per the "config over code" principle.

## 2. Stack decisions (pin in Phase 0, record as ADRs)

| Layer | Choice | Why |
|---|---|---|
| Backend | Python 3.12+, FastAPI, Pydantic v2 | Prediction ecosystem is Python; Pydantic gives us schema → OpenAPI → TS client for free |
| Jobs | arq or APScheduler + Redis | Lightweight; no Celery/RabbitMQ weight at this scale |
| DB | PostgreSQL + TimescaleDB | Timeseries indices and spot aggregates are the dominant shape |
| Cache/bus | Redis | Hot bundles, pub/sub for the live layer |
| Web | React 18 + TypeScript (strict) + Vite | |
| Map | MapLibre GL JS + deck.gl | No vendor lock-in; styles are JSON so they're themeable |
| Styling | Tailwind driven **entirely** by generated theme tokens | Reskinnability contract from `06-design-system.md` |
| Charts | visx or Recharts behind one adapter | Adapter means the palette stays token-driven and the lib stays swappable |
| Data fetching | TanStack Query | |
| Mobile | Expo / React Native | Shares TS client + tokens |
| Tests | pytest, Vitest, Playwright (smoke only) | |
| Quality | ruff + mypy (strict), eslint + prettier, pre-commit | Enforced in CI from commit #1 |

**Deliberately excluded from v1:** GraphQL (REST + bundles fit the caching model
far better), Kubernetes (containers on a small VPS until proven otherwise),
microservices (modules inside a monolith give us the modularity without the ops
tax), and any AI/ML component (the A-score is explainable math first; learned
correction is Phase 5 at the earliest).

## 3. ADRs

`docs/adr/NNNN-title.md`, one per significant or reversible-at-cost decision.
Format: Context / Decision / Consequences / Status. Written when the decision is
made, never retroactively.

ADRs to write in Phase 0:
- 0001 Prediction engine choice (dvoacap-python vs ITURHFProp) — **the** decision Phase 0 exists to answer. Criteria: accuracy vs reference, deployability, **and whether it compiles to WASM for client-side execution** (see `11-operating-constraints.md` §3)
- 0002 Mothership + bundle distribution (already decided; record the reasoning)
- 0003 Token-based theming (already decided; record it)
- 0004 Local-first, accounts optional
- 0005 License ⚠️ pending your call

## 4. Definition of done (per PR, from the first one)

1. Types pass (mypy strict / tsc strict)
2. Lint passes, **including the no-hardcoded-styles rule**
3. Tests for domain logic; golden-file test for any new upstream parser
4. New upstream adapter → declares license, refresh interval, circuit breaker, staleness behavior
5. New UI component → appears in the style guide, renders correctly in **every** theme
6. New feature → behind a flag, has a module manifest
7. Anything user-facing → plain-language copy, data age shown where data is shown

## 5. What Phase 0 produces (concretely)

Throwaway code, permanent answers:

- `spike/engine-compare/` — reference circuits through both engines vs published VOACAP output → ADR-0001
- `spike/engine-wasm/` — attempt an Emscripten build of ITURHFProp (and/or a Pyodide load of dvoacap-python); measure bundle size and in-browser prediction latency. Determines whether prediction is a backend cost at all.
- `spike/area-bench/` — grid prediction timing → decides whether coverage maps are on-demand or precomputed
- `spike/ingest-smoke/` — all five sources fetched once, payloads recorded as future golden-test fixtures
- `spike/score-v0.ipynb` — A-score v0 computed on real data for a handful of paths, sanity-checked against reality
- `spike/wspr-backtest/` — the validation harness skeleton from `07-scoring-spec.md` §5, proving we can measure calibration before we tune anything

The Phase 0 outputs that matter aren't the code — they're ADR-0001, the compute
budget, and a scoring formula grounded in real numbers instead of intuition.
