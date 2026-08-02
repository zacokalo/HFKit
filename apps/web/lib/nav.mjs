// Renders the site navigation, and a live conditions readout inside it.
//
// One implementation for every page: a link added here appears everywhere,
// which is the whole reason this is not four copies of the same markup.

import { loadSpaceWeather, describeAge } from './spacewx.mjs';
import { kpToken, describeKp } from './spacewx-copy.mjs';

const PAGES = [
  ['./index.html', 'Home'],
  ['./reach.html', 'Reach map'],
  ['./planner.html', 'Path planner'],
  ['./space.html', 'Space weather'],
  ['./styleguide.html', 'Style guide'],
];

const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/**
 * Insert the nav at the top of `container` and start loading conditions.
 *
 * The conditions readout is added only once real data arrives. A dash or a
 * spinner sitting where a Kp value goes invites being read as a Kp value, and
 * the whole point of the fallback chain is that we never show a number without
 * saying where it came from.
 */
export function mountNav(container, currentFile) {
  const nav = document.createElement('nav');
  nav.className = 'sitenav';
  nav.setAttribute('aria-label', 'Site');

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = './index.html';
  brand.textContent = 'HFKit';
  nav.append(brand);

  for (const [href, label] of PAGES) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (href.endsWith(currentFile)) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }

  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  nav.append(spacer);

  container.prepend(nav);
  void addConditions(nav);
  return nav;
}

async function addConditions(nav) {
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

  nav.append(a);
}
