#!/usr/bin/env node
// npm run styleguide (also runs as part of `npm run build`)
//
// Renders styleguide.html: every token plus a few representative components
// (score badge, data row, button, card) in all three themes, with a live
// theme switcher. This is the reskin test -- it should be obvious at a
// glance that switching theme changes everything and breaks nothing.

import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadTokens, themeNames, resolveTheme, semantic } from "./lib/resolve.mjs";
import { buildCss } from "./lib/css.mjs";
import { cssVarRef } from "./lib/naming.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TOKENS_PATH = path.join(ROOT, "tokens.json");

const tokens = loadTokens(TOKENS_PATH);
const { css, resolvedByTheme, themes } = buildCss(tokens);

const STATUS_ORDER = ["good", "fair", "poor", "closed", "stale"];
// Redundant encoding: status is never color-only. Shape + label pair with color.
const STATUS_SHAPE = { good: "●", fair: "▲", poor: "◆", closed: "✖", stale: "○" };
const STATUS_LABEL = { good: "GOOD", fair: "FAIR", poor: "POOR", closed: "CLOSED", stale: "STALE" };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function swatchRow(resolved, groupLabel, tokenPath, extra = "") {
  const value = semantic(resolved, tokenPath);
  return `<div class="swatch-row">
    <span class="swatch" style="background:${cssVarRef(`semantic.${tokenPath}`)}"></span>
    <span class="swatch-name">${groupLabel ? `${groupLabel}.` : ""}${escapeHtml(tokenPath.split(".").pop())}</span>
    <span class="swatch-value">${escapeHtml(value)}</span>
    ${extra}
  </div>`;
}

function semanticSection(theme) {
  const groups = [
    ["surface", ["default", "raised", "sunken", "overlay"]],
    ["text", ["primary", "secondary", "muted", "inverse", "disabled"]],
    ["border", ["subtle", "default", "strong"]],
    ["accent", ["interactive", "interactiveHover", "interactiveActive", "onAccent"]],
    ["focus", ["ring"]],
  ];
  return groups
    .map(
      ([group, keys]) => `
      <div class="token-group">
        <h4>${group}.*</h4>
        ${keys.map((k) => swatchRow(theme, group, `${group}.${k}`)).join("\n")}
      </div>`,
    )
    .join("\n");
}

function statusSection(theme) {
  return `
    <div class="token-group">
      <h4>status.*</h4>
      ${STATUS_ORDER.map((name) => {
        const fill = semantic(theme, `status.${name}.fill`);
        const on = semantic(theme, `status.${name}.on`);
        const text = semantic(theme, `status.${name}.text`);
        return `<div class="swatch-row">
          <span class="badge" style="background:${cssVarRef(`semantic.status.${name}.fill`)};color:${cssVarRef(`semantic.status.${name}.on`)}">
            <span aria-hidden="true">${STATUS_SHAPE[name]}</span> ${STATUS_LABEL[name]}
          </span>
          <span class="swatch-name">status.${name}</span>
          <span class="swatch-value">fill ${escapeHtml(fill)} &middot; on ${escapeHtml(on)} &middot; text ${escapeHtml(text)}</span>
        </div>`;
      }).join("\n")}
    </div>`;
}

function rampStrip(theme, kind) {
  const arr = theme.byPath;
  const stops = Object.keys(arr)
    .filter((k) => k.startsWith(`dataviz.${kind}.`))
    .sort((a, b) => Number(a.split(".").pop()) - Number(b.split(".").pop()))
    .map((k) => arr[k].value);
  return `<div class="ramp">${stops.map((c) => `<span style="background:${c}" title="${c}"></span>`).join("")}</div>`;
}

function componentsDemo() {
  return `
    <div class="demo-card" style="background:${cssVarRef("component.card.background")};border:1px solid ${cssVarRef("component.card.border")};padding:${cssVarRef("component.card.padding")};border-radius:${cssVarRef("component.card.radius")};display:flex;flex-direction:column;gap:${cssVarRef("component.card.gap")}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <strong style="color:var(--hf-text-primary)">20m &middot; VK path</strong>
        <span class="badge" style="background:${cssVarRef("semantic.status.good.fill")};color:${cssVarRef("semantic.status.good.on")}"><span aria-hidden="true">${STATUS_SHAPE.good}</span> ${STATUS_LABEL.good}</span>
      </div>

      <div class="data-row" style="background:${cssVarRef("component.dataRow.background")};border:1px solid ${cssVarRef("component.dataRow.border")};padding:${cssVarRef("component.dataRow.paddingY")} ${cssVarRef("component.dataRow.paddingX")};border-radius:${cssVarRef("primitive.radius.sm")}">
        <span class="mono" style="color:${cssVarRef("component.dataRow.valueForeground")}">14.230&nbsp;MHz</span>
        <span style="color:var(--hf-text-secondary)">A-score 78</span>
        <span class="mono" style="color:${cssVarRef("component.dataRow.timestampForeground")}">updated 2026-08-01 06:41Z</span>
      </div>
      <div class="data-row" style="background:${cssVarRef("component.dataRow.backgroundAlt")};border:1px solid ${cssVarRef("component.dataRow.border")};padding:${cssVarRef("component.dataRow.paddingY")} ${cssVarRef("component.dataRow.paddingX")};border-radius:${cssVarRef("primitive.radius.sm")}">
        <span class="mono" style="color:${cssVarRef("component.dataRow.valueForeground")}">18.100&nbsp;MHz</span>
        <span style="color:var(--hf-text-secondary)">A-score 54</span>
        <span class="mono" style="color:${cssVarRef("component.dataRow.timestampForeground")}">updated 2026-08-01 06:36Z</span>
      </div>

      <div style="display:flex;gap:8px;align-items:center">
        <button class="demo-button" type="button">Plan circuit</button>
        <span class="badge" style="background:${cssVarRef("semantic.status.stale.fill")};color:${cssVarRef("semantic.status.stale.on")}"><span aria-hidden="true">${STATUS_SHAPE.stale}</span> ${STATUS_LABEL.stale} 41m</span>
      </div>
    </div>`;
}

function themePanel(name) {
  const theme = resolvedByTheme[name];
  return `
  <section class="theme-panel" data-theme="${name}">
    <header class="panel-header">
      <h2>${name}</h2>
      <p class="mono dim">data-theme="${name}"</p>
    </header>

    <div class="panel-grid">
      <div>
        <h3>Semantic tokens</h3>
        <div class="token-groups">
          ${semanticSection(theme)}
          ${statusSection(theme)}
        </div>
      </div>

      <div>
        <h3>Representative components</h3>
        ${componentsDemo()}
      </div>

      <div>
        <h3>Data-viz</h3>
        <p class="mono dim">dataviz.sequential (MUF / coverage)</p>
        ${rampStrip(theme, "sequential")}
        <p class="mono dim">dataviz.categorical (multi-series)</p>
        ${rampStrip(theme, "categorical")}
      </div>

      <div>
        <h3>Typography</h3>
        <p class="sans">Sans: which frequency, to reach where, at what time.</p>
        <p class="mono">MUF 21.4 MHz&nbsp;&nbsp;&nbsp;foF2 6.8&nbsp;&nbsp;&nbsp;Kp 3</p>
        <table class="mono tabular-demo">
          <tr><td>14.230</td><td>0341Z</td><td>78</td></tr>
          <tr><td>18.100</td><td>0336Z</td><td>54</td></tr>
          <tr><td>7.040</td><td>0341Z</td><td>91</td></tr>
        </table>
      </div>
    </div>
  </section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>HFKit &middot; Style Guide</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${css}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  background: var(--hf-surface-sunken);
  color: var(--hf-text-primary);
  font-family: var(--hf-font-family-sans);
  font-size: var(--hf-font-size-base);
  line-height: var(--hf-line-height-normal);
}
.mono { font-family: var(--hf-font-family-mono); font-variant-numeric: tabular-nums; }
.dim { color: var(--hf-text-muted); }
.sans { font-family: var(--hf-font-family-sans); }

.page-header {
  padding: var(--hf-spacing-6) var(--hf-spacing-6) var(--hf-spacing-4);
  border-bottom: 1px solid var(--hf-border-default);
  background: var(--hf-surface-default);
}
.page-header h1 { margin: 0 0 4px; font-size: var(--hf-font-size-2xl); }
.page-header p { margin: 0; color: var(--hf-text-muted); max-width: 68ch; }

main { display: flex; flex-direction: column; gap: var(--hf-spacing-8); padding: var(--hf-spacing-6); }

.theme-panel {
  background: var(--hf-surface-default);
  color: var(--hf-text-primary);
  border: 1px solid var(--hf-border-default);
  border-radius: var(--hf-radius-lg);
  padding: var(--hf-spacing-6);
  transition: background var(--hf-duration-base) var(--hf-easing-standard), color var(--hf-duration-base) var(--hf-easing-standard);
}
.panel-header { display: flex; align-items: baseline; gap: var(--hf-spacing-3); margin-bottom: var(--hf-spacing-4); }
.panel-header h2 { margin: 0; text-transform: uppercase; letter-spacing: 0.04em; font-size: var(--hf-font-size-lg); }

.panel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--hf-spacing-6);
  align-items: start;
}
.panel-grid h3 { margin: 0 0 var(--hf-spacing-3); font-size: var(--hf-font-size-sm); text-transform: uppercase; letter-spacing: 0.06em; color: var(--hf-text-secondary); }

.token-groups { display: flex; flex-direction: column; gap: var(--hf-spacing-4); }
.token-group h4 { margin: 0 0 var(--hf-spacing-1); font-size: var(--hf-font-size-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--hf-text-muted); }
.swatch-row { display: flex; align-items: center; gap: var(--hf-spacing-2); padding: 3px 0; font-size: var(--hf-font-size-sm); }
.swatch { width: 18px; height: 18px; border-radius: var(--hf-radius-sm); border: 1px solid var(--hf-border-default); flex: none; }
/* flex:none + nowrap so long names (e.g. "status.closed", 13ch) size to their
   content instead of overflowing the 9ch floor and colliding with the value. */
.swatch-name { min-width: 9ch; flex: none; white-space: nowrap; color: var(--hf-text-secondary); }
.swatch-value { font-family: var(--hf-font-family-mono); color: var(--hf-text-muted); font-size: var(--hf-font-size-xs); }

.badge {
  display: inline-flex; align-items: center; gap: var(--hf-spacing-1);
  padding: var(--hf-spacing-1) var(--hf-spacing-2);
  border-radius: var(--hf-radius-full);
  font-size: var(--hf-font-size-xs);
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.03em;
}

.demo-card { max-width: 420px; }
.data-row { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-spacing-3); font-size: var(--hf-font-size-sm); }
.demo-button {
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  padding: var(--hf-button-padding-y) var(--hf-button-padding-x);
  border-radius: var(--hf-button-radius);
  background: var(--hf-button-background);
  color: var(--hf-button-foreground);
  border: 1px solid var(--hf-button-border);
  cursor: pointer;
  transition: background var(--hf-duration-fast) var(--hf-easing-standard);
}
.demo-button:hover { background: var(--hf-button-background-hover); }
.demo-button:active { background: var(--hf-button-background-active); }
.demo-button:focus-visible {
  outline: var(--hf-focus-ring-width) solid var(--hf-focus-ring-color);
  outline-offset: 2px;
}

.ramp { display: flex; height: 22px; border-radius: var(--hf-radius-sm); overflow: hidden; border: 1px solid var(--hf-border-default); margin: 0 0 var(--hf-spacing-3); }
.ramp span { flex: 1; }

.tabular-demo { border-collapse: collapse; font-size: var(--hf-font-size-base); margin-top: var(--hf-spacing-2); }
.tabular-demo td { padding: 2px 10px 2px 0; text-align: right; }

.theme-switcher { display: flex; gap: var(--hf-spacing-2); margin-top: var(--hf-spacing-3); }
.theme-switcher button {
  font: inherit; font-family: var(--hf-font-family-mono);
  padding: 6px 12px; border-radius: var(--hf-radius-sm);
  border: 1px solid var(--hf-border-default);
  background: var(--hf-surface-raised); color: var(--hf-text-secondary);
  cursor: pointer;
}
.theme-switcher button[aria-pressed="true"] {
  border-color: var(--hf-accent-interactive);
  color: var(--hf-text-primary);
  background: var(--hf-surface-sunken);
}

footer { padding: var(--hf-spacing-6); color: var(--hf-text-muted); font-size: var(--hf-font-size-sm); }
</style>
</head>
<body>
  <div class="page-header">
    <h1>HFKit &middot; Style Guide</h1>
    <p>Every semantic token and a few representative components, rendered in all three shipped themes. This is the reskin test: everything below is styled only with <code class="mono">--hf-*</code> custom properties from <code class="mono">tokens.json</code> -- no component hardcodes a color, a spacing value, or a font size.</p>
    <p class="mono dim">Live page theme (drives the header/body chrome only -- the panels below always show all three side by side):</p>
    <div class="theme-switcher" role="group" aria-label="Page theme">
      ${themes.map((t, i) => `<button type="button" data-set-theme="${t}" aria-pressed="${i === 0}">${t}</button>`).join("\n      ")}
    </div>
  </div>

  <main>
    ${themes.map(themePanel).join("\n")}
  </main>

  <footer>
    Generated by <code class="mono">scripts/build-styleguide.mjs</code> from <code class="mono">tokens.json</code>. Regenerate with <code class="mono">npm run styleguide</code> (inside packages/theme) after editing tokens.
  </footer>

<script>
  var buttons = document.querySelectorAll('[data-set-theme]');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var theme = btn.getAttribute('data-set-theme');
      document.documentElement.setAttribute('data-theme', theme);
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
    });
  });
</script>
</body>
</html>
`;

writeFileSync(path.join(ROOT, "styleguide.html"), html, "utf8");
console.log("Generated styleguide.html");
