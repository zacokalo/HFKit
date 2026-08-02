// The aurora overlay: loading it, and painting it onto the reach map.
//
// This shows *observed and forecast* aurora. It does not alter a single
// prediction — the numbers under it are unchanged. What it adds is the thing a
// Kp reading cannot give you: where. "High-latitude paths degrade" requires
// holding a mental picture of where that is; drawing the oval over your own
// circuits does the work for you.

import { workerUrl } from './spacewx.mjs';

const SNAPSHOT_URL = './data/aurora.json';

/**
 * Fetch the aurora grid, Worker first then the build snapshot, same as
 * everything else. Returns null rather than throwing: a missing overlay is not
 * a missing prediction, and the map must carry on without it.
 */
export async function loadAurora({ timeoutMs = 6000 } = {}) {
  const tryUrl = async (url, tier) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) return null;
      const text = await res.text();
      if (/^\s*(<!doctype|<html)/i.test(text)) return null;
      const a = JSON.parse(text);
      if (!Array.isArray(a?.cells) || !a.forecastFor) return null;
      return { ...a, tier };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const live = await workerUrl();
  if (live) {
    const base = live.replace(/\/[^/]*$/, '');
    const got = await tryUrl(`${base}/aurora.json`, 'live');
    if (got) return got;
  }
  return tryUrl(SNAPSHOT_URL, 'snapshot');
}

/**
 * Render the grid to an offscreen canvas, one pixel per cell.
 *
 * Returned with the geographic extent it covers, so the caller can place it
 * without re-deriving the projection.
 *
 * Deliberately **one hue, varying only in opacity**. The obvious choice was the
 * full sequential ramp, and it looked good — but "Best band" and "Path MUF"
 * colour the map from that same ramp, so an aurora drawn across it would be
 * indistinguishable from the data underneath. A single hue reads as a glow laid
 * over the map rather than as more map. The hue is the top of the sequential
 * ramp, so it still follows the theme; the status tokens would have been wrong,
 * since "good" and "poor" mean something specific here and aurora is neither.
 */
export function renderAurora(aurora, hueRgb, { minAlpha = 30, maxAlpha = 220 } = {}) {
  const step = aurora.step ?? 2;
  const w = Math.round(360 / step), h = Math.round(180 / step);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);

  // Scale against the strongest cell present, not against 100. A quiet night
  // peaking at 8% would otherwise render as invisible, when 8% is exactly what
  // the operator wants to see.
  const peak = Math.max(5, aurora.max ?? 100);
  const cells = aurora.cells;
  for (let i = 0; i < cells.length; i += 3) {
    const lon = cells[i], lat = cells[i + 1], p = cells[i + 2];
    const x = Math.round((lon + 180) / step);
    const y = Math.round((90 - lat) / step) - 1;      // north at the top
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const t = Math.min(1, p / peak);
    const [r, g, b] = hueRgb;
    const o = (y * w + x) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
    img.data[o + 3] = Math.round(minAlpha + (maxAlpha - minAlpha) * t);
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: cv, west: -180, north: 90, east: 180, south: -90 };
}

/** Probability at a point, for the readout. Null outside the covered cells,
 *  which means "below the 2% floor", not "no data". */
export function auroraAt(aurora, lat, lon) {
  if (!aurora) return null;
  const step = aurora.step ?? 2;
  const la = Math.floor(lat / step) * step;
  const lo = Math.floor((((lon + 180) % 360) + 360) % 360 / step) * step - 180;
  const cells = aurora.cells;
  for (let i = 0; i < cells.length; i += 3) {
    if (cells[i] === lo && cells[i + 1] === la) return cells[i + 2];
  }
  return null;
}

/** Does a great-circle path cross the auroral zone? The question a map can
 *  answer and a Kp number cannot. */
export function pathCrossesAurora(aurora, segments, threshold = 5) {
  if (!aurora) return null;
  let worst = 0;
  for (const seg of segments) {
    for (const [lon, lat] of seg) {
      const p = auroraAt(aurora, lat, lon);
      if (p !== null && p > worst) worst = p;
    }
  }
  return worst >= threshold ? worst : null;
}
