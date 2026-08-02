# Metrics report: placeholder scorer (frequency + distance + daylight)

Dataset: `/home/user/HFKit/spike/wspr-backtest/out/dataset_scored.csv`  
N = 36000  (worked=12000, not_worked=24000, 33.3% worked)

## Headline metrics

- **Brier score**: 0.2155  (0 = perfect, 0.25 = uninformative coin-flip-at-50%, 1 = perfectly wrong)
- **Calibration error (ECE, weighted)**: 0.1269  (unweighted mean: 0.1269, worst single bin: 0.3451)
- **AUC**: 0.7117

## False-confidence metric (reported separately -- see rationale in module docstring)

- Among 2669 predictions scoring >= 85, the observed success rate was **54.7%**.
- Gap vs. the score's own claim: 30.3 percentage points (over-confident).

## Reliability table (by score decile)

| score range | predicted prob | observed rate | n |
|---|---|---|---|
| 0.0-1.4 | 0.006 | 0.026 | 3600 |
| 1.4-16.8 | 0.074 | 0.086 | 3600 |
| 16.8-30.3 | 0.244 | 0.349 | 3600 |
| 30.3-38.9 | 0.346 | 0.327 | 3600 |
| 38.9-47.0 | 0.430 | 0.334 | 3600 |
| 47.0-49.9 | 0.490 | 0.191 | 3600 |
| 49.9-54.7 | 0.516 | 0.301 | 3600 |
| 54.7-65.6 | 0.601 | 0.519 | 3600 |
| 65.6-79.7 | 0.721 | 0.644 | 3600 |
| 79.7-100.0 | 0.903 | 0.558 | 3600 |

Reliability diagram: `/home/user/HFKit/spike/wspr-backtest/out/reliability_diagram.png`
