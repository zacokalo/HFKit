# Operating Constraints: Unattended & Low-Cost

Two goals promoted to **binding architectural constraints**, not aspirations:

1. **Unattended for long periods** — the tool keeps working correctly for months
   with nobody watching it.
2. **Minimal backend cost** — running it should be a rounding error, and must
   never surprise us.

Both are achievable. Several decisions already made support them; a few new rules
below are required to actually hold the line.

---

## 1. The short answer

**Yes — realistically $10–15/month for Phase 1, scaling sublinearly to maybe
$50–100/month at tens of thousands of users**, with attention measured in a few
hours per quarter plus reactive fixes when an upstream changes its format.

The reason this works is structural, not frugality: the **mothership pattern
decouples nearly all cost from user count**. Upstream fetching, ionospheric
assimilation, and bundle generation cost the same whether 10 or 100,000 people use
HFKit. What's left that scales with users is CDN bandwidth for small cacheable
files — the cheapest thing on the internet.

The one thing that *would* scale badly with users is per-user prediction compute.
Section 3 removes most of it.

## 2. What already helps (decisions we've made)

| Decision | Effect on cost / unattended operation |
|---|---|
| Mothership + versioned bundles | Upstream load and generation cost are **O(1)**, not O(users) |
| CDN-cached immutable artifacts | Traffic spikes cost bandwidth, not compute; no autoscaling needed |
| Precompute-and-cache everything expensive | Steady-state CPU is low and predictable |
| Aggregate-only spot storage (never raw) | Avoids the 26M-rows/day storage trap outright |
| Circuit breakers + staleness labels | Upstream outages degrade visibly instead of paging someone |
| Local-first, accounts optional | Almost no precious user state to back up or protect |
| Config over code | Upstream URL changes are a config push, not a deploy |

That last pair matters more than it looks. **Almost all our stored data is derived
and reconstructible from upstreams** — the database is effectively a cache. Losing
it means re-fetching, not data loss. That eliminates most of the backup and
disaster-recovery burden that normally makes unattended operation expensive.

## 3. The big lever: run predictions on the client ⭐

**Proposal: compile the prediction engine to WebAssembly and run point-to-point
predictions on the user's device.**

This is the single highest-leverage idea for both goals, and it's why it's being
raised now rather than after we've built a server-side prediction pool.

The mothership would ship only the **inputs** — space weather indices and the
assimilated ionosphere grid, a small bundle everyone downloads identically and
which the CDN caches perfectly. The client then does its own math for the user's
specific circuits.

Consequences:

- **Per-user prediction compute drops to zero on our side.** The dominant
  user-proportional cost disappears. Dragging a map pin becomes free to us.
- **Offline capability comes free** — with the last bundle cached, a phone can
  compute predictions with no connectivity at all. This is enormous for the
  EMCOMM/field use case we already identified as primary: exactly the operators
  who most need HF planning are the ones without cell service.
- **Privacy improves structurally** — user positions never leave the device for
  point-to-point work, strengthening the posture in `09-legal-privacy.md`.
- **Latency improves** — no round trip.

Feasibility (a **Phase 0 spike item**, not an assumption):

- **ITURHFProp is C** → compiles to WASM via Emscripten relatively cleanly. This
  is now a significant point in its favor and should be added as a criterion in
  **ADR-0001**, alongside accuracy.
- **dvoacap-python is pure Python** → could run under Pyodide (heavy, ~10 MB
  runtime) or be ported to TypeScript/Rust→WASM (more work, better result).
- **voacapl is Fortran** → hardest path; treat as server-side fallback only.

Realistic hybrid, which is what I'd expect to ship:

| Workload | Where | Why |
|---|---|---|
| Space weather + ionosphere assimilation | Server | Shared by everyone; must be centralized |
| Point-to-point predictions, A-scores | **Client (WASM)** | Per-user, embarrassingly parallel across devices, free to us |
| Area/coverage maps | Server, precomputed + cached | Too heavy for phones; but bounded and shared |
| Historical/climatology queries | Server | Needs the dataset |

If the WASM spike fails, we fall back to the server-side prediction pool already
specced in `03-architecture.md` — with aggressive caching by rounded grid square,
which gets a high hit rate because users cluster geographically. Costs rise but
stay manageable. **The spike is worth doing first because a positive result
changes the architecture materially.**

## 4. Cost model

Rough, deliberately labeled as estimates, and sized for the fixed-price hosting
recommended in §6.

**Data volumes (the inputs to everything else):**

- SWPC JSON: single-digit KB per poll, ~8 products — negligible.
- Ionosphere grid: a global 1° foF2/MUF grid is ~65k points; quantized and
  compressed, on the order of tens of KB per 15-minute update — negligible to
  store, cheap to serve.
- PSKReporter MQTT: **the one genuinely heavy stream.** ~26M spots/day is roughly
  300 messages/second sustained, on the order of several GB/day ingress. Ingress
  is typically free, and parsing 300 msg/s is a modest fraction of one core — but
  it requires an **always-on process**. This is why we can't be purely serverless.
  If it ever becomes a burden, the topic structure allows subscribing to a subset
  or sampling, since we only need aggregate statistics.

**Estimated monthly cost:**

| Phase | Scale | Infra | Estimate |
|---|---|---|---|
| 1 | Hundreds of users | One small fixed-price VPS (2–4 GB), Cloudflare free tier CDN | **~$10–15/mo** |
| 2–3 | Thousands | 8 GB VPS, same CDN, coverage precompute | **~$25–40/mo** |
| 4+ | Tens of thousands | Larger VPS or two, CDN bandwidth grows | **~$50–100/mo** |

Plus one-offs: domain (~$15/yr), Apple Developer ($99/yr) and Google Play ($25
once) when the mobile app ships in Phase 4.

Note the **sublinear scaling**: 100× the users is nowhere near 100× the cost,
because everyone downloads byte-identical cached bundles. If client-side
prediction (§3) works, the curve flattens further.

## 5. Bounded by design (so nothing grows until it breaks)

Unattended systems die from slow growth, not sudden failure. Every resource gets
a designed ceiling:

- **Storage tiering, enforced by a scheduled job:** full-resolution spot aggregates
  ~7 days → hourly rollups ~90 days → monthly climatology retained indefinitely.
  Raw spots are never stored at all. This keeps the database at a few GB
  permanently rather than growing without bound. *"Disk full at 3 a.m." must be
  designed out, not monitored for.*
- **Prediction request logs:** ≤30 days, already required by the privacy posture —
  privacy and disk discipline happen to align.
- **Bundle history:** keep a short rolling window; older bundles expire from the CDN.
- **Every cache has a TTL and a max size.** No unbounded memoization anywhere.
- **Log rotation with hard caps** — unbounded logs are a classic unattended killer.

## 6. Unattended operation: failure modes and answers

| What breaks | Likelihood over a year | Answer |
|---|---|---|
| **Upstream changes its format/URL** | High (1–2× per source) | Golden-file parser tests catch it in CI; in production, **sanity gates** on ingest (range/plausibility checks — reject an SFI of 0 or 99999) so we keep the last good value instead of ingesting garbage. Alert, degrade, don't corrupt. |
| Upstream outage | High | Circuit breaker + serve cached + staleness badge. Already designed. No human needed. |
| Disk growth | Certain without action | Retention tiering (§5) |
| Cert expiry | Certain without automation | Automated ACME renewal (Caddy/Traefik). Never manual. |
| Dependency/security rot | Certain | Renovate/Dependabot with auto-merge for patch updates; scheduled base-image rebuilds |
| Process crash / memory leak | Medium | Container restart policies + health checks; each ingest adapter isolated so one failure can't cascade |
| **Silent wrong data** | Low but **worst impact** | The one unacceptable unattended failure. Plausibility gates on ingest, confidence/staleness carried through to every score, and the UI never presenting stale data as fresh. Better to show "unavailable" than to be confidently wrong — especially for emergency planning. |
| **Cost runaway** | Low but expensive | See below |

### Fixed-price infrastructure is a resilience feature

**Recommendation: fixed-price VPS (Hetzner, or similar), not usage-billed
serverless.**

For an unattended system this is not primarily about unit economics — it's about
failure modes. The failure mode of usage-billed infrastructure, when nobody is
watching, is a **surprise four-figure bill** from a traffic spike, a retry loop, or
a scraper. The failure mode of a fixed-price box is that it gets slow. For a tool
meant to run unattended for months, "gets slow" is a vastly better worst case than
"gets expensive."

Corollaries: put the CDN on a plan with free or flat egress (Cloudflare), set
billing alerts anyway, and rate-limit our own public API endpoints.

### Minimum viable monitoring

Cheap and mostly free — this is what makes "unattended" honest rather than
"unmonitored":

1. **Dead-man's switch** (e.g. healthchecks.io free tier): the pipeline pings on
   every successful cycle. *Silence* pages you — this catches the failure where
   everything looks fine because nothing is running.
2. **Per-source freshness** on the `/status` endpoint, exposed publicly as the Data
   Sources page from `09-legal-privacy.md` §2 — one page serving legal
   attribution, user transparency, and ops monitoring.
3. **Uptime check** on the public API from outside.
4. Alerts to email/push only for: pipeline silent, source stale beyond threshold,
   sanity gate tripped, disk above 80%. **Nothing else pages.** An unattended
   system that cries wolf gets ignored, which is worse than no alerting.

## 7. What will genuinely need your attention

Honest accounting — "unattended" is not "zero maintenance":

- **Upstream format changes:** the main recurring reactive work. Expect a couple
  per year across all sources. Thin adapters keep each fix to under an hour.
- **Dependency/security updates:** automated, but occasionally a major version
  needs hands.
- **Mobile store requirements:** Apple and Google force periodic SDK/policy
  updates regardless of whether your app changed. This is the least avoidable
  ongoing cost of shipping Phase 4, and worth weighing when deciding whether the
  PWA is sufficient.
- **Scoring drift:** as the solar cycle moves, revalidate calibration
  (`07-scoring-spec.md` §5) maybe annually. Nice-to-have, not urgent.

Estimate: **a few hours per quarter** in steady state, plus reactive fixes.

## 8. Anti-patterns (things that would quietly break both goals)

- **Usage-billed serverless** for the always-on ingest path — surprise bills, and
  the MQTT consumer can't scale to zero anyway.
- **Managed everything** (hosted DB + queue + search + logs): each is $20–50/mo
  and they add up to 10× a VPS for a workload this small.
- **Per-user server-side prediction with no caching** — the one thing that truly
  scales with engagement. Cache by rounded grid, or move it to the client (§3).
- **Storing raw spots** — already excluded, worth restating; it's the difference
  between a few GB and a few TB.
- **Kubernetes** at this scale: operational burden with no benefit, and a cluster
  left unattended is a liability rather than an asset.
- **Alert fatigue** — noisy monitoring is functionally identical to no monitoring.
- **Chasing real-time everything.** HF conditions change on 15-minute timescales.
  A 15-minute refresh is scientifically adequate *and* two orders of magnitude
  cheaper than second-level updates. Match the cadence to the physics.
