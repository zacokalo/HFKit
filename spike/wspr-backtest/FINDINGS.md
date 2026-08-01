# HFKit validation spike: WSPR backtest harness

**VERDICT: validation harness WORKS — a real, cached WSPR dataset with an honest both-ends-active negative class was built end to end and produced non-trivial calibration, ranking, and false-confidence metrics against a placeholder scorer, proving the measurement machinery is sound and ready for a real scoring engine.**

This is a spike. The scorer it exercises (`placeholder_score.py`) is deliberately simple and is **not** the real HFKit A-score — it exists only to give the metrics machinery something varied to measure. Its poor calibration numbers below are expected and are not a finding about HF propagation; they are proof the harness can detect poor calibration when it exists.

---

## 1. Schema of `wspr.rx` (as actually queried, not assumed)

Retrieved via `DESCRIBE TABLE wspr.rx FORMAT JSONCompact` against `https://db1.wspr.live/`. `SHOW TABLES FROM wspr` returned zero rows (table listing appears unavailable/restricted on this endpoint), so `wspr.rx` was explored directly — it is the table named in the task brief and it answered.

| column | type | notes |
|---|---|---|
| `id` | UInt64 | |
| `time` | DateTime | UTC, spot timestamp |
| `band` | Int16 | integer band designator, e.g. `14` = 20 m, `7` = 40 m (confirmed empirically: distinct values `-1,0,1,3,5,7,10,13,14,18,21,24,28,40,50,144,430,...` matching WSPR band plan) |
| `rx_sign` | LowCardinality(String) | receiver callsign |
| `rx_lat`, `rx_lon` | Float32 | receiver position |
| `rx_loc` | LowCardinality(String) | receiver Maidenhead grid, 4 or 6 chars as self-reported |
| `tx_sign` | LowCardinality(String) | transmitter callsign |
| `tx_lat`, `tx_lon` | Float32 | transmitter position |
| `tx_loc` | LowCardinality(String) | transmitter Maidenhead grid |
| `distance` | UInt16 | km, tx-rx great circle |
| `azimuth` | UInt16 | degrees, tx→rx bearing |
| `rx_azimuth` | UInt16 | degrees, rx→tx bearing |
| `frequency` | UInt64 | Hz, exact dial frequency |
| `power` | Int8 | transmit power, dBm |
| `snr` | Int8 | dB, in WSPR's 2500 Hz reference bandwidth |
| `drift` | Int8 | Hz/minute frequency drift |
| `version` | LowCardinality(String) | decoder/software version string |
| `code` | Int8 | undocumented in the DESCRIBE output; not used by this harness |

Table is confirmed partitioned/ordered by month+band+time (per the task brief and observed query latency behavior): every query in this spike bounds both `band` and `time`.

**Access note:** the endpoint returns `403 Forbidden` on `POST` from this environment; `GET` with `query=...` as a URL parameter (exactly as shown in the task brief's curl example) works and is what `wspr_client.py` uses.

## 2. Both-ends-active methodology (the central design decision)

A WSPR spot is positive proof a path worked at that instant. Absence of a spot is *not* proof the path was closed — it may just mean nobody transmitted or nobody was listening. To make "no spot" usable as a negative label, every observation in this dataset is restricted to **path-hours where both ends are independently demonstrated to have been active**, using only facts already implicit in the spot table itself (WSPR is a broadcast system — every listening receiver can hear every transmitting beacon on frequency, there is no pairing/handshake):

- **Transmitter active** in a given band+UTC-hour ⇔ it appears as `tx_sign` in that band+hour (i.e. it was heard by at least one receiver → its beacon was genuinely on the air).
- **Receiver active** in a given band+UTC-hour ⇔ it appears as `rx_sign` in that band+hour (i.e. it decoded at least one spot from someone → its receive chain and WSPRnet upload path were genuinely working).

One query per band+hour (`GROUP BY tx_sign, rx_sign`) yields, in a single pass: the set of active transmitters, the set of active receivers, and every pair that *did* exchange a spot (`worked = True`). Every `(active_tx, active_rx)` combination **not** in that observed-pairs set becomes a candidate `worked = False` observation — both ends were demonstrably alive that hour, yet this specific pair produced zero decodes.

### Limitations of this methodology (read before trusting it for anything beyond a spike)

1. **"Active this hour" is coarse.** A transmitter active only in the first 2 minutes of the hour and a receiver active only in the last 2 minutes of the same hour both count as "active" here but may never have actually overlapped in time. WSPR's synchronized 2-minute slot structure means many stations transmit on a large fraction of slots, but per-pair temporal overlap is not verified.
2. **"Heard once" is a low bar.** Many amateur stations don't run continuously (shared TX/RX radios, band-hopping schedules). This makes the "active" filter generous rather than strict — it is a lower bound on true activity, so some `worked=False` labels may still be over-charitable (attributing "the path was closed" to what was really "the receiver had already stopped listening").
3. **The candidate-negative universe is enormous relative to what's usable.** For a single busy band-hour, `active_tx × active_rx` reaches hundreds of thousands of combinations (see table in §3). We take a bounded random sample rather than the full cross join — both to stay a polite, fast local computation and because most of that universe (e.g. two stations on opposite sides of the planet during an hour the band simply isn't open between their regions at all) is uninformative filler. **This means the sampled dataset's worked/not-worked ratio is not the true base rate — see §3 for both numbers.**
4. **Station quality is unmodeled.** Antenna, power, and operator competence vary hugely between amateur stations. A "not worked" between a QRP station and a station with a mediocre antenna doesn't prove a well-equipped station couldn't have made that same path work — the harness measures "did this specific real pair connect," not "was the ionosphere physically capable of supporting *some* station on this path."
5. **Grid resolution.** Locators are self-reported (4 or 6 character Maidenhead) and truncated to 4 characters (`tx_grid`/`rx_grid`) for the output dataset; a small number of malformed/blank locators were dropped. Precise `tx_lat`/`tx_lon`/`rx_lat`/`rx_lon` are retained for anything (like solar-elevation midpoint calculations) that needs better-than-grid-square precision.

## 3. Dataset built

**Window:** 2 UTC calendar days (2026-07-20, 2026-07-21, ordinary midweek days chosen to avoid contest-weekend traffic skew) × 2 synoptic UTC hours per day (06:00, 18:00, giving both a daylight-dominated and darkness-dominated sample) × 2 bands (14 MHz / 20 m, 7 MHz / 40 m) = **8 band-hour queries**, each bounded by both `band` and `time` as required, each returning 20,000-31,000 grouped (not raw) rows. All 8 (plus a handful of exploratory schema/volume-check queries) are cached in `out/cache/` (15 files, ~24 MB total) and were fetched from wspr.live exactly once each.

Per band-hour accounting (`out/dataset_universe_log.csv`):

| band | date | hour | active tx | active rx | raw worked pairs | raw candidate universe (tx×rx) |
|---|---|---|---|---|---|---|
| 14 | 2026-07-20 | 06Z | 746 | 654 | 38,791 | 487,884 |
| 14 | 2026-07-20 | 18Z | 851 | 716 | 45,155 | 609,316 |
| 14 | 2026-07-21 | 06Z | 751 | 667 | 43,768 | 500,917 |
| 14 | 2026-07-21 | 18Z | 803 | 697 | 33,123 | 559,691 |
| 7 | 2026-07-20 | 06Z | 493 | 593 | 29,845 | 292,349 |
| 7 | 2026-07-20 | 18Z | 485 | 556 | 22,411 | 269,660 |
| 7 | 2026-07-21 | 06Z | 500 | 590 | 31,230 | 295,000 |
| 7 | 2026-07-21 | 18Z | 466 | 538 | 20,541 | 250,708 |

**True (unsampled) worked rate across the full both-ends-active candidate universe: 264,864 / 3,265,525 = 8.11%.** This is the honest base rate; it is *not* what's in the final CSV (see below) because the full universe is too large for a spike to carry around unsampled.

**Sampled dataset actually written to `out/dataset.csv`** (capped at 1,500 positives + up to 3,000 negatives per band-hour, fixed random seed `20260801` for reproducibility):

- **36,000 total observations**
- **12,000 worked (33.3%) / 24,000 not-worked (66.7%)**

This 33/67 split is a *sampling artifact* (negatives capped at 2× kept positives per band-hour), not the true propagation success rate — the true rate among all demonstrably-active pairs was 8.11%. Both numbers are reported here on purpose: the sampled ratio describes the dataset actually used below; the unsampled ratio describes the real world. A production version of this harness should either use the true unsampled ratio or explicitly re-weight/report it — see §6.

Dataset columns: `band, date, hour_utc, tx_sign, tx_grid, tx_lat, tx_lon, rx_sign, rx_grid, rx_lat, rx_lon, distance_km, n_spots, avg_snr, worked`.

## 4. Placeholder scorer

`placeholder_score.py` computes `score ∈ [0,100]` as `100 × (0.5·daylight_component + 0.5·distance_component)`:
- `daylight_component`: solar elevation at the great-circle path midpoint (NOAA solar-position approximation, hand-rolled, no external ephemeris dependency), pushed through a sigmoid; bands ≥14 MHz score higher in daylight, bands <14 MHz score higher at night — a real (if oversimplified) HF tendency.
- `distance_component`: a Gaussian bump centered on a band-scaled "sweet spot" distance (`band_mhz × 200` km).

Neither curve is fit to data. It is intentionally naive so its miscalibration is expected and uninteresting — the point is that the metrics below can *detect and quantify* that miscalibration.

## 5. Metrics from the placeholder run (`out/metrics_report.md`, `out/metrics_report.json`, `out/reliability_diagram.png`)

- **N = 36,000** (12,000 worked / 24,000 not-worked, 33.3% worked — the sampled dataset described in §3)
- **Brier score: 0.2155** (0 = perfect; 0.25 ≈ an uninformative 50/50 coin flip on this scale — the placeholder is only marginally better than a coin flip in squared-error terms)
- **Calibration error (ECE, weighted by bin population): 0.1269** — on average, the placeholder's stated probability is off by ~13 percentage points from what actually happened, worst single decile off by 34.5 points
- **AUC: 0.7117** — meaningfully better than chance (0.5) at ranking good conditions above bad ones, i.e. the underlying signal (distance + day/night) does carry real information, it's just not translated into calibrated probabilities
- **False-confidence rate (score ≥ 85, reported separately from every other metric): among 2,669 such predictions, observed success was only 54.7%** — a 30.3-point overconfidence gap. This is exactly the failure mode the brief calls out as most dangerous: this placeholder would tell someone a frequency "will work" (85+) when it actually only works about half the time.

Reliability diagram (`out/reliability_diagram.png`) shows the calibration curve sitting mostly below the diagonal at the high end (over-confidence) and shows real separation between the worked/not-worked score distributions in the companion histogram — visually confirming both the AUC (separation exists) and the calibration problem (the numbers attached to that separation are wrong) simultaneously.

## 6. What a real scoring engine must implement to be tested by this harness

1. **Emit a score in the same units** (0-100, and the harness's `p = score/100` convention) for a given `(band, tx position, rx position, UTC time)` tuple — i.e. it must run in Python (or emit a Python-callable equivalent, e.g. a WASM binding) so `metrics.run_full_report` can score `out/dataset.csv` and swap in for `placeholder_score.score_dataframe`.
2. **Be evaluable without look-ahead.** A real engine must only use inputs it would have had *before* the fact (e.g. forecast solar/geomagnetic indices, not the actual outcome), or this harness will produce falsely optimistic numbers. This spike's placeholder has no such risk (it only uses geometry/time), but a real physics- or ML-based scorer must be checked for this.
3. **Survive the same three metrics as a gate, not just a report**: Brier score and ECE trending down, AUC trending up, and — non-negotiably per CLAUDE.md's "never hide uncertainty" and "stale-and-labeled beats fresh-looking-and-wrong" principles — the **false-confidence rate at the 85+ threshold must be tracked and gated on its own**, separately from averaged metrics, exactly as implemented here. A regression in that number should block a release even if Brier/AUC improve.
4. **Scale to the full unsampled universe eventually.** This spike deliberately samples a bounded slice (§3) for politeness and speed. A pre-release validation run for a real engine should either run against the true 8%-positive unsampled distribution or be explicitly reweighted to it, since a scorer tuned/tested only against a 33%-positive sample could look better calibrated than it would against the true, much sparser, real-world class balance.
5. **Be tested across more bands/times/seasons** than this spike's 2-day, 2-band, 2-hour slice — this window was chosen to keep the harness fast and the wspr.live query load minimal for a proof-of-concept, not because it's an adequate validation set for a shipped scorer.

## 7. Housekeeping

- `venv/` (Python virtualenv: pandas, numpy, matplotlib, scikit-learn) and `out/cache/` (raw cached wspr.live query responses, ~24 MB) **should not be committed to git** — both are regenerable (`.gitignore` added accordingly). `out/dataset.csv`, `out/dataset_scored.csv`, `out/metrics_report.{md,json}`, and `out/reliability_diagram.png` are the actual spike deliverables and are small enough to keep.
- All queries were bounded by `band` and `time`, used a descriptive `User-Agent` (`HFKit-validation-spike/0.1`), were rate-limited (≥1.5 s between requests), and every query result is permanently cached and was fetched from wspr.live exactly once during this spike (verified: re-running any script produces `cache HIT` for every query).
- Total queries issued to wspr.live this session: **15** (8 band-hour dataset queries + 7 schema/volume exploration queries), all cached in `out/cache/`.

---

# Orchestrator addendum: base-rate correction is REQUIRED

Added after review. The harness works, but **the calibration numbers above
describe a distribution that does not exist**, and using them as-is would have
quietly defeated the purpose of the whole exercise.

`build_dataset.py` subsamples positives and negatives at different rates:

| | Universe | Dataset |
|---|---|---|
| candidate pairs | 3,265,525 | 36,000 |
| worked | 264,864 (**8.111%**) | 12,000 (**33.333%**) |
| sampling rate | — | positives 4.531%, negatives 0.800% |

Positives are therefore **oversampled 5.665×** relative to negatives. Brier
score, ECE, and the reliability diagram all assume the evaluation set is drawn
from the population of interest, so every probability-calibration figure in this
report is measuring the wrong distribution.

This matters more here than in a typical ML project, because HFKit's central
claim (`docs/07-scoring-spec.md`) is that the A-score *is* a calibrated
probability. Validating "70 means 70%" against a 33%-positive sample when reality
is 8% positive would **systematically certify an overconfident score as
well-calibrated** — the precise failure mode the spec says to weight most
heavily, and the dangerous one for emergency planning.

**AUC (0.712) is unaffected** — it is rank-based and insensitive to class
balance — so that headline number stands as reported.

### The correction, applied

`base_rate_correction.py` converts sampled probabilities to population
probabilities via the odds ratio (`odds_true = odds_sample / 5.665`):

| Sampled | True population |
|---|---|
| 0.300 | 0.070 |
| 0.500 | 0.150 |
| 0.700 | 0.292 |
| 0.850 | **0.500** |
| 0.950 | 0.770 |

**The false-confidence metric is far worse than reported.** Among the 2,669
predictions scoring ≥85, the sample shows 54.7% success; corrected to the real
distribution it is **17.6%**. That is a ~67-point overconfidence gap, not the
30-point gap the uncorrected run suggested.

(The placeholder scorer is *meant* to be bad, so this is not alarming in itself —
what matters is that the harness now measures the gap correctly.)

### Required changes before the real engine is evaluated

1. **Preferred:** stop distorting the sample — draw negatives at the same rate as
   positives so the evaluation set carries the true base rate. Costs more rows;
   removes the whole problem.
2. **Otherwise:** compute Brier/ECE/reliability with the importance weights from
   `population_weights()` (pos=0.2433, neg=1.3783, mean-normalised), and report
   every probability corrected to the population.
3. Either way, `metrics.py` must **record the base rate alongside every metric**
   so no future run can silently repeat this. A calibration number without its
   base rate is not interpretable.

This is exactly the class of error the golden-test/sanity-gate discipline in
`docs/12-ai-maintainability.md` exists to catch: the pipeline ran clean and
produced confident, plausible numbers that were quietly measuring the wrong thing.
