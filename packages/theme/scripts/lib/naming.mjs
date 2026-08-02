// Shared path -> name conversions used by every generator, so CSS vars,
// Tailwind keys, and TS property names all trace back to the same token path.

/** "surface.default" -> "surface-default" ; "status.good.fill" -> "status-good-fill" */
export function kebabPath(path) {
  return path
    .split(".")
    .map((seg) => seg.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase())
    .join("-");
}

/** "semantic.surface.default" -> "--hf-surface-default" (drops the layer prefix) */
export function cssVarName(fullPath) {
  const [, ...rest] = fullPath.split(".");
  return `--hf-${kebabPath(rest.join("."))}`;
}

export function cssVarRef(fullPath) {
  return `var(${cssVarName(fullPath)})`;
}
