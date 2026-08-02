# Spike: engine-compare (dvoacap) — Findings

**VERDICT: dvoacap is SUSPECT for our use.** Path geometry, MUF, and the
day/night and solar-activity trends are directionally sane, and the engine is
fast and deterministic. But `reliability` — the exact field our A-score was
specced to build on — is quantitatively broken with default parameters, the
long-path model is an unimplemented stub silently reused outside its valid
range, and there is an API footgun in the package's own top-level exports.
Not disqualifying, but we cannot build the A-score on this port's numbers today.

All figures below were measured, then independently re-verified by the
orchestrator against the raw data in `out/`. Reproduce with `run_predictions.py`,
`sanity_checks.py`, `benchmark.py`.

---

## 1. The critical finding: `reliability` collapses to ~zero

Across **all 4,800 predictions** (10 circuits × 24 hours × 10 frequencies × 2 SSN
levels), including textbook-easy cases like NYC→London at high SSN in daylight
well below the MUF:

| Statistic | Value |
|---|---|
| Maximum `reliability` observed | **0.055** |
| Mean | **0.00054** |
| 99th percentile | 0.014 |
| Fraction above 0.5 | **0.000%** |

*Independently verified by the orchestrator over the raw prediction JSON.*

### Root cause (verified)

1. **`bandwidth_hz` is a dead parameter.** `grep -rn bandwidth_hz dvoacap/*.py`
   returns exactly **one** line — the dataclass field declaration
   (`bandwidth_hz: float = 2700.0`). **Zero read sites.** It never influences any
   calculation.
2. `reliability` comes from comparing `signal.snr_db` against
   `params.required_snr` (**default 73.0 dB**) through a normal CDF. A threshold
   that high only makes sense if calibrated against a narrower noise reference
   bandwidth — the standard VOACAP convention requires a `10·log10(bandwidth)`
   correction. With `bandwidth_hz` dead, that correction never happens.
3. Lowering `required_snr` helps but does not rescue it: even at an
   unrealistically permissive 20 dB, the best frequency on the NYC→London
   high-SSN noon circuit reaches only **12%** reliability. So the missing
   bandwidth term is *a* problem but likely not the *only* one.

### Consequence for HFKit

`docs/07-scoring-spec.md` §3.1 specifies the `model` component as *"engine
reliability (REL) — this is already a probability, no transformation needed."*
**That assumption does not hold for dvoacap.** Do not consume its `reliability`
field directly.

Usable today: `snr_db` and `muf_day` (P(MUF > frequency)). Spot-check
`power_dbw` / `field_dbuv` against known link budgets before trusting them.

Two paths forward, both requiring a human decision (🟡 tier — scoring math):
- **(a)** File upstream against `skyelaird/dvoacap-python`; it is reproducible
  from public inputs.
- **(b)** Build our own reliability/probability layer on dvoacap's raw SNR and
  MUF outputs rather than trusting its `reliability`.

## 2. The long-path model is a stub (verified)

```python
def _evaluate_long_model(self, frequency: float) -> Prediction:
    """Evaluate long path model (not fully implemented)."""
    # Simplified implementation - would need two Reflectrix objects
    # For now, return a basic prediction
    return Prediction()
```

Every prediction for `trans_pacific_long` (12,074 km) and `antipodal_very_long`
(18,701 km) — both far past VOACAP's documented 7,000–10,000 km short/long
transition — returns tagged `method="short"`. **The port does not fail loudly
outside its valid range; it silently keeps using the short-path model** and hands
back a normal-looking `Prediction` with no flag.

This directly violates invariant #1 in `CLAUDE.md` (never hide uncertainty). Any
HFKit integration must add that guard itself: refuse or clearly label predictions
beyond ~10,000 km.

## 3. API footgun

`dvoacap.GeoPoint` (exported at top level) resolves to
`geomagnetic.GeographicPoint`, which is **not** the class `PredictionEngine`
wants (`path_geometry.GeoPoint`, radians-based). Passing the top-level symbol
fails immediately with `AttributeError: 'GeographicPoint' object has no attribute
'lat'`. Correct usage:

```python
from dvoacap.path_geometry import GeoPoint          # NOT `from dvoacap import GeoPoint`
from dvoacap.prediction_engine import PredictionEngine

engine = PredictionEngine()
engine.params.tx_location = GeoPoint.from_degrees(40.71, -75.0)
engine.params.ssn, engine.params.month, engine.params.tx_power = 100.0, 6, 100.0

engine.predict(GeoPoint.from_degrees(51.51, -0.13),
               utc_time=12 / 24.0,               # fraction of a day, NOT hours
               frequencies=[3.5, 7.0, 14.0, 21.0, 28.0])

for freq, pred in zip(engine.frequencies, engine.predictions):
    print(freq, pred.signal.snr_db, pred.signal.muf_day, pred.get_mode_name(engine.path.dist))
print("circuit MUF:", engine.circuit_muf.muf)
```

No built docs ship in the wheel; the above was reverse-engineered from source.

## 4. Sanity checks

10 circuits (328 km NVIS → 18,701 km near-antipodal), defined in `circuits.json`.

**Passed:** MUF rises with SSN (9/10), MUF higher by day (7/10), hour-to-hour
smoothness (8/10), SNR unimodal vs frequency (10/10), longer paths support higher
MUF, and **determinism** — repeated identical calls produced bit-identical output.

**Honest caveats on the failures:**
- Three day/night "failures" (`trans_polar`, `trans_pacific_long`,
  `antipodal_very_long`) are **our check's fault, not the engine's**: it estimates
  path local time from `(tx_lon + rx_lon)/2`, which is meaningless for long,
  high-latitude, or dateline-crossing paths. Raw MUF-vs-hour curves look smooth
  and plausible. A real check must use each control point's actual local time.
- `equatorial_long` smoothness failure (8.1 MHz jump at local dusk) is plausibly
  real physics — post-sunset equatorial F-region collapse — not a bug.
- `trans_pacific_long` smoothness failure (9.95 MHz jump) is more concerning and
  is evidence *for* the long-path stub finding, since that circuit is already
  outside the valid regime.
- **A concrete numerical bug found by hand:** on `long_dx_transatlantic`, low SSN,
  14.0 MHz, SNR runs `hour 9: +10.5 dB → hour 10: −395.8 dB → hour 11: +7.3 dB`,
  with mode flipping to `2F1` and `power_dbw` swinging −559 → −156 dBW under a
  near-identical ionospheric state. Looks like an unguarded degenerate geometry in
  F1-mode reflection. **This is the "don't trust individual cells blindly"
  finding** — exactly what would silently corrupt one pixel of a coverage map.

## 5. Benchmarks

4 cores, dvoacap 1.0.2, Python 3.11, warm venv.

| Measurement | Value |
|---|---|
| Point-to-point (24 h × 10 freq), 20 repeats | **348 ms** mean (324–434 ms) |
| Per `predict()` call (10 freqs) | **14.5 ms** (~10 ms short paths, ~20 ms longest) |
| Coverage grid @5° = 2,520 points, measured 300-pt subset | 19.6 ms/point |
| → full grid, single core (extrapolated linearly) | **≈ 49.4 s** |
| → full grid, 4 cores (extrapolated) | **≈ 13.9 s** |
| Parallel speedup on 4 cores | **3.45×** (86% efficiency) |

Engines are self-contained with no shared mutable state, so `multiprocessing.Pool`
needs no special handling.

## 6. Recommendation: precompute coverage maps

- Single point-to-point at 14.5 ms is fast enough for **on-demand** use — no
  caching needed. This is the number that matters for on-device prediction.
- A full global 5° grid at ~14 s on 4 cores is fine as a **cached background
  job**, too slow for a synchronous request. This matches the precompute-and-cache
  design in `docs/05-engineering-principles.md`.
- Regional/coarser grids could go on-demand with a short spinner.
- **For the WASM path:** a browser tab won't have 4 cores by default, so
  per-point cost times grid size argues even more strongly for server-precomputed
  coverage bundles, with on-device compute reserved for the single-circuit query
  the product leads with.

## 7. Triage table

| # | Issue | Severity | Tier |
|---|---|---|---|
| 1 | `reliability` ~0 everywhere; `bandwidth_hz` dead | **Critical** — it's the A-score's foundation | 🟡 + file upstream |
| 2 | Long-path model is a silent stub past ~10,000 km | High — violates "never hide uncertainty" | 🟡 guard it ourselves |
| 3 | Spurious −395.8 dB isolated cell (2F1 edge case) | Medium — not yet characterized as systemic | Needs investigation |
| 4 | `dvoacap.GeoPoint` is the wrong class | Integration footgun | Document only |
| 5 | Self-reported "86.6% validation accuracy" in package metadata, methodology not reproducible from the wheel | Informational — treat as a vendor claim, not an audited number | n/a |

**Bottom line:** the underlying physics (geometry, MUF, solar and day/night
trends, SNR shape) looks sound, and the engine is fast and deterministic — hence
SUSPECT rather than BROKEN. But issues #1 and #2 mean **dvoacap's raw output must
not be wired into the A-score without an upstream fix or our own recalibration
layer.** This raises the stakes on the ITURHFProp WASM spike considerably: if that
engine works, it may be the better primary choice on correctness grounds alone,
independent of the on-device argument.
