"""
Calibration / validation metrics for an HFKit A-score, computed against a
labelled WSPR dataset produced by build_dataset.py.

This module is the actual deliverable of the spike: it answers "can we
measure whether a propagation score is well-calibrated using real historical
radio data?" It is scorer-agnostic -- it consumes a `score` column in
[0, 100] and a `worked` boolean column and produces:

  - a reliability diagram (PNG): predicted probability (score/100) vs.
    observed success rate, binned by score decile
  - Brier score (mean squared error between predicted probability and
    outcome; lower is better, 0 is perfect)
  - calibration error: mean absolute deviation between predicted and
    observed rate across bins, weighted by bin population (a.k.a. Expected
    Calibration Error / ECE)
  - AUC: does the score rank successful paths above failed ones,
    independent of whether the absolute numbers are calibrated
  - false-confidence rate: observed success rate among score>=85
    predictions, reported on its own (never averaged into the other
    metrics) because for emergency-comms planning, a confident wrong answer
    is the worst failure mode this project can produce

Run standalone: `python metrics.py` scores out/dataset.csv with the
placeholder scorer and writes out/reliability_diagram.png and
out/metrics_report.md / out/metrics_report.json.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import roc_auc_score

OUT_DIR = Path(__file__).parent / "out"

# Colors from the validated reference palette (references/palette.md),
# light-mode values -- this is a static PNG so we commit to one mode.
COLOR_CALIBRATION_LINE = "#2a78d6"   # categorical slot 1 (blue)
COLOR_DIAGONAL = "#8a8a86"           # neutral gray, recessive reference line
COLOR_WORKED = "#008300"             # categorical slot 6 (green) -- status: success
COLOR_NOT_WORKED = "#e34948"         # categorical slot 8 (red) -- status: failure
COLOR_TEXT = "#0b0b0b"
COLOR_TEXT_SECONDARY = "#52514e"
COLOR_GRID = "#e3e2dc"

FALSE_CONFIDENCE_THRESHOLD = 85.0  # score >= this counts as "confident"

HIGH_CONF_MIN_N = 30  # below this sample size, flag the false-confidence stat as low-n


def reliability_table(y_true: np.ndarray, score_0_100: np.ndarray, n_bins: int = 10) -> pd.DataFrame:
    """
    Bin predictions by score DECILE (equal-count bins, i.e. rank-based, as
    specified in the task brief) and compute, per bin: mean predicted
    probability, observed success rate, and bin population.
    """
    df = pd.DataFrame({"y": y_true.astype(float), "p": score_0_100 / 100.0, "score": score_0_100})
    # rank-based decile assignment; duplicates='drop' handles the case where
    # a score value is repeated enough to make some bin edges coincide
    try:
        df["bin"] = pd.qcut(df["score"], q=n_bins, duplicates="drop")
    except ValueError:
        # fewer distinct values than bins -- fall back to as many bins as
        # there are distinct score values
        n_unique = df["score"].nunique()
        df["bin"] = pd.qcut(df["score"], q=max(n_unique, 1), duplicates="drop")

    grouped = df.groupby("bin", observed=True).agg(
        predicted_prob=("p", "mean"),
        observed_rate=("y", "mean"),
        n=("y", "size"),
        score_min=("score", "min"),
        score_max=("score", "max"),
    ).reset_index(drop=True)
    return grouped


def brier_score(y_true: np.ndarray, score_0_100: np.ndarray) -> float:
    p = score_0_100 / 100.0
    return float(np.mean((p - y_true) ** 2))


def calibration_error(bin_table: pd.DataFrame) -> dict:
    """
    Expected Calibration Error (ECE): mean absolute deviation between
    predicted probability and observed rate across bins, weighted by bin
    population. Also reports the unweighted mean (simple average across
    bins, ignoring population) and the max (worst single bin) for
    transparency.
    """
    abs_dev = (bin_table["predicted_prob"] - bin_table["observed_rate"]).abs()
    n = bin_table["n"]
    weighted = float((abs_dev * n).sum() / n.sum())
    unweighted = float(abs_dev.mean())
    worst = float(abs_dev.max())
    return {"ece_weighted": weighted, "mean_abs_dev_unweighted": unweighted, "max_bin_abs_dev": worst}


def auc_score(y_true: np.ndarray, score_0_100: np.ndarray) -> float | None:
    if len(np.unique(y_true)) < 2:
        return None
    return float(roc_auc_score(y_true, score_0_100))


def false_confidence_rate(y_true: np.ndarray, score_0_100: np.ndarray, threshold: float = FALSE_CONFIDENCE_THRESHOLD) -> dict:
    """
    Reported SEPARATELY from every other metric on purpose: the observed
    success rate among predictions the scorer called >= `threshold`. A
    well-behaved score should have this close to threshold/100 (e.g. >=85
    should work >=~85% of the time). A low value here means the score is
    telling people a dead frequency will work -- the single worst failure
    mode for an emergency-comms planning tool.
    """
    mask = score_0_100 >= threshold
    n = int(mask.sum())
    if n == 0:
        return {"threshold": threshold, "n": 0, "observed_success_rate": None, "low_sample_warning": True}
    rate = float(y_true[mask].mean())
    return {
        "threshold": threshold,
        "n": n,
        "observed_success_rate": rate,
        "low_sample_warning": n < HIGH_CONF_MIN_N,
    }


def plot_reliability_diagram(bin_table: pd.DataFrame, out_path: Path, title: str) -> None:
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(11, 5), gridspec_kw={"width_ratios": [1.1, 1]}
    )
    fig.patch.set_facecolor("#fcfcfb")

    # --- Panel 1: reliability diagram ---
    ax1.set_facecolor("#fcfcfb")
    ax1.plot([0, 1], [0, 1], linestyle="--", linewidth=1.5, color=COLOR_DIAGONAL, label="Perfect calibration", zorder=1)
    sizes = 60 + 260 * (bin_table["n"] / bin_table["n"].max())
    ax1.scatter(
        bin_table["predicted_prob"], bin_table["observed_rate"],
        s=sizes, color=COLOR_CALIBRATION_LINE, edgecolor="white", linewidth=1.2,
        zorder=3, label="Score deciles (size = bin count)",
    )
    ax1.plot(bin_table["predicted_prob"], bin_table["observed_rate"], color=COLOR_CALIBRATION_LINE, linewidth=1.5, alpha=0.6, zorder=2)

    ax1.set_xlim(-0.02, 1.02)
    ax1.set_ylim(-0.02, 1.02)
    ax1.set_xlabel("Predicted probability (score / 100)", color=COLOR_TEXT)
    ax1.set_ylabel("Observed success rate (fraction worked)", color=COLOR_TEXT)
    ax1.set_title("Reliability diagram", color=COLOR_TEXT, fontsize=12, fontweight="bold", loc="left")
    ax1.grid(True, color=COLOR_GRID, linewidth=0.8)
    ax1.spines[["top", "right"]].set_visible(False)
    ax1.spines[["left", "bottom"]].set_color(COLOR_TEXT_SECONDARY)
    ax1.tick_params(colors=COLOR_TEXT_SECONDARY)
    ax1.legend(frameon=False, loc="upper left", fontsize=9, labelcolor=COLOR_TEXT_SECONDARY)

    # --- Panel 2: score distribution by outcome ---
    ax2.set_facecolor("#fcfcfb")
    bins = np.linspace(0, 100, 21)
    worked_scores = bin_table.attrs.get("worked_scores")
    not_worked_scores = bin_table.attrs.get("not_worked_scores")
    ax2.hist(not_worked_scores, bins=bins, alpha=0.65, color=COLOR_NOT_WORKED, label=f"Not worked (n={len(not_worked_scores)})", density=True)
    ax2.hist(worked_scores, bins=bins, alpha=0.65, color=COLOR_WORKED, label=f"Worked (n={len(worked_scores)})", density=True)
    ax2.set_xlabel("Score (0-100)", color=COLOR_TEXT)
    ax2.set_ylabel("Density", color=COLOR_TEXT)
    ax2.set_title("Score distribution by outcome", color=COLOR_TEXT, fontsize=12, fontweight="bold", loc="left")
    ax2.grid(True, color=COLOR_GRID, linewidth=0.8, axis="y")
    ax2.spines[["top", "right"]].set_visible(False)
    ax2.spines[["left", "bottom"]].set_color(COLOR_TEXT_SECONDARY)
    ax2.tick_params(colors=COLOR_TEXT_SECONDARY)
    ax2.legend(frameon=False, loc="upper right", fontsize=9, labelcolor=COLOR_TEXT_SECONDARY)

    fig.suptitle(title, color=COLOR_TEXT, fontsize=13, fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(out_path, dpi=150, facecolor=fig.get_facecolor())
    plt.close(fig)


def run_full_report(dataset_path: Path, score_col: str = "score", label: str = "placeholder scorer") -> dict:
    df = pd.read_csv(dataset_path)
    if score_col not in df.columns:
        raise ValueError(f"dataset has no '{score_col}' column -- score it first")

    y_true = df["worked"].astype(bool).to_numpy()
    score = df[score_col].to_numpy(dtype=float)

    bin_table = reliability_table(y_true, score, n_bins=10)
    bin_table.attrs["worked_scores"] = score[y_true]
    bin_table.attrs["not_worked_scores"] = score[~y_true]

    brier = brier_score(y_true, score)
    cal_err = calibration_error(bin_table)
    auc = auc_score(y_true, score)
    false_conf = false_confidence_rate(y_true, score)

    png_path = OUT_DIR / "reliability_diagram.png"
    plot_reliability_diagram(bin_table, png_path, title=f"HFKit validation spike -- {label} vs. WSPR ground truth")

    report = {
        "label": label,
        "dataset_path": str(dataset_path),
        "n_observations": int(len(df)),
        "n_worked": int(y_true.sum()),
        "n_not_worked": int((~y_true).sum()),
        "class_balance_worked_pct": float(y_true.mean() * 100),
        "brier_score": brier,
        "calibration_error": cal_err,
        "auc": auc,
        "false_confidence": false_conf,
        "reliability_bins": bin_table.drop(columns=[]).assign(
            score_min=bin_table["score_min"].astype(float),
            score_max=bin_table["score_max"].astype(float),
        )[["score_min", "score_max", "predicted_prob", "observed_rate", "n"]].to_dict(orient="records"),
        "reliability_diagram_png": str(png_path),
    }

    json_path = OUT_DIR / "metrics_report.json"
    json_path.write_text(json.dumps(report, indent=2))

    md_path = OUT_DIR / "metrics_report.md"
    md_path.write_text(_render_markdown(report))

    return report


def _render_markdown(report: dict) -> str:
    lines = []
    lines.append(f"# Metrics report: {report['label']}\n")
    lines.append(f"Dataset: `{report['dataset_path']}`  ")
    lines.append(f"N = {report['n_observations']}  "
                 f"(worked={report['n_worked']}, not_worked={report['n_not_worked']}, "
                 f"{report['class_balance_worked_pct']:.1f}% worked)\n")

    lines.append("## Headline metrics\n")
    lines.append(f"- **Brier score**: {report['brier_score']:.4f}  (0 = perfect, 0.25 = uninformative coin-flip-at-50%, 1 = perfectly wrong)")
    ce = report["calibration_error"]
    lines.append(f"- **Calibration error (ECE, weighted)**: {ce['ece_weighted']:.4f}  "
                 f"(unweighted mean: {ce['mean_abs_dev_unweighted']:.4f}, worst single bin: {ce['max_bin_abs_dev']:.4f})")
    auc = report["auc"]
    lines.append(f"- **AUC**: {auc:.4f}" if auc is not None else "- **AUC**: N/A (only one class present)")

    fc = report["false_confidence"]
    lines.append("\n## False-confidence metric (reported separately -- see rationale in module docstring)\n")
    if fc["observed_success_rate"] is None:
        lines.append(f"- No predictions scored >= {fc['threshold']:.0f}. Cannot compute.")
    else:
        warn = " **(LOW SAMPLE SIZE -- treat with caution)**" if fc["low_sample_warning"] else ""
        lines.append(f"- Among {fc['n']} predictions scoring >= {fc['threshold']:.0f}, "
                     f"the observed success rate was **{fc['observed_success_rate']*100:.1f}%**.{warn}")
        gap = fc['threshold'] - fc['observed_success_rate'] * 100
        lines.append(f"- Gap vs. the score's own claim: {gap:.1f} percentage points "
                     f"({'over' if gap > 0 else 'under'}-confident).")

    lines.append("\n## Reliability table (by score decile)\n")
    lines.append("| score range | predicted prob | observed rate | n |")
    lines.append("|---|---|---|---|")
    for row in report["reliability_bins"]:
        lines.append(
            f"| {row['score_min']:.1f}-{row['score_max']:.1f} | {row['predicted_prob']:.3f} | "
            f"{row['observed_rate']:.3f} | {row['n']} |"
        )

    lines.append(f"\nReliability diagram: `{report['reliability_diagram_png']}`\n")
    return "\n".join(lines)


if __name__ == "__main__":
    import placeholder_score

    dataset_path = OUT_DIR / "dataset.csv"
    df = pd.read_csv(dataset_path)
    df["score"] = placeholder_score.score_dataframe(df)
    scored_path = OUT_DIR / "dataset_scored.csv"
    df.to_csv(scored_path, index=False)

    report = run_full_report(scored_path, label="placeholder scorer (frequency + distance + daylight)")
    print(json.dumps({k: v for k, v in report.items() if k != "reliability_bins"}, indent=2))
