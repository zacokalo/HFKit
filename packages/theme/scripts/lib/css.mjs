import { themeNames, resolveTheme } from "./resolve.mjs";
import { cssVarName } from "./naming.mjs";
import { cssLiteral } from "./format-value.mjs";

export const DEFAULT_THEME = "field-dark";

function themeVarLines(resolved) {
  const themed = resolved.flat.filter(
    (t) => t.path.startsWith("semantic.") || t.path.startsWith("component.") || t.path.startsWith("dataviz."),
  );
  return themed.map((t) => `  ${cssVarName(t.path)}: ${cssLiteral(t.type, t.value)};`).join("\n");
}

/** Build the full tokens.css text (:root globals + default theme + one [data-theme] block per theme). */
export function buildCss(tokens) {
  const themes = themeNames(tokens);
  if (!themes.includes(DEFAULT_THEME)) {
    throw new Error(`Default theme "${DEFAULT_THEME}" not found in tokens.json`);
  }
  const resolvedByTheme = Object.fromEntries(themes.map((name) => [name, resolveTheme(tokens, name)]));

  const primitiveOnly = resolvedByTheme[DEFAULT_THEME].flat.filter((t) => t.path.startsWith("primitive."));
  const globalPrimitives = primitiveOnly.filter((t) => !t.path.startsWith("primitive.color."));

  const lines = [];
  lines.push("/*");
  lines.push(" * GENERATED FILE -- do not edit by hand.");
  lines.push(" * Source: packages/theme/tokens.json");
  lines.push(" * Regenerate: npm run generate (inside packages/theme)");
  lines.push(" */");
  lines.push("");
  lines.push(":root {");
  lines.push("  /* -- primitive scale (spacing, radius, type, motion) -- same in every theme */");
  for (const t of globalPrimitives) {
    lines.push(`  ${cssVarName(t.path)}: ${cssLiteral(t.type, t.value)};`);
  }
  lines.push("");
  lines.push(`  /* -- default theme: ${DEFAULT_THEME} -- overridden by [data-theme] below */`);
  lines.push(themeVarLines(resolvedByTheme[DEFAULT_THEME]));
  lines.push("}");

  for (const name of themes) {
    lines.push("");
    lines.push(`[data-theme="${name}"] {`);
    lines.push(themeVarLines(resolvedByTheme[name]));
    lines.push("}");
  }

  lines.push("");
  return { css: lines.join("\n") + "\n", resolvedByTheme, themes };
}
