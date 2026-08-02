"""
Build a labelled WSPR "did this path work" dataset for the HFKit validation
spike.

METHODOLOGY -- the "both ends active" filter
=============================================
A WSPR spot proves a path worked at that moment. It does NOT prove a path
was closed when no spot exists for a given (tx, rx) pair, because absence of
a spot might just mean nobody transmitted, or nobody was listening, or the
receiving station's rig/internet was off. To turn "no spot" into usable
negative evidence we only score path-hours where BOTH ends are independently
known to have been active:

  - A transmitter is "active" in a given band+hour if it was heard by AT
    LEAST ONE receiver anywhere on that band during that hour (proves its
    beacon was on the air and RF was propagating away from it in at least
    one direction).
  - A receiver is "active" in a given band+hour if it decoded AT LEAST ONE
    spot from ANY transmitter on that band during that hour (proves its
    receive chain, antenna, and internet connection to WSPRnet were
    working).

Because WSPR is a broadcast system (every listening receiver can hear every
transmitting beacon on frequency -- there's no pairing/handshake), a single
query per band+hour that groups all spots by (tx_sign, rx_sign) gives us,
for free:
  - the set of active transmitters (every distinct tx_sign in the result),
  - the set of active receivers (every distinct rx_sign in the result),
  - every pair that DID exchange a spot (the "worked" positives).

Any (active_tx, active_rx) combination that is NOT in the observed-pairs set
becomes a candidate negative ("both ends were demonstrably on the air/online
this hour, yet this specific pair produced zero decodes" -> path likely did
not support decode-quality propagation between those two specific points at
that time).

LIMITATIONS (read before trusting this data for anything beyond a spike):
  1. "Active this hour" is coarse. A transmitter that was only on air for the
     first 2 minutes of the hour and a receiver that only listened for the
     last 2 minutes of the same hour would both count as "active", but may
     never have overlapped. WSPR's synchronized even/odd 2-minute duty
     cycles mean many stations do transmit on a large fraction of slots, but
     this is not verified per-pair here.
  2. Many amateur stations do not run 24/7 or do not transmit every cycle
     (duty-cycling to share one radio between TX and RX, band-hopping
     schedules, etc.). "Heard once this hour" is a low bar for "active" --
     it is deliberately generous.
  3. The candidate-negative universe (active_tx x active_rx) is enormous
     (hundreds of thousands per busy band-hour). We take a bounded random
     sample rather than the full cross join, both for politeness to local
     compute/disk and because most of that universe (e.g. two receivers on
     opposite sides of the planet at a time when the band is not open
     between their regions at all) is uninformative filler. This means the
     dataset's raw worked/not-worked ratio is NOT the true base rate of
     "propagation success" -- see FINDINGS.md for the true (unsampled) rate
     alongside the sampled dataset actually used for metrics.
  4. Antenna, power, and operator competence vary hugely between amateur
     stations and are not modeled. A "not worked" between a QRP (low power)
     station and a station with a poor antenna is not necessarily evidence
     that the ionosphere would not have supported a well-equipped station on
     the same path.
  5. Grid locators are self-reported by operators (4 or 6 character
     Maidenhead) and truncated to 4 characters here; a very small number of
     malformed/blank locators are dropped.

DATA VOLUME / POLITENESS
=========================
We query one band+hour at a time (bounded by both partition keys), grouped
server-side (ClickHouse GROUP BY) so each query returns on the order of
10-25 thousand aggregated rows, never raw per-spot data. Every query is
cached to disk by wspr_client.py and is fetched at most once ever. We use a
modest window: 2 UTC calendar days, 2 synoptic hours per day, 2 bands = 8
band-hour queries total.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd

from wspr_client import WsprClient

OUT_DIR = Path(__file__).parent / "out"

# ---- study window -----------------------------------------------------
# A modest, deliberately unremarkable window: two ordinary midweek days,
# chosen to avoid major contest weekends that badly skew WSPR activity
# patterns. Two synoptic hours per day give us both a daylight-dominated
# and a darkness-dominated sample per band without looping over all 24
# hours (politeness / query-count budget).
BANDS = [14, 7]  # MHz band designator, matches wspr.rx `band` column
DATES = ["2026-07-20", "2026-07-21"]
HOURS = [6, 18]  # UTC hour-of-day, start of a 1-hour window

# ---- sampling caps (see LIMITATIONS #3 above) --------------------------
POS_CAP_PER_BAND_HOUR = 1500   # cap on "worked" rows kept per band-hour
NEG_MULTIPLIER = 2             # negatives sampled = min(available, NEG_MULTIPLIER * positives_kept)
NEG_CAP_PER_BAND_HOUR = 3000
RNG_SEED = 20260801


def haversine_km(lat1, lon1, lat2, lon2) -> np.ndarray:
    """Great-circle distance in km between arrays of points."""
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def fetch_band_hour(client: WsprClient, band: int, date: str, hour: int) -> pd.DataFrame:
    start = f"{date} {hour:02d}:00:00"
    # handle hour=23 wrap by using INTERVAL arithmetic in SQL instead of
    # string math, so we never have to hand-roll date rollover
    query = f"""
    SELECT
        tx_sign,
        any(tx_loc) AS tx_loc,
        any(tx_lat) AS tx_lat,
        any(tx_lon) AS tx_lon,
        rx_sign,
        any(rx_loc) AS rx_loc,
        any(rx_lat) AS rx_lat,
        any(rx_lon) AS rx_lon,
        count() AS n_spots,
        avg(distance) AS avg_distance,
        avg(snr) AS avg_snr
    FROM wspr.rx
    WHERE band = {band}
      AND time >= toDateTime('{start}')
      AND time <  toDateTime('{start}') + INTERVAL 1 HOUR
    GROUP BY tx_sign, rx_sign
    """
    result = client.query(query)
    df = pd.DataFrame(result["rows"], columns=result["columns"])
    return df


def build_band_hour_observations(df: pd.DataFrame, band: int, date: str, hour: int, rng: np.random.Generator) -> pd.DataFrame:
    """Given the raw grouped (tx_sign, rx_sign) spot table for one band+hour,
    produce labelled worked/not-worked observations using the both-ends-active
    filter described in the module docstring."""

    # Drop rows with missing/degenerate locators -- can't compute a
    # meaningful position or grid for them.
    df = df[(df["tx_loc"].str.len() >= 4) & (df["rx_loc"].str.len() >= 4)].copy()
    df = df[(df["tx_lat"] != 0) | (df["tx_lon"] != 0)]
    df = df[(df["rx_lat"] != 0) | (df["rx_lon"] != 0)]
    df = df[df["tx_sign"] != df["rx_sign"]]

    if df.empty:
        return pd.DataFrame()

    # Active station tables (one representative location per callsign).
    active_tx = df.drop_duplicates("tx_sign")[["tx_sign", "tx_loc", "tx_lat", "tx_lon"]].reset_index(drop=True)
    active_rx = df.drop_duplicates("rx_sign")[["rx_sign", "rx_loc", "rx_lat", "rx_lon"]].reset_index(drop=True)

    worked_pairs = set(zip(df["tx_sign"], df["rx_sign"]))

    # ---- positives: real observed spots -> worked = True ----
    pos = df.copy()
    if len(pos) > POS_CAP_PER_BAND_HOUR:
        pos = pos.sample(n=POS_CAP_PER_BAND_HOUR, random_state=rng.integers(0, 2**31 - 1))
    pos = pos.rename(columns={"avg_distance": "distance_km"})
    pos["worked"] = True
    n_pos_kept = len(pos)

    # ---- negatives: active_tx x active_rx minus observed pairs ----
    # Full cross join (bounded -- active_tx/active_rx are per-band-hour
    # station counts, at most a few thousand each).
    active_tx["_k"] = 1
    active_rx["_k"] = 1
    cross = active_tx.merge(active_rx, on="_k").drop(columns="_k")
    # Vectorized anti-join against the observed-pairs table (avoid a
    # row-wise Python loop over a potentially ~10^5-10^6 row cross join).
    worked_pairs_df = df[["tx_sign", "rx_sign"]].drop_duplicates()
    merged = cross.merge(worked_pairs_df, on=["tx_sign", "rx_sign"], how="left", indicator=True)
    neg_candidates = cross[merged["_merge"].values == "left_only"]

    n_neg_target = min(len(neg_candidates), max(NEG_MULTIPLIER * n_pos_kept, 1), NEG_CAP_PER_BAND_HOUR)
    if len(neg_candidates) > 0 and n_neg_target > 0:
        neg = neg_candidates.sample(n=n_neg_target, random_state=rng.integers(0, 2**31 - 1)).copy()
        neg["distance_km"] = haversine_km(neg["tx_lat"], neg["tx_lon"], neg["rx_lat"], neg["rx_lon"])
        neg["n_spots"] = 0
        neg["avg_snr"] = np.nan
        neg["worked"] = False
    else:
        neg = pd.DataFrame(columns=list(pos.columns))

    obs = pd.concat([pos, neg], ignore_index=True, sort=False)
    obs["band"] = band
    obs["date"] = date
    obs["hour_utc"] = hour
    obs["tx_grid"] = obs["tx_loc"].str[:4].str.upper()
    obs["rx_grid"] = obs["rx_loc"].str[:4].str.upper()

    # bookkeeping for honest reporting of the raw (unsampled) universe
    obs.attrs["n_active_tx"] = len(active_tx)
    obs.attrs["n_active_rx"] = len(active_rx)
    obs.attrs["n_worked_raw"] = len(worked_pairs)
    obs.attrs["n_cross_candidates_raw"] = len(cross)

    return obs


def main():
    OUT_DIR.mkdir(exist_ok=True)
    client = WsprClient()
    rng = np.random.default_rng(RNG_SEED)

    all_obs = []
    universe_log = []  # true, unsampled counts per band-hour for honest reporting

    for band in BANDS:
        for date in DATES:
            for hour in HOURS:
                print(f"=== band={band}MHz date={date} hour={hour:02d}Z ===")
                raw = fetch_band_hour(client, band, date, hour)
                print(f"  raw grouped (tx,rx) rows: {len(raw)}")
                obs = build_band_hour_observations(raw, band, date, hour, rng)
                if obs.empty:
                    print("  no usable observations (empty after filtering)")
                    continue
                n_worked = int(obs["worked"].sum())
                n_not = int((~obs["worked"]).sum())
                print(f"  kept: {n_worked} worked, {n_not} not-worked")
                universe_log.append({
                    "band": band, "date": date, "hour": hour,
                    "n_active_tx": obs.attrs["n_active_tx"],
                    "n_active_rx": obs.attrs["n_active_rx"],
                    "n_worked_raw": obs.attrs["n_worked_raw"],
                    "n_cross_candidates_raw": obs.attrs["n_cross_candidates_raw"],
                    "n_worked_kept": n_worked,
                    "n_not_worked_kept": n_not,
                })
                all_obs.append(obs)

    dataset = pd.concat(all_obs, ignore_index=True, sort=False)
    keep_cols = [
        "band", "date", "hour_utc",
        "tx_sign", "tx_grid", "tx_lat", "tx_lon",
        "rx_sign", "rx_grid", "rx_lat", "rx_lon",
        "distance_km", "n_spots", "avg_snr", "worked",
    ]
    dataset = dataset[keep_cols]

    out_path = OUT_DIR / "dataset.csv"
    dataset.to_csv(out_path, index=False)
    print(f"\nSaved {len(dataset)} observations to {out_path}")

    universe_df = pd.DataFrame(universe_log)
    universe_path = OUT_DIR / "dataset_universe_log.csv"
    universe_df.to_csv(universe_path, index=False)
    print(f"Saved raw-universe accounting to {universe_path}")

    n_worked = int(dataset["worked"].sum())
    n_not = int((~dataset["worked"]).sum())
    total_raw_worked = int(universe_df["n_worked_raw"].sum())
    total_raw_candidates = int(universe_df["n_cross_candidates_raw"].sum())
    print("\n--- CLASS BALANCE (sampled dataset actually written to disk) ---")
    print(f"worked:     {n_worked} ({n_worked / len(dataset):.1%})")
    print(f"not worked: {n_not} ({n_not / len(dataset):.1%})")
    print(f"total:      {len(dataset)}")
    print("\n--- TRUE (unsampled) universe across all band-hours, for reference ---")
    print(f"raw worked pairs (all, uncapped): {total_raw_worked}")
    print(f"raw active_tx x active_rx candidate universe: {total_raw_candidates}")
    if total_raw_candidates:
        print(f"true worked rate among ALL active-pair candidates: {total_raw_worked / total_raw_candidates:.2%}")


if __name__ == "__main__":
    main()
