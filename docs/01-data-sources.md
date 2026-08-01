# Data Sources & Prediction Engines

Research into every open data source and open-source model HFKit can build on.
Last reviewed: 2026-08-01.

---

## 1. Space weather indices (drives "band health" + A-score inputs)

### NOAA SWPC — primary source ✅
- **Access:** static JSON files at `https://services.swpc.noaa.gov/products/` and `/json/`. Free, no auth, no API key. Updated every 1–15 min depending on product.
- **Products we need:**
  - 10.7 cm solar flux (SFI) — daily + forecast
  - Planetary K-index (Kp) — 3-hour observed + forecast, 1-minute estimated
  - A-index — daily
  - GOES X-ray flux — 1-min (flare detection → sudden ionospheric disturbance / D-layer absorption)
  - Solar wind (DSCOVR/ACE): speed, density, Bt/Bz — geomagnetic storm precursors (~30–60 min lead time)
  - Sunspot number
  - Alerts/watches/warnings feed (JSON) — storm notifications
  - 27-day and 3-day forecasts — powers the "next 24–48h" planning view
  - D-region absorption prediction (D-RAP) — global absorption map, directly relevant to low-band daytime scoring
  - Aurora OVATION model — auroral-zone absorption for high-latitude paths
- **Risk:** low. Occasionally products move; keep ingestion adapters thin.

### NOAA NCEI / NASA OMNIWeb — historical archives
- For backtesting the A-score against history and training any statistical corrections. Bulk downloads, free.

## 2. Ionosphere state (drives MUF/LUF, real-time model correction)

### GIRO / DIDBase (ionosonde network) ✅ with caution
- Global Ionosphere Radio Observatory: ~60+ digisondes worldwide reporting **foF2, hmF2, MUF(3000)** every 5–15 min. This is the ground truth for what the ionosphere is actually doing right now.
- **Access:** DIDBase web API (`lgdc.uml.edu`), polled every ~15 min (this is exactly what prop.kc2g.com does). Free for non-commercial use; check terms before commercial launch.
- **⚠️ Risk: single point of failure.** NOAA shut down its redundant ionosonde distribution in 2024; GIRO (plus INGV for some European stations) is now effectively the only pipe. Mitigation: cache aggressively, degrade gracefully to pure model (IRI) when stale, and consider mirroring INGV/Australian BOM (SWS) feeds.

### KC2G assimilated maps (prop.kc2g.com)
- IRI-2016 conditioned on live ionosonde data via Gaussian-process regression → global foF2 / MUF(3000) maps every 15 min. Open source ([github.com/arodland/prop](https://github.com/arodland/prop)), data endpoints are publicly fetchable (JSON/CBOR grids + `stations.json`).
- **Strategy:** Phase 1, consume KC2G's published grids (with attribution and a heads-up to Andrew, KC2G — it's WWROF-funded, not built for heavy third-party load). Phase 3+, run our own assimilation pipeline using his open-source code as reference so we control the whole stack.

### Australian BOM Space Weather Service (SWS)
- T-index, regional ionospheric maps, HAP charts. Good secondary/validation source; has an API (registration required).

## 3. Live propagation truth (validates predictions, powers "what's actually open")

### PSKReporter ✅ the firehose
- ~26M reception reports/day from FT8/FT4/WSPR/CW decoders worldwide. Every spot = proof a specific path worked on a specific frequency at a specific time.
- **Access:** public MQTT broker `mqtt.pskreporter.info:1883`, topic `pskr/filter/v2/#` — real-time, filterable by band/callsign/grid. Also a polled query API (rate-limited, be polite).
- **Use:** live band-activity layer on the map; A-score "reality correction" (model says band closed but spots disagree → adjust); path validation ("stations near you are being heard near your target right now").

### WSPRNet via wspr.live ✅ best for analytics
- Every WSPR spot since 2008 in a public ClickHouse DB (`db1.wspr.live`) — free SQL queries (be time/band-bounded; 10k-row table limit, use their guidance for automated access). WSPR is ideal ground truth: known TX power, machine-scheduled, so SNR is comparable across time.
- **Use:** historical "what does this path/band usually do at this hour/season/SFI" statistics; backtesting the A-score.

### Reverse Beacon Network (RBN)
- CW/RTTY skimmer spots with SNR. Telnet live feed + daily CSV dumps. Complements PSKReporter for CW activity.

## 4. Prediction engines (drives path planning + coverage maps)

| Engine | Model | Language | License/Status | Notes |
|---|---|---|---|---|
| **ITURHFProp + proppy** | ITU-R P.533-14 | C + Python wrapper | Open source (G4FKH/jawatson) | The ITU-standard method; proppy is a working web UI we can learn from; includes P.372 noise model |
| **dvoacap-python** | VOACAP | Pure Python | MIT-style, v1.0 Nov 2025, "production ready" | Newest option — no Fortran toolchain, easy to containerize and parallelize; needs validation vs reference VOACAP |
| **voacapl** (HZ1JW) | VOACAP | Fortran | Open source, battle-tested | The reference; heavier to deploy but the fallback if the Python port has gaps |
| **pythonprop** | wrapper around voacapl | Python | Open source | Point-to-point + area plot generation, good prior art |
| PHaRLAP | ray tracing | MATLAB | restrictive license | Overkill / not usable commercially; skip |

**Recommendation:** prototype with **dvoacap-python** and **ITURHFProp** side-by-side in the feasibility spike; pick one as primary (likely dvoacap-python for deployability, validated against voacapl). Both take the same core inputs: circuit endpoints, month, SSN/SFI, TX power, antenna, and output MUF / SNR / reliability per hour × frequency.

### Reference models (embedded in the above, also useful standalone)
- **IRI-2016/2020** — climatological ionosphere model (what KC2G corrects with live data). Python: `iri2016` package.
- **ITU-R P.372** — atmospheric/man-made noise, needed for realistic SNR.
- **IGRF** — geomagnetic field, for auroral-latitude logic.

## 5. Supporting data
- **Maidenhead grid / geodesy:** trivial, many libs.
- **Great-circle + terminator (gray line):** computed client-side; every map view wants the day/night terminator.
- **ITU / amateur band plans + user-defined channel lists:** ship amateur band plans as data; let users define arbitrary frequency lists (MARS/SHARES/ALE-style channel sets) — this is what makes the "score MY frequencies" feature general-purpose.
- **Basemaps:** OpenStreetMap vector tiles (OpenFreeMap / Protomaps for zero-cost self-hosting) or MapTiler free tier.

---

## Licensing & etiquette summary

| Source | Terms |
|---|---|
| NOAA SWPC | US Gov — public domain ✅ |
| GIRO | Free, cite; confirm terms if commercial |
| KC2G grids | Open source project; ask + attribute, don't hammer |
| PSKReporter | Public MQTT; respect rate limits on query API; attribute |
| wspr.live | Free incl. commercial with attribution + notification (per site) |
| RBN | Free feeds, attribute |
| ITURHFProp / dvoacap / voacapl | Open source ✅ |
| OSM basemaps | ODbL, attribute ✅ |
