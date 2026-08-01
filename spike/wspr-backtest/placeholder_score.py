"""
Placeholder A-score for the HFKit validation spike.

THIS IS NOT THE REAL SCORING ENGINE. HFKit's real prediction engine does not
exist yet (see CLAUDE.md: "planning phase... no product code yet"). This
module exists solely to produce a score in [0, 100] that varies with
frequency, distance, and day/night so that metrics.py has something
non-trivial to evaluate and the end-to-end harness can be proven to work.
It is deliberately simple, deliberately not calibrated, and deliberately
not tuned against the WSPR data it will be scored against.

Model (intentionally crude):
  score = 100 * (0.5 * daylight_component + 0.5 * distance_component)

  - daylight_component: solar elevation angle at the great-circle path
    midpoint, run through a sigmoid. Bands >= 14 MHz are scored as
    preferring daylight (higher MUF needed to support them); bands < 14 MHz
    are scored as preferring darkness (less D-layer absorption at night).
    This is a real, well-known propagation tendency, but the specific
    curve/weights here are not fit to anything -- they are hand-picked to
    produce plausible-looking variation only.

  - distance_component: a Gaussian bump centered on a band-dependent "sweet
    spot" distance (sweet_spot_km = band_mhz * 200), meant to loosely mimic
    single/multi-hop skip distances. Also not fit to data.

Solar elevation is computed with the standard NOAA solar-position
approximation (declination + equation of time from day-of-year), which is
accurate to a fraction of a degree without needing an external ephemeris
library.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _solar_elevation_deg(dt: pd.Series, lat_deg: np.ndarray, lon_deg: np.ndarray) -> np.ndarray:
    """
    Vectorized approximate solar elevation angle (degrees above horizon),
    NOAA solar position algorithm (simplified, no atmospheric refraction
    correction -- fine for a day/night propagation proxy).

    dt: pandas Series of UTC datetimes (tz-naive, interpreted as UTC).
    lat_deg, lon_deg: arrays of observer latitude/longitude in degrees.
    """
    dt = pd.to_datetime(dt, utc=True)
    day_of_year = dt.dt.dayofyear.to_numpy()
    hour_utc = (dt.dt.hour + dt.dt.minute / 60 + dt.dt.second / 3600).to_numpy()

    gamma = 2 * np.pi / 365 * (day_of_year - 1 + (hour_utc - 12) / 24)

    eqtime = 229.18 * (
        0.000075
        + 0.001868 * np.cos(gamma)
        - 0.032077 * np.sin(gamma)
        - 0.014615 * np.cos(2 * gamma)
        - 0.040849 * np.sin(2 * gamma)
    )
    decl = (
        0.006918
        - 0.399912 * np.cos(gamma)
        + 0.070257 * np.sin(gamma)
        - 0.006758 * np.cos(2 * gamma)
        + 0.000907 * np.sin(2 * gamma)
        - 0.002697 * np.cos(3 * gamma)
        + 0.00148 * np.sin(3 * gamma)
    )  # radians

    time_offset = eqtime + 4 * lon_deg  # minutes; timezone offset = 0 (UTC)
    tst = hour_utc * 60 + time_offset  # true solar time, minutes
    hour_angle_deg = tst / 4 - 180  # degrees
    hour_angle = np.radians(hour_angle_deg)

    lat = np.radians(lat_deg)
    cos_zenith = np.sin(lat) * np.sin(decl) + np.cos(lat) * np.cos(decl) * np.cos(hour_angle)
    cos_zenith = np.clip(cos_zenith, -1, 1)
    elevation_deg = 90 - np.degrees(np.arccos(cos_zenith))
    return elevation_deg


def _path_midpoint(tx_lat, tx_lon, rx_lat, rx_lon):
    """
    Approximate path midpoint. Uses a vector-mean average (converting
    longitude through sin/cos first to avoid the antimeridian wraparound
    bug a naive numeric average would have). This is NOT the exact
    great-circle midpoint but is a reasonable, cheap approximation for a
    placeholder day/night proxy -- good enough to tell "this path's middle
    is roughly in daylight" without a full spherical-geometry midpoint
    calculation.
    """
    tx_lat_r, tx_lon_r = np.radians(tx_lat), np.radians(tx_lon)
    rx_lat_r, rx_lon_r = np.radians(rx_lat), np.radians(rx_lon)

    mid_lat = np.degrees((tx_lat_r + rx_lat_r) / 2)

    sin_lon = (np.sin(tx_lon_r) + np.sin(rx_lon_r)) / 2
    cos_lon = (np.cos(tx_lon_r) + np.cos(rx_lon_r)) / 2
    mid_lon = np.degrees(np.arctan2(sin_lon, cos_lon))

    return mid_lat, mid_lon


def _sigmoid(x):
    return 1 / (1 + np.exp(-x))


def score_dataframe(df: pd.DataFrame) -> np.ndarray:
    """
    Compute the placeholder score for every row of a dataframe that has
    columns: band, date, hour_utc, tx_lat, tx_lon, rx_lat, rx_lon,
    distance_km.

    Returns an array of scores in [0, 100].
    """
    dt = pd.to_datetime(df["date"]) + pd.to_timedelta(df["hour_utc"], unit="h") + pd.to_timedelta(30, unit="m")
    # +30 min: score the middle of the hour bucket, not its start instant.

    mid_lat, mid_lon = _path_midpoint(
        df["tx_lat"].to_numpy(), df["tx_lon"].to_numpy(),
        df["rx_lat"].to_numpy(), df["rx_lon"].to_numpy(),
    )
    elevation = _solar_elevation_deg(dt, mid_lat, mid_lon)

    band = df["band"].to_numpy(dtype=float)
    prefers_daylight = band >= 14
    day_component = _sigmoid(elevation / 10.0)  # ~0 well before dawn, ~1 well after dawn
    daylight_component = np.where(prefers_daylight, day_component, 1 - day_component)

    sweet_spot_km = band * 200.0
    sigma_km = np.maximum(sweet_spot_km * 0.6, 200.0)
    distance = df["distance_km"].to_numpy(dtype=float)
    distance_component = np.exp(-0.5 * ((distance - sweet_spot_km) / sigma_km) ** 2)

    raw = 0.5 * daylight_component + 0.5 * distance_component
    score = 100.0 * raw
    return np.clip(score, 0, 100)


def score_one(band, date, hour_utc, tx_lat, tx_lon, rx_lat, rx_lon, distance_km) -> float:
    """Scalar convenience wrapper around score_dataframe for a single path."""
    df = pd.DataFrame([{
        "band": band, "date": date, "hour_utc": hour_utc,
        "tx_lat": tx_lat, "tx_lon": tx_lon, "rx_lat": rx_lat, "rx_lon": rx_lon,
        "distance_km": distance_km,
    }])
    return float(score_dataframe(df)[0])


if __name__ == "__main__":
    # Quick sanity check: a 14 MHz mid-range path at midday at the
    # transmitter's longitude should score higher than the same path at
    # local midnight.
    day = score_one(14, "2026-07-20", 12, 40.0, -75.0, 40.0, -73.0, 3000)
    night = score_one(14, "2026-07-20", 0, 40.0, -75.0, 40.0, -73.0, 3000)
    print(f"14 MHz, ~3000km, midday score:   {day:.1f}")
    print(f"14 MHz, ~3000km, midnight score: {night:.1f}")
