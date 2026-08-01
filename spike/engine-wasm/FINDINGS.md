# HFKit engine-wasm spike: can HF propagation prediction run in-browser via WASM?

**VERDICT: YES — ITURHFProp/P533 (ITU-R P.533) compiles cleanly to WebAssembly,
produces numerically identical output to the native build, runs in ~0.8 ms per
prediction, and ships as a ~200 KB `.wasm` file; the only real cost is ~11 MB
of ionospheric data per active month, which is fetchable/cacheable rather
than bundled.**

This directly supports HFKit's on-device prediction architecture
(`docs/11-operating-constraints.md`): the backend can be a scheduled data
pipeline, not a prediction server.

## What was built

1. **Located the real source.** `https://github.com/G4FKH/proppy` (suggested
   as a starting point) is only a Flask/Python wrapper around a closed,
   Windows-only `ITURHFProp.exe` + `p533.dll` — not usable. The actual open C
   implementation is published by ITU-R Study Group 3 at
   **`https://github.com/ITU-R-Study-Group-3/ITU-R-HF`**: three components,
   `P533` (ITU-R P.533 HF propagation core, C, DLL/`.so`), `P372` (ITU-R
   P.372 atmospheric/man-made noise, C, DLL/`.so`), and `ITURHFProp` (a CLI
   wrapper/example driver that dlopen()s the other two). License: per the
   repo's `README.md`, the software "may be used by implementers ... free
   from any copyright assertions" (ITU-R Study Group 3, 2022), provided "as
   is" with no warranty — permissive for an open-source project. The repo
   also has its own Ubuntu/macOS CI (`Linux/Makefile` via `make all`),
   confirming this is meant to build on Linux, not just Windows.

2. **Native build** (`build-native.sh`): clones the repo, runs its own
   `make all` (gcc, `-O2 -fPIC ... -z muldefs`), producing `libp533.so`,
   `libp372.so`, and the `ITURHFProp` CLI. Verified against the repo's own
   bundled `.in`/`.out` test-case pairs (`1-5-85`, `1-8-84`, `164-1-78`) plus
   a custom 24-hour x 10-frequency fixture (`fixtures/bench_24h_10f.in`,
   240 predictions in one run). All ran cleanly.

   **Blocker hit & resolved:** the repo ships stale pre-built
   `ITURHFProp/Linux/libp533.so`/`libp372.so` (reporting version 14.1/14.2)
   that are out of sync with HEAD source (14.2/14.3). `dlopen("libp533.so")`
   with `.` first in `LD_LIBRARY_PATH` silently picked up the stale binary.
   Caught via the version banner in the output; fixed by pointing
   `LD_LIBRARY_PATH` only at the freshly-built `P533/Linux`/`P372/Linux`
   dirs. All reference numbers in this report use the corrected build.

3. **WASM build** (`build-wasm.sh` + `patches/emscripten-static-link.patch`):
   installed Emscripten 6.0.5 (emsdk, kept outside the repo per instructions)
   and statically linked all of P533 + P372 + ITURHFProp's 28 `.c` files into
   one wasm module with `emcc`.

   **Blocker hit & resolved:** `ITURHFProp` normally `dlopen()`s
   `libp533.so`/`libp372.so` at runtime (4 call sites across
   `ITURHFProp.c`, `P533.c`, `PathMemory.c`). WASM has no meaningful
   dynamic-library story for a static site, so the patch replaces every
   `dlopen`/`dlsym` call with a direct C function-pointer assignment under a
   new `#elif __EMSCRIPTEN__` branch placed alongside the existing
   `#ifdef _WIN32` / `#elif __linux__ || __APPLE__` branches already in the
   source — **no algorithm code was touched**, only the DLL-loading glue.
   Three further build issues were fixed along the way: (a) wasm has no
   `-fcommon`/tentative-definition merging, so several global function
   pointers needed exactly one non-`extern` definition instead of being
   declared identically in every translation unit; (b) two version-string
   function pointers were declared with old K&R "unspecified argument"
   types (`char *(*)()`), which wasm's `call_indirect` type-checks strictly
   and traps on — fixed by declaring them `(void)`; (c) the default 64 KB
   wasm stack was too small for this codebase's local arrays and caused
   "memory access out of bounds" — fixed with `-sSTACK_SIZE=8388608` (8 MB).
   See `patches/emscripten-static-link.patch` for the full diff (9 files,
   ~300 lines, entirely additive `#elif __EMSCRIPTEN__` branches).

4. **Verified it actually runs**, under Node (which executes Emscripten
   output directly — no browser needed to prove correctness/perf). The
   harness (`run.js`) writes the `.in` file and only the required data files
   for that month into the wasm module's virtual filesystem (MEMFS), calls
   `Module.callMain()`, and reads the report back out.

## Native vs WASM correctness

Four circuits run through both builds (patched-source WASM vs freshly-built
native), diffed byte-for-byte after stripping the 3-line run-timestamp
header:

| Fixture | Description | Result |
|---|---|---|
| `1-5-85.in` | short path, analog, 1 hour x 1 freq | **byte-identical** |
| `1-8-84.in` | 24-hour sweep | **byte-identical** |
| `164-1-78.in` | 1 hour x 1 freq | **byte-identical** |
| `bench_24h_10f.in` | 24h x 10freq, 240 predictions (custom) | **byte-identical** |

All MUF, field-strength, SNR, noise-decile, and reliability columns match
exactly. Full diffs are reproducible; raw outputs are in `out/native_*.out`
and `out/wasm_*.out`.

## Measured numbers

| Metric | Value |
|---|---|
| `iturhfprop.wasm` | 205,767 bytes (~201 KiB) |
| `iturhfprop.js` (Emscripten glue/loader) | 62,017 bytes (~61 KiB) |
| Data required for one active month (ionos.bin + coeff.txt + decile file) | 11,506,546 bytes (~10.97 MiB) |
| Full vendored 12-month archive (not all needed at once) | 132 MiB |
| WASM cold init (compile + instantiate module) | ~7.0 ms avg |
| WASM data load (write 11 MB into MEMFS) | ~11.5 ms avg |
| WASM compute, 24h x 10freq (240 predictions) | ~194.6 ms avg -> **~0.81 ms/prediction** |
| Native compute, same circuit, same host (wall clock incl. process exec + disk read) | ~196.2 ms avg -> ~0.82 ms/prediction |

WASM is within ~1% of native for this workload — no meaningful performance
penalty. Full numbers, including all 5 repeated runs per configuration, are
in `out/measurements.txt`.

## The data-file question (the thing most likely to kill this architecturally)

ITURHFProp needs three kinds of external data per prediction:
1. **Ionospheric map** for the target month — `ionosMM.bin`, **~10.7 MiB**.
2. **Noise coefficients** for the target month — `COEFFMMW.txt`, ~230 KiB.
3. **MUF variability deciles**, whole year, loaded once — 72 KiB.

Critically, tracing the actual call sites in `ITURHFProp.c`
(`ReadIonParametersBin`, `ReadFamDud`) shows **only the current month's
files are read** — not all twelve. The vendored repo's `P372/Data/`
directory is 132 MiB because it bundles all 12 months plus redundant
human-readable `.txt` copies of the binary ionosphere maps (unused at
runtime) — that full directory is *not* what a client needs.

This means the on-device engine's data footprint is **~11 MB per month**,
fetched and cached (e.g. IndexedDB/Cache API) rather than bundled with the
app. A user predicting circuits across a month boundary needs at most two
months resident (~22 MB); a whole year cached locally is ~132 MB, still
plausible for a PWA-style cache but not something to preload by default.
This is squarely a "fetch on demand, cache with a TTL" problem — consistent
with HFKit's existing bounded-cache principle
(`docs/05-engineering-principles.md` invariant 4) — not a blocker.

## Recommendation

**Commit to on-device prediction.** The P533/P372 engine:
- compiles to a small (~200 KB), fast (sub-millisecond-per-prediction) wasm
  module with zero algorithmic changes required (only DLL-loading glue was
  patched);
- produces numerically identical results to the native reference;
- has a genuinely bounded, cacheable data dependency (~11 MB/month, not
  ~132 MB) once the "one active month" access pattern is respected.

Suggested next steps for Phase 0, in priority order:
1. Wire the wasm module + a per-month data-fetch/cache layer into the actual
   client build (this spike used Node + MEMFS as a stand-in for a browser;
   a real browser build should use `fetch()` + IndexedDB or Cache API
   instead of writing files into MEMFS from local disk).
2. Decide whether to keep patching upstream ITURHFProp's C source directly
   (current approach) or write a thinner custom C entry point that calls
   `P533()`/`Noise()` directly with a JSON-ish parameter struct instead of
   ITURHFProp's file-based `.in`/`.out` I/O — the file-based CLI works fine
   under Node/MEMFS but a real browser API will want a direct
   struct-in/struct-out call, avoiding virtual-filesystem text parsing
   entirely. This is additional engineering, not a research risk.
3. Confirm the ionospheric `.bin` format is stable enough to ship as
   pipeline-published, versioned data bundles (aligns with
   `docs/11-operating-constraints.md`'s "backend is a data pipeline" model).
4. dvoacap/Pyodide fallback was **not evaluated** — with ITURHFProp/P533
   working cleanly and cheaply, there is no need to spend spike time on the
   much heavier (~10 MB+ runtime alone) Pyodide path per the task's guidance
   to stop once one path clearly works.

## Files in this directory

- `build-native.sh` — clones ITU-R-HF and builds the native reference
  (`libp533.so`, `libp372.so`, `ITURHFProp` CLI) via the upstream `make all`.
- `build-wasm.sh` — clones ITU-R-HF, applies
  `patches/emscripten-static-link.patch`, and compiles the wasm module with
  `emcc`. Requires an activated Emscripten SDK (not vendored here — see
  script header for the two-line setup).
- `patches/emscripten-static-link.patch` — the full, minimal diff enabling
  a static (non-dlopen) Emscripten build. No algorithm/math code is touched.
- `run.js` — Node harness that loads the wasm module, stages the `.in` file
  and the one month of data it needs into MEMFS, invokes `main()`, and
  reports timing.
- `fixtures/bench_24h_10f.in` — custom 24-hour x 10-frequency test circuit
  used for the latency benchmark (not part of upstream repo).
- `artifact/iturhfprop.wasm`, `artifact/iturhfprop.js` — the built wasm
  module and its Emscripten glue/loader (205 KB + 61 KB, well under the
  10 MB threshold, so kept).
- `out/native_*.out`, `out/wasm_*.out` — raw prediction reports from both
  builds for all 4 test circuits.
- `out/measurements.txt` — raw timing data (5 repeated runs per
  configuration) backing the numbers in this document.

## What was NOT done (explicitly out of scope / not needed)

- No real-browser test (Chrome/Firefox) — Node runs Emscripten output
  identically for the purposes of proving correctness and measuring compute
  cost; only the data-fetch mechanism (`fetch()`+cache vs local-disk MEMFS
  writes in this harness) would differ in a real browser, and that's a
  standard web-platform capability, not a research question.
- No dvoacap/Pyodide evaluation — unnecessary once ITURHFProp/P533 was
  confirmed working; see Recommendation section 4.
- No attempt to shrink the wasm binary further (e.g. `-Os`, closure
  compiler) — at 205 KB it is already a non-issue.

---

# Orchestrator verification (independent)

Re-ran and re-checked the load-bearing claims rather than accepting them.

**Correctness — confirmed, with one wording correction.** Two of the four
output pairs are *not* literally byte-identical: they differ by exactly one line,
the `Analysis Prepared  Sat Aug  1 06:35:4X 2026` header, because the native and
WASM runs happened one second apart. Stripping the timestamp line, **all four
circuits match by md5**. The substantive claim (WASM computes the same numbers as
native) is verified; "byte-identical" was imprecise.

**Executed the artifact independently.** Ran `node run.js fixtures/bench_24h_10f.in`
against the ITU data directory from a clean shell. Output matched the committed
*native* reference numerically (md5 `2d1418ef…`). Measured in that run:

| Metric | Value |
|---|---|
| 240 predictions (24 h × 10 freq) | 212.6 ms → **0.886 ms/prediction** |
| Cold init | 6.4 ms |
| Data load (one month) | 12.9 ms |
| Data copied into MEMFS | 11,506,546 B = **11.0 MB** |
| `iturhfprop.wasm` | 205,767 B = **201 KB** |
| `iturhfprop.js` glue | 62,017 B = **61 KB** |
| Full ITU data archive on disk | 272 MB (only one month needed at a time) |

**Head-to-head against dvoacap on identical workload** (240 predictions):

| | Per prediction | Notes |
|---|---|---|
| dvoacap, native CPython | 1.45 ms | `reliability` unusable, long-path stub |
| **ITURHFProp, WASM in Node** | **0.886 ms** | numerically verified, ITU-standard model |

The WASM build is **~1.6× faster than the Python engine running natively**, which
settles any concern that moving on-device costs performance.

**The one real cost is data, not code.** 201 KB of WASM is nothing; 11 MB of
ionospheric coefficients per active month is a genuine fetch-and-cache problem.
It is a good fit for the mothership bundle model (one file per month, served from
CDN, cached indefinitely since it never changes once published) but it does mean
first-run download is ~11 MB. Subsetting or quantizing that file is a worthwhile
optimization to investigate before launch, not a blocker.
