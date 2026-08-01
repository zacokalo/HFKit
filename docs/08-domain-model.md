# Domain Model & Glossary

Fixes the vocabulary, units, and core entities before code exists, so the API,
database, UI, and prediction adapters all mean the same thing by the same word.

> **Assumption flagged for confirmation:** this model is written **EMCOMM-first,
> ham-friendly** — arbitrary user-defined channel plans are first-class (not an
> afterthought bolted onto amateur bands), because your framing was "HF
> communications work" and "frequencies I plan to use." Amateur bands are then
> just a built-in frequency plan. If the real audience is DX/contesting, the model
> simplifies; if it's commercial/maritime, accuracy and licensing constraints tighten.

---

## 1. Conventions (enforced everywhere)

| Concept | Convention | Rationale |
|---|---|---|
| Time | **UTC always**, ISO 8601 with `Z`, stored as UTC | HF operates in UTC; local time only at final display, always labeled |
| Frequency | **MHz**, decimal (e.g. `14.2300`) | Match operator habits; store as decimal not float where exactness matters |
| Power | **watts**, TX PEP | |
| SNR | **dB**, always with stated bandwidth | Ambiguous dB is a bug; engines use dB-Hz, spots use dB in a stated bandwidth |
| Position | decimal degrees WGS84 (canonical) + Maidenhead grid (display/entry) | Grid is lossy — never the storage format |
| Distance | **km** | |
| Azimuth | degrees true (not magnetic), 0–360 | Magnetic is a display option only |
| Score | integer 0–100 | See `07-scoring-spec.md` |
| Reliability | 0.0–1.0 float | **Distinct from score** — never used interchangeably |

## 2. Core entities

### `Station`
A configured transmitting/receiving setup. Users may have several (home, mobile,
field site, EOC).

```
Station
  id, label ("Home", "Truck", "EOC Alt")
  position: lat/lon (+ optional grid, elevation m)
  power_w
  antenna: AntennaProfile
  noise_environment: quiet_rural | rural | residential | industrial   (ITU-R P.372)
  callsign?          # OPTIONAL — see privacy notes in 09-legal-privacy.md
  default_mode
```

`noise_environment` matters more than newcomers expect: it can shift usable SNR by
20+ dB between a quiet rural site and an industrial one, which changes LUF and
therefore which frequencies score well. We ask for it in plain language ("Are you
near power lines, in a neighborhood, out in the country?") and default to
`residential`.

### `AntennaProfile`
Deliberately layered so a beginner isn't blocked but an expert isn't limited:

1. **Simple class** (default): dipole / vertical / random wire / mobile whip /
   beam, plus height in wavelengths or meters. We map to a canned pattern.
2. **Takeoff angle override** for users who know theirs.
3. **Pattern file** (VOACAP `.13`-style or exported NEC) — Phase 3+.

Antenna choice drives takeoff angle, which drives hop count and therefore which
frequencies work over a given distance. Getting this "good enough by default" is a
core usability requirement — VOACAP Online's antenna form is exactly the kind of
wall we're trying to remove.

### `Circuit`
The thing being predicted.

```
Circuit
  tx: Station | Position
  rx: Position | { azimuth, distance }   # point-to-point OR directional
  mode: CW | SSB | AM | FT8 | FT4 | PSK31 | ALE | custom
  required_snr_db          # derived from mode, overridable
  path: short | long       # great-circle short vs long path
  derived: distance_km, azimuth_deg, control_points[]
```

**Required SNR by mode** — table shipped as *config*, not code (see
`05-engineering-principles.md`), and **calibrated in Phase 0** against the engine's
own conventions rather than trusted from memory:

| Mode | Required SNR | Confidence |
|---|---|---|
| CW | ~24 dB-Hz | Well-established VOACAP convention |
| SSB (intelligible) | ~38–49 dB-Hz depending on quality target | Range, needs a product decision on "usable" |
| FT8/FT4 | very low (decodes below the noise floor) | Must be converted carefully into the engine's dB-Hz convention |
| ALE / data | varies | Per-waveform, Phase 2+ |

Mode choice can swing a frequency from "closed" to "excellent" — the same path
that fails for voice may be trivially workable with FT8. Surfacing that
("this won't work for SSB, but would for FT8") is a genuinely useful feature.

### `FrequencyPlan` / `Channel`
The feature that makes HFKit useful beyond ham radio.

```
FrequencyPlan
  id, name ("SHARES regional", "County ARES", "80m band")
  source: builtin | user | imported | shared
  channels: [Channel]

Channel
  label ("CH 3", "NCS Primary")
  freq_mhz
  mode?, bandwidth?, usage_notes?
  time_of_day_hint?     # "night primary" — user metadata, not a prediction
```

Built-in plans ship as data: amateur band plans by ITU region, plus common
public-interest channel sets where publicly documented. Users can create arbitrary
plans, and every plan gets scored channel-by-channel — this is the "score MY
frequencies" requirement, generalized.

### `Prediction` / `ScoreResult`
```
ScoreResult
  circuit_ref, freq_mhz, valid_at, horizon_minutes
  score: 0..100
  components: [{ name, value, confidence, explanation }]
  gates_applied: [{ name, factor, reason }]
  data_ages: { model, iono, disturb, activity }
  schema_version
```
Data ages ride with every result so the UI can always show freshness without a
second lookup — a direct consequence of the "never hide uncertainty" principle.

### `SavedPath`, `Alert`
User-saved circuits for the dashboard and (Phase 4) push notifications
("20 m to VK predicted to open 02:00–04:00Z").

## 3. Glossary

Also becomes user-facing tooltip copy — writing definitions once, in plain
language, is part of the "plain English first, jargon on hover" principle.

| Term | Plain-language definition |
|---|---|
| **MUF** | Maximum Usable Frequency — the highest frequency that still bounces back to earth on a path. Above it, signals pass into space. |
| **LUF** | Lowest Usable Frequency — below this, the signal is absorbed before it gets anywhere. |
| **FOT** | Frequency of Optimum Transmission — the reliable sweet spot, roughly 85% of the MUF. |
| **foF2** | The F2 layer's critical frequency measured straight up; the basis for calculating MUF at a distance. |
| **SFI** | Solar Flux Index (10.7 cm) — proxy for solar activity. Higher generally means higher usable frequencies. |
| **Kp / Ap** | Geomagnetic disturbance indices. High Kp means storms, which wreck high-latitude paths. |
| **SSN** | Sunspot number — the traditional solar activity driver for prediction models. |
| **SID** | Sudden Ionospheric Disturbance — a solar flare knocking out HF on the daylight side, minutes to hours. |
| **D layer** | Lowest ionospheric layer. Absorbs low frequencies in daytime — why 80 m is a night band. |
| **F2 layer** | The layer that does the useful long-distance reflecting. |
| **Gray line** | The sunrise/sunset terminator; propagation along it is often enhanced. |
| **Hop** | One bounce off the ionosphere. Longer paths need multiple hops. |
| **Takeoff angle** | The vertical angle at which your antenna radiates — low angles for distance, high for local. |
| **NVIS** | Near Vertical Incidence Skywave — deliberately straight up and back down for regional coverage out to a few hundred km. Critical for EMCOMM, poorly served by DX-oriented tools. |
| **Reliability (REL)** | The prediction engine's probability that the signal is strong enough on a given day. |
| **A-score** | HFKit's 0–100 estimate combining prediction, live ionosphere, disturbances, and observed activity. |

**NVIS deserves explicit product support** — regional emergency nets live on it,
it's the dominant use case for county/state EMCOMM, and mainstream DX-focused
tools treat it as an afterthought. Supporting short paths and high takeoff angles
well is a differentiator, not an edge case.

## 4. Deliberately deferred

Named here so they don't sneak in: multi-hop path visualization detail, antenna
pattern modeling beyond classes, ALE waveform-specific link quality, sporadic-E
nowcasting, transmitter/receiver equipment databases.
