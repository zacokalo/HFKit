# @hfkit/theme

Single source of truth for all HFKit styling. `tokens.json` is the only file
you edit by hand; CSS custom properties, a Tailwind theme, typed TypeScript
tokens, and MapLibre basemap styles are all generated from it. Reskinning the
app means editing this one file — see `docs/06-design-system.md` for the
product rationale.

Visual direction: flat, high-contrast "Field" instrument-panel aesthetic —
explicitly not the glassy/neon/purple-cyan "AI app" look. Read
`docs/06-design-system.md` before adding tokens or themes.

## Token layers (the rule that makes reskinning safe)

`tokens.json` is [W3C Design Tokens format](https://design-tokens.github.io/community-group/format/)
(`$value` / `$type`), organized into three strictly separated layers:

1. **`primitive`** — raw values, no meaning: color scales (`gray.50…975`,
   `blue.*`, `green.*`, …), `spacing`, `radius`, `borderWidth`, `fontFamily`,
   `fontSize`, `fontWeight`, `lineHeight`, `duration`, `easing`. Never
   consumed directly by components.
2. **`semantic`** — meaning, referencing primitives (`{primitive.color.gray.900}`).
   One block per theme (`semantic.field-dark`, `semantic.field-light`,
   `semantic.night-ops`, …), but every theme declares the **identical set of
   keys** (`surface.default`, `text.primary`, `status.good.fill`, …). That
   identical shape is the whole trick: a theme is just a value substitution,
   never a shape change.
3. **`component`** — defined **once** (not per theme), referencing semantic
   tokens generically (`{semantic.surface.raised}`). The generator resolves
   each component token inside every theme's context, so one definition
   yields the right concrete value under every theme. Only add a component
   token when a component genuinely needs a value the semantic layer doesn't
   already express (see `component.card`, `component.button`, `component.badge`,
   `component.dataRow`, `component.focusRing`, `component.map`).

**Hard rule:** application/component code may only consume `semantic.*` and
`component.*` tokens (as CSS vars, Tailwind utilities, or the TS `themes[name]`
object) — never `primitive.*`, never a raw hex value, never a Tailwind
palette class like `bg-slate-800`. If a component needs a new value, add a
semantic or component token for it; don't reach past the layer.

`dataviz.*` holds the chart palettes (status ramp lives in `semantic.status`,
but the sequential/categorical chart palettes live here) — see
"Data-viz tokens" below.

## Themes shipped

| Theme | Role | Palette family |
|---|---|---|
| `field-dark` | **Default.** Dark instrument panel. | Neutral `gray` + `blue` accent + green/amber/orange/red/slate status |
| `field-light` | First-class daylight theme (bright field table / truck cab in sun), not a washed-out afterthought. | Same families, re-tuned for a white surface |
| `night-ops` | Deliberately different third theme — red-shifted, night-vision-preserving. Proves the reskin path works. | A wholly separate `ember` neutral scale + `signal` warm hues. **No blue or green anywhere** — enforced by a test (`test/resolve.test.mjs`). |

`field-dark` and `field-light` share their `dataviz.sequential` /
`dataviz.categorical` palettes on purpose — those encode a physical quantity
(MUF, coverage, band identity), not app chrome, so they don't change with a
reskin. `night-ops` swaps in warm-only equivalents for the same reason its
semantic tokens differ (real operational constraint: preserve dark adaptation).

## How to add a token

1. Add the primitive value (if new) under `primitive.*` in `tokens.json`.
2. Add the semantic (or component) key referencing it, **in every theme
   block** — `test/resolve.test.mjs` fails if a theme is missing a key another
   theme has.
3. Run `npm run generate` (or `npm run build`) and `npm run validate`.
4. If it's a text/background pairing, add a row to the `pairs()` list in
   `scripts/validate.mjs` (and mirror it in `test/contrast.test.mjs`) so it's
   actually gated, not just present.

## How to add a theme

1. Duplicate an existing `semantic.<theme-name>` block in `tokens.json` and
   retune every value — keep exactly the same keys.
2. Add a matching `dataviz.<theme-name>` block (reuse the shared primitives if
   the theme doesn't have a functional reason to diverge, like `night-ops`
   does).
3. Run `npm run validate` and fix any failing pairing by changing the color —
   **never loosen the threshold** (see the repo's `CLAUDE.md`: sanity gates
   are not to be loosened, only the underlying data — here, the color — is to
   be fixed).
4. Run `npm run build` to regenerate CSS/Tailwind/TS/MapLibre and the style
   guide, and eyeball `styleguide.html` with the new theme selected.

No other file needs to change — components read `semantic.*`/`component.*`
names that are identical across every theme.

## Data-viz tokens

- **Status ramp** (`semantic.status.{good,fair,poor,closed,stale}`) — each has
  `fill` (badge background), `on` (label text on the fill), and `text`
  (standalone colored label/icon on `surface.default`, no fill). Status is
  never color-only: the style guide's badges pair color with a shape glyph
  (`●▲◆✖○`) and an uppercase label, and components should keep doing the same.
- **Sequential ramp** (`dataviz.sequential`, 8 stops) — colorblind-safe
  blue→gray→yellow ramp (cividis family, monotonic lightness, no red/green
  transition) for continuous fields like MUF and coverage heatmaps.
  `night-ops` uses a single-hue, lightness-only warm ramp instead — the
  simplest possible colorblind-safe strategy, kept inside the red-shifted
  palette.
- **Categorical palette** (`dataviz.categorical`) — the
  [Okabe–Ito](https://jfly.uni-koeln.de/color/) colorblind-safe 8-color set
  for multi-series charts. `night-ops` uses a warm-only 6-color equivalent.

## Generators (`npm run build`)

```
tokens.json ──node scripts/generate.mjs──▶ dist/tokens.css            (:root + [data-theme="…"] blocks)
                                         ▶ dist/tailwind.theme.mjs    (theme.extend consuming the CSS vars)
                                         ▶ src/generated/tokens.ts    (typed export, compiled by tsc)
                                         ▶ dist/maplibre/basemap-*.json
            ──node scripts/build-styleguide.mjs──▶ styleguide.html
```

```bash
npm run generate   # tokens.json -> dist/tokens.css, dist/tailwind.theme.mjs, src/generated/tokens.ts, dist/maplibre/*.json
npm run styleguide # tokens.json -> styleguide.html (open it directly in a browser, it's self-contained)
npm run build      # generate + styleguide + tsc (full build; this is what CI runs)
npm run validate   # contrast gate -- see below
npm run test       # node:test -- token-shape integrity + contrast, as assertions
```

`src/generated/` and `dist/` are build output (gitignored) — run
`npm run build` after cloning before importing `@hfkit/theme` from another
package.

### Consuming it

- **CSS:** `import "@hfkit/theme/tokens.css"`, then set
  `<html data-theme="field-dark">` (or call `applyTheme("field-dark")` from
  the package's runtime helper) to switch at runtime.
- **Tailwind:** `import { hfkitTheme } from "@hfkit/theme/tailwind"` and spread
  it into `theme.extend` in `tailwind.config`. Every value is a `var(--hf-*)`
  reference, so Tailwind utilities stay correct across a theme switch.
- **TypeScript:** `import { themes, getTheme, applyTheme, type ThemeName } from "@hfkit/theme"`.
  `themes[name]` is a fully-resolved, typed `ThemeTokens` object (concrete hex
  strings, not more references) — useful for chart libraries and, later,
  React Native, which can't read CSS custom properties.
- **MapLibre:** `dist/maplibre/basemap-<theme>.json` — a minimal, quiet,
  low-saturation style. `sources.basemap.tiles` is a placeholder; slot a real
  vector tile source in there (layer `source-layer` names assume a
  Protomaps-shaped schema — adjust if using a different tile schema). Data
  overlays (MUF contours, coverage, spot density, gray line, great-circle
  arcs) are deliberately not part of this style — they're the loud, fully-ours
  layer drawn on top.

## Contrast validation (`npm run validate`)

Computes the real WCAG 2.1 contrast ratio (relative luminance from sRGB,
`scripts/lib/color.mjs`, no dependency) for every meaningful
foreground/background **semantic** pairing, in every theme, and exits
non-zero if anything is below threshold:

- **4.5:1** for body text pairings (primary/secondary/muted text on every
  surface, badge label text on its fill, standalone colored status text).
- **3:1** for large-text/UI-boundary pairings (`accent.interactive` used as
  compact interactive chrome per WCAG 1.4.11 — not full paragraph text;
  `border.strong`, the one border weight that's ever the *sole* cue for a
  component boundary; `focus.ring`).

`border.subtle`/`border.default` are intentionally-low-contrast decorative
hairlines (row dividers, card edges) and are not gated — they're never the
sole means of conveying a boundary, so WCAG 1.4.11 doesn't apply to them.
`dataviz.sequential`/`dataviz.categorical` swatches are colorblind-safety
concerns (see above), not text-on-background pairs, so they're outside this
gate too.

**If a pairing fails, the fix is to change the color** — this gate is a
sanity gate per the repo's `CLAUDE.md` and is not to be loosened.

### Current results (all three themes, 66 pairings, all passing)

```
Theme        Pairing                                                         FG       BG       Ratio    Min    Result
-----------  --------------------------------------------------------------  -------  -------  -------  -----  ------
field-dark   text.primary on surface.default                                 #f4f5f5  #111213  17.17:1  4.5:1  PASS
field-dark   text.primary on surface.raised                                  #f4f5f5  #222326  14.39:1  4.5:1  PASS
field-dark   text.secondary on surface.default                               #b9bcc1  #111213  9.85:1   4.5:1  PASS
field-dark   text.secondary on surface.raised                                #b9bcc1  #222326  8.25:1   4.5:1  PASS
field-dark   text.muted on surface.default                                   #9ba0a6  #111213  7.12:1   4.5:1  PASS
field-dark   text.muted on surface.raised                                    #9ba0a6  #222326  5.97:1   4.5:1  PASS
field-dark   text.primary on surface.sunken                                  #f4f5f5  #0a0a0b  18.12:1  4.5:1  PASS
field-dark   accent.interactive on surface.default                           #4991d4  #111213  5.61:1   3.0:1  PASS
field-dark   accent.onAccent on accent.interactive                           #0a0a0b  #4991d4  5.92:1   4.5:1  PASS
field-dark   border.strong on surface.default                                #696f77  #111213  3.70:1   3.0:1  PASS
field-dark   focus.ring on surface.default                                   #6aa5dc  #111213  7.17:1   3.0:1  PASS
field-dark   focus.ring on surface.raised                                    #6aa5dc  #222326  6.01:1   3.0:1  PASS
field-dark   status.good.on on status.good.fill (badge label)                #ffffff  #1d7c49  5.21:1   4.5:1  PASS
field-dark   status.good.text on surface.default (colored label, no fill)    #49d48a  #111213  9.88:1   4.5:1  PASS
field-dark   status.fair.on on status.fair.fill (badge label)                #0a0a0b  #9d7925  4.90:1   4.5:1  PASS
field-dark   status.fair.text on surface.default (colored label, no fill)    #d4ab49  #111213  8.68:1   4.5:1  PASS
field-dark   status.poor.on on status.poor.fill (badge label)                #f4f5f5  #844b1f  6.39:1   4.5:1  PASS
field-dark   status.poor.text on surface.default (colored label, no fill)    #d48649  #111213  6.52:1   4.5:1  PASS
field-dark   status.closed.on on status.closed.fill (badge label)            #f4f5f5  #a53127  6.27:1   4.5:1  PASS
field-dark   status.closed.text on surface.default (colored label, no fill)  #d45549  #111213  4.64:1   4.5:1  PASS
field-dark   status.stale.on on status.stale.fill (badge label)              #f4f5f5  #586574  5.45:1   4.5:1  PASS
field-dark   status.stale.text on surface.default (colored label, no fill)   #96a2b0  #111213  7.23:1   4.5:1  PASS
field-light  text.primary on surface.default                                 #0a0a0b  #f4f5f5  18.12:1  4.5:1  PASS
field-light  text.primary on surface.raised                                  #0a0a0b  #ffffff  19.79:1  4.5:1  PASS
field-light  text.secondary on surface.default                               #46494e  #f4f5f5  8.27:1   4.5:1  PASS
field-light  text.secondary on surface.raised                                #46494e  #ffffff  9.04:1   4.5:1  PASS
field-light  text.muted on surface.default                                   #565b61  #f4f5f5  6.27:1   4.5:1  PASS
field-light  text.muted on surface.raised                                    #565b61  #ffffff  6.85:1   4.5:1  PASS
field-light  text.primary on surface.sunken                                  #0a0a0b  #d9dbdd  14.26:1  4.5:1  PASS
field-light  accent.interactive on surface.default                           #2768a5  #f4f5f5  5.33:1   3.0:1  PASS
field-light  accent.onAccent on accent.interactive                           #f4f5f5  #2768a5  5.33:1   4.5:1  PASS
field-light  border.strong on surface.default                                #696f77  #f4f5f5  4.64:1   3.0:1  PASS
field-light  focus.ring on surface.default                                   #2768a5  #f4f5f5  5.33:1   3.0:1  PASS
field-light  focus.ring on surface.raised                                    #2768a5  #ffffff  5.82:1   3.0:1  PASS
field-light  status.good.on on status.good.fill (badge label)                #ffffff  #1d7c49  5.21:1   4.5:1  PASS
field-light  status.good.text on surface.default (colored label, no fill)    #17633b  #f4f5f5  6.67:1   4.5:1  PASS
field-light  status.fair.on on status.fair.fill (badge label)                #0a0a0b  #a57f27  5.34:1   4.5:1  PASS
field-light  status.fair.text on surface.default (colored label, no fill)    #634c17  #f4f5f5  7.46:1   4.5:1  PASS
field-light  status.poor.on on status.poor.fill (badge label)                #ffffff  #844b1f  6.98:1   4.5:1  PASS
field-light  status.poor.text on surface.default (colored label, no fill)    #633817  #f4f5f5  9.12:1   4.5:1  PASS
field-light  status.closed.on on status.closed.fill (badge label)            #ffffff  #84271f  9.17:1   4.5:1  PASS
field-light  status.closed.text on surface.default (colored label, no fill)  #84271f  #f4f5f5  8.39:1   4.5:1  PASS
field-light  status.stale.on on status.stale.fill (badge label)              #ffffff  #586574  5.95:1   4.5:1  PASS
field-light  status.stale.text on surface.default (colored label, no fill)   #46505d  #f4f5f5  7.49:1   4.5:1  PASS
night-ops    text.primary on surface.default                                 #f1a59d  #180807  9.85:1   4.5:1  PASS
night-ops    text.primary on surface.raised                                  #f1a59d  #220d0b  9.39:1   4.5:1  PASS
night-ops    text.secondary on surface.default                               #d37369  #180807  5.97:1   4.5:1  PASS
night-ops    text.secondary on surface.raised                                #d37369  #220d0b  5.68:1   4.5:1  PASS
night-ops    text.muted on surface.default                                   #c46d64  #180807  5.31:1   4.5:1  PASS
night-ops    text.muted on surface.raised                                    #c46d64  #220d0b  5.06:1   4.5:1  PASS
night-ops    text.primary on surface.sunken                                  #f1a59d  #100504  10.15:1  4.5:1  PASS
night-ops    accent.interactive on surface.default                           #bf223c  #180807  3.26:1   3.0:1  PASS
night-ops    accent.onAccent on accent.interactive                           #fbefec  #bf223c  5.32:1   4.5:1  PASS
night-ops    border.strong on surface.default                                #865750  #180807  3.24:1   3.0:1  PASS
night-ops    focus.ring on surface.default                                   #ee8b9c  #180807  8.18:1   3.0:1  PASS
night-ops    focus.ring on surface.raised                                    #ee8b9c  #220d0b  7.79:1   3.0:1  PASS
night-ops    status.good.on on status.good.fill (badge label)                #180807  #cda11d  8.09:1   4.5:1  PASS
night-ops    status.good.text on surface.default (colored label, no fill)    #ebd48e  #180807  13.32:1  4.5:1  PASS
night-ops    status.fair.on on status.fair.fill (badge label)                #180807  #cd751d  5.72:1   4.5:1  PASS
night-ops    status.fair.text on surface.default (colored label, no fill)    #ebbd8e  #180807  11.33:1  4.5:1  PASS
night-ops    status.poor.on on status.poor.fill (badge label)                #fbefec  #ad421f  5.22:1   4.5:1  PASS
night-ops    status.poor.text on surface.default (colored label, no fill)    #e89f87  #180807  9.05:1   4.5:1  PASS
night-ops    status.closed.on on status.closed.fill (badge label)            #fbefec  #b12525  5.90:1   4.5:1  PASS
night-ops    status.closed.text on surface.default (colored label, no fill)  #ea9090  #180807  8.26:1   4.5:1  PASS
night-ops    status.stale.on on status.stale.fill (badge label)              #fbefec  #7a645c  4.90:1   4.5:1  PASS
night-ops    status.stale.text on surface.default (colored label, no fill)   #b4a29c  #180807  7.98:1   4.5:1  PASS

PASS: all 66 pairing(s) meet their WCAG threshold.
```

Regenerate this table any time with `npm run validate`; it's deterministic
from `tokens.json`.

## Layout

```
tokens.json                 - the single source of truth (hand-edited)
scripts/
  lib/resolve.mjs            - W3C token reference resolver (primitive/semantic/component/dataviz)
  lib/color.mjs               - WCAG relative luminance + contrast ratio (no deps)
  lib/css.mjs                 - shared CSS-variable builder (used by generate.mjs and build-styleguide.mjs)
  lib/naming.mjs               - token path -> CSS var / Tailwind key naming
  lib/format-value.mjs          - resolved value -> CSS literal
  generate.mjs                - tokens.json -> CSS/Tailwind/TS/MapLibre
  validate.mjs                 - the contrast gate (npm run validate)
  build-styleguide.mjs          - tokens.json -> styleguide.html
src/
  index.ts                     - public entry point
  theme-runtime.ts              - applyTheme()/readStoredTheme() for the browser
  generated/tokens.ts           - GENERATED, gitignored (npm run generate)
test/
  resolve.test.mjs              - token-shape integrity (no dangling refs, every theme has every key, night-ops stays warm-only, ...)
  contrast.test.mjs             - the same contrast gate as assertions, for `npm run test` / CI
dist/                          - GENERATED, gitignored (npm run build)
styleguide.html                - GENERATED (npm run styleguide), all three themes + a live switcher
```
