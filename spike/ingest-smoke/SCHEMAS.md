# Data Schemas

Detailed field definitions for each upstream source.

## NOAA SWPC

### F10.7 Solar Flux (`swpc-f107.json`)

Array of time-series observations. Each record:

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `time_tag` | string (ISO 8601) | UTC | Observation timestamp |
| `frequency` | int | MHz | Always 2800 (10.7 cm band) |
| `flux` | float | sfu | Solar flux units (10^-22 W/m²/Hz); typical range 50–300 |
| `reporting_schedule` | string | — | "Morning", "Noon", or "Afternoon" (3 obs/day at NOAA facilities) |
| `avg_begin_date` | string \| null | ISO 8601 UTC | Start of 90-day averaging window (null for "Afternoon" obs) |
| `ninety_day_mean` | float \| null | sfu | 90-day trailing average flux (null for "Afternoon" obs) |
| `rec_count` | int \| null | count | Number of days in average (usually 90, null for incomplete windows) |

**Gotchas:**
- Flux values stored as scientific notation (e.g., `1.470000000000000e+002` = 147 sfu).
- Only Noon and Morning reports include 90-day mean; Afternoon reports have `null`.
- Timestamps are ~3 hr apart (3 per day); sorting by `time_tag` is necessary.

### Planetary K-index Observed (`swpc-planetary-k-index.json`)

Array of 3-hourly indices:

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `time_tag` | string (ISO 8601) | UTC | Observation time (always 00:00, 03:00, 06:00, ... 21:00 UTC) |
| `Kp` | float | — | 0–9 scale (0–0.33 = 0, 0.33–0.67 = 1/3, etc.; fractional values observed) |
| `a_running` | int | — | Running 24-hr A-index (geomagnetic activity 0–400+) |
| `station_count` | int | — | Number of reporting magnetometer stations (typically 8–13) |

**Gotchas:**
- **Key name:** Capital `Kp` (not `kp`).
- K-index reported as decimal (e.g., 2.00, 1.33) representing thirds of the 0–9 scale.
- Timestamps are always 3-hr spaced; history typically spans 2–3 months.

### Planetary K-index Forecast (`swpc-planetary-k-index-forecast.json`)

Array of 3-hourly forecasts:

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `time_tag` | string (ISO 8601) | UTC | Forecast time (3-hr cadence) |
| `kp` | float | — | Predicted Kp (0–9 scale) |
| `observed` | string | — | Always "observed" in forecast (confusing naming; use `time_tag` to distinguish actual vs. forecast) |
| `noaa_scale` | int \| null | — | NOAA geomagnetic storm scale (G0–G5, stored as int 0–5; usually null) |

**Gotchas:**
- Forecast spans 3–4 days ahead; **all records have `observed: "observed"`** (poor labeling).
- Compare `time_tag` to current time to distinguish forecast vs. hindcast.
- `noaa_scale` rarely populated; prefer raw `kp` for thresholding.

### 10cm Flux 30-day (`swpc-10cm-flux-30-day.json`)

Similar structure to F10.7, typically 10–30 records spanning 30 days history + 45-day forecast:

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `time_tag` | string (ISO 8601) | UTC | Observation or forecast time |
| `frequency` | int | MHz | 2800 |
| `flux` | float | sfu | Historical and predicted values mixed |
| `reporting_schedule` | string | — | "Morning", "Noon", "Afternoon", or "Forecast" |

### Alerts/Warnings (`swpc-alerts.json`)

Array of active and recent alerts (typically 50–200 records):

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `messageID` | int | — | Unique alert ID |
| `messageIssueTime` | string (ISO 8601) | UTC | When the alert was issued |
| `messageExpireTime` | string (ISO 8601) | UTC | When the alert expires |
| `messageType` | string | — | e.g., "Alert", "Watch" |
| `eventType` | string | — | e.g., "Solar Flare", "Radiation Storm", "Geomagnetic Storm", "Polar Cap Absorption" |
| `phenomenon` | string | — | e.g., "Solar Radio Burst", "X-ray Radiation", "Energetic Particles", "Radio Blackout" |
| `message` | string | — | Plain-text alert body (multi-line; contains HTML in some cases) |

**Gotchas:**
- Alert text may include HTML tags (`<br>`, `<b>`, etc.); requires sanitization.
- `eventType` and `phenomenon` combination unique; no fixed enum.
- History spans weeks; filter by `messageExpireTime` to identify active alerts.

### Kyoto DST (`swpc-kyoto-dst.json`)

Hourly disturbance storm time index:

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `time_tag` | string (ISO 8601) | UTC | Hour start time |
| `dst` | float | nanoTeslas | Geomagnetic disturbance measure (typically ±50 to ±300) |

### NOAA Scales (`swpc-noaa-scales.json`)

Current operational scales (typically 4–5 records for different phenomena):

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `scale_number` | int | — | Unique identifier per scale |
| `scale_name` | string | — | e.g., "Geomagnetic Storms", "Solar Radiation Storms" |
| `level` | int | — | Current level (0–5, depending on scale) |
| `kp_threshold` | float \| null | — | Kp needed for this level (if applicable) |
| `description` | string | — | Human-readable effects and impacts |

### Solar Cycle 25 F10.7 Predicted (`swpc-solar-cycle-25-f10-7-predicted-range.json`)

Monthly F10.7 range predictions for all of cycle 25:

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `month_str` | string | "YYYY-MM" | Month identifier |
| `predicted_min` | float | sfu | Lower bound (68% confidence) |
| `predicted_mean` | float | sfu | Mean prediction |
| `predicted_max` | float | sfu | Upper bound (68% confidence) |

### Solar Cycle 25 SSN Predicted (`swpc-solar-cycle-25-ssn-predicted-range.json`)

Monthly sunspot number (SSN) forecasts:

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `month_str` | string | "YYYY-MM" | Month identifier |
| `predicted_min` | float | — | Lower bound SSN (0–300 typical) |
| `predicted_mean` | float | — | Mean SSN prediction |
| `predicted_max` | float | — | Upper bound SSN |

---

## KC2G Ionosphere

### Ionosonde Stations (`kc2g-stations.json`)

Array of ~150+ ionosonde station reports:

| Field | Type | Units | Notes |
|-------|------|-------|-------|
| `id` | int | — | Record ID (timestamp-based); unique per fetch |
| `time` | string (ISO 8601) | UTC | Ionogram observation time |
| `fof2` | float \| null | MHz | Critical frequency of F2 layer; primary driver of HF propagation |
| `mufd` | float \| null | MHz | Maximum usable frequency at 3000 km; directly applicable to HF path planning |
| `hmf2` | float \| null | km | Height of F2 layer max |
| `yf1` | float \| null | MHz | Critical frequency F1 layer (midday only) |
| `hmf1` | float \| null | km | Height F1 layer max |
| `fof1` | float \| null | MHz | Critical frequency F1 (less common) |
| `foes` | float \| null | MHz | Sporadic E critical frequency |
| `he` | float \| null | km | E-layer height |
| `hme` | float \| null | km | E-layer peak height |
| `fbe` | float \| null | MHz | Blunt E critical frequency (rare) |
| `fbes` | float \| null | MHz | Blunt sporadic E (rare) |
| `md` | string \| null | — | Modip D (D-region modifier; used in propagation models) |
| `scalef2` | float \| null | — | F2 layer scale parameter (0–100; confidence/reliability) |
| `cs` | float | % | Confidence score (0–100; or -1 for missing/unreliable) |
| `tec` | float \| null | TECU | Total electron content (ionospheric column density) |
| `source` | string | — | Data origin: "giro", "noaa", "aus-sws", "ingv", "giro_fastchar" |
| `station` | object | — | Nested: `{code, id, name, latitude, longitude}` |

**Gotchas:**
- **Multiple nulls:** Many fields are null or -1 depending on station and time of day (e.g., F1 layer absent at night).
- **cs = -1:** Indicates missing/invalid data, not zero confidence.
- **Latitude/longitude:** Decimal degrees (WGS84); longitude may be >180° (e.g., US stations ~260–290°).
- **Time ranges:** Data up to 2–3 weeks old mixed with real-time; sort by `time` and station to find latest.
- **Multi-source:** Different regional networks contribute data; GIRO is primary, but NOAA, AUS-SWS (Australian), INGV (Italian) fill gaps.

---

## WSPR.live (ClickHouse)

### RX Spots Schema (`wsprlive-rx-schema.json`)

ClickHouse DESCRIBE response (meta + data array):

| Column | Type | Units | Notes |
|--------|------|-------|-------|
| `id` | UInt64 | — | Unique spot ID |
| `time` | DateTime | UTC | Reception time (1-second precision) |
| `band` | Int16 | m | Wavelength (e.g., 20 for 20m band) |
| `rx_sign` | LowCardinality(String) | — | Receiver callsign / station ID (compressed string) |
| `rx_lat` | Float32 | degrees | Receiver latitude (WGS84, -90 to +90) |
| `rx_lon` | Float32 | degrees | Receiver longitude (WGS84, -180 to +180) |
| `rx_loc` | LowCardinality(String) | — | Receiver Maidenhead locator (e.g., "FN31pr") |
| `tx_sign` | LowCardinality(String) | — | Transmitter callsign |
| `tx_lat` | Float32 | degrees | Transmitter latitude |
| `tx_lon` | Float32 | degrees | Transmitter longitude |
| `tx_loc` | LowCardinality(String) | — | Transmitter Maidenhead locator |
| `distance` | UInt16 | km | Great-circle distance (0–20015 typical) |
| `azimuth` | UInt16 | degrees | TX to RX azimuth (true north = 0) |
| `rx_azimuth` | UInt16 | degrees | RX to TX azimuth (reverse bearing) |
| `frequency` | UInt64 | Hz | Transmission frequency (e.g., 14095600 = 14.0956 MHz) |
| `power` | Int8 | dBm | Transmitter power (1–60 dBm typical; sometimes 0–200 mW scale) |
| `snr` | Int8 | dB | Signal-to-noise ratio at receiver (-40 to +20 dB typical in WSPR) |
| `drift` | Int8 | Hz/min | RX frequency drift rate |
| `version` | LowCardinality(String) | — | WSPR version (e.g., "2", "15", "Flight") |
| `code` | Int8 | — | Spot confidence/validity code (0–7; rarely used) |

**Gotchas:**
- **LowCardinality:** ClickHouse compression; treated as string in JSON output.
- **Frequency in Hz:** Must divide by 1e6 to get MHz.
- **Power interpretation:** WSPR reports in dBm; be careful mixing with ERP (effective radiated power).
- **Timestamps:** Hourly boundaries; each spot aligned to nearest second.
- **Sparse coverage:** Fewer stations at night in certain regions; data is unevenly distributed.

### Available Tables

From `wsprlive-tables.json`, the database includes:
- `wspr.rx` — Reception spots (main table, ~100k rows/day)
- `wspr.tx` — Transmitter reports (not sampled here)
- Possibly others (not enumerated in test)

---

## PSKReporter

**Status: Untestable in this environment.**

HTTP API endpoints returned 404 errors. PSKReporter architecture:
- Primary interface: MQTT broker on `mqtt.pskreporter.info:1883` (blocked by sandbox network policy).
- Secondary: HTTP API paths undocumented; no public OpenAPI spec found.
- Fallback: Web interface renders dynamic data via JavaScript; reverse-engineering would require headless browser or inspecting network traffic.

Expected structure (from web UI):
- Recent spots: JSON array of RX/TX call, frequency, time, SNR, locator.
- Format likely similar to WSPR (lat, lon, distance, azimuth).
- Update cadence: Real-time (MQTT stream); HTTP polls ~10–60 sec.

**Recommendation:** For future testing on unrestricted network, attempt:
- HTTP GET `/api/v1/spots?filter=recent` or similar
- Check MQTT bridge services that expose MQTT→HTTP gateways
- Contact PSKReporter maintainers for API documentation

---

## Cross-Source Notes

### Timestamp Handling
- **SWPC:** ISO 8601 UTC strings (e.g., `2026-07-31T22:00:00`)
- **KC2G:** ISO 8601 UTC strings (e.g., `2026-08-01T06:05:01`)
- **WSPR:** DateTime (ClickHouse native; JSON-serialized as unix timestamp or ISO string depending on format param)

### Units Consistency (per CLAUDE.md spec)
- **Frequency:** MHz throughout (WSPR is Hz; **must convert**).
- **Distance:** km throughout (great-circle).
- **Latitude/Longitude:** Decimal degrees WGS84 (Maidenhead is display-only per spec).
- **Power:** dBm (SWPC flux is sfu; not power; unrelated).
- **SNR:** dB.
- **Height/altitudes:** km.

### Reliability vs. Freshness
- **SWPC:** Low latency (~3 hr), high reliability (government source), global coverage.
- **KC2G:** Low latency (~1 hr), moderate reliability (assimilated ionosonde network), gaps in coverage (no stations in sparse regions).
- **WSPR:** Real-time, crowd-sourced (variable reliability), uneven geographic distribution (more active in NH, amateur-friendly regions).
