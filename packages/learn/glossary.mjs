// Plain-language definitions, used as hover copy on the Learn page and as its
// searchable glossary.
//
// docs/08-domain-model.md §3 is the vocabulary of record and says its
// glossary "doubles as tooltip copy". This is that copy. A test holds the two
// word-for-word in step, so a definition is written once and edited in the doc.
//
// `note` is the one exception: page-only context the doc has no reason to
// carry, such as a term that names something HFKit has not built yet.

export const GLOSSARY = [
  // --- from the original domain glossary -----------------------------------
  { term: 'MUF', definition: 'Maximum Usable Frequency — the highest frequency that still bounces back to earth on a path. Above it, signals pass into space.' },
  { term: 'LUF', definition: 'Lowest Usable Frequency — below this, the signal is absorbed before it gets anywhere.' },
  { term: 'FOT', definition: 'Frequency of Optimum Transmission — the reliable sweet spot, roughly 85% of the MUF.' },
  { term: 'foF2', definition: "The F2 layer's critical frequency measured straight up; the basis for calculating MUF at a distance." },
  { term: 'SFI', definition: 'Solar Flux Index (10.7 cm) — proxy for solar activity. Higher generally means higher usable frequencies.' },
  { term: 'Kp / Ap', definition: 'Geomagnetic disturbance indices. High Kp means storms, which wreck high-latitude paths.' },
  { term: 'SSN', definition: 'Sunspot number — the traditional solar activity driver for prediction models.' },
  { term: 'SID', definition: 'Sudden Ionospheric Disturbance — a solar flare knocking out HF on the daylight side, minutes to hours.' },
  { term: 'D layer', definition: 'Lowest ionospheric layer. Absorbs low frequencies in daytime — why 80 m is a night band.' },
  { term: 'F2 layer', definition: 'The layer that does the useful long-distance reflecting.' },
  { term: 'Gray line', definition: 'The sunrise/sunset terminator; propagation along it is often enhanced.' },
  { term: 'Hop', definition: 'One bounce off the ionosphere. Longer paths need multiple hops.' },
  { term: 'Takeoff angle', definition: 'The vertical angle at which your antenna radiates — low angles for distance, high for local.' },
  { term: 'NVIS', definition: 'Near Vertical Incidence Skywave — deliberately straight up and back down for regional coverage out to a few hundred km. Critical for EMCOMM, poorly served by DX-oriented tools.' },
  { term: 'Reliability (REL)', definition: "The prediction engine's probability that the signal is strong enough on a given day.",
    note: 'The engine’s reliability output has a known defect, so HFKit’s tools show SNR margin instead.' },
  { term: 'A-score', definition: "HFKit's 0–100 estimate combining prediction, live ionosphere, disturbances, and observed activity.",
    note: 'Planned, not built yet.' },

  // --- beginner terms, added with the Learn page ---------------------------
  { term: 'HF', definition: 'High Frequency, 3–30 MHz — the shortwave range, where signals can bounce off the ionosphere and cross the world.' },
  { term: 'Frequency', definition: 'How many times a radio wave vibrates each second, counted in megahertz (MHz) — millions of times a second.' },
  { term: 'Wavelength', definition: 'The length of one wave in metres: 300 divided by the frequency in MHz. Bands are named after it — 7 MHz is the 40 m band.' },
  { term: 'Band', definition: 'A range of frequencies set aside for one use, such as the amateur 20 m band (14.00–14.35 MHz).' },
  { term: 'Propagation', definition: 'How a radio signal travels from transmitter to receiver — along the ground, or up to the ionosphere and back.' },
  { term: 'Ionosphere', definition: 'Layers of electrically charged gas 60–400 km up, made by sunlight, that can bend HF signals back to earth.' },
  { term: 'Skywave', definition: 'A signal that reaches its destination by bouncing off the ionosphere.' },
  { term: 'Ground wave', definition: 'A signal that hugs the ground. On HF it fades out within a few tens of kilometres.' },
  { term: 'Skip zone', definition: 'The gap between where the ground wave fades and where the sky wave first comes down, in which nothing is heard.' },
  { term: 'E layer', definition: 'The ionospheric layer around 110 km up. By day it can reflect lower frequencies over shorter hops.' },
  { term: 'Critical frequency', definition: 'The highest frequency a layer reflects when a signal is sent straight up at it.' },
  { term: 'Absorption', definition: 'Signal energy soaked up in the D layer — worst around noon and on the lowest frequencies.' },
  { term: 'Dipole', definition: 'The simplest wire antenna: two equal lengths of wire fed in the middle, half a wavelength long in total.' },
  { term: 'Decibel (dB)', definition: 'A way of comparing two powers. +3 dB is double the power, +10 dB is ten times, +20 dB is a hundred times.' },
  { term: 'S-meter', definition: "A receiver's signal-strength meter, marked in S-units from S1 to S9. One S-unit is 6 dB, or four times the power." },
  { term: 'SNR', definition: 'Signal-to-noise ratio — how far a signal stands above the background noise, in dB. It decides whether you can copy it.' },
  { term: 'Noise floor', definition: 'The background hiss and electrical interference a receiver hears when no signal is present.' },
  { term: 'DX', definition: 'Long-distance contacts, usually with other countries or continents.' },
  { term: 'Solar cycle', definition: "The sun's roughly 11-year rise and fall in activity. Near its peak, the higher HF bands open up." },
  { term: 'Aurora', definition: 'The glowing, disturbed upper atmosphere near the poles during geomagnetic storms. It absorbs and scatters HF signals.' },
];

/** Stable id for linking to an entry: "Kp / Ap" -> "g-kp-ap". */
export const termId = (term) =>
  `g-${term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export const lookup = (term) => GLOSSARY.find((g) => g.term === term) ?? null;
