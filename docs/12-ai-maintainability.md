# Designing for AI Maintenance

The maintenance plan for HFKit is "an AI agent checks on it periodically, fixes
what it can, and alerts a human otherwise." That is a legitimate strategy for an
unpaid solo-maintainer project, but it is **an architectural input**, not an
afterthought — a codebase an agent can safely repair looks measurably different
from one it can't.

This doc says what that difference is.

---

## 1. The failure mode we're designing against

An AI agent maintaining a system unsupervised has one characteristic failure:
**making the symptom go away rather than fixing the cause.** Concretely, the
things that would genuinely damage HFKit:

- Deleting or loosening a **sanity gate** because it keeps tripping — converting
  "we noticed bad data" into "we silently serve bad data."
- Removing a **staleness badge** because a test asserts data should be fresh —
  turning honest degradation into confident wrongness.
- Widening a retention window or cache size to fix a failure, quietly unbounding
  a resource we deliberately bounded.
- "Fixing" a failing calibration test by adjusting **scoring weights** until it
  passes — destroying the meaning of the score.

Every one of these turns a *visible* problem into an *invisible* one, which is the
exact opposite of what this project needs. So the rules below are less about
enabling the agent and more about **constraining its blast radius** while giving
it everything it needs to diagnose properly.

## 2. Autonomy tiers (the blast radius contract)

Recorded here, restated in `CLAUDE.md` where an agent will actually read it.

### 🟢 Fix autonomously, open a PR
- Upstream **parser** fixes when a golden test fails and the new payload shape is
  unambiguous
- Dependency patch/minor updates that pass CI
- Config updates for a changed upstream URL or endpoint
- Documentation, typos, comments
- Adding test cases that capture a newly observed payload
- Flaky-test quarantine (marked, with an issue filed — never deleted)

### 🟡 Diagnose, propose, **wait for a human**
- Anything touching **scoring math or weights** (`07-scoring-spec.md`)
- Anything changing what the **UI claims about data freshness or confidence**
- Schema migrations, bundle schema version bumps
- New or removed data sources
- Dependency major-version upgrades
- Retention, cache-size, or rate-limit changes
- Anything that would change cost structure

### 🔴 Never autonomously, under any circumstances
- **Disabling, loosening, or deleting a sanity gate or staleness indicator**
- Changing the license
- Publishing to app stores
- Force-pushing, rewriting history, or pushing directly to `main`
- Contacting upstream data providers on our behalf
- Adding telemetry, analytics, or anything that transmits user location
- Silencing an alert without fixing what it reported

**Rule of thumb for the agent:** if the fix makes the system *quieter* rather than
*more correct*, stop and ask.

## 3. Design for diagnosis

An agent can only fix what it can accurately understand. These are cheap to build
in from the start and expensive to retrofit.

### Structured, machine-readable status
`/status` returns JSON, not a rendered page: per-source last-success timestamp,
staleness state, last error with a stable error code, sanity-gate state, bundle
versions, and disk/retention headroom. One fetch should let an agent form a
correct hypothesis without scraping logs or guessing.

This is the same endpoint that backs the public Data Sources page
(`09-legal-privacy.md` §2) — one artifact serving attribution, user transparency,
and machine diagnosis.

### Structured logs
JSON lines with a stable `event` field and error codes — not prose. Prose logs
force an agent to pattern-match English, which is exactly where it hallucinates
causes.

### Golden-file tests are the primary diagnostic ⭐
Every upstream parser has recorded real payloads as fixtures. When NOAA reshapes a
product, the golden test fails with **a concrete diff showing precisely what
changed**. That diff is the single most useful artifact an agent can receive: it
converts "something broke" into "this field moved and here is its new shape,"
which is a task an agent does reliably.

This is why golden-file tests are in the definition of done
(`10-project-setup.md` §4) rather than being optional nice-to-haves.

### Contract canary (the alerting trigger)
A scheduled job — separate from CI — fetches each upstream **live** and validates
it against the expected schema and plausibility ranges.

- Runs on a schedule (daily is plenty; formats don't drift hourly).
- On failure, it **files a GitHub issue** containing the diff, the raw payload
  excerpt, and the affected adapter.
- CI itself stays hermetic (fixtures only, no network) so it's deterministic and
  an agent can verify a fix locally.

This catches format drift *before* it corrupts data, rather than after.

### GitHub Issues as the work queue
The loop that fits this project's constraints exactly, at zero cost:

```
canary detects drift  →  files issue with diff attached
        →  agent picks up issue, reproduces via golden test
        →  agent opens PR with fix + updated fixture
        →  CI verifies  →  human reviews and merges (🟢 tier)
```

The human stays in the loop at the cheapest possible point — reviewing a small,
tested diff — instead of doing diagnosis. Alerting and task-tracking become the
same system, and there's nothing extra to pay for or maintain.

### Hermetic, deterministic tests
No network in CI. Fast enough to run in full locally. An agent that cannot cheaply
verify its own fix will either not verify it or will "fix" the test.

## 4. `CLAUDE.md` as a first-class artifact

The repo carries a `CLAUDE.md` with conventions, commands, and the autonomy tiers
above. It is maintained like code, not written once and abandoned — it's the
highest-leverage file in the repo for this maintenance model, because it's what an
agent reads before touching anything.

Optionally, a **SessionStart hook** so a monitoring session immediately has the
environment ready to run tests and linters without rediscovering how each time.

## 5. What still requires a human

Being honest about the limits of this plan:

- **Judgment about correctness of the science.** An agent can keep the pipeline
  running; it cannot tell you the A-score has quietly stopped reflecting reality
  as the solar cycle shifts. That's the annual calibration review.
- **Upstream relationships.** If GIRO or KC2G changes terms or asks us to back
  off, a human answers.
- **Anything user-facing that makes a claim.** Copy that asserts confidence,
  disclaimers, scoring changes.
- **Deciding when to stop.** If an upstream dies permanently, whether to replace
  it, degrade, or drop the feature is a product decision.

## 6. Why this fits the project's goals

Every item above also serves the constraints in `11-operating-constraints.md`:
structured status is the monitoring surface, golden tests prevent the silent-wrong-
data failure mode, the canary is the alerting mechanism, and GitHub Issues cost
nothing and need no infrastructure. **Designing for agent maintenance and designing
for cheap unattended operation turn out to be the same work.**
