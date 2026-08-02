import { describe, expect, it } from 'vitest';
import { assertLooksLikeItuData } from '../src/browserDataProvider.js';

const headers = (contentType?: string) => ({
  headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType ?? null : null) },
});
const bytes = (n: number, fill = 0x42) => new Uint8Array(n).fill(fill);
const utf8 = (s: string) => new TextEncoder().encode(s.padEnd(8192, ' '));

describe('assertLooksLikeItuData', () => {
  it('accepts a plausible binary payload', () => {
    expect(() => assertLooksLikeItuData('ionos08.bin', headers('application/octet-stream'),
      bytes(11_197_844))).not.toThrow();
  });

  // The real failure: a static host answers a missing path with 200 + its error
  // page. Without this gate that HTML is handed to P.533 as an ionospheric map.
  it('rejects an HTML page served with 200', () => {
    expect(() => assertLooksLikeItuData('ionos09.bin', headers('text/html; charset=utf-8'),
      utf8('<!doctype html><html><body>Not found</body></html>')))
      .toThrow(/HTML page, not data/);
  });

  it('names the month boundary in the message, because that is the diagnosis', () => {
    expect(() => assertLooksLikeItuData('ionos09.bin', headers('text/html'), utf8('<html>')))
      .toThrow(/month it ran in/);
  });

  it('catches HTML even when the content-type does not admit it', () => {
    expect(() => assertLooksLikeItuData('COEFF09W.txt', headers('application/octet-stream'),
      utf8('<!DOCTYPE html>\n<html lang="en">')))
      .toThrow(/HTML page, not data/);
  });

  it('catches HTML with no content-type at all', () => {
    expect(() => assertLooksLikeItuData('ionos09.bin', headers(undefined), utf8('<html>')))
      .toThrow(/HTML page, not data/);
  });

  it('rejects a body far too short to be real data', () => {
    expect(() => assertLooksLikeItuData('ionos08.bin', headers('application/octet-stream'),
      bytes(120))).toThrow(/far too small to be real/);
  });

  it('rejects an empty body', () => {
    expect(() => assertLooksLikeItuData('ionos08.bin', headers('application/octet-stream'),
      bytes(0))).toThrow(/far too small to be real/);
  });

  // A text file that is genuinely ITU data must still pass: COEFFnnW.txt is
  // plain text, so "not binary" is not the test.
  it('accepts a large plain-text data file', () => {
    const coeff = new TextEncoder().encode('1.234 5.678\n'.repeat(20_000));
    expect(() => assertLooksLikeItuData('COEFF08W.txt', headers('text/plain'), coeff))
      .not.toThrow();
  });

  it('does not mistake a leading angle bracket in binary for markup', () => {
    const data = bytes(200_000);
    data[0] = 0x3c;                       // '<' as a coincidental first byte
    data[1] = 0x00;
    expect(() => assertLooksLikeItuData('ionos08.bin', headers('application/octet-stream'), data))
      .not.toThrow();
  });
});
