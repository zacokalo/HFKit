#!/usr/bin/env python3
"""
Run dvoacap predictions across all reference circuits, 24 UTC hours, a spread
of HF frequencies, and two solar-activity levels (low/high SSN). Saves raw
output as JSON under out/predictions/<circuit_id>.json.

API note (see FINDINGS.md for full detail): the top-level `dvoacap.GeoPoint`
symbol is NOT the class PredictionEngine.predict() expects -- it is an alias
for dvoacap.geomagnetic.GeographicPoint. The correct class is
dvoacap.path_geometry.GeoPoint (lat/lon in radians). Import it directly.
"""
import json
import time
from pathlib import Path

import numpy as np

from dvoacap.path_geometry import GeoPoint
from dvoacap.prediction_engine import PredictionEngine


def _json_default(o):
    """dvoacap freely returns numpy scalar types (float32/float64); coerce for json."""
    if isinstance(o, np.generic):
        return o.item()
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")

HERE = Path(__file__).parent
CIRCUITS_FILE = HERE / "circuits.json"
OUT_DIR = HERE / "out" / "predictions"

# Frequencies spanning the HF spectrum, roughly matching common ham/utility
# channels (~10 points from 3 to 30 MHz as requested).
FREQUENCIES_MHZ = [3.5, 5.0, 7.0, 10.1, 14.0, 18.1, 21.0, 24.9, 28.0, 29.7]

# Two solar activity regimes.
SSN_LOW = 15.0   # near solar minimum
SSN_HIGH = 150.0  # near solar maximum

MONTH = 6  # June; fixed across circuits to keep the sweep tractable. Season
           # effects are a secondary axis we are not exploring in this spike.

TX_POWER_W = 100.0  # modest, realistic amateur-station power
MIN_ANGLE_DEG = 3.0


def make_engine(tx: GeoPoint, ssn: float) -> PredictionEngine:
    engine = PredictionEngine()
    engine.params.tx_location = tx
    engine.params.ssn = ssn
    engine.params.month = MONTH
    engine.params.tx_power = TX_POWER_W
    return engine


def run_circuit(circuit: dict) -> dict:
    tx = GeoPoint.from_degrees(circuit["tx"]["lat"], circuit["tx"]["lon"])
    rx = GeoPoint.from_degrees(circuit["rx"]["lat"], circuit["rx"]["lon"])

    runs = []
    for ssn_label, ssn in (("low", SSN_LOW), ("high", SSN_HIGH)):
        engine = make_engine(tx, ssn)
        for hour in range(24):
            utc_time = hour / 24.0
            engine.predict(rx, utc_time=utc_time, frequencies=list(FREQUENCIES_MHZ))
            preds = []
            for freq, pred in zip(engine.frequencies, engine.predictions):
                s = pred.signal
                preds.append({
                    "freq_mhz": freq,
                    "snr_db": s.snr_db,
                    "reliability": s.reliability,
                    "muf_day_prob": s.muf_day,  # P(MUF > freq); 1.0 = well below MUF
                    "power_dbw": s.power_dbw,
                    "field_dbuv": s.field_dbuv,
                    "hop_count": pred.hop_count,
                    "tx_elevation_deg": pred.tx_elevation * 57.29577951308232,
                    "mode": pred.get_mode_name(engine.path.dist),
                    "method": pred.method.value,
                })
            runs.append({
                "ssn_label": ssn_label,
                "ssn": ssn,
                "hour_utc": hour,
                "circuit_muf_mhz": engine.circuit_muf.muf if engine.circuit_muf else None,
                "path_dist_km": engine.path.dist * PredictionEngine.EARTH_RADIUS,
                "predictions": preds,
            })

    return {
        "circuit": circuit,
        "month": MONTH,
        "tx_power_w": TX_POWER_W,
        "min_angle_deg": MIN_ANGLE_DEG,
        "frequencies_mhz": FREQUENCIES_MHZ,
        "runs": runs,
    }


def main():
    circuits = json.loads(CIRCUITS_FILE.read_text())["circuits"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    t_start = time.perf_counter()
    for circuit in circuits:
        t0 = time.perf_counter()
        result = run_circuit(circuit)
        t1 = time.perf_counter()
        out_path = OUT_DIR / f"{circuit['id']}.json"
        out_path.write_text(json.dumps(result, indent=2, default=_json_default))
        n_predicts = len(result["runs"])
        print(f"{circuit['id']:26s} {t1-t0:7.2f}s total "
              f"({n_predicts} predict() calls x {len(FREQUENCIES_MHZ)} freqs, "
              f"{(t1-t0)/n_predicts*1000:6.2f} ms/call) -> {out_path.relative_to(HERE)}")

    t_end = time.perf_counter()
    print(f"\nAll circuits done in {t_end - t_start:.2f}s")


if __name__ == "__main__":
    main()
