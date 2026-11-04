// One theme preference for the whole site.
//
// Before this, every page decided for itself: the landing page was pinned
// dark, the antenna page followed the system, the reach map had its own
// selector. Walking between them changed the colours underfoot. The
// preference now lives in one key and every page reads it through here.
//
// `lib/theme-boot.js` applies the same key before first paint, so a page does
// not flash the default theme while this module loads. The two must agree on
// the key and the fallback; that is the one piece of duplication, and it is
// documented in both places.

export const KEY = 'hfkit.theme';

export const THEMES = [
  { id: 'auto', label: 'Match system', short: 'Auto' },
  { id: 'field-dark', label: 'Dark', short: 'Dark' },
  { id: 'field-light', label: 'Light', short: 'Light' },
  { id: 'night-ops', label: 'Night ops', short: 'Night' },
];

const system = () => (matchMedia('(prefers-color-scheme: light)').matches ? 'field-light' : 'field-dark');

/** The stored preference, or 'auto' when none has been chosen. */
export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.some((x) => x.id === t) ? t : 'auto';
  } catch {
    return 'auto';
  }
}

/** The concrete token set a preference resolves to right now. */
export const resolveTheme = (t = getTheme()) => (t === 'auto' ? system() : t);

export function applyTheme(t = getTheme()) {
  document.documentElement.setAttribute('data-theme', resolveTheme(t));
}

export function setTheme(t) {
  if (!THEMES.some((x) => x.id === t)) t = 'auto';
  try { localStorage.setItem(KEY, t); } catch { /* private mode: applies for this page only */ }
  applyTheme(t);
  document.dispatchEvent(new CustomEvent('hfkit:theme', { detail: { theme: t, resolved: resolveTheme(t) } }));
}

export function cycleTheme() {
  const i = THEMES.findIndex((x) => x.id === getTheme());
  setTheme(THEMES[(i + 1) % THEMES.length].id);
  return getTheme();
}

// Follow the system while on auto. A change of system scheme mid-session is
// rare but real (sunset on a laptop set to switch), and ignoring it would leave
// the page on the wrong side of it until a reload.
try {
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getTheme() === 'auto') applyTheme('auto');
  });
} catch { /* very old browsers */ }
