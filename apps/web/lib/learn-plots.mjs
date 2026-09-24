// Drawing for the Learn page, all as SVG.
//
// Same rule as antenna-plot.mjs: nothing here picks a colour. Every element
// carries a class and learn.html's stylesheet resolves it to a token, which is
// what keeps these drawings readable in all three themes. Opacity is the one
// presentation attribute set directly, because it encodes a quantity (how
// strongly a layer is ionised) rather than a colour.
//
// Every function takes the pixel width it will be shown at and draws at that
// size, so text stays at its real size on a phone instead of being scaled down
// with the viewBox.

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
  el('text', { x: r1(x), y: r1(y), class: cls, ...extra }, document.createTextNode(s));

const r1 = (n) => Math.round(n * 10) / 10;
const pts = (arr) => arr.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const km = (n) => `${Math.round(n).toLocaleString('en-US')} km`;

let clipSeq = 0;

const svgRoot = (width, height, cls, label) => el('svg', {
  viewBox: `0 0 ${width} ${height}`, width, height, class: `lp ${cls}`,
  role: 'img', 'aria-label': label,
});

/** A logarithmic axis, with an inverse for turning a pointer back into a value. */
export function logScale(min, max, p0, p1) {
  const a = Math.log(min), b = Math.log(max);
  const f = (v) => p0 + ((Math.log(v) - a) / (b - a)) * (p1 - p0);
  f.invert = (p) => Math.exp(a + ((p - p0) / (p1 - p0)) * (b - a));
  return f;
}

// --- chapter 1: the spectrum strip ------------------------------------------

/**
 * The HF spectrum as a strip: amateur bands on top, other services beneath,
 * and a pointer at the current frequency. Log scale, because that is how the
 * bands are spread — 160 m and 80 m are an octave apart, as are 20 m and 10 m.
 */
export function spectrumSvg({ width, fMHz, min, max, hamBands, others, activeId }) {
  const H = 84, padX = 14, trackY = 34, trackH = 26;
  const x = logScale(min, max, padX, width - padX);
  const svg = svgRoot(width, H, 'spectrum',
    `HF spectrum from ${min} to ${max} MHz, pointer at ${fMHz.toFixed(3)} MHz`);

  for (const t of [2, 3, 5, 7, 10, 14, 20, 30, 50]) {
    if (t < min || t > max) continue;
    svg.append(el('line', { x1: r1(x(t)), x2: r1(x(t)), y1: trackY - 4, y2: trackY, class: 'tick' }));
    svg.append(text(x(t), trackY - 8, `${t}`, 'lbl muted', { 'text-anchor': 'middle' }));
  }
  svg.append(text(padX, 12, 'MHz', 'lbl muted'));

  svg.append(el('rect', {
    x: padX, y: trackY, width: width - 2 * padX, height: trackH, rx: 3, class: 'track',
  }));
  for (const o of others) {
    if (o.at !== undefined) {
      svg.append(el('rect', {
        x: r1(x(o.at) - 1), y: trackY + trackH - 8, width: 2, height: 8, class: 'svc',
      }));
    } else {
      svg.append(el('rect', {
        x: r1(x(o.lo)), y: trackY + trackH - 8,
        width: r1(Math.max(2, x(o.hi) - x(o.lo))), height: 8, class: 'svc',
      }));
    }
  }
  let lastLabel = -Infinity;
  for (const b of hamBands) {
    const x0 = x(b.lo), x1 = Math.max(x0 + 3, x(b.hi));
    svg.append(el('rect', {
      x: r1(x0), y: trackY + 2, width: r1(x1 - x0), height: trackH - 12,
      class: `ham${b.id === activeId ? ' on' : ''}`,
    }));
    const cxb = (x0 + x1) / 2;
    if (cxb - lastLabel >= 22) {
      svg.append(text(cxb, trackY + trackH + 14, b.label.replace(' m', ''),
        `lbl${b.id === activeId ? ' strong' : ''}`, { 'text-anchor': 'middle' }));
      lastLabel = cxb;
    }
  }

  const px = x(clamp(fMHz, min, max));
  svg.append(el('line', { x1: r1(px), x2: r1(px), y1: trackY - 2, y2: trackY + trackH + 2, class: 'ptr' }));
  svg.append(el('polygon', {
    points: pts([[px - 6, trackY - 12], [px + 6, trackY - 12], [px, trackY - 3]]), class: 'ptr-head',
  }));
  svg.append(el('rect', { x: 0, y: 0, width, height: H, class: 'hit' }));
  return { svg, scale: x };
}

// --- chapter 1: the wave, and things as long as it -------------------------

const ICONS = {
  // Each draws inside the box (x, y, w, h). Line art: one class for strokes,
  // one for the faint fills, both tokens.
  'football pitch': (x, y, w, h) => [
    el('rect', { x, y, width: w, height: h, class: 'ico-fill ico' }),
    el('line', { x1: x + w / 2, x2: x + w / 2, y1: y, y2: y + h, class: 'ico' }),
    el('circle', { cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) * 0.16, class: 'ico' }),
    el('rect', { x, y: y + h * 0.3, width: w * 0.12, height: h * 0.4, class: 'ico' }),
    el('rect', { x: x + w * 0.88, y: y + h * 0.3, width: w * 0.12, height: h * 0.4, class: 'ico' }),
  ],
  'tennis court': (x, y, w, h) => [
    el('rect', { x, y, width: w, height: h, class: 'ico-fill ico' }),
    el('line', { x1: x + w / 2, x2: x + w / 2, y1: y - 2, y2: y + h + 2, class: 'ico strong' }),
    el('line', { x1: x + w * 0.27, x2: x + w * 0.27, y1: y + h * 0.12, y2: y + h * 0.88, class: 'ico' }),
    el('line', { x1: x + w * 0.73, x2: x + w * 0.73, y1: y + h * 0.12, y2: y + h * 0.88, class: 'ico' }),
    el('line', { x1: x + w * 0.27, x2: x + w * 0.73, y1: y + h / 2, y2: y + h / 2, class: 'ico' }),
  ],
  bus: (x, y, w, h) => {
    const out = [el('rect', {
      x, y: y + h * 0.05, width: w, height: h * 0.72, rx: Math.min(4, h * 0.1), class: 'ico-fill ico',
    })];
    const n = Math.max(2, Math.round(w / 12));
    for (let i = 0; i < n; i++) {
      out.push(el('rect', {
        x: x + w * 0.06 + (i * w * 0.88) / n, y: y + h * 0.16,
        width: (w * 0.88) / n - 2, height: h * 0.24, class: 'ico',
      }));
    }
    for (const f of [0.2, 0.8]) {
      out.push(el('circle', { cx: x + w * f, cy: y + h * 0.8, r: h * 0.14, class: 'ico-fill ico' }));
    }
    return out;
  },
  car: (x, y, w, h) => [
    el('path', {
      d: `M${x} ${y + h * 0.75} V${y + h * 0.45} L${x + w * 0.22} ${y + h * 0.4} `
        + `L${x + w * 0.36} ${y + h * 0.08} H${x + w * 0.72} L${x + w * 0.86} ${y + h * 0.4} `
        + `L${x + w} ${y + h * 0.48} V${y + h * 0.75} Z`,
      class: 'ico-fill ico',
    }),
    el('circle', { cx: x + w * 0.22, cy: y + h * 0.78, r: h * 0.16, class: 'ico-fill ico' }),
    el('circle', { cx: x + w * 0.78, cy: y + h * 0.78, r: h * 0.16, class: 'ico-fill ico' }),
  ],
  'person lying down': (x, y, w, h) => [
    el('circle', { cx: x + h * 0.3, cy: y + h / 2, r: h * 0.26, class: 'ico' }),
    el('line', { x1: x + h * 0.56, x2: x + w * 0.62, y1: y + h / 2, y2: y + h / 2, class: 'ico' }),
    el('line', { x1: x + w * 0.62, x2: x + w, y1: y + h / 2, y2: y + h * 0.2, class: 'ico' }),
    el('line', { x1: x + w * 0.62, x2: x + w, y1: y + h / 2, y2: y + h * 0.8, class: 'ico' }),
    el('line', { x1: x + w * 0.3, x2: x + w * 0.45, y1: y + h / 2, y2: y + h * 0.15, class: 'ico' }),
  ],
};
const ICON_ASPECT = {
  'football pitch': 0.64, 'tennis court': 0.46, bus: 0.3, car: 0.4, 'person lying down': 0.3,
};

/**
 * Top: the wave drawn to a fixed scale, so it visibly stretches and squeezes as
 * the frequency changes. Bottom: one wavelength enlarged, with everyday things
 * laid end to end along it.
 */
export function waveSvg({ width, lambdaM, thing, viewM = 180 }) {
  const pad = 14, plotW = width - 2 * pad;
  const H = 214;
  const svg = svgRoot(width, H, 'wave',
    `One wavelength is ${lambdaM.toFixed(1)} metres, about ${thing.text}`);

  // Row 1: to scale.
  const pxPerM = plotW / viewM;
  const cycles = viewM / lambdaM;
  const n = Math.max(240, Math.ceil(cycles * 24));
  const y0 = 42, amp = 16;
  const wave = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    wave.push([pad + t * plotW, y0 - amp * Math.sin(2 * Math.PI * cycles * t)]);
  }
  svg.append(text(pad, 12, `To scale: ${viewM} m of wave`, 'lbl muted'));
  svg.append(el('polyline', { points: pts(wave), class: 'wave' }));

  const bw = Math.min(plotW, lambdaM * pxPerM);
  const by = y0 + amp + 10;
  svg.append(el('path', {
    d: `M${pad} ${by - 4} V${by} H${r1(pad + bw)} V${by - 4}`, class: 'bracket',
  }));
  const bl = `one wavelength: ${lambdaM.toFixed(1)} m`;
  svg.append(text(bw > 180 ? pad + bw / 2 : pad, by + 14, bl, 'lbl strong',
    { 'text-anchor': bw > 180 ? 'middle' : 'start' }));

  const ry = by + 30;
  svg.append(el('line', { x1: pad, x2: pad + plotW, y1: ry, y2: ry, class: 'axis' }));
  const step = plotW < 420 ? 60 : 30;
  for (let m = 0; m <= viewM; m += step) {
    const x = pad + m * pxPerM;
    svg.append(el('line', { x1: r1(x), x2: r1(x), y1: ry, y2: ry + 4, class: 'tick' }));
    svg.append(text(x, ry + 15, m === viewM ? `${m} m` : `${m}`, 'lbl muted',
      { 'text-anchor': m === 0 ? 'start' : m === viewM ? 'end' : 'middle' }));
  }

  // Row 2: one wavelength, enlarged, with things along it.
  const zy = ry + 40;
  const zw = plotW * 0.9;
  svg.append(text(pad, zy - 8, `One wavelength, enlarged: about ${thing.text}`, 'lbl muted'));
  const one = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    one.push([pad + t * zw, zy + 10 - 9 * Math.sin(2 * Math.PI * t)]);
  }
  svg.append(el('polyline', { points: pts(one), class: 'wave thin' }));

  const iconW = zw / thing.count;
  const iconH = Math.min(46, Math.max(10, iconW * ICON_ASPECT[thing.one]));
  const iy = zy + 26 + (46 - iconH);
  const whole = Math.floor(thing.count), frac = thing.count - whole;
  const draw = ICONS[thing.one];
  for (let i = 0; i < whole; i++) {
    svg.append(el('g', {}, ...draw(pad + i * iconW + 1, iy, iconW - 2, iconH)));
  }
  if (frac > 0.04) {
    const id = `lp-clip-${++clipSeq}`;
    svg.append(el('clipPath', { id },
      el('rect', { x: pad + whole * iconW, y: iy - 4, width: iconW * frac, height: iconH + 8 })));
    svg.append(el('g', { 'clip-path': `url(#${id})` },
      ...draw(pad + whole * iconW + 1, iy, iconW - 2, iconH)));
  }
  return svg;
}

// --- chapter 2: the ionosphere cross-section --------------------------------

const EARTH_R = 6371;

/**
 * A slice through the Earth and sky, transmitter on the left. Heights are
 * exaggerated — at true scale the whole ionosphere would be a hairline over a
 * continent — and the function returns the factor so the caption can say so.
 *
 * `rays` are polylines in [groundKm, altitudeKm], already traced; each segment
 * says whether it is still heard, lost to absorption, or escaping. Drawing does
 * no physics.
 */
export function ionoSvg({
  width, spanKm, iono, rays, landings = [], groundWaveKm = 0, skipKm = null,
  clock, isDay,
}) {
  const m = 16;
  const C = width - 2 * m;
  const PHI = spanKm / EARTH_R;
  const Rs = C / (2 * Math.sin(PHI / 2));
  const TOP_KM = 440;
  const Halt = clamp(width * 0.27, 150, 230);
  const kAlt = Halt / TOP_KM;
  const exaggeration = (kAlt * EARTH_R) / Rs;
  const padT = 30;
  const cx = width / 2, cy = padT + Halt + Rs;
  const ext = m / Rs;
  const sag = Rs * (1 - Math.cos(PHI / 2 + ext));
  const H = Math.ceil(padT + Halt + sag + 48);

  const P = (k, alt) => {
    const phi = k / EARTH_R - PHI / 2;
    const r = Rs + alt * kAlt;
    return [cx + r * Math.sin(phi), cy - r * Math.cos(phi)];
  };
  const kmL = -ext * EARTH_R, kmR = spanKm + ext * EARTH_R;

  const svg = svgRoot(width, H, 'iono', 'Cross-section of the Earth and ionosphere with signal paths');
  const clipId = `lp-clip-${++clipSeq}`;
  svg.append(el('clipPath', { id: clipId }, el('rect', { x: 0, y: 0, width, height: H })));
  const world = el('g', { 'clip-path': `url(#${clipId})` });
  svg.append(world);

  world.append(el('rect', { x: 0, y: 0, width, height: H, class: `sky${isDay ? ' day' : ''}` }));

  const band = (a0, a1) => {
    const [x0, y0] = P(kmL, a1), [x1, y1] = P(kmR, a1);
    const [x2, y2] = P(kmR, a0), [x3, y3] = P(kmL, a0);
    const ra = Rs + a1 * kAlt, rb = Rs + a0 * kAlt;
    return `M${r1(x0)} ${r1(y0)} A${r1(ra)} ${r1(ra)} 0 0 1 ${r1(x1)} ${r1(y1)} `
      + `L${r1(x2)} ${r1(y2)} A${r1(rb)} ${r1(rb)} 0 0 0 ${r1(x3)} ${r1(y3)} Z`;
  };
  const layers = [
    { a0: iono.hF - 70, a1: iono.hF + 45, cls: 'layer-f', name: 'F layer',
      op: 0.08 + 0.42 * Math.min(1, (iono.foF2 / 12) ** 2) },
    { a0: 100, a1: 120, cls: 'layer-e', name: 'E layer',
      op: 0.04 + 0.36 * Math.min(1, (iono.foE / 4) ** 2) },
    { a0: 60, a1: 90, cls: 'layer-d', name: iono.absorptionIndex < 0.1 ? 'D layer — faded' : 'D layer',
      op: 0.03 + 0.5 * Math.min(1, iono.absorptionIndex / 1.1) },
  ];
  for (const L of layers) {
    world.append(el('path', { d: band(L.a0, L.a1), class: `layer ${L.cls}`, 'fill-opacity': L.op.toFixed(3) }));
  }

  // Ground: the Earth itself, then what is heard along it.
  const [gx0, gy0] = P(kmL, 0), [gx1, gy1] = P(kmR, 0);
  world.append(el('path', {
    d: `M${r1(gx0)} ${r1(gy0)} A${r1(Rs)} ${r1(Rs)} 0 0 1 ${r1(gx1)} ${r1(gy1)} L${width} ${H} L0 ${H} Z`,
    class: 'earth',
  }));
  const groundArc = (k0, k1, cls) => {
    const [a, b] = P(k0, 0), [c, d] = P(Math.min(k1, kmR), 0);
    world.append(el('path', {
      d: `M${r1(a)} ${r1(b)} A${r1(Rs)} ${r1(Rs)} 0 0 1 ${r1(c)} ${r1(d)}`, class: cls,
    }));
  };
  if (groundWaveKm > 0) groundArc(0, groundWaveKm, 'zone gw');
  if (skipKm !== null && skipKm > groundWaveKm) {
    groundArc(groundWaveKm, Number.isFinite(skipKm) ? skipKm : kmR, 'zone skip');
    const mid = Number.isFinite(skipKm) ? (groundWaveKm + Math.min(skipKm, spanKm)) / 2 : spanKm * 0.5;
    const [sx, sy] = P(mid, 0);
    const [ex] = P(Math.min(Number.isFinite(skipKm) ? skipKm : spanKm, spanKm), 0);
    if (ex - P(groundWaveKm, 0)[0] > 70) {
      world.append(text(sx, sy + 34, Number.isFinite(skipKm) ? 'skip zone' : 'nothing comes back',
        'lbl zone-lbl', { 'text-anchor': 'middle' }));
    }
  }

  // distance ticks
  const step = spanKm <= 2000 ? 250 : spanKm <= 6000 ? 1000 : 2000;
  for (let k = step; k <= spanKm; k += step) {
    const [x, y] = P(k, 0), [x2, y2] = P(k, -6 / kAlt);
    world.append(el('line', { x1: r1(x), y1: r1(y), x2: r1(x2), y2: r1(y2), class: 'tick' }));
    world.append(text(x, y + 18, k === step ? km(k) : Math.round(k).toLocaleString('en-US'),
      'lbl muted', { 'text-anchor': 'middle' }));
  }

  // rays
  for (const ray of rays) {
    for (const seg of ray.segments) {
      world.append(el('polyline', {
        points: pts(seg.pts.map(([k, a]) => P(k, a))),
        class: `ray ${seg.kind}${ray.fan ? ' fan' : ''}`,
      }));
    }
  }
  for (const l of landings) {
    const [x, y] = P(l.km, 0);
    if (x > width - 4) continue;
    world.append(el('circle', { cx: r1(x), cy: r1(y), r: 5, class: `land ${l.heard ? 'heard' : 'lost'}` }));
    if (l.label) world.append(text(x, y - 10, l.label, 'lbl halo', { 'text-anchor': 'middle' }));
  }

  // Layer names, right-aligned, over everything so rays cannot hide them. The
  // E and D layers are only a few pixels apart on a phone, so each label is
  // pushed down clear of the one above it.
  let prevY = -Infinity;
  for (const L of layers) {
    const [, y] = P(spanKm * 0.985, (L.a0 + L.a1) / 2);
    const ly = Math.max(y + 4, prevY + 14);
    prevY = ly;
    world.append(text(width - m, ly, L.name, 'lbl halo layer-lbl', { 'text-anchor': 'end' }));
  }

  // transmitter
  const [tx, ty] = P(0, 0), [tx2, ty2] = P(0, 20 / kAlt);
  world.append(el('line', { x1: r1(tx), y1: r1(ty), x2: r1(tx2), y2: r1(ty2), class: 'mast' }));
  world.append(el('circle', { cx: r1(tx2), cy: r1(ty2), r: 3, class: 'mast-top' }));
  world.append(text(tx2 + 6, ty2 - 2, 'you', 'lbl halo strong'));

  // clock: sun or moon
  const sx = m + 10, sy = 14;
  world.append(el('circle', { cx: sx, cy: sy, r: 7, class: isDay ? 'sunmark' : 'moonmark' }));
  world.append(text(sx + 14, sy + 4, clock, 'lbl halo'));
  world.append(text(width / 2, 16, 'space', 'lbl muted', { 'text-anchor': 'middle' }));

  return { svg, exaggeration };
}

// --- chapter 3: the usable window through a day -----------------------------

/**
 * MUF and LUF across 24 hours on a log frequency axis, the usable window shaded
 * between them, night shaded behind, and reference lines for the bands.
 */
export function windowSvg({ width, curve, bands, hour, nights, fmin = 1.5, fmax = 40 }) {
  const padL = 36, padR = 46, padT = 20, padB = 28;
  const H = Math.round(clamp(width * 0.46, 260, 340));
  const plotW = width - padL - padR, plotH = H - padT - padB;
  const X = (h) => padL + (h / 24) * plotW;
  const Y = logScale(fmin, fmax, padT + plotH, padT);
  const svg = svgRoot(width, H, 'window', 'Usable frequencies through the day');

  for (const [a, b] of nights) {
    svg.append(el('rect', { x: r1(X(a)), y: padT, width: r1(X(b) - X(a)), height: plotH, class: 'night' }));
    if (X(b) - X(a) > 40) svg.append(text((X(a) + X(b)) / 2, padT + 13, 'night', 'lbl muted', { 'text-anchor': 'middle' }));
  }
  for (const f of [2, 3, 5, 7, 10, 15, 20, 30]) {
    svg.append(el('line', { x1: padL, x2: padL + plotW, y1: r1(Y(f)), y2: r1(Y(f)), class: 'grid' }));
    svg.append(text(padL - 6, Y(f) + 4, `${f}`, 'lbl muted', { 'text-anchor': 'end' }));
  }
  svg.append(text(padL - 6, padT - 7, 'MHz', 'lbl muted', { 'text-anchor': 'end' }));
  for (let h = 0; h <= 24; h += 3) {
    svg.append(el('line', { x1: r1(X(h)), x2: r1(X(h)), y1: padT + plotH, y2: padT + plotH + 4, class: 'tick' }));
    if (plotW < 360 && h % 6) continue;
    svg.append(text(X(h), padT + plotH + 17, `${String(h).padStart(2, '0')}:00`, 'lbl muted',
      { 'text-anchor': h === 0 ? 'start' : h === 24 ? 'end' : 'middle' }));
  }

  const top = curve.map((c) => [X(c.hour), Y(clamp(c.muf, fmin, fmax))]);
  const bottom = curve.map((c) => [X(c.hour),
    Y(clamp(Math.min(Math.max(c.luf, fmin), c.muf), fmin, fmax))]).reverse();
  svg.append(el('polygon', { points: pts([...top, ...bottom]), class: 'usable' }));

  for (const b of bands) {
    const y = Y(b.mhz);
    svg.append(el('line', { x1: padL, x2: padL + plotW, y1: r1(y), y2: r1(y), class: 'bandline' }));
    svg.append(text(padL + plotW + 6, y + 4, b.label, 'lbl'));
  }

  svg.append(el('polyline', { points: pts(top), class: 'muf' }));
  // The LUF is drawn only where it is above the axis floor: clamping it to the
  // floor would draw a line along the bottom that looks like a value.
  let run = [];
  const flush = () => {
    if (run.length > 1) svg.append(el('polyline', { points: pts(run), class: 'luf' }));
    run = [];
  };
  for (const c of curve) {
    if (c.luf >= fmin) run.push([X(c.hour), Y(Math.min(c.luf, fmax))]);
    else flush();
  }
  flush();

  const peakMuf = curve.reduce((a, c) => (c.muf > a.muf ? c : a));
  svg.append(text(X(peakMuf.hour), Y(clamp(peakMuf.muf, fmin, fmax)) - 8, 'MUF', 'lbl halo strong',
    { 'text-anchor': 'middle' }));
  const peakLuf = curve.reduce((a, c) => (c.luf > a.luf ? c : a));
  if (peakLuf.luf > fmin * 1.4) {
    svg.append(text(X(peakLuf.hour), Y(Math.min(peakLuf.luf, fmax)) + 16, 'LUF', 'lbl halo strong',
      { 'text-anchor': 'middle' }));
  }

  const at = curve.reduce((a, c) => (Math.abs(c.hour - hour) < Math.abs(a.hour - hour) ? c : a));
  const hx = X(hour);
  svg.append(el('line', { x1: r1(hx), x2: r1(hx), y1: padT, y2: padT + plotH, class: 'cursor' }));
  svg.append(el('circle', { cx: r1(hx), cy: r1(Y(clamp(at.muf, fmin, fmax))), r: 4.5, class: 'dot muf-dot' }));
  if (at.luf >= fmin) {
    svg.append(el('circle', { cx: r1(hx), cy: r1(Y(Math.min(at.luf, fmax))), r: 4.5, class: 'dot luf-dot' }));
  }

  svg.append(el('rect', { x: padL, y: padT, width: plotW, height: plotH, class: 'hit' }));
  const xToHour = (px) => clamp(((px - padL) / plotW) * 24, 0, 24);
  return { svg, xToHour };
}

// --- chapter 4: antenna height and pattern ----------------------------------

/**
 * Left: the mast, with the wavelength marked beside it so "height in
 * wavelengths" is something you can see. Right: the elevation pattern as a
 * shape — linear field strength, not decibels, because the shape is the lesson
 * and a dB scale flattens it.
 */
export function antennaSvg({ width, cut, peakDbi, heightM, lambdaM, needed = [] }) {
  const H = Math.round(clamp(width * 0.5, 230, 320));
  const gy = H - 30;
  const svg = svgRoot(width, H, 'antenna',
    `Dipole ${heightM.toFixed(1)} m high, ${(heightM / lambdaM).toFixed(2)} wavelengths`);

  // --- mast panel ---
  const mw = Math.max(110, width * 0.26);
  const top = 22;
  const M = Math.max(heightM * 1.3, lambdaM * 0.6);
  const Ym = (m) => gy - (m / M) * (gy - top);
  svg.append(el('line', { x1: 0, x2: width, y1: gy, y2: gy, class: 'gnd' }));
  for (const [f, lab] of [[0.25, '¼ λ'], [0.5, '½ λ'], [1, '1 λ'], [2, '2 λ'], [3, '3 λ']]) {
    const m = f * lambdaM;
    if (m > M) break;
    svg.append(el('line', { x1: 6, x2: mw - 8, y1: r1(Ym(m)), y2: r1(Ym(m)), class: 'lam' }));
    svg.append(text(8, Ym(m) - 4, lab, 'lbl muted'));
  }
  const mx = mw * 0.55;
  svg.append(el('line', { x1: r1(mx), x2: r1(mx), y1: gy, y2: r1(Ym(heightM)), class: 'mast' }));
  const half = Math.min(mw * 0.4, 44);
  svg.append(el('line', {
    x1: r1(mx - half), x2: r1(mx + half), y1: r1(Ym(heightM)), y2: r1(Ym(heightM)), class: 'dipole',
  }));
  svg.append(el('circle', { cx: r1(mx), cy: r1(Ym(heightM)), r: 3.5, class: 'feed' }));
  svg.append(text(mx, Math.max(12, Ym(heightM) - 10), `${heightM.toFixed(1)} m`, 'lbl halo strong',
    { 'text-anchor': 'middle' }));
  svg.append(text(mx, gy + 18, `${(heightM / lambdaM).toFixed(2)} λ up`, 'lbl', { 'text-anchor': 'middle' }));

  // --- pattern panel ---
  const px0 = mw + 10;
  const pw = width - px0 - 6;
  const cx = px0 + pw / 2;
  const R = Math.min(pw / 2 - 34, gy - 40);
  const P = (e, frac, side) => [cx + side * Math.cos(rad(e)) * frac * R, gy - Math.sin(rad(e)) * frac * R];
  for (const frac of [0.5, 1]) {
    svg.append(el('path', {
      d: `M${r1(cx - frac * R)} ${gy} A${r1(frac * R)} ${r1(frac * R)} 0 0 1 ${r1(cx + frac * R)} ${gy}`,
      class: 'ring',
    }));
  }
  for (let e = 0; e <= 90; e += 15) {
    for (const side of [-1, 1]) {
      if (e === 90 && side === -1) continue;
      const [x, y] = P(e, 1, side);
      svg.append(el('line', { x1: r1(cx), y1: gy, x2: r1(x), y2: r1(y), class: 'spoke' }));
    }
    if (e % 30 === 0) {
      const [lx, ly] = P(e, 1.1, 1);
      svg.append(text(lx, ly + (e === 0 ? -5 : 4), `${e}°`, 'lbl muted',
        { 'text-anchor': e === 90 ? 'middle' : 'start' }));
    }
  }
  const n = cut.length;
  const shape = [];
  for (const side of [1, -1]) {
    const order = side === 1 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
    for (const i of order) {
      const e = (i * 90) / (n - 1);
      const frac = cut[i] <= -98 ? 0 : 10 ** ((cut[i] - peakDbi) / 20);
      shape.push(P(e, frac, side));
    }
  }
  svg.append(el('polygon', { points: pts(shape), class: 'lobe' }));

  // The angles the chosen path can use: the best one solid, an alternative
  // hop count (if any) fainter. Labelled on the right-hand side only.
  for (const n of needed) {
    if (!(n.deg >= 0 && n.deg <= 90)) continue;
    for (const side of [-1, 1]) {
      const [x, y] = P(n.deg, 1.02, side);
      svg.append(el('line', { x1: r1(cx), y1: gy, x2: r1(x), y2: r1(y), class: `need${n.main ? '' : ' alt'}` }));
    }
    if (n.label) {
      const [lx, ly] = P(n.deg, 0.72, 1);
      svg.append(text(lx + 6, ly - 4, n.label, 'lbl halo need-lbl'));
    }
  }
  svg.append(el('circle', { cx: r1(cx), cy: gy, r: 3, class: 'feed' }));
  svg.append(text(cx, gy + 18, 'where the energy goes (side view)', 'lbl muted', { 'text-anchor': 'middle' }));
  return svg;
}

// --- chapter 5: the S-meter --------------------------------------------------

/** Where a level sits on a meter face: S0–S9 over 60% of the arc, S9+60 at the end. */
export function meterFraction(dbm, s9 = -73) {
  if (dbm <= s9) return (0.6 * clamp(9 + (dbm - s9) / 6, 0, 9)) / 9;
  return 0.6 + 0.4 * Math.min(1, (dbm - s9) / 60);
}

export function meterSvg({ width, signalDbm, noiseDbm }) {
  const W = Math.min(width, 520);
  const R = W * 0.4;
  const H = Math.round(R + 64);
  const px = W / 2, py = H - 14;
  const ang = (f) => rad(150 - 120 * f);
  const P = (f, r) => [px + r * Math.cos(ang(f)), py - r * Math.sin(ang(f))];
  const arc = (f0, f1, r) => {
    const [a, b] = P(f0, r), [c, d] = P(f1, r);
    return `M${r1(a)} ${r1(b)} A${r1(r)} ${r1(r)} 0 0 1 ${r1(c)} ${r1(d)}`;
  };
  const svg = svgRoot(W, H, 'meter', 'S-meter');
  svg.append(el('path', { d: arc(0, 1, R), class: 'm-track' }));
  const nf = meterFraction(noiseDbm), sf = meterFraction(signalDbm);
  if (nf > 0.005) svg.append(el('path', { d: arc(0, nf, R), class: 'm-noise' }));
  if (sf > nf + 0.01) svg.append(el('path', { d: arc(nf, sf, R - 16), class: 'm-snr' }));

  for (let s = 1; s <= 9; s++) {
    const f = (0.6 * s) / 9;
    const [a, b] = P(f, R + 7), [c, d] = P(f, R + (s % 2 ? 14 : 10));
    svg.append(el('line', { x1: r1(a), y1: r1(b), x2: r1(c), y2: r1(d), class: 'tick' }));
    if (s % 2) {
      const [lx, ly] = P(f, R + 26);
      svg.append(text(lx, ly + 4, `${s}`, 'lbl', { 'text-anchor': 'middle' }));
    }
  }
  for (const over of [20, 40, 60]) {
    const f = 0.6 + (0.4 * over) / 60;
    const [a, b] = P(f, R + 7), [c, d] = P(f, R + 14);
    svg.append(el('line', { x1: r1(a), y1: r1(b), x2: r1(c), y2: r1(d), class: 'tick' }));
    const [lx, ly] = P(f, R + 27);
    svg.append(text(lx, ly + 4, `+${over}`, 'lbl', { 'text-anchor': 'middle' }));
  }
  const [sx, sy] = P(0, R + 26);
  svg.append(text(sx - 12, sy + 4, 'S', 'lbl strong', { 'text-anchor': 'middle' }));
  if (nf > 0.08) {
    const [nx, ny] = P(nf / 2, R - 22);
    svg.append(text(nx, ny + 4, 'noise', 'lbl muted', { 'text-anchor': 'middle' }));
  }

  const [nx, ny] = P(sf, R + 2);
  svg.append(el('line', { x1: r1(px), y1: r1(py), x2: r1(nx), y2: r1(ny), class: 'needle' }));
  svg.append(el('circle', { cx: r1(px), cy: r1(py), r: 6, class: 'pivot' }));
  return svg;
}

// --- chapter 6: the sun, and the aurora -------------------------------------

// Fixed spot positions, so the sun does not reshuffle as the slider moves: a
// new spot appears, the old ones stay where they were. Sunspots live in two
// bands either side of the solar equator, which is where these are put.
const SPOTS = (() => {
  let s = 20260924;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  return Array.from({ length: 36 }, () => ({
    lat: (rnd() < 0.5 ? -1 : 1) * (8 + rnd() * 26),
    lon: -70 + rnd() * 140,
    size: 0.03 + rnd() * 0.05,
  }));
})();

export function sunSvg({ width, spots }) {
  const W = Math.min(width, 240), H = 190;
  const c = W / 2, cy = H / 2 - 6, R = 70;
  const svg = svgRoot(W, H, 'sun', `The sun with ${spots} active regions drawn`);
  svg.append(el('circle', { cx: c, cy, r: R, class: 'sunbody' }));
  for (const sp of SPOTS.slice(0, spots)) {
    const x = c + R * Math.cos(rad(sp.lat)) * Math.sin(rad(sp.lon));
    const y = cy - R * Math.sin(rad(sp.lat));
    svg.append(el('circle', { cx: r1(x), cy: r1(y), r: r1(R * sp.size), class: 'spot' }));
  }
  svg.append(text(c, H - 6, spots ? `${spots} active regions` : 'no active regions', 'lbl muted',
    { 'text-anchor': 'middle' }));
  return svg;
}

/**
 * Looking down on the north pole: latitude rings, the auroral zone at the
 * latitude Kp pushes it to, and two example paths coloured by how they fare.
 */
export function auroraSvg({ width, kp, ovalLatDeg, polarStatus, lowStatus }) {
  const W = Math.min(width, 260), H = 250;
  const c = W / 2, cy = 118, Rg = Math.min(W / 2 - 10, 104);
  const r = (lat) => (Rg * (90 - lat)) / 90;
  const at = (lat, lon) => [c + r(lat) * Math.sin(rad(lon)), cy - r(lat) * Math.cos(rad(lon))];
  const svg = svgRoot(W, H, 'aurora', `Auroral zone reaching about ${Math.round(ovalLatDeg)} degrees latitude`);
  svg.append(el('circle', { cx: c, cy, r: Rg, class: 'globe' }));
  for (const lat of [30, 60]) svg.append(el('circle', { cx: c, cy, r: r(lat), class: 'latring' }));
  const ro = r(ovalLatDeg), ri = r(Math.min(82, ovalLatDeg + 8));
  svg.append(el('path', {
    d: `M${c - ro} ${cy} A${ro} ${ro} 0 1 0 ${c + ro} ${cy} A${ro} ${ro} 0 1 0 ${c - ro} ${cy} Z `
      + `M${c - ri} ${cy} A${ri} ${ri} 0 1 1 ${c + ri} ${cy} A${ri} ${ri} 0 1 1 ${c - ri} ${cy} Z`,
    class: 'oval', 'fill-opacity': (0.2 + 0.06 * kp).toFixed(2), 'fill-rule': 'evenodd',
  }));
  svg.append(el('circle', { cx: c, cy, r: 2.5, class: 'pole' }));

  const [ax, ay] = at(38, 235), [bx, by] = at(38, 55);
  svg.append(el('line', { x1: r1(ax), y1: r1(ay), x2: r1(bx), y2: r1(by), class: `path s-${polarStatus}` }));
  const lowPts = [];
  for (let lon = 95; lon <= 165; lon += 5) lowPts.push(at(14, lon));
  svg.append(el('polyline', { points: pts(lowPts), class: `path s-${lowStatus}` }));
  for (const [x, y] of [[ax, ay], [bx, by], lowPts[0], lowPts.at(-1)]) {
    svg.append(el('circle', { cx: r1(x), cy: r1(y), r: 3.5, class: 'end' }));
  }
  svg.append(text(bx + 4, by - 8, 'polar', 'lbl halo'));
  const [lx, ly] = lowPts[Math.floor(lowPts.length / 2)];
  svg.append(text(lx + 6, ly + 14, 'low latitude', 'lbl halo'));
  svg.append(text(c, H - 26, `aurora zone reaches ~${Math.round(ovalLatDeg)}°`, 'lbl', { 'text-anchor': 'middle' }));
  svg.append(text(c, H - 8, 'north pole at the centre; equator at the rim', 'lbl muted', { 'text-anchor': 'middle' }));
  return svg;
}
