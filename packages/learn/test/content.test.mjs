// Spectrum facts, glossary copy and quiz structure: the parts of the Learn
// page that are words rather than physics, and so drift silently.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  comparison, whatsHere, wavelengthM, HAM_BANDS, HF_MAX_MHZ, HF_MIN_MHZ,
} from '../spectrum.mjs';
import { GLOSSARY, lookup, termId } from '../glossary.mjs';
import { CHAPTERS, QUIZ } from '../quiz.mjs';

describe('the spectrum', () => {
  test('bands are named for their wavelength', () => {
    for (const b of HAM_BANDS) {
      const metres = Number.parseInt(b.label, 10);
      const lam = wavelengthM((b.lo + b.hi) / 2);
      // 60 m and 30 m are the loosest fits; nothing is off by more than a third.
      assert.ok(Math.abs(lam - metres) / metres < 0.35, `${b.label}: ${lam.toFixed(1)} m`);
    }
  });

  test('bands are in order and do not overlap', () => {
    for (let i = 1; i < HAM_BANDS.length; i++) assert.ok(HAM_BANDS[i].lo > HAM_BANDS[i - 1].hi);
    assert.ok(HAM_BANDS[0].lo >= HF_MIN_MHZ && HAM_BANDS.at(-1).hi <= HF_MAX_MHZ);
  });

  test('knows what lives at a frequency', () => {
    assert.equal(whatsHere(7.1).band.id, '40m');
    assert.equal(whatsHere(10.0).band, null);
    assert.ok(whatsHere(10.0).others.some((o) => o.label.includes('WWV')));
    assert.equal(whatsHere(9.6).nearest.id, '30m');
    assert.ok(whatsHere(7.3).others.some((o) => o.label.includes('41 m')), '41 m broadcast shares 7.2–7.3');
  });

  test('comparisons stay readable: at least one and a half of something', () => {
    for (const f of [1.8, 3.6, 7.1, 14.2, 28.4, 50, 54]) {
      const c = comparison(wavelengthM(f));
      assert.ok(c.count >= 1.5 || c.one.startsWith('person'), `${f} MHz: ${c.text}`);
      assert.ok(c.count < 15, `${f} MHz: ${c.text}`);
    }
    assert.match(comparison(wavelengthM(14.2)).text, /bus/);
  });
});

describe('the glossary', () => {
  // docs/08 is the vocabulary of record; its glossary "doubles as tooltip copy".
  const doc = readFileSync(
    fileURLToPath(new URL('../../../docs/08-domain-model.md', import.meta.url)), 'utf8');
  const rows = [...doc.matchAll(/^\| \*\*(.+?)\*\* \| (.+?) \|$/gm)]
    .map(([, term, definition]) => ({ term, definition }));

  test('the doc table was found', () => {
    assert.ok(rows.length >= 16, `${rows.length} rows`);
  });

  test('every term in docs/08 appears here word for word', () => {
    for (const r of rows) {
      const g = lookup(r.term);
      assert.ok(g, `missing from glossary.mjs: ${r.term}`);
      assert.equal(g.definition, r.definition, `definition drifted: ${r.term}`);
    }
  });

  test('and every term here is in docs/08', () => {
    const inDoc = new Set(rows.map((r) => r.term));
    for (const g of GLOSSARY) assert.ok(inDoc.has(g.term), `add to docs/08: ${g.term}`);
  });

  test('terms and their link ids are unique', () => {
    assert.equal(new Set(GLOSSARY.map((g) => g.term)).size, GLOSSARY.length);
    assert.equal(new Set(GLOSSARY.map((g) => termId(g.term))).size, GLOSSARY.length);
    assert.equal(termId('Kp / Ap'), 'g-kp-ap');
  });
});

describe('the quiz', () => {
  test('every chapter has questions, and nothing else does', () => {
    assert.deepEqual(Object.keys(QUIZ).sort(), CHAPTERS.map((c) => c.id).sort());
  });

  test('every question has one valid answer and an explanation', () => {
    for (const [chapter, qs] of Object.entries(QUIZ)) {
      assert.ok(qs.length >= 1, chapter);
      for (const q of qs) {
        assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length,
          `${chapter}: ${q.q}`);
        assert.equal(new Set(q.options).size, q.options.length, `duplicate option: ${q.q}`);
        assert.ok(q.why.length > 40, `explanation too thin: ${q.q}`);
      }
    }
  });

  test('the right answer is not always in the same place', () => {
    const positions = new Set(Object.values(QUIZ).flat().map((q) => q.answer));
    assert.ok(positions.size >= 3);
  });
});
