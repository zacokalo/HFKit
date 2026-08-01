# Upstream Data Sources

Summary of tested endpoints and their characteristics.

| Source | Endpoint | Status | Content-Type | Size | Update Cadence | Description |
|--------|----------|--------|--------------|------|---|---|
| **NOAA SWPC** | `/json/f107_cm_flux.json` | 200 | application/json | 22.8 KB | ~3 hrs (observed) | Solar flux at 10.7 cm wavelength; primary ionospheric driver |
| NOAA SWPC | `/products/noaa-planetary-k-index.json` | 200 | application/json | 4.5 KB | ~3 hrs | Planetary K-index (observed); geomagnetic disturbance index 0–9 scale |
| NOAA SWPC | `/products/noaa-planetary-k-index-forecast.json` | 200 | application/json | 6.9 KB | ~3 hrs | Planetary K-index forecast 3–4 days ahead |
| NOAA SWPC | `/products/10cm-flux-30-day.json` | 200 | application/json | 1.4 KB | ~3 hrs | 30-day solar flux history and 45-day forecast |
| NOAA SWPC | `/products/alerts.json` | 200 | application/json | 73 KB | varies; event-driven | Space weather alerts and warnings feed (solar flares, coronal mass ejections, etc.) |
| NOAA SWPC | `/products/kyoto-dst.json` | 200 | application/json | 7.3 KB | daily | Disturbance storm time index (geomagnetic activity) |
| NOAA SWPC | `/products/noaa-scales.json` | 200 | application/json | 1.1 KB | varies | Current NOAA space weather scale levels (R, S, G) |
| NOAA SWPC | `/products/solar-cycle-25-f10-7-predicted-range.json` | 200 | application/json | 22.1 KB | ~monthly | Solar cycle 25 F10.7 predicted range (long-term forecast) |
| NOAA SWPC | `/products/solar-cycle-25-ssn-predicted-range.json` | 200 | application/json | 26.8 KB | ~monthly | Solar cycle 25 sunspot number predicted range |
| **KC2G Ionosphere** | `/api/stations.json` | 200 | application/json | 42.5 KB | ~1 hr | Ionosonde station data; current foF2, MUF(3000), and derived metrics |
| KC2G | `/renders/current/mufd-normal-now.svg` | 200 | image/svg+xml | 374 KB | ~1 hr | Rendered global MUF(3000) map as SVG |
| **WSPR.live** | `/` (query: DESCRIBE wspr.rx) | 200 | application/json | 1.5 KB | static | Table schema for WSPR reception spots |
| WSPR.live | `/` (query: SHOW TABLES) | 200 | application/json | 182 B | static | List of available tables in ClickHouse |
| WSPR.live | `/` (query: RX sample, 2-hr window) | 200 | application/json | 17.9 KB | rolling | Sample of WSPR reception spots (radio propagation reports) |

## Notes

- **SWPC endpoints:** All return time-series arrays with ISO 8601 timestamps in UTC. Flux values are in sfu (solar flux units, 10^-22 W/m²/Hz); K-index is 0–9 scale.
- **KC2G:** Two distinct data products: (1) ionosonde station measurements (point data, updated ~hourly), and (2) assimilated global grid rendered as SVG (no raw grid format accessible via standard API; must parse SVG or reverse-engineer from frontend).
- **WSPR.live:** ClickHouse database over HTTP; SQL queries via URL parameter. All timestamps UTC. Supports band filtering, time ranges, and geographic queries. Spot density ~100k rows/day across 8–10 HF bands.
- **PSKReporter:** Attempted HTTP API discovery returned Express.js 404 errors; further investigation suggests API may require authentication or has undocumented endpoints. MQTT is blocked from this sandbox. Status: **untestable in current environment.**

## Update Cadence

- **F10.7, K-index:** Updated every 3 hours (NOAA publishes on 3-hr UTC schedule).
- **Alerts/warnings:** Event-driven; new messages added as they occur (minutes to hours).
- **KC2G stations:** Typically refresh 1–2 times per hour when new ionosonde data arrives.
- **WSPR.live:** Continuous accumulation; query results reflect last 2 hours by default (configurable).

## File Size Summary

- Total downloaded: ~582 KB
- Largest single file: KC2G SVG render (374 KB)
- Largest JSON: NOAA alerts feed (73 KB)
- Smallest: WSPR table list (182 B)
