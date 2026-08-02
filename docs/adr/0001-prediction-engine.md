# ADR-0001: Prediction engine — ITURHFProp (ITU-R P.533), compiled to WebAssembly

**Status:** Accepted
**Date:** 2026-08-01

## Context

HFKit needs an HF propagation prediction engine. Two decisions were coupled and
had to be answered together, which is what Phase 0 existed to do:

1. **Which engine** — `dvoacap` (pure-Python VOACAP port) or **ITURHFProp**
   (ITU-R P.533 reference implementation, C)?
2. **Where does it run** — on the server, or on the user's device via WASM?

The second question drives the entire cost model
(`docs/11-operating-constraints.md`): on-device prediction means the backend is a
scheduled job publishing static files (~$0–5/month), while server-side prediction
means a compute pool that scales with users. So "can it compile to WASM" was made
a first-class selection criterion alongside accuracy.

Both spikes ran with real measurements, and the orchestrator independently
re-verified every load-bearing claim rather than accepting the agents' reports.
Raw evidence: `spike/engine-compare/`, `spike/engine-wasm/`.

### Evidence: dvoacap is not trustworthy today

- **`reliability` is broken.** Across all 4,800 predictions it never exceeded
  **0.055** and averaged **0.0005** — including textbook-open circuits. Root
  cause verified by inspection: `bandwidth_hz` is declared but has **zero read
  sites** in the package, so the 73 dB required-SNR threshold is never
  bandwidth-corrected. This is precisely the field `docs/07-scoring-spec.md` §3.1
  specified as the A-score's `model` component.
- **Long-path model is a stub** returning a bare `Prediction()`, silently reused
  for circuits beyond ~10,000 km and mislabelled `method="short"` — a direct
  violation of the never-hide-uncertainty invariant.
- One reproducible numerical bug: an isolated −395.8 dB cell between two normal
  hours (2F1 mode edge case).
- Its packaged "86.6% validation accuracy" claim is not reproducible from the
  shipped wheel.

Physics, determinism, and speed were sound — hence *suspect*, not *broken* — but
its numbers cannot back a score people may use for emergency planning.

### Evidence: ITURHFProp compiles to WASM and is correct and fast

Source: `github.com/ITU-R-Study-Group-3/ITU-R-HF`. (`G4FKH/proppy` turned out to
be a Windows-DLL wrapper, not the engine.) License is permissive — "free from any
copyright assertions."

A ~300-line patch across 9 files replaces `dlopen`/`dlsym` DLL glue with static
function pointers for Emscripten. **No algorithm code is touched.**

Independently measured by the orchestrator, running the artifact from a clean shell:

| Metric | Value |
|---|---|
| Numeric output vs native build | **identical (md5), all 4 circuits** |
| Per prediction | **0.886 ms** (240 predictions in 212.6 ms) |
| Cold init | 6.4 ms |
| Data load, one month | 12.9 ms |
| `.wasm` | **201 KB** (+61 KB glue JS) |
| Ionospheric data | **11.0 MB per active month** (272 MB full archive) |

Head-to-head on identical workload: **0.886 ms/prediction in WASM vs 1.45 ms in
native CPython for dvoacap** — the WASM build is ~1.6× faster than the Python
engine running natively.

## Decision

**We will use ITURHFProp (ITU-R P.533) as the primary prediction engine, compiled
to WebAssembly, running on the user's device.**

Consequently:

- **On-device prediction is confirmed, not merely assumed.** The Tier 0 backend
  in `docs/11-operating-constraints.md` §3a stands: a scheduled job publishing
  static bundles, no always-on server, no database for Phase 1.
- The engine ships as a ~262 KB WASM+JS payload plus a per-month data file.
- **dvoacap is not adopted.** It remains a useful cross-check for validating our
  outputs, and its issues are worth reporting upstream, but it will not compute
  anything users see.
- We gain the ITU-standard model (P.533-14.2 with the P.372-14.3 noise model),
  which is also what `proppy` uses — a better provenance story than an unaudited
  port for a tool making confidence claims.

## Consequences

**Easier:**
- Per-user prediction compute is **zero** on our side; cost is user-count
  independent.
- Offline operation falls out for free — critical for the EMCOMM/field use case.
- User positions never leave the device for point-to-point work.
- Coverage maps stay a cached server-side background job, as already designed
  (a global 5° grid is ~2,520 predictions; too much for one browser tab, fine as
  a periodic job).

**Harder:**
- **The 11 MB monthly data file is the real cost.** Fine for a CDN bundle cached
  indefinitely (it never changes once published), but it makes first run a ~11 MB
  download. Subsetting or quantizing is a worthwhile pre-launch optimization —
  not a blocker.
- We own a patch against upstream C. It's mechanical and confined to linkage, but
  it must be rebased when ITU publishes updates.
- Upstream ships **stale prebuilt `.so` binaries that don't match HEAD source**
  (caught via a version-string mismatch). Always build from source; never trust
  the shipped binaries.
- `docs/07-scoring-spec.md` §3.1 must be revisited: whichever engine we use, its
  reliability output has to be validated through the backtest harness before the
  A-score trusts it. dvoacap proved that assuming "REL is already a probability"
  is not safe.

**Cost of reversal:** low-to-moderate. The engine sits behind an adapter
interface; swapping to server-side execution or another engine means replacing
that adapter, not rewriting features.

## Alternatives considered

- **dvoacap on the server** — rejected: the `reliability` defect and long-path
  stub are disqualifying for a confidence-claiming tool, and it would reintroduce
  per-user compute cost.
- **dvoacap via Pyodide** — not pursued once ITURHFProp succeeded; the Pyodide
  runtime alone is ~10 MB before any engine, and it would inherit dvoacap's
  correctness problems.
- **voacapl (original Fortran)** — out of scope: no `gfortran` in the build
  environment, and Fortran→WASM is a substantially harder path.
- **Server-side ITURHFProp** — remains the fallback if a future platform can't
  run WASM, but there is now no reason to prefer it.

---

## Addendum (Phase 1): browser execution verified, and a build-flag correction

Packaging the engine as `@hfkit/engine` surfaced that the Phase 0 artifact had
been compiled with `-sENVIRONMENT=node`, making it **Node-only**. Phase 0 proved
the engine *computes* correctly under WASM, but it had only ever been executed
under Node — so the browser half of this ADR's premise was, strictly, untested.

**Fixed and verified.** Rebuilt with `-sENVIRONMENT=node,web` (a one-flag change;
the `.wasm` is byte-identical at 205,767 bytes, since the flag only affects the
JS glue, which grew 62,017 → 62,603 bytes). Then confirmed end to end in headless
Chromium:

- Emscripten factory resolves and the module instantiates in-browser ✓
- `FS` and `callMain` are available ✓
- 11 MB of ITU data mounts into MEMFS in **399 ms** ✓
- All 65 `@hfkit/engine` tests still pass against the rebuilt artifact, including
  the golden test reproducing the Phase 0 reference output numerically ✓

**Known integration detail:** `MODULARIZE=1` without `EXPORT_ES6` emits a
CommonJS-style export, so the glue loads as a classic script (global `Module`)
rather than a browser ESM `import`. Vite's CJS interop handles this, and
`-sEXPORT_ES6=1` is available if a clean ESM path is preferred — a decision for
the web-app phase, not a blocker.

**Second upstream defect found** (documented in `packages/engine/README.md`):
`Report.c` declares `static int Header = TRUE`, a process-lifetime C global, so
only the *first* `callMain()` on a given WASM instance emits the report header.
Reusing one instance across predictions — which we do, to avoid repaying the
~20 ms data load — silently drops that section. The computed data was verified
byte-identical between reused and fresh instances; only the text scaffold
differs. The parser therefore falls back to a known-correct column layout rather
than reinitialising per call or risking a misaligned parse.

**Measured in the packaged wrapper:** 0.734 ms/prediction, ~9.6 ms cold init,
~20 ms data load. No regression against Phase 0's 0.886 ms.
