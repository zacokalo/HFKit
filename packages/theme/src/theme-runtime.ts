import type { ThemeName } from "./generated/tokens.js";

const STORAGE_KEY = "hfkit:theme";

/**
 * Set `data-theme` on the document root so the CSS custom properties from
 * `tokens.css` swap live. No-op outside a DOM environment (e.g. during SSR
 * or in a chart/data pipeline that only needs the plain token values).
 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable (private browsing, SSR shim, etc.) -- theme still applies for this session.
  }
}

/** Read back a previously-applied theme choice, if any. Does not validate against `themeNames` -- callers should. */
export function readStoredTheme(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}
