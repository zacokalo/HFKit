// Golden tests against payloads captured from the live services. When an
// upstream changes shape, the diff between fixture and reality is the whole
// diagnosis — update the parser and the fixture together, never one alone.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  SOURCES, buildBundle, engineSsn, parseAlerts, parseEssn, parseF107,
  parseKp, parseKpForecast, parseUtc,
} from '../index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => JSON.parse(readFileSync(path.join(here, 'fixtures', n), 'utf8'));

const ESSN = fixture('essn.json');
const KP = fixture('kp.json');
const KPF = fixture('kpf.json');
const F107 = fixture('f107.json');
const ALERTS = fixture('alerts.json');

describe('parsers (golden)', () => {
  test('effective SSN comes from the steadier 24-hour fit', () => {
    const p = parseEssn(ESSN);
    assert.equal(p.ssn, Math.round(ESSN['24h'].at(-1).ssn * 10) / 10);
    assert.notEqual(p.ssn, Math.round(ESSN['6h'].at(-1).ssn * 10) / 10,
      'fixture should have differing fits, else the test proves nothing');
    assert.ok(p.sfi > 60 && p.sfi < 400);
    assert.match(p.observedAt, /^\d{4}-\d\d-\d\dT/);
  });

  test('Kp takes the most recent record', () => {
    const p = parseKp(KP);
    assert.equal(p.kp, KP.at(-1).Kp);
    assert.match(p.observedAt, /Z$/);
  });

  test('Kp forecast keeps only predicted rows', () => {
    const f = parseKpForecast(KPF);
    assert.ok(f.length > 0);
    assert.equal(f.length, KPF.filter((r) => r.observed === 'predicted').length);
  });

  test('F10.7 takes the newest, which is first in this feed', () => {
    assert.equal(parseF107(F107).f107, Math.round(Number(F107[0].flux) * 10) / 10);
  });

  test('alerts keep the bulletin verbatim and lift a headline', () => {
    const a = parseAlerts(ALERTS);
    assert.equal(a.length, ALERTS.length);
    assert.equal(a[0].message, ALERTS[0].message, 'must not paraphrase an alert');
    assert.ok(a[0].headline.length > 0);
    assert.doesNotMatch(a[0].headline, /^SUMMARY:/i);
  });

  test('SWPC timestamps are read as UTC, not local', () => {
    assert.equal(parseUtc('2026-08-01T17:02:31').toISOString(), '2026-08-01T17:02:31.000Z');
    assert.equal(parseUtc('2026-08-01 17:02:31.810').toISOString(), '2026-08-01T17:02:31.810Z');
  });
});

describe('gates', () => {
  const cases = [
    ['empty essn', () => parseEssn({ '24h': [] })],
    ['essn missing series', () => parseEssn({})],
    ['essn out of range', () => parseEssn({ '24h': [{ time: 1, ssn: 9000, sfi: 100 }] })],
    ['essn non-numeric', () => parseEssn({ '24h': [{ time: 1, ssn: 'lots', sfi: 100 }] })],
    ['kp empty', () => parseKp([])],
    ['kp without a Kp field', () => parseKp([{ time_tag: '2026-01-01T00:00:00' }])],
    ['kp out of range', () => parseKp([{ time_tag: '2026-01-01T00:00:00', Kp: 42 }])],
    ['f107 empty', () => parseF107([])],
    ['forecast with no predictions', () => parseKpForecast([{ time_tag: '2026-01-01T00:00:00', kp: 1, observed: 'observed' }])],
    ['unparseable timestamp', () => parseUtc('the day before yesterday')],
  ];
  for (const [name, fn] of cases) {
    test(`rejects ${name}`, () => assert.throws(fn));
  }
});

describe('engineSsn', () => {
  test('quantises to the nearest 5 so caches survive a twitch', () => {
    assert.equal(engineSsn(84.3), 85);
    assert.equal(engineSsn(82.4), 80);
    assert.equal(engineSsn(99.4), 100);
  });
  test('clamps rather than emitting nonsense', () => {
    assert.equal(engineSsn(-3), 0);
    assert.equal(engineSsn(1e6), 400);
  });
});

// --- bundle assembly -----------------------------------------------------

const okRes = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const routed = (map) => async (url) => {
  for (const [key, src] of Object.entries(SOURCES)) {
    if (src.url === url) {
      const v = map[key];
      if (v instanceof Error) throw v;
      if (v === 'html') {
        return { ok: true, status: 200, text: async () => '<!doctype html><html>oops</html>' };
      }
      if (v === 404) return { ok: false, status: 404, text: async () => 'not found' };
      return okRes(v);
    }
  }
  throw new Error(`unexpected url ${url}`);
};
const ALL = { essn: ESSN, kp: KP, kpForecast: KPF, f107: F107, alerts: ALERTS };
const NOW = new Date(ESSN['24h'].at(-1).time * 1000 + 60_000);

describe('buildBundle', () => {
  test('assembles every source when all are healthy', async () => {
    const b = await buildBundle({ fetchImpl: routed(ALL), now: () => NOW });
    assert.equal(b.schema, 1);
    assert.equal(b.degraded, false);
    assert.ok(b.solar.ssn > 0);
    assert.equal(b.solar.engineSsn % 5, 0);
    assert.ok(b.geomag.kp >= 0);
    assert.ok(Array.isArray(b.geomag.forecast) && b.geomag.forecast.length > 0);
    assert.ok(b.flux.f107 > 0);
    assert.ok(b.alerts.length > 0);
    for (const s of Object.values(b.sources)) assert.equal(s.ok, true);
  });

  // The point of settling each source independently: KC2G being down must not
  // cost us the geomagnetic data, which comes from a different organisation.
  test('one dead upstream does not lose the others', async () => {
    const b = await buildBundle({
      fetchImpl: routed({ ...ALL, essn: new Error('connect ETIMEDOUT') }),
      now: () => NOW,
    });
    assert.equal(b.solar, null);
    assert.equal(b.sources.essn.ok, false);
    assert.match(b.sources.essn.error, /ETIMEDOUT/);
    assert.equal(b.degraded, true);
    assert.ok(b.geomag.kp >= 0, 'SWPC data survives a KC2G outage');
    assert.equal(b.sources.kp.ok, true);
  });

  test('a 200 carrying HTML is refused, not parsed', async () => {
    const b = await buildBundle({ fetchImpl: routed({ ...ALL, essn: 'html' }), now: () => NOW });
    assert.equal(b.sources.essn.ok, false);
    assert.match(b.sources.essn.error, /HTML/);
    assert.equal(b.solar, null);
  });

  test('a 404 is refused', async () => {
    const b = await buildBundle({ fetchImpl: routed({ ...ALL, kp: 404 }), now: () => NOW });
    assert.equal(b.sources.kp.ok, false);
    assert.match(b.sources.kp.error, /404/);
  });

  test('a payload of the wrong shape fails the source, not the bundle', async () => {
    const b = await buildBundle({
      fetchImpl: routed({ ...ALL, essn: { unexpected: true } }),
      now: () => NOW,
    });
    assert.equal(b.sources.essn.ok, false);
    assert.match(b.sources.essn.error, /parse failed/);
    assert.equal(b.sources.kp.ok, true);
  });

  test('old data is served but marked stale, never silently', async () => {
    const wayLater = new Date(NOW.getTime() + 9 * 3600 * 1000);
    const b = await buildBundle({ fetchImpl: routed(ALL), now: () => wayLater });
    assert.equal(b.sources.essn.stale, true);
    assert.ok(b.sources.essn.ageSeconds > 3 * 3600);
    assert.equal(b.degraded, true);
    assert.ok(b.solar.ssn > 0, 'the value is still there — staleness is a label, not a deletion');
  });

  test('ages are measured from observation, not from fetch', async () => {
    const b = await buildBundle({ fetchImpl: routed(ALL), now: () => NOW });
    assert.ok(b.sources.essn.ageSeconds >= 59 && b.sources.essn.ageSeconds <= 61,
      `expected ~60 s, got ${b.sources.essn.ageSeconds}`);
  });
});
