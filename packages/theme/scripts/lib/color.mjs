// Minimal WCAG 2.x contrast math. No dependencies on purpose.
// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance

/**
 * Parse a #rgb / #rgba / #rrggbb / #rrggbbaa hex string into 0-255 channels.
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
export function parseHex(hex) {
  const s = hex.trim().replace(/^#/, "");
  let r, g, b, a = 255;
  if (s.length === 3 || s.length === 4) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
    if (s.length === 4) a = parseInt(s[3] + s[3], 16);
  } else if (s.length === 6 || s.length === 8) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
    if (s.length === 8) a = parseInt(s.slice(6, 8), 16);
  } else {
    throw new Error(`Not a hex color: "${hex}"`);
  }
  if ([r, g, b, a].some((v) => Number.isNaN(v))) {
    throw new Error(`Not a hex color: "${hex}"`);
  }
  return { r, g, b, a };
}

function channelToLinear(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a hex color (0 = black, 1 = white). */
export function relativeLuminance(hex) {
  const { r, g, b } = parseHex(hex);
  const R = channelToLinear(r);
  const G = channelToLinear(g);
  const B = channelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two colors, 1..21. */
export function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function formatRatio(ratio) {
  return `${ratio.toFixed(2)}:1`;
}
