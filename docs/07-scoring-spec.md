# A-Score Specification

The A-score is the product's core claim, so it gets a real spec **before**
implementation — including how we'll prove it works. Everything here is v0:
concrete enough to build and test, explicitly expected to change once Phase 0
produces real numbers.

---

## 1. Definition

> **A-score** — an integer 0–100 estimating the probability that a usable
> contact can be made on frequency *f*, over circuit *C*, at time *t*, for a
> given station configuration and mode.

Critically: **it is a probability estimate, not a vibe.** That framing forces
calibration — a score of 70 should mean "works about 70% of the time under these
conditions," which is a testable claim (§5). This is what separates HFKit from
Good/Fair/Poor banners.

Score bands (UI language):

| Score | Label | Meaning |
|---|---|---|
| 85–100 | Excellent | Reliable, use it |
| 70–84 | Good | Should work |
| 50–69 | Marginal | Workable with effort/patience |
| 30–49 | Poor | Unlikely, try another freq |
| 0–29 | Closed | Don't bother |

## 2. Inputs

| Input | Source | Notes |
|---|---|---|
| `f` | user frequency plan or band representative | MHz |
| `C` | tx/rx endpoints (or tx + azimuth for area mode) | see `08-domain-model.md` |
| `t` | UTC instant | forecast horizon = `t − now` |
| station config | user profile: power, antenna, noise environment | defaults if unset |
| mode | CW/SSB/FT8/etc → required SNR | drives the model threshold |

## 3. Components

Each component implements the same interface and returns
`{ value: 0..1, confidence: 0..1, explanation: string }`. Confidence encodes
data freshness and applicability — a stale or inapplicable component fades out
rather than lying.

### 3.1 Model reliability (`model`)
Prediction engine (dvoacap-python / ITURHFProp) for circuit `C` at `f`, `t`,
using the station config and current SSN/SFI.

- `value` = engine reliability (REL), i.e. P(SNR ≥ required SNR for the mode).
  This is already a probability — no transformation needed.

> ⚠️ **Phase 0 finding — this assumption is INVALID for dvoacap.**
> Measured across 4,800 predictions, dvoacap's `reliability` never exceeds 0.055
> and averages 0.0005, including on textbook-open circuits. Root cause verified:
> its `bandwidth_hz` parameter is declared but never read anywhere in the
> codebase, so the required-SNR threshold (default 73 dB) is never
> bandwidth-corrected. See `spike/engine-compare/FINDINGS.md` §1.
>
> Consequences: (a) if we adopt dvoacap, the `model` component must be built
> from its `snr_db` and `muf_day` outputs with our own probability layer, not
> from its `reliability` field; (b) whichever engine we choose, **the REL output
> must be validated against the backtest harness before it is trusted** — the
> harness exists precisely to catch this class of error. Resolving this is 🟡
> tier (scoring math) and needs a human decision.
- `confidence` = 1.0 near-term, unchanged with horizon (it's climatological by
  nature), but *reduced* when the driving SSN/SFI is itself a forecast.
- This is the **baseline**: with no live data at all, A-score ≈ 100 × REL.

### 3.2 Ionosphere now (`iono`)
Where `f` sits between the path's LUF and MUF **right now**, from the assimilated
foF2/MUF grid.

- Compute path MUF via **control points** (P.533 convention): path midpoint for
  circuits < 4000 km; points 1000 km inbound from each end for longer circuits.
  Path MUF = min(control point MUFs), since the weakest hop governs.
- Let `r = f / MUF_path`. Score shape (piecewise, tunable):

  | `r` | `value` | Rationale |
  |---|---|---|
  | > 1.0 | ~0 | Above MUF — penetrates, no refraction |
  | 0.85–1.0 | 0.6 → 0.9 rising then falling near 1.0 | Near-MUF: strong but unstable |
  | 0.55–0.85 | **1.0** | The FOT sweet spot (FOT ≈ 0.85·MUF) |
  | LUF–0.55 | falls off | Increasing absorption, lower angles |
  | < LUF | ~0 | Absorbed in D layer |

- LUF derived from absorption (D-RAP + solar zenith angle at control points) and
  the required SNR — a low band in daylight has a high LUF, which is exactly why
  40 m dies at noon and opens at dusk.
- `confidence` = f(grid age, distance to nearest contributing ionosonde). Degrades
  toward 0 as the grid staleness passes ~1 hour; at 0 the component drops out and
  weights renormalize (see `05-engineering-principles.md`).

### 3.3 Disturbance (`disturb`)
Multiplicative penalty (starts at 1.0, subtracts):

- **Geomagnetic (Kp/Ap):** penalty scales with the path's **geomagnetic** latitude,
  not geographic. High-latitude and polar paths degrade hard at Kp ≥ 5; equatorial
  paths barely notice. Auroral-oval crossing (OVATION) adds a further penalty.
- **SID / flare:** GOES X-ray ≥ M-class → immediate shortwave fadeout on the
  **sunlit** portion of the path, weighted by solar zenith angle at control points,
  decaying over the flare's duration. Low bands hit hardest.
- **D-region absorption:** D-RAP absorption at control points, frequency-scaled
  (absorption ∝ 1/f²) — the same reason this belongs in the LUF calculation, applied
  here as the event-driven part.
- `confidence` high (SWPC is reliable and near-real-time).

### 3.4 Observed activity (`activity`)
Reality check from PSKReporter/RBN/WSPR aggregates.

- Look for spots on the same band in the last 15–60 min between regions near the
  endpoints, widening the geographic and temporal window until a usable sample
  appears (and lowering confidence as it widens).
- **Normalize against expected activity**, not raw counts — a band with few
  operators must not score as "closed" merely for being quiet. Compare observed
  spot rate to the historical median rate for that band/hour/season from wspr.live
  climatology. `value` reflects the *ratio*, not the count.
- `confidence` is **low by default** and rises with sample size. With no spots at
  all, confidence → 0 (absence of evidence ≠ evidence of absence, especially on
  channelized non-amateur frequencies where nobody is beaconing).
- This component is deliberately the weakest-weighted but the most *convincing* in
  the UI ("14 stations near you heard into Germany in the last 20 minutes").

## 4. Blending

```
raw   = Σᵢ (wᵢ · cᵢ · sᵢ) / Σᵢ (wᵢ · cᵢ)      # confidence-weighted, auto-renormalizing
score = 100 · raw · Π(gates)
```

Starting weights (`w`), to be tuned by backtest — **not** by intuition:

| Component | Weight |
|---|---|
| `model` | 0.40 |
| `iono` | 0.35 |
| `disturb` | applied as gate + component, see below |
| `activity` | 0.25 |

### Physics gates (the important part)
A pure weighted average lets good data mask a disqualifying fact — e.g. lively
activity elsewhere on the band inflating a frequency that is above the MUF. So
some conditions are **multiplicative gates**, not summands:

- `f > MUF_path · 1.05` → gate ≤ 0.15. Physics doesn't negotiate.
- `f < LUF` → gate ≤ 0.2.
- Severe SID on a fully sunlit path → gate ≤ 0.3.
- Disturbance penalty applies as a gate multiplier ≤ 1.0.

Gates are always explained in the "why this score" panel — a gated score must say
*"14.2 MHz is above the current path MUF of 12.6 MHz"*, never just show a red number.

### Forecast horizon
Beyond ~2 h, `iono` and `activity` confidence decay toward 0 and the score
converges to model + SWPC forecast indices. The UI widens the uncertainty band
accordingly. **We never present a 48-hour forecast with the same visual certainty
as a nowcast.**

## 5. Validation protocol (defines "done")

Written before tuning so we can't move the goalposts.

**Dataset.** WSPR spots from wspr.live are near-ideal ground truth: known TX power,
machine-scheduled transmissions, global receivers, reported SNR. For a sample of
(path, band, hour) cells, "success" = ≥1 spot decoded in that 2-minute window
between that TX/RX pair. Sample across seasons, latitudes, path lengths, and both
quiet and storm periods (storm-time performance is where scores earn trust).

**Metrics.**
- **Calibration** (primary): reliability diagram — bin predictions by score decile,
  plot observed success rate. A well-calibrated score sits on the diagonal.
  Report **Brier score** and calibration error.
- **Discrimination:** AUC — does the score rank good conditions above bad ones?
- **Failure asymmetry:** track false-confidence (high score, no propagation)
  separately and weight it heavier. Telling someone a dead frequency will work is
  far worse than being pessimistic, especially for emergency planning.

**Baselines we must beat.** Publishing this comparison honestly is the credibility
play:
1. Pure VOACAP/P.533 REL alone (does fusion actually add value?)
2. Simple MUF-ratio heuristic
3. N0NBH-style static Good/Fair/Poor band labels

**Exit criterion for Phase 2:** calibration error < 10 percentage points across
deciles, AUC meaningfully above all three baselines, and no score ≥ 85 bin with
observed success below ~60%.

**Caveats to state publicly.** WSPR validates *weak-signal digital* propagation
specifically; extrapolating to SSB voice is an assumption we disclose. Spot data
is biased toward populated areas and active bands. We publish the methodology and
its limits — overclaiming would poison trust in exactly the community whose data
we depend on.

## 6. Roll-ups

- **Band health** = A-score at the band's representative frequencies (band center
  and edges), reported as the best achievable score plus the frequency achieving it.
  A band is only as good as its best usable frequency.
- **"Best frequency now"** = argmax over the user's frequency plan.
- **Best time window** = contiguous hours where score ≥ threshold, from the 24 h
  score curve.

## 7. Explainability requirement

Every score, everywhere in the UI, expands into its components with plain-language
reasons and data ages. Non-negotiable: an unexplainable score is indistinguishable
from a guess, and for emergency planning that's worse than no tool at all.
