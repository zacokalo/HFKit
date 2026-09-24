// "Check yourself" questions for each chapter of the Learn page.
//
// Every wrong answer is a misconception people genuinely hold, and every
// explanation says why the right one is right — a quiz that only says
// "correct" teaches nothing to the person who got it wrong.

export const CHAPTERS = [
  { id: 'waves', title: 'Radio waves and bands' },
  { id: 'ionosphere', title: 'The ionosphere: a mirror in the sky' },
  { id: 'daynight', title: 'Day, night and picking a band' },
  { id: 'antennas', title: 'Antennas: where your signal goes' },
  { id: 'signal', title: 'Power, decibels and noise' },
  { id: 'sun', title: 'The sun and space weather' },
];

export const QUIZ = {
  waves: [
    {
      q: 'A radio tuned to 7.1 MHz is in which amateur band?',
      options: ['80 m', '40 m', '20 m'],
      answer: 1,
      why: '300 ÷ 7.1 is about 42 m, and bands are named after a round number near their wavelength: 40 m.',
    },
    {
      q: 'Turn the frequency up and the wavelength gets…',
      options: ['longer', 'shorter', 'no different'],
      answer: 1,
      why: 'Frequency and wavelength describe the same wave from two sides: double one and the other halves. It is why antennas for the high bands are small.',
    },
  ],
  ionosphere: [
    {
      q: 'You tune above the MUF for your angle. What happens to your signal?',
      options: [
        'It bounces back even further',
        'It passes through the ionosphere into space',
        'It is absorbed by the D layer',
      ],
      answer: 1,
      why: 'Above the MUF the layer cannot bend the signal round far enough, so it carries on upward and is gone.',
    },
    {
      q: 'A station 3,000 km away hears you on 14 MHz, but one 300 km away cannot. Why?',
      options: [
        'Your antenna is pointed the wrong way',
        'They are in the skip zone — the sky wave comes down beyond them',
        '14 MHz only works at night',
      ],
      answer: 1,
      why: 'The steep rays that would land nearby go straight through the ionosphere. Only the shallow ones come back, and they land far away.',
    },
  ],
  daynight: [
    {
      q: 'It is midday. Which band is most likely to reach a station 3,000 km away?',
      options: ['80 m', '40 m', '20 m'],
      answer: 2,
      why: 'By day the D layer soaks up the low bands. 20 m is high enough to get through it, and still under the MUF.',
    },
    {
      q: 'Why do 80 m and 160 m come alive at night?',
      options: [
        'The ionosphere gets thicker after dark',
        'The D layer that absorbs them fades away once the sun sets',
        'There is less traffic on the air',
      ],
      answer: 1,
      why: 'The D layer needs sunlight to exist. Without it the low bands lose their biggest source of loss — while the higher bands close as the F layer weakens.',
    },
  ],
  antennas: [
    {
      q: 'You want to reach towns 50–300 km away on 40 m. How should you hang your dipole?',
      options: [
        'As high as you possibly can',
        'Low — around a tenth to a quarter of a wavelength up',
        'Vertically, on a tall pole',
      ],
      answer: 1,
      why: 'A low dipole sends most of its energy straight up. That comes straight back down all around you — NVIS, exactly what nearby coverage needs.',
    },
    {
      q: 'Raising a dipole higher mostly…',
      options: [
        'increases the power it radiates',
        'lowers the angle of its main beam, favouring long distance',
        'changes the frequency it works on',
      ],
      answer: 1,
      why: 'Height changes where the energy goes, not how much there is. Higher means lower angles, which means longer hops.',
    },
  ],
  signal: [
    {
      q: 'You go from 100 W to 400 W. Roughly how much stronger do you sound?',
      options: ['Four times as loud — four S-units', 'About one S-unit (6 dB)', 'No difference at all'],
      answer: 1,
      why: 'Four times the power is 6 dB, and one S-unit is 6 dB. Noticeable, but not the transformation the number suggests.',
    },
    {
      q: 'A friend in the city cannot hear you, but someone in the countryside can. What is the most likely reason?',
      options: [
        'Buildings block HF signals',
        'City receivers are less sensitive',
        'Electrical noise in the city is drowning your signal',
      ],
      answer: 2,
      why: 'Man-made noise in a city can be 20 dB higher than in quiet countryside — the same as a hundred times less power.',
    },
  ],
  sun: [
    {
      q: 'The solar flux is high. What does that usually mean?',
      options: [
        'The higher bands, 15 m to 10 m, open up in daylight',
        'All of HF is blacked out',
        'Only 160 m works',
      ],
      answer: 0,
      why: 'More solar activity means a more strongly ionised F layer, a higher MUF, and higher bands that come back to earth.',
    },
    {
      q: 'A geomagnetic storm (high Kp) is under way. Which paths suffer most?',
      options: ['Paths near the equator', 'Paths that cross the polar regions', 'Every path equally'],
      answer: 1,
      why: 'Storms are driven by the Earth’s magnetic field, which funnels them toward the poles. Low-latitude paths often carry on almost as normal.',
    },
  ],
};
