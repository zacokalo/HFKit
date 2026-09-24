// Beginner or experienced: how much the site explains as it goes.
//
// Beginner is the default. A first visit decides whether someone comes back,
// and a landing page of SNR margins and Kp indices is a wall to a newcomer.
// People who know their way around say so once and are remembered, in this
// browser only.
//
// The mode changes where you land and how much is explained on the way. It
// never changes what is computed, and it never removes a caveat: the home
// page folds its "what is real" notes for beginners rather than dropping them,
// and every tool page keeps its own warnings in both modes.

const KEY = 'hfkit.mode';
export const MODES = ['beginner', 'experienced'];

export function getMode() {
  try {
    return localStorage.getItem(KEY) === 'experienced' ? 'experienced' : 'beginner';
  } catch {
    return 'beginner';
  }
}

/** Reflect the mode on <html data-mode>, which the stylesheets key off. */
export function applyMode(mode = getMode()) {
  document.documentElement.setAttribute('data-mode', mode);
  return mode;
}

export function setMode(mode) {
  const m = MODES.includes(mode) ? mode : 'beginner';
  try { localStorage.setItem(KEY, m); } catch { /* private mode: this page only */ }
  applyMode(m);
  document.dispatchEvent(new CustomEvent('hfkit:mode', { detail: m }));
  return m;
}

/**
 * "How to read this page", one per tool, shown only in beginner mode.
 *
 * Folded to a single line so it costs the page almost nothing until someone
 * opens it. The copy describes what the page actually draws — its legend
 * words, its units, its time zone — so it has to change when the page does.
 */
export const GUIDES = {
  'planner.html': {
    points: [
      'Choose where you are transmitting from and who you want to reach, then press Predict 24 h.',
      'Each row is an hour of the day and each column a frequency in MHz: 7.1 is in the 40 m band, 14.1 in 20 m. Hours are in UTC, the clock radio operators share worldwide, so not your local time.',
      'Each number is the signal margin in dB: how far the predicted signal clears what a Morse contact needs. Good (+10 or more) is worth trying, fair (0 to +10) might work, and poor or closed probably will not.',
      'The last column is the MUF, the highest frequency the path supports at that hour.',
      'It assumes simple antennas, so a real station usually does a little better.',
    ],
    learn: ['daynight', 'Day, night and picking a band'],
  },
  'reach.html': {
    points: [
      'Search for a place, or use your location, to set the transmitter. Then press Generate. The map fills in over a few seconds, rough at first and then sharper.',
      'The colours show how well you would be heard in each area, at the hour on the slider. Hours are in UTC. The legend under the map says what each colour means, from meets the requirement to well short.',
      'The shaded half of the world is night. Move the hour slider and watch coverage change with the sun.',
      'Click anywhere on the map for the detail there, including a 24-hour chart for that exact path.',
    ],
    learn: ['ionosphere', 'The ionosphere: a mirror in the sky'],
  },
  'antenna.html': {
    points: [
      'Pick a band and an antenna. The page tells you how long to cut the wire and how high to hang it.',
      'The side-view plot shows where your signal goes. Tall and round means straight up, for nearby stations (NVIS). Low and flat means toward the horizon, for long distance.',
      'The dashed line marks the angle your chosen distance needs. The more of the shape that reaches it, the better that antenna suits the path.',
    ],
    learn: ['antennas', 'Antennas: where your signal goes'],
  },
  'space.html': {
    points: [
      'The sentence at the top sums up today. The numbers underneath explain it.',
      'Solar flux: higher means the higher bands, 15 m to 10 m, open up in daylight.',
      'Kp: 0 to 2 is quiet and 5 or more is a storm. Storms hit paths near the poles hardest.',
      'Every figure says where it came from and how old it is.',
    ],
    learn: ['sun', 'The sun and space weather'],
  },
};

/** Insert the page's guide under its header. No guide, no change. */
export function mountGuide(container, currentFile) {
  const g = GUIDES[currentFile];
  if (!g) return null;
  const d = document.createElement('details');
  d.className = 'guide';
  const s = document.createElement('summary');
  const badge = document.createElement('span');
  badge.className = 'guide-badge';
  badge.textContent = 'Beginner';
  s.append(badge, 'New to this page? How to read it');
  const ul = document.createElement('ul');
  for (const p of g.points) {
    const li = document.createElement('li');
    li.textContent = p;
    ul.append(li);
  }
  const more = document.createElement('p');
  const a = document.createElement('a');
  a.href = `./learn.html#${g.learn[0]}`;
  a.textContent = `Learn: ${g.learn[1]} →`;
  more.append('The idea behind this page, with something to play with: ', a);
  const hide = document.createElement('p');
  hide.className = 'guide-off';
  const off = document.createElement('button');
  off.type = 'button';
  off.textContent = 'Switch to experienced mode';
  off.addEventListener('click', () => setMode('experienced'));
  hide.append('Know all this already? ', off, ' to hide these guides.');
  d.append(s, ul, more, hide);

  const header = [...container.children].find((c) => c.tagName === 'HEADER');
  if (header) header.after(d);
  else container.querySelector('.sitenav')?.after(d);
  return d;
}
