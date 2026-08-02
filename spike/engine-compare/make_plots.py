#!/usr/bin/env python3
"""
Visual sanity check: reliability (and SNR, since reliability is ~flat-zero
with default params -- see FINDINGS.md) vs frequency vs UTC hour, for the
representative long_dx_transatlantic circuit (NYC -> London), at high SSN.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).parent
PRED_PATH = HERE / "out" / "predictions" / "long_dx_transatlantic.json"
OUT_DIR = HERE / "out"


def main():
    data = json.loads(PRED_PATH.read_text())
    freqs = data["frequencies_mhz"]

    for ssn_label in ("low", "high"):
        runs = sorted([r for r in data["runs"] if r["ssn_label"] == ssn_label],
                      key=lambda r: r["hour_utc"])
        hours = [r["hour_utc"] for r in runs]
        muf = [r["circuit_muf_mhz"] for r in runs]

        rel = np.array([[p["reliability"] for p in r["predictions"]] for r in runs])
        snr = np.array([[p["snr_db"] for p in r["predictions"]] for r in runs])

        ssn_value = runs[0]["ssn"]
        fig, axes = plt.subplots(1, 2, figsize=(13, 5.5))
        fig.suptitle(
            f"dvoacap: {data['circuit']['name']} ({data['circuit']['distance_km']} km), "
            f"SSN={ssn_value:.0f} ({ssn_label}), "
            f"month={data['month']}, tx_power={data['tx_power_w']} W",
            fontsize=11,
        )

        im0 = axes[0].imshow(rel, aspect="auto", origin="lower", cmap="viridis",
                              extent=[freqs[0], freqs[-1], hours[0] - 0.5, hours[-1] + 0.5])
        axes[0].plot(muf, hours, color="red", linewidth=1.5, label="circuit MUF")
        axes[0].set_xlabel("Frequency (MHz)")
        axes[0].set_ylabel("UTC hour")
        axes[0].set_title("Reliability (0-1)\n[collapses near 0 -- see FINDINGS.md caveat]")
        axes[0].legend(loc="upper right", fontsize=8)
        fig.colorbar(im0, ax=axes[0])

        im1 = axes[1].imshow(snr, aspect="auto", origin="lower", cmap="magma",
                              extent=[freqs[0], freqs[-1], hours[0] - 0.5, hours[-1] + 0.5])
        axes[1].plot(muf, hours, color="cyan", linewidth=1.5, label="circuit MUF")
        axes[1].set_xlabel("Frequency (MHz)")
        axes[1].set_ylabel("UTC hour")
        axes[1].set_title("SNR (dB) -- link-budget proxy, unaffected\nby the required_snr calibration issue")
        axes[1].legend(loc="upper right", fontsize=8)
        fig.colorbar(im1, ax=axes[1])

        fig.tight_layout(rect=[0, 0, 1, 0.94])
        out_path = OUT_DIR / f"reliability_snr_vs_freq_hour_{ssn_label}ssn.png"
        fig.savefig(out_path, dpi=140)
        plt.close(fig)
        print(f"wrote {out_path.relative_to(HERE)}")


if __name__ == "__main__":
    main()
