"""
Cached, rate-limited HTTP client for the wspr.live public ClickHouse endpoint.

This is a spike-quality client for the HFKit validation harness. It is
deliberately conservative: every query result is cached to disk forever
(keyed by a hash of the exact query text), requests are rate-limited with a
minimum delay between them, and every request identifies itself with a
descriptive User-Agent. wspr.live is a free, volunteer-run service -- treat
it as a guest would.

Usage:
    from wspr_client import WsprClient
    client = WsprClient()
    result = client.query("SELECT band, count() FROM wspr.rx WHERE time > now() - INTERVAL 2 HOUR GROUP BY band FORMAT JSONCompact")
    # result is a dict: {"columns": [...], "rows": [[...], ...]}
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

WSPR_ENDPOINT = "https://db1.wspr.live/"
USER_AGENT = "HFKit-validation-spike/0.1 (+https://github.com/; contact: me@zachc.net)"
DEFAULT_CACHE_DIR = Path(__file__).parent / "out" / "cache"
MIN_DELAY_SECONDS = 1.5  # minimum gap between outbound requests, be polite


class WsprQueryError(RuntimeError):
    pass


class WsprClient:
    def __init__(
        self,
        cache_dir: Path | str = DEFAULT_CACHE_DIR,
        min_delay: float = MIN_DELAY_SECONDS,
        timeout: float = 60.0,
        verbose: bool = True,
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.min_delay = min_delay
        self.timeout = timeout
        self.verbose = verbose
        self._last_request_ts: float = 0.0

    def _cache_path(self, query: str) -> Path:
        # Query text (not just a summary) is hashed so that any edit to the
        # SQL -- including whitespace -- invalidates the cache correctly.
        digest = hashlib.sha256(query.encode("utf-8")).hexdigest()[:24]
        return self.cache_dir / f"{digest}.json"

    def _rate_limit(self) -> None:
        elapsed = time.monotonic() - self._last_request_ts
        wait = self.min_delay - elapsed
        if wait > 0:
            time.sleep(wait)

    def query(self, sql: str, force_refresh: bool = False) -> dict:
        """
        Run a ClickHouse SQL query against wspr.live, returning
        {"columns": [names...], "rows": [[...], ...]}.

        Results are cached to disk forever, keyed by a hash of the exact
        query text. A cached query is NEVER re-fetched.
        """
        sql = sql.strip()
        if "FORMAT" not in sql.upper():
            sql += " FORMAT JSONCompact"

        cache_path = self._cache_path(sql)
        if cache_path.exists() and not force_refresh:
            if self.verbose:
                print(f"[wspr_client] cache HIT  {cache_path.name}  ({sql[:80]}...)")
            payload = json.loads(cache_path.read_text())
            return {"columns": payload["columns"], "rows": payload["rows"]}

        if self.verbose:
            print(f"[wspr_client] cache MISS {cache_path.name}  fetching...")
            print(f"[wspr_client]   query: {sql}")

        self._rate_limit()
        data = urllib.parse.urlencode({"query": sql}).encode("utf-8")
        req = urllib.request.Request(
            WSPR_ENDPOINT,
            data=data,
            headers={"User-Agent": USER_AGENT},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise WsprQueryError(f"HTTP {e.code} from wspr.live: {body[:500]}") from e
        except urllib.error.URLError as e:
            raise WsprQueryError(f"Network error contacting wspr.live: {e}") from e
        finally:
            self._last_request_ts = time.monotonic()

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as e:
            raise WsprQueryError(
                f"Could not parse response as JSON (did the query include FORMAT JSONCompact?): {raw[:500]}"
            ) from e

        if "exception" in parsed:
            raise WsprQueryError(f"ClickHouse error: {parsed['exception']}")

        columns = [c["name"] for c in parsed.get("meta", [])]
        rows = parsed.get("data", [])

        # Persist to cache before returning so a crash mid-pipeline never
        # loses a completed fetch.
        cache_path.write_text(json.dumps({"query": sql, "columns": columns, "rows": rows}))
        if self.verbose:
            print(f"[wspr_client]   -> {len(rows)} rows, cached to {cache_path.name}")

        return {"columns": columns, "rows": rows}

    def query_df(self, sql: str, force_refresh: bool = False):
        """Convenience wrapper returning a pandas DataFrame."""
        import pandas as pd

        result = self.query(sql, force_refresh=force_refresh)
        return pd.DataFrame(result["rows"], columns=result["columns"])


if __name__ == "__main__":
    # Smoke test matching the example query from the task brief.
    client = WsprClient()
    res = client.query(
        "SELECT band, count() AS n FROM wspr.rx "
        "WHERE time > now() - INTERVAL 2 HOUR GROUP BY band ORDER BY band"
    )
    print(res["columns"])
    for row in res["rows"]:
        print(row)
