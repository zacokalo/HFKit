# Existing Tools Landscape

What's already out there, what each does well, and the gap HFKit fills.
Last reviewed: 2026-08-01.

## The incumbents

### VOACAP Online (voacap.com)
- **What:** the gold-standard point-to-point and area predictions, free web UI. Prediction wheel, REL/SNR charts, coverage maps.
- **Strengths:** trusted engine, comprehensive options (antennas, power, mode).
- **Weaknesses:** 2005-era UX, form-heavy, jargon-first, no live data fusion (pure climatological model — it predicts a *median month*, not *today*), not mobile-friendly.

### prop.kc2g.com (KC2G MUF maps)
- **What:** beautiful near-real-time global MUF(3000)/foF2 maps assimilating live ionosonde data. Open source.
- **Strengths:** the best "what is the ionosphere doing *right now*" view that exists.
- **Weaknesses:** single-purpose — no path planning, no frequency scoring, no per-user context. It's a map, not a planner.

### HamClock
- **What:** beloved shack-display appliance (Raspberry Pi/ESP32): gray line, indices, VOACAP overlays, DX spots.
- **Strengths:** great information density; proof there's appetite for a "glanceable" propagation dashboard.
- **Weaknesses:** appliance UX, small fixed-resolution UI, setup burden, not a planning tool, not mobile/web-native.

### Proppy (soundbytes.asia/proppy)
- **What:** web front-end for ITU-R P.533 (ITURHFProp). Point-to-point, area, and planning charts.
- **Strengths:** the ITU-standard engine with a simpler UI than VOACAP Online; open source.
- **Weaknesses:** still form-driven, dated visuals, no live data, no mobile app.

### DR2W DX Propagation
- **What:** pre-computed VOACAP SNR world maps from several TX regions, by band/hour.
- **Strengths:** zero-input glanceability.
- **Weaknesses:** only from fixed TX sites, not personalized, static images.

### HamQSL / N0NBH solar widget
- **What:** the ubiquitous solar-terrestrial data banner embedded in thousands of ham sites.
- **Strengths:** proves demand for at-a-glance condition summaries.
- **Weaknesses:** its "band condition" (Good/Fair/Poor) labels are notoriously coarse and location-blind — a frequent community complaint and exactly what a proper A-score should replace.

### Mobile apps (Ham Clock apps, "Solar Monitor"-style index viewers, DX Toolbox, etc.)
- Mostly index dashboards: they show SFI/Kp/A numbers and maybe the N0NBH banner. Few do real path prediction; none fuse live spot data with a model; visual quality varies widely.

### Live-spot analytics (pskreporter.info map, wspr.rocks, DXHeat/DXMaps)
- **Strengths:** real observed propagation, powerful filters.
- **Weaknesses:** raw spot dumps; the user must infer conditions themselves. No forecasting, no scoring, no planning.

## Adjacent prior art worth studying
- **pythonprop** — how to drive voacapl for point-to-point and area plots.
- **KC2G's `prop` repo** — the assimilation pipeline (IRI + ionosonde + GP regression) we'd eventually self-host.
- **ham-stats.com** — recent example of fusing PSKReporter MQTT into live band analytics.

## The gap (HFKit's thesis)

| Capability | VOACAP Online | KC2G | HamClock | Spot maps | **HFKit** |
|---|---|---|---|---|---|
| Modern, mobile-first UX | ✗ | ~ | ✗ | ~ | ✅ |
| Band health now + forecast timeline | ✗ | now only | ~ | now only | ✅ |
| **Score for *your* frequencies** | ✗ | ✗ | ✗ | ✗ | ✅ |
| Point-to-point planning on a map | ~ (forms) | ✗ | ✗ | ✗ | ✅ |
| Coverage/"reach" map from your QTH | ~ (forms) | ✗ | ~ | ✗ | ✅ |
| Model **fused with live data** | ✗ | ionosondes only | ✗ | spots only | ✅ |
| Phone app | ✗ | ✗ | ✗ | ✗ | ✅ |

Nobody combines **prediction + live ionosphere + live spots** into **personalized,
map-first planning**. Every ingredient exists and is open; the product gap is real.
The N0NBH banner's popularity *despite* its coarseness shows how much demand there
is for a better at-a-glance answer.
