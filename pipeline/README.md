# HFKit pipeline (Tier 0)

The entire backend. A scheduled job that fetches upstream data, **gates it**,
and publishes versioned static bundles. No server, no database — see
`docs/11-operating-constraints.md` §3a.

```
fetch → gate → normalise → bundle → publish (static/CDN)
```

Clients download bundles and compute predictions on-device (ADR-0001), so this
job's cost is independent of user count.

## Why the gates matter

Phase 0 wrote HTTP 404 pages to disk as `.json` fixtures and briefly treated
them as real data. `gates.py` makes that impossible: a payload must return HTTP
200, not be HTML, parse as JSON, be non-empty, and pass physical plausibility
ranges before it is stored.

**If a gate trips, the data is probably genuinely bad. Investigate the data, not
the gate** — never widen a range to silence an alert (`CLAUDE.md`).

## Layout

| File | Role |
|---|---|
| `gates.py` | Sanity gates: HTTP/shape checks plus physical plausibility ranges |
| `sources.py` | One thin adapter per upstream, each declaring licence, refresh interval, staleness threshold, and validator |

Only endpoints verified live in Phase 0 appear here. Ones confirmed absent are
recorded in `spike/ingest-smoke/FINDINGS.md` so they are not re-probed.

## Dev

```
pip install -e '.[dev]'
pytest && mypy hfkit_pipeline && ruff check .
```
