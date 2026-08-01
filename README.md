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

🚧 **Planning phase.** This repo currently contains research and design documents:

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
| [docs/11-operating-constraints.md](docs/11-operating-constraints.md) | Unattended operation and minimal backend cost as binding constraints; cost model and failure modes |

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

## Open decisions

Planning is complete enough to start building. These are outstanding and are
flagged inline in the docs — none of them block Phase 0:

| Decision | Default assumed | Where |
|---|---|---|
| **Primary audience** | EMCOMM-first, ham-friendly (arbitrary channel plans are first-class; NVIS supported properly) | [08](docs/08-domain-model.md) |
| **License** | Apache-2.0 recommended; no `LICENSE` file added yet | [09](docs/09-legal-privacy.md) |
| **Commercial intent** | Options kept open — restrictive sources isolated behind swappable adapters | [09](docs/09-legal-privacy.md) |
| **Prediction engine** | dvoacap-python vs ITURHFProp — this is what Phase 0 exists to answer | [10](docs/10-project-setup.md) |
| **Client-side prediction** | Pursue it — the Phase 0 WASM spike decides. Success removes per-user prediction compute from the backend and gives offline mode for free | [11](docs/11-operating-constraints.md) |

## Operating targets

Designed to run unattended for months at minimal cost — see
[docs/11-operating-constraints.md](docs/11-operating-constraints.md):

- **~$10–15/month** at Phase 1 scale, scaling *sublinearly* to ~$50–100/month at
  tens of thousands of users (everyone downloads byte-identical cached bundles).
- **Fixed-price infrastructure**, so the worst case when unattended is "slow,"
  never a surprise bill.
- **Bounded storage by design** via retention tiering — the database stays at a
  few GB permanently and is mostly reconstructible from upstreams anyway.
- **A few hours of attention per quarter** in steady state, mostly reacting to
  upstream format changes.
