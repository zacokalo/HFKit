// Abstracts where the ITU ionospheric/noise data files come from. The WASM
// engine's virtual filesystem needs three things per calendar month (see
// spike/engine-wasm/FINDINGS.md and spike/engine-wasm/run.js, which this
// mirrors):
//
//   - "P1239-3 Decile Factors.txt" -- MUF variability deciles, shared across
//     all months (~72 KB).
//   - "ionosNN.bin" -- the ionospheric map for month NN, dominant cost
//     (~10.68 MB/month).
//   - "COEFFNNW.txt" -- P.372 noise coefficients for month NN (~230 KB).
//
// Only the *current month's* files are ever needed at once. This package
// deliberately does not bundle or fetch these itself -- the ~11 MB/month cost
// makes that the pipeline/CDN's job (docs/11-operating-constraints.md), not
// this package's. Callers supply a DataProvider that knows how to get them.

export interface EngineDataFiles {
  /** Contents of "P1239-3 Decile Factors.txt". */
  decileFactors: Uint8Array;
  /** Contents of "ionosNN.bin" for the requested month. */
  ionosphere: Uint8Array;
  /** Contents of "COEFFNNW.txt" for the requested month. */
  noiseCoefficients: Uint8Array;
}

export interface DataProvider {
  /**
   * Returns the ITU data files needed to predict for the given calendar
   * month (1-12). Implementations should cache aggressively: for a given
   * data-bundle version these files never change, so re-fetching/re-reading
   * them per call is pure waste. This package itself does not cache across
   * DataProvider instances -- see HFEngine, which caches the *last loaded*
   * month's bytes inside the WASM virtual filesystem for the lifetime of one
   * HFEngine instance, but always asks the DataProvider again when the month
   * changes.
   */
  getMonthData(month: number): Promise<EngineDataFiles>;
}

/**
 * Formats a 1-12 month number as ITURHFProp's two-digit, zero-padded file
 * suffix ("01".."12").
 */
export function monthFileSuffix(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`monthFileSuffix: month must be an integer 1-12, got ${month}`);
  }
  return String(month).padStart(2, '0');
}
