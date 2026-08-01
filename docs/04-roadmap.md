# Roadmap

Phased so that every phase ships something usable and de-risks the next one.
Durations assume nights-and-weekends effort by 1–2 people; compress accordingly.

---

## Phase 0 — Feasibility spike ✅ COMPLETE (2026-08-01)

Goal: prove the risky parts with throwaway code. **No product code.**

- [x] Run **dvoacap-python** and **ITURHFProp** on the same 10 reference circuits; compare outputs to VOACAP Online / voacapl. Pick the primary engine.
- [x] ⭐ **WASM spike — YES.** ITURHFProp compiles under Emscripten and produces output numerically identical to the native build, at 0.886 ms/prediction from a 201 KB `.wasm`. Per-user prediction compute leaves the backend entirely and offline mode comes free. See [ADR-0001](adr/0001-prediction-engine.md).
- [x] Benchmark: single point-to-point latency; 5°-grid area prediction wall time on one core / N cores. → 348 ms/circuit (dvoacap), ~14 s for a 2,520-point global grid on 4 cores at 86% parallel efficiency.
- [x] Fetch + parse the SWPC JSON products; confirm update cadences. → 10 products working.
- [x] ⚠️ **No public KC2G grid endpoint exists** — only rendered SVGs. Found `api/essn.json` (assimilated effective SSN/SFI at 15-min cadence) instead, which is a *better* input since SSN is what P.533 actually consumes. Courtesy email to KC2G still owed before public launch.
- [ ] ❌ **PSKReporter MQTT blocked in sandbox** (:1883 unreachable, no public HTTP API found). Must be validated on real infrastructure. Phase 1 does not depend on it — it powers the lowest-weighted A-score component, which is designed to drop out cleanly.
- [x] Query wspr.live and sketch the backtest method. → Live queries confirmed; `wspr.rx` schema recorded.
- [x] Build the A-score validation harness. → Works end to end; ⚠️ **requires base-rate correction** (positives were oversampled 5.665×, so uncorrected calibration metrics measure the wrong distribution). See `spike/wspr-backtest/`.
- [x] **Exit criteria met:** engine picked (ADR-0001), client-side prediction answered **yes**, area-map compute budget known, data sources demonstrated end-to-end (except PSKReporter, blocked by sandbox).

## Phase 1 — MVP web app: "Conditions + Planner" (6–10 weeks) 🌐

The smallest thing better than what exists. **Infrastructure target: Tier 0 —
scheduled job + static hosting, no always-on server, no database**
(see [11-operating-constraints.md](11-operating-constraints.md) §3a).

- [ ] Repo scaffolding: FastAPI + workers + Postgres/Timescale + Redis; React + MapLibre front-end; CI (incl. lint rules for the token-only styling contract).
- [ ] **Design system first:** `tokens.json` + generated CSS/Tailwind/TS/MapLibre outputs, `field-dark` + `field-light` themes, base components, living style guide page (see [06-design-system.md](06-design-system.md)).
- [ ] **Module + bundle skeleton:** core/module layout, feature flags, versioned bundle publisher + CDN caching in place before the first feature module lands (see [05-engineering-principles.md](05-engineering-principles.md)).
- [ ] Ingestion live: SWPC indices + alerts, KC2G/ionosphere grids — behind per-source adapters with circuit breakers and staleness flags.
- [ ] **Dashboard screen:** per-band health scores (model + ionosphere + disturbance components; no live-spot component yet), 24h forecast sparklines, indices with plain-English tooltips.
- [ ] **Path planner screen:** two pins on a map, gray line + great circle, hour × frequency reliability matrix, "best frequencies right now / best window today."
- [ ] Responsive + PWA installable from day one.
- [ ] Deploy publicly (soft launch), attribution page.
- **Exit criteria:** a stranger can answer "is 40 m any good to Europe from my QTH tonight?" in under 30 seconds on their phone.

## Phase 2 — The A-score & live layer (4–8 weeks) 📡

The differentiating feature. Moves us to **Tier 1** (one always-on process) — and
because A-score components drop out cleanly with weights renormalizing, the live
layer stays **switch-off-able** if it's ever not worth the cost or upkeep.

- [ ] PSKReporter MQTT aggregation pipeline → live activity API + map layer (spot density by band).
- [ ] **User frequency lists:** arbitrary channels (ham/EMCOMM/ALE-style), grouped, saved locally (accounts optional/later).
- [ ] **A-score v1** on frequencies and bands: full four-component blend, with "why this score" breakdown UI.
- [ ] Backtest report vs wspr.live history; tune weights; publish the methodology (transparency = credibility in this community).
- [ ] Storm/flare event handling: SID detection from GOES X-ray → immediate daytime HF degradation on affected paths.
- **Exit criteria:** A-score demonstrably beats N0NBH-style banners in backtest and users can score their own channel plans.

## Phase 3 — Coverage maps + self-hosted ionosphere (4–8 weeks) 🗺️

- [ ] Area prediction jobs: "from here on 14.230 MHz at 100 W, where can I reach at 02:00?" — async compute, cached, time scrubber UI.
- [ ] Precomputed coverage for the user's saved QTH refreshed on schedule.
- [ ] Stand up our own GIRO→assimilation pipeline (KC2G's open-source approach) to remove the dependency on his server; fall back gracefully IRI-only.
- [ ] Optional accounts + sync (saved QTHs, paths, frequency lists).
- **Exit criteria:** coverage map returns in seconds warm / <1 min cold; ionosphere layer survives a KC2G outage.

## Phase 4 — Mobile: PWA first, then native (6–10 weeks) 📱

**PWA ships first regardless** — it's the same codebase, costs nothing extra, and
validates on-device prediction on real phones before any native work starts.
Native then follows, justified by capabilities a PWA genuinely cannot match (see
[11-operating-constraints.md](11-operating-constraints.md) §4 for the reasoning
and the honest maintenance budget).

### 4a — PWA hardening
- [ ] Offline-first bundle caching, install prompt, home-screen presence, tested with the radio off.
- [ ] Verify on-device WASM prediction performance on mid-range phones.
- [ ] Field/portable mode: full planning from the last downloaded bundle.
- [ ] **Measure iOS storage retention** — confirm whether cached bundles survive on an installed PWA across days of non-use. This is a functional test, not a nicety: if bundles get evicted, the offline promise breaks exactly when it matters most.

### 4b — Native (Expo/React Native)
Dev accounts for both stores are already active, so the marginal cost is
engineering time, not fees.

- [ ] Expo app sharing the TS client, design tokens, and the WASM engine.
- [ ] **Home-screen widgets** — the band-health glance. Native-only, and arguably the single most-used surface of the whole product: the thing that replaces the N0NBH banner habit.
- [ ] **Guaranteed offline storage** — an app container the OS won't evict, closing the risk measured in 4a.
- [ ] **Reliable background refresh** so bundles are current when opened without signal.
- [ ] Push notifications for saved paths and storm alerts. *(Note: web push now works on Android and on iOS 16.4+ for installed PWAs, so this is no longer a native exclusive — it's a reliability upgrade, not a new capability.)*
- [ ] Store release. Use **Expo OTA updates** so routine JS changes ship without review; reserve store submissions for native-module changes.

## Phase 5 — Polish & advanced (ongoing) ✨

Ideas parking lot, strictly after 0–4:
- Learned A-score correction (train on wspr.live outcomes).
- Antenna modeling depth (pattern files vs simple classes), takeoff-angle awareness.
- Net/sked planning: "best common frequency for these 5 stations at 01:00."
- Shared/team frequency plans (EMCOMM groups), exportable briefs (PDF "comms plan").
- RBN integration, CW-specific views; contest mode.
- Public API for the community; HamClock-style kiosk view as a nod to the incumbents.
- Sporadic-E nowcasting (hard, separate research spike).

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GIRO/ionosonde feed outage (post-2024 NOAA shutdown, single pipe) | Med | High | Cache, IRI-only fallback with UI staleness badge, mirror INGV/BOM, Phase-3 self-hosted pipeline |
| KC2G endpoints not meant for third-party load | Med | Med | Ask first, cache hard, Phase-3 self-hosting removes dependency |
| Area predictions too slow/costly at scale | Med | Med | Coarse grids + precompute + cache; measured in Phase 0 before committing |
| dvoacap-python accuracy gaps (young port) | Med | Med | Phase-0 validation vs voacapl; ITURHFProp as swap-in alternative |
| PSKReporter rate/volume handling | Low | Med | MQTT (push, not poll), aggregate-only storage |
| Scope creep (this domain is bottomless) | High | High | The phase gates above; parking lot for everything else |
| Solar cycle 25 declining → worsening high-band conditions reduce casual interest | Low | Low | Planner value is highest when conditions are marginal — lean into that |

## Guiding principles

1. **Plain English first, jargon on hover.** "40 m to Europe: good after sunset" beats "REL 0.72 @ 0400Z."
2. **Never hide uncertainty.** Show data age and forecast confidence; degraded mode is labeled, not silent.
3. **Precompute everything expensive.** The user should never wait on Fortran-era math.
4. **Be a good upstream citizen.** Attribute, ask, cache, and eventually contribute back (our assimilation improvements, validation suites).
5. **One score, explainable.** Every A-score can be expanded into its four components.
6. **Clients never talk to upstreams.** All data flows through the mothership and out via cacheable bundles — upstream load stays O(1) no matter how many users we have.
7. **Theme from tokens, features from modules.** No hardcoded colors, no cross-module imports — reskins and new features must never require refactoring.
8. **Bounded by design, fixed by price.** Every resource has a designed ceiling and the infrastructure is fixed-price, so the worst case when unattended is "slow," never "expensive" or "disk full."
9. **Match the cadence to the physics.** HF conditions move on 15-minute timescales; refreshing faster costs orders of magnitude more and tells users nothing new.
