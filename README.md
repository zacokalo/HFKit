# HFKit

**An easier-to-use, visually pleasing HF communications forecaster and planning tool.**

HFKit compiles open-source space weather, ionospheric, and live propagation data to
help plan HF communications work:

- **Band health** — see the health of every HF band at a glance, now and over the next 24–48 hours.
- **Frequency scoring** — a single "A score" (0–100) for the specific frequencies you plan to use, at the times you plan to use them.
- **Path planning** — pick two locations on a map and get ideal frequencies, best time windows, and expected reliability for the circuit.
- **Coverage maps** — see where you could reach from a location on a specific band or frequency.

## Why

The data to do all of this already exists and is free — NOAA space weather feeds,
worldwide ionosonde soundings, and hundreds of millions of live reception reports
per day from PSKReporter/WSPR/RBN. The prediction models (VOACAP, ITU-R P.533)
are open source. What's missing is a tool that fuses them into one modern,
map-first, mobile-friendly experience. Existing tools are powerful but dated,
fragmented, and hostile to newcomers (see [docs/02-existing-tools.md](docs/02-existing-tools.md)).

## Project status

🚧 **Phase 0 complete.** Feasibility is proven by measurement; see `spike/` for raw evidence and [ADR-0001](docs/adr/0001-prediction-engine.md) for the engine decision. This repo contains research, design documents, and the Phase 0 spikes:

| Doc | Contents |
|---|---|
| [docs/01-data-sources.md](docs/01-data-sources.md) | Every open data source and prediction engine we can build on, with access details and risks |
| [docs/02-existing-tools.md](docs/02-existing-tools.md) | What's already out there and where the gaps are |
| [docs/03-architecture.md](docs/03-architecture.md) | Proposed system design: backend, frontend, mobile, the A-score model |
| [docs/04-roadmap.md](docs/04-roadmap.md) | Phased roadmap from feasibility spike → web app → phone app |
| [docs/05-engineering-principles.md](docs/05-engineering-principles.md) | Mothership data distribution (zero burden on upstreams), modularity contracts, resilience, updateability |
| [docs/06-design-system.md](docs/06-design-system.md) | Token-based central theming, flat/contrasty first theme, map theming strategy |
| [docs/07-scoring-spec.md](docs/07-scoring-spec.md) | The A-score: components, blending, physics gates, and the validation protocol that defines success |
| [docs/08-domain-model.md](docs/08-domain-model.md) | Entities, units conventions, and glossary — station, circuit, frequency plan |
| [docs/09-legal-privacy.md](docs/09-legal-privacy.md) | License options, per-source terms audit, privacy posture, liability |
| [docs/10-project-setup.md](docs/10-project-setup.md) | Monorepo layout, stack pinning, ADR process, definition of done |
| [docs/11-operating-constraints.md](docs/11-operating-constraints.md) | Unattended operation and minimal backend cost as binding constraints; deployment tiers, cost model, failure modes |
| [docs/12-ai-maintainability.md](docs/12-ai-maintainability.md) | Designing the codebase so an AI agent can safely diagnose and repair it — autonomy tiers, diagnostics, alerting loop |
| [CLAUDE.md](CLAUDE.md) | Working agreement for AI agents in this repo: invariants, conventions, blast-radius rules |

## Feasibility verdict (TL;DR)

**Yes, this is feasible**, and no single existing tool does all of it:

1. **Band health & indices** — trivial: NOAA SWPC publishes everything as JSON, no auth.
2. **Frequency A-score** — feasible and novel: fuse model predictions (P.533/VOACAP)
   with real-time ionosonde MUF maps and live spot data into one score.
3. **Point-to-point path planning** — solved problem computationally (VOACAP/ITURHFProp);
   the work is in the UX.
4. **Coverage ("reach") maps** — feasible; area predictions are compute-heavy, so we
   precompute/cache grids server-side.

Biggest risks: upstream data fragility (GIRO is now a single point of failure for
ionosonde data), and compute cost of area predictions at scale. Both have mitigations —
see the roadmap.

## What kind of project this is

A **free, open-source, unpaid** tool, built primarily because its author wanted it
to exist. That shapes the engineering more than any feature decision:

- **Minimal operating overhead is a hard constraint.** Phase 1 targets a backend
  with no always-on server and no database — a scheduled job publishing static
  files, with all prediction math running on the user's device.
- **~$0–5/month** to run at Phase 1, and cost is *independent of user count*
  because everyone downloads byte-identical cached bundles.
- **Designed for AI-assisted maintenance** — structured diagnostics, golden-file
  tests, and a canary that files issues with payload diffs, plus explicit limits
  on what an agent may change unsupervised.
- **PWA first, then native.** The PWA validates on-device prediction on real
  phones at no extra cost; native follows for home-screen widgets, guaranteed
  offline storage, and reliable background refresh — the things the offline field
  use case actually depends on.

## Open decisions

Planning is complete. One item remains, and it's exactly what Phase 0 exists to
answer:

| Decision | Status | Where |
|---|---|---|
| **Prediction engine** | ✅ **ITURHFProp (ITU-R P.533), compiled to WASM** — verified numerically identical to native, 0.886 ms/prediction, 201 KB | [ADR-0001](docs/adr/0001-prediction-engine.md) |
| **On-device prediction** | ✅ **Confirmed by measurement**, not just committed | [ADR-0001](docs/adr/0001-prediction-engine.md) |
| **License** | ✅ MIT | [09](docs/09-legal-privacy.md) |
| **Commercial intent** | ✅ Free, non-commercial — resolves all upstream data-terms risk | [09](docs/09-legal-privacy.md) |
| **Primary audience** | ⬜ Assumed EMCOMM-first, ham-friendly (channel plans first-class, NVIS properly supported) — correct me if wrong | [08](docs/08-domain-model.md) |
