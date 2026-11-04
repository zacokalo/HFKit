// The plan on a map: your station, the sites you need, the great-circle paths
// between them, and the way the wire runs.
//
// An SVG rather than the reach map's canvas, because nothing here is a raster:
// a few coastlines, a few arcs, a few labels, and it has to print cleanly in a
// field notebook. Every colour is a class resolved by the theme tokens.
//
// Projection is equirectangular centred on the station, scaled by the cosine
// of the mid-latitude so distances look roughly right locally. Longitudes are
// unwrapped relative to the station so a plan across the antimeridian draws
// as one piece rather than two halves.

const W = 800, H = 440;
const NS = 'http://www.w3.org/2000/svg';
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

const el = (tag, attrs = {}, text = null) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== null) n.textContent = text;
  return n;
};

/** Points along the great circle from a to b, as [lat, lon] pairs. */
export function greatCirclePoints(a, b, steps = 48) {
  const toVec = (p) => {
    const la = rad(p.lat), lo = rad(p.lon);
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  };
  const va = toVec(a), vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const out = [];
  if (omega < 1e-9) return [[a.lat, a.lon], [b.lat, b.lon]];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = Math.sin(t * omega) / Math.sin(omega);
    const x = s1 * va[0] + s2 * vb[0], y = s1 * va[1] + s2 * vb[1], z = s1 * va[2] + s2 * vb[2];
    out.push([deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))]);
  }
  return out;
}

/**
 * Draw the plan into `container`, replacing whatever was there.
 *
 * `coast` is the Natural Earth GeoJSON the site already ships. `sites` carry
 * {name, lat, lon}; `orientationDeg` is the wire's run, drawn at the station
 * when `directional` is true, with broadside arrows so the picture answers the
 * question the word "pointing" raises.
 */
export function renderPlanMap(container, {
  coast, station, sites = [], orientationDeg = null, directional = false,
}) {
  const c = station.lon;
  const unwrap = (lon) => ((lon - c + 540) % 360 + 360) % 360 - 180;

  // Fit the view to the station and every site, with room to breathe and a
  // floor on the span so two sites 40 km apart do not become a blank square.
  const pts = [[station.lat, 0], ...sites.map((s) => [s.lat, unwrap(s.lon)])];
  for (const s of sites) for (const [la, lo] of greatCirclePoints(station, s, 16)) pts.push([la, unwrap(lo)]);
  let minLat = Math.min(...pts.map((p) => p[0])), maxLat = Math.max(...pts.map((p) => p[0]));
  let minLon = Math.min(...pts.map((p) => p[1])), maxLon = Math.max(...pts.map((p) => p[1]));
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.max(0.2, Math.cos(rad(midLat)));
  let spanLat = Math.max(4, (maxLat - minLat) * 1.3);
  let spanLon = Math.max(6 / kx, (maxLon - minLon) * 1.3);
  // Keep the aspect ratio of the box, in projected units.
  if (spanLon * kx / spanLat < W / H) spanLon = (spanLat * (W / H)) / kx;
  else spanLat = (spanLon * kx) / (W / H);
  const cLat = Math.max(-85 + spanLat / 2, Math.min(85 - spanLat / 2, midLat));
  const cLon = (minLon + maxLon) / 2;
  const sx = W / spanLon, sy = H / spanLat;
  const X = (lon) => (lon - cLon) * sx + W / 2;
  const Y = (lat) => H / 2 - (lat - cLat) * sy;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'planmap', role: 'img' });
  svg.append(el('title', {}, 'Your station, the sites you need to reach, and the paths between them'));
  const clipId = `pm-clip-${Math.random().toString(36).slice(2, 8)}`;
  const defs = el('defs');
  const clip = el('clipPath', { id: clipId });
  clip.append(el('rect', { x: 0, y: 0, width: W, height: H }));
  defs.append(clip);
  svg.append(defs);
  svg.append(el('rect', { class: 'sea', x: 0, y: 0, width: W, height: H }));
  const g = el('g', { 'clip-path': `url(#${clipId})` });
  svg.append(g);

  // Graticule, spaced to the zoom.
  const step = spanLat > 60 ? 30 : spanLat > 20 ? 10 : spanLat > 8 ? 5 : 1;
  const grat = el('g', { class: 'grat' });
  for (let la = Math.ceil((cLat - spanLat / 2) / step) * step; la <= cLat + spanLat / 2; la += step) {
    grat.append(el('line', { x1: 0, x2: W, y1: Y(la), y2: Y(la) }));
    grat.append(el('text', { x: 4, y: Y(la) - 3 }, `${la}°`));
  }
  for (let lo = Math.ceil((cLon - spanLon / 2) / step) * step; lo <= cLon + spanLon / 2; lo += step) {
    grat.append(el('line', { y1: 0, y2: H, x1: X(lo), x2: X(lo) }));
    const real = ((lo + c + 540) % 360 + 360) % 360 - 180;
    grat.append(el('text', { x: X(lo) + 3, y: H - 5 }, `${Math.round(real)}°`));
  }
  g.append(grat);

  // Coastline: Natural Earth 110 m, as line strings. Break a line where it
  // jumps across the unwrap seam.
  if (coast?.features) {
    const d = [];
    for (const f of coast.features) {
      const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates
        : f.geometry.type === 'LineString' ? [f.geometry.coordinates] : [];
      for (const line of lines) {
        let prev = null, pen = false;
        for (const [lon, lat] of line) {
          const u = unwrap(lon);
          if (prev !== null && Math.abs(u - prev) > 180) pen = false;
          d.push(`${pen ? 'L' : 'M'}${X(u).toFixed(1)} ${Y(lat).toFixed(1)}`);
          pen = true; prev = u;
        }
      }
    }
    g.append(el('path', { class: 'coast', d: d.join('') }));
  }

  // Paths, then markers on top of them.
  for (const s of sites) {
    const p = greatCirclePoints(station, s).map(([la, lo]) => `${X(unwrap(lo)).toFixed(1)},${Y(la).toFixed(1)}`);
    g.append(el('polyline', { class: 'arc', points: p.join(' ') }));
  }
  const sx0 = X(0), sy0 = Y(station.lat);
  sites.forEach((s, i) => {
    const x = X(unwrap(s.lon)), y = Y(s.lat);
    const m = el('g', { class: 'site' });
    m.append(el('circle', { cx: x, cy: y, r: 6 }));
    m.append(el('text', { x: x + 10, y: y + 4 }, `${i + 1}. ${s.name}`));
    g.append(m);
  });

  // The wire at the station: its run, and the broadside it favours.
  if (directional && orientationDeg !== null) {
    const o = rad(orientationDeg);
    const L = 30;
    const wx = Math.sin(o) * L, wy = -Math.cos(o) * L;
    const wire = el('g', { class: 'wire' });
    wire.append(el('line', { x1: sx0 - wx, y1: sy0 - wy, x2: sx0 + wx, y2: sy0 + wy }));
    // Broadside arrows: perpendicular to the run, both ways.
    const bx = Math.sin(o + Math.PI / 2) * 22, by = -Math.cos(o + Math.PI / 2) * 22;
    for (const sgn of [1, -1]) {
      const ex = sx0 + sgn * bx, ey = sy0 + sgn * by;
      wire.append(el('line', { class: 'bs', x1: sx0, y1: sy0, x2: ex, y2: ey }));
      const ax = sgn * bx / 22, ay = sgn * by / 22;
      wire.append(el('polyline', { class: 'bs', points:
        `${ex - ax * 6 - ay * 4},${ey - ay * 6 + ax * 4} ${ex},${ey} ${ex - ax * 6 + ay * 4},${ey - ay * 6 - ax * 4}` }));
    }
    g.append(wire);
  }
  const st = el('g', { class: 'station' });
  st.append(el('circle', { cx: sx0, cy: sy0, r: 7 }));
  st.append(el('circle', { class: 'inner', cx: sx0, cy: sy0, r: 2.5 }));
  st.append(el('text', { x: sx0 + 11, y: sy0 - 8 }, station.name ?? 'You'));
  g.append(st);

  // North, because a plan without it is a picture.
  const rose = el('g', { class: 'rose', transform: `translate(${W - 26} 30)` });
  rose.append(el('line', { x1: 0, y1: 12, x2: 0, y2: -12 }));
  rose.append(el('polyline', { points: '-5,-5 0,-13 5,-5' }));
  rose.append(el('text', { x: 0, y: 26, 'text-anchor': 'middle' }, 'N'));
  svg.append(rose);

  container.replaceChildren(svg);
  return svg;
}
