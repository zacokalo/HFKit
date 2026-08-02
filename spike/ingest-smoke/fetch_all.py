#!/usr/bin/env python3
"""
Fetch all upstream data sources for HFKit smoke test.

This script reproduces the exact fetches documented in SOURCES.md.
Run it to refresh all fixtures in out/fixtures/.

User-Agent: HFKit-spike/0.1 (feasibility testing; contact: me@zachc.net)
"""

import json
import time
from pathlib import Path
from typing import Optional
import urllib.request
import urllib.error


# Configuration
USER_AGENT = "HFKit-spike/0.1 (feasibility testing; contact: me@zachc.net)"
DELAY_BETWEEN_REQUESTS = 2  # seconds, to be a good guest on volunteer infrastructure
OUTPUT_DIR = Path(__file__).parent / "out" / "fixtures"


def fetch_url(url: str, timeout: int = 30) -> Optional[bytes]:
    """Fetch a URL and return raw bytes. Returns None on error."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {url}")
        return None
    except Exception as e:
        print(f"  Error: {e}")
        return None


def save_fixture(filename: str, data: bytes) -> bool:
    """Save data to fixture file. Returns True on success."""
    path = OUTPUT_DIR / filename
    try:
        path.write_bytes(data)
        size_kb = len(data) / 1024
        print(f"  ✓ {filename} ({size_kb:.1f} KB)")
        return True
    except Exception as e:
        print(f"  ✗ {filename}: {e}")
        return False


def main():
    """Fetch all sources."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Track results
    succeeded = 0
    failed = 0

    print("HFKit Upstream Data Source Smoke Test")
    print("=" * 60)

    # ========================================================================
    # NOAA SWPC
    # ========================================================================
    print("\n[1] NOAA SWPC (Space Weather Prediction Center)")
    print("-" * 60)

    swpc_endpoints = [
        ("https://services.swpc.noaa.gov/json/f107_cm_flux.json", "swpc-f107.json"),
        ("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", "swpc-planetary-k-index.json"),
        ("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json", "swpc-planetary-k-index-forecast.json"),
        ("https://services.swpc.noaa.gov/products/10cm-flux-30-day.json", "swpc-10cm-flux-30-day.json"),
        ("https://services.swpc.noaa.gov/products/alerts.json", "swpc-alerts.json"),
        ("https://services.swpc.noaa.gov/products/kyoto-dst.json", "swpc-kyoto-dst.json"),
        ("https://services.swpc.noaa.gov/products/noaa-scales.json", "swpc-noaa-scales.json"),
        ("https://services.swpc.noaa.gov/products/solar-cycle-25-f10-7-predicted-range.json", "swpc-solar-cycle-25-f10-7-predicted.json"),
        ("https://services.swpc.noaa.gov/products/solar-cycle-25-ssn-predicted-range.json", "swpc-solar-cycle-25-ssn-predicted.json"),
    ]

    for url, filename in swpc_endpoints:
        data = fetch_url(url)
        if data:
            if save_fixture(filename, data):
                succeeded += 1
            else:
                failed += 1
        else:
            failed += 1
        time.sleep(DELAY_BETWEEN_REQUESTS)

    # ========================================================================
    # KC2G Ionosphere
    # ========================================================================
    print("\n[2] KC2G Ionosphere Maps")
    print("-" * 60)

    kc2g_endpoints = [
        ("https://prop.kc2g.com/api/stations.json", "kc2g-stations.json"),
        ("https://prop.kc2g.com/renders/current/mufd-normal-now.svg", "kc2g-muf-render.svg"),
    ]

    for url, filename in kc2g_endpoints:
        data = fetch_url(url)
        if data:
            if save_fixture(filename, data):
                succeeded += 1
            else:
                failed += 1
        else:
            failed += 1
        time.sleep(DELAY_BETWEEN_REQUESTS)

    # ========================================================================
    # WSPR.live (ClickHouse queries)
    # ========================================================================
    print("\n[3] WSPR.live (ClickHouse HTTP API)")
    print("-" * 60)

    # Schema
    query_schema = "DESCRIBE TABLE wspr.rx FORMAT JSONCompact"
    url_schema = f"https://db1.wspr.live/?query={urllib.parse.quote(query_schema)}"
    data = fetch_url(url_schema)
    if data:
        if save_fixture("wsprlive-rx-schema.json", data):
            succeeded += 1
        else:
            failed += 1
    else:
        failed += 1
    time.sleep(DELAY_BETWEEN_REQUESTS)

    # Tables
    query_tables = "SHOW TABLES FORMAT JSONCompact"
    url_tables = f"https://db1.wspr.live/?query={urllib.parse.quote(query_tables)}"
    data = fetch_url(url_tables)
    if data:
        if save_fixture("wsprlive-tables.json", data):
            succeeded += 1
        else:
            failed += 1
    else:
        failed += 1
    time.sleep(DELAY_BETWEEN_REQUESTS)

    # Sample RX spots (last 2 hours, limited to 100 rows)
    query_sample = "SELECT * FROM wspr.rx WHERE time > now() - INTERVAL 2 HOUR LIMIT 100 FORMAT JSONCompact"
    url_sample = f"https://db1.wspr.live/?query={urllib.parse.quote(query_sample)}"
    data = fetch_url(url_sample)
    if data:
        if save_fixture("wsprlive-rx-sample.json", data):
            succeeded += 1
        else:
            failed += 1
    else:
        failed += 1

    # ========================================================================
    # Summary
    # ========================================================================
    print("\n" + "=" * 60)
    print(f"Results: {succeeded} succeeded, {failed} failed")
    print(f"Fixtures saved to: {OUTPUT_DIR}")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    import sys
    import urllib.parse
    sys.exit(main())
