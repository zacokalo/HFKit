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
    return new Uint8Array(await res.arrayBuffer());
  }
}
