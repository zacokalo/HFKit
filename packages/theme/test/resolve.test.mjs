import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadTokens, themeNames, resolveTheme, resolveAllThemes } from "../scripts/lib/resolve.mjs";

const TOKENS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tokens.json");

const SEMANTIC_SHAPE = {
  surface: ["default", "raised", "sunken", "overlay"],
  text: ["primary", "secondary", "muted", "inverse", "disabled"],
  border: ["subtle", "default", "strong"],
  accent: ["interactive", "interactiveHover", "interactiveActive", "onAccent"],
  focus: ["ring"],
};
const STATUS_KEYS = ["good", "fair", "poor", "closed", "stale"];
const STATUS_SUBKEYS = ["fill", "on", "text"];

test("tokens.json parses and declares at least the three required themes", () => {
  const tokens = loadTokens(TOKENS_PATH);
  const names = themeNames(tokens);
  assert.ok(names.includes("field-dark"));
  assert.ok(names.includes("field-light"));
  assert.ok(names.length >= 3, "expected a third, deliberately different theme");
});

test("every theme resolves every reference with no dangling {refs}", () => {
  const tokens = loadTokens(TOKENS_PATH);
  const all = resolveAllThemes(tokens);
  for (const [name, resolved] of Object.entries(all)) {
    for (const t of resolved.flat) {
      assert.equal(typeof t.value === "string" || typeof t.value === "number" || Array.isArray(t.value), true, `${name}: ${t.path} resolved to an unexpected type`);
      if (typeof t.value === "string") {
        assert.doesNotMatch(t.value, /\{[^}]+\}/, `${name}: ${t.path} still contains an unresolved reference: ${t.value}`);
      }
    }
  }
});

test("every theme exposes the identical semantic shape (this is what makes a theme a safe reskin)", () => {
  const tokens = loadTokens(TOKENS_PATH);
  for (const name of themeNames(tokens)) {
    const resolved = resolveTheme(tokens, name);
    for (const [group, keys] of Object.entries(SEMANTIC_SHAPE)) {
      for (const key of keys) {
        const p = `semantic.${group}.${key}`;
        assert.ok(p in resolved.byPath, `${name} is missing ${p}`);
      }
    }
    for (const status of STATUS_KEYS) {
      for (const sub of STATUS_SUBKEYS) {
        const p = `semantic.status.${status}.${sub}`;
        assert.ok(p in resolved.byPath, `${name} is missing ${p}`);
      }
    }
  }
});

test("color tokens are well-formed hex", () => {
  const tokens = loadTokens(TOKENS_PATH);
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  for (const name of themeNames(tokens)) {
    const resolved = resolveTheme(tokens, name);
    for (const t of resolved.flat) {
      if (t.type === "color") {
        assert.match(t.value, HEX_RE, `${name}: ${t.path} = "${t.value}" is not a 6-digit hex color`);
      }
    }
  }
});

test("dataviz sequential and categorical ramps are non-empty and unique per theme", () => {
  const tokens = loadTokens(TOKENS_PATH);
  for (const name of themeNames(tokens)) {
    const resolved = resolveTheme(tokens, name);
    for (const kind of ["sequential", "categorical"]) {
      const stops = resolved.flat.filter((t) => t.path.startsWith(`dataviz.${kind}.`)).map((t) => t.value);
      assert.ok(stops.length >= 4, `${name}: dataviz.${kind} should have at least 4 stops, got ${stops.length}`);
      assert.equal(new Set(stops).size, stops.length, `${name}: dataviz.${kind} has duplicate colors`);
    }
  }
});

test("night-ops (the third theme) never emits blue or green in its semantic/status/dataviz colors", () => {
  const tokens = loadTokens(TOKENS_PATH);
  const resolved = resolveTheme(tokens, "night-ops");
  for (const t of resolved.flat) {
    if (t.type !== "color") continue;
    if (!(t.path.startsWith("semantic.") || t.path.startsWith("dataviz.") || t.path.startsWith("component."))) continue;
    const { r, g, b } = hexToRgb(t.value);
    // Warm-only discipline: red channel should never be meaningfully exceeded by green or blue.
    assert.ok(
      g <= r + 12 && b <= r + 12,
      `${t.path} = ${t.value} is not warm-dominant (r=${r} g=${g} b=${b}) -- night-ops must stay red-shifted`,
    );
  }
});

function hexToRgb(hex) {
  const n = hex.replace("#", "");
  return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16) };
}
