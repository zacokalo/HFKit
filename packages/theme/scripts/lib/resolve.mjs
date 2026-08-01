// Resolution engine for tokens.json (W3C Design Tokens format: $value / $type).
//
// Architecture (see README.md "Token layers"):
//   primitive   - raw values, shared by every theme
//   semantic    - one block per theme (field-dark, field-light, night-ops...),
//                 each referencing primitives by {primitive.x.y}
//   component   - defined once, referencing {semantic.x.y} generically; resolved
//                 per-theme so a single definition yields a different concrete
//                 value under each theme
//   dataviz     - one block per theme (status ramp lives in semantic.status;
//                 dataviz holds the sequential + categorical chart palettes)
//
// A "context" is the per-theme resolution scope:
//   { primitive, semantic, component, dataviz }
// Reference strings look like "{primitive.color.gray.900}" or
// "{semantic.surface.default}" and are resolved against that context.

import { readFileSync } from "node:fs";

const REF_RE = /^\{([^}]+)\}$/;
const REF_ANY_RE = /\{([^}]+)\}/g;

export function loadTokens(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

export function themeNames(tokens) {
  return Object.keys(tokens.semantic);
}

function buildContext(tokens, themeName) {
  if (!(themeName in tokens.semantic)) {
    throw new Error(`Unknown theme "${themeName}"`);
  }
  return {
    primitive: tokens.primitive,
    semantic: tokens.semantic[themeName],
    component: tokens.component,
    dataviz: (tokens.dataviz ?? {})[themeName] ?? {},
  };
}

function isTokenNode(node) {
  return (
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    Object.prototype.hasOwnProperty.call(node, "$value")
  );
}

function lookupPath(context, path) {
  const parts = path.split(".");
  let node = context;
  for (const part of parts) {
    if (node == null || typeof node !== "object" || !(part in node)) {
      throw new Error(`Unresolved token reference: "{${path}}"`);
    }
    node = node[part];
  }
  return node;
}

/**
 * Resolve a single token's raw $value against a context, following chained
 * references and detecting cycles. Returns the resolved primitive value
 * (string, number, or array).
 */
function resolveValue(rawValue, context, stack) {
  if (typeof rawValue === "string") {
    const wholeMatch = rawValue.match(REF_RE);
    if (wholeMatch) {
      return resolveRefPath(wholeMatch[1], context, stack);
    }
    if (REF_ANY_RE.test(rawValue)) {
      REF_ANY_RE.lastIndex = 0;
      return rawValue.replace(REF_ANY_RE, (_, path) => {
        const v = resolveRefPath(path, context, stack);
        if (typeof v !== "string" && typeof v !== "number") {
          throw new Error(
            `Cannot inline non-scalar reference "{${path}}" inside a string`,
          );
        }
        return String(v);
      });
    }
    return rawValue;
  }
  if (Array.isArray(rawValue)) {
    return rawValue.map((v) => resolveValue(v, context, stack));
  }
  return rawValue;
}

function resolveRefPath(path, context, stack) {
  if (stack.includes(path)) {
    throw new Error(
      `Circular token reference: ${[...stack, path].join(" -> ")}`,
    );
  }
  const node = lookupPath(context, path);
  if (!isTokenNode(node)) {
    throw new Error(`Reference "{${path}}" does not point to a token ($value missing)`);
  }
  return resolveValue(node.$value, context, [...stack, path]);
}

/**
 * Walk every token in a group tree and return a flat list of
 * { path, type, value } with all references resolved to concrete values.
 * `prefix` segments (e.g. ["semantic"]) are prepended to reported paths.
 */
export function flattenResolved(groupRoot, context, prefix = []) {
  const out = [];
  const walk = (node, path) => {
    if (isTokenNode(node)) {
      out.push({
        path: path.join("."),
        type: node.$type,
        value: resolveValue(node.$value, context, [path.join(".")]),
        description: node.$description,
      });
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (key.startsWith("$")) continue;
        walk(child, [...path, key]);
      }
    }
  };
  walk(groupRoot, prefix);
  return out;
}

/**
 * Resolve every token (primitive + semantic + component + dataviz) for one
 * theme. Returns { themeName, flat, byPath } where byPath maps the full
 * dotted path (e.g. "semantic.surface.default") to { type, value }.
 */
export function resolveTheme(tokens, themeName) {
  const context = buildContext(tokens, themeName);
  const flat = [
    ...flattenResolved(context.primitive, context, ["primitive"]),
    ...flattenResolved(context.semantic, context, ["semantic"]),
    ...flattenResolved(context.component, context, ["component"]),
    ...flattenResolved(context.dataviz, context, ["dataviz"]),
  ];
  const byPath = Object.fromEntries(
    flat.map((t) => [t.path, { type: t.type, value: t.value }]),
  );
  return { themeName, flat, byPath };
}

export function resolveAllThemes(tokens) {
  return Object.fromEntries(
    themeNames(tokens).map((name) => [name, resolveTheme(tokens, name)]),
  );
}

/** Get a resolved value by unprefixed path (e.g. "surface.default") from a resolved theme's semantic group. */
export function semantic(resolved, path) {
  const entry = resolved.byPath[`semantic.${path}`];
  if (!entry) throw new Error(`No semantic token "${path}" in theme ${resolved.themeName}`);
  return entry.value;
}
