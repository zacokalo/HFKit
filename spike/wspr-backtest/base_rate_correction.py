"""Base-rate correction for backtest metrics.

WHY THIS EXISTS
---------------
`build_dataset.py` subsamples the both-ends-active universe unevenly: it keeps a
much larger fraction of the *worked* pairs than of the *not-worked* pairs, to get
a workable dataset size. Measured on the first run:

    universe          3,265,525 candidate pairs
      worked            264,864   ->  8.111%  TRUE base rate
    dataset            36,000 rows
      worked             12,000   -> 33.333%  SAMPLE base rate
    sampling rate     positives 4.531% / negatives 0.800%
    oversampling      5.665x

Any probability-calibration metric computed directly on that sample is therefore
measuring the wrong distribution. Brier score, ECE, and the reliability diagram
all assume the evaluation set is drawn from the population you care about.

This matters more here than in a typical ML project, because HFKit's central
claim (docs/07-scoring-spec.md) is that the A-score IS a calibrated probability:
"a score of 70 means it works about 70% of the time." Validating that against a
33%-positive sample when reality is 8% positive would systematically certify an
overconfident score as well-calibrated -- the exact failure mode the spec says to
weight most heavily, and the dangerous one for emergency planning.

AUC is unaffected (it is rank-based and insensitive to class balance), so it is
the one headline number from the uncorrected run that stands as reported.

TWO CORRECTIONS PROVIDED
------------------------
1. `correct_probability` -- converts a probability learned on the sampled
   distribution back to the population, via the odds ratio. Use when interpreting
   an individual score.
2. `population_weights` -- importance weights that undo the subsampling, so
   Brier/ECE/reliability can be computed as population estimates directly. Use
   when evaluating a model. This is the one the real harness should adopt.

The cleanest long-term fix is to stop distorting the sample at all: draw negatives
at the same rate as positives so the evaluation set carries the true base rate.
Correction is the fallback when that is too expensive.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass


@dataclass(frozen=True)
class SamplingProfile:
    """How the dataset's class balance was distorted relative to the population."""

    universe_pairs: int
    universe_worked: int
    sampled_worked: int
    sampled_not_worked: int

    @property
    def universe_not_worked(self) -> int:
        return self.universe_pairs - self.universe_worked

    @property
    def true_base_rate(self) -> float:
        return self.universe_worked / self.universe_pairs

    @property
    def sample_base_rate(self) -> float:
        return self.sampled_worked / (self.sampled_worked + self.sampled_not_worked)

    @property
    def positive_sampling_rate(self) -> float:
        return self.sampled_worked / self.universe_worked

    @property
    def negative_sampling_rate(self) -> float:
        return self.sampled_not_worked / self.universe_not_worked

    @property
    def oversampling_factor(self) -> float:
        """How many times more likely a positive was to be kept than a negative."""
        return self.positive_sampling_rate / self.negative_sampling_rate


def load_profile(universe_log_path: str) -> SamplingProfile:
    """Read the per-band-hour universe log emitted by build_dataset.py."""
    rows = list(csv.DictReader(open(universe_log_path)))
    return SamplingProfile(
        universe_pairs=sum(int(r["n_cross_candidates_raw"]) for r in rows),
        universe_worked=sum(int(r["n_worked_raw"]) for r in rows),
        sampled_worked=sum(int(r["n_worked_kept"]) for r in rows),
        sampled_not_worked=sum(int(r["n_not_worked_kept"]) for r in rows),
    )


def correct_probability(p_sample: float, profile: SamplingProfile) -> float:
    """Map a probability from the sampled distribution back to the population.

    Subsampling negatives by a factor k multiplies the odds by k, so dividing the
    odds by k inverts it:

        odds_true = odds_sample / k,  where k = oversampling_factor

    >>> # with k = 5.665, an apparent 54.7% is really ~17.6%
    """
    k = profile.oversampling_factor
    if p_sample <= 0.0:
        return 0.0
    if p_sample >= 1.0:
        return 1.0
    odds_sample = p_sample / (1.0 - p_sample)
    odds_true = odds_sample / k
    return odds_true / (1.0 + odds_true)


def population_weights(profile: SamplingProfile) -> tuple[float, float]:
    """Importance weights (positive, negative) that undo the subsampling.

    Each retained row stands in for 1/sampling_rate rows of the population.
    Normalised so the mean weight is 1.0, which keeps weighted Brier/ECE on the
    same scale as their unweighted counterparts.
    """
    w_pos = 1.0 / profile.positive_sampling_rate
    w_neg = 1.0 / profile.negative_sampling_rate
    n_pos, n_neg = profile.sampled_worked, profile.sampled_not_worked
    mean_w = (w_pos * n_pos + w_neg * n_neg) / (n_pos + n_neg)
    return w_pos / mean_w, w_neg / mean_w


if __name__ == "__main__":
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    profile = load_profile(os.path.join(here, "out", "dataset_universe_log.csv"))

    print("Sampling profile")
    print(f"  universe pairs        {profile.universe_pairs:>12,}")
    print(f"  universe worked       {profile.universe_worked:>12,}")
    print(f"  TRUE base rate        {profile.true_base_rate:>11.3%}")
    print(f"  SAMPLE base rate      {profile.sample_base_rate:>11.3%}")
    print(f"  oversampling factor   {profile.oversampling_factor:>11.3f}x")

    w_pos, w_neg = population_weights(profile)
    print(f"  importance weights    pos={w_pos:.4f}  neg={w_neg:.4f}")

    print("\nWhat a sampled probability really means in the population")
    for p in (0.30, 0.50, 0.547, 0.70, 0.85, 0.95):
        print(f"  sampled {p:6.3f}  ->  true {correct_probability(p, profile):6.3f}")

    scored = os.path.join(here, "out", "dataset_scored.csv")
    if os.path.exists(scored):
        rows = list(csv.DictReader(open(scored)))
        col = next(
            (c for c in ("score", "probability", "p", "placeholder_score")
             if c in rows[0]), None,
        )
        if col:
            hi = [r for r in rows if float(r[col]) >= 85.0]
            if hi:
                obs = sum(str(r["worked"]).lower() == "true" for r in hi) / len(hi)
                print(f"\nFalse-confidence check (score >= 85, n={len(hi)})")
                print(f"  observed in sample       {obs:.3%}")
                print(f"  corrected to population  "
                      f"{correct_probability(obs, profile):.3%}")
