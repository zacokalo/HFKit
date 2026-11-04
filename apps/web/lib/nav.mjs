// Renders the site navigation: brand, page links, the beginner/experienced
// switch, a live conditions readout, and the theme switch.
//
// One implementation for every page: a link added here appears everywhere,
// which is the whole reason this is not eight copies of the same markup.

import { loadSpaceWeather, describeAge } from './spacewx.mjs';
import { kpToken, describeKp } from './spacewx-copy.mjs';
import { THEMES, applyTheme, cycleTheme, getTheme } from './theme.mjs';
import { applyMode, getMode, mountGuide, setMode } from './mode.mjs';

const PAGES = [
  ['./index.html', 'Home'],
  ['./learn.html', 'Learn'],
  ['./comms.html', 'Comms planner'],
  ['./reach.html', 'Reach map'],
  ['./planner.html', 'Path planner'],
  ['./antenna.html', 'Antennas'],
  ['./space.html', 'Space weather'],
  ['./styleguide.html', 'Style guide'],
];

const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const BRAND_MARK = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <circle class="core" cx="10" cy="10" r="2.2"/>
  <path class="mark" d="M5.5 5.5a6.4 6.4 0 0 0 0 9"/>
  <path class="mark" d="M14.5 5.5a6.4 6.4 0 0 1 0 9"/>
  <path class="mark" d="M2.5 2.5a10.6 10.6 0 0 0 0 15"/>
  <path class="mark" d="M17.5 2.5a10.6 10.6 0 0 1 0 15"/>
</svg>`;

const THEME_ICON = {
  auto: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11"/></svg>',
  'field-dark': '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>',
  'field-light': '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>',
  'night-ops': '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.5"/></svg>',
};

/**
 * Insert the nav at the top of the document, the page's beginner guide under
 * its header, and start loading conditions.
 *
 * `container` is the page's content wrapper. The bar itself is placed on
 * <body> so it can span the full width and stay put while the page scrolls;
 * the guide goes inside the container, after its <header>.
 *
 * The conditions readout is added only once real data arrives. A dash or a
 * spinner sitting where a Kp value goes invites being read as a Kp value, and
 * the whole point of the fallback chain is that we never show a number without
 * saying where it came from.
 */
export function mountNav(container, currentFile) {
  applyTheme();
  applyMode();

  const bar = document.createElement('header');
  bar.className = 'sitebar';

  const nav = document.createElement('nav');
  nav.className = 'sitenav';
  nav.setAttribute('aria-label', 'Site');

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = './index.html';
  brand.innerHTML = `${BRAND_MARK}<span>HFKit</span>`;
  nav.append(brand);

  const links = document.createElement('div');
  links.className = 'links';
  for (const [href, label] of PAGES) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (href.endsWith(currentFile)) a.setAttribute('aria-current', 'page');
    links.append(a);
  }
  nav.append(links);

  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  nav.append(spacer);

  nav.append(modeSwitch());

  const theme = document.createElement('button');
  theme.type = 'button';
  theme.className = 'theme';
  const paint = () => {
    const t = getTheme();
    const meta = THEMES.find((x) => x.id === t);
    theme.innerHTML = `${THEME_ICON[t]}<span>${meta.short}</span>`;
    theme.title = `Theme: ${meta.label}. Click to change.`;
    theme.setAttribute('aria-label', `Theme: ${meta.label}. Click to change.`);
  };
  paint();
  theme.addEventListener('click', () => { cycleTheme(); paint(); });
  document.addEventListener('hfkit:theme', paint);
  nav.append(theme);

  bar.append(nav);
  document.body.prepend(bar);
  // Scroll the current page's link into view on narrow screens.
  links.querySelector('[aria-current]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  if (container) mountGuide(container, currentFile);
  void addConditions(nav, theme);
  return nav;
}

/** Beginner / Experienced, on every page. See mode.mjs for what it changes. */
function modeSwitch() {
  const g = document.createElement('div');
  g.className = 'modesw';
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', 'How much to explain');
  const buttons = [
    ['beginner', 'Beginner', 'Start from the basics, with a guide on every tool page'],
    ['experienced', 'Experienced', 'Land on the tools, with no guides'],
  ].map(([mode, label, title]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.mode = mode;
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => setMode(mode));
    return b;
  });
  const sync = (m) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  };
  sync(getMode());
  document.addEventListener('hfkit:mode', (e) => sync(e.detail));
  g.append(...buttons);
  return g;
}

async function addConditions(nav, before) {
  let sw;
  try {
    sw = await loadSpaceWeather({ timeoutMs: 6000 });
  } catch {
    return;                       // navigation must never depend on the weather
  }
  const kp = sw.geomag?.kp ?? null;
  const ssn = sw.solar?.ssn ?? null;
  if (kp === null && ssn === null) return;

  const a = document.createElement('a');
  a.className = 'wx';
  a.href = './space.html';

  if (kp !== null) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = cssv(`--hf-status-${kpToken(kp)}-fill`);
    a.append(dot);
    const k = document.createElement('span');
    k.innerHTML = `Kp <b>${kp}</b>`;
    a.append(k);
  }
  if (ssn !== null) {
    const s = document.createElement('span');
    s.innerHTML = `SSN <b>${ssn}</b>`;
    a.append(s);
  }

  a.title = [
    kp !== null ? `Planetary K index ${kp} — ${describeKp(kp).headline}` : null,
    ssn !== null ? `Effective sunspot number ${ssn}` : null,
    `${sw.tierLabel}, ${describeAge(sw.ageSeconds)}`,
    sw.degraded ? 'Some sources are missing or stale.' : null,
  ].filter(Boolean).join('\n');

  // Conditions sit between the mode switch and the theme button.
  nav.insertBefore(a, nav.querySelector('.modesw') ?? before);
}
