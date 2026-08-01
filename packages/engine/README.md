# @hfkit/engine

Typed TypeScript wrapper around the ITU-R P.533 (`ITURHFProp`) WebAssembly HF
propagation engine. This is the package the rest of HFKit's on-device
prediction architecture rests on (`docs/11-operating-constraints.md`) — it
runs entirely on the caller's device, never contacts a server, and never
sends the caller's position anywhere.

It wraps a **text-file-driven CLI program compiled to WASM**, not a native
function-call API: `HFEngine.predict()` builds ITURHFProp's `.in` input
format from a typed request, stages it (plus the needed ITU data files) into
the WASM module's virtual filesystem, invokes `main()`, and parses the
resulting `.out` report back into typed results.

## What it does not do

- Does not ship, fetch, or cache the ~11 MB/month ITU ionospheric data itself
  — see "Data files" below.
- Does not run in a browser yet, despite the API being designed to — see
  "Known limitations".
- Does not support antenna patterns beyond isotropic yet (Phase 3+ per
  `docs/08-domain-model.md`'s layered `AntennaProfile` plan).
- Does not compute HFKit's 0-100 "A-score" — this package only produces the
  engine's own 0-1 `reliability` and raw signal figures. Scoring is a
  separate, later concern (`docs/07-scoring-spec.md`).

## API

```ts
import { HFEngine, NodeFsDataProvider } from '@hfkit/engine';

const engine = await HFEngine.create({
  dataProvider: new NodeFsDataProvider({ dataDir: '/path/to/ITURHFProp/Data' }),
});

const result = await engine.predict({
  transmitter: { latitude: 49.6666666667, longitude: 6.31666666667 },
  receiver: { latitude: 51.1166666667, longitude: 7.26666666667 },
  time: { year: 2026, month: 8, hoursUtc: [12] }, // UTC hour(s), 0-23
  frequenciesMHz: [3.5, 7.1, 14.1, 21.1],
  transmitPowerWatts: 100,
  requiredSnrDb: 10,
  requiredSnrBandwidthHz: 3000,
  manMadeNoise: 'rural',
  modulation: 'analog',
  solarDriver: { ssn: 80 },
});

console.log(result.circuit); // { distanceKm, pathDirection, exceedsValidRange, validityWarning, ... }
for (const p of result.predictions) {
  console.log(p.frequencyMHz, p.hourUtc, p.snrAtReliabilityDb, p.overallReliability, p.dominantMode?.mode);
}
```

`HFEngine.create()` compiles and instantiates the WASM module once; the same
instance is reused across every subsequent `predict()` call on that engine
(see "Known limitations" for a subtlety this causes and how it's handled).
`engine.timings` exposes the most recent call's `initMs` / `dataLoadMs` /
`runMs` for callers that want to surface performance or debug slow paths.

### Units (binding, per `docs/08-domain-model.md`)

Time is UTC, frequency is MHz, power is watts (PEP), SNR is dB with a stated
bandwidth, position is decimal degrees WGS84, distance is km. `reliability`
fields are `0.0-1.0` (the engine's own probability) and are **not** the same
thing as HFKit's `0-100` "score" — this package never produces the latter.

### Validity ranges

Every numeric field is validated against the *engine's own* documented
bounds before a WASM call is made (transcribed from
`ITU-R-HF/P533/Src/P533/ValidatePath.c`, not guessed) — e.g. frequency
1.0-30.0 MHz, SSN 1-311, transmit power roughly 1 W to 1 GW (internally
-30..60 dB relative to 1 kW). Out-of-range input throws a
`HFEngineValidationError` naming the field, the value given, and the valid
range, before ever touching the WASM engine.

### The >10,000 km guard

ITU-R P.533 is documented valid to roughly 10,000 km. The engine does not
refuse long paths — it keeps computing and returns normal-looking numbers
outside its validated regime (the same class of defect
`spike/engine-compare/FINDINGS.md` found in a sibling engine). This package
computes the great-circle path distance itself (independent of the engine's
own reported distance, which is cross-checked via
`result.circuit.distanceMismatchKm`) and sets
`result.circuit.exceedsValidRange = true` plus a plain-language
`result.circuit.validityWarning` whenever it does. **Every value in a
flagged result should be treated as low-confidence** — per this project's
"never hide uncertainty" rule, this package will never silently drop or
suppress a long-path prediction, only label it.

## Data files

ITURHFProp needs, per calendar month: an ~10.68 MB ionospheric map
(`ionosNN.bin`), ~230 KB of P.372 noise coefficients (`COEFFNNW.txt`), and a
~72 KB, year-round decile-variability table
(`P1239-3 Decile Factors.txt`). **This package deliberately does not bundle,
vendor, or fetch any of this** — per `CLAUDE.md`, the ~11 MB/month cost is
the pipeline/CDN's problem, not this package's, and committing it here would
bloat the repository for every consumer regardless of whether they need it.

Instead, callers supply a `DataProvider`:

```ts
export interface DataProvider {
  getMonthData(month: number): Promise<{
    decileFactors: Uint8Array;
    ionosphere: Uint8Array;
    noiseCoefficients: Uint8Array;
  }>;
}
```

`NodeFsDataProvider` (included) reads these three files from a local
directory laid out like upstream's `ITURHFProp/Data/`. **There is no browser
`DataProvider` implementation yet** — the interface is the seam for one (a
`fetch()` + IndexedDB/Cache-API implementation is the obvious next step,
matching `docs/11-operating-constraints.md`'s "fetch on demand, cache with a
TTL" model), but writing it was out of scope here and, as of this package,
would need a rebuilt WASM artifact anyway (see below).

Only the *current month's* files are ever needed. `HFEngine` caches the last
month loaded into the WASM virtual filesystem for the lifetime of the
instance, so repeated predictions in the same month skip the reload; a month
change costs one `DataProvider.getMonthData()` call and a re-write into
MEMFS (~15-30 ms measured here for the ~11 MB ionosphere file).

## Known limitations

Reported plainly, per this task's instructions, rather than glossed over.

### 1. The vendored WASM artifact is Node-only today, not browser-ready

`vendor/iturhfprop.js`/`vendor/iturhfprop.wasm` are copied unmodified from
the Phase 0 spike (`spike/engine-wasm/artifact/`), as instructed. That build
was compiled with `-sENVIRONMENT=node` (see
`spike/engine-wasm/build-wasm.sh`), which hardcodes `ENVIRONMENT_IS_NODE =
true` in the glue and unconditionally calls `require("node:fs")`. **It will
not run in a browser as shipped**, despite this package's public API
(`HFEngine`, `DataProvider`) being designed to. Making it actually work in a
browser needs Phase 0's WASM artifact rebuilt with `-sENVIRONMENT=web` (or
`web,worker`) — nothing in this package's *interface* would need to change
for that (the `DataProvider` seam and the `WasmRuntime` abstraction inside
`src/wasmModule.ts` were both written with that swap in mind), but the
vendored binary itself would need to change, and that's out of this task's
scope ("do not rebuild these").

### 2. A real, verified upstream defect: WASM instance reuse truncates report headers

While building the golden test, reusing one `HFEngine` (i.e. one WASM module
instance) across multiple `predict()` calls caused every call *after the
first* to fail parsing with "could not find start of Data Format section."

Root cause, confirmed against the vendored C source (not a guess):
`ITU-R-HF/ITURHFProp/Src/ITURHFProp/Report.c` has

```c
static int Header = TRUE; // The first time you enter this routine the head will need to be printed.
```

a **process-lifetime** C static that gates printing the report's banner,
"Data Format" column list, and "Calculated Parameters" opening marker. It is
set `FALSE` after the very first report and never reset — invisible to the
native CLI (one `main()` call per OS process), but real once Emscripten's
`callMain()` genuinely re-enters `main()` in the same WASM instance/heap, as
this package's instance-reuse design does.

Verified this is cosmetic, not a computation bug: a direct byte-for-byte
comparison of the data row from a reused instance's 2nd call against a
freshly-instantiated engine's identical single-shot request produced
**identical output** — the row-printing code path (`PrintRecord(...,
PRINT_DATA)`) runs unconditionally regardless of `Header`, only the
surrounding text scaffold is skipped. `test/engine.reuseDefect.test.ts`
encodes this as a regression test.

**Fix applied**: rather than reinstantiating a fresh module per `predict()`
call (which would also throw away the ~11 MB/month data-load cache — a much
larger cost), `src/outputParser.ts` accepts an optional known column layout
to fall back on when the "Data Format" section is absent
(`REPORT_FORMAT_COLUMNS`, resolved once and validated against the same
column-recognition rules used for the normal path). This is safe specifically
*because* this package's own `.in` generator always requests one fixed,
constant `RptFileFormat` — so the column layout for its own output is a
known fact, not a guess. The general-purpose `parseOutputFile(text)` export
stays strict by default (throws if the header is missing) for anyone parsing
arbitrary/external `.out` text, e.g. the golden test's reference fixture.

This is exactly the kind of defect this project's "never present wrong data
confidently" design principle is meant to catch — a naive column-position
parser (rather than the header-driven one this package uses) would likely
have silently misaligned columns instead of throwing.

### 3. Data cost is real

~11 MB must be fetched and cached per active month. Not addressed by this
package (by design — see "Data files" above), but worth restating here:
first-run latency for a real client depends entirely on how fast that
fetch is, which this package has no visibility into.

### 4. Report format coverage is intentionally narrow

`src/outputParser.ts`'s column recognition only covers the columns
implied by this package's own fixed `RptFileFormat` (`inputFile.ts:
REPORT_FORMAT`) plus the narrower flag set used by the committed
`bench_24h_10f.in` golden fixture. ITURHFProp supports many more report
columns (long-path parameters, SIR, digital-mode RSN/RT/RF, CSV/RFC4180
output, etc. — see `RPT_*` flags in `ITURHFProp.h`) that this parser will
reject with "unrecognized report column" if ever encountered, by design
(see CLAUDE.md: never silently ignore unfamiliar data). Extending coverage
is straightforward (add a `COLUMN_RULES` entry) but wasn't needed for this
phase's scope.

## Known upstream input/output subtleties (read the source, don't guess)

A few unit conventions in ITURHFProp's `.in`/`.out` format are easy to get
wrong by inspection alone; each was confirmed against `ValidatePath.c` /
`ReadInputConfiguration.c` / `Report.c` rather than assumed:

- **Transmit power is dB relative to 1 kW, not watts and not dBW.**
  `Path.txpower 0.0` in the fixtures means **1000 W**, not 0 W.
  `src/inputFile.ts` converts `transmitPowerWatts` accordingly
  (`dBkW = 10*log10(W / 1000)`).
- **Hour and month are 1-based in the file format**, decremented internally
  by the engine, and re-incremented when printed back in the report. This
  package's public API uses 0-23 UTC hours (per `docs/08-domain-model.md`);
  `src/inputFile.ts` / `src/outputParser.ts` handle the +1/-1 conversion at
  the boundary.
- **`AntennaOrientation "TX2RX"`** makes the engine compute both antennas'
  bearings itself from the tx/rx positions — this package always uses it
  (isotropic gain doesn't care about bearing), so callers never need to
  supply one.

## Tests

```
npm run test --workspace=@hfkit/engine
```

- `test/inputFile.test.ts`, `test/outputParser.test.ts`,
  `test/validation.test.ts`, `test/geo.test.ts` — pure unit tests, no WASM or
  data files needed, always run.
- `test/engine.golden.test.ts` — runs the **committed, unmodified**
  `bench_24h_10f.in` fixture (copied from
  `spike/engine-wasm/fixtures/`) through the real WASM engine and checks
  every parsed field against the committed reference output
  (`bench_24h_10f.reference.out`, copied from
  `spike/engine-wasm/out/native_bench_24h_10f.out`). This is the test that
  would catch a WASM/output-format regression.
- `test/engine.test.ts` — end-to-end `HFEngine.predict()` tests: a normal
  short circuit, the >10,000 km validity-warning guard, pre-flight
  validation rejecting bad input, instance reuse, and a timing measurement.
- `test/engine.reuseDefect.test.ts` — regression test for the upstream
  `Header` static defect described above.

The four tests/files above that actually invoke the WASM engine need real
ITU data (**not committed to this repo** — see "Data files"). Point
`HFKIT_ITU_DATA_DIR` at a local `ITU-R-HF/ITURHFProp/Data/` checkout to run
them; without it they report as **skipped**, not failed, keeping `vitest
run` hermetic in an environment (e.g. CI) that hasn't provisioned the data
yet, per `CLAUDE.md`'s "CI is hermetic (no network, fixtures only)."

```
HFKIT_ITU_DATA_DIR=/path/to/ITU-R-HF/ITURHFProp/Data npm run test --workspace=@hfkit/engine
```

## Measured performance

Measured in this environment (Node 22, single core, 5 repeated fresh
`HFEngine` instances, same 24-hour x 10-frequency circuit as Phase 0's
`bench_24h_10f` benchmark — Luxembourg to Bockhacken, SSN 80, August):

| Metric | Measured here | Phase 0 (spike, native harness) |
|---|---|---|
| Cold init (compile + instantiate) | 2.4-8.0 ms (one outlier at 32.5 ms, likely a scheduling/JIT-warmup hiccup); avg 9.6 ms across 5 runs | ~6.4-7.0 ms |
| Data load (one month, ~11 MB into MEMFS) | 10.5-30.4 ms; avg 20.0 ms | ~12.9-13 ms |
| Compute, 240 predictions (24h x 10freq) | 155-220 ms; avg 176.1 ms | ~194.6-212.6 ms |
| Per-prediction | 0.645-0.918 ms; avg **0.734 ms** | **0.81-0.886 ms** |
| Memory: after `HFEngine.create()` (WASM compiled, no data yet) | RSS +5.0 MB over a bare Node process (45.4 -> 50.4 MB) | not measured |
| Memory: after first `predict()` (one month's ionosphere resident) | RSS +56.9 MB more (-> 107.3 MB total) | not measured |

**No regression versus Phase 0** — per-prediction latency through this
package's full typed wrapper (validation + `.in` generation + WASM call +
`.out` parsing) is in the same ~0.7-0.9 ms band as the raw harness, and if
anything slightly faster on average in this run, well within normal
measurement noise for a benchmark this short. The RSS growth per month
loaded (~57 MB for an ~11 MB source file) is larger than the raw byte count
because MEMFS holds its own copy of the written bytes on top of the C
program's own parsed in-memory arrays (`foF2`, `M3kF2`, etc.) and Node's
`Buffer`/`Uint8Array` copies along the way; worth quantifying more precisely
before shipping a mobile/low-memory target, but not a Phase 1 blocker.

Reproduce: `HFKIT_ITU_DATA_DIR=... npx vitest run test/engine.test.ts` (see
the `[measured]` console line in the "measures cold init..." test), or run
many `HFEngine.create()` + `predict()` cycles directly.

---

## ⚠️ Open defect: the reliability columns read zero

`overallReliability` (and `overallReliabilityWithScatter`) read **0 for every
circuit, hour and frequency tested**, and do **not** respond to `requiredSnrDb`.

Tested Boston→London (5,264 km), August, SSN 60, 100 W, isotropic, with
`requiredSnrDb` at 24, 10, 0 and −10 dB against an available
`snrAtReliabilityDb` of 12.47 dB. All four produced reliability 0.

**Everything else is correct and responsive**, which is what makes this a
narrow defect rather than a broken engine:

| Field | Behaviour |
|---|---|
| `basicMufMHz` | ✅ sensible diurnal curve, 8.4–16.9 MHz on this path |
| `snrDb`, `snrAtReliabilityDb` | ✅ responsive; falls off sharply above the MUF |
| `medianReceivedPowerDbW`, `fieldStrengthDbuVm` | ✅ physically plausible |
| `overallReliability` | ❌ always 0 |

**Hypothesis tested and disproved:** that OCR degenerates for analog modulation
because the time/frequency-spread inputs (`Path.A/TW/FW/T0/F0`) apply only to
digital, so BCR would be the meaningful figure. Adding `RPT_BCR` to the report
format showed **BCR reads 0 too**. That change was reverted — it altered the
golden fixture's column set (the golden test caught it immediately) for no
diagnostic gain.

**Do not surface these fields to users until this is resolved.** The Phase 1 demo
(`apps/web/`) deliberately displays SNR margin instead.

This is the second engine in a row to ship a broken reliability field — see
`spike/engine-compare/FINDINGS.md` §1 for dvoacap's version, where
`bandwidth_hz` had zero read sites. It is exactly why ADR-0001 requires the
reliability output to be validated through the backtest harness before the
A-score trusts it. Resolving it is 🟡 tier (scoring math) per `CLAUDE.md`.

Next steps: compare our generated `.in` against ITU's own reference input files
(`ITURHFProp/Bin/*.in`) which are known to produce non-zero reliability, and
diff the parameter sets.
