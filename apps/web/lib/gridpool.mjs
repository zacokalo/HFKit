// Worker pool that computes a reach grid progressively.
//
// Resolutions nest: a 24° grid's points are a subset of 12°, which is a subset
// of 6°. So each pass only computes the points the previous pass did not, and
// refines the picture rather than redrawing it. Measured on 4 logical cores,
// ~87 ms per point in one worker and ~1.74× speedup across four — so 24° lands
// in about 5 s and 12° by about 21 s. A full 6° pass is ~81 s, which is why it
// is opt-in rather than automatic.
//
// Every cell is reported as it arrives so the map fills in while the user
// watches, instead of showing a spinner for a minute and then a finished image.

export const LAT_MIN = -78, LAT_MAX = 78, BASE_STEP = 6;

export function gridAxes(step = BASE_STEP) {
  const lat = [], lon = [];
  for (let v = LAT_MIN; v <= LAT_MAX; v += step) lat.push(v);
  for (let v = -180; v < 180; v += step) lon.push(v);
  return { lat, lon };
}

/** Points present at `step` but not at the coarser `prevStep`. */
function newPointsFor(step, prevStep) {
  const { lat, lon } = gridAxes(step);
  const pts = [];
  for (const la of lat) {
    for (const lo of lon) {
      const seen = prevStep && (la - LAT_MIN) % prevStep === 0 && (lo + 180) % prevStep === 0;
      if (!seen) pts.push([la, lo]);
    }
  }
  return pts;
}

/** Total points a `steps` plan will compute. Used to estimate a run up front,
 *  so the detail selector can be honest about what it is about to cost. */
export function plannedPointCount(steps) {
  let prev = null, n = 0;
  for (const s of steps) { n += newPointsFor(s, prev).length; prev = s; }
  return n;
}

export class GridPool {
  #workers = [];
  #booted = false;
  #busy = false;

  constructor({ size = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)),
                workerUrl = './gridworker.mjs', dataUrl = './data/itu' } = {}) {
    this.size = size;
    this.workerUrl = workerUrl;
    this.dataUrl = dataUrl;
  }

  async boot() {
    if (this.#booted) return;
    this.#workers = Array.from({ length: this.size }, () =>
      new Worker(this.workerUrl, { type: 'module' }));
    await Promise.all(this.#workers.map((w) => new Promise((resolve, reject) => {
      const onMsg = (e) => { if (e.data?.booted) { w.removeEventListener('message', onMsg); resolve(); } };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', (e) => reject(new Error(e.message || 'worker failed to start')),
        { once: true });
      w.postMessage({ cmd: 'boot', dataUrl: this.dataUrl });
    })));
    this.#booted = true;
  }

  terminate() {
    for (const w of this.#workers) w.terminate();
    this.#workers = [];
    this.#booted = false;
  }

  /** True while a grid run holds the workers. Callers use it to avoid queueing a
   *  quick job behind a job measured in minutes. */
  get busy() { return this.#busy; }

  /** One circuit at full hourly resolution — the exact path, not a grid cell.
   *  Reuses the booted pool, so it costs a fraction of a second once the engine
   *  is up rather than another 11 MB of ITU data. */
  async point({ tx, lat, lon, freqs, hours, month, year, ssn, powerW, reqSnr }) {
    // Two conversations with the same worker would cross their replies, so this
    // refuses rather than corrupting a run in progress. Callers check `busy`.
    if (this.#busy) throw new Error('pool is busy with a grid run');
    await this.boot();
    const d = await this.#ask(this.#workers[0], {
      cmd: 'grid', tx, points: [[lat, lon]], freqs, hours, month, year, ssn, powerW, reqSnr,
    });
    return d.cells[0] ?? null;      // [lat, lon, perHour]
  }

  #ask(w, msg) {
    return new Promise((resolve, reject) => {
      const done = () => {
        w.removeEventListener('message', onMsg);
        w.removeEventListener('error', onErr);
      };
      const onMsg = (e) => { if (e.data?.cells) { done(); resolve(e.data); } };
      const onErr = (e) => { done(); reject(new Error(e.message || 'worker error')); };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', onErr);
      w.postMessage(msg);
    });
  }

  /**
   * Run the passes in `steps` (coarse first). Calls `onCells` with each batch as
   * it lands, and `onPass` when a resolution completes.
   *
   * Work is pulled from a shared queue in small batches rather than split evenly
   * up front. Two reasons: cells differ in cost, so a static split leaves
   * workers idling at the end of a pass; and a small batch is the abort
   * granularity, so `signal` stops a long run in about a second instead of
   * making the user wait out a whole resolution.
   */
  async run(opts) {
    this.#busy = true;
    try { await this.#runPasses(opts); } finally { this.#busy = false; }
  }

  async #runPasses({ tx, freqs, hours, month, year, ssn, powerW, reqSnr,
                     steps = [24, 12], onCells, onPass, onProgress, onEngine, signal }) {
    await this.boot();
    const total = steps.reduce((n, s, i) => n + newPointsFor(s, i ? steps[i - 1] : null).length, 0);
    const t0 = performance.now();
    let prev = null, done = 0, sawEngine = false;

    for (const step of steps) {
      if (signal?.aborted) return;
      const queue = newPointsFor(step, prev);
      let next = 0;

      // Batch size trades round-trips against responsiveness. Cap it so every
      // worker returns several times per pass: otherwise the coarse pass — only
      // ~100 points — lands in one lump and the map snaps rather than fills.
      const batch = Math.max(1, Math.min(
        Math.round(96 / Math.max(1, hours.length)),
        Math.ceil(queue.length / (this.#workers.length * 4))));

      const drain = async (w) => {
        while (!signal?.aborted && next < queue.length) {
          const points = queue.slice(next, next + batch);
          next += points.length;
          const d = await this.#ask(w, { cmd: 'grid', tx, points, freqs, hours, month, year,
                                         ssn, powerW, reqSnr });
          if (signal?.aborted) return;
          if (d.engine && !sawEngine) { sawEngine = true; onEngine?.(d.engine); }
          // Count points requested, not cells returned: a cell the engine
          // cannot predict is still work done, and progress must reach 100%.
          done += points.length;
          onCells?.(d.cells, step);
          onProgress?.({ done, total, elapsedMs: performance.now() - t0 });
        }
      };
      await Promise.all(this.#workers.map(drain));

      if (signal?.aborted) return;
      onPass?.(step);
      prev = step;
    }
  }
}

/**
 * Sparse grid that always renders at full 6° resolution.
 *
 * A coarse cell paints the whole block it stands for, so the map is complete
 * from the first pass and simply sharpens — far better than a half-drawn map
 * with holes in it. A finer pass overwrites, because it is strictly better
 * information about that cell.
 */
export class ReachField {
  constructor(hoursLength, bandCount) {
    const { lat, lon } = gridAxes(BASE_STEP);
    this.lat = lat; this.lon = lon;
    this.hoursLength = hoursLength; this.bandCount = bandCount;
    this.marg = Array.from({ length: lat.length }, () => new Array(lon.length).fill(null));
    this.muf = Array.from({ length: lat.length }, () => new Array(lon.length).fill(null));
    this.resolution = Array.from({ length: lat.length }, () => new Array(lon.length).fill(Infinity));
  }

  add(cells, step) {
    const span = Math.max(1, Math.round(step / BASE_STEP));
    for (const [la, lo, per] of cells) {
      const r0 = Math.round((la - LAT_MIN) / BASE_STEP);
      const c0 = Math.round(((lo + 180) % 360) / BASE_STEP);
      // Centre the block on the computed point so a coarse sample represents
      // its neighbourhood rather than only the cells to one side of it.
      const half = Math.floor(span / 2);
      for (let dr = -half; dr < span - half; dr++) {
        for (let dc = -half; dc < span - half; dc++) {
          const r = r0 + dr;
          if (r < 0 || r >= this.lat.length) continue;
          const c = ((c0 + dc) % this.lon.length + this.lon.length) % this.lon.length;
          if (this.resolution[r][c] < step) continue;   // finer data already there
          this.marg[r][c] = per.map((p) => p[0]);
          this.muf[r][c] = per.map((p) => p[1]);
          this.resolution[r][c] = step;
        }
      }
    }
  }

  at(r, c, hourIndex) {
    const m = this.marg[r]?.[c];
    if (!m) return null;
    return { margins: m[hourIndex] ?? null, muf: this.muf[r][c]?.[hourIndex] ?? null };
  }
}
