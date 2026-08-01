"""Upstream source adapters.

One thin adapter per source. Each declares its licence, refresh interval, and
staleness behaviour, per the definition of done in `docs/10-project-setup.md`.

Endpoints here are the ones Phase 0 actually verified against live servers
(`spike/ingest-smoke/FINDINGS.md`). Endpoints confirmed NOT to exist are
recorded in that document so nobody re-probes them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .gates import GateReport, check_monotonic_time, check_value

USER_AGENT = "HFKit/0.1 (+https://github.com/zacokalo/HFKit; me@zachc.net)"


@dataclass(frozen=True)
class Source:
    """A single upstream endpoint and everything we must know about it."""

    key: str
    url: str
    licence: str
    refresh_seconds: int
    description: str
    # Max age before the UI must label the data stale rather than present it as current.
    stale_after_seconds: int
    validate: Callable[[Any, GateReport], None] | None = None


def _validate_f107(payload: Any, report: GateReport) -> None:
    """SWPC F10.7: list of {time_tag, flux} records."""
    if not isinstance(payload, list) or not payload:
        report.fail("f107: expected a non-empty list")
        return
    for row in payload[-24:]:
        flux = row.get("flux") if isinstance(row, dict) else None
        if flux is None:
            report.fail("f107: record missing 'flux'")
            continue
        check_value(report, "f107", float(flux), "f107.flux")


def _validate_kp(payload: Any, report: GateReport) -> None:
    """SWPC planetary K index.

    SWPC serves two different JSON conventions across its `/products/` endpoints
    and we must tolerate both, because which one a given product uses is not
    predictable from the URL:

      - records:        [{"time_tag": "...", "Kp": 1.0}, ...]
      - array-of-arrays: [["time_tag","Kp",...], ["...", "1.00", ...], ...]

    The observed payload for `noaa-planetary-k-index.json` is the *record* form
    (verified against the Phase 0 fixture). An earlier version of this validator
    assumed the array form and the golden test caught it immediately — which is
    precisely what golden tests are for.
    """
    if not isinstance(payload, list) or not payload:
        report.fail("kp: expected a non-empty list")
        return

    head = payload[0]

    if isinstance(head, dict):
        key = next((k for k in head if k.lower() == "kp"), None)
        if key is None:
            report.fail(f"kp: no Kp field in record {sorted(head)!r}")
            return
        for row in payload[-24:]:
            if not isinstance(row, dict) or key not in row:
                report.fail(f"kp: malformed record {row!r}")
                continue
            try:
                check_value(report, "kp", float(row[key]), "kp")
            except (TypeError, ValueError):
                report.fail(f"kp: unparseable Kp in {row!r}")
        return

    if isinstance(head, list):
        idx = next((i for i, h in enumerate(head) if "kp" in str(h).lower()), None)
        if idx is None:
            report.fail(f"kp: no Kp column in header {head!r}")
            return
        for row in payload[1:][-24:]:
            try:
                check_value(report, "kp", float(row[idx]), "kp")
            except (TypeError, ValueError, IndexError):
                report.fail(f"kp: unparseable value in row {row!r}")
        return

    report.fail(f"kp: unrecognised payload shape, first element is {type(head).__name__}")


def _validate_essn(payload: Any, report: GateReport) -> None:
    """KC2G effective sunspot number: {'24h': [...], '6h': [...], 'diffusion': [...]}.

    This is our primary solar driver — ADR-0001 feeds effective SSN straight into
    ITU-R P.533 — so it gets the strictest gating of any source.
    """
    if not isinstance(payload, dict):
        report.fail("essn: expected an object")
        return
    for series in ("24h", "6h"):
        points = payload.get(series)
        if not isinstance(points, list) or not points:
            report.fail(f"essn.{series}: missing or empty")
            continue
        for p in points[-12:]:
            if not isinstance(p, dict):
                report.fail(f"essn.{series}: non-object point")
                continue
            if "ssn" in p:
                check_value(report, "ssn", float(p["ssn"]), f"essn.{series}.ssn")
            if "sfi" in p:
                check_value(report, "f107", float(p["sfi"]), f"essn.{series}.sfi")
        times = [float(p["time"]) for p in points if isinstance(p, dict) and "time" in p]
        if times:
            check_monotonic_time(report, times, f"essn.{series}.time")


def _validate_stations(payload: Any, report: GateReport) -> None:
    """KC2G GIRO ionosonde stations: list of station measurements."""
    if not isinstance(payload, list) or not payload:
        report.fail("stations: expected a non-empty list")
        return
    seen = 0
    for st in payload:
        if not isinstance(st, dict):
            continue
        fof2 = st.get("fof2")
        mufd = st.get("mufd")
        if fof2 is not None:
            try:
                check_value(report, "fof2", float(fof2), f"stations[{st.get('station', '?')}].fof2")
                seen += 1
            except (TypeError, ValueError):
                pass
        if mufd is not None:
            try:
                check_value(report, "mufd", float(mufd), f"stations[{st.get('station', '?')}].mufd")
            except (TypeError, ValueError):
                pass
    if seen == 0:
        report.fail("stations: no station reported a usable foF2 — feed may be empty")


# Verified live in Phase 0. Refresh intervals are deliberately conservative:
# we are a guest on volunteer-run infrastructure (CLAUDE.md invariant #3), and
# HF conditions move on ~15-minute timescales, so faster polling buys nothing.
SOURCES: tuple[Source, ...] = (
    Source(
        key="f107",
        url="https://services.swpc.noaa.gov/json/f107_cm_flux.json",
        licence="US Government work — public domain",
        refresh_seconds=3600,
        stale_after_seconds=6 * 3600,
        description="10.7 cm solar radio flux, the standard solar activity proxy",
        validate=_validate_f107,
    ),
    Source(
        key="kp",
        url="https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
        licence="US Government work — public domain",
        refresh_seconds=900,
        stale_after_seconds=3 * 3600,
        description="Planetary K index, observed geomagnetic disturbance",
        validate=_validate_kp,
    ),
    Source(
        key="kp_forecast",
        url="https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
        licence="US Government work — public domain",
        refresh_seconds=3600,
        stale_after_seconds=12 * 3600,
        description="Planetary K index forecast, drives the 24-48h outlook",
    ),
    Source(
        key="alerts",
        url="https://services.swpc.noaa.gov/products/alerts.json",
        licence="US Government work — public domain",
        refresh_seconds=900,
        stale_after_seconds=6 * 3600,
        description="Space weather alerts, watches and warnings",
    ),
    Source(
        key="essn",
        url="https://prop.kc2g.com/api/essn.json",
        licence="Open project, non-commercial use; attribute KC2G",
        refresh_seconds=900,
        stale_after_seconds=3 * 3600,
        description=(
            "Effective sunspot number and SFI, assimilated from live ionosondes. "
            "PRIMARY SOLAR DRIVER — fed directly into ITU-R P.533 per ADR-0001."
        ),
        validate=_validate_essn,
    ),
    Source(
        key="stations",
        url="https://prop.kc2g.com/api/stations.json",
        licence="Open project, non-commercial use; attribute KC2G and GIRO",
        refresh_seconds=900,
        stale_after_seconds=3 * 3600,
        description="GIRO ionosonde measurements: foF2, MUF(3000), hmF2, confidence",
        validate=_validate_stations,
    ),
)

SOURCES_BY_KEY: dict[str, Source] = {s.key: s for s in SOURCES}
