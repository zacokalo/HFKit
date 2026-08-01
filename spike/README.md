# Phase 0 Spikes

Throwaway code, permanent answers. Each spike answers one question that
`docs/04-roadmap.md` Phase 0 requires before product code begins.

| Spike | Question it answers | Feeds |
|---|---|---|
| `engine-compare/` | Which prediction engine, and how fast is an area grid? | ADR-0001, coverage-map design |
| `engine-wasm/` | Can the engine run on-device in the browser? | The whole cost model (`docs/11`) |
| `ingest-smoke/` | Do all upstream sources work, and what shape is their data? | Golden-test fixtures, adapter design |
| `wspr-backtest/` | Can we measure A-score calibration against real outcomes? | `docs/07-scoring-spec.md` §5 |

## Environment facts (verified 2026-08-01, this sandbox)

- Python 3.11, pip, node 22, npm, gcc 13, cmake 3.28 available.
- **No gfortran** → `voacapl` (Fortran) is out of scope here.
- **No emcc** → Emscripten must be installed by the WASM spike.
- Reachable over HTTPS: `services.swpc.noaa.gov`, `prop.kc2g.com`,
  `db1.wspr.live` (ClickHouse HTTP, needs a `query=` param), pypi, npm, github.
- **`mqtt.pskreporter.info:1883` is BLOCKED** — raw TCP does not leave this
  sandbox. PSKReporter must be probed via its HTTP query API here; the MQTT
  path has to be validated on real infrastructure later.
- `pip install dvoacap` works (v1.0.2 on PyPI).

Results live in each spike's `out/` directory and are summarized in its
`FINDINGS.md`.
