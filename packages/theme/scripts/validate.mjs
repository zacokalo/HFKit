#!/usr/bin/env node
// npm run validate
//
// Computes WCAG contrast ratios for every meaningful foreground/background
// semantic pairing, in every theme, and fails (non-zero exit) if any pairing
// falls below its required threshold. Prints a readable table either way.
//
// Scope: this checks *semantic* text/UI pairs (surfaces, text, borders,
// accent, focus ring, status badges). It does not gate the dataviz
// sequential/categorical swatches -- those are color-blind-safety /
// distinctiveness concerns, not text-on-background contrast, and are colored
// fills rather than text. See README "Contrast validation" for the reasoning.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadTokens, themeNames, resolveTheme, semantic } from "./lib/resolve.mjs";
import { contrastRatio, formatRatio } from "./lib/color.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.join(__dirname, "..", "tokens.json");

const BODY_TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3.0; // large text (>=18.66px bold / >=24px regular) and UI boundaries

/**
 * One row = one thing a human actually looks at: some foreground token
 * rendered against some background token. `level` picks the WCAG threshold.
 */
function pairs(resolved) {
  const s = (p) => semantic(resolved, p);
  const rows = [
    // Body text on surfaces
    ["text.primary on surface.default", s("text.primary"), s("surface.default"), "body"],
    ["text.primary on surface.raised", s("text.primary"), s("surface.raised"), "body"],
    ["text.secondary on surface.default", s("text.secondary"), s("surface.default"), "body"],
    ["text.secondary on surface.raised", s("text.secondary"), s("surface.raised"), "body"],
    ["text.muted on surface.default", s("text.muted"), s("surface.default"), "body"],
    ["text.muted on surface.raised", s("text.muted"), s("surface.raised"), "body"],
    ["text.primary on surface.sunken", s("text.primary"), s("surface.sunken"), "body"],

    // Accent as interactive chrome (buttons, icons, short controls) is a
    // WCAG 1.4.11 non-text UI component, not paragraph text -- 3:1. The
    // button LABEL sitting on top of it is real text, so that pairing is
    // held to the full 4.5:1 body-text bar.
    ["accent.interactive on surface.default", s("accent.interactive"), s("surface.default"), "large"],
    ["accent.onAccent on accent.interactive", s("accent.onAccent"), s("accent.interactive"), "body"],

    // border.strong is the one border weight WCAG 1.4.11 actually governs --
    // used where a border is the sole cue for a component boundary (e.g. an
    // input outline). border.subtle/border.default are decorative hairlines
    // (row dividers, card edges) that are never the sole means of conveying
    // a boundary, so they are intentionally low-contrast and not gated here.
    ["border.strong on surface.default", s("border.strong"), s("surface.default"), "large"],

    // Focus ring must be visible against the surface it appears on -- UI, 3:1
    ["focus.ring on surface.default", s("focus.ring"), s("surface.default"), "large"],
    ["focus.ring on surface.raised", s("focus.ring"), s("surface.raised"), "large"],
  ];

  for (const status of ["good", "fair", "poor", "closed", "stale"]) {
    const fill = s(`status.${status}.fill`);
    const on = s(`status.${status}.on`);
    const text = s(`status.${status}.text`);
    rows.push([`status.${status}.on on status.${status}.fill (badge label)`, on, fill, "body"]);
    rows.push([`status.${status}.text on surface.default (colored label, no fill)`, text, s("surface.default"), "body"]);
  }

  return rows;
}

function main() {
  const tokens = loadTokens(TOKENS_PATH);
  const themes = themeNames(tokens);

  let anyFailure = false;
  /** @type {{theme:string, name:string, fg:string, bg:string, ratio:number, min:number, level:string, pass:boolean}[]} */
  const allResults = [];

  for (const themeName of themes) {
    const resolved = resolveTheme(tokens, themeName);
    for (const [name, fg, bg, level] of pairs(resolved)) {
      const ratio = contrastRatio(fg, bg);
      const min = level === "body" ? BODY_TEXT_MIN : LARGE_TEXT_MIN;
      const pass = ratio >= min;
      if (!pass) anyFailure = true;
      allResults.push({ theme: themeName, name, fg, bg, ratio, min, level, pass });
    }
  }

  printTable(allResults);

  const failures = allResults.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.error(
      `\nFAIL: ${failures.length} of ${allResults.length} pairing(s) below threshold.\n` +
        `Fix the color -- do not loosen this threshold (see CLAUDE.md: never loosen a sanity gate).`,
    );
    process.exitCode = 1;
  } else {
    console.log(`\nPASS: all ${allResults.length} pairing(s) meet their WCAG threshold.`);
  }
}

function printTable(results) {
  const cols = ["Theme", "Pairing", "FG", "BG", "Ratio", "Min", "Result"];
  const rows = results.map((r) => [
    r.theme,
    r.name,
    r.fg,
    r.bg,
    formatRatio(r.ratio),
    `${r.min.toFixed(1)}:1`,
    r.pass ? "PASS" : "FAIL",
  ]);
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(cols));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

main();
