#!/usr/bin/env python3
"""
Benchmark dvoacap: single point-to-point prediction speed, a coverage-grid
extrapolation (measured on a subset then scaled), and single-core vs.
multiprocess speedup. Writes out/benchmark_report.json.
"""
import json
import math
import time
from pathlib import Path
from multiprocessing import Pool, cpu_count

from dvoacap.path_geometry import GeoPoint
from dvoacap.prediction_engine import PredictionEngine

HERE = Path(__file__).parent
OUT_PATH = HERE / "out" / "benchmark_report.json"

FREQS = [3.5, 5.0, 7.0, 10.1, 14.0, 18.1, 21.0, 24.9, 28.0, 29.7]  # ~10 freqs
TX = (40.71, -74.01)  # New York City -- representative fixed transmitter


def single_point_to_point(tx_deg, rx_deg, ssn=100.0, month=6, tx_power=100.0):
    """One full point-to-point prediction: 24 UTC hours x len(FREQS) frequencies."""
    tx = GeoPoint.from_degrees(*tx_deg)
    rx = GeoPoint.from_degrees(*rx_deg)
    engine = PredictionEngine()
    engine.params.tx_location = tx
    engine.params.ssn = ssn
    engine.params.month = month
    engine.params.tx_power = tx_power
    for hour in range(24):
        engine.predict(rx, utc_time=hour / 24.0, frequencies=list(FREQS))


def bench_single_point_to_point(n_repeats: int) -> dict:
    rx_deg = (51.51, -0.13)  # London -- long_dx_transatlantic circuit
    # warm up (first call pays for any lazy one-time setup, e.g. data file loads)
    single_point_to_point(TX, rx_deg)

    times = []
    for _ in range(n_repeats):
        t0 = time.perf_counter()
        single_point_to_point(TX, rx_deg)
        times.append(time.perf_counter() - t0)

    n_calls = 24  # predict() calls per point-to-point run (each covering all FREQS)
    return {
        "description": "24 UTC hours x 10 frequencies, one circuit (NYC->London)",
        "n_repeats": n_repeats,
        "times_s": times,
        "mean_s": sum(times) / len(times),
        "min_s": min(times),
        "max_s": max(times),
        "mean_ms_per_predict_call": (sum(times) / len(times)) / n_calls * 1000,
        "predict_calls_per_run": n_calls,
        "freqs_per_call": len(FREQS),
    }


def build_grid(step_deg: int):
    lats = list(range(-85, 86, step_deg))
    lons = list(range(-180, 180, step_deg))
    return [(lat, lon) for lat in lats for lon in lons]


def predict_one_point(args):
    tx_deg, rx_deg, ssn, month, tx_power, hour = args
    tx = GeoPoint.from_degrees(*tx_deg)
    rx_lat, rx_lon = rx_deg
    # Skip degenerate/near-coincident points (tx==rx) which the engine cannot
    # form a great-circle path for.
    if abs(rx_lat - tx_deg[0]) < 1e-6 and abs(rx_lon - tx_deg[1]) < 1e-6:
        return None
    rx = GeoPoint.from_degrees(rx_lat, rx_lon)
    engine = PredictionEngine()
    engine.params.tx_location = tx
    engine.params.ssn = ssn
    engine.params.month = month
    engine.params.tx_power = tx_power
    try:
        engine.predict(rx, utc_time=hour / 24.0, frequencies=list(FREQS))
        return True
    except Exception as e:
        return f"ERROR: {e}"


def bench_coverage_grid_subset(n_points: int, seed_step_deg: int = 5) -> dict:
    """
    Measure wall time for a representative random-ish subset of a global
    5-degree grid (single fixed hour/ssn, single core), then report per-point
    cost so it can be scaled to the full grid size.
    """
    full_grid = build_grid(seed_step_deg)
    # deterministic even subsample across the grid (not random -- reproducible)
    stride = max(1, len(full_grid) // n_points)
    subset = full_grid[::stride][:n_points]

    tx_deg = TX
    ssn, month, tx_power, hour = 100.0, 6, 100.0, 12

    errors = []
    t0 = time.perf_counter()
    for rx_deg in subset:
        result = predict_one_point((tx_deg, rx_deg, ssn, month, tx_power, hour))
        if isinstance(result, str):
            errors.append((rx_deg, result))
    t1 = time.perf_counter()

    elapsed = t1 - t0
    n = len(subset)
    return {
        "description": (f"Subset of full 5deg global grid ({len(full_grid)} points), "
                         f"single fixed hour+ssn, single frequency-set, single core"),
        "full_grid_size_at_5deg": len(full_grid),
        "subset_size": n,
        "elapsed_s": elapsed,
        "ms_per_point": elapsed / n * 1000,
        "errors": errors,
        "extrapolation": {
            "method": "linear scaling: (elapsed_s / subset_size) * full_grid_size",
            "estimated_full_grid_s_single_core": elapsed / n * len(full_grid),
        },
    }


def _mp_worker(args):
    return predict_one_point(args)


def bench_multiprocessing(n_points: int, seed_step_deg: int = 5) -> dict:
    full_grid = build_grid(seed_step_deg)
    stride = max(1, len(full_grid) // n_points)
    subset = full_grid[::stride][:n_points]

    tx_deg = TX
    ssn, month, tx_power, hour = 100.0, 6, 100.0, 12
    work = [(tx_deg, rx_deg, ssn, month, tx_power, hour) for rx_deg in subset]

    # single-core baseline on the exact same subset/work list for fair comparison
    t0 = time.perf_counter()
    for w in work:
        predict_one_point(w)
    t_single = time.perf_counter() - t0

    n_cores = cpu_count()
    t0 = time.perf_counter()
    with Pool(processes=n_cores) as pool:
        pool.map(_mp_worker, work)
    t_multi = time.perf_counter() - t0

    return {
        "description": f"Same {len(work)}-point subset, single core vs. multiprocessing.Pool",
        "n_points": len(work),
        "n_cores_available": n_cores,
        "single_core_s": t_single,
        "multi_core_s": t_multi,
        "speedup": t_single / t_multi if t_multi > 0 else None,
        "efficiency": (t_single / t_multi / n_cores) if t_multi > 0 else None,
    }


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    report = {}

    print("Benchmarking single point-to-point prediction (24h x 10 freq)...")
    report["single_point_to_point"] = bench_single_point_to_point(n_repeats=20)
    r = report["single_point_to_point"]
    print(f"  mean={r['mean_s']*1000:.1f} ms  min={r['min_s']*1000:.1f} ms  "
          f"max={r['max_s']*1000:.1f} ms  ({r['mean_ms_per_predict_call']:.2f} ms/predict() call)")

    print("\nBenchmarking coverage-grid subset (single core)...")
    report["coverage_grid_subset"] = bench_coverage_grid_subset(n_points=300)
    r = report["coverage_grid_subset"]
    print(f"  {r['subset_size']} points in {r['elapsed_s']:.2f}s "
          f"({r['ms_per_point']:.2f} ms/point), errors={len(r['errors'])}")
    print(f"  extrapolated full {r['full_grid_size_at_5deg']}-point grid (single core): "
          f"{r['extrapolation']['estimated_full_grid_s_single_core']:.1f} s")

    print("\nBenchmarking multiprocessing speedup...")
    report["multiprocessing"] = bench_multiprocessing(n_points=300)
    r = report["multiprocessing"]
    print(f"  {r['n_cores_available']} cores available: single={r['single_core_s']:.2f}s, "
          f"multi={r['multi_core_s']:.2f}s, speedup={r['speedup']:.2f}x "
          f"(efficiency={r['efficiency']*100:.0f}%)")

    # Full-grid extrapolation using measured multi-core throughput.
    subset_mp = report["multiprocessing"]
    full_grid_size = report["coverage_grid_subset"]["full_grid_size_at_5deg"]
    per_point_multi_s = subset_mp["multi_core_s"] / subset_mp["n_points"]
    report["full_grid_extrapolation_multicore"] = {
        "method": "linear scaling from measured multiprocessing subset throughput",
        "full_grid_size_at_5deg": full_grid_size,
        "n_cores_used": subset_mp["n_cores_available"],
        "estimated_full_grid_s_multicore": per_point_multi_s * full_grid_size,
    }
    print(f"\nExtrapolated full {full_grid_size}-point grid on "
          f"{subset_mp['n_cores_available']} cores: "
          f"{report['full_grid_extrapolation_multicore']['estimated_full_grid_s_multicore']:.1f} s")

    OUT_PATH.write_text(json.dumps(report, indent=2))
    print(f"\nFull report written to {OUT_PATH.relative_to(HERE)}")


if __name__ == "__main__":
    main()
