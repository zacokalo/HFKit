# Legal, Data Terms & Privacy

Decided in planning because two of these constrain architecture (data terms can
force a source swap; privacy posture decides whether we build accounts at all),
and both are expensive to retrofit.

> **Open decisions — need your call.** Marked ⚠️ below. I've recommended defaults
> and built the plan so that changing them later is cheap.

---

## 1. License ✅ resolved

**MIT.** `LICENSE` is in the repo root; docs are covered by the same.

Rationale, given the project is free, unpaid, and overhead-averse: MIT is the
lowest-friction option in existence — no compliance surface, no copyleft
obligations to reason about, maximum reuse, and the most familiar license in
amateur radio software. Apache-2.0 was the alternative (it adds an explicit patent
grant) but that protection is close to irrelevant here and costs a longer, more
procedural file.

Notes:

- **This does not foreclose making money.** MIT permits selling hosted service,
  accepting donations/sponsorship, or dual-licensing later. As sole copyright
  holder you retain every option.
- **Trivially changeable right now**, while you're the only contributor — one
  commit. That stops being true once outside contributions arrive, since
  relicensing then needs every contributor's consent. If you want AGPL-3.0 (to
  guarantee nobody ships a closed fork) or Apache-2.0, say so and it's a one-file
  change.

## 1a. Commercial intent ✅ resolved

**Free tool, no charging, no revenue expected** — built primarily to be the tool
the author wanted to have. This resolves the largest legal risk in the plan:

- **GIRO's non-commercial terms are no longer a blocker.** This was the one ⚠️
  that could have forced a data-source swap. Non-commercial use is squarely within
  what GIRO, PSKReporter, and the rest are offered for.
- **Attribution and courtesy notification are now the entire obligation** for
  every source in the table below.
- The Tier 0 architecture (`11-operating-constraints.md` §3a) means our actual
  load on volunteer infrastructure is one fetch per 15 minutes — about as good a
  citizen as it's possible to be.

**If that ever changes** (paid tier, sponsorship that looks commercial, an
employer adopting it), revisit this section *first* — specifically GIRO. The
adapter isolation exists so that conversation stays cheap.

## 2. Upstream data terms audit

The mothership pattern (`05-engineering-principles.md`) already helps enormously
here: because we fetch once and redistribute processed derivatives, we have exactly
one place to enforce terms, and our traffic footprint on volunteer infrastructure
stays negligible.

| Source | Terms | Commercial use | Action required |
|---|---|---|---|
| **NOAA SWPC / NCEI** | US Government work — public domain | ✅ Yes | None. Attribute as courtesy. |
| **GIRO / DIDBase** | Free for research/non-commercial | ✅ N/A — we're non-commercial | Attribute and cite. Revisit only if the project ever monetizes. |
| **KC2G grids** | Open-source project (WWROF-funded), community goodwill | ✅ Non-commercial | **Still email KC2G before public launch** — courtesy, not licensing. His server isn't built for third-party load, and at Tier 0 we're one fetch per 15 min, which is an easy conversation to have. |
| **PSKReporter** | Public MQTT broker, community norms | ✅ Non-commercial | Respect rate limits, identify our client, attribute. |
| **wspr.live** | Free including commercial, with attribution + notification | ✅ Yes | Attribute; notify the operator. Keep queries bounded. |
| **RBN** | Free feeds, attribution expected | ✅ Generally | Attribute. |
| **ITURHFProp / voacapl / dvoacap-python** | Open source | ✅ Check each license | Verify exact license of the engine we pick; vendor the notice. |
| **IRI model** | Publicly available scientific model | ✅ Yes | Cite the model version. |
| **OSM / Protomaps basemaps** | ODbL | ✅ With attribution | Attribution control on every map view — non-negotiable, it's a license term. |

**Architectural consequence:** every upstream sits behind a thin adapter with the
license recorded in its manifest, so a terms problem means swapping one adapter,
not rewriting features. If GIRO commercial terms turn out restrictive, the fallback
is IRI-only climatology plus our own spot-derived corrections — degraded, but the
product still functions.

**Action item before public launch:** an in-app **Data Sources page** listing every
source, its license, its attribution, and its live freshness. This satisfies legal
obligations *and* doubles as the transparency/status surface from the resilience
plan — one page, two jobs.

## 3. Privacy posture

HF planning data is unusually sensitive for a hobby-adjacent app, and it's worth
being deliberate:

**Location is precise and personal.** A station location is someone's home or an
operational site, at street-level precision. For EMCOMM/deployed use, aggregated
station locations could reveal operational posture.

**Callsigns are identifiers, not handles.** In the US, a callsign resolves via the
public FCC ULS database to a legal name and street address. Treating a callsign as
a harmless nickname is a mistake — it is effectively PII.

### Rules

1. **Local-first by default.** Stations, frequency plans, and saved paths live in
   local storage. **No account required to use the entire app.** This is both a
   privacy win and a UX win (no signup wall) and is why accounts are deliberately
   Phase 3, optional, and sync-only.
2. **Callsign is optional, always.** Never required to compute anything — the
   prediction engines don't need it.
3. **Never transmit precise location to upstreams.** The mothership pattern makes
   this structural: clients talk only to us, so no third party ever sees user
   positions. Point-to-point requests to our own API are coordinate-bearing but
   **not logged with coordinates** beyond a short cache TTL, and are cached by
   rounded grid rather than exact position.
4. **Analytics: aggregate and coarse or not at all.** No per-user location
   telemetry. If we need usage metrics, they're counts of feature use, not places.
5. **Offline/field mode never phones home** beyond fetching public bundles —
   important for the deployed-operator use case, where traffic patterns themselves
   can be revealing.
6. **Retention:** prediction request logs ≤ 30 days, without precise coordinates.
   Aggregated spot data has no user dimension at all.

### If accounts ship (Phase 3)
Email + password or OAuth; store the minimum; export and delete-account must both
work from day one; a plain-language privacy policy written before the feature ships,
not after. GDPR/CCPA compliance is genuinely easy *if* we stay local-first — which
is a strong argument for keeping accounts optional permanently.

## 4. Liability & disclaimers

The uncomfortable one: **people may use this for emergency communications
planning.** That means a wrong "Excellent" score could contribute to a failed
comms plan during an actual emergency.

- Clear disclaimer: predictions are estimates, not guarantees; always have
  alternate frequencies and a fallback plan.
- Reinforced by design, not just legal text: the scoring spec deliberately
  penalizes false-confidence errors harder than pessimistic ones
  (`07-scoring-spec.md` §5), we always show data age and confidence, and degraded
  data states are labeled rather than silently smoothed over.
- Never present a forecast beyond the nowcast horizon with nowcast-like certainty.
- If a commercial/professional tier ever targets safety-of-life use, that requires
  a different conversation entirely — and probably different data sources with
  service guarantees.

## 5. Trademark / naming

"HFKit" — quick clearance check against existing radio software before we invest
in branding. Low risk, low cost to check now, expensive to discover after an app
store listing.
