"""Gate tests, including golden-file tests against real Phase 0 payloads.

CI is hermetic: these run entirely against fixtures captured in Phase 0
(`spike/ingest-smoke/out/fixtures/`), never the network. When an upstream
changes shape, the failing test's diff is the diagnosis
(`docs/12-ai-maintainability.md`).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from hfkit_pipeline.gates import (  # noqa: E402
    GateError,
    GateReport,
    check_monotonic_time,
    check_value,
    require_json_payload,
)
from hfkit_pipeline.sources import (  # noqa: E402
    SOURCES,
    SOURCES_BY_KEY,
    _validate_essn,
    _validate_f107,
    _validate_kp,
    _validate_stations,
)

FIXTURES = ROOT / "spike" / "ingest-smoke" / "out" / "fixtures"


def load(name: str):
    path = FIXTURES / name
    if not path.exists():
        pytest.skip(f"fixture {name} not present")
    return json.loads(path.read_bytes())


# --------------------------------------------------------------------------
# The specific failure Phase 0 hit: error pages stored as data.
# --------------------------------------------------------------------------

class TestPayloadGate:
    def test_rejects_404(self):
        with pytest.raises(GateError, match="HTTP 404"):
            require_json_payload("s", 404, "text/html", b"<!doctype html><title>404</title>")

    def test_rejects_html_served_with_200(self):
        """The sneaky case: an error page with a success status."""
        with pytest.raises(GateError, match="HTML"):
            require_json_payload("s", 200, "text/html", b"<!DOCTYPE HTML><html>Not Found</html>")

    def test_rejects_empty_body(self):
        with pytest.raises(GateError, match="empty"):
            require_json_payload("s", 200, "application/json", b"")

    def test_rejects_unparseable_json(self):
        with pytest.raises(GateError, match="did not parse"):
            require_json_payload("s", 200, "application/json", b"{oops")

    def test_rejects_empty_document(self):
        with pytest.raises(GateError, match="empty document"):
            require_json_payload("s", 200, "application/json", b"[]")

    def test_accepts_valid_payload(self):
        assert require_json_payload("s", 200, "application/json", b'[{"flux":150}]')


class TestPlausibilityRanges:
    def test_accepts_real_extremes(self):
        """Genuine extreme space weather must pass — gates catch broken feeds,
        not unusual conditions."""
        r = GateReport("t")
        assert check_value(r, "kp", 9.0, "severe storm")
        assert check_value(r, "dst", -589.0, "Carrington-class")
        assert check_value(r, "f107", 400.0, "extreme solar max")
        assert r.passed

    def test_rejects_impossible_values(self):
        r = GateReport("t")
        assert not check_value(r, "kp", 12.0, "kp")       # scale is 0-9
        assert not check_value(r, "f107", 0.0, "f107")    # floor is ~64
        assert not r.passed
        assert len(r.failures) == 2

    def test_rejects_non_finite(self):
        r = GateReport("t")
        assert not check_value(r, "f107", float("nan"), "f107")
        assert not check_value(r, "f107", float("inf"), "f107")

    def test_rejects_bool_as_number(self):
        r = GateReport("t")
        assert not check_value(r, "kp", True, "kp")  # type: ignore[arg-type]

    def test_monotonic_time(self):
        r = GateReport("t")
        assert check_monotonic_time(r, [1.0, 2.0, 3.0], "ok")
        assert not check_monotonic_time(r, [1.0, 3.0, 2.0], "shuffled")
        assert not check_monotonic_time(r, [1.0, 1.0], "duplicated")


# --------------------------------------------------------------------------
# Golden-file tests: real captured payloads must pass their own validators.
# --------------------------------------------------------------------------

class TestGoldenFixtures:
    def test_f107(self):
        r = GateReport("f107")
        _validate_f107(load("swpc-f107.json"), r)
        assert r.passed, r.failures
        assert r.checked > 0

    def test_kp(self):
        r = GateReport("kp")
        _validate_kp(load("swpc-planetary-k-index.json"), r)
        assert r.passed, r.failures
        assert r.checked > 0

    def test_essn(self):
        """Effective SSN is the primary solar driver (ADR-0001) — strictest gate."""
        r = GateReport("essn")
        _validate_essn(load("kc2g-essn.json"), r)
        assert r.passed, r.failures
        assert r.checked > 0

    def test_essn_shape_is_what_adr_assumes(self):
        payload = load("kc2g-essn.json")
        assert "24h" in payload and "6h" in payload
        point = payload["24h"][0]
        assert {"time", "ssn", "sfi"} <= set(point)

    def test_stations(self):
        r = GateReport("stations")
        _validate_stations(load("kc2g-stations.json"), r)
        assert r.passed, r.failures
        assert r.checked > 0

    def test_html_fixture_would_be_rejected(self):
        """Regression guard for the Phase 0 mistake itself."""
        with pytest.raises(GateError):
            require_json_payload(
                "kc2g-muf", 200, "text/html",
                b'<!doctype html>\n<html lang=en>\n<title>404 Not Found</title>',
            )


class TestSourceRegistry:
    def test_every_source_declares_its_contract(self):
        """Definition of done: adapters declare licence, refresh, staleness."""
        for s in SOURCES:
            assert s.licence, f"{s.key} has no licence"
            assert s.refresh_seconds > 0, f"{s.key} has no refresh interval"
            assert s.stale_after_seconds > s.refresh_seconds, (
                f"{s.key}: staleness threshold must exceed refresh interval"
            )
            assert s.url.startswith("https://"), f"{s.key} is not HTTPS"
            assert s.description

    def test_keys_unique(self):
        keys = [s.key for s in SOURCES]
        assert len(keys) == len(set(keys))
        assert set(SOURCES_BY_KEY) == set(keys)

    def test_refresh_intervals_are_polite(self):
        """We are a guest on volunteer infrastructure (CLAUDE.md invariant #3).
        HF conditions move on ~15-minute timescales, so nothing needs faster."""
        for s in SOURCES:
            assert s.refresh_seconds >= 900, f"{s.key} polls faster than 15 min"


class TestKpShapeTolerance:
    """SWPC serves two JSON conventions; both must validate identically."""

    def test_record_form(self):
        r = GateReport("kp")
        _validate_kp([{"time_tag": "2026-07-25T00:00:00", "Kp": 1.0}], r)
        assert r.passed, r.failures
        assert r.checked == 1

    def test_array_of_arrays_form(self):
        r = GateReport("kp")
        _validate_kp([["time_tag", "Kp", "observed"], ["2026-07-25T00:00:00", "1.00", "observed"]], r)
        assert r.passed, r.failures
        assert r.checked == 1

    def test_rejects_out_of_range_in_either_form(self):
        r = GateReport("kp")
        _validate_kp([{"time_tag": "t", "Kp": 12.0}], r)
        assert not r.passed

    def test_rejects_unknown_shape(self):
        r = GateReport("kp")
        _validate_kp(["just", "strings"], r)
        assert not r.passed
