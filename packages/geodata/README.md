# @hfkit/geodata

Static geographic data bundled with the app so location input and the map work
**with no network at all**. See [ADR-0002](../../docs/adr/0002-offline-geocoding.md)
for why this is bundled rather than fetched from a geocoding or tile service.

| File | Contents | Size | Gzipped |
|---|---|---|---|
| `data/coastline.geojson` | Natural Earth 110m coastlines, coordinates rounded to 2 dp | 92 KB | 30 KB |
| `data/gazetteer.json` | GeoNames `cities15000` — 34,065 places, population ≥ 15,000 | 1.49 MB | 0.62 MB |

## Gazetteer shape

Compact arrays rather than objects, to keep the file small:

```json
{ "fields": ["name","country","admin1","lat","lon","pop"],
  "places": [["Tokyo","JP","40",35.6895,139.6917,8336599], ...] }
```

Sorted by population descending, so a naive prefix match already surfaces the
most likely intent first ("London" → London, UK).

## Regenerating

Both are derived from public datasets and are regenerated, not hand-edited:

- Coastline: `raw.githubusercontent.com/nvkelso/natural-earth-vector` →
  `geojson/ne_110m_coastline.geojson` (public domain)
- Gazetteer: `download.geonames.org/export/dump/cities15000.zip`
  (CC BY 4.0 — **attribution required in-app**)

## Licensing

- **Natural Earth** — public domain, no attribution required (but courteous).
- **GeoNames** — Creative Commons Attribution 4.0. Attribution is a licence
  condition, so it must appear on the Data Sources page alongside NOAA, KC2G and
  wspr.live (`docs/09-legal-privacy.md` §2).
