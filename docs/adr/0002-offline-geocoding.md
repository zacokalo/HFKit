# ADR-0002: Location input is fully offline — bundled gazetteer, no geocoding API

**Status:** Accepted
**Date:** 2026-08-01

## Context

The path planner needs a user to set two endpoints. Operators think about
location in several notations, and asked for all of them: decimal coordinates,
Maidenhead grid locator, place name, postal code, street address, and clicking a
map.

Most of these are trivial and local — coordinates and Maidenhead are pure
arithmetic, and a map click is a pixel-to-lat/lon transform. **Place name,
postal code, and street address are different: they normally require a geocoding
service.** That collides with three commitments already made:

1. **Clients never contact upstream services** (`docs/05-engineering-principles.md`
   invariant #2). A browser calling Nominatim directly is exactly the pattern the
   mothership design exists to prevent, and it would put our load on a
   volunteer-run service in proportion to our user count.
2. **Tier 0 has no server** (ADR-0001, `docs/11-operating-constraints.md` §3a).
   Since Phase 1 publishes static files and nothing runs at request time, there
   is no proxy to route a geocoding request through even if we wanted one.
3. **Offline operation is the primary use case.** The EMCOMM/field operator we
   are building for has no cell signal. A search box that only works with
   connectivity fails precisely when the tool matters most.

## Decision

**Ship a bundled gazetteer and geocode entirely on-device. Do not integrate a
geocoding API. Do not support street addresses.**

Concretely:

| Input method | How | Precision |
|---|---|---|
| Decimal coordinates | Local parse | Exact |
| Maidenhead locator | Local arithmetic, both directions | Grid-square centre |
| Map click | Local projection transform | Exact |
| **Place name** | **Bundled gazetteer, prefix-indexed in the client** | City-level |
| Postal code | Bundled postal dataset, per country, *if* demand appears | Postcode-area centroid |
| ~~Street address~~ | **Not supported** | — |

The gazetteer is GeoNames `cities15000` (population ≥ 15,000), reduced to name,
country, admin1, lat, lon, population: **34,065 places, 1.49 MB raw / 0.62 MB
gzipped.** It is published as a static bundle, cached indefinitely like every
other immutable artifact, and adds nothing to per-search cost because there is no
per-search request.

The basemap follows the same logic: **Natural Earth 110m coastlines, 92 KB raw /
30 KB gzipped**, rendered as vectors. No tile server, no external style URL.
HF path planning does not need street-level cartography — a coastline, a
graticule, the great-circle path and the terminator are the whole useful picture.

## Consequences

**Easier:**
- The planner works with the network off, which is the field use case.
- No API keys, no rate limits, no per-search cost, no third-party dependency that
  can disappear or change terms.
- User locations never leave the device — the privacy posture in
  `docs/09-legal-privacy.md` is enforced structurally rather than promised.
- Search is instant: an in-memory index beats a network round trip.

**Harder / accepted limits:**
- **No street addresses.** Someone typing "1600 Pennsylvania Ave" gets nothing.
  This is a deliberate trade, and the physics justifies it: a city-level fix is
  accurate to ~10 km, and 10 km on a 5,000 km circuit changes the predicted MUF
  by an amount far below the model's own uncertainty. Street precision would be
  false precision.
- **Towns under 15,000 people are absent.** Mitigation: coordinates, grid
  locator, and map click all still work, and any of them is more precise than a
  place name anyway. If this proves annoying, `cities5000` roughly doubles the
  entry count for a modest size increase.
- The gazetteer is a snapshot and will drift as places are renamed. It is
  regenerated with the bundles; staleness here is measured in years and is
  harmless.

**Cost of reversal:** low. If a hosted tier ever exists and street-level search
is genuinely wanted, a geocoding proxy can be added server-side at that point
without changing anything about how the client asks for a location — the input
control already abstracts over methods.

## Alternatives considered

- **Call Nominatim (or similar) from the browser.** Rejected: violates the
  never-contact-upstreams invariant, breaks offline, and is discourteous to a
  volunteer service at any real user count.
- **Proxy geocoding through our own backend.** Rejected for Phase 1: there is no
  backend at Tier 0, and adding one to support a convenience input would forfeit
  the entire cost model for a feature the physics does not need.
- **Ship a full address-level dataset** (e.g. OpenAddresses). Rejected: hundreds
  of megabytes to gigabytes for precision the prediction model cannot use.
- **Vector basemap tiles from OpenFreeMap/Protomaps.** Rejected for now: a live
  tile source is an external runtime dependency and breaks offline. Natural Earth
  coastlines are sufficient at the zoom levels HF path planning uses. Revisit
  only if a genuine need for detailed cartography appears.
