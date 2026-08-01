// Parses ITURHFProp's text `.out` report format.
//
// The format is self-describing: a "Data Format" section lists "Column NN:
// <label>" lines whose order matches the comma-separated data rows in the
// "Calculated Parameters" section. We parse that column list dynamically
// (rather than hardcoding column *positions*) and map each recognized label
// to a canonical field. This is deliberately strict per this project's
// "never present wrong data confidently" rule (see CLAUDE.md):
//
//   - An unrecognized column label throws. We do not silently drop or
//     mis-align columns we don't understand -- the report format is
//     controlled entirely by the RptFileFormat flags this package's own
//     input-file generator writes (see inputFile.ts REPORT_FORMAT), so a
//     genuinely new/unknown column means either upstream changed the report
//     format or a caller is feeding this parser output it wasn't generated
//     for. Either way, guessing would be a wrong-data risk.
//   - A row with the wrong number of fields throws.
//   - Any expected-numeric field that fails to parse as a finite number
//     throws.
//   - A report with zero data rows throws (this package always requests at
//     least one hour x one frequency, so an empty result means something
//     upstream went wrong, not that the answer is "no predictions").

import type { DominantMode, EngineMeta, FrequencyHourPrediction, GeoPosition } from './types.js';

export class HFEngineOutputParseError extends Error {
  constructor(message: string) {
    super(`Failed to parse ITURHFProp output: ${message}`);
    this.name = 'HFEngineOutputParseError';
  }
}

type ColumnKind = 'number' | 'string';

interface ColumnRule {
  match: RegExp;
  key: string;
  kind: ColumnKind;
}

// Canonical keys used internally while assembling a row; not part of the
// public API (see types.ts FrequencyHourPrediction for the public shape).
const COLUMN_RULES: ColumnRule[] = [
  { match: /^Month$/, key: 'month', kind: 'number' },
  { match: /^Hour$/, key: 'hourEngine1Based', kind: 'number' },
  { match: /^Frequency \(MHz\)$/, key: 'frequencyMHz', kind: 'number' },
  { match: /^Receiver latitude \(deg\)$/, key: 'rxLat', kind: 'number' },
  { match: /^Receiver longitude \(deg\)$/, key: 'rxLon', kind: 'number' },
  { match: /^D - Path distance \(km\)$/, key: 'distanceKm', kind: 'number' },
  { match: /^BMUF - Path basic MUF \(MHz\)$/, key: 'basicMufMHz', kind: 'number' },
  { match: /^OPMUF - Operation MUF \(MHz\)$/, key: 'operationalMufMHz', kind: 'number' },
  { match: /^E - Path Field Strength \(dB\(1uV\/m\)\)$/, key: 'fieldStrengthDbuVm', kind: 'number' },
  { match: /^Pr - Median receiver power \(dB\)$/, key: 'medianReceivedPowerDbW', kind: 'number' },
  { match: /^SNR - Median signal-to-noise ratio \(dB\)$/, key: 'snrDb', kind: 'number' },
  { match: /^SNRXXp - Signal-to-noise ratio at \d+% of month$/, key: 'snrAtReliabilityDb', kind: 'number' },
  {
    match: /^OCR - Overall circuit reliability not considering scattering \(%\)$/,
    key: 'overallReliabilityPercent',
    kind: 'number',
  },
  {
    match: /^OCRs - Overall circuit reliability considering scattering \(%\)$/,
    key: 'overallReliabilityWithScatterPercent',
    kind: 'number',
  },
  { match: /^Probocc - Probability of scattering \(%\)$/, key: 'scatterProbabilityPercent', kind: 'number' },
  { match: /^Dominant mode$/, key: 'dominantMode', kind: 'string' },
  { match: /^Dominant mode - Elevation angle \(deg\)$/, key: 'dominantModeElevationDeg', kind: 'number' },
  { match: /^Dominant mode - Delay \(mS\)$/, key: 'dominantModeDelayMs', kind: 'number' },
  { match: /^Dominant mode - Loss \(dB\)$/, key: 'dominantModeLossDb', kind: 'number' },
  {
    match: /^Dominant mode - Propagation probability \(%\)$/,
    key: 'dominantModePropagationProbabilityPercent',
    kind: 'number',
  },
  { match: /^Dominant mode - Virtual height \(km\)$/, key: 'dominantModeVirtualHeightKm', kind: 'number' },
  {
    match: /^Dominant mode - Median received power \(dB\)$/,
    key: 'dominantModeMedianReceivedPowerDbW',
    kind: 'number',
  },
  {
    match: /^Dominant mode - Receiver Antenna Gain \(dBi\)$/,
    key: 'dominantModeReceiverAntennaGainDbi',
    kind: 'number',
  },
  {
    match: /^Dominant mode - Field Strength \(dB\(1uV\/m\)\)$/,
    key: 'dominantModeFieldStrengthDbuVm',
    kind: 'number',
  },
  { match: /^Dominant mode - Basic MUF \(MHz\)$/, key: 'dominantModeBasicMufMHz', kind: 'number' },
];

export interface ResolvedColumn {
  label: string;
  key: string;
  kind: ColumnKind;
}

/**
 * KNOWN UPSTREAM DEFECT (verified against source, not a guess -- see
 * ITU-R-HF/ITURHFProp/Src/ITURHFProp/Report.c line ~76):
 *
 *   static int Header = TRUE; // The first time you enter this routine the
 *                             // head will need to be printed.
 *
 * `Header` is a process-lifetime C static, not reset per `main()` call. The
 * native CLI only ever calls `main()` once per process, so this is invisible
 * there. But this package deliberately reuses one WASM module instance
 * across many `predict()` calls (to avoid paying ~6-7 ms re-init per
 * prediction -- see wasmModule.ts), and Emscripten's `callMain()` genuinely
 * re-enters `main()` in the same process/heap. The result: only the FIRST
 * `predict()` call on a given HFEngine instance gets a report with the
 * banner, "Data Format" column list, and "Calculated Parameters" opening
 * marker. Every subsequent call gets a report with those omitted -- but
 * (verified by direct comparison against a byte-for-byte fresh-instance run
 * of the same request, see test/engine.reuseDefect.test.ts) the actual data
 * rows are complete and numerically identical either way: PrintRecord()'s
 * PRINT_DATA path, which does the real work, runs unconditionally on every
 * call and isn't gated by `Header`. Only the textual scaffold is skipped.
 *
 * Re-instantiating a fresh module per `predict()` call would dodge this, but
 * would also throw away the ~11 MB / ~13 ms month-data-load cache (see
 * WasmRuntime.ensureMonthData), which is a much larger cost. Instead: when
 * (and only when) the "Data Format" section is absent, this parser falls
 * back to a *known* column layout -- not a guess, because this package's own
 * HFEngine always requests the exact fixed column set in
 * inputFile.ts:REPORT_FORMAT, so the column order for its own output is a
 * static fact once you know which flags were requested. Every other
 * strictness check (row field count must match, every numeric field must
 * parse) still applies -- this only replaces *where* the column list comes
 * from, not how hard the rest of parsing checks it.
 *
 * This fallback is opt-in (via the `fallbackColumns` option) precisely so
 * that the general-purpose `parseOutputFile(text)` used for arbitrary/
 * externally-produced .out text (e.g. the golden test's reference fixture)
 * stays strict-by-default and never guesses at an unfamiliar report's shape.
 */
export const REPORT_FORMAT_COLUMNS: ResolvedColumn[] = [
  'Month',
  'Hour',
  'Frequency (MHz)',
  'Receiver latitude (deg)',
  'Receiver longitude (deg)',
  'D - Path distance (km)',
  'BMUF - Path basic MUF (MHz)',
  'OPMUF - Operation MUF (MHz)',
  'E - Path Field Strength (dB(1uV/m))',
  'Pr - Median receiver power (dB)',
  'SNR - Median signal-to-noise ratio (dB)',
  'SNRXXp - Signal-to-noise ratio at 10% of month',
  'OCR - Overall circuit reliability not considering scattering (%)',
  'OCRs - Overall circuit reliability considering scattering (%)',
  'Probocc - Probability of scattering (%)',
  'Dominant mode',
  'Dominant mode - Elevation angle (deg)',
  'Dominant mode - Delay (mS)',
  'Dominant mode - Loss (dB)',
  'Dominant mode - Propagation probability (%)',
  'Dominant mode - Virtual height (km)',
  'Dominant mode - Median received power (dB)',
  'Dominant mode - Receiver Antenna Gain (dBi)',
  'Dominant mode - Field Strength (dB(1uV/m))',
  'Dominant mode - Basic MUF (MHz)',
].map((label) => {
  // Resolved eagerly at module load so a drift between this list and
  // COLUMN_RULES (or inputFile.ts's REPORT_FORMAT) fails immediately and
  // loudly, not the first time a caller hits the fallback path.
  const trimmed = label.trim();
  const rule = COLUMN_RULES.find((r) => r.match.test(trimmed));
  if (!rule) {
    throw new Error(`outputParser.ts: REPORT_FORMAT_COLUMNS entry "${label}" has no matching COLUMN_RULES entry`);
  }
  return { label: trimmed, key: rule.key, kind: rule.kind };
});

function resolveColumn(label: string): ResolvedColumn {
  const trimmed = label.trim();
  const rule = COLUMN_RULES.find((r) => r.match.test(trimmed));
  if (!rule) {
    throw new HFEngineOutputParseError(
      `unrecognized report column "${trimmed}". This parser only understands the fixed column set this ` +
        `package's own .in generator requests (see inputFile.ts REPORT_FORMAT); either the vendored engine's ` +
        `report format changed, or this .out file wasn't produced by this package.`,
    );
  }
  return { label: trimmed, key: rule.key, kind: rule.kind };
}

function parseEngineMeta(text: string): EngineMeta {
  const ituRHFPropVersion = /ITURHFProp\s+Ver\s+(.+)/.exec(text)?.[1]?.trim();
  const p533Version = /HF Model \(P533\)\s+Ver\s+(.+)/.exec(text)?.[1]?.trim();
  const p372Version = /Noise Model \(P372\)\s+Ver\s+(.+)/.exec(text)?.[1]?.trim();
  const preparedAtRaw = /Analysis Prepared\s+(.+)/.exec(text)?.[1]?.trim();
  return { ituRHFPropVersion, p533Version, p372Version, preparedAtRaw };
}

function extractSection(text: string, startMarker: RegExp, endMarker: RegExp, sectionName: string): string {
  const startMatch = startMarker.exec(text);
  if (!startMatch) {
    throw new HFEngineOutputParseError(`could not find start of "${sectionName}" section (expected ${startMarker})`);
  }
  const searchFrom = startMatch.index + startMatch[0].length;
  const endMatch = endMarker.exec(text.slice(searchFrom));
  if (!endMatch) {
    throw new HFEngineOutputParseError(`could not find end of "${sectionName}" section (expected ${endMarker})`);
  }
  return text.slice(searchFrom, searchFrom + endMatch.index);
}

interface ColumnParseResult {
  columns: ResolvedColumn[];
  /** True when the "Data Format" section was absent and `fallbackColumns`
   *  was used instead (see REPORT_FORMAT_COLUMNS docstring). When true, the
   *  "Calculated Parameters" *opening* banner is also known to be absent
   *  (both are gated by the same upstream `Header` static), so the data-row
   *  extraction below must not require it either. */
  usedFallback: boolean;
}

function parseColumns(text: string, fallbackColumns?: ResolvedColumn[]): ColumnParseResult {
  let section: string;
  try {
    section = extractSection(text, /\*+\s*Data Format\s*\*+/, /\*+\s*End Data Format\s*\*+/, 'Data Format');
  } catch (err) {
    if (fallbackColumns !== undefined) {
      // See REPORT_FORMAT_COLUMNS docstring: known upstream defect where a
      // reused WASM module instance omits the header/Data Format section on
      // its 2nd+ callMain(). The caller has told us what columns to expect
      // in that case.
      return { columns: fallbackColumns, usedFallback: true };
    }
    throw err;
  }
  const columnLineRe = /^Column\s+(\d+):\s*(.+)$/gm;
  const found: Array<{ index: number; label: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = columnLineRe.exec(section)) !== null) {
    found.push({ index: Number(m[1]), label: m[2] ?? '' });
  }
  if (found.length === 0) {
    throw new HFEngineOutputParseError('"Data Format" section contained no "Column NN: <label>" lines');
  }
  found.sort((a, b) => a.index - b.index);
  found.forEach((f, i) => {
    if (f.index !== i + 1) {
      throw new HFEngineOutputParseError(
        `Data Format columns are not contiguous starting at 1 (found column numbers ${found.map((x) => x.index).join(',')})`,
      );
    }
  });
  return { columns: found.map((f) => resolveColumn(f.label)), usedFallback: false };
}

function parseDataRows(
  text: string,
  columns: ResolvedColumn[],
  columnsUsedFallback: boolean,
): Array<Record<string, number | string>> {
  const endMarker = /\*+\s*End Calculated Parameters\s*\*+/;
  let section: string;
  if (columnsUsedFallback) {
    // The opening "Calculated Parameters" banner is gated by the same
    // upstream `Header` static as the Data Format section (Report.c: both
    // are only written when option == PRINT_HEADER), so on a truncated
    // report the file starts directly with data rows. Take everything up to
    // the (always-present, even on PrintLastRecord) closing marker.
    const endMatch = endMarker.exec(text);
    if (!endMatch) {
      throw new HFEngineOutputParseError(
        'could not find "End Calculated Parameters" marker in a report already identified as using the ' +
          'reused-WASM-instance fallback column layout -- this is not a shape this parser recognizes',
      );
    }
    section = text.slice(0, endMatch.index);
  } else {
    section = extractSection(text, /\*+\s*Calculated Parameters\s*\*+/, endMarker, 'Calculated Parameters');
  }
  const rawLines = section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) {
    throw new HFEngineOutputParseError(
      'report contained zero data rows in "Calculated Parameters" -- refusing to treat that as an empty-but-valid result',
    );
  }

  return rawLines.map((line, lineIdx) => {
    const tokens = line.split(',').map((t) => t.trim());
    if (tokens.length !== columns.length) {
      throw new HFEngineOutputParseError(
        `data row ${lineIdx + 1} has ${tokens.length} fields but the report declared ${columns.length} columns. ` +
          `Row: "${line}"`,
      );
    }
    const row: Record<string, number | string> = {};
    columns.forEach((col, i) => {
      const raw = tokens[i] ?? '';
      if (col.kind === 'number') {
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          throw new HFEngineOutputParseError(
            `data row ${lineIdx + 1}, column "${col.label}": expected a finite number, got "${raw}"`,
          );
        }
        row[col.key] = value;
      } else {
        row[col.key] = raw;
      }
    });
    return row;
  });
}

function requireNumber(row: Record<string, number | string>, key: string, context: string): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new HFEngineOutputParseError(`${context}: required field "${key}" is missing from the report`);
  }
  return v;
}

function optionalNumber(row: Record<string, number | string>, key: string): number | undefined {
  const v = row[key];
  return typeof v === 'number' ? v : undefined;
}

function buildDominantMode(row: Record<string, number | string>): DominantMode | undefined {
  const modeRaw = row.dominantMode;
  if (typeof modeRaw !== 'string') return undefined;
  const mode = modeRaw.trim();
  if (mode.length === 0) return undefined;
  return {
    mode,
    elevationAngleDeg: requireNumber(row, 'dominantModeElevationDeg', 'dominant mode'),
    delayMs: requireNumber(row, 'dominantModeDelayMs', 'dominant mode'),
    lossDb: requireNumber(row, 'dominantModeLossDb', 'dominant mode'),
    propagationProbabilityPercent: requireNumber(
      row,
      'dominantModePropagationProbabilityPercent',
      'dominant mode',
    ),
    virtualHeightKm: requireNumber(row, 'dominantModeVirtualHeightKm', 'dominant mode'),
    medianReceivedPowerDbW: requireNumber(row, 'dominantModeMedianReceivedPowerDbW', 'dominant mode'),
    receiverAntennaGainDbi: requireNumber(row, 'dominantModeReceiverAntennaGainDbi', 'dominant mode'),
    fieldStrengthDbuVm: requireNumber(row, 'dominantModeFieldStrengthDbuVm', 'dominant mode'),
    basicMufMHz: requireNumber(row, 'dominantModeBasicMufMHz', 'dominant mode'),
  };
}

export interface ParsedOutputFile {
  engine: EngineMeta;
  predictions: FrequencyHourPrediction[];
  /** True if this report was missing its header/Data Format section and had
   *  to fall back to a caller-supplied known column layout (see
   *  REPORT_FORMAT_COLUMNS). Only ever true when `fallbackColumns` was
   *  passed in options. Exposed mainly for tests/diagnostics. */
  usedFallbackColumns: boolean;
}

export interface ParseOutputFileOptions {
  /**
   * Column layout to assume if the report has no "Data Format" section.
   * Leave unset to keep strict behavior (throw when the section is
   * missing) -- appropriate for parsing arbitrary/externally-produced .out
   * text. HFEngine passes REPORT_FORMAT_COLUMNS here because it always
   * requests that exact fixed column set; see that constant's docstring for
   * why this is a known fact rather than a guess in that specific case.
   */
  fallbackColumns?: ResolvedColumn[];
}

export function parseOutputFile(text: string, options: ParseOutputFileOptions = {}): ParsedOutputFile {
  if (text.trim().length === 0) {
    throw new HFEngineOutputParseError('output was empty');
  }
  const engine = parseEngineMeta(text);
  const { columns, usedFallback } = parseColumns(text, options.fallbackColumns);
  const rows = parseDataRows(text, columns, usedFallback);

  const predictions: FrequencyHourPrediction[] = rows.map((row, i) => {
    const context = `row ${i + 1}`;
    const hourEngine1Based = requireNumber(row, 'hourEngine1Based', context);
    const receiver: GeoPosition = {
      latitude: requireNumber(row, 'rxLat', context),
      longitude: requireNumber(row, 'rxLon', context),
    };
    return {
      month: requireNumber(row, 'month', context),
      hourUtc: hourEngine1Based - 1,
      frequencyMHz: requireNumber(row, 'frequencyMHz', context),
      receiver,
      distanceKm: requireNumber(row, 'distanceKm', context),
      basicMufMHz: optionalNumber(row, 'basicMufMHz'),
      operationalMufMHz: optionalNumber(row, 'operationalMufMHz'),
      fieldStrengthDbuVm: requireNumber(row, 'fieldStrengthDbuVm', context),
      medianReceivedPowerDbW: requireNumber(row, 'medianReceivedPowerDbW', context),
      snrDb: optionalNumber(row, 'snrDb'),
      snrAtReliabilityDb: requireNumber(row, 'snrAtReliabilityDb', context),
      overallReliability: requireNumber(row, 'overallReliabilityPercent', context) / 100,
      overallReliabilityWithScatter: requireNumber(row, 'overallReliabilityWithScatterPercent', context) / 100,
      scatterProbability: requireNumber(row, 'scatterProbabilityPercent', context) / 100,
      dominantMode: buildDominantMode(row),
    };
  });

  return { engine, predictions, usedFallbackColumns: usedFallback };
}
