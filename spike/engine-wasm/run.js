// HFKit WASM spike harness: loads the emcc-compiled ITURHFProp module under
// Node (standing in for a browser's WebAssembly runtime -- Node can execute
// Emscripten output directly, so this is a valid way to prove the wasm
// module runs and produces correct output without needing a real browser).
//
// Usage: node run.js <inputFile.in> <outputFile.out> [--data-dir <dir>]
//
// The wasm module has no direct filesystem access (MEMFS is virtual), so
// this harness copies the input file and every file the .in file's
// DataFilePath directory needs into MEMFS before invoking main(), then
// reads the produced output file back out and writes it to real disk.

const fs = require('fs');
const path = require('path');

const factory = require('./iturhfprop.js');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node run.js <inputFile.in> <outputFile.out> [--data-dir <dir>]');
    process.exit(1);
  }
  const inFile = args[0];
  const outFile = args[1];
  let dataDirOverride = null;
  const ddIdx = args.indexOf('--data-dir');
  if (ddIdx !== -1) dataDirOverride = args[ddIdx + 1];

  const t0 = process.hrtime.bigint();
  const Module = await factory();
  const t1 = process.hrtime.bigint();

  // MEMFS is ready once the module promise resolves (FORCE_FILESYSTEM=1).
  // Recreate the directory layout the native CLI expects, relative to the
  // virtual cwd "/work": Bin/<input>.in, and a data dir with the coefficient
  // and ionosphere files. We mirror the *real* relative paths used inside
  // the .in file (e.g. "../Data/") so ITURHFProp's own path joining works
  // unmodified.
  Module.FS.mkdir('/work');
  Module.FS.mkdir('/work/Bin');
  Module.FS.mkdir('/work/Data');
  Module.FS.chdir('/work/Bin');

  const inBase = path.basename(inFile);
  Module.FS.writeFile('/work/Bin/' + inBase, fs.readFileSync(inFile));

  // Copy whatever DataFilePath points to (defaults to sibling ../Data/) into
  // MEMFS, but ONLY the files ITURHFProp actually reads: the P1239 decile
  // file, and the single month's ionos*.bin + COEFF*.txt (see FINDINGS.md
  // for why this is "one month", not all twelve).
  const inText = fs.readFileSync(inFile, 'utf8');
  const monthMatch = inText.match(/Path\.month\s+(\d+)/);
  const month = monthMatch ? parseInt(monthMatch[1], 10) : 1;
  const mm = String(month).padStart(2, '0');

  const dataDir = dataDirOverride || path.join(path.dirname(inFile), '../Data');
  const neededFiles = [
    'P1239-3 Decile Factors.txt',
    `ionos${mm}.bin`,
    `COEFF${mm}W.txt`,
  ];
  let dataBytesCopied = 0;
  for (const f of neededFiles) {
    const src = path.join(dataDir, f);
    const buf = fs.readFileSync(src);
    Module.FS.writeFile('/work/Data/' + f, buf);
    dataBytesCopied += buf.length;
  }

  // Also stage antenna pattern files referenced by the input, if any
  // (ISOTROPIC needs none).

  const t2 = process.hrtime.bigint();
  const rc = Module.callMain([inBase, path.basename(outFile)]);
  const t3 = process.hrtime.bigint();

  let outBuf;
  try {
    outBuf = Module.FS.readFile('/work/Bin/' + path.basename(outFile));
  } catch (e) {
    console.error('WASM run produced no output file (exit code', rc, ')');
    process.exit(rc || 1);
  }
  fs.writeFileSync(outFile, outBuf);

  const initMs = Number(t1 - t0) / 1e6;
  const dataLoadMs = Number(t2 - t1) / 1e6;
  const runMs = Number(t3 - t2) / 1e6;

  console.error(JSON.stringify({
    exitCode: rc,
    dataBytesCopied,
    initMs: Number(initMs.toFixed(3)),
    dataLoadMs: Number(dataLoadMs.toFixed(3)),
    runMs: Number(runMs.toFixed(3)),
  }));
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(1);
});
