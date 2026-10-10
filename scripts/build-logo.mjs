#!/usr/bin/env node
/**
 * MAFIA WARS : Dadou vs Even — générateur des assets de marque.
 *
 *   node scripts/build-logo.mjs        (ou : npm run logo)
 *
 * Everything is built from code, so the output is fully reproducible:
 *   1. OFL fonts (Cinzel Decorative, Cinzel — @fontsource packages) are parsed with opentype.js and
 *      every piece of text is converted to SVG path outlines → the SVGs need no font.
 *   2. Illustrations (revolvers, 1888 London skyline, ribbons, medallions, crown, anchor,
 *      fog…) are hand-written vector shapes composed as SVG strings.
 *   3. PNGs (transparent where relevant) are rendered with @resvg/resvg-js; the menu
 *      backdrop is also encoded to JPEG by a tiny baseline encoder at the end of the file.
 *
 * Outputs: public/brand/* , public/favicon.svg, public/favicon-{16,32}.png,
 *          public/apple-touch-icon.png  (see public/brand/README.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

// ════════════════════════════════════════════════════════════════════════════
// 0. Paths & palette
// ════════════════════════════════════════════════════════════════════════════
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_BRAND = path.join(ROOT, 'public', 'brand');
const OUT_PUBLIC = path.join(ROOT, 'public');
const FONT_DIR = path.join(ROOT, 'node_modules', '@fontsource');

/** Brand colours. Faction colours are the official ones from the game design. */
export const PALETTE = {
  ink: '#0d0906', // warm near-black used for outlines (Dadou side, gold)
  inkCool: '#070b12', // cool near-black (Even side, silver)
  dadou: { crimson: '#9e1b22', deep: '#5c0d12', black: '#120607', gold: '#d4a640' },
  even: { navy: '#1d3461', deep: '#0f1c38', black: '#05080f', silver: '#c9d1dc' },
};
const { dadou: DAD, even: EVE } = PALETTE;

/** Metal gradients, as [offset, colour] stops (top → bottom). */
const METAL = {
  // polished Victorian brass / gilt: pale highlight, warm body, dark "horizon" band, reflection
  goldFace: [[0, '#fff6d6'], [0.13, '#f9df9a'], [0.33, '#e4b252'], [0.49, '#a8701f'], [0.525, '#7c4a12'], [0.555, '#b27a28'], [0.75, '#ecbf60'], [0.9, '#d29c3e'], [1, '#8c5a1a']],
  goldRim: [[0, '#5a3a10'], [0.45, '#c8963c'], [0.55, '#f6dc94'], [1, '#6e4814']],
  goldFlat: [[0, '#f9e2a0'], [0.45, DAD.gold], [1, '#8d6020']],
  silverFace: [[0, '#ffffff'], [0.14, '#eef2f7'], [0.34, '#c4cdd8'], [0.5, '#7d8a9c'], [0.535, '#5f6b7c'], [0.56, '#909cad'], [0.76, '#e3e8ef'], [0.9, '#b8c1cd'], [1, '#6c7788']],
  silverRim: [[0, '#2c3440'], [0.45, '#9aa5b4'], [0.55, '#eef2f7'], [1, '#3b4554']],
  silverFlat: [[0, '#f4f7fa'], [0.45, EVE.silver], [1, '#5d6878']],
  // faction enamels (ribbon halves, medallion fields, icon tints)
  crimson: [[0, '#c4323a'], [0.45, DAD.crimson], [1, DAD.deep]],
  navy: [[0, '#34558f'], [0.45, EVE.navy], [1, EVE.deep]],
  crimsonRibbon: [[0, '#c9343c'], [0.18, '#a8212a'], [0.6, '#86141b'], [1, DAD.deep]],
  navyRibbon: [[0, '#3c5f9e'], [0.18, '#233f75'], [0.6, '#1a2f5a'], [1, EVE.deep]],
};

// ════════════════════════════════════════════════════════════════════════════
// 1. Small utilities: numbers, seeded RNG, affine matrices, path data
// ════════════════════════════════════════════════════════════════════════════
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

/** Deterministic PRNG (mulberry32) so procedural details are identical on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D affine matrix [a, b, c, d, e, f] (SVG convention). */
const Mx = {
  id: () => [1, 0, 0, 1, 0, 0],
  mul: (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ],
  t: (x, y) => [1, 0, 0, 1, x, y],
  r: (deg) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [c, s, -s, c, 0, 0]; },
  /** compose left-to-right as written in an SVG transform attribute */
  chain: (...ms) => ms.reduce((acc, m) => Mx.mul(acc, m), Mx.id()),
  apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
};

/** Transform opentype-style path commands with a matrix. */
function xform(cmds, m) {
  return cmds.map((c) => {
    const o = { type: c.type };
    if (c.x !== undefined) [o.x, o.y] = Mx.apply(m, c.x, c.y);
    if (c.x1 !== undefined) [o.x1, o.y1] = Mx.apply(m, c.x1, c.y1);
    if (c.x2 !== undefined) [o.x2, o.y2] = Mx.apply(m, c.x2, c.y2);
    return o;
  });
}

/** Commands → compact SVG path data. */
function toD(cmds, p = 2) {
  const f = p === 1 ? r1 : r2;
  let d = '';
  for (const c of cmds) {
    if (c.type === 'M' || c.type === 'L') d += `${c.type}${f(c.x)} ${f(c.y)}`;
    else if (c.type === 'C') d += `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
    else if (c.type === 'Q') d += `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
    else if (c.type === 'Z') d += 'Z';
  }
  return d;
}

/** Exact bounding box of commands (uses opentype's curve-aware implementation). */
function bboxOf(cmds) {
  const p = new opentype.Path();
  p.commands = cmds;
  const b = p.getBoundingBox();
  return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, w: b.x2 - b.x1, h: b.y2 - b.y1, cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2 };
}

// Primitive shape → path-data helpers (absolute coordinates).
const rectD = (x, y, w, h) => `M${r2(x)} ${r2(y)}h${r2(w)}v${r2(h)}h${r2(-w)}Z`;
const polyD = (pts) => 'M' + pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L') + 'Z';
const circleD = (cx, cy, r) => `M${r2(cx - r)} ${r2(cy)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`;
const ellipseD = (cx, cy, rx, ry) => `M${r2(cx - rx)} ${r2(cy)}a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(2 * rx)} 0a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(-2 * rx)} 0Z`;

/**
 * Parse a simple absolute path string (M L H V C Q Z, absolute only) into commands so that
 * hand-drawn shapes can be transformed like glyphs.
 */
function parseD(d) {
  const tokens = d.match(/[MLHVCQZmlhvcqz]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const cmds = [];
  let i = 0, cmd = 'M', x = 0, y = 0;
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': x = num(); y = num(); cmds.push({ type: 'M', x, y }); cmd = 'L'; break;
      case 'L': x = num(); y = num(); cmds.push({ type: 'L', x, y }); break;
      case 'H': x = num(); cmds.push({ type: 'L', x, y }); break;
      case 'V': y = num(); cmds.push({ type: 'L', x, y }); break;
      case 'C': { const x1 = num(), y1 = num(), x2 = num(), y2 = num(); x = num(); y = num(); cmds.push({ type: 'C', x1, y1, x2, y2, x, y }); break; }
      case 'Q': { const x1 = num(), y1 = num(); x = num(); y = num(); cmds.push({ type: 'Q', x1, y1, x, y }); break; }
      case 'Z': case 'z': cmds.push({ type: 'Z' }); break;
      default: throw new Error(`parseD: unsupported command ${cmd}`);
    }
  }
  return cmds;
}

/** Sample a polyline of points along cubic Bézier segments [[p0,c1,c2,p1], ...]. */
function sampleBeziers(segs, n = 24) {
  const pts = [];
  segs.forEach(([p0, c1, c2, p1], si) => {
    for (let k = si === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
      ]);
    }
  });
  return pts;
}

/**
 * Calligraphic "engraved" stroke: a filled outline around a polyline whose width follows
 * widthFn(t) (t ∈ [0,1] along the stroke). Used for flourishes, smoke and scrollwork.
 */
function taperedStroke(pts, widthFn) {
  const n = pts.length;
  const L = [], R = [];
  let total = 0;
  const acc = [0];
  for (let i = 1; i < n; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); acc.push(total); }
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widthFn(total ? acc[i] / total : 0) / 2;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  return polyD([...L, ...R.reverse()]);
}

/** Logarithmic spiral points, used for the curls at the end of Victorian scrolls. */
function spiralPts(cx, cy, r0, a0, turns, decay, dir = 1, n = 60) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + dir * t * turns * 2 * Math.PI;
    const r = r0 * Math.exp(-decay * t * turns * 2 * Math.PI);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Fonts & text → outlines
// ════════════════════════════════════════════════════════════════════════════
function loadFont(rel) {
  const buf = fs.readFileSync(path.join(FONT_DIR, rel));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const FONTS = {
  // Cinzel Decorative Black: UPPERCASE = swash capitals, lowercase = plain capitals (same height)
  deco: loadFont('cinzel-decorative/files/cinzel-decorative-latin-900-normal.woff'),
  // Cinzel Black: faction names, ring lettering
  cinzel: loadFont('cinzel/files/cinzel-latin-900-normal.woff'),
};

/**
 * Lay out a line of text and return its outline commands at the origin (baseline y=0).
 * @param tracking  extra letter spacing in em
 * @param kern      manual kerning tweaks: { glyphIndex: em } added after that glyph
 */
function setText(font, text, { size, tracking = 0, kern = {} } = {}) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const kTables = font.position.getKerningTables(font.position.getDefaultScriptName());
  let x = 0;
  const cmds = [];
  const placed = [];
  glyphs.forEach((g, i) => {
    const gp = g.getPath(x, 0, size);
    cmds.push(...gp.commands);
    placed.push({ x, adv: g.advanceWidth * scale, cmds: gp.commands });
    x += g.advanceWidth * scale;
    if (i < glyphs.length - 1) {
      const kv = kTables ? font.position.getKerningValue(kTables, g.index, glyphs[i + 1].index) : font.getKerningValue(g, glyphs[i + 1]);
      x += kv * scale + tracking * size + (kern[i] || 0) * size;
    }
  });
  return { cmds, advance: x, glyphs: placed, size };
}

/**
 * Position laid-out text. align: 'start' | 'center' | 'end'; by: 'advance' (typographic)
 * or 'ink' (visual bounding box — better for swash capitals).
 */
function placeText(t, x, y, { align = 'center', by = 'ink' } = {}) {
  const bb = bboxOf(t.cmds);
  const left = by === 'ink' ? bb.x1 : 0;
  const width = by === 'ink' ? bb.w : t.advance;
  const dx = align === 'center' ? x - left - width / 2 : align === 'end' ? x - left - width : x - left;
  return xform(t.cmds, Mx.t(dx, y));
}

/**
 * Text set on a circular arc. Glyphs are rotated individually.
 * top=true: reads clockwise along the top (letters upright, baseline on the circle of radius r)
 * top=false: reads left→right along the bottom (letters upright, cap-line towards the centre)
 */
function arcText(font, text, { size, tracking = 0, cx, cy, r, centerAngle = -90, top = true }) {
  const t = setText(font, text, { size, tracking });
  const total = t.advance;
  const out = [];
  for (const g of t.glyphs) {
    const mid = g.x + g.adv / 2 - total / 2; // arc-length offset of the glyph centre
    const ang = centerAngle + (top ? 1 : -1) * (mid / r) / DEG;
    const rad = ang * DEG;
    const px = cx + Math.cos(rad) * r, py = cy + Math.sin(rad) * r;
    const rot = top ? ang + 90 : ang - 90;
    // move glyph so its horizontal centre is at x=0 on the baseline, then rotate & place
    const m = Mx.chain(Mx.t(px, py), Mx.r(rot), Mx.t(-(g.x + g.adv / 2), 0));
    out.push(...xform(g.cmds, m));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. SVG document builder (defs, gradients, filters, unique ids)
// ════════════════════════════════════════════════════════════════════════════
class Svg {
  constructor(prefix, w, h) {
    this.prefix = prefix;
    this.w = w;
    this.h = h;
    this.defs = [];
    this.n = 0;
  }
  id(name = 'x') { return `${this.prefix}-${name}${++this.n}`; }
  def(s) { this.defs.push(s); }

  /** Linear gradient; returns `url(#id)`. Coordinates default to objectBoundingBox top→bottom. */
  /** Gradient stops; [offset, colour] or [offset, colour, opacity]. */
  static stops(stops) {
    return stops.map(([o, c, a]) => `<stop offset="${r2(o)}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${r2(a)}"` : ''}/>`).join('');
  }

  /** Linear gradient; returns `url(#id)`. Default: objectBoundingBox, top → bottom. */
  linear(stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false, name = 'lg' } = {}) {
    const id = this.id(name);
    this.def(`<linearGradient id="${id}" x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${Svg.stops(stops)}</linearGradient>`);
    return `url(#${id})`;
  }

  /** Radial gradient (objectBoundingBox); returns `url(#id)`. */
  radial(stops, { cx = 0.5, cy = 0.5, r = 0.5, fx, fy, name = 'rg' } = {}) {
    const id = this.id(name);
    this.def(`<radialGradient id="${id}" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}"${fx !== undefined ? ` fx="${r2(fx)}" fy="${r2(fy)}"` : ''}>${Svg.stops(stops)}</radialGradient>`);
    return `url(#${id})`;
  }

  /** Gaussian blur filter (cached per std/region); region = user-space [x, y, w, h]. */
  blur(std, region = null) {
    this.blurs ??= new Map();
    const key = `${r2(std)}|${region || ''}`;
    if (!this.blurs.has(key)) {
      const id = this.id('blur');
      const reg = region ? ` filterUnits="userSpaceOnUse" x="${region[0]}" y="${region[1]}" width="${region[2]}" height="${region[3]}"` : ' x="-50%" y="-50%" width="200%" height="200%"';
      this.def(`<filter id="${id}"${reg} color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${r2(std)}"/></filter>`);
      this.blurs.set(key, `url(#${id})`);
    }
    return this.blurs.get(key);
  }

  /** Register a path in <defs> and return its id (for <use>, masks and clips). */
  path(d, name = 'p') {
    const id = this.id(name);
    this.def(`<path id="${id}" d="${d}"/>`);
    return id;
  }

  render(body, { title = 'MAFIA WARS : Dadou vs Even', desc = '' } = {}) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}" role="img">` +
      `<title>${title}</title>${desc ? `<desc>${desc}</desc>` : ''}` +
      `<defs>${this.defs.join('')}</defs>${body}</svg>`;
  }
}

const use = (id, attrs = '') => `<use xlink:href="#${id}" ${attrs}/>`;

// ════════════════════════════════════════════════════════════════════════════
// 4. Effects: embossed metal lettering
// ════════════════════════════════════════════════════════════════════════════
/**
 * Struck-metal lettering: soft drop shadow → thick dark outline (reads on light backgrounds)
 * → metallic rim → thin dark line → gradient face → top bevel highlight + bottom bevel shade
 * (built with masks: glyph minus a shifted copy of itself).
 * `top`/`bottom` are the y-coordinates the face gradient spans (cap line → baseline).
 */
function metalText(doc, cmds, o) {
  const {
    top, bottom, metal = 'gold', outline = 14, rim = 7, inner = 1.6, shadow = { dx: 0, dy: 10, blur: 9, opacity: 0.55 },
    bevel = 0.022, face = null,
  } = o;
  const ink = metal === 'gold' ? PALETTE.ink : PALETTE.inkCool;
  const d = toD(cmds);
  const id = doc.path(d, 'txt');
  const bb = bboxOf(cmds);
  const h = bottom - top;
  const faceStops = face || (metal === 'gold' ? METAL.goldFace : METAL.silverFace);
  const rimSt = metal === 'gold' ? METAL.goldRim : METAL.silverRim;
  const faceFill = doc.linear(faceStops, { x1: 0, y1: top, x2: 0, y2: bottom, user: true, name: 'face' });
  const rimFill = doc.linear(rimSt, { x1: 0, y1: top - outline, x2: 0, y2: bottom + outline, user: true, name: 'rim' });
  const pad = outline * 3 + 40;
  const region = [r1(bb.x1 - pad), r1(bb.y1 - pad), r1(bb.w + 2 * pad), r1(bb.h + 2 * pad)];
  const k = Math.max(1.2, h * bevel); // bevel depth
  const hiMask = doc.id('hi');
  const loMask = doc.id('lo');
  doc.def(`<mask id="${hiMask}" maskUnits="userSpaceOnUse" x="${region[0]}" y="${region[1]}" width="${region[2]}" height="${region[3]}">${use(id, 'fill="#fff"')}${use(id, `fill="#000" transform="translate(${r2(k * 0.35)},${r2(k)})"`)}</mask>`);
  doc.def(`<mask id="${loMask}" maskUnits="userSpaceOnUse" x="${region[0]}" y="${region[1]}" width="${region[2]}" height="${region[3]}">${use(id, 'fill="#fff"')}${use(id, `fill="#000" transform="translate(${r2(-k * 0.25)},${r2(-k * 0.9)})"`)}</mask>`);
  const hiCol = metal === 'gold' ? '#fffbe8' : '#ffffff';
  const loCol = metal === 'gold' ? '#4a2c08' : '#1d2532';
  let s = '<g>';
  if (shadow) s += use(id, `fill="#000" stroke="#000" stroke-width="${outline}" stroke-linejoin="round" opacity="${shadow.opacity}" transform="translate(${shadow.dx},${shadow.dy})" filter="${doc.blur(shadow.blur, region)}"`);
  s += use(id, `fill="${ink}" stroke="${ink}" stroke-width="${outline}" stroke-linejoin="round"`);
  if (rim) s += use(id, `fill="none" stroke="${rimFill}" stroke-width="${rim}" stroke-linejoin="round"`);
  if (inner) s += use(id, `fill="none" stroke="${ink}" stroke-width="${inner}" stroke-linejoin="round" opacity=".85"`);
  s += use(id, `fill="${faceFill}"`);
  s += use(id, `fill="${hiCol}" mask="url(#${hiMask})" opacity=".85"`);
  s += use(id, `fill="${loCol}" mask="url(#${loMask})" opacity=".55"`);
  s += '</g>';
  return s;
}

/**
 * Wispy fog band: fractal noise shaped by a blurred ellipse, so edges look like drifting
 * London "pea-souper" rather than a flat smear. Works in resvg and in browsers.
 * color = RGB in 0..1; contrast/cut shape how patchy the noise is.
 */
function fogBand(doc, { cx, cy, rx, ry, opacity = 0.6, color = [0.9, 0.92, 0.95], freq = [0.0032, 0.016], seed = 4, soft = 18, contrast = 1.7, cut = 0.6 }) {
  const id = doc.id('fogf');
  const x = cx - rx - soft * 3, y = cy - ry - soft * 3, w = 2 * (rx + soft * 3), h = 2 * (ry + soft * 3);
  doc.def(`<filter id="${id}" filterUnits="userSpaceOnUse" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq[0]} ${freq[1]}" numOctaves="4" seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 ${color[0]}  0 0 0 0 ${color[1]}  0 0 0 0 ${color[2]}  0 0 0 ${contrast} ${-cut}" result="c"/>` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${soft}" result="b"/>` +
    `<feComposite in="c" in2="b" operator="in"/></filter>`);
  return `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="#fff" opacity="${opacity}" filter="url(#${id})"/>`;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Illustration components
// ════════════════════════════════════════════════════════════════════════════

// ── 5a. Victorian revolver (Webley-style top-break, bird's-head grip, lanyard ring) ──
// Local coordinates: muzzle points to +x, bore axis at y≈47, size ≈ 292 × 160.
const REVOLVER_PARTS = {
  hammer: 'M93 44 L92 29 C91.4 24.5 89 21 84.5 19.6 L71 16 C67 15.2 64.4 16.6 64.8 19.2 C65.2 21.4 67.6 22.6 71 23.6 L77.5 25.8 C81 27.2 82.6 30 83.2 34 L84.6 46 Z',
  guard: 'M132 80 C136 98 126 112 110 112 C98 112 92 104 95 92 L102 91 C100 100 104 105 111 105 C121 105 127 96 125 82 Z',
  trigger: 'M118 82 C120 92 116 100 108 102 C111 96 112 90 110 82 Z',
  latch: 'M87 31 L89 23.5 C89.5 22 91 21.5 92.5 21.5 L99 21.5 C100.5 21.5 101.5 22.5 102 24 L104 31 Z',
  body: 'M86 28 L146 28 L150 32 L152 68 C152 76 146 82 138 82 L128 82 L106 84 C101 85 99 88 98 90 C92 100 86 112 84 124 C83 130 82 136 78 140 C74 145 66 147 60 145 C52 142 48 134 50 124 C48 104 66 46 84 34 Z',
  grip: 'M93 93 C88 104 83 116 80 127 C79 133 76 137 70 138.5 C64 140 58 138.5 56 134 C54 128 56 117 59 106 C62 95 66 84 72 73 C78 75 86 82 93 93 Z',
  lug: 'M158 55.5 L236 55.5 C241 55.5 244 58.5 244 61 C244 63.5 241 66.5 236 66.5 L158 66.5 Z',
  barrel: 'M148 37.5 L290 39 L290 55 L148 56.5 Z',
  shank: 'M144 33 L162 33 L162 60 L144 62 Z',
  rib: 'M146 34.5 L288 36.5 L288 39 L146 37.5 Z',
  muzzle: 'M284 37.5 L291 38 L291 56 L284 56.5 Z',
  sight: 'M278 37 L280 31 Q283 29.5 286 31 L287 37 Z',
  cylinder: 'M101 31 L137 31 Q144 31 144.5 38 L144.5 66 Q144 73 137 73 L101 73 Q94 73 93.5 66 L93.5 38 Q94 31 101 31 Z',
  flutes: 'M104 49 L134 49 Q137 52.5 134 56 L104 56 Q101 52.5 104 49 Z M106 37 L132 37 Q134 39 132 41 L106 41 Q104 39 106 37 Z M106 64 L132 64 Q134 66 132 68 L106 68 Q104 66 106 64 Z',
};

/**
 * Revolver as an SVG group in local coordinates. finish: 'gold' (Dadou) | 'silver' (Even).
 * `line` is the outline width in local units.
 */
function revolver(doc, { finish = 'gold', line = 1.7, detail = true, flip = false } = {}) {
  const g = finish === 'gold';
  const ink = g ? '#120b05' : '#070a10';
  const dir = flip ? { y1: 1, y2: 0 } : { y1: 0, y2: 1 };
  const main = doc.linear(g ? [[0, '#fff3c8'], [0.3, '#ebc568'], [0.62, '#b4822e'], [1, '#5e3c10']] : [[0, '#ffffff'], [0.3, '#d6dde6'], [0.62, '#8e9aab'], [1, '#3e4858']], { name: 'gm', ...dir });
  const dark = doc.linear(g ? [[0, '#e9c46c'], [1, '#6e4914']] : [[0, '#c8d0db'], [1, '#4a5466']], { name: 'gd', ...dir });
  const wood = doc.linear(g ? [[0, '#6a2a1c'], [1, '#2a0c08']] : [[0, '#2a3346'], [1, '#0c111c']], { x1: 0, y1: 0, x2: 1, y2: 1, name: 'gw' });
  const hatch = doc.id('hatch');
  doc.def(`<pattern id="${hatch}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><path d="M0 0L4 4M4 0L0 4" stroke="#000" stroke-width=".55" opacity=".7"/></pattern>`);
  const fills = {
    hammer: dark, guard: dark, trigger: dark, latch: dark, body: main, grip: wood, lug: dark,
    barrel: main, shank: main, rib: g ? '#fbe7a8' : '#f4f7fa', muzzle: dark, sight: dark, cylinder: main, flutes: g ? '#4a2e0a' : '#262e3a',
  };
  let s = '<g>';
  for (const k of ['hammer', 'guard', 'trigger', 'body', 'grip', 'latch', 'lug', 'barrel', 'shank', 'rib', 'muzzle', 'sight', 'cylinder', 'flutes']) {
    s += `<path d="${REVOLVER_PARTS[k]}" fill="${fills[k]}" stroke="${ink}" stroke-width="${line}" stroke-linejoin="round"/>`;
  }
  if (detail) {
    s += `<path d="${REVOLVER_PARTS.grip}" fill="url(#${hatch})" opacity=".55"/>`;
    // highlights: barrel glint, cylinder glint, frame engraving
    s += `<path d="M164 41.5 L282 42.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`;
    s += `<path d="M100 35.5 L138 35.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>`;
    s += `<path d="M62 120 C60 100 70 70 84 44" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".35"/>`;
    s += `<path d="M106 76 C112 70 120 80 128 74 M60 108 C66 102 62 96 70 92" stroke="${ink}" stroke-width=".8" fill="none" opacity=".45"/>`;
    // hinge screw, grip screw, lanyard ring
    s += `<circle cx="146" cy="72" r="3.3" fill="${dark}" stroke="${ink}" stroke-width="1.1"/>`;
    s += `<circle cx="70" cy="112" r="2.6" fill="${main}" stroke="${ink}" stroke-width="1"/>`;
  }
  s += `<circle cx="62" cy="150.5" r="4.6" fill="none" stroke="${ink}" stroke-width="3"/><circle cx="62" cy="150.5" r="4.6" fill="none" stroke="${g ? '#e2b85c' : '#c9d1dc'}" stroke-width="1.2"/>`;
  s += '</g>';
  return s;
}

/** Path data of the revolver silhouette (all parts), useful for shadows/outlines. */
const REVOLVER_SILHOUETTE = ['hammer', 'guard', 'body', 'latch', 'lug', 'barrel', 'shank', 'muzzle', 'sight', 'cylinder'].map((k) => REVOLVER_PARTS[k]).join(' ');

/**
 * Two crossed revolvers (gold = Dadou, lower-left grip; silver = Even, lower-right grip),
 * crossing at (cx, cy). angle = elevation of the barrels in degrees, s = scale.
 * cross = local x on the barrel where they cross.
 */
function crossedRevolvers(doc, { cx, cy, s = 1, angle = 48, cross = 200, shadow = true, flip = true }) {
  const axisY = 47;
  // flip: each gun is mirrored across its bore axis so that, once rotated, the grip points
  // outwards (classic "crossed pistols" insignia) instead of towards the other gun.
  const place = (mirror) => `translate(${r2(cx)},${r2(cy)}) ${mirror ? 'scale(-1,1) ' : ''}rotate(${-angle}) scale(${s}) ` + (flip ? `translate(${-cross},${axisY}) scale(1,-1)` : `translate(${-cross},${-axisY})`);
  let out = '';
  if (shadow) {
    const sh = (mirror) => `<g transform="translate(4,9)"><g transform="${place(mirror)}"><path d="${REVOLVER_SILHOUETTE}" fill="#000"/></g></g>`;
    out += `<g opacity=".45" filter="${doc.blur(6 * s)}">${sh(false)}${sh(true)}</g>`;
  }
  out += `<g transform="${place(true)}">${revolver(doc, { finish: 'silver', flip })}</g>`;
  out += `<g transform="${place(false)}">${revolver(doc, { finish: 'gold', flip })}</g>`;
  return out;
}

/**
 * Split ribbon banner: crimson (Dadou, gold trim) on the left, navy (Even, silver trim) on
 * the right, with folded swallow-tail ends. Returns markup; the centre joint is meant to be
 * covered by the VS medallion.
 */
function splitBanner(doc, { cx, cy, half, h, tail = 150, drop = 26, fold = 34, notch = 34, line = 3 }) {
  const top = cy - h / 2, bot = cy + h / 2;
  const ink = PALETTE.ink;
  const sides = [
    { sgn: -1, face: METAL.crimsonRibbon, back: [[0, '#6e1016'], [1, '#2e0507']], trim: doc.linear(METAL.goldFlat, { name: 'trg' }) },
    { sgn: 1, face: METAL.navyRibbon, back: [[0, '#16284d'], [1, '#060c1c']], trim: doc.linear(METAL.silverFlat, { name: 'trs' }) },
  ];
  let s = '';
  // soft shadow of the whole ribbon
  s += `<path d="${polyD([[cx - half - tail, top + drop + 10], [cx + half + tail, top + drop + 10], [cx + half + tail, bot + drop + 12], [cx - half - tail, bot + drop + 12]])}" fill="#000" opacity=".35" filter="${doc.blur(10)}"/>`;
  for (const sd of sides) {
    const e = cx + sd.sgn * half; // end of main band
    const tIn = e - sd.sgn * fold, tOut = e + sd.sgn * tail;
    const tailD = polyD([[tIn, top + drop], [tOut, top + drop], [tOut - sd.sgn * notch, cy + drop], [tOut, bot + drop], [tIn, bot + drop]]);
    const backFill = doc.linear(sd.back, { name: 'rb' });
    s += `<path d="${tailD}" fill="${backFill}" stroke="${ink}" stroke-width="${line}" stroke-linejoin="round"/>`;
    // trim lines on the tail
    s += `<path d="M${r2(tIn)} ${r2(top + drop + 9)}H${r2(tOut - sd.sgn * 6)}M${r2(tIn)} ${r2(bot + drop - 9)}H${r2(tOut - sd.sgn * 6)}" stroke="${sd.trim}" stroke-width="2" opacity=".75"/>`;
    // fold (back face of the ribbon turning behind)
    s += `<path d="${polyD([[e, bot], [tIn, bot + drop], [tIn, bot]])}" fill="#000" stroke="${ink}" stroke-width="${line}" stroke-linejoin="round"/>`;
    // main band half
    const x0 = Math.min(cx, e), w = Math.abs(e - cx);
    s += `<rect x="${r2(x0)}" y="${r2(top)}" width="${r2(w)}" height="${r2(h)}" fill="${doc.linear(sd.face, { name: 'rf' })}"/>`;
    s += `<path d="M${r2(cx)} ${r2(top + 9)}H${r2(e - sd.sgn * 2)}M${r2(cx)} ${r2(bot - 9)}H${r2(e - sd.sgn * 2)}" stroke="${sd.trim}" stroke-width="3"/>`;
    s += `<path d="M${r2(cx)} ${r2(top + 4)}H${r2(e)}" stroke="#fff" stroke-width="1.5" opacity=".18"/>`;
  }
  s += `<rect x="${r2(cx - half)}" y="${r2(top)}" width="${r2(2 * half)}" height="${r2(h)}" fill="none" stroke="${ink}" stroke-width="${line}" stroke-linejoin="round"/>`;
  return s;
}

/** "VS" medallion: brass ring, crimson | navy split field, gold VS. */
function vsMedallion(doc, { cx, cy, r }) {
  let s = '';
  s += `<circle cx="${cx}" cy="${cy + r * 0.1}" r="${r * 1.04}" fill="#000" opacity=".5" filter="${doc.blur(r * 0.08)}"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE.ink}"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.9}" fill="none" stroke="${doc.linear(METAL.goldRim, { name: 'mring' })}" stroke-width="${r * 0.13}"/>`;
  const clip = doc.id('mclip');
  doc.def(`<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r * 0.8}"/></clipPath>`);
  s += `<g clip-path="url(#${clip})">`;
  s += `<rect x="${cx - r}" y="${cy - r}" width="${r}" height="${2 * r}" fill="${doc.linear(METAL.crimson, { name: 'mcr' })}"/>`;
  s += `<rect x="${cx}" y="${cy - r}" width="${r}" height="${2 * r}" fill="${doc.linear(METAL.navy, { name: 'mnv' })}"/>`;
  s += `<circle cx="${cx}" cy="${cy - r * 0.35}" r="${r * 0.9}" fill="${doc.radial([[0, '#fff', 0.18], [1, '#fff', 0]])}"/>`;
  s += `</g>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.8}" fill="none" stroke="${PALETTE.ink}" stroke-width="${r * 0.04}"/>`;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 2 * Math.PI;
    s += `<circle cx="${r2(cx + Math.cos(a) * r * 0.9)}" cy="${r2(cy + Math.sin(a) * r * 0.9)}" r="${r2(r * 0.028)}" fill="#fff4cc" opacity=".8"/>`;
  }
  const vs = placeText(setText(FONTS.deco, 'vs', { size: r * 0.95, tracking: 0.02 }), cx, cy + r * 0.34);
  s += metalText(doc, vs, { top: cy - r * 0.34, bottom: cy + r * 0.34, metal: 'gold', outline: r * 0.09, rim: r * 0.045, shadow: { dx: 0, dy: r * 0.05, blur: r * 0.05, opacity: 0.6 } });
  return s;
}

// ── 5b. London skyline, 1888 (Clock Tower, Palace of Westminster, St Paul's, terraces) ──
// All builders take (x0 = centre or left, y0 = ground line, s = scale) and return path data.
// Up is negative y. Shapes are simply overlapped: one fill colour makes them a silhouette.

function clockTower(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  const P = (...pts) => polyD(pts.map(([x, y]) => [x0 + x * s, y0 + y * s]));
  let d = '';
  d += R(-20, -212, 40, 212); // shaft
  d += R(-22, -216, 44, 6); // string course
  d += R(-24, -270, 48, 56); // clock stage
  d += R(-26.5, -277, 53, 8); // cornice
  d += P([-17, -277], [0, -293], [17, -277]); // gablet over the dial
  d += P([-26.5, -277], [-24, -300], [-21.5, -277]) + P([21.5, -277], [24, -300], [26.5, -277]); // pinnacles
  d += R(-20, -313, 40, 37); // belfry
  d += R(-22.5, -319, 45, 7); // belfry cornice
  d += P([-22.5, -319], [-20.2, -342], [-18, -319]) + P([18, -319], [20.2, -342], [22.5, -319]);
  d += P([-19.5, -319], [-9.5, -364], [9.5, -364], [19.5, -319]); // iron spire roof
  d += R(-10, -380, 20, 17); // lantern (Ayrton light)
  d += R(-11.5, -384, 23, 5);
  d += P([-9.5, -384], [0, -418], [9.5, -384]); // upper spire
  d += R(-1.1, -436, 2.2, 20) + circleD(x0, y0 - 437.5 * s, 2.6 * s); // finial
  return d;
}
/** Window/opening details of the Clock Tower (drawn in a lighter tone over the silhouette). */
function clockTowerDetails(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  let d = '';
  for (const x of [-13, -3, 7]) d += R(x, -309, 6, 24); // belfry arches
  for (const yy of [-60, -100, -140, -180]) for (const x of [-12, 4]) d += R(x, yy, 8, 22);
  d += R(-5, -376, 4, 10) + R(1, -376, 4, 10);
  return d;
}

function victoriaTower(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  const P = (...pts) => polyD(pts.map(([x, y]) => [x0 + x * s, y0 + y * s]));
  let d = R(-29, -250, 58, 250);
  for (const x of [-34, 24]) {
    d += R(x, -268, 10, 268);
    d += P([x, -268], [x + 5, -292], [x + 10, -268]);
  }
  for (let x = -22; x < 22; x += 8) d += R(x, -256, 4, 6); // crenellations
  for (const x of [-12, 8]) d += P([x, -256], [x + 2, -270], [x + 4, -256]); // small pinnacles
  d += R(-0.9, -300, 1.8, 46); // flag-staff
  return d;
}

/** Lancet panels and turret shading of the Victoria Tower (lighter tone). */
function victoriaTowerDetails(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  let d = '';
  for (const yy of [-236, -196, -156]) for (const x of [-20, -9, 2, 13]) d += R(x, yy, 5, 30); // tall lancet panels
  for (const x of [-31.5, 26.5]) d += R(x, -262, 5, 120); // turret shading
  return d;
}

/** Palace of Westminster river-front roof line with pinnacles between xa and xb (absolute). */
function palace(xa, xb, y0, s, seed = 7) {
  const rand = rng(seed);
  let d = rectD(xa, y0 - 62 * s, xb - xa, 62 * s);
  d += polyD([[xa, y0 - 62 * s], [xa + 8 * s, y0 - 80 * s], [xb - 8 * s, y0 - 80 * s], [xb, y0 - 62 * s]]); // roof
  for (let x = xa + 6 * s; x < xb - 4 * s; x += 15 * s) {
    const h = (rand() < 0.25 ? 30 : 18) * s;
    d += polyD([[x - 2.2 * s, y0 - 62 * s], [x, y0 - 62 * s - h - 22 * s], [x + 2.2 * s, y0 - 62 * s]]);
  }
  return d;
}

/** Central Tower of the Palace (octagonal lantern spire). */
function centralTower(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  const P = (...pts) => polyD(pts.map(([x, y]) => [x0 + x * s, y0 + y * s]));
  let d = R(-16, -150, 32, 150);
  d += P([-17, -150], [0, -228], [17, -150]);
  for (const x of [-17, 13]) d += P([x, -150], [x + 2, -172], [x + 4, -150]);
  return d;
}

function stPauls(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  const P = (...pts) => polyD(pts.map(([x, y]) => [x0 + x * s, y0 + y * s]));
  const X = (x) => r2(x0 + x * s), Y = (y) => r2(y0 + y * s);
  let d = R(-112, -60, 224, 60); // nave & west front
  d += P([-44, -60], [0, -84], [44, -60]); // pediment
  for (const side of [-1, 1]) {
    const c = side * 84;
    d += R(c - 13, -130, 26, 72); // west tower
    d += R(c - 10, -150, 20, 22);
    d += `M${X(c - 11)} ${Y(-150)}C${X(c - 11)} ${Y(-166)} ${X(c + 11)} ${Y(-166)} ${X(c + 11)} ${Y(-150)}Z`; // cupola
    d += P([c - 1.6, -160], [c, -182], [c + 1.6, -160]);
  }
  d += R(-43, -118, 86, 60); // peristyle drum
  d += R(-47, -123, 94, 6); // stone gallery
  d += R(-37, -142, 74, 21); // attic drum
  d += `M${X(-37)} ${Y(-141)}C${X(-37)} ${Y(-176)} ${X(-19)} ${Y(-199)} ${X(0)} ${Y(-201)}C${X(19)} ${Y(-199)} ${X(37)} ${Y(-176)} ${X(37)} ${Y(-141)}Z`; // dome
  d += R(-9, -219, 18, 21); // lantern
  d += `M${X(-10.5)} ${Y(-218)}C${X(-10.5)} ${Y(-230)} ${X(10.5)} ${Y(-230)} ${X(10.5)} ${Y(-218)}Z`;
  d += circleD(X(0), Y(-233), 3.6 * s);
  d += R(-1.1, -252, 2.2, 17) + R(-5.5, -246, 11, 2.2); // cross
  return d;
}
function stPaulsDetails(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  let d = '';
  for (let x = -38; x <= 34; x += 8) d += R(x, -114, 3, 50); // peristyle columns (lit gaps)
  for (const c of [-84, 84]) d += R(c - 4, -122, 8, 18);
  return d;
}

/** Gothic church spire with corner pinnacles. */
function spire(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  const P = (...pts) => polyD(pts.map(([x, y]) => [x0 + x * s, y0 + y * s]));
  let d = R(-9, -96, 18, 96);
  d += P([-9, -96], [0, -168], [9, -96]);
  d += P([-10, -96], [-8, -110], [-6, -96]) + P([6, -96], [8, -110], [10, -96]);
  return d;
}
/** Tiered Wren-style City church steeple. */
function wrenSteeple(x0, y0, s) {
  const R = (x, y, w, h) => rectD(x0 + x * s, y0 + y * s, w * s, h * s);
  const P = (...pts) => polyD(pts.map(([x, y]) => [x0 + x * s, y0 + y * s]));
  return R(-11, -84, 22, 84) + R(-8.5, -104, 17, 21) + R(-6.5, -120, 13, 17) + R(-4.5, -132, 9, 13) + P([-3.5, -132], [0, -156], [3.5, -132]);
}

/**
 * Procedural row of terraced houses with gables, mansards and chimney stacks.
 * Returns { d, windows, chimneys } (windows/chimney tops for lights & smoke).
 */
function terraces(xa, xb, y0, s, { seed = 1, hMin = 46, hMax = 96 } = {}) {
  const rand = rng(seed);
  let d = '';
  const windows = [];
  const chimneys = [];
  let x = xa;
  while (x < xb) {
    const w = (26 + rand() * 34) * s;
    const h = (hMin + rand() * (hMax - hMin)) * s;
    const top = y0 - h;
    d += rectD(x, top, w + 0.6, h);
    const roof = rand();
    if (roof < 0.4) d += polyD([[x - 1 * s, top], [x + w / 2, top - (14 + rand() * 12) * s], [x + w + 1 * s, top]]);
    else if (roof < 0.75) d += polyD([[x, top], [x + 5 * s, top - 11 * s], [x + w - 5 * s, top - 11 * s], [x + w, top]]);
    else d += rectD(x - 1 * s, top - 4 * s, w + 2 * s, 4 * s);
    const nCh = rand() < 0.3 ? 2 : 1;
    for (let k = 0; k < nCh; k++) {
      const cw = (8 + rand() * 6) * s;
      const ch = (14 + rand() * 14) * s;
      const cx = x + (nCh === 1 ? 0.2 + rand() * 0.6 : k === 0 ? 0.12 : 0.7) * w;
      const ct = top - (roof < 0.75 ? 8 : 4) * s - ch;
      d += rectD(cx, ct, cw, ch + 10 * s);
      d += rectD(cx - 1 * s, ct, cw + 2 * s, 2.4 * s);
      const pots = 1 + Math.floor(rand() * 3);
      for (let p = 0; p < pots; p++) d += rectD(cx + 1.2 * s + p * (cw / pots), ct - 5 * s, 2.6 * s, 5 * s);
      chimneys.push([cx + cw / 2, ct - 5 * s]);
    }
    for (let wy = top + 10 * s; wy < y0 - 12 * s; wy += 17 * s) {
      for (let wx = x + 5 * s; wx < x + w - 8 * s; wx += 11 * s) if (rand() < 0.16) windows.push([wx, wy, 4.2 * s, 7 * s]);
    }
    x += w;
  }
  return { d, windows, chimneys };
}

/** Clock dial (lit) with hands at five to midnight. */
function clockFace(doc, cx, cy, r, { glow = true } = {}) {
  let s = '';
  if (glow) s += `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r * 3.2)}" fill="${doc.radial([[0, '#ffd88a', 0.55], [0.35, '#f0b45a', 0.22], [1, '#f0b45a', 0]])}"/>`;
  s += `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" fill="${doc.radial([[0, '#fff6d8'], [0.7, '#f6dc9c'], [1, '#c8954a']])}" stroke="#2a1d10" stroke-width="${r2(r * 0.12)}"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 - 90) * DEG;
    s += `<line x1="${r2(cx + Math.cos(a) * r * 0.72)}" y1="${r2(cy + Math.sin(a) * r * 0.72)}" x2="${r2(cx + Math.cos(a) * r * 0.88)}" y2="${r2(cy + Math.sin(a) * r * 0.88)}" stroke="#3a2610" stroke-width="${r2(r * 0.07)}"/>`;
  }
  const hand = (deg, len, w) => { const a = (deg - 90) * DEG; return `<line x1="${r2(cx)}" y1="${r2(cy)}" x2="${r2(cx + Math.cos(a) * r * len)}" y2="${r2(cy + Math.sin(a) * r * len)}" stroke="#1a1006" stroke-width="${r2(r * w)}" stroke-linecap="round"/>`; };
  s += hand(-2.5, 0.5, 0.12) + hand(-30, 0.78, 0.08);
  return s;
}

/** Chimney smoke: a rising, widening, fading plume drifting with the wind (wispy = noise-textured). */
function smokePlume(doc, x, y, { h = 120, drift = 60, w0 = 4, w1 = 28, seed = 1, opacity = 0.35, color = '#aab2bd', blurAmt, wispy = false } = {}) {
  const rand = rng(seed);
  const ph = rand() * Math.PI * 2;
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push([x + drift * t * t + Math.sin(ph + t * 6) * 0.08 * h * t, y - h * t]);
  }
  const grad = doc.linear([[0, color, opacity], [0.5, color, opacity * 0.6], [1, color, 0]], { x1: 0, y1: y, x2: 0, y2: y - h, user: true, name: 'smk' });
  const d = taperedStroke(pts, (t) => lerp(w0, w1, Math.sqrt(t)));
  if (!wispy) return `<path d="${d}" fill="${grad}" filter="${doc.blur(blurAmt ?? 2 + w1 * 0.18)}"/>`;
  const id = doc.id('smoke');
  const c = color.match(/\w\w/g).map((hx) => r2(parseInt(hx, 16) / 255));
  doc.def(`<filter id="${id}" x="-60%" y="-30%" width="220%" height="160%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.018 0.03" numOctaves="3" seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 ${c[0]}  0 0 0 0 ${c[1]}  0 0 0 0 ${c[2]}  0 0 0 2 -0.55" result="c"/>` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${blurAmt ?? 6}" result="b"/><feComposite in="c" in2="b" operator="in"/></filter>`);
  return `<path d="${d}" fill="${grad}" filter="url(#${id})"/>`;
}

/** Victorian cast-iron gas lamp. Returns silhouette path, glass panel path and light centre. */
function gasLamp(x, y, s) {
  const R = (dx, dy, w, h) => rectD(x + dx * s, y + dy * s, w * s, h * s);
  const P = (...pts) => polyD(pts.map(([dx, dy]) => [x + dx * s, y + dy * s]));
  let d = P([-10, 0], [-7.5, -10], [7.5, -10], [10, 0]);
  d += R(-5.5, -26, 11, 17) + R(-6.5, -28, 13, 3);
  d += P([-3.4, -28], [-2.2, -150], [2.2, -150], [3.4, -28]);
  d += R(-4.2, -64, 8.4, 4) + R(-4, -112, 8, 3);
  d += R(-14, -141, 28, 2.6) + circleD(x - 14 * s, y - 139.7 * s, 2 * s) + circleD(x + 14 * s, y - 139.7 * s, 2 * s); // ladder bar
  d += P([-6, -150], [6, -150], [4.5, -156], [-4.5, -156]);
  d += P([-6.5, -156], [-10, -181], [-8.6, -181], [-5.2, -156]) + P([6.5, -156], [10, -181], [8.6, -181], [5.2, -156]); // frame
  d += R(-11, -184, 22, 3.4);
  d += P([-11.5, -184], [0, -197], [11.5, -184]);
  d += R(-1, -205, 2, 9) + circleD(x, y - 206 * s, 2.2 * s);
  const glass = P([-5.6, -156], [-9, -181], [9, -181], [5.6, -156]);
  return { d, glass, light: [x, y - 169 * s] };
}

/** Moored sailing ship (docks): hull, tapered masts, yards with furled sails, rigging lines. */
function sailingShip(x, y, s, { masts = 3, seed = 2 } = {}) {
  const rand = rng(seed);
  const X = (u) => r2(x + u * s), Y = (v) => r2(y + v * s);
  let d = `M${X(-92)} ${Y(-24)}L${X(80)} ${Y(-24)}C${X(94)} ${Y(-24)} ${X(106)} ${Y(-30)} ${X(114)} ${Y(-38)}L${X(102)} ${Y(-6)}C${X(98)} ${Y(0)} ${X(-80)} ${Y(0)} ${X(-88)} ${Y(-6)}Z`;
  d += rectD(x - 94 * s, y - 32 * s, 24 * s, 9 * s); // poop deck
  d += polyD([[x + 104 * s, y - 34 * s], [x + 156 * s, y - 56 * s], [x + 156 * s, y - 53.5 * s], [x + 106 * s, y - 30 * s]]); // bowsprit
  let rig = '';
  const mx = masts === 3 ? [-54, 0, 50] : [-30, 34];
  mx.forEach((m, i) => {
    const h = (i === 1 || masts === 2 ? 170 : 150) + rand() * 10;
    const base = y - 24 * s, top = base - h * s;
    d += polyD([[x + (m - 2) * s, base], [x + (m - 0.7) * s, top], [x + (m + 0.7) * s, top], [x + (m + 2) * s, base]]);
    for (let k = 0; k < 3; k++) {
      const yy = base - h * s * (0.38 + k * 0.22), half = (34 - k * 9) * (i === 1 ? 1.05 : 0.92) * s;
      d += polyD([[x + m * s - half, yy - 0.9 * s], [x + m * s + half, yy - 0.9 * s], [x + m * s + half * 0.96, yy + 0.9 * s], [x + m * s - half * 0.96, yy + 0.9 * s]]); // yard
      d += `M${r2(x + m * s - half * 0.92)} ${r2(yy + 0.8 * s)}C${r2(x + m * s - half * 0.5)} ${r2(yy + 6 * s)} ${r2(x + m * s + half * 0.5)} ${r2(yy + 6 * s)} ${r2(x + m * s + half * 0.92)} ${r2(yy + 0.8 * s)}Z`; // furled sail
    }
    rig += `M${r2(x + m * s)} ${r2(top)}L${r2(x + (m + 40) * s)} ${r2(base)}M${r2(x + m * s)} ${r2(top)}L${r2(x + (m - 40) * s)} ${r2(base)}`;
  });
  rig += `M${X(156)} ${Y(-55)}L${X(mx[mx.length - 1])} ${Y(-24 - 150)}`; // forestay
  return { d, rig };
}

/** Cross pattée centred on (cx, cy), arm length a. */
function crossPattee(cx, cy, a) {
  const e = 0.42 * a, c = 0.13 * a;
  return polyD([[-e, -a], [e, -a], [c, -c], [a, -e], [a, e], [c, c], [e, a], [-e, a], [-c, c], [-a, e], [-a, -e], [-c, -c]].map(([x, y]) => [cx + x, cy + y]));
}

/** Fleur-de-lis, base centre (cx, by), height h. */
function fleurDeLis(cx, by, h) {
  const k = h / 30;
  const X = (u) => r2(cx + u * k), Y = (v) => r2(by + v * k);
  return `M${X(0)} ${Y(-30)}C${X(6)} ${Y(-23)} ${X(7)} ${Y(-14)} ${X(3)} ${Y(-8)}L${X(3)} ${Y(-6.5)}C${X(8)} ${Y(-8)} ${X(13)} ${Y(-11)} ${X(14)} ${Y(-19)}C${X(19.5)} ${Y(-12)} ${X(16)} ${Y(-3)} ${X(8)} ${Y(-2)}L${X(8)} ${Y(0)}L${X(-8)} ${Y(0)}L${X(-8)} ${Y(-2)}C${X(-16)} ${Y(-3)} ${X(-19.5)} ${Y(-12)} ${X(-14)} ${Y(-19)}C${X(-13)} ${Y(-11)} ${X(-8)} ${Y(-8)} ${X(-3)} ${Y(-6.5)}L${X(-3)} ${Y(-8)}C${X(-7)} ${Y(-14)} ${X(-6)} ${Y(-23)} ${X(0)} ${Y(-30)}Z` +
    rectD(cx - 9.5 * k, by - 7.5 * k, 19 * k, 3.4 * k);
}

/**
 * Victorian imperial crown, front view. Local box ≈ 200 × 186 (top of cross at y=0, base at
 * y≈186), drawn at (x, y) = top-left, scale s.
 */
function crown(doc, x, y, s, { metal = 'gold', cap = METAL.crimson, line = 3 } = {}) {
  const g = metal === 'gold';
  const ink = g ? PALETTE.ink : PALETTE.inkCool;
  const face = doc.linear(g ? METAL.goldFlat : METAL.silverFlat, { name: 'cw' });
  const faceUser = doc.linear(g ? METAL.goldFace : METAL.silverFace, { x1: 0, y1: 124, x2: 0, y2: 160, user: true, name: 'cwb' });
  const capFill = doc.linear(cap, { name: 'cap' });
  const pearl = g ? '#fff8e6' : '#ffffff';
  let o = `<g transform="translate(${r2(x)},${r2(y)}) scale(${r2(s)})" stroke-linejoin="round">`;
  // velvet cap between the arches
  o += `<path d="M38 132C36 76 74 54 100 70C126 54 164 76 162 132Z" fill="${capFill}" stroke="${ink}" stroke-width="${line}"/>`;
  o += `<path d="M58 120C58 92 78 78 98 82" fill="none" stroke="#fff" stroke-width="4" opacity=".18" stroke-linecap="round"/>`;
  // arches (dark outline under metal stroke)
  const arches = 'M34 130C28 72 70 40 100 60M166 130C172 72 130 40 100 60M100 128L100 62';
  o += `<path d="${arches}" fill="none" stroke="${ink}" stroke-width="16" stroke-linecap="round"/>`;
  o += `<path d="${arches}" fill="none" stroke="${face}" stroke-width="10" stroke-linecap="round"/>`;
  for (const t of [0.15, 0.32, 0.5, 0.68, 0.85]) {
    // pearls along both arches (cubic evaluation)
    for (const [p0, c1, c2, p1] of [[[34, 130], [28, 72], [70, 40], [100, 60]], [[166, 130], [172, 72], [130, 40], [100, 60]]]) {
      const u = 1 - t;
      const px = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0];
      const py = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1];
      o += `<circle cx="${r2(px)}" cy="${r2(py)}" r="3.4" fill="${pearl}" stroke="${ink}" stroke-width="1.2"/>`;
    }
  }
  // monde + cross pattée
  o += `<circle cx="100" cy="46" r="13" fill="${face}" stroke="${ink}" stroke-width="${line}"/>`;
  o += `<path d="M87 46H113" stroke="${ink}" stroke-width="2"/>`;
  o += `<path d="${crossPattee(100, 18, 15)}" fill="${face}" stroke="${ink}" stroke-width="${line}"/>`;
  // rim ornaments: crosses pattée and fleurs-de-lis
  o += `<path d="${crossPattee(100, 112, 15)}" fill="${face}" stroke="${ink}" stroke-width="${line}"/>`;
  o += `<path d="${fleurDeLis(56, 128, 30) + fleurDeLis(144, 128, 30)}" fill="${face}" stroke="${ink}" stroke-width="${line * 0.85}"/>`;
  o += `<path d="${crossPattee(24, 116, 11) + crossPattee(176, 116, 11)}" fill="${face}" stroke="${ink}" stroke-width="${line * 0.85}"/>`;
  // circlet with jewels
  o += `<path d="M18 128C60 120 140 120 182 128L182 158C140 151 60 151 18 158Z" fill="${faceUser}" stroke="${ink}" stroke-width="${line}"/>`;
  o += `<ellipse cx="100" cy="141.5" rx="10" ry="8" fill="${g ? '#b3121f' : '#1b4fa8'}" stroke="${ink}" stroke-width="2"/>`;
  o += `<ellipse cx="97" cy="138.5" rx="3" ry="2" fill="#fff" opacity=".7"/>`;
  for (const jx of [54, 146]) o += `<rect x="${jx - 7}" y="134.5" width="14" height="13" rx="2" fill="${g ? '#1c6b45' : '#7d1a5a'}" stroke="${ink}" stroke-width="2"/>`;
  for (const jx of [30, 76, 124, 170]) o += `<circle cx="${jx}" cy="141" r="4.2" fill="${pearl}" stroke="${ink}" stroke-width="1.4"/>`;
  // ermine-like base band
  o += `<path d="M16 158C60 151 140 151 184 158L184 172C140 165 60 165 16 172Z" fill="${g ? '#f6efe1' : '#eef2f7'}" stroke="${ink}" stroke-width="${line}"/>`;
  for (let ex = 28; ex <= 172; ex += 18) o += `<path d="M${ex} 160.5l-2 7h4z" fill="${ink}"/>`;
  o += '</g>';
  return o;
}

/** Ship's anchor with rope. Local box ≈ 200 × 230, drawn at top-left (x, y), scale s. */
function anchor(doc, x, y, s, { metal = 'silver', line = 3, rope = true } = {}) {
  const g = metal === 'gold';
  const ink = g ? PALETTE.ink : PALETTE.inkCool;
  const face = doc.linear(g ? METAL.goldFlat : METAL.silverFlat, { name: 'an' });
  const faceH = doc.linear(g ? METAL.goldFlat : METAL.silverFlat, { x1: 0, y1: 0, x2: 1, y2: 0, name: 'anh' });
  let o = `<g transform="translate(${r2(x)},${r2(y)}) scale(${r2(s)})" stroke-linejoin="round">`;
  const arms = 'M30 150C36 196 70 214 100 214C130 214 164 196 170 150';
  const fluke = (sx) => `M${100 + sx * 70} 150L${100 + sx * 86} 166L${100 + sx * 72} 120L${100 + sx * 52} 160Z`;
  // ring
  o += `<circle cx="100" cy="24" r="15" fill="none" stroke="${ink}" stroke-width="13"/><circle cx="100" cy="24" r="15" fill="none" stroke="${face}" stroke-width="7"/>`;
  // arms (dark outline under metal)
  o += `<path d="${arms}" fill="none" stroke="${ink}" stroke-width="20" stroke-linecap="round"/>`;
  o += `<path d="${arms}" fill="none" stroke="${face}" stroke-width="13" stroke-linecap="round"/>`;
  o += `<path d="${fluke(-1)}${fluke(1)}" fill="${face}" stroke="${ink}" stroke-width="${line}"/>`;
  // shank
  o += `<path d="M91 40L109 40L111 196C111 206 89 206 89 196Z" fill="${faceH}" stroke="${ink}" stroke-width="${line}"/>`;
  o += `<path d="M100 205L108 222L100 228L92 222Z" fill="${face}" stroke="${ink}" stroke-width="${line}"/>`;
  // stock (cross-bar) with ball ends
  o += `<rect x="42" y="52" width="116" height="13" rx="4" fill="${face}" stroke="${ink}" stroke-width="${line}"/>`;
  o += `<circle cx="40" cy="58.5" r="8.5" fill="${face}" stroke="${ink}" stroke-width="${line}"/><circle cx="160" cy="58.5" r="8.5" fill="${face}" stroke="${ink}" stroke-width="${line}"/>`;
  if (rope) {
    // rope from the ring, looping around the shank and stock
    const r = 'M100 38C66 46 60 84 92 92C122 100 128 128 98 138C70 148 66 176 92 186C110 193 128 186 136 172';
    o += `<path d="${r}" fill="none" stroke="${ink}" stroke-width="9" stroke-linecap="round"/>`;
    o += `<path d="${r}" fill="none" stroke="${g ? '#c8a26a' : '#d9c7a1'}" stroke-width="5" stroke-linecap="round"/>`;
    o += `<path d="${r}" fill="none" stroke="${ink}" stroke-width="5" stroke-dasharray="1.6 3.2" stroke-linecap="butt" opacity=".55"/>`;
  }
  o += '</g>';
  return o;
}

/**
 * Victorian calligraphic S-scroll: a small curl, a thick-thin sweep and a large end curl.
 * Starts at (x, y) and grows in direction dir (±1) over length L. Returns filled path data.
 */
function scrollFlourish(x, y, dir, L, { weight = 1, drop = 0.12, curl = 0.11 } = {}) {
  const P = (u, v) => [x + dir * u * L, y + v * L];
  // inner small curl (traversed from its centre outwards)
  const a = spiralPts(...P(0.05, 0.075), 0.06 * L, dir > 0 ? -Math.PI / 2 : -Math.PI / 2, 0.95, 0.24, dir > 0 ? -1 : 1, 40).reverse();
  // large end curl (traversed from outside to centre), turning upwards
  const bC = P(0.86, drop - curl * 0.9);
  const b = spiralPts(bC[0], bC[1], curl * L, Math.PI / 2, 1.2, 0.2, dir > 0 ? -1 : 1, 70);
  const tan = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  const aEnd = a[a.length - 1], ta = tan(a[a.length - 2], aEnd);
  const bStart = b[0], tb = tan(b[0], b[1]);
  const k = 0.32 * L;
  const sweep = sampleBeziers([[aEnd, [aEnd[0] + ta[0] * k, aEnd[1] + ta[1] * k], [bStart[0] - tb[0] * k, bStart[1] - tb[1] * k], bStart]], 50);
  const pts = [...a, ...sweep.slice(1), ...b.slice(1)];
  const wMax = 0.034 * L * weight, wMin = 0.004 * L * weight;
  let d = taperedStroke(pts, (t) => wMin + (wMax - wMin) * Math.pow(Math.sin(Math.PI * clamp(t * 1.05, 0, 1)), 0.9));
  // small leaf-like spur off the sweep
  const sp = sampleBeziers([[P(0.42, 0.1), P(0.47, 0.17), P(0.55, 0.19), P(0.6, 0.15)]], 20);
  d += taperedStroke(sp, (t) => wMin + (wMax * 0.55 - wMin) * Math.sin(Math.PI * t));
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Shared logo blocks
// ════════════════════════════════════════════════════════════════════════════
const CAP = 0.714; // cap height of Cinzel / Cinzel Decorative, in em

/** "MAFIA WARS" in embossed gilt: swash M and W, plain capitals for the rest. */
function titleBlock(doc, { cx, baseline, size, outline, rim, shadow }) {
  const t = setText(FONTS.deco, 'Mafia Wars', { size, tracking: 0.035, kern: { 4: 0.05 } });
  const cmds = placeText(t, cx, baseline, { by: 'ink' });
  const markup = metalText(doc, cmds, { top: baseline - CAP * size, bottom: baseline, metal: 'gold', outline, rim, ...(shadow ? { shadow } : {}) });
  return { markup, bbox: bboxOf(cmds) };
}

/** Split ribbon + VS medallion + the two faction names. */
function subtitleBlock(doc, { cx, cy, half, h, tail, drop, fold, notch, medR, nameSize, line = 3, nameOutline }) {
  let s = splitBanner(doc, { cx, cy, half, h, tail, drop, fold, notch, line });
  s += vsMedallion(doc, { cx, cy, r: medR });
  const cap = CAP * nameSize;
  const off = (half + medR) / 2 + medR * 0.05;
  const style = { top: cy - cap / 2, bottom: cy + cap / 2, outline: nameOutline ?? nameSize * 0.085, rim: 0, inner: 0, shadow: { dx: 0, dy: nameSize * 0.05, blur: nameSize * 0.05, opacity: 0.6 }, bevel: 0.03 };
  s += metalText(doc, placeText(setText(FONTS.cinzel, 'DADOU', { size: nameSize, tracking: 0.12 }), cx - off, cy + cap / 2), { ...style, metal: 'gold' });
  s += metalText(doc, placeText(setText(FONTS.cinzel, 'EVEN', { size: nameSize, tracking: 0.12 }), cx + off, cy + cap / 2), { ...style, metal: 'silver' });
  return s;
}

/** Symmetric pair of engraved gilt scroll flourishes (left one gold-on-crimson side, right one silver). */
function flourishPair(doc, { cx, y, inner, len, weight = 1 }) {
  let o = '';
  for (const dir of [-1, 1]) {
    const d = scrollFlourish(cx + dir * inner, y, dir, len, { weight });
    const fill = doc.linear(dir < 0 ? METAL.goldFlat : METAL.silverFlat, { name: 'fl' });
    const ink = dir < 0 ? PALETTE.ink : PALETTE.inkCool;
    o += `<path d="${d}" fill="${ink}" stroke="${ink}" stroke-width="${5 * weight}" stroke-linejoin="round"/>`;
    o += `<path d="${d}" fill="${fill}"/>`;
  }
  return o;
}

/** Skyline used above the title in the main logo (1888: no Tower Bridge!). */
function logoSkyline(doc, { cx, ground, s, fadeTop, fadeBottom, width }) {
  const x = (u) => cx + u * s;
  let d = '';
  d += clockTower(x(0), ground, s * 0.92);
  d += palace(x(-300), x(-24), ground, s, 11);
  d += centralTower(x(-160), ground, s * 0.95);
  d += victoriaTower(x(-330), ground, s * 0.95);
  d += stPauls(x(505), ground, s * 0.95);
  d += wrenSteeple(x(205), ground, s * 0.95);
  d += spire(x(-480), ground, s * 0.9);
  d += spire(x(668), ground, s * 0.85);
  const tl = terraces(x(-680), x(-362), ground, s, { seed: 3, hMin: 70, hMax: 128 });
  const tm = terraces(x(24), x(420), ground, s, { seed: 5, hMin: 84, hMax: 140 });
  const tr = terraces(x(590), x(720), ground, s, { seed: 9, hMin: 70, hMax: 124 });
  d += tl.d + tm.d + tr.d;

  const silhouette = doc.path(d, 'sky');
  const fillGrad = doc.linear([[0, '#2a3242'], [0.6, '#141922'], [1, '#0b0e14']], { x1: 0, y1: ground - 440 * s, x2: 0, y2: ground, user: true });
  // mask: fade at both ends and towards the ground (fog)
  const maskId = doc.id('skym');
  const hg = doc.linear([[0, '#000'], [0.16, '#fff'], [0.84, '#fff'], [1, '#000']], { x1: cx - width / 2, y1: 0, x2: cx + width / 2, y2: 0, user: true });
  const vg = doc.linear([[0, '#000', 0], [1, '#000', 1]], { x1: 0, y1: fadeTop, x2: 0, y2: fadeBottom, user: true });
  const mx = r1(cx - width / 2 - 10), my = r1(ground - 520 * s), mw = r1(width + 20), mh = r1(520 * s + 40);
  doc.def(`<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${mx}" y="${my}" width="${mw}" height="${mh}"><rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="${hg}"/><rect x="${mx}" y="${r1(fadeTop)}" width="${mw}" height="${r1(ground - fadeTop + 40)}" fill="${vg}"/></mask>`);

  let out = `<g mask="url(#${maskId})">`;
  // warm backlight haze so the silhouette separates from dark backgrounds
  out += `<ellipse cx="${cx}" cy="${r1(ground - 160 * s)}" rx="${r1(width * 0.42)}" ry="${r1(250 * s)}" fill="${doc.radial([[0, '#f2c279', 0.3], [0.55, '#c98d4a', 0.1], [1, '#c98d4a', 0]])}"/>`;
  // chimney smoke behind the roofs
  const chim = [...tl.chimneys, ...tm.chimneys, ...tr.chimneys];
  [2, 7, 11, 16, 21].forEach((i, k) => { if (chim[i]) out += smokePlume(doc, chim[i][0], chim[i][1], { h: 110 * s, drift: 50 * s, w0: 5 * s, w1: 30 * s, seed: 30 + k, opacity: 0.4, color: '#8d96a3' }); });
  out += use(silhouette, `fill="#d9ab55" transform="translate(0,${r2(-2.2 * s)})"`); // rim light
  out += use(silhouette, `fill="${fillGrad}"`);
  const lights = [...tl.windows, ...tm.windows, ...tr.windows].map(([wx, wy, ww, wh]) => rectD(wx, wy, ww, wh)).join('');
  out += `<path d="${lights}" fill="#f3c46b" opacity=".75"/>`;
  out += `<path d="${clockTowerDetails(x(0), ground, s * 0.92)}${victoriaTowerDetails(x(-330), ground, s * 0.95)}${stPaulsDetails(x(505), ground, s * 0.95)}" fill="#3a4354" opacity=".75"/>`;
  out += clockFace(doc, x(0), ground - 242 * s * 0.92, 16.5 * s * 0.92);
  out += '</g>';
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Asset builders
// ════════════════════════════════════════════════════════════════════════════

/** Primary logo — 2000 px wide, transparent. */
function buildLogo() {
  const W = 2000, H = 1120, CX = W / 2;
  const doc = new Svg('mwl', W, H);
  const size = 236, baseline = 528, capTop = baseline - CAP * size;
  let body = '';
  body += logoSkyline(doc, { cx: CX, ground: capTop + 80, s: 0.9, fadeTop: capTop - 20, fadeBottom: capTop + 60, width: 1520 });
  body += fogBand(doc, { cx: CX, cy: capTop + 4, rx: 830, ry: 46, opacity: 0.8, seed: 7 });
  body += titleBlock(doc, { cx: CX, baseline, size, outline: 15, rim: 8 }).markup;
  const rowY = 698;
  body += crossedRevolvers(doc, { cx: CX, cy: rowY, s: 1.55, angle: 52, cross: 250, flip: false });
  body += flourishPair(doc, { cx: CX, y: rowY + 60, inner: 236, len: 300 });
  body += subtitleBlock(doc, { cx: CX, cy: rowY, half: 540, h: 104, tail: 150, drop: 26, fold: 34, notch: 34, medR: 74, nameSize: 80 });
  return doc.render(body, { desc: 'Logo principal du jeu MAFIA WARS : Dadou vs Even (Londres, 1888).' });
}

/** Compact horizontal logo — 1200 px wide, for HUD / pause-menu headers. */
function buildCompact() {
  const W = 1200, H = 380, CX = W / 2;
  const doc = new Svg('mwc', W, H);
  const size = 150, baseline = 196;
  let body = titleBlock(doc, { cx: CX, baseline, size, outline: 10, rim: 5, shadow: { dx: 0, dy: 6, blur: 6, opacity: 0.55 } }).markup;
  body += subtitleBlock(doc, { cx: CX, cy: 292, half: 330, h: 66, tail: 84, drop: 16, fold: 22, notch: 22, medR: 48, nameSize: 50, line: 2.4 });
  return doc.render(body, { desc: 'Logo compact — MAFIA WARS : Dadou vs Even.' });
}

/** Split (crimson | navy) disc with a brass ring, used behind the app-icon monogram. */
function splitDisc(doc, cx, cy, r, { ring = true, sheen = true } = {}) {
  const clip = doc.id('dclip');
  doc.def(`<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`);
  let s = `<g clip-path="url(#${clip})">`;
  s += `<rect x="${cx - r}" y="${cy - r}" width="${r}" height="${2 * r}" fill="${doc.linear(METAL.crimson, { name: 'dcr' })}"/>`;
  s += `<rect x="${cx}" y="${cy - r}" width="${r}" height="${2 * r}" fill="${doc.linear(METAL.navy, { name: 'dnv' })}"/>`;
  if (sheen) s += `<circle cx="${cx}" cy="${cy - r * 0.4}" r="${r}" fill="${doc.radial([[0, '#fff', 0.2], [1, '#fff', 0]])}"/>`;
  s += '</g>';
  if (ring) {
    s += `<circle cx="${cx}" cy="${cy}" r="${r + r * 0.09}" fill="none" stroke="${PALETTE.ink}" stroke-width="${r * 0.2}"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r + r * 0.09}" fill="none" stroke="${doc.linear(METAL.goldRim, { name: 'dring' })}" stroke-width="${r * 0.11}"/>`;
  }
  return s;
}

/** Rounded dark tile with a crimson | navy tint and a brass frame (icon background). */
function iconTile(doc, S, { radius = 0.2, frame = true } = {}) {
  const r = S * radius;
  let s = `<rect width="${S}" height="${S}" rx="${r}" fill="${doc.radial([[0, '#2a2420'], [0.7, '#14100e'], [1, '#070605']], { cy: 0.42, r: 0.75 })}"/>`;
  const clip = doc.id('tile');
  doc.def(`<clipPath id="${clip}"><rect width="${S}" height="${S}" rx="${r}"/></clipPath>`);
  s += `<g clip-path="url(#${clip})">`;
  s += `<rect width="${S / 2}" height="${S}" fill="${doc.linear([[0, DAD.crimson, 0.38], [1, DAD.crimson, 0]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`;
  s += `<rect x="${S / 2}" width="${S / 2}" height="${S}" fill="${doc.linear([[0, '#2b4f9a', 0], [1, '#2b4f9a', 0.42]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`; // navy, lifted to read on near-black
  s += `<rect width="${S}" height="${S}" fill="${doc.radial([[0.55, '#000', 0], [1, '#000', 0.55]])}"/>`;
  s += '</g>';
  if (frame) {
    const i = S * 0.035, w = S * 0.018;
    s += `<rect x="${i}" y="${i}" width="${S - 2 * i}" height="${S - 2 * i}" rx="${r - i}" fill="none" stroke="${PALETTE.ink}" stroke-width="${w * 2.2}"/>`;
    s += `<rect x="${i}" y="${i}" width="${S - 2 * i}" height="${S - 2 * i}" rx="${r - i}" fill="none" stroke="${doc.linear(METAL.goldRim, { name: 'fr' })}" stroke-width="${w}"/>`;
    s += `<rect x="${i + w * 1.6}" y="${i + w * 1.6}" width="${S - 2 * i - w * 3.2}" height="${S - 2 * i - w * 3.2}" rx="${r - i - w * 1.6}" fill="none" stroke="#d4a640" stroke-width="${w * 0.25}" opacity=".6"/>`;
  }
  return s;
}

/**
 * App icon — 512 × 512: split medallion with the "MW" monogram and the two faction revolvers
 * (gold = Dadou, nickel = Even) meeting muzzle to muzzle behind it, like in the main logo.
 * square=true → full-bleed square without frame (apple-touch-icon: iOS rounds it itself).
 */
function buildIcon({ square = false } = {}) {
  const S = 512, C = S / 2;
  const doc = new Svg(square ? 'mwa' : 'mwi', S, S);
  let body = iconTile(doc, S, { radius: square ? 0 : 0.2, frame: !square });
  const dy = 200, r = 102;
  body += crossedRevolvers(doc, { cx: C, cy: dy, s: 1.2, angle: 52, cross: 250, flip: false });
  body += splitDisc(doc, C, dy, r);
  const size = 128, cap = CAP * size;
  const mw = placeText(setText(FONTS.deco, 'MW', { size, tracking: -0.09 }), C, dy + cap / 2);
  body += metalText(doc, mw, { top: dy - cap / 2, bottom: dy + cap / 2, metal: 'gold', outline: 9, rim: 4, shadow: { dx: 0, dy: 5, blur: 5, opacity: 0.6 } });
  return doc.render(body, { title: 'MAFIA WARS', desc: 'Icône — MAFIA WARS : Dadou vs Even.' });
}

/**
 * Favicon — designed for 16/32 px: full-bleed crimson | navy tile and the swash "M" of the
 * logo in gilt with a dark outline (legible even at 16 px).
 */
function buildFavicon() {
  const S = 64, C = S / 2;
  const doc = new Svg('mwf', S, S);
  const clip = doc.id('fc');
  doc.def(`<clipPath id="${clip}"><rect width="${S}" height="${S}" rx="14"/></clipPath>`);
  let body = `<g clip-path="url(#${clip})"><rect width="${C}" height="${S}" fill="${doc.linear([[0, '#c8303a'], [1, '#6a0f15']])}"/><rect x="${C}" width="${C}" height="${S}" fill="${doc.linear([[0, '#3a62b0'], [1, '#0f1c38']])}"/></g>`;
  const size = 54, cap = CAP * size;
  const m = placeText(setText(FONTS.deco, 'M', { size }), C + 1, C + cap / 2 + 1);
  const id = doc.path(toD(m), 'm');
  body += use(id, `fill="${PALETTE.ink}" stroke="${PALETTE.ink}" stroke-width="5" stroke-linejoin="round"`);
  body += use(id, `fill="${doc.linear([[0, '#fff6d0'], [0.45, '#f0c55c'], [1, '#b07a22']], { x1: 0, y1: C - cap / 2, x2: 0, y2: C + cap / 2, user: true })}"`);
  return doc.render(body, { title: 'MAFIA WARS', desc: 'Favicon — MAFIA WARS : Dadou vs Even.' });
}

/** Laurel branch along a cubic: alternate almond leaves growing towards the tip. */
function laurel(p0, c1, c2, p1, { leaves = 15, len = 34, wid = 14, stem = 3.2 } = {}) {
  const N = 80;
  const pts = sampleBeziers([[p0, c1, c2, p1]], N);
  let d = taperedStroke(pts, (t) => lerp(stem, stem * 0.35, t));
  for (let i = 0; i < leaves; i++) {
    const t = 0.06 + (i / leaves) * 0.9;
    const k = Math.round(t * N);
    const [x, y] = pts[k];
    const [xa, ya] = pts[Math.max(0, k - 1)], [xb, yb] = pts[Math.min(N, k + 1)];
    const ang = Math.atan2(yb - ya, xb - xa) / DEG;
    const side = i % 2 ? 1 : -1;
    const l = len * (1 - t * 0.38), w = wid * (1 - t * 0.3);
    const m = Mx.chain(Mx.t(x, y), Mx.r(ang + side * 30));
    d += toD(xform(parseD(`M0 0C${l * 0.25} ${-w * 0.62} ${l * 0.72} ${-w * 0.55} ${l} 0C${l * 0.72} ${w * 0.55} ${l * 0.25} ${w * 0.62} 0 0Z`), m));
  }
  // berry-like bud at the tip
  d += circleD(p1[0], p1[1], stem * 1.3);
  return d;
}

/**
 * Faction emblem — 512 × 512 roundel. Same construction for both factions:
 * milled metal rim, enamel band with lettering, field with a charge (top device + monogram +
 * curved "arms" below): Dadou = crown + D + laurels (crimson/black/gold),
 * Even = anchor + E (navy/black/silver).
 */
function buildEmblem(faction) {
  const D = faction === 'dadou';
  const S = 512, C = S / 2;
  const doc = new Svg(D ? 'emd' : 'eme', S, S);
  const metal = D ? 'gold' : 'silver';
  const ink = D ? PALETTE.ink : PALETTE.inkCool;
  const M = D ? METAL.goldRim : METAL.silverRim;
  const flat = doc.linear(D ? METAL.goldFlat : METAL.silverFlat, { name: 'ef' });
  const R0 = 246, R1 = 232, R2 = 180, R3 = 168; // rim / band / inner rim / field radii
  let b = '';
  b += `<circle cx="${C}" cy="${C + 6}" r="${R0}" fill="#000" opacity=".45" filter="${doc.blur(5)}"/>`;
  // outer milled rim
  b += `<circle cx="${C}" cy="${C}" r="${R0}" fill="${ink}"/>`;
  b += `<circle cx="${C}" cy="${C}" r="${(R0 + R1) / 2 + 0.5}" fill="none" stroke="${doc.linear(M, { name: 'er' })}" stroke-width="${R0 - R1 - 3}"/>`;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * 2 * Math.PI;
    b += `<circle cx="${r2(C + Math.cos(a) * (R0 - 7.5))}" cy="${r2(C + Math.sin(a) * (R0 - 7.5))}" r="2.3" fill="${D ? '#fff2c4' : '#ffffff'}" opacity=".55"/>`;
  }
  // enamel band
  const band = D ? [[0, '#2a0508'], [1, '#12030a']] : [[0, '#0b1733'], [1, '#040914']];
  b += `<circle cx="${C}" cy="${C}" r="${R1}" fill="${doc.linear(band, { name: 'eb' })}" stroke="${ink}" stroke-width="3"/>`;
  // lettering on the band
  const name = D ? 'LA MAFIA DE DADOU' : 'LA MAFIA D’EVEN';
  const topTxt = arcText(FONTS.cinzel, name, { size: 34, tracking: 0.14, cx: C, cy: C, r: R2 + 13, centerAngle: -90, top: true });
  const botTxt = arcText(FONTS.cinzel, 'LONDRES · 1888', { size: 30, tracking: 0.2, cx: C, cy: C, r: R1 - 14, centerAngle: 90, top: false });
  // ring lettering: one top-lit gradient across the whole emblem (consistent along the arcs)
  const ringFace = D ? [[0, '#fbe7ad'], [0.5, '#e2b85a'], [1, '#b8862e']] : [[0, '#ffffff'], [0.5, '#d7dee7'], [1, '#9aa6b6']];
  const txtStyle = { top: C - R1, bottom: C + R1, metal, face: ringFace, outline: 4, rim: 0, inner: 0, shadow: { dx: 0, dy: 2, blur: 2, opacity: 0.7 }, bevel: 0 };
  b += metalText(doc, topTxt, txtStyle);
  b += metalText(doc, botTxt, txtStyle);
  for (const sx of [-1, 1]) b += `<path d="${crossPattee(C + sx * (R1 + R2) / 2, C, 9)}" fill="${flat}" stroke="${ink}" stroke-width="2"/>`;
  // inner rim
  b += `<circle cx="${C}" cy="${C}" r="${(R2 + R3) / 2}" fill="none" stroke="${ink}" stroke-width="${R2 - R3 + 5}"/>`;
  b += `<circle cx="${C}" cy="${C}" r="${(R2 + R3) / 2}" fill="none" stroke="${doc.linear(M, { name: 'eir' })}" stroke-width="${R2 - R3 - 3}"/>`;
  // field
  const fieldClip = doc.id('fld');
  doc.def(`<clipPath id="${fieldClip}"><circle cx="${C}" cy="${C}" r="${R3}"/></clipPath>`);
  const field = D ? [[0, '#c3313a'], [0.55, '#8e1820'], [1, '#3e070b']] : [[0, '#36599a'], [0.55, '#1d3461'], [1, '#0a1530']];
  b += `<g clip-path="url(#${fieldClip})"><rect x="${C - R3}" y="${C - R3}" width="${2 * R3}" height="${2 * R3}" fill="${doc.radial(field, { cy: 0.4, r: 0.7 })}"/>`;
  const pat = doc.id('pat');
  if (D) doc.def(`<pattern id="${pat}" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45 ${C} ${C})"><path d="M0 0H28V28" fill="none" stroke="#000" stroke-width="1.4" opacity=".22"/><circle cx="14" cy="14" r="2" fill="#f0c060" opacity=".16"/></pattern>`);
  else doc.def(`<pattern id="${pat}" width="40" height="16" patternUnits="userSpaceOnUse"><path d="M0 8C10 2 10 2 20 8C30 14 30 14 40 8" fill="none" stroke="#9fb8e6" stroke-width="1.6" opacity=".16"/></pattern>`);
  b += `<rect x="${C - R3}" y="${C - R3}" width="${2 * R3}" height="${2 * R3}" fill="url(#${pat})"/>`;
  b += `<circle cx="${C}" cy="${C}" r="${R3}" fill="none" stroke="#000" stroke-width="26" opacity=".35" filter="${doc.blur(8)}"/></g>`;

  // charge
  const letterSize = 170, base = C + 66;
  if (D) {
    b += `<path d="${laurel([C - 10, C + 142], [C - 104, C + 136], [C - 140, C + 64], [C - 122, C - 14])}${laurel([C + 10, C + 142], [C + 104, C + 136], [C + 140, C + 64], [C + 122, C - 14])}" fill="${flat}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
    b += crown(doc, C - 72, C - 160, 0.72, { metal: 'gold' });
  } else {
    b += anchor(doc, C - 125, C - 148, 1.25, { metal: 'silver' });
  }
  const letter = placeText(setText(FONTS.deco, D ? 'D' : 'E', { size: letterSize }), C, base);
  b += metalText(doc, letter, { top: base - CAP * letterSize, bottom: base, metal, outline: 11, rim: 5, shadow: { dx: 0, dy: 6, blur: 5, opacity: 0.6 } });
  return doc.render(b, { title: D ? 'La Mafia de Dadou' : 'La Mafia d’Even', desc: `Emblème de faction — ${D ? 'La Mafia de Dadou' : 'La Mafia d’Even'}.` });
}

/** Westminster Bridge (1862): seven arches, parapet and lamp standards. evenodd path + lamp lights. */
function westminsterBridge(xa, xb, water, s) {
  const n = 7, deck = water - 46 * s, para = deck - 11 * s;
  const span = (xb - xa) / n, pier = 0.16 * span;
  let d = rectD(xa, para, xb - xa, water - para);
  for (let i = 0; i < n; i++) {
    const x1 = xa + i * span + pier / 2, x2 = xa + (i + 1) * span - pier / 2;
    const rx = (x2 - x1) / 2, ry = 33 * s;
    d += `M${r2(x1)} ${r2(water)}A${r2(rx)} ${r2(ry)} 0 0 1 ${r2(x2)} ${r2(water)}Z`;
  }
  const lights = [];
  for (let i = 0; i <= n; i++) {
    const x = xa + i * span;
    d += rectD(x - 1.4 * s, para - 24 * s, 2.8 * s, 24 * s) + rectD(x - 4 * s, para - 30 * s, 8 * s, 7 * s) + polyD([[x - 4.5 * s, para - 30 * s], [x, para - 35 * s], [x + 4.5 * s, para - 30 * s]]);
    lights.push([x, para - 26.5 * s]);
  }
  return { d, lights };
}

/** Reflection of a light on rippled water: soft column + broken, shimmering ripples. */
function waterGlint(doc, x, y0, { len = 160, w = 26, color = '#f2b65e', opacity = 0.5, seed = 1 } = {}) {
  const rand = rng(seed);
  let o = `<rect x="${r1(x - w / 2)}" y="${r1(y0)}" width="${r1(w)}" height="${r1(len)}" fill="${doc.linear([[0, color, opacity * 0.45], [1, color, 0]], { name: 'wg' })}" filter="${doc.blur(w * 0.4)}"/>`;
  const layers = [['', 0], ['', 0]];
  for (let k = 0; k < 16; k++) {
    const t = Math.pow(rand(), 1.4);
    const y = y0 + 3 + t * len;
    const dw = w * (0.25 + rand() * 0.9) * (1 - t * 0.6);
    const cx = x + (rand() - 0.5) * w * (0.5 + t);
    layers[t < 0.35 ? 0 : 1][0] += ellipseD(cx, y, dw / 2, 0.7 + rand() * 0.9);
  }
  o += `<path d="${layers[0][0]}" fill="${color}" opacity="${r2(opacity)}" filter="${doc.blur(0.8)}"/>`;
  o += `<path d="${layers[1][0]}" fill="${color}" opacity="${r2(opacity * 0.6)}" filter="${doc.blur(1.1)}"/>`;
  return o;
}

/**
 * Main-menu backdrop — 1920 × 1080: Westminster and the Thames at night, 1888, seen from the
 * Embankment. Layers: sky → moon & clouds → far City (St Paul's) → fog → Palace of
 * Westminster + Clock Tower (left), Westminster Bridge (centre), warehouses & docks (right)
 * → river with reflections → balustrade and gas lamps → vignette.
 * Red glow on the left (Dadou), blue glow on the right (Even). No text.
 */
function buildBackdrop() {
  const W = 1920, H = 1080;
  const doc = new Svg('mwb', W, H);
  const water = 800; // waterline
  let b = '';
  // ── sky
  b += `<rect width="${W}" height="${H}" fill="${doc.linear([[0, '#04060b'], [0.36, '#0a101b'], [0.6, '#181d28'], [0.73, '#2a282c'], [1, '#121214']], { x1: 0, y1: 0, x2: 0, y2: H, user: true })}"/>`;
  b += `<ellipse cx="960" cy="${water - 50}" rx="1150" ry="320" fill="${doc.radial([[0, '#c08848', 0.4], [0.45, '#7a5434', 0.18], [1, '#3a2a20', 0]])}"/>`;
  b += `<ellipse cx="90" cy="760" rx="900" ry="640" fill="${doc.radial([[0, '#b3212b', 0.52], [0.5, '#7a1219', 0.22], [1, '#5c0d12', 0]])}"/>`;
  b += `<ellipse cx="1830" cy="760" rx="900" ry="640" fill="${doc.radial([[0, '#2f5fc0', 0.5], [0.5, '#1d3a7a', 0.22], [1, '#0f1c38', 0]])}"/>`;
  const sr = rng(42);
  let stars = '';
  for (let i = 0; i < 50; i++) { const x = sr() * W, y = sr() * 380; stars += circleD(x, y, 0.5 + sr() * 1.1); }
  b += `<path d="${stars}" fill="#dfe6f2" opacity=".5"/>`;
  // moon, halo and clouds
  const mx = 1640, my = 150; // upper right: keeps the centre free for the logo overlay
  b += `<circle cx="${mx}" cy="${my}" r="280" fill="${doc.radial([[0, '#e8e2cf', 0.2], [0.35, '#b9b7b0', 0.07], [1, '#b9b7b0', 0]])}"/>`;
  b += `<circle cx="${mx}" cy="${my}" r="44" fill="${doc.radial([[0, '#fbf7e8'], [0.75, '#e6dfc6'], [1, '#c9c1a6']], { fx: 0.42, fy: 0.4 })}"/>`;
  b += `<path d="${ellipseD(mx - 12, my - 8, 9, 7) + ellipseD(mx + 14, my + 10, 7, 5) + ellipseD(mx + 4, my - 18, 5, 4)}" fill="#b8b09a" opacity=".35"/>`;
  b += fogBand(doc, { cx: 1500, cy: 172, rx: 560, ry: 62, opacity: 0.85, color: [0.12, 0.14, 0.19], freq: [0.004, 0.02], seed: 11, soft: 26, contrast: 2.2, cut: 0.8 });
  b += fogBand(doc, { cx: 480, cy: 290, rx: 720, ry: 90, opacity: 0.6, color: [0.15, 0.16, 0.21], freq: [0.0035, 0.018], seed: 5, soft: 30, contrast: 2, cut: 0.75 });

  // ── far layer: the City and St Paul's, hazy
  const g1 = water - 8;
  let far = stPauls(1395, g1, 1.45) + wrenSteeple(1205, g1, 1.25) + spire(1600, g1, 1.25) + wrenSteeple(1090, g1, 1.05) + spire(905, g1, 1.0) + wrenSteeple(1760, g1, 1.1);
  far += terraces(840, 1920, g1, 1.2, { seed: 21, hMin: 50, hMax: 115 }).d + terraces(560, 840, g1, 1.1, { seed: 27, hMin: 40, hMax: 90 }).d;
  b += `<path d="${far}" fill="#2b3343" opacity=".85"/>`;
  b += `<path d="${stPaulsDetails(1395, g1, 1.45)}" fill="#8a7658" opacity=".3"/>`;
  b += fogBand(doc, { cx: 1180, cy: water - 120, rx: 900, ry: 90, opacity: 0.7, color: [0.6, 0.58, 0.58], freq: [0.0028, 0.014], seed: 3, soft: 30 });

  // river surface beyond the bridge (seen through the arches)
  b += `<rect y="${water - 42}" width="${W}" height="44" fill="${doc.linear([[0, '#1d222d', 0], [0.35, '#151a24'], [1, '#10141c']], { x1: 0, y1: water - 42, x2: 0, y2: water, user: true })}"/>`;
  // ── mid layer
  const ctX = 455, ctS = 1.4;
  let mid = clockTower(ctX, water, ctS);
  mid += palace(-20, ctX - 18, water, 1.3, 4);
  mid += centralTower(ctX - 205, water, 1.3);
  mid += victoriaTower(70, water, 1.35);
  const wh = terraces(1185, 1580, water, 1.32, { seed: 33, hMin: 70, hMax: 150 });
  mid += wh.d;
  const ship1 = sailingShip(1665, water + 4, 1.25, { seed: 4 }), ship2 = sailingShip(1850, water + 6, 1.05, { masts: 2, seed: 8 });
  mid += ship1.d + ship2.d;
  const bridge = westminsterBridge(ctX + 30, 1190, water, 1.1);
  const midG = doc.id('midg');
  doc.def(`<g id="${midG}"><path d="${mid}"/><path d="${bridge.d}" fill-rule="evenodd"/></g>`);
  b += use(midG, `fill="#c99a57" opacity=".5" transform="translate(0,-2.5)"`); // rim light from the haze
  b += use(midG, `fill="${doc.linear([[0, '#1a212f'], [1, '#0a0d14']], { x1: 0, y1: water - 640, x2: 0, y2: water, user: true })}"`);
  b += `<path d="${ship1.rig + ship2.rig}" stroke="#0b0e15" stroke-width="1.2" fill="none" opacity=".9"/>`;
  b += `<path d="${clockTowerDetails(ctX, water, ctS) + victoriaTowerDetails(70, water, 1.35)}" fill="#2c3646" opacity=".9"/>`;
  b += clockFace(doc, ctX, water - 242 * ctS, 16.5 * ctS);
  // lit windows
  const pr = rng(77);
  let win = '';
  for (let i = 0; i < 34; i++) win += rectD(10 + pr() * (ctX - 40), water - 20 - pr() * 52, 3.5, 6.5);
  for (const [wx, wy, ww, whh] of wh.windows) win += rectD(wx, wy, ww, whh);
  b += `<path d="${win}" fill="#f6c46a" opacity=".85"/><path d="${win}" fill="#f6c46a" opacity=".45" filter="${doc.blur(4)}"/>`;
  // bridge lamps
  let bl = '';
  for (const [x, y] of bridge.lights) { bl += circleD(x, y, 3.2); b += `<circle cx="${r1(x)}" cy="${r1(y)}" r="34" fill="${doc.radial([[0, '#ffd590', 0.55], [1, '#ffb050', 0]])}"/>`; }
  b += `<path d="${bl}" fill="#fff0c8"/>`;
  wh.chimneys.forEach(([x, y], i) => { if (i % 3 === 0) b += smokePlume(doc, x, y, { h: 160, drift: 150, w0: 8, w1: 80, seed: 50 + i, opacity: 0.5, color: '#5d626c', blurAmt: 7, wispy: true }); });
  b += fogBand(doc, { cx: 960, cy: water - 10, rx: 1250, ry: 44, opacity: 0.5, color: [0.55, 0.55, 0.57], freq: [0.003, 0.022], seed: 9, soft: 18 });

  // ── the Thames
  b += `<rect y="${water}" width="${W}" height="${H - water}" fill="${doc.linear([[0, '#151922'], [1, '#05070a']], { x1: 0, y1: water, x2: 0, y2: H, user: true })}"/>`;
  const refl = doc.id('refl');
  doc.def(`<mask id="${refl}" maskUnits="userSpaceOnUse" x="0" y="${water}" width="${W}" height="${H - water}"><rect y="${water}" width="${W}" height="${H - water}" fill="${doc.linear([[0, '#fff', 0.55], [0.55, '#fff', 0]], { x1: 0, y1: water, x2: 0, y2: H, user: true })}"/></mask>`);
  b += `<g mask="url(#${refl})"><g transform="translate(0,${2 * water}) scale(1,-1)" filter="${doc.blur(2.5)}">${use(midG, 'fill="#363d4d"')}</g></g>`;
  b += waterGlint(doc, ctX, water + 2, { len: 150, w: 30, opacity: 0.55, seed: 2 }); // clock dial
  b += waterGlint(doc, mx, water + 2, { len: 200, w: 40, color: '#d9dce6', opacity: 0.35, seed: 3 }); // moon
  bridge.lights.forEach(([x], i) => { b += waterGlint(doc, x, water + 4, { len: 120, w: 16, opacity: 0.55, seed: 10 + i }); });
  [[1270, 0.4], [1420, 0.35], [180, 0.35], [300, 0.3]].forEach(([x, o], i) => { b += waterGlint(doc, x, water + 3, { len: 90, w: 22, opacity: o, seed: 20 + i }); });

  // ── foreground: Embankment balustrade and gas lamps
  const wallTop = 958;
  let fg = rectD(0, wallTop, W, H - wallTop) + rectD(0, wallTop - 10, W, 12);
  for (let x = 6; x < W; x += 22) fg += rectD(x, wallTop - 46, 9, 36) + circleD(x + 4.5, wallTop - 49, 5.5);
  fg += rectD(0, wallTop - 58, W, 9);
  for (let x = 0; x <= W; x += 320) fg += rectD(x - 14, wallTop - 72, 28, 72) + rectD(x - 17, wallTop - 76, 34, 6);
  const lamps = [gasLamp(160, wallTop - 76, 2.7), gasLamp(1760, wallTop - 76, 2.7)];
  for (const l of lamps) fg += l.d;
  for (const l of lamps) b += `<circle cx="${l.light[0]}" cy="${l.light[1]}" r="260" fill="${doc.radial([[0, '#ffcf87', 0.45], [0.25, '#f2a54a', 0.16], [1, '#f2a54a', 0]])}"/>`;
  b += `<path d="${fg}" fill="#050608"/>`;
  b += `<path d="${lamps.map((l) => l.glass).join('')}" fill="${doc.radial([[0, '#fff3cf'], [0.6, '#ffc970'], [1, '#d98a2c']])}"/>`;
  b += fogBand(doc, { cx: 960, cy: wallTop + 30, rx: 1300, ry: 70, opacity: 0.3, color: [0.45, 0.45, 0.47], freq: [0.004, 0.025], seed: 17, soft: 24 });
  // vignette
  b += `<rect width="${W}" height="${H}" fill="${doc.radial([[0.45, '#000', 0], [1, '#000', 0.72]], { cy: 0.45, r: 0.78 })}"/>`;
  return doc.render(b, { title: 'MAFIA WARS — menu', desc: 'Fond du menu principal : Westminster et la Tamise de nuit, Londres 1888.' });
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Raster output: PNG via resvg, JPEG via a small baseline encoder
// ════════════════════════════════════════════════════════════════════════════
function rasterize(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
}

/**
 * Minimal baseline JPEG encoder (4:4:4, standard Huffman tables from ITU-T T.81 Annex K).
 * Only used for the opaque menu backdrop to keep it light (~10× smaller than PNG).
 */
function encodeJpeg(rgba, width, height, quality = 88) {
  const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
  const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...new Array(32).fill(99)];
  const sf = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const qt = (t) => t.map((v) => clamp(Math.floor((v * sf + 50) / 100), 1, 255));
  const qY = qt(QL), qC = qt(QC);
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const H_DC_L = [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], range(12)];
  const H_DC_C = [[0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], range(12)];
  const H_AC_L = [[0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];
  const H_AC_C = [[0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];
  /** canonical Huffman codes: symbol → [code, length] */
  const codes = ([bits, vals]) => {
    const map = new Map();
    let code = 0, k = 0;
    for (let len = 1; len <= 16; len++) {
      for (let i = 0; i < bits[len - 1]; i++) map.set(vals[k++], [code++, len]);
      code <<= 1;
    }
    return map;
  };
  const tDCL = codes(H_DC_L), tDCC = codes(H_DC_C), tACL = codes(H_AC_L), tACC = codes(H_AC_C);

  const out = [];
  const u16 = (v) => out.push((v >> 8) & 255, v & 255);
  const marker = (m) => out.push(0xff, m);
  marker(0xd8); // SOI
  marker(0xe0); u16(16); out.push(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0); u16(1); u16(1); out.push(0, 0); // JFIF
  marker(0xdb); u16(132); out.push(0, ...ZZ.map((z) => qY[z])); out.push(1, ...ZZ.map((z) => qC[z])); // DQT
  marker(0xc0); u16(17); out.push(8); u16(height); u16(width); out.push(3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1); // SOF0
  const dht = (cls, id, [bits, vals]) => { out.push((cls << 4) | id, ...bits, ...vals); };
  marker(0xc4); u16(2 + 4 * 17 + 12 + 162 + 12 + 162);
  dht(0, 0, H_DC_L); dht(1, 0, H_AC_L); dht(0, 1, H_DC_C); dht(1, 1, H_AC_C);
  marker(0xda); u16(12); out.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0); // SOS

  // entropy-coded data
  let acc = 0, nbits = 0;
  const writeBits = (code, len) => {
    acc = (acc << len) | code; nbits += len;
    while (nbits >= 8) {
      const byte = (acc >> (nbits - 8)) & 255;
      out.push(byte); if (byte === 0xff) out.push(0);
      nbits -= 8; acc &= (1 << nbits) - 1;
    }
  };
  const cat = (v) => { v = Math.abs(v); let n = 0; while (v) { n++; v >>= 1; } return n; };
  const COS = [];
  for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2;
  const blk = new Float64Array(64), tmp = new Float64Array(64), coef = new Int32Array(64);
  const prevDC = [0, 0, 0];
  const encodeBlock = (ci, q, dcT, acT) => {
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += blk[y * 8 + x] * COS[u * 8 + x]; tmp[y * 8 + u] = s; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v * 8 + y]; coef[v * 8 + u] = Math.round(s / q[v * 8 + u]); }
    const dc = coef[0], diff = dc - prevDC[ci]; prevDC[ci] = dc;
    const c0 = cat(diff); const [hc, hl] = dcT.get(c0); writeBits(hc, hl);
    if (c0) writeBits(diff < 0 ? diff + (1 << c0) - 1 : diff, c0);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = coef[ZZ[k]];
      if (v === 0) { run++; continue; }
      while (run > 15) { const [zc, zl] = acT.get(0xf0); writeBits(zc, zl); run -= 16; }
      const c = cat(v); const [ac, al] = acT.get((run << 4) | c); writeBits(ac, al);
      writeBits(v < 0 ? v + (1 << c) - 1 : v, c);
      run = 0;
    }
    if (run > 0) { const [ec, el] = acT.get(0x00); writeBits(ec, el); }
  };
  const comp = [
    (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b - 128,
    (r, g, b) => -0.168736 * r - 0.331264 * g + 0.5 * b,
    (r, g, b) => 0.5 * r - 0.418688 * g - 0.081312 * b,
  ];
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let ci = 0; ci < 3; ci++) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const px = Math.min(width - 1, bx + x), py = Math.min(height - 1, by + y), i = (py * width + px) * 4;
          blk[y * 8 + x] = comp[ci](rgba[i], rgba[i + 1], rgba[i + 2]);
        }
        encodeBlock(ci, ci ? qC : qY, ci ? tDCC : tDCL, ci ? tACC : tACL);
      }
    }
  }
  if (nbits > 0) writeBits((1 << (8 - nbits)) - 1, 8 - nbits); // pad with 1-bits
  marker(0xd9); // EOI
  return Buffer.from(out);
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  const kb = (Buffer.byteLength(data) / 1024).toFixed(1);
  console.log(`  ✓ ${path.relative(ROOT, file).padEnd(34)} ${kb.padStart(8)} KB`);
}

function writeSvgAndPngs(svgFile, svg, pngs) {
  write(svgFile, svg);
  for (const [file, width] of pngs) write(file, rasterize(svg, width).asPng());
}

// ════════════════════════════════════════════════════════════════════════════
// 9. Main
// ════════════════════════════════════════════════════════════════════════════
function main() {
  const t0 = Date.now();
  console.log('MAFIA WARS : Dadou vs Even — génération des assets de marque…');
  const B = (f) => path.join(OUT_BRAND, f);
  const P = (f) => path.join(OUT_PUBLIC, f);

  writeSvgAndPngs(B('logo.svg'), buildLogo(), [[B('logo.png'), 2000]]);
  writeSvgAndPngs(B('logo-compact.svg'), buildCompact(), [[B('logo-compact.png'), 1200]]);
  writeSvgAndPngs(B('icon.svg'), buildIcon(), [[B('icon-512.png'), 512], [B('icon-192.png'), 192]]);
  write(P('apple-touch-icon.png'), rasterize(buildIcon({ square: true }), 180).asPng());
  writeSvgAndPngs(P('favicon.svg'), buildFavicon(), [[P('favicon-32.png'), 32], [P('favicon-16.png'), 16]]);
  writeSvgAndPngs(B('emblem-dadou.svg'), buildEmblem('dadou'), [[B('emblem-dadou.png'), 512]]);
  writeSvgAndPngs(B('emblem-even.svg'), buildEmblem('even'), [[B('emblem-even.png'), 512]]);

  const backdrop = buildBackdrop();
  write(B('menu-backdrop.svg'), backdrop);
  const img = rasterize(backdrop, 1920);
  write(B('menu-backdrop.jpg'), encodeJpeg(img.pixels, img.width, img.height, 88));

  console.log(`Terminé en ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
}

export const BUILDERS = { buildLogo, buildCompact, buildIcon, buildFavicon, buildEmblem, buildBackdrop };

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

// Internal building blocks, exported for previews/experiments (importing has no side effects).
export { Svg, FONTS, METAL, setText, placeText, metalText, revolver, crossedRevolvers, vsMedallion, splitBanner, fogBand, splitDisc, iconTile, toD, use, rectD, circleD, polyD };
