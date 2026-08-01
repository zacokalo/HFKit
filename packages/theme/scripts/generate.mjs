#!/usr/bin/env node
// npm run generate (also runs as the first step of `npm run build`)
//
// Reads tokens.json once and emits every downstream artifact:
//   dist/tokens.css              - :root + [data-theme="..."] custom properties
//   dist/tailwind.theme.mjs      - Tailwind theme.extend consuming the CSS vars
//   src/generated/tokens.ts      - typed TS token export (compiled by tsc -> dist/)
//   dist/maplibre/<theme>.json   - one quiet basemap style per theme
//
// All four are *generated*; never hand-edit dist/ or src/generated/.

import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  loadTokens,
  themeNames,
  resolveTheme,
  flattenResolved,
} from "./lib/resolve.mjs";
import { cssVarName, kebabPath } from "./lib/naming.mjs";
import { cssLiteral } from "./lib/format-value.mjs";
import { buildCss } from "./lib/css.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TOKENS_PATH = path.join(ROOT, "tokens.json");
const DIST = path.join(ROOT, "dist");
const GENERATED_SRC = path.join(ROOT, "src", "generated");

const tokens = loadTokens(TOKENS_PATH);
const themes = themeNames(tokens);
const DEFAULT_THEME = "field-dark";
if (!themes.includes(DEFAULT_THEME)) {
  throw new Error(`Default theme "${DEFAULT_THEME}" not found in tokens.json`);
}

const resolvedByTheme = Object.fromEntries(
  themes.map((name) => [name, resolveTheme(tokens, name)]),
);

mkdirSync(DIST, { recursive: true });
mkdirSync(path.join(DIST, "maplibre"), { recursive: true });
mkdirSync(GENERATED_SRC, { recursive: true });

// ---------------------------------------------------------------------------
// 1. CSS custom properties
// ---------------------------------------------------------------------------

const { css } = buildCss(tokens);
writeFileSync(path.join(DIST, "tokens.css"), css, "utf8");

// ---------------------------------------------------------------------------
// 2. Tailwind theme config (consumes the CSS variables -- theme-switch-safe)
// ---------------------------------------------------------------------------

function nestSet(obj, segments, value) {
  let node = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    node[seg] ??= {};
    node = node[seg];
  }
  node[segments[segments.length - 1]] = value;
}

function buildTailwindColorTree(prefix) {
  const out = {};
  for (const t of resolvedByTheme[DEFAULT_THEME].flat) {
    if (!t.path.startsWith(prefix) || t.type !== "color") continue;
    const rel = t.path.slice(prefix.length).split(".");
    nestSet(out, rel, `var(${cssVarName(t.path)})`);
  }
  return out;
}

function buildTailwindDimensionTree(prefix, typeFilter) {
  const out = {};
  for (const t of resolvedByTheme[DEFAULT_THEME].flat) {
    if (!t.path.startsWith(prefix) || t.type !== typeFilter) continue;
    const rel = t.path.slice(prefix.length).split(".");
    nestSet(out, rel, `var(${cssVarName(t.path)})`);
  }
  return out;
}

function buildTailwindTheme() {
  const colors = {
    ...buildTailwindColorTree("semantic."),
  };
  const spacing = {};
  const borderRadius = {};
  const fontSize = {};
  for (const t of resolvedByTheme[DEFAULT_THEME].flat) {
    if (t.path.startsWith("primitive.spacing.")) {
      spacing[t.path.split(".").pop()] = `var(${cssVarName(t.path)})`;
    }
    if (t.path.startsWith("primitive.radius.")) {
      borderRadius[t.path.split(".").pop()] = `var(${cssVarName(t.path)})`;
    }
    if (t.path.startsWith("primitive.fontSize.")) {
      fontSize[t.path.split(".").pop()] = `var(${cssVarName(t.path)})`;
    }
  }
  const fontFamily = {
    sans: [`var(${cssVarName("primitive.fontFamily.sans")})`],
    mono: [`var(${cssVarName("primitive.fontFamily.mono")})`],
  };

  return {
    colors,
    spacing,
    borderRadius,
    fontSize,
    fontFamily,
    // component + dataviz trees, namespaced so they don't collide with
    // Tailwind's own `colors` semantics but are still one lookup away.
    extend_component: buildTailwindColorTree("component."),
    extend_dataviz: buildTailwindColorTree("dataviz."),
  };
}

function buildTailwindSource() {
  const theme = buildTailwindTheme();
  const header =
    "// GENERATED FILE -- do not edit by hand.\n" +
    "// Source: packages/theme/tokens.json\n" +
    "// Regenerate: npm run generate (inside packages/theme)\n" +
    "//\n" +
    "// Usage in tailwind.config: import { hfkitTheme } from '@hfkit/theme/tailwind'\n" +
    "// then spread `hfkitTheme` into `theme.extend`. Every value is a CSS var\n" +
    "// reference, so Tailwind utilities (bg-surface-default, text-text-muted,\n" +
    "// ...) resolve to whatever [data-theme] is active at runtime.\n\n";
  const body =
    `export const hfkitColors = ${JSON.stringify(theme.colors, null, 2)};\n\n` +
    `export const hfkitComponentColors = ${JSON.stringify(theme.extend_component, null, 2)};\n\n` +
    `export const hfkitDatavizColors = ${JSON.stringify(theme.extend_dataviz, null, 2)};\n\n` +
    `export const hfkitSpacing = ${JSON.stringify(theme.spacing, null, 2)};\n\n` +
    `export const hfkitBorderRadius = ${JSON.stringify(theme.borderRadius, null, 2)};\n\n` +
    `export const hfkitFontSize = ${JSON.stringify(theme.fontSize, null, 2)};\n\n` +
    `export const hfkitFontFamily = ${JSON.stringify(theme.fontFamily, null, 2)};\n\n` +
    "/** Spread into a Tailwind config's `theme.extend`. */\n" +
    "export const hfkitTheme = {\n" +
    "  colors: { ...hfkitColors, component: hfkitComponentColors, dataviz: hfkitDatavizColors },\n" +
    "  spacing: hfkitSpacing,\n" +
    "  borderRadius: hfkitBorderRadius,\n" +
    "  fontSize: hfkitFontSize,\n" +
    "  fontFamily: hfkitFontFamily,\n" +
    "};\n\n" +
    "export default hfkitTheme;\n";
  return header + body;
}

writeFileSync(path.join(DIST, "tailwind.theme.mjs"), buildTailwindSource(), "utf8");

const TAILWIND_DTS = `// GENERATED FILE -- do not edit by hand.
// Source: packages/theme/tokens.json
// Regenerate: npm run generate (inside packages/theme)

type ColorTree = { readonly [key: string]: string | ColorTree };
type StringMap = { readonly [key: string]: string };

export declare const hfkitColors: ColorTree;
export declare const hfkitComponentColors: ColorTree;
export declare const hfkitDatavizColors: ColorTree;
export declare const hfkitSpacing: StringMap;
export declare const hfkitBorderRadius: StringMap;
export declare const hfkitFontSize: StringMap;
export declare const hfkitFontFamily: { readonly sans: readonly string[]; readonly mono: readonly string[] };

export interface HfkitTailwindTheme {
  readonly colors: ColorTree & { readonly component: ColorTree; readonly dataviz: ColorTree };
  readonly spacing: StringMap;
  readonly borderRadius: StringMap;
  readonly fontSize: StringMap;
  readonly fontFamily: { readonly sans: readonly string[]; readonly mono: readonly string[] };
}

/** Spread into a Tailwind config's \`theme.extend\`. */
export declare const hfkitTheme: HfkitTailwindTheme;
export default hfkitTheme;
`;
writeFileSync(path.join(DIST, "tailwind.theme.d.ts"), TAILWIND_DTS, "utf8");

// ---------------------------------------------------------------------------
// 3. Typed TypeScript token module (src/generated/, compiled by tsc)
// ---------------------------------------------------------------------------

function toCamelSegments(path) {
  return path.split(".");
}

function buildObjectLiteral(flatTokens, prefix, indent = "  ") {
  const tree = {};
  for (const t of flatTokens) {
    if (!t.path.startsWith(prefix)) continue;
    const rel = t.path.slice(prefix.length).split(".");
    nestSet(tree, rel, jsLiteral(t.type, t.value));
  }
  return printJs(tree, indent);
}

function jsLiteral(type, value) {
  if (type === "color" || type === "dimension" || type === "duration") {
    return JSON.stringify(value);
  }
  if (type === "fontFamily") {
    return JSON.stringify(value);
  }
  if (type === "cubicBezier") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function printJs(node, indent) {
  if (typeof node === "string") return node;
  const inner = Object.entries(node)
    .map(([k, v]) => `${indent}  ${jsKey(k)}: ${printJs(v, indent + "  ")},`)
    .join("\n");
  return `{\n${inner}\n${indent}}`;
}

function jsKey(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
}

function buildTokensTs() {
  const themeUnion = themes.map((n) => `"${n}"`).join(" | ");
  const primitiveObj = buildObjectLiteral(resolvedByTheme[DEFAULT_THEME].flat, "primitive.");

  const perThemeSemantic = themes
    .map((name) => `  "${name}": ${buildObjectLiteral(resolvedByTheme[name].flat, "semantic.", "  ")},`)
    .join("\n");
  const perThemeComponent = themes
    .map((name) => `  "${name}": ${buildObjectLiteral(resolvedByTheme[name].flat, "component.", "  ")},`)
    .join("\n");
  const perThemeDataviz = themes
    .map((name) => `  "${name}": ${buildObjectLiteral(resolvedByTheme[name].flat, "dataviz.", "  ")},`)
    .join("\n");

  return `// GENERATED FILE -- do not edit by hand.
// Source: packages/theme/tokens.json
// Regenerate: npm run generate (inside packages/theme)

/** Every theme HFKit ships. "field-dark" is the default. */
export type ThemeName = ${themeUnion};

export const themeNames: readonly ThemeName[] = [${themes.map((n) => `"${n}"`).join(", ")}] as const;

export const defaultTheme: ThemeName = "${DEFAULT_THEME}";

export interface StatusColorTokens {
  /** Background fill for a status badge/chip. */
  readonly fill: string;
  /** Foreground color to place on top of \`fill\` (badge label). */
  readonly on: string;
  /** Foreground color for standalone colored text/icons with no fill (e.g. on surface.default). */
  readonly text: string;
}

export interface StatusRampTokens {
  readonly good: StatusColorTokens;
  readonly fair: StatusColorTokens;
  readonly poor: StatusColorTokens;
  readonly closed: StatusColorTokens;
  readonly stale: StatusColorTokens;
}

export interface SemanticTokens {
  readonly surface: {
    readonly default: string;
    readonly raised: string;
    readonly sunken: string;
    readonly overlay: string;
  };
  readonly text: {
    readonly primary: string;
    readonly secondary: string;
    readonly muted: string;
    readonly inverse: string;
    readonly disabled: string;
  };
  readonly border: {
    readonly subtle: string;
    readonly default: string;
    readonly strong: string;
  };
  readonly accent: {
    readonly interactive: string;
    readonly interactiveHover: string;
    readonly interactiveActive: string;
    readonly onAccent: string;
  };
  readonly focus: {
    readonly ring: string;
  };
  readonly status: StatusRampTokens;
}

export interface ComponentTokens {
  readonly card: { readonly padding: string; readonly gap: string; readonly radius: string; readonly background: string; readonly border: string };
  readonly button: { readonly paddingX: string; readonly paddingY: string; readonly radius: string; readonly background: string; readonly backgroundHover: string; readonly backgroundActive: string; readonly foreground: string; readonly border: string };
  readonly badge: { readonly paddingX: string; readonly paddingY: string; readonly radius: string; readonly gap: string; readonly border: string };
  readonly dataRow: { readonly paddingX: string; readonly paddingY: string; readonly background: string; readonly backgroundAlt: string; readonly border: string; readonly valueForeground: string; readonly timestampForeground: string };
  readonly focusRing: { readonly width: string; readonly offset: string; readonly color: string };
  readonly map: { readonly background: string; readonly land: string; readonly water: string; readonly building: string; readonly boundary: string; readonly road: string; readonly label: string; readonly labelHalo: string };
}

/** Colorblind-safe sequential ramp (index 0 = low, last index = high) for continuous fields like MUF/coverage. */
export type SequentialRamp = readonly string[];
/** Colorblind-safe categorical palette for multi-series charts, in series order. */
export type CategoricalPalette = readonly string[];

export interface DatavizTokens {
  readonly sequential: SequentialRamp;
  readonly categorical: CategoricalPalette;
}

export interface ThemeTokens {
  readonly name: ThemeName;
  readonly semantic: SemanticTokens;
  readonly component: ComponentTokens;
  readonly dataviz: DatavizTokens;
}

export interface PrimitiveTokens {
  readonly color: Record<string, Record<string, string> | string>;
  readonly spacing: Record<string, string>;
  readonly radius: Record<string, string>;
  readonly borderWidth: Record<string, string>;
  readonly fontFamily: { readonly sans: readonly string[]; readonly mono: readonly string[] };
  readonly fontSize: Record<string, string>;
  readonly fontWeight: Record<string, number>;
  readonly lineHeight: Record<string, number>;
  readonly duration: Record<string, string>;
  readonly easing: { readonly standard: readonly [number, number, number, number] };
}

/** Layer 1 -- raw values. Components must never import this directly; use \`themes[name]\` instead. */
export const primitives: PrimitiveTokens = ${primitiveObj};

const semanticByTheme: Record<ThemeName, SemanticTokens> = {
${perThemeSemantic}
};

const componentByTheme: Record<ThemeName, ComponentTokens> = {
${perThemeComponent}
};

const datavizRawByTheme: Record<ThemeName, { sequential: Record<string, string>; categorical: Record<string, string> }> = {
${perThemeDataviz}
};

function toOrderedArray(rec: Record<string, string>): readonly string[] {
  return Object.keys(rec)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => rec[k]!);
}

/** Fully resolved token set for every theme, keyed by theme name. */
export const themes: Record<ThemeName, ThemeTokens> = Object.fromEntries(
  themeNames.map((name) => [
    name,
    {
      name,
      semantic: semanticByTheme[name],
      component: componentByTheme[name],
      dataviz: {
        sequential: toOrderedArray(datavizRawByTheme[name].sequential),
        categorical: toOrderedArray(datavizRawByTheme[name].categorical),
      },
    },
  ]),
) as Record<ThemeName, ThemeTokens>;

/** Look up a theme's fully resolved tokens (throws on an unknown name). */
export function getTheme(name: ThemeName): ThemeTokens {
  const theme = themes[name];
  if (!theme) throw new Error(\`Unknown HFKit theme "\${name}"\`);
  return theme;
}
`;
}

writeFileSync(path.join(GENERATED_SRC, "tokens.ts"), buildTokensTs(), "utf8");

// ---------------------------------------------------------------------------
// 4. MapLibre GL basemap styles (one per theme)
// ---------------------------------------------------------------------------

function buildMapLibreStyle(themeName) {
  const resolved = resolvedByTheme[themeName];
  const c = (path) => resolved.byPath[`component.map.${path}`]?.value;

  return {
    version: 8,
    name: `hfkit-${themeName}`,
    metadata: {
      "hfkit:theme": themeName,
      "hfkit:generated": "packages/theme/scripts/generate.mjs from tokens.json -- do not edit by hand",
      "hfkit:note":
        "Deliberately quiet, low-saturation basemap: land/water/label colors come from the same surface/text tokens as the rest of the UI, so data overlays (MUF contours, coverage, spot density, gray line, great-circle arcs) are the visually loud layer. Slot a real vector source in by replacing `sources.basemap.tiles` (or `url` for a TileJSON/PMTiles source) -- layer `source-layer` names above assume a Protomaps-shaped schema; adjust if using a different tile schema.",
    },
    glyphs: "https://example.invalid/fonts/{fontstack}/{range}.pbf",
    sources: {
      basemap: {
        type: "vector",
        // Placeholder -- slot a real tile source URL/TileJSON in here.
        tiles: ["https://example.invalid/basemap/{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: 15,
        attribution: "HFKit basemap placeholder -- replace with a real vector source",
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": c("background") },
      },
      {
        id: "earth",
        type: "fill",
        source: "basemap",
        "source-layer": "earth",
        paint: { "fill-color": c("land") },
      },
      {
        id: "landuse",
        type: "fill",
        source: "basemap",
        "source-layer": "landuse",
        paint: { "fill-color": c("land"), "fill-opacity": 0.6 },
      },
      {
        id: "water",
        type: "fill",
        source: "basemap",
        "source-layer": "water",
        paint: { "fill-color": c("water") },
      },
      {
        id: "buildings",
        type: "fill",
        source: "basemap",
        "source-layer": "buildings",
        minzoom: 13,
        paint: { "fill-color": c("building"), "fill-opacity": 0.5 },
      },
      {
        id: "roads",
        type: "line",
        source: "basemap",
        "source-layer": "roads",
        minzoom: 8,
        paint: { "line-color": c("road"), "line-width": 0.75 },
      },
      {
        id: "boundaries",
        type: "line",
        source: "basemap",
        "source-layer": "boundaries",
        paint: { "line-color": c("boundary"), "line-width": 1, "line-dasharray": [2, 2] },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "basemap",
        "source-layer": "places",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
        },
        paint: {
          "text-color": c("label"),
          "text-halo-color": c("labelHalo"),
          "text-halo-width": 1.2,
        },
      },
    ],
  };
}

for (const name of themes) {
  writeFileSync(
    path.join(DIST, "maplibre", `basemap-${name}.json`),
    JSON.stringify(buildMapLibreStyle(name), null, 2) + "\n",
    "utf8",
  );
}

console.log(`Generated for ${themes.length} theme(s): ${themes.join(", ")}`);
console.log(`  dist/tokens.css`);
console.log(`  dist/tailwind.theme.mjs`);
console.log(`  src/generated/tokens.ts`);
for (const name of themes) console.log(`  dist/maplibre/basemap-${name}.json`);
