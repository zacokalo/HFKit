import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadTokens, themeNames, resolveTheme, semantic } from "../scripts/lib/resolve.mjs";
import { contrastRatio } from "../scripts/lib/color.mjs";

const TOKENS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tokens.json");
const BODY_TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3.0;

// Same pairing set as scripts/validate.mjs (kept in sync manually -- both are
// small and change together whenever a semantic token is added).
function pairs(resolved) {
  const s = (p) => semantic(resolved, p);
  const rows = [
    ["text.primary/surface.default", s("text.primary"), s("surface.default"), BODY_TEXT_MIN],
    ["text.primary/surface.raised", s("text.primary"), s("surface.raised"), BODY_TEXT_MIN],
    ["text.secondary/surface.default", s("text.secondary"), s("surface.default"), BODY_TEXT_MIN],
    ["text.muted/surface.default", s("text.muted"), s("surface.default"), BODY_TEXT_MIN],
    ["accent.onAccent/accent.interactive", s("accent.onAccent"), s("accent.interactive"), BODY_TEXT_MIN],
    ["border.strong/surface.default", s("border.strong"), s("surface.default"), LARGE_TEXT_MIN],
    ["focus.ring/surface.default", s("focus.ring"), s("surface.default"), LARGE_TEXT_MIN],
  ];
  for (const status of ["good", "fair", "poor", "closed", "stale"]) {
    rows.push([
      `status.${status}.on/status.${status}.fill`,
      s(`status.${status}.on`),
      s(`status.${status}.fill`),
      BODY_TEXT_MIN,
    ]);
  }
  return rows;
}

test("every theme's core semantic pairings meet WCAG AA", () => {
  const tokens = loadTokens(TOKENS_PATH);
  for (const name of themeNames(tokens)) {
    const resolved = resolveTheme(tokens, name);
    for (const [label, fg, bg, min] of pairs(resolved)) {
      const ratio = contrastRatio(fg, bg);
      assert.ok(
        ratio >= min,
        `${name}: ${label} is ${ratio.toFixed(2)}:1, needs >= ${min}:1 (fg=${fg} bg=${bg})`,
      );
    }
  }
});
