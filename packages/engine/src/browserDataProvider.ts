import type { DataProvider, EngineDataFiles } from './dataProvider.js';
import { monthFileSuffix } from './dataProvider.js';

/**
 * Fetches ITU data files over HTTP, for use in a browser.
 *
 * The ~10.7 MB `ionosNN.bin` dominates; it is immutable once published, so it
 * should be served with a long-lived cache header and will be fetched at most
 * once per month per device. That is exactly the bundle model in
 * docs/11-operating-constraints.md: the mothership publishes static files, the
 * client caches them, and prediction happens on-device.
 */
export class BrowserDataProvider implements DataProvider {
  private readonly baseUrl: string;
  private readonly cache = new Map<number, Promise<EngineDataFiles>>();

  /** @param baseUrl directory containing the ITU data files, e.g. "/data/itu". */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getMonthData(month: number): Promise<EngineDataFiles> {
    const existing = this.cache.get(month);
    if (existing !== undefined) return existing;

    const mm = monthFileSuffix(month);
    const pending = (async (): Promise<EngineDataFiles> => {
      const [decileFactors, ionosphere, noiseCoefficients] = await Promise.all([
        this.fetchBytes('P1239-3 Decile Factors.txt'),
        this.fetchBytes(`ionos${mm}.bin`),
        this.fetchBytes(`COEFF${mm}W.txt`),
      ]);
      return { decileFactors, ionosphere, noiseCoefficients };
    })();

    this.cache.set(month, pending);
    // Do not cache a rejected promise: a transient network failure must not
    // permanently poison this month.
    pending.catch(() => this.cache.delete(month));
    return pending;
  }

  private async fetchBytes(name: string): Promise<Uint8Array> {
    const url = `${this.baseUrl}/${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ITU data file ${name}: HTTP ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    assertLooksLikeItuData(name, res, bytes);
    return bytes;
  }
}

/**
 * Sanity gate on a fetched data file.
 *
 * `res.ok` is not enough. Static hosts routinely answer a missing path with
 * **200 and an HTML error page** rather than a 404 — Cloudflare's SPA fallback
 * does exactly this — and without a check that HTML gets written into the WASM
 * filesystem under the name of an 11 MB ionospheric map. P.533 would then read
 * whatever that is and return numbers, which is far worse than failing: the
 * caller cannot tell the difference between a prediction and garbage.
 *
 * The failure this exists for is the month boundary: a build publishes only the
 * month it ran in, so on the 1st the site asks for a file that was never
 * deployed. Fail loudly and say which month, so the message is the diagnosis.
 */
export function assertLooksLikeItuData(
  name: string,
  res: { headers: { get(key: string): string | null } },
  bytes: Uint8Array,
): void {
  const contentType = res.headers.get('content-type') ?? '';
  const isHtml = /\bhtml\b/i.test(contentType)
    // Some hosts omit or mislabel the type, so also look at the payload.
    || startsWithHtml(bytes);
  if (isHtml) {
    throw new Error(
      `ITU data file ${name} came back as an HTML page, not data`
      + `${contentType ? ` (content-type: ${contentType})` : ''}. `
      + 'The host answered a missing file with 200 instead of 404. '
      + `Most likely ${name} was never published — a build only publishes the `
      + 'month it ran in, so this breaks at a month boundary until the site is rebuilt.',
    );
  }
  // Every real file here is far bigger than this; the smallest, COEFFnnW.txt,
  // is ~230 KB. A short body means a placeholder, not data.
  if (bytes.byteLength < MIN_PLAUSIBLE_BYTES) {
    throw new Error(
      `ITU data file ${name} is only ${bytes.byteLength} bytes, which is far too `
      + 'small to be real. Refusing to run a prediction on it.',
    );
  }
}

const MIN_PLAUSIBLE_BYTES = 4096;

function startsWithHtml(bytes: Uint8Array): boolean {
  // Compare bytes rather than decoding: the payload may not be valid UTF-8.
  const head = bytes.subarray(0, 512);
  let text = '';
  for (const b of head) text += String.fromCharCode(b);
  return /^\s*(<!doctype html|<html\b|<!--)/i.test(text);
}
