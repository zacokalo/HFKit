# CLAUDE.md

Guidance for Claude/AI agents working in this repo. Read this before changing anything.

> **Status: planning phase.** There is no product code yet — only `docs/`.
> Sections marked *(pending)* activate once Phase 0 begins. Keep this file
> updated as the code lands; it is maintained like code, not written once.

## What this project is

HFKit is a free HF (shortwave) radio propagation forecasting and planning tool.
It answers: *"which frequency should I use, to reach where, at what time, and how
confident should I be?"*

It is a personal, unpaid, open-source project maintained by one person with AI
assistance. **Minimal operating overhead is a hard constraint, not a preference.**

Read `README.md`, then `docs/` in order. The most load-bearing decisions:

| Decision | Doc |
|---|---|
| Clients never contact upstream data sources; one server aggregates and fans out cached bundles | `docs/05-engineering-principles.md` |
| Prediction runs **on-device** (WASM); the backend is a data pipeline | `docs/11-operating-constraints.md` |
| The A-score is a *calibrated probability*, validated against real data | `docs/07-scoring-spec.md` |
| All styling comes from tokens; no hardcoded colors | `docs/06-design-system.md` |
| Autonomy tiers for AI-made changes | `docs/12-ai-maintainability.md` |

## Autonomy: what you may change

### 🟢 Fix and open a PR
Upstream parser fixes when a golden test fails and the new shape is unambiguous ·
dependency patch/minor bumps that pass CI · changed upstream URLs in config ·
docs and typos · new test fixtures capturing observed payloads · quarantining a
flaky test (mark it and file an issue — never delete it).

### 🟡 Diagnose and propose, then wait for a human
Scoring math or weights · anything changing what the UI claims about freshness or
confidence · schema migrations and bundle version bumps · adding/removing data
sources · major dependency upgrades · retention, cache size, or rate limits ·
anything affecting cost.

### 🔴 Never do autonomously
Disable, loosen, or delete a **sanity gate or staleness indicator** · change the
license · publish to app stores · force-push, rewrite history, or push to `main` ·
contact upstream data providers · add telemetry or anything transmitting user
location · silence an alert without fixing what it reported.

**The test: if your fix makes the system quieter rather than more correct, stop
and ask.** Serving confidently wrong data is the worst outcome this project can
produce — people may plan emergency communications with it. Stale-and-labeled
always beats fresh-looking-and-wrong.

## Non-negotiable invariants

1. **Never hide uncertainty.** Every datum carries its age; every score carries
   its confidence and its component breakdown. If data is stale, say so in the UI.
2. **Clients never call upstream sources directly.** All external data flows
   through our pipeline. This is what keeps our load on volunteer-run services at
   O(1) regardless of user count.
3. **Be a good upstream citizen.** Conservative fetch intervals, identify our
   client, honor backoff, never retry-storm. These services are run by volunteers
   and we are a guest.
4. **Bounded resources.** Every cache has a TTL and max size; every table has a
   retention policy. Nothing grows without a ceiling.
5. **No raw spot storage.** Aggregate only — raw is ~26M rows/day.
6. **Semantic tokens only** in UI code. No hex, no `bg-slate-800`.
7. **Config over code.** Upstream URLs, band plans, scoring weights, and feature
   flags live in `data/` and change without a code deploy.

## Conventions

- **Time is UTC everywhere.** Local time only at final display, always labeled.
- **Units:** MHz (frequency), watts (power), dB with stated bandwidth (SNR), km,
  degrees true (azimuth), decimal degrees WGS84 (position; Maidenhead is display
  only). Full table in `docs/08-domain-model.md`.
- **"Reliability" (0–1, from the prediction engine) and "score" (0–100, ours) are
  different things.** Never use them interchangeably.
- Plain language in user-facing copy; jargon on hover. The glossary in
  `docs/08-domain-model.md` doubles as tooltip copy.

## Commands *(pending — fill in as the code lands)*

```
# install / test / lint / run — TBD in Phase 0
```

## Definition of done for a PR

1. Types pass (mypy strict / tsc strict)
2. Lint passes, including the no-hardcoded-styles rule
3. Domain logic has tests; any new upstream parser has a **golden-file test**
4. New upstream adapter declares: license, refresh interval, circuit breaker,
   staleness behavior
5. New UI component appears in the style guide and renders in **every** theme
6. New feature is behind a flag and has a module manifest
7. Anything user-facing shows data age where it shows data

## Diagnosing a broken pipeline

1. `GET /status` — structured JSON: per-source freshness, last error codes,
   sanity-gate state, bundle versions. Start here, not with logs.
2. Failing **golden test** → the diff shows exactly what the upstream changed.
   That's usually the whole diagnosis. Update parser *and* fixture together.
3. Check for an open issue filed by the **contract canary** — it includes the raw
   payload diff.
4. CI is hermetic (no network, fixtures only), so reproduce and verify locally
   before opening a PR.

If a sanity gate is tripping, the data is probably genuinely bad. **Investigate
the data, not the gate.**

## Git

- Never push to `main` directly; branch and open a PR.
- Conventional, descriptive commit messages explaining *why*.
- Record significant decisions as ADRs in `docs/adr/` (template: `0000-template.md`).
