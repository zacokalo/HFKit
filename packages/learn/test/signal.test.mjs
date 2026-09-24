import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  copyVerdict, dbFromRatio, noiseDbm, receivedDbm, sMeter, MODES, NOISE_ENVIRONMENTS,
  REFERENCE_SIGNAL_DBM, S9_DBM, TX_ANTENNAS,
} from '../signal.mjs';

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

describe('decibels', () => {
  test('double is 3 dB, ten times is 10 dB', () => {
    near(dbFromRatio(2), 3.01, 0.01, 'double');
    assert.equal(dbFromRatio(10), 10);
  });

  test('ten times the power is under two S-units', () => {
    const gain = receivedDbm({ watts: 1000, antennaId: 'dipole' })
      - receivedDbm({ watts: 100, antennaId: 'dipole' });
    near(gain, 10, 1e-9, '100 W to 1000 W');
    assert.ok(gain / 6 < 2);
  });

  test('antenna gain adds straight onto the signal', () => {
    const beam = TX_ANTENNAS.find((a) => a.id === 'beam');
    near(receivedDbm({ watts: 100, antennaId: 'beam' }), REFERENCE_SIGNAL_DBM + beam.gainDb, 1e-9, 'beam');
  });
});

describe('the S-meter', () => {
  test('S9 is -73 dBm and each S-unit is 6 dB', () => {
    assert.equal(sMeter(S9_DBM).label, 'S9');
    assert.equal(sMeter(-79).label, 'S8');
    assert.equal(sMeter(-97).label, 'S5');
  });

  test('above S9 reads in decibels', () => {
    assert.equal(sMeter(-53).label, 'S9+20');
    assert.equal(sMeter(-63).label, 'S9+10');
  });

  test('never reads below S0', () => {
    assert.equal(sMeter(-160).label, 'S0');
  });
});

describe('noise', () => {
  test('follows ITU-R P.372: city > suburb > rural > quiet countryside', () => {
    const n = NOISE_ENVIRONMENTS.map((e) => noiseDbm(e.id, 7.1));
    for (let i = 1; i < n.length; i++) assert.ok(n[i] > n[i - 1], JSON.stringify(n));
  });

  test('the city-to-countryside gap is worth more than ten times the power', () => {
    assert.ok(noiseDbm('city', 7.1) - noiseDbm('quiet', 7.1) > 10);
  });

  test('P.372 residential noise on 40 m lands near S6 in a voice channel', () => {
    // Fam = 72.5 - 27.7 log10(7.1) = 48.9 dB above kT0; -174 + 34 dB-Hz.
    near(noiseDbm('residential', 7.1), -91, 1, 'residential');
  });

  test('noise falls with frequency, which is why the low bands are noisier', () => {
    assert.ok(noiseDbm('residential', 3.6) > noiseDbm('residential', 14.2));
  });

  test('galactic noise sets the floor in the quietest places', () => {
    // At 21 MHz, P.372 quiet-rural man-made noise (15.8 dB) is under galactic (21.6).
    assert.ok(noiseDbm('quiet', 21) > 21.6 - 174 + 10 * Math.log10(2500) - 0.01);
  });
});

describe('copy verdicts', () => {
  test('FT8 decodes where voice is buried', () => {
    assert.equal(copyVerdict(-12, 'ssb'), 'buried');
    assert.notEqual(copyVerdict(-12, 'ft8'), 'buried');
  });

  test('each mode needs less than the one before it', () => {
    const [ssb, cw, ft8] = MODES;
    assert.ok(ssb.readableDb > cw.readableDb && cw.readableDb > ft8.readableDb);
  });

  test('rejects an unknown mode rather than guessing', () => {
    assert.throws(() => copyVerdict(0, 'smoke-signals'));
  });
});
