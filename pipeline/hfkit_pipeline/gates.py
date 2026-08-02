"""Sanity gates for upstream ingestion.

Phase 0 wrote HTTP 404 error pages to disk as `.json` fixtures and they were
briefly treated as real data (see `spike/ingest-smoke/FINDINGS.md`). That is the
cheap version of this project's worst failure mode: serving confidently wrong
data. These gates exist so it cannot happen unattended.

The rule from `CLAUDE.md`: a tripped gate means the DATA is probably bad.
Investigate the data, not the gate. Never widen a range to make an alert stop.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any


class GateError(Exception):
    """Raised when ingested data fails a sanity gate. Never caught to 'move on'."""


@dataclass(frozen=True)
class Range:
    """A plausibility range for a physical quantity, with its justification."""

    lo: float
    hi: float
    why: str

    def check(self, value: float, label: str) -> None:
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise GateError(f"{label}: expected a number, got {type(value).__name__}")
        if math.isnan(value) or math.isinf(value):
            raise GateError(f"{label}: got non-finite value {value!r}")
        if not (self.lo <= value <= self.hi):
            raise GateError(
                f"{label}: {value} outside plausible range [{self.lo}, {self.hi}] — {self.why}"
            )


# Physical plausibility ranges. Deliberately wide: these catch broken feeds and
# unit changes, not unusual-but-real space weather. A real X-class flare or a
# severe geomagnetic storm must pass.
RANGES: dict[str, Range] = {
    # F10.7 solar radio flux, solar flux units. Floor ~64 at deep minimum;
    # extreme solar maximum peaks around 300-400.
    "f107": Range(60.0, 500.0, "F10.7 in sfu; ~64 at solar minimum, <500 ever"),
    # Planetary K index is defined on a 0-9 scale.
    "kp": Range(0.0, 9.0, "Kp is defined 0-9 by construction"),
    # Effective/observed sunspot number.
    "ssn": Range(0.0, 400.0, "SSN; 0 at minimum, historic max well under 400"),
    # Disturbance storm time index, nT. Deeply negative in severe storms.
    "dst": Range(-600.0, 100.0, "Dst in nT; -589 was the 1859 Carrington estimate"),
    # Ionosonde F2 critical frequency, MHz.
    "fof2": Range(0.5, 20.0, "foF2 in MHz; below 0.5 or above 20 is not physical"),
    # Maximum usable frequency for a 3000 km path, MHz.
    "mufd": Range(1.0, 60.0, "MUF(3000) in MHz"),
}


@dataclass
class GateReport:
    """Outcome of gating one source. Feeds /status and the staleness UI."""

    source: str
    passed: bool = True
    checked: int = 0
    failures: list[str] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.passed = False
        self.failures.append(message)


def require_json_payload(source: str, status_code: int, content_type: str, body: bytes) -> Any:
    """Gate an HTTP response before it is allowed anywhere near disk.

    This is the specific gate that Phase 0 lacked. A 404 HTML error page must
    never reach a fixture file, and a fixture must never exist without having
    parsed successfully.
    """
    import json

    if status_code != 200:
        raise GateError(f"{source}: HTTP {status_code}, refusing to store")

    head = body[:200].lstrip().lower()
    if head.startswith(b"<!doctype") or head.startswith(b"<html"):
        raise GateError(
            f"{source}: body is HTML, not data — almost certainly an error page "
            f"served with a non-error status"
        )

    if not body.strip():
        raise GateError(f"{source}: empty body")

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise GateError(f"{source}: body did not parse as JSON — {exc}") from exc

    if parsed is None or (isinstance(parsed, (list, dict)) and len(parsed) == 0):
        raise GateError(f"{source}: parsed to an empty document")

    if "json" not in content_type.lower():
        # Not fatal — some upstreams mislabel — but worth surfacing.
        pass

    return parsed


def check_value(report: GateReport, key: str, value: float, label: str) -> bool:
    """Check one value against its named range, recording rather than raising."""
    rng = RANGES.get(key)
    if rng is None:
        raise KeyError(f"No plausibility range defined for {key!r}")
    report.checked += 1
    try:
        rng.check(value, label)
        return True
    except GateError as exc:
        report.fail(str(exc))
        return False


def check_monotonic_time(report: GateReport, times: list[float], label: str) -> bool:
    """Timestamps in a series must be strictly increasing.

    Catches an upstream serving a shuffled or duplicated window, which would
    otherwise silently corrupt any 'latest value' logic.
    """
    report.checked += 1
    for a, b in zip(times, times[1:]):
        if b <= a:
            report.fail(f"{label}: timestamps not strictly increasing ({a} -> {b})")
            return False
    return True
