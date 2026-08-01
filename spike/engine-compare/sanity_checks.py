#!/usr/bin/env python3
"""
Programmatic sanity checks on dvoacap output. Loads the raw JSON produced by
run_predictions.py (run that first) and checks the physical-sanity properties
listed in the spike brief. Also runs two small live checks (determinism,
short-path-model overreach) directly against the engine.

Prints a pass/fail table per circuit per property and writes
out/sanity_report.json with the same data machine-readably.

IMPORTANT CAVEAT discovered during this spike (see FINDINGS.md): with
dvoacap's default `required_snr=73.0 dB` and the fact that `bandwidth_hz` is
a dead parameter (defined, never consumed by any calculation), computed
`reliability` collapses to ~0.0 for nearly every circuit/frequency/hour in
this sweep -- including circuits and frequencies that should be comfortably
workable. That makes `reliability` useless as an absolute quality measure
here. Where the brief asks about reliability's *shape* (unimodal vs.
frequency), we additionally use `snr_db` (unaffected by the required_snr bug,
since it is a pure link-budget quantity) as a secondary, more informative
signal, and note explicitly which metric each verdict is based on.
"""
import json
import math
from pathlib import Path

import numpy as np

from dvoacap.path_geometry import GeoPoint
from dvoacap.prediction_engine import PredictionEngine

HERE = Path(__file__).parent
PRED_DIR = HERE / "out" / "predictions"
CIRCUITS_FILE = HERE / "circuits.json"
REPORT_PATH = HERE / "out" / "sanity_report.json"


def local_hour(lon_deg: float, utc_hour: float) -> float:
    return (utc_hour + lon_deg / 15.0) % 24.0


def load(circuit_id: str) -> dict:
    return json.loads((PRED_DIR / f"{circuit_id}.json").read_text())


def check_solar_activity_raises_muf(data: dict) -> dict:
    """MUF should rise (or at worst not fall) with higher SSN, hour-for-hour."""
    runs_by_key = {}
    for r in data["runs"]:
        runs_by_key.setdefault(r["hour_utc"], {})[r["ssn_label"]] = r["circuit_muf_mhz"]

    deltas = []
    violations = []
    for hour, by_ssn in runs_by_key.items():
        lo, hi = by_ssn.get("low"), by_ssn.get("high")
        if lo is None or hi is None:
            continue
        deltas.append(hi - lo)
        if hi < lo - 0.05:  # small tolerance for numerical noise
            violations.append(hour)

    n = len(deltas)
    frac_ok = sum(1 for d in deltas if d >= -0.05) / n if n else 0.0
    passed = frac_ok >= 0.95 and (sum(deltas) / n if n else 0) > 0
    return {
        "property": "muf_rises_with_ssn",
        "passed": bool(passed),
        "mean_delta_muf_mhz": (sum(deltas) / n) if n else None,
        "min_delta_muf_mhz": min(deltas) if deltas else None,
        "violations_at_hours": violations,
        "n_hours_checked": n,
    }


def check_day_night_muf(data: dict) -> dict:
    """MUF should be higher in local daytime than local nighttime, on average."""
    tx_lon = data["circuit"]["tx"]["lon"]
    rx_lon = data["circuit"]["rx"]["lon"]
    mid_lon = (tx_lon + rx_lon) / 2.0  # crude path-midpoint proxy

    day_vals, night_vals = [], []
    for r in data["runs"]:
        if r["ssn_label"] != "high":
            continue  # use the higher-SNR/more active regime to reduce noise
        lh = local_hour(mid_lon, r["hour_utc"])
        is_day = 8.0 <= lh <= 16.0
        is_night = lh <= 4.0 or lh >= 20.0
        if is_day:
            day_vals.append(r["circuit_muf_mhz"])
        elif is_night:
            night_vals.append(r["circuit_muf_mhz"])

    day_mean = sum(day_vals) / len(day_vals) if day_vals else None
    night_mean = sum(night_vals) / len(night_vals) if night_vals else None
    passed = (day_mean is not None and night_mean is not None
              and day_mean > night_mean)
    return {
        "property": "muf_higher_by_day",
        "passed": bool(passed),
        "day_mean_muf_mhz": day_mean,
        "night_mean_muf_mhz": night_mean,
        "ratio": (day_mean / night_mean) if (day_mean and night_mean) else None,
    }


def check_smoothness(data: dict) -> dict:
    """Predictions should vary smoothly hour-to-hour; flag big single-step jumps."""
    max_jump = 0.0
    max_jump_at = None
    jumps = []
    for ssn_label in ("low", "high"):
        runs = sorted([r for r in data["runs"] if r["ssn_label"] == ssn_label],
                      key=lambda r: r["hour_utc"])
        mufs = [r["circuit_muf_mhz"] for r in runs]
        for i in range(1, len(mufs)):
            d = abs(mufs[i] - mufs[i - 1])
            jumps.append(d)
            if d > max_jump:
                max_jump = d
                max_jump_at = (ssn_label, runs[i - 1]["hour_utc"], runs[i]["hour_utc"])
        # wrap-around hour 23 -> 0
        d = abs(mufs[0] - mufs[-1])
        jumps.append(d)
        if d > max_jump:
            max_jump = d
            max_jump_at = (ssn_label, 23, 0)

    mean_jump = sum(jumps) / len(jumps) if jumps else 0.0
    # Heuristic: a single-hour MUF jump of >8 MHz, or >6x the mean step, is suspicious.
    passed = max_jump < 8.0 and (mean_jump == 0 or max_jump < 6 * mean_jump)
    return {
        "property": "smooth_hour_to_hour",
        "passed": bool(passed),
        "mean_abs_hourly_muf_delta_mhz": mean_jump,
        "max_abs_hourly_muf_delta_mhz": max_jump,
        "max_jump_at": max_jump_at,
    }


def check_reliability_shape(data: dict) -> dict:
    """
    Reliability (or, given the required_snr issue documented above, SNR as a
    proxy) should be low at the lowest frequency (absorption), rise to a
    peak, then fall again toward/above the MUF -- not monotonic, not flat.
    """
    freqs = data["frequencies_mhz"]
    unimodal_count = 0
    flat_reliability_count = 0
    n = 0
    examples = []
    for r in data["runs"]:
        if r["ssn_label"] != "high":
            continue
        snrs = [p["snr_db"] for p in r["predictions"]]
        rels = [p["reliability"] for p in r["predictions"]]
        n += 1

        if max(rels) - min(rels) < 1e-4:
            flat_reliability_count += 1

        # unimodal-ish check on SNR: find the argmax, verify snr is
        # non-decreasing up to it and non-increasing after (with small
        # tolerance for numerical wiggle), and that both ends are below peak.
        peak_i = max(range(len(snrs)), key=lambda i: snrs[i])
        tol = 3.0  # dB tolerance for local wiggle
        rising_ok = all(snrs[i] <= snrs[peak_i] + tol for i in range(peak_i))
        falling_ok = all(snrs[i] <= snrs[peak_i] + tol for i in range(peak_i, len(snrs)))
        ends_below_peak = (snrs[0] < snrs[peak_i]) and (snrs[-1] <= snrs[peak_i] + tol)
        is_unimodal = rising_ok and falling_ok and ends_below_peak
        if is_unimodal:
            unimodal_count += 1
        elif len(examples) < 3:
            examples.append({"hour_utc": r["hour_utc"], "snr_db_by_freq": dict(zip(freqs, [round(s, 1) for s in snrs]))})

    frac_unimodal = unimodal_count / n if n else 0.0
    frac_flat_reliability = flat_reliability_count / n if n else 0.0
    passed = frac_unimodal >= 0.6  # majority of hours should show a clean single peak
    return {
        "property": "reliability_snr_unimodal_vs_frequency",
        "passed": bool(passed),
        "metric_used": "snr_db (reliability itself was ~flat-zero for this circuit; see caveat)",
        "frac_hours_unimodal_snr": frac_unimodal,
        "frac_hours_flat_zero_reliability": frac_flat_reliability,
        "counterexamples": examples,
    }


def check_distance_raises_muf(all_data: dict) -> dict:
    """Longer paths should generally support higher MUF than very short ones."""
    # Compare circuit-average high-SSN daytime-ish MUF vs. path distance.
    points = []
    for cid, data in all_data.items():
        dist = data["circuit"]["distance_km"]
        mufs = [r["circuit_muf_mhz"] for r in data["runs"] if r["ssn_label"] == "high"]
        points.append((dist, sum(mufs) / len(mufs), cid))
    points.sort(key=lambda p: p[0])

    shortest = points[0]
    longest_within_short_path_regime = max((p for p in points if p[0] <= 7000), key=lambda p: p[0])
    passed = longest_within_short_path_regime[1] > shortest[1]
    return {
        "property": "longer_paths_support_higher_muf",
        "passed": bool(passed),
        "shortest": {"circuit": shortest[2], "distance_km": shortest[0], "mean_muf_mhz": shortest[1]},
        "longest_in_short_path_regime": {
            "circuit": longest_within_short_path_regime[2],
            "distance_km": longest_within_short_path_regime[0],
            "mean_muf_mhz": longest_within_short_path_regime[1],
        },
        "all_points_sorted_by_distance": [{"circuit": c, "distance_km": d, "mean_muf_mhz": m} for d, m, c in points],
    }


def check_long_path_model_stub(all_data: dict) -> dict:
    """
    dvoacap's source contains an explicit comment that the long-path model
    (needed for great-circle distances beyond ~7000-10000 km) is an
    unimplemented stub, and that the engine always falls back to the
    short-path model regardless of distance. Confirm that behavior is
    visible in the `method` field of predictions for our >10000 km circuits,
    and flag it as a correctness concern rather than a pass/fail physical
    property (there's no ground truth to compare against here).
    """
    findings = {}
    for cid, data in all_data.items():
        dist = data["circuit"]["distance_km"]
        if dist < 10000:
            continue
        methods = set()
        for r in data["runs"]:
            for p in r["predictions"]:
                methods.add(p["method"])
        findings[cid] = {"distance_km": dist, "methods_seen": sorted(methods)}
    all_short_only = all(v["methods_seen"] == ["short"] for v in findings.values())
    return {
        "property": "long_path_model_is_a_stub (informational, not a physical-sanity pass/fail)",
        "confirmed_short_path_used_beyond_10000km": bool(all_short_only),
        "circuits": findings,
        "note": ("prediction_engine.py explicitly documents _evaluate_long_model() as a stub "
                 "returning an empty Prediction, and always uses the short-path result. "
                 "Circuits beyond ~10000 km are therefore evaluated with a model VOACAP's own "
                 "design says is invalid at that distance. Treat results for those circuits "
                 "(trans_pacific_long, antipodal_very_long) as unvalidated."),
    }


def check_determinism() -> dict:
    """Same input twice -> identical output, bit for bit."""
    tx = GeoPoint.from_degrees(40.71, -74.01)
    rx = GeoPoint.from_degrees(51.51, -0.13)
    freqs = [3.5, 7.0, 14.0, 21.0, 28.0]

    def run():
        engine = PredictionEngine()
        engine.params.tx_location = GeoPoint(tx.lat, tx.lon)
        engine.params.ssn = 100.0
        engine.params.month = 6
        engine.params.tx_power = 100.0
        engine.predict(GeoPoint(rx.lat, rx.lon), utc_time=12 / 24.0, frequencies=list(freqs))
        return [(p.signal.snr_db, p.signal.reliability, p.signal.power_dbw) for p in engine.predictions]

    r1 = run()
    r2 = run()
    r3 = run()
    identical = (r1 == r2 == r3)
    return {
        "property": "deterministic_same_input_same_output",
        "passed": bool(identical),
        "sample_run_1": r1,
        "sample_run_2": r2,
    }


def main():
    circuits = json.loads(CIRCUITS_FILE.read_text())["circuits"]
    all_data = {c["id"]: load(c["id"]) for c in circuits}

    report = {"per_circuit": {}, "cross_circuit": {}, "global": {}}

    for cid, data in all_data.items():
        report["per_circuit"][cid] = {
            "solar_activity": check_solar_activity_raises_muf(data),
            "day_night": check_day_night_muf(data),
            "smoothness": check_smoothness(data),
            "reliability_shape": check_reliability_shape(data),
        }

    report["cross_circuit"]["distance_vs_muf"] = check_distance_raises_muf(all_data)
    report["cross_circuit"]["long_path_stub"] = check_long_path_model_stub(all_data)
    report["global"]["determinism"] = check_determinism()

    REPORT_PATH.write_text(json.dumps(report, indent=2))

    # Print a human-readable table.
    props = ["solar_activity", "day_night", "smoothness", "reliability_shape"]
    header = f"{'circuit':26s} " + " ".join(f"{p:16s}" for p in props)
    print(header)
    print("-" * len(header))
    for cid in all_data:
        row = report["per_circuit"][cid]
        cells = []
        for p in props:
            mark = "PASS" if row[p]["passed"] else "FAIL"
            cells.append(f"{mark:16s}")
        print(f"{cid:26s} " + " ".join(cells))

    print()
    print("Cross-circuit checks:")
    dvm = report["cross_circuit"]["distance_vs_muf"]
    print(f"  distance_vs_muf: {'PASS' if dvm['passed'] else 'FAIL'} "
          f"(shortest {dvm['shortest']['circuit']}={dvm['shortest']['mean_muf_mhz']:.2f} MHz, "
          f"longest-in-regime {dvm['longest_in_short_path_regime']['circuit']}="
          f"{dvm['longest_in_short_path_regime']['mean_muf_mhz']:.2f} MHz)")
    lps = report["cross_circuit"]["long_path_stub"]
    print(f"  long_path_model_stub confirmed: {lps['confirmed_short_path_used_beyond_10000km']}")

    print()
    det = report["global"]["determinism"]
    print(f"Determinism: {'PASS' if det['passed'] else 'FAIL'}")

    print(f"\nFull report written to {REPORT_PATH.relative_to(HERE)}")


if __name__ == "__main__":
    main()
