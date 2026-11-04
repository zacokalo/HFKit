// The HF spectrum as a beginner meets it: what a frequency is called, how long
// its waves are, and who else lives nearby.
//
// Amateur band edges are ITU Region 2 (the Americas) and differ slightly
// elsewhere; the page says so. Broadcast and time-signal entries are the
// well-known ITU allocations, not a list of who is on the air today.

export const LIGHT_MHZ_M = 299.792458;
export const wavelengthM = (fMHz) => LIGHT_MHZ_M / fMHz;

/** The range the Learn page's frequency controls cover. */
export const HF_MIN_MHZ = 1.8;
export const HF_MAX_MHZ = 54;

export const HAM_BANDS = [
  { id: '160m', label: '160 m', lo: 1.8, hi: 2.0,
    character: 'A night-time band for big antennas. Regional after dark, long distance in winter.' },
  { id: '80m', label: '80 m', lo: 3.5, hi: 4.0,
    character: 'The evening regional band and an NVIS workhorse. Mostly soaked up by daylight.' },
  { id: '60m', label: '60 m', lo: 5.33, hi: 5.41,
    character: 'A handful of channels in many countries. Superb for NVIS in daylight.' },
  { id: '40m', label: '40 m', lo: 7.0, hi: 7.3,
    character: 'Works day and night: regional by day, long distance after dark.' },
  { id: '30m', label: '30 m', lo: 10.1, hi: 10.15,
    character: 'Narrow, Morse and digital only. Often open around the clock.' },
  { id: '20m', label: '20 m', lo: 14.0, hi: 14.35,
    character: 'The classic daytime long-distance band.' },
  { id: '17m', label: '17 m', lo: 18.068, hi: 18.168,
    character: 'Daytime long distance, and quieter than 20 m.' },
  { id: '15m', label: '15 m', lo: 21.0, hi: 21.45,
    character: 'Daytime long distance whenever the sun is reasonably active.' },
  { id: '12m', label: '12 m', lo: 24.89, hi: 24.99,
    character: 'Opens in daylight when solar activity is good.' },
  { id: '10m', label: '10 m', lo: 28.0, hi: 29.7,
    character: 'Wide open worldwide near solar maximum; quiet near minimum, apart from summer sporadic E.' },
  { id: '6m', label: '6 m', lo: 50.0, hi: 54.0,
    character: 'Just above HF. Mostly local, with exciting sporadic-E openings in summer.' },
];

/** Neighbours worth knowing about. Points have `at`; ranges have lo/hi. */
export const OTHER_SERVICES = [
  { label: 'WWV time signal', at: 2.5 },
  { label: '49 m broadcast band', lo: 5.9, hi: 6.2 },
  { label: 'WWV time signal', at: 5.0 },
  { label: '41 m broadcast band', lo: 7.2, hi: 7.45 },
  { label: 'CHU time signal', at: 7.85 },
  { label: '31 m broadcast band', lo: 9.4, hi: 9.9 },
  { label: 'WWV time signal', at: 10.0 },
  { label: '25 m broadcast band', lo: 11.6, hi: 12.1 },
  { label: 'WWV time signal', at: 15.0 },
  { label: '19 m broadcast band', lo: 15.1, hi: 15.8 },
  { label: '16 m broadcast band', lo: 17.48, hi: 17.9 },
  { label: 'WWV time signal', at: 20.0 },
  { label: '13 m broadcast band', lo: 21.45, hi: 21.85 },
  { label: 'CB radio (11 m)', lo: 26.965, hi: 27.405 },
];

/** How close to a point frequency counts as "on" it, MHz. */
const POINT_TOLERANCE = 0.05;

/** What lives at `fMHz`: the amateur band if any, and any other services. */
export function whatsHere(fMHz) {
  const band = HAM_BANDS.find((b) => fMHz >= b.lo && fMHz <= b.hi) ?? null;
  const others = OTHER_SERVICES.filter((s) => (s.at !== undefined
    ? Math.abs(fMHz - s.at) <= POINT_TOLERANCE
    : fMHz >= s.lo && fMHz <= s.hi));
  let nearest = null;
  if (!band) {
    let best = Infinity;
    for (const b of HAM_BANDS) {
      const d = fMHz < b.lo ? b.lo - fMHz : fMHz - b.hi;
      if (d < best) { best = d; nearest = b; }
    }
  }
  return { band, nearest, others };
}

// Everyday things to measure a wave against, by length in metres.
const THINGS = [
  { one: 'football pitch', many: 'football pitches', m: 105 },
  { one: 'tennis court', many: 'tennis courts', m: 23.8 },
  { one: 'bus', many: 'buses', m: 12 },
  { one: 'car', many: 'cars', m: 4.5 },
  { one: 'person lying down', many: 'people lying head to toe', m: 1.7 },
];

/**
 * "About 3.4 tennis courts": the largest everyday thing that fits at least one
 * and a half times, so the count is never an awkward fraction below two.
 */
export function comparison(metres) {
  const thing = THINGS.find((t) => metres / t.m >= 1.5) ?? THINGS[THINGS.length - 1];
  const count = metres / thing.m;
  return { ...thing, count, text: `${count.toFixed(1)} ${count >= 1.05 ? thing.many : thing.one}` };
}
