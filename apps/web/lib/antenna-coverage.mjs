// The antenna's coverage footprint, drawn on a map centred on your station.
//
// The projection is azimuthal equidistant, which is not decoration: distance
// from the centre is linear in radius, so a range ring is a true circle and the
// distance-to-take-off-angle mapping becomes a straight radial lookup. Every
// other projection would bend the one relationship this picture exists to show.
//
// What it shows is where the *antenna* puts energy, from geometry alone — no
// propagation model, no ionosphere, no time of day. That makes it fast, offline
// and honest about being half the answer. The reach map is where the other half
// lives, and the caller is expected to say so.

const DEG = Math.PI / 180;
const EARTH_KM = 6371;

/** Great-circle distance and initial bearing from a to b. */
export function rangeBearing(a, b) {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  const km = EARTH_KM * 2 * Math.asin(Math.sqrt(
    Math.sin((p2 - p1) / 2) ** 2
    + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return { km, bearing: (Math.atan2(y, x) / DEG + 360) % 360 };
}

/**
 * Range rings that land on numbers a person would say out loud, evenly spaced.
 *
 * Evenly spaced matters more than it sounds. Picking from a fixed list of
 * "nice" distances and trimming it crowds every small ring into the middle of
 * the disc, where their labels overlap each other and the station marker. A
 * single step from the 1-2-2.5-5 sequence gives three to five rings spread
 * across whatever range is on screen.
 */
export function ringsFor(maxKm) {
  const target = maxKm / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, target)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= target * 0.6)
    ?? 10 * pow;
  const out = [];
  for (let r = step; r < maxKm * 0.98; r += step) out.push(Math.round(r));
  return out;
}

/**
 * Paint the footprint.
 *
 * `gainTable` is a function (elevationDeg, trueBearingDeg) -> dBi. It is called
 * once per pixel, so the caller must hand over something table-backed; running
 * a live pattern sum here would be a quarter of a million segment loops.
 */
export function drawCoverage(ctx, {
  size, maxRangeKm, gainTable, elevationFor, colours, peakDbi, spanDb = 20,
  centre = null, coastline = null, targetKm = null, labelFor = (km) => `${km} km`,
  fmtRing = null,
}) {
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 26;
  ctx.clearRect(0, 0, size, size);

  // --- the coverage disc, one pixel at a time ---
  // Elevation depends only on radius, so it is resolved once per ring of pixels
  // rather than per pixel.
  const elevForR = new Float32Array(Math.ceil(R) + 2);
  for (let r = 0; r < elevForR.length; r++) {
    elevForR[r] = elevationFor((r / R) * maxRangeKm);
  }

  const img = ctx.createImageData(size, size);
  const floor = peakDbi - spanDb;
  for (let y = 0; y < size; y++) {
    const dy = y - cy;
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const r = Math.hypot(dx, dy);
      if (r > R) continue;
      const bearing = (Math.atan2(dx, -dy) / DEG + 360) % 360;
      const g = gainTable(elevForR[Math.round(r)], bearing);
      const t = Math.max(0, Math.min(1, (g - floor) / spanDb));
      const [cr, cg, cb] = colours(t);
      const o = (y * size + x) * 4;
      img.data[o] = cr; img.data[o + 1] = cg; img.data[o + 2] = cb;
      // Fade out the weakest quarter rather than cutting it off: a hard edge
      // would read as a coverage boundary, and there is no boundary here.
      img.data[o + 3] = Math.round(40 + 195 * Math.min(1, t / 0.75));
    }
  }
  ctx.putImageData(img, 0, 0);

  // --- coastline, if we know where the station is ---
  if (centre && coastline) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = colours.coast;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    for (const line of coastline) {
      let started = false;
      ctx.beginPath();
      for (const [lon, lat] of line) {
        const { km, bearing } = rangeBearing(centre, { lat, lon });
        // Beyond the plotted range, and beyond a quarter of the globe, the
        // projection stretches badly — drop the segment rather than draw a lie.
        if (km > maxRangeKm * 1.02) { started = false; continue; }
        const rr = (km / maxRangeKm) * R;
        const px = cx + rr * Math.sin(bearing * DEG);
        const py = cy - rr * Math.cos(bearing * DEG);
        if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- rings, bearings, labels ---
  ctx.save();
  ctx.strokeStyle = colours.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const km of ringsFor(maxRangeKm)) {
    const rr = (km / maxRangeKm) * R;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (let a = 0; a < 360; a += 30) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.sin(a * DEG), cy - R * Math.cos(a * DEG));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = colours.edge;
  ctx.stroke();

  // The distance the rest of the page is talking about, marked so the map and
  // the verdict above it are visibly the same question.
  if (targetKm && targetKm <= maxRangeKm) {
    const rr = (targetKm / maxRangeKm) * R;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = colours.target;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = colours.label;
  ctx.textAlign = 'left';
  for (const km of ringsFor(maxRangeKm)) {
    const rr = (km / maxRangeKm) * R;
    ctx.fillText(fmtRing ? fmtRing(km) : labelFor(km), cx + 3, cy - rr - 3);
  }
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = colours.compass;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [a, s] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    ctx.fillText(s, cx + (R + 13) * Math.sin(a * DEG), cy - (R + 13) * Math.cos(a * DEG));
  }

  // The station itself.
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = colours.station;
  ctx.fill();
  ctx.restore();
}

/**
 * A table-backed gain lookup for one frequency.
 *
 * Sampled once per redraw and read per pixel. `orientationDeg` is the true
 * bearing the wire runs along; the model's own frame has it east–west, so the
 * difference is folded in here and the caller can think in compass bearings.
 */
export function gainSampler(pattern, orientationDeg = 90, { azStep = 2 } = {}) {
  const nAz = Math.round(360 / azStep), nEl = 91;
  const table = new Float32Array(nAz * nEl);
  for (let a = 0; a < nAz; a++) {
    for (let e = 0; e < nEl; e++) table[a * nEl + e] = pattern.gainAt(e, a * azStep);
  }
  const shift = orientationDeg - 90;
  return (elevDeg, trueBearingDeg) => {
    const ai = ((Math.round(((trueBearingDeg - shift) % 360 + 360) % 360 / azStep)) % nAz);
    const ei = Math.max(0, Math.min(nEl - 1, Math.round(elevDeg)));
    return table[ai * nEl + ei];
  };
}
