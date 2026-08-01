// Turn a resolved token {type, value} into a CSS-literal string.

export function cssLiteral(type, value) {
  switch (type) {
    case "fontFamily":
      return value
        .map((f) => (f.includes(" ") && !f.startsWith("-") ? `"${f}"` : f))
        .join(", ");
    case "cubicBezier":
      return `cubic-bezier(${value.join(", ")})`;
    case "fontWeight":
    case "number":
    case "dimension":
    case "duration":
    case "color":
      return String(value);
    default:
      return String(value);
  }
}
