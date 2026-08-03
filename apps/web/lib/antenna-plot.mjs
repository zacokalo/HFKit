// Drawing for the antenna visualiser: a construction diagram and two polar
// plots, all as SVG.
//
// Nothing here picks a colour. Every element carries a class and the page's
// stylesheet resolves it to a token, which is what keeps these plots readable
// in all three themes without this file knowing any of them exist.

const NS = 'http://www.w3.org/2000/svg';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  }
  e.append(...kids.filter(Boolean));
  return e;
};
const text = (x, y, s, cls, extra = {}) =>
  el('text', { x, y, class: cls, ...extra }, document.createTextNode(s));

const rad = (d) => (d * Math.PI) / 180;
const round = (n, p = 1) => Number(n.toFixed(p));

// --- construction diagram --------------------------------------------------

/**
 * Elevation view of the wire, with the ground under it.
 *
 * Paths are drawn in the x–z plane. Radials fan out in azimuth in reality and
 * would collapse on top of each other in a side view, so they are laid out
 * alternately left and right — which is how they get drawn on paper too, and
 * reads correctly as "four radials at 45 degrees" rather than as two.
 */
export function constructionSvg(built, {
  width = 640, height = 300, interactive = false, fmt = (m) => `${m.toFixed(2)} m`,
} = {}) {
  // In interactive mode each feature is wrapped in a focusable group carrying a
  // data-part, plus a fat transparent hit target over it. Antenna diagrams are
  // thin lines and small dots; without the hit target you are asking someone to
  // click a two-pixel stroke, which on a touch screen in the field is not a
  // thing that happens.
  const part = (kind, label, ...kids) => {
    if (!interactive) return kids;
    const g = el('g', {
      class: `part part-${kind}`, 'data-part': kind, tabindex: 0,
      role: 'button', 'aria-label': label,
    }, ...kids);
    return [g];
  };
  const hit = (attrs, tag = 'line') => (interactive ? [el(tag, { ...attrs, class: 'hit' })] : []);
  const projected = [];
  let radialIndex = 0;
  for (const p of built.paths) {
    const radial = p.role === 'radial';
    const side = radial ? (radialIndex++ % 2 === 0 ? 1 : -1) : 1;
    projected.push({
      role: p.role ?? 'element',
      pts: p.points.map(([x, y, z]) => [radial ? side * Math.hypot(x, y) : x, z]),
    });
  }

  // Extent, including the ground line and a little headroom for labels.
  let minR = 0, maxR = 0, maxZ = 0.1;
  for (const p of projected) {
    for (const [r, z] of p.pts) {
      minR = Math.min(minR, r); maxR = Math.max(maxR, r); maxZ = Math.max(maxZ, z);
    }
  }
  const buried = built.radials?.onGround ? built.radials.length : 0;
  minR = Math.min(minR, -buried); maxR = Math.max(maxR, buried);

  const pad = { l: 46, r: 46, t: 26, b: 34 };
  const spanR = Math.max(1, maxR - minR), spanZ = Math.max(1, maxZ);
  const sx = (width - pad.l - pad.r) / spanR;
  const sy = (height - pad.t - pad.b) / (spanZ * 1.15);
  const s = Math.min(sx, sy);
  const originX = pad.l + (width - pad.l - pad.r) / 2 - ((minR + maxR) / 2) * s;
  const groundY = height - pad.b;
  const X = (r) => originX + r * s;
  const Y = (z) => groundY - z * s;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'ant-diagram',
    role: 'img', 'aria-label': `Construction diagram for ${built.antenna.name}`,
  });

  // ground
  const hatch = [];
  for (let x = 6; x < width; x += 14) {
    hatch.push(el('line', { x1: x, y1: groundY, x2: x - 6, y2: groundY + 6, class: 'gnd-hatch' }));
  }
  svg.append(...part('ground', 'Ground',
    el('line', { x1: 0, y1: groundY, x2: width, y2: groundY, class: 'gnd' }),
    ...hatch,
    ...hit({ x1: 0, y1: groundY, x2: width, y2: groundY })));

  // buried radials, which are real hardware even though the model ignores them
  if (buried) {
    const wires = [-1, 1].map((dir) => el('line', {
      x1: X(0), y1: groundY + 2, x2: X(dir * buried), y2: groundY + 5, class: 'radial buried',
    }));
    svg.append(...part('counterpoise', 'Radials', ...wires,
      text(X(0), groundY + 20,
        `${built.radials.count} radials · ${fmt(built.radials.length)}`,
        'lbl muted', { 'text-anchor': 'middle' }),
      ...hit({ x1: X(-buried), y1: groundY + 4, x2: X(buried), y2: groundY + 4 })));
  }

  // supports: a mast under each local high point that is not the feed
  const masts = [];
  for (const p of projected) {
    if (p.role === 'radial') continue;
    for (const [r, z] of p.pts) {
      if (z > 0.5 && Math.abs(z - maxZ) < 1e-6) {
        masts.push(el('line', { x1: X(r), y1: Y(z), x2: X(r), y2: groundY, class: 'mast' }),
          ...hit({ x1: X(r), y1: Y(z), x2: X(r), y2: groundY }));
      }
    }
  }
  if (masts.length) svg.append(...part('mast', 'Support', ...masts));

  projected.forEach((p, pi) => {
    const line = el('polyline', {
      points: p.pts.map(([r, z]) => `${round(X(r))},${round(Y(z))}`).join(' '),
      class: `wire ${p.role}`,
    });
    const fat = interactive ? [el('polyline', {
      points: p.pts.map(([r, z]) => `${round(X(r))},${round(Y(z))}`).join(' '),
      class: 'hit',
    })] : [];
    const kind = p.role === 'radial' ? 'counterpoise' : 'element';
    svg.append(...part(kind, kind === 'radial' ? 'Radial' : 'Radiating element', line, ...fat));
    // Segment lengths go on the wire itself. They come from the true 3-D
    // points, not the projected ones — a sloping wire is longer than the span
    // it covers, and that difference is exactly what catches people out.
    if (p.role === 'radial') return;
    const src = built.paths[pi].points;
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, ay, az] = src[i - 1], [bx, by, bz] = src[i];
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const mx = (X(p.pts[i - 1][0]) + X(p.pts[i][0])) / 2;
      const my = (Y(p.pts[i - 1][1]) + Y(p.pts[i][1])) / 2;
      svg.append(text(mx, my - 7, fmt(len), 'lbl', { 'text-anchor': 'middle' }));
    }
  });

  // feed point
  const feedPath = built.paths.find((p) => p.role !== 'radial') ?? built.paths[0];
  const feed = feedPoint(feedPath);
  const fr = feed[0], fz = feed[2];
  // Below the dot, because the wire's own length label sits above it. A
  // base-fed vertical has no room below, so that one goes up and to the side.
  const groundFed = fz < 0.3;
  svg.append(...part('feed', 'Feedpoint',
    el('circle', { cx: X(fr), cy: Y(fz), r: 5, class: 'feed' }),
    text(X(fr) + (groundFed ? 10 : 0), Y(fz) + (groundFed ? -12 : 16), 'feed',
      'lbl feed-lbl', { 'text-anchor': groundFed ? 'start' : 'middle' }),
    ...hit({ cx: X(fr), cy: Y(fz), r: 13 }, 'circle')));

  // Free ends: a voltage maximum, and the part most likely to hurt someone.
  const ends = [];
  projected.forEach((p) => {
    if (p.role === 'radial') return;
    for (const [r, z] of [p.pts[0], p.pts.at(-1)]) {
      // The fed end of an end-fed wire is not a free end. Detected by position
      // rather than by arc length, which covers a feed at either end.
      if (Math.abs(X(r) - X(fr)) < 6 && Math.abs(Y(z) - Y(fz)) < 6) continue;
      ends.push(el('circle', { cx: X(r), cy: Y(z), r: 3.5, class: 'wire-end' }),
        ...hit({ cx: X(r), cy: Y(z), r: 11 }, 'circle'));
    }
  });
  if (ends.length) svg.append(...part('end', 'Wire end', ...ends));

  // height dimension, from the ground to whatever is highest
  const topZ = maxZ;
  const dimX = X(maxR) + 22;
  svg.append(el('line', { x1: dimX, y1: Y(topZ), x2: dimX, y2: groundY, class: 'dim' }));
  svg.append(el('line', { x1: dimX - 4, y1: Y(topZ), x2: dimX + 4, y2: Y(topZ), class: 'dim' }));
  svg.append(el('line', { x1: dimX - 4, y1: groundY, x2: dimX + 4, y2: groundY, class: 'dim' }));
  svg.append(text(dimX + 6, (Y(topZ) + groundY) / 2, fmt(topZ), 'lbl',
    { 'dominant-baseline': 'middle' }));

  return svg;
}

function feedPoint(path) {
  const pts = path.points;
  let total = 0;
  const lens = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1],
      pts[i][2] - pts[i - 1][2]);
    lens.push(l); total += l;
  }
  let want = Math.min(Math.max(path.feedAt ?? total / 2, 0), total);
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i] || i === lens.length - 1) {
      const t = lens[i] > 0 ? Math.min(1, want / lens[i]) : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
        pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t,
      ];
    }
    want -= lens[i];
  }
  return pts[0];
}

// --- polar plots -----------------------------------------------------------

/** Ring scale: outer edge just above the peak, `span` dB of usable range. */
export function scaleFor(peakDbi, span = 30) {
  const outer = Math.ceil(peakDbi / 3) * 3;
  return {
    outer, span,
    radius: (dbi) => Math.max(0, Math.min(1, (dbi - (outer - span)) / span)),
    rings: [0, 6, 12, 18, 24].map((d) => ({ dbi: outer - d, frac: (span - d) / span })),
  };
}

/**
 * Elevation pattern, drawn as a half-disc: the chosen bearing on the right,
 * the reciprocal on the left. That is the convention every antenna modeller
 * uses, and it matters here because it shows a dipole's two lobes at once.
 */
export function elevationSvg(pattern, {
  azimuthDeg = 0, markers = [], width = 460, span = 30, envelope = true,
} = {}) {
  const R = width / 2 - 40;
  const cx = width / 2, cy = R + 30;
  const height = cy + 46;
  const sc = scaleFor(pattern.peak.gainDbi, span);
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'ant-polar ant-elev', role: 'img',
    'aria-label': `Elevation pattern at ${Math.round(azimuthDeg)} degrees`,
  });

  const P = (elev, frac, side) => {
    const a = rad(elev);
    return [cx + side * Math.cos(a) * frac * R, cy - Math.sin(a) * frac * R];
  };

  // Rings, with their dB values. The innermost ring is drawn but not labelled:
  // near the centre every spoke, both traces and the ring labels converge, and
  // a number nobody can read is just noise over the plot.
  for (const ring of sc.rings) {
    svg.append(el('path', {
      d: `M ${cx - ring.frac * R} ${cy} A ${ring.frac * R} ${ring.frac * R} 0 0 1 `
        + `${cx + ring.frac * R} ${cy}`,
      class: 'ring',
    }));
    if (ring.frac >= 0.35) {
      svg.append(text(cx + 4, cy - ring.frac * R + 11, `${ring.dbi.toFixed(0)}`, 'lbl ring-lbl'));
    }
  }
  // elevation spokes every 15 degrees, both sides
  for (let e = 0; e <= 90; e += 15) {
    for (const side of [-1, 1]) {
      if (e === 90 && side === -1) continue;
      const [x, y] = P(e, 1, side);
      svg.append(el('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'spoke' }));
      const [lx, ly] = P(e, 1.1, side);
      svg.append(text(lx, ly, `${e}°`, 'lbl spoke-lbl',
        { 'text-anchor': 'middle', 'dominant-baseline': 'middle' }));
    }
  }
  svg.append(el('line', { x1: cx - R, y1: cy, x2: cx + R, y2: cy, class: 'horizon' }));

  const trace = (cut, cls) => {
    const pts = [];
    for (const side of [-1, 1]) {
      const c = side === 1 ? cut.right : cut.left;
      const n = c.length;
      const order = side === -1 ? [...Array(n).keys()].reverse() : [...Array(n).keys()];
      for (const i of order) {
        const [x, y] = P((i * 90) / (n - 1), sc.radius(c[i]), side);
        pts.push(`${round(x)},${round(y)}`);
      }
    }
    svg.append(el('polyline', { points: pts.join(' '), class: cls }));
  };

  if (envelope) {
    trace({ right: pattern.envelope, left: pattern.envelope }, 'trace envelope');
  }
  trace({
    right: pattern.elevCut(azimuthDeg),
    left: pattern.elevCut(azimuthDeg + 180),
  }, 'trace main');

  // take-off angle markers, drawn over the trace
  for (const mk of markers) {
    if (mk.elevationDeg < 0 || mk.elevationDeg > 90) continue;
    for (const side of [-1, 1]) {
      const [x, y] = P(mk.elevationDeg, 1, side);
      svg.append(el('line', {
        x1: cx, y1: cy, x2: x, y2: y, class: `marker ${mk.kind ?? ''}`,
      }));
    }
    const [lx, ly] = P(mk.elevationDeg, 0.62, 1);
    svg.append(text(lx + 6, ly - 4, mk.label, 'lbl marker-lbl'));
  }

  svg.append(text(cx - R, height - 8, `${bearing(azimuthDeg + 180)}`, 'lbl axis-lbl'));
  svg.append(text(cx + R, height - 8, `${bearing(azimuthDeg)}`, 'lbl axis-lbl',
    { 'text-anchor': 'end' }));
  return svg;
}

/** Azimuth pattern at a fixed elevation, north up. */
export function azimuthSvg(pattern, { elevationDeg = 15, width = 380, span = 30 } = {}) {
  const R = width / 2 - 34;
  const cx = width / 2, cy = width / 2;
  const sc = scaleFor(pattern.peak.gainDbi, span);
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${width}`, class: 'ant-polar ant-azim', role: 'img',
    'aria-label': `Azimuth pattern at ${Math.round(elevationDeg)} degrees elevation`,
  });

  for (const ring of sc.rings) {
    svg.append(el('circle', { cx, cy, r: ring.frac * R, class: 'ring' }));
  }
  for (let a = 0; a < 360; a += 30) {
    const x = cx + Math.sin(rad(a)) * R, y = cy - Math.cos(rad(a)) * R;
    svg.append(el('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'spoke' }));
  }
  for (const [a, lab] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const x = cx + Math.sin(rad(a)) * (R + 15), y = cy - Math.cos(rad(a)) * (R + 15);
    svg.append(text(x, y, lab, 'lbl compass',
      { 'text-anchor': 'middle', 'dominant-baseline': 'middle' }));
  }

  const cut = pattern.azCut(elevationDeg);
  const pts = [];
  for (let i = 0; i < cut.length; i++) {
    const a = rad((i * 360) / (cut.length - 1));
    const f = sc.radius(cut[i]);
    pts.push(`${round(cx + Math.sin(a) * f * R)},${round(cy - Math.cos(a) * f * R)}`);
  }
  svg.append(el('polygon', { points: pts.join(' '), class: 'trace main filled' }));
  return svg;
}

const bearing = (deg) => {
  const d = ((deg % 360) + 360) % 360;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // Rounded before the wrap, so a bearing of 359.9 reads as 0 and not as 360.
  return `${Math.round(d) % 360}° ${names[Math.round(d / 45) % 8]}`;
};
