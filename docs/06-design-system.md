# Design System & Theming

Decided in planning because theming is only cheap if it's built in from the first
component. Goals: **one central theme source, a mostly-reskinnable app, and a
deliberate visual identity** — explicitly *not* the default "AI app" look.

---

## 1. Visual direction

### What we are avoiding (the "AI theme board")
- Glowing/neon elements, drop-shadow "glow" states, animated gradient blobs
- The purple→indigo→cyan gradient family on near-black
- Glassmorphism (frosted translucent cards), floating orbs, particle fields
- Gratuitous rounded-everything + oversized hero typography with gradient text
- Decorative animation that doesn't communicate data

### First theme: **flat & contrasty** ("Field" theme)
- **Flat surfaces:** solid fills, 1px borders or spacing for separation — not
  shadows and blur. Depth conveyed by border + background-step, sparingly.
- **High contrast:** WCAG AA minimum, AAA for primary text. This is a tool read
  at arm's length in a truck, a field table, or a dim shack — legibility is the
  aesthetic. Dark theme is the default; a proper light theme ships same day
  (daylight/outdoor use is a real HF use case, not an afterthought).
- **Utilitarian references:** instrument panels, aviation/marine chart plotters,
  NOAA weather products, Swiss/international style — not SaaS landing pages.
- **Restrained accent use:** one accent color for interaction; status colors
  (good/degraded/poor/stale) reserved exclusively for data meaning. If everything
  is colorful, nothing is a signal.
- **Typography:** one legible UI sans + one tabular-figures mono for values
  (frequencies, UTC times, indices — columns must align). No display fonts.
- **Motion:** functional only (state change, data refresh pulse ≤150 ms). Nothing
  loops, nothing glows.

## 2. Theming architecture (central control, reskinnable by construction)

**Single source of truth:** design tokens in one versioned file
(`packages/theme/tokens.json`), WD3C design-tokens format. Everything else is
generated from it at build time:

```
tokens.json ──build──▶ CSS custom properties (web)
                     ▶ Tailwind theme config (web)
                     ▶ TS token object (charts, React Native)
                     ▶ MapLibre style JSON variants (map)
                     ▶ chart palette module (viz)
```

### Token layers (the part that makes reskinning safe)

1. **Primitives** — raw values, no meaning: `gray.100…900`, `blue.500`, spacing,
   radii, type scale.
2. **Semantic tokens** — meaning, referencing primitives: `surface.default`,
   `surface.raised`, `text.primary`, `border.subtle`, `accent.interactive`,
   `status.good/fair/poor/closed/stale`, `focus.ring`.
3. **Component tokens** (only where needed): `scorecard.bg`, `matrix.cell.gap`.

**Hard rule, lint-enforced:** components may only consume semantic/component
tokens. No raw hex, no primitive references, no Tailwind palette classes like
`bg-slate-800` in feature code. A "theme" is then just a complete semantic-token
set — reskinning = writing one file, not touching components. CI includes a
contrast check over every theme's token pairs.

- Themes ship as: `field-dark` (default), `field-light`, and a deliberately
  different third theme early (even a rough high-vis/red-shifted "night ops"
  variant) purely to prove the reskin path works before component count grows.
- Runtime switching via CSS custom properties on `:root` (web) and a theme
  context (React Native) — same semantic names on both platforms.

### Data-viz tokens (charts are part of the theme)

- Status ramp (band health), a colorblind-safe sequential ramp for continuous
  fields (MUF/coverage heatmaps), and a categorical set for multi-series charts —
  all defined in `tokens.json`, consumed by the chart library through one adapter.
  Redundant encoding (labels/patterns, not color alone) for status.

## 3. Maps (the hard part, handled honestly)

Maps resist theming; plan for "on-brand," not pixel-perfect:

- **MapLibre vector basemap styles are JSON** — we generate `basemap-dark.json` /
  `basemap-light.json` from the same tokens (land/water/label colors from
  `surface.*`/`text.*`). Start from a minimal open style (e.g. Protomaps basemap)
  and strip it: our basemap should be quiet, low-saturation context — the data
  layers are the loud part.
- **Data overlays** (MUF contours, coverage fills, spot density, gray line,
  great-circle arcs) are fully ours → fully tokenized.
- Legends, controls, popups: our components, themed normally.
- Accept the residual: raster tiles or third-party imagery won't match perfectly.
  Contained cost, documented, revisit per theme.

## 4. Customization surface (user-facing, later phases)

Token architecture gives user customization nearly for free, in increasing order:
theme picker (ships Phase 1 with dark/light) → density/font-size controls →
per-widget dashboard arrangement (module manifests already declare their cards —
see engineering principles doc) → saved layouts. A community theme format is a
parking-lot idea; the token file *is* the format.

## 5. Process

- Tokens + base components (button, card, scorecard, badge, matrix cell) are a
  **Phase 1 deliverable before feature screens** — a one-page living style guide
  (Storybook or a simple `/styleguide` route) renders every component in every
  theme and doubles as the reskin test.
- Any new component PR that hardcodes a color/space/size fails review; the lint
  rule makes it mostly automatic.
