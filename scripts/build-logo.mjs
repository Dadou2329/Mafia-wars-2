#!/usr/bin/env node
/**
 * MAFIA WARS II : Dadou vs Even — générateur des assets de marque (New York, 2085).
 *
 *   node scripts/build-logo.mjs        (ou : npm run logo)
 *   MW_ONLY=logo,icon node scripts/build-logo.mjs   (ne régénère que certains fichiers)
 *
 * Tout est construit par le code, le résultat est donc reproductible à l'identique :
 *   1. Les polices OFL (Orbitron, Rajdhani — paquets @fontsource, fichiers .woff) sont lues
 *      avec opentype.js et chaque texte est converti en tracés : les SVG n'ont besoin d'aucune
 *      police installée.
 *   2. Les illustrations (skyline de 2085, flèche « Empire State », couronne « Chrysler », pont
 *      suspendu, hologrammes, pistolets, chapeau melon, haut-de-forme, moustache, monocle…) sont
 *      des formes vectorielles écrites à la main.
 *   3. Les PNG (transparents quand il le faut) sont rendus par @resvg/resvg-js ; le fond de menu
 *      est aussi encodé en JPEG par un petit encodeur intégré (fin du fichier).
 *
 * Sorties : public/brand/* , public/favicon.svg, public/favicon-{16,32}.png,
 *           public/apple-touch-icon.png  (voir public/brand/README.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

// ════════════════════════════════════════════════════════════════════════════
// 0. Chemins et palette
// ════════════════════════════════════════════════════════════════════════════
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_BRAND = path.join(ROOT, 'public', 'brand');
const OUT_PUBLIC = path.join(ROOT, 'public');
const FONT_DIR = path.join(ROOT, 'node_modules', '@fontsource');

/** Couleurs de la marque. Dadou : cramoisi, noir, pointe d'or. Even : marine, argent, néon cyan. */
export const PALETTE = {
  night: '#05060d',
  ink: '#04050b', // contour sombre froid (chrome, argent)
  inkWarm: '#0b0406', // contour sombre chaud (or, côté Dadou)
  dadou: { crimson: '#c8102e', neon: '#ff2a4d', deep: '#5c0a16', black: '#0d0507', gold: '#f2b84b' },
  even: { navy: '#15295a', neon: '#4fd8ff', deep: '#0a1533', black: '#04070f', silver: '#cfd8e6' },
  magenta: '#ff3dc8',
  violet: '#a95cff',
};
const { dadou: DAD, even: EVE } = PALETTE;

/** Dégradés métalliques et émaux, en arrêts [position, couleur] (haut → bas). */
const METAL = {
  // chrome « nuit de 2085 » : reflet blanc, acier bleuté, horizon sombre, remontée rosée des néons
  chrome: [[0, '#ffffff'], [0.17, '#eef6ff'], [0.37, '#a8bcd8'], [0.485, '#4b5a7c'], [0.5, '#161c33'], [0.535, '#2a2748'], [0.62, '#86709e'], [0.78, '#f0dcf6'], [0.9, '#ffffff'], [1, '#a6aecb']],
  chromeRim: [[0, '#39415a'], [0.45, '#c7d3e8'], [0.55, '#ffffff'], [1, '#3c4460']],
  // or poli (le luxe de la pègre)
  gold: [[0, '#fffbe8'], [0.15, '#ffe49c'], [0.38, '#f2b647'], [0.49, '#9c5e12'], [0.52, '#6a3a08'], [0.56, '#bb7c22'], [0.74, '#ffd677'], [0.9, '#f6bd4e'], [1, '#a06614']],
  goldRim: [[0, '#5a3608'], [0.45, '#dba242'], [0.55, '#fff1bb'], [1, '#6e440c']],
  goldFlat: [[0, '#ffe8a6'], [0.5, '#eaae42'], [1, '#93601a']],
  // argent (Even)
  silver: [[0, '#ffffff'], [0.15, '#f2f6fb'], [0.37, '#c5d0df'], [0.49, '#6e7c94'], [0.52, '#4c586e'], [0.56, '#8a97ae'], [0.75, '#e7edf5'], [0.9, '#bec8d6'], [1, '#6a778d']],
  silverRim: [[0, '#28303f'], [0.45, '#a6b3c6'], [0.55, '#f5f8fc'], [1, '#384254']],
  silverFlat: [[0, '#ffffff'], [0.5, '#c7d1df'], [1, '#5f6c82']],
  // émaux des factions
  crimson: [[0, '#ff4660'], [0.42, '#c8102e'], [1, '#56081a']],
  navy: [[0, '#3f69c0'], [0.42, '#15295a'], [1, '#081230']],
};

/** Dégradé « rivalité » (gauche → droite) : cramoisi de Dadou → magenta → violet → cyan d'Even. */
const RIVAL = [[0, '#ff2a4d'], [0.3, '#ff3d9e'], [0.52, '#b05cff'], [0.76, '#4f8dff'], [1, '#4fd8ff']];

// ════════════════════════════════════════════════════════════════════════════
// 1. Petits outils : nombres, hasard déterministe, matrices, tracés
// ════════════════════════════════════════════════════════════════════════════
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

/** Générateur pseudo-aléatoire (mulberry32) : les détails procéduraux sont identiques à chaque rendu. */
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

/** Matrice affine 2D [a, b, c, d, e, f] (convention SVG). */
const Mx = {
  id: () => [1, 0, 0, 1, 0, 0],
  mul: (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ],
  t: (x, y) => [1, 0, 0, 1, x, y],
  s: (x, y = x) => [x, 0, 0, y, 0, 0],
  r: (deg) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [c, s, -s, c, 0, 0]; },
  /** composition de gauche à droite, comme dans un attribut transform SVG */
  chain: (...ms) => ms.reduce((acc, m) => Mx.mul(acc, m), Mx.id()),
  apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
};

/** Transforme des commandes de tracé (format opentype) par une matrice. */
function xform(cmds, m) {
  return cmds.map((c) => {
    const o = { type: c.type };
    if (c.x !== undefined) [o.x, o.y] = Mx.apply(m, c.x, c.y);
    if (c.x1 !== undefined) [o.x1, o.y1] = Mx.apply(m, c.x1, c.y1);
    if (c.x2 !== undefined) [o.x2, o.y2] = Mx.apply(m, c.x2, c.y2);
    return o;
  });
}

/** Commandes → données de tracé SVG compactes. */
function toD(cmds) {
  let d = '';
  for (const c of cmds) {
    if (c.type === 'M' || c.type === 'L') d += `${c.type}${r2(c.x)} ${r2(c.y)}`;
    else if (c.type === 'C') d += `C${r2(c.x1)} ${r2(c.y1)} ${r2(c.x2)} ${r2(c.y2)} ${r2(c.x)} ${r2(c.y)}`;
    else if (c.type === 'Q') d += `Q${r2(c.x1)} ${r2(c.y1)} ${r2(c.x)} ${r2(c.y)}`;
    else if (c.type === 'Z') d += 'Z';
  }
  return d;
}

/** Boîte englobante exacte (courbes comprises, via opentype). */
function bboxOf(cmds) {
  const p = new opentype.Path();
  p.commands = cmds;
  const b = p.getBoundingBox();
  return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, w: b.x2 - b.x1, h: b.y2 - b.y1, cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2 };
}

// Formes simples → données de tracé (coordonnées absolues).
const rectD = (x, y, w, h) => `M${r2(x)} ${r2(y)}h${r2(w)}v${r2(h)}h${r2(-w)}Z`;
const polyD = (pts) => 'M' + pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L') + 'Z';
const circleD = (cx, cy, r) => `M${r2(cx - r)} ${r2(cy)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`;
const ellipseD = (cx, cy, rx, ry) => `M${r2(cx - rx)} ${r2(cy)}a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(2 * rx)} 0a${r2(rx)} ${r2(ry)} 0 1 0 ${r2(-2 * rx)} 0Z`;
/** Polygone régulier (hexagone…) ; a0 = angle du premier sommet en degrés. */
const ngonPts = (cx, cy, r, n, a0 = -90) => Array.from({ length: n }, (_, i) => [cx + Math.cos((a0 + (i * 360) / n) * DEG) * r, cy + Math.sin((a0 + (i * 360) / n) * DEG) * r]);

/**
 * Lit un tracé simple en coordonnées absolues (M L H V C Q Z) et le convertit en commandes,
 * pour transformer les formes dessinées à la main comme des glyphes.
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
      default: throw new Error(`parseD : commande non prise en charge ${cmd}`);
    }
  }
  return cmds;
}

/** Échantillonne une polyligne le long de segments de Bézier cubiques [[p0,c1,c2,p1], …]. */
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
 * Trait « calligraphique » : contour plein autour d'une polyligne dont l'épaisseur suit
 * widthFn(t) (t ∈ [0,1] le long du trait). Sert aux moustaches, câbles, pontets…
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

/** Points d'une spirale logarithmique (boucles des moustaches en guidon). */
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
// 2. Polices et texte → tracés
// ════════════════════════════════════════════════════════════════════════════
function loadFont(rel) {
  const buf = fs.readFileSync(path.join(FONT_DIR, rel));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

// Orbitron (Matt McInerney) et Rajdhani (Indian Type Foundry) — SIL Open Font License 1.1.
// opentype.js ne lit pas le woff2 : on prend les .woff livrés dans les mêmes paquets.
const FONTS = {
  title: loadFont('orbitron/files/orbitron-latin-900-normal.woff'), // titre, noms, « VS »
  bold: loadFont('orbitron/files/orbitron-latin-700-normal.woff'), // lettrage des emblèmes
  body: loadFont('rajdhani/files/rajdhani-latin-700-normal.woff'), // petites mentions
};
const CAP = 0.72; // hauteur des capitales d'Orbitron, en em

/**
 * Compose une ligne de texte et renvoie ses commandes de tracé à l'origine (ligne de base y=0).
 * @param tracking  interlettrage supplémentaire en em
 * @param kern      corrections manuelles : { indexDuGlyphe: em } ajoutées après ce glyphe
 * @param sx        étirement horizontal (1 = dessin d'origine)
 */
function setText(font, text, { size, tracking = 0, kern = {}, sx = 1 } = {}) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const kTables = font.position.getKerningTables(font.position.getDefaultScriptName());
  let x = 0;
  const cmds = [];
  const placed = [];
  glyphs.forEach((g, i) => {
    const gp = xform(g.getPath(0, 0, size).commands, Mx.chain(Mx.t(x, 0), Mx.s(sx, 1)));
    cmds.push(...gp);
    placed.push({ x, adv: g.advanceWidth * scale * sx, cmds: gp });
    x += g.advanceWidth * scale * sx;
    if (i < glyphs.length - 1) {
      const kv = kTables ? font.position.getKerningValue(kTables, g.index, glyphs[i + 1].index) : font.getKerningValue(g, glyphs[i + 1]);
      x += (kv * scale + tracking * size + (kern[i] || 0) * size) * sx;
    }
  });
  return { cmds, advance: x, glyphs: placed, size };
}

/** Place un texte composé. align : 'start' | 'center' | 'end' ; by : 'advance' ou 'ink' (encre visible). */
function placeText(t, x, y, { align = 'center', by = 'ink' } = {}) {
  const bb = bboxOf(t.cmds);
  const left = by === 'ink' ? bb.x1 : 0;
  const width = by === 'ink' ? bb.w : t.advance;
  const dx = align === 'center' ? x - left - width / 2 : align === 'end' ? x - left - width : x - left;
  return xform(t.cmds, Mx.t(dx, y));
}

/**
 * Texte posé sur un arc de cercle, glyphe par glyphe.
 * top=true : lu dans le sens horaire en haut (pied des lettres sur le cercle de rayon r)
 * top=false : lu de gauche à droite en bas (lettres debout, tête vers le centre)
 */
function arcText(font, text, { size, tracking = 0, cx, cy, r, centerAngle = -90, top = true }) {
  const t = setText(font, text, { size, tracking });
  const total = t.advance;
  const out = [];
  for (const g of t.glyphs) {
    const mid = g.x + g.adv / 2 - total / 2;
    const ang = centerAngle + (top ? 1 : -1) * (mid / r) / DEG;
    const rad = ang * DEG;
    const px = cx + Math.cos(rad) * r, py = cy + Math.sin(rad) * r;
    const rot = top ? ang + 90 : ang - 90;
    const m = Mx.chain(Mx.t(px, py), Mx.r(rot), Mx.t(-(g.x + g.adv / 2), 0));
    out.push(...xform(g.cmds, m));
  }
  return { cmds: out, angle: total / r / DEG };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Document SVG (défs, dégradés, filtres, identifiants uniques)
// ════════════════════════════════════════════════════════════════════════════
class Svg {
  constructor(prefix, w, h) {
    this.prefix = prefix;
    this.w = w;
    this.h = h;
    this.defs = [];
    this.n = 0;
    this.blurs = new Map();
  }
  id(name = 'x') { return `${this.prefix}-${name}${++this.n}`; }
  def(s) { this.defs.push(s); }

  /** Arrêts de dégradé : [position, couleur] ou [position, couleur, opacité]. */
  static stops(stops) {
    return stops.map(([o, c, a]) => `<stop offset="${r2(o)}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${r2(a)}"` : ''}/>`).join('');
  }

  /** Dégradé linéaire ; renvoie `url(#id)`. Par défaut : boîte de l'objet, de haut en bas. */
  linear(stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false, name = 'lg' } = {}) {
    const id = this.id(name);
    this.def(`<linearGradient id="${id}" x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${Svg.stops(stops)}</linearGradient>`);
    return `url(#${id})`;
  }

  /** Dégradé radial (boîte de l'objet, ou espace utilisateur si user=true) ; renvoie `url(#id)`. */
  radial(stops, { cx = 0.5, cy = 0.5, r = 0.5, fx, fy, user = false, name = 'rg' } = {}) {
    const id = this.id(name);
    this.def(`<radialGradient id="${id}" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}"${fx !== undefined ? ` fx="${r2(fx)}" fy="${r2(fy)}"` : ''}${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${Svg.stops(stops)}</radialGradient>`);
    return `url(#${id})`;
  }

  /** Filtre de flou gaussien (mis en cache) ; region = [x, y, w, h] en espace utilisateur. */
  blur(std, region = null) {
    const key = `${r2(std)}|${region || ''}`;
    if (!this.blurs.has(key)) {
      const id = this.id('blur');
      const reg = region ? ` filterUnits="userSpaceOnUse" x="${region[0]}" y="${region[1]}" width="${region[2]}" height="${region[3]}"` : ' x="-50%" y="-50%" width="200%" height="200%"';
      this.def(`<filter id="${id}"${reg} color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${r2(std)}"/></filter>`);
      this.blurs.set(key, `url(#${id})`);
    }
    return this.blurs.get(key);
  }

  /** Enregistre un tracé dans <defs> et renvoie son id (pour <use>, masques, découpes). */
  path(d, name = 'p', attrs = '') {
    const id = this.id(name);
    this.def(`<path id="${id}" d="${d}"${attrs ? ' ' + attrs : ''}/>`);
    return id;
  }

  /** Découpe (clipPath) à partir d'un tracé ; renvoie `url(#id)`. */
  clip(d) {
    const id = this.id('clip');
    this.def(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
    return `url(#${id})`;
  }

  render(body, { title = 'MAFIA WARS II : Dadou vs Even', desc = '' } = {}) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}" role="img">` +
      `<title>${title}</title>${desc ? `<desc>${desc}</desc>` : ''}` +
      `<defs>${this.defs.join('')}</defs>${body}</svg>`;
  }
}

const use = (id, attrs = '') => `<use xlink:href="#${id}" ${attrs}/>`;

// ════════════════════════════════════════════════════════════════════════════
// 4. Effets : lettrage métal à liseré néon, halos, éclats
// ════════════════════════════════════════════════════════════════════════════
/**
 * Lettrage métal de 2085, de l'arrière vers l'avant : ombre portée floue → halo néon flou →
 * tube néon net (cœur blanc) → contour sombre épais → liseré métallique → filet sombre → face en
 * dégradé → biseau clair en haut et ombré en bas (masques : glyphe moins sa copie décalée).
 * `top`/`bottom` : ordonnées couvertes par le dégradé de la face (ligne des capitales → ligne de base).
 * `neon` : { fill, width, glow, glowOpacity, core } ou null.
 */
function metalText(doc, cmds, o) {
  const {
    top, bottom, face = METAL.chrome, rim = METAL.chromeRim, ink = PALETTE.ink, outline = 12, rimW = 5, inner = 1.4,
    neon = null, shadow = { dx: 0, dy: 8, blur: 8, opacity: 0.6 }, bevel = 0.022, hi = '#ffffff', lo = '#10142a', hiOpacity = 0.85, loOpacity = 0.5,
  } = o;
  const d = typeof cmds === 'string' ? cmds : toD(cmds);
  const id = doc.path(d, 'txt');
  const bb = typeof cmds === 'string' ? o.bbox : bboxOf(cmds);
  const h = bottom - top;
  const faceFill = Array.isArray(face) ? doc.linear(face, { x1: 0, y1: top, x2: 0, y2: bottom, user: true, name: 'face' }) : face;
  const rimFill = rim ? doc.linear(rim, { x1: 0, y1: top - outline, x2: 0, y2: bottom + outline, user: true, name: 'rim' }) : null;
  const nw = neon ? outline + neon.width * 2 : outline;
  const pad = nw * 2 + (neon ? neon.glow * 4 : 0) + (shadow ? shadow.blur * 3 + Math.abs(shadow.dy) : 0) + 20;
  const region = [r1(bb.x1 - pad), r1(bb.y1 - pad), r1(bb.w + 2 * pad), r1(bb.h + 2 * pad)];
  const k = Math.max(1.1, h * bevel); // profondeur du biseau
  const hiMask = doc.id('hi');
  const loMask = doc.id('lo');
  doc.def(`<mask id="${hiMask}" maskUnits="userSpaceOnUse" x="${region[0]}" y="${region[1]}" width="${region[2]}" height="${region[3]}">${use(id, 'fill="#fff"')}${use(id, `fill="#000" transform="translate(${r2(k * 0.35)},${r2(k)})"`)}</mask>`);
  doc.def(`<mask id="${loMask}" maskUnits="userSpaceOnUse" x="${region[0]}" y="${region[1]}" width="${region[2]}" height="${region[3]}">${use(id, 'fill="#fff"')}${use(id, `fill="#000" transform="translate(${r2(-k * 0.25)},${r2(-k * 0.9)})"`)}</mask>`);
  let s = '<g>';
  if (shadow) s += use(id, `fill="#000" stroke="#000" stroke-width="${r2(nw)}" stroke-linejoin="round" opacity="${shadow.opacity}" transform="translate(${shadow.dx},${shadow.dy})" filter="${doc.blur(shadow.blur, region)}"`);
  if (neon) {
    s += use(id, `fill="none" stroke="${neon.fill}" stroke-width="${r2(nw + neon.glow * 1.4)}" stroke-linejoin="round" opacity="${neon.glowOpacity ?? 0.9}" filter="${doc.blur(neon.glow, region)}"`);
    s += use(id, `fill="none" stroke="${neon.fill}" stroke-width="${r2(nw)}" stroke-linejoin="round"`);
    if (neon.core) s += use(id, `fill="none" stroke="#fff" stroke-width="${r2(outline + neon.width * 0.9)}" stroke-linejoin="round" opacity="${neon.core}"`);
  }
  s += use(id, `fill="${ink}" stroke="${ink}" stroke-width="${outline}" stroke-linejoin="round"`);
  if (rimFill) s += use(id, `fill="none" stroke="${rimFill}" stroke-width="${rimW}" stroke-linejoin="round"`);
  if (inner) s += use(id, `fill="none" stroke="${ink}" stroke-width="${inner}" stroke-linejoin="round" opacity=".85"`);
  s += use(id, `fill="${faceFill}"`);
  if (hiOpacity) s += use(id, `fill="${hi}" mask="url(#${hiMask})" opacity="${hiOpacity}"`);
  if (loOpacity) s += use(id, `fill="${lo}" mask="url(#${loMask})" opacity="${loOpacity}"`);
  s += '</g>';
  return s;
}

/** Éclat d'objectif : étoile à quatre branches très fines + petite croix à 45° + halo. */
function sparkle(doc, x, y, r, { color = '#ffffff', glow = '#bfe9ff', opacity = 1 } = {}) {
  const star = (a, b) => `M${r2(x)} ${r2(y - a)}Q${r2(x + b)} ${r2(y - b)} ${r2(x + a)} ${r2(y)}Q${r2(x + b)} ${r2(y + b)} ${r2(x)} ${r2(y + a)}Q${r2(x - b)} ${r2(y + b)} ${r2(x - a)} ${r2(y)}Q${r2(x - b)} ${r2(y - b)} ${r2(x)} ${r2(y - a)}Z`;
  let s = `<g opacity="${opacity}">`;
  s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 0.55)}" fill="${doc.radial([[0, glow, 0.75], [0.35, glow, 0.25], [1, glow, 0]])}"/>`;
  s += `<path d="${star(r, r * 0.07)}" fill="${color}"/>`;
  s += `<path d="${star(r * 0.38, r * 0.05)}" fill="${color}" transform="rotate(45 ${r1(x)} ${r1(y)})" opacity=".8"/>`;
  s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 0.07)}" fill="#fff"/>`;
  return s + '</g>';
}

/** Trait néon : halo flou + tube coloré + cœur clair. `d` est un tracé ouvert ou fermé. */
function neonPath(doc, d, { color, width = 3, glow = 8, glowOpacity = 0.9, core = '#ffffff', coreOpacity = 0.75, region = null, cap = 'round' } = {}) {
  let s = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r2(width + glow)}" stroke-linecap="${cap}" stroke-linejoin="round" opacity="${glowOpacity}" filter="${doc.blur(glow, region)}"/>`;
  s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r2(width)}" stroke-linecap="${cap}" stroke-linejoin="round"/>`;
  if (core) s += `<path d="${d}" fill="none" stroke="${core}" stroke-width="${r2(Math.max(0.6, width * 0.38))}" stroke-linecap="${cap}" stroke-linejoin="round" opacity="${coreOpacity}"/>`;
  return s;
}

/**
 * Brume (bruit fractal découpé par une ellipse floue) : smog de 2085 éclairé par les néons.
 * color = RVB dans 0..1 ; contrast/cut règlent l'aspect plus ou moins déchiqueté.
 */
function hazeBand(doc, { cx, cy, rx, ry, opacity = 0.6, color = [0.6, 0.4, 0.8], freq = [0.0032, 0.016], seed = 4, soft = 18, contrast = 1.7, cut = 0.6 }) {
  const id = doc.id('haze');
  const x = cx - rx - soft * 3, y = cy - ry - soft * 3, w = 2 * (rx + soft * 3), h = 2 * (ry + soft * 3);
  doc.def(`<filter id="${id}" filterUnits="userSpaceOnUse" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq[0]} ${freq[1]}" numOctaves="4" seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 ${color[0]}  0 0 0 0 ${color[1]}  0 0 0 0 ${color[2]}  0 0 0 ${contrast} ${-cut}" result="c"/>` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${soft}" result="b"/>` +
    `<feComposite in="c" in2="b" operator="in"/></filter>`);
  return `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="#fff" opacity="${opacity}" filter="url(#${id})"/>`;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Composants d'illustration
// ════════════════════════════════════════════════════════════════════════════

// ── 5a. Le chiffre romain « Ⅱ » (dessiné : deux fûts reliés par des barres à empattements) ──
/** Renvoie { d, w } : x = bord gauche des fûts, baseline = pied, h = hauteur totale. */
function numeralII(x, baseline, h) {
  const w = h * 0.62; // largeur entre les bords extérieurs des fûts
  const s = w * 0.31; // épaisseur d'un fût
  const t = h * 0.135; // épaisseur des barres
  const e = w * 0.11; // débord des empattements
  const k = t * 0.5; // chanfreins
  const xl = x, xr = x + w, top = baseline - h, bot = baseline;
  const outer = [
    [xl - e + k, top], [xr + e - k, top], [xr + e, top + k], [xr + e, top + t], [xr, top + t], [xr, bot - t], [xr + e, bot - t], [xr + e, bot - k],
    [xr + e - k, bot], [xl - e + k, bot], [xl - e, bot - k], [xl - e, bot - t], [xl, bot - t], [xl, top + t], [xl - e, top + t], [xl - e, top + k],
  ];
  // évidement central (sens inverse : la règle « nonzero » le perce)
  const hole = [[xl + s, top + t], [xl + s, bot - t], [xr - s, bot - t], [xr - s, top + t]];
  return { d: polyD(outer) + polyD(hole), w: w + 2 * e, left: xl - e, right: xr + e, top, bottom: bot };
}

// ── 5b. Gratte-ciel (silhouettes) ──
/** Flèche « Empire State » stylisée : gradins art déco, fût à piliers, mât d'amarrage, antenne. */
function empireSpire(x0, g, s) {
  const tiers = [[176, 34], [146, 56], [108, 236], [88, 34], [70, 22], [52, 16]]; // [largeur, hauteur]
  let y = g;
  let d = '';
  const blocks = [];
  for (const [w, h] of tiers) {
    blocks.push([x0 - (w * s) / 2, y - h * s, w * s, h * s]);
    d += rectD(x0 - (w * s) / 2, y - h * s, w * s, h * s + 0.6);
    y -= h * s;
  }
  // mât d'amarrage cannelé, lanterne, antenne
  d += polyD([[x0 - 15 * s, y + 0.6], [x0 - 11 * s, y - 50 * s], [x0 + 11 * s, y - 50 * s], [x0 + 15 * s, y + 0.6]]);
  const mastTop = y - 50 * s;
  d += polyD([[x0 - 7.5 * s, mastTop + 0.6], [x0 - 5 * s, mastTop - 15 * s], [x0 + 5 * s, mastTop - 15 * s], [x0 + 7.5 * s, mastTop + 0.6]]);
  const lantern = mastTop - 15 * s;
  d += polyD([[x0 - 2.4 * s, lantern + 0.6], [x0 - 0.7 * s, lantern - 96 * s], [x0 + 0.7 * s, lantern - 96 * s], [x0 + 2.4 * s, lantern + 0.6]]);
  // piliers verticaux du fût (détails clairs)
  const shaft = blocks[2];
  let piers = '';
  for (let i = 1; i < 8; i++) piers += rectD(shaft[0] + (shaft[2] * i) / 8 - 0.7 * s, shaft[1] + 4 * s, 1.4 * s, shaft[3] - 8 * s);
  return { d, blocks, piers, crown: y, mast: [x0, mastTop], tip: [x0, lantern - 96 * s] };
}

/** Couronne « Chrysler » stylisée : fût, épaulements, arches en soleil superposées, aiguille. */
function chryslerSpire(x0, g, s) {
  let d = '';
  const shaftW = 72 * s, shaftH = 262 * s;
  d += rectD(x0 - shaftW / 2, g - shaftH, shaftW, shaftH + 0.6);
  let y = g - shaftH;
  d += rectD(x0 - 30 * s, y - 20 * s, 60 * s, 20 * s + 0.6);
  y -= 20 * s;
  const arches = [];
  let r = 28 * s;
  for (let i = 0; i < 6; i++) {
    const hb = 7 * s;
    d += rectD(x0 - r, y - hb, 2 * r, hb + 0.6);
    y -= hb;
    d += `M${r2(x0 - r)} ${r2(y + 0.6)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x0 + r)} ${r2(y + 0.6)}Z`;
    arches.push([x0, y, r]);
    y -= r * 0.5;
    r *= 0.8;
  }
  d += polyD([[x0 - 3 * s, y + 8 * s], [x0, y - 104 * s], [x0 + 3 * s, y + 8 * s]]);
  // fenêtres triangulaires éclairées le long des arches
  let tri = '';
  for (const [ax, ay, ar] of arches) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (180 + ((i + 0.5) * 180) / n) * DEG;
      const px = ax + Math.cos(a) * ar * 0.78, py = ay + Math.sin(a) * ar * 0.78;
      const q = ar * 0.11;
      tri += polyD([[px, py - q * 1.4], [px + q, py + q], [px - q, py + q]]);
    }
  }
  return { d, arches, tri, tip: [x0, y - 104 * s] };
}

/** Tour de 2085 à sommet biseauté (pente vers la droite si slant > 0). */
function slabTower(x, g, w, h, slant = 0) {
  return polyD([[x - w / 2, g + 0.6], [x - w / 2, g - h], [x + w / 2, g - h - slant], [x + w / 2, g + 0.6]]);
}

/** Tour à gradins avec antenne. */
function stepTower(x, g, w, h, s, { steps = 3, antenna = 40 } = {}) {
  let d = '';
  let y = g, ww = w;
  const hs = h / (steps + 1.5);
  for (let i = 0; i < steps; i++) {
    const hh = i === 0 ? hs * 2.5 : hs;
    d += rectD(x - ww / 2, y - hh, ww, hh + 0.6);
    y -= hh;
    ww *= 0.78;
  }
  if (antenna) d += rectD(x - 1.1 * s, y - antenna * s, 2.2 * s, antenna * s + 0.6);
  return { d, top: y, tip: y - antenna * s };
}

/** Château d'eau new-yorkais sur un toit : pieds, cuve cerclée, toit conique. */
function waterTower(x, roof, s) {
  const w = 16 * s, h = 14 * s, legs = 7 * s;
  let d = rectD(x - w / 2 + 1 * s, roof - legs, 1.6 * s, legs + 0.6) + rectD(x + w / 2 - 2.6 * s, roof - legs, 1.6 * s, legs + 0.6);
  d += rectD(x - w / 2, roof - legs - h, w, h + 0.6);
  d += polyD([[x - w / 2 - 1.5 * s, roof - legs - h + 0.6], [x, roof - legs - h - 8 * s], [x + w / 2 + 1.5 * s, roof - legs - h + 0.6]]);
  return d;
}

/** Fenêtres d'une façade : grille irrégulière de petites fenêtres allumées (hasard déterministe). */
function windowGrid(rand, x, y, w, h, { cw = 7, ch = 10, ww = 2.6, wh = 4.4, p = 0.3, s = 1 } = {}) {
  const out = [];
  const cols = Math.floor(w / (cw * s)), rows = Math.floor(h / (ch * s));
  const ox = x + (w - cols * cw * s) / 2 + (cw * s - ww * s) / 2;
  const oy = y + (h - rows * ch * s) / 2 + (ch * s - wh * s) / 2;
  for (let r = 0; r < rows; r++) {
    const rowOn = rand() < 0.85; // étages entiers éteints
    for (let c = 0; c < cols; c++) if (rowOn && rand() < p) out.push([ox + c * cw * s, oy + r * ch * s, ww * s, wh * s]);
  }
  return out;
}

// ── 5c. Accessoires des parrains : chapeau melon, haut-de-forme, moustache, monocle, barbe ──
/** Chapeau melon (Dadou), vu de profil, centré en x=0, pied du bord à y≈0. Largeur ≈ 156. */
const BOWLER = {
  crown: 'M-45 -8 C-47 -44 -28 -68 0 -68 C28 -68 47 -44 45 -8 Z',
  band: 'M-46.5 -21 L46.5 -21 L46 -7 L-46 -7 Z',
  brim: 'M-80 -18 C-72 -4 -50 2 0 2 C50 2 72 -4 80 -18 C84 -6 72 12 0 13 C-72 12 -84 -6 -80 -18 Z',
  shine: 'M-30 -30 C-31 -48 -20 -60 -6 -63 C-17 -55 -24 -44 -24 -30 Z',
};
/** Haut-de-forme (Even), centré en x=0, pied du bord à y≈0. Largeur ≈ 146, hauteur ≈ 138. */
const TOPHAT = {
  crown: 'M-38 -8 L-43 -120 C-43 -127 43 -127 43 -120 L38 -8 Z',
  band: 'M-39.2 -34 L39.2 -34 L38 -8 L-38 -8 Z',
  brim: 'M-72 -17 C-66 -3 -42 3 0 3 C42 3 66 -3 72 -17 C76 -5 62 13 0 14 C-62 13 -76 -5 -72 -17 Z',
  shine: 'M-31 -26 L-34 -110 L-25 -112 L-23 -26 Z',
};

/** Moustache en guidon (Dadou) : deux moitiés effilées terminées par une boucle. Centre (0,0), largeur ≈ 2·L. */
function handlebarMustache(L = 100, thick = 30) {
  let d = '';
  for (const sx of [-1, 1]) {
    const P = (x, y) => [sx * x, y];
    const body = sampleBeziers([[P(2, -4), P(L * 0.28, -10), P(L * 0.55, 14), P(L * 0.82, 2)], [P(L * 0.82, 2), P(L * 0.98, -6), P(L * 1.02, -26), P(L * 0.9, -32)]], 30);
    // boucle finale : spirale qui rentre vers l'intérieur
    const last = body[body.length - 1];
    const curl = spiralPts(last[0] + sx * L * 0.06, last[1] + L * 0.1, L * 0.1, sx > 0 ? -1.9 : -Math.PI + 1.9, 0.8, 0.25, sx > 0 ? -1 : 1, 30).slice(1);
    const pts = [...body, ...curl];
    d += taperedStroke(pts, (t) => (t < 0.12 ? lerp(thick * 0.7, thick, t / 0.12) : lerp(thick, 2.2, Math.pow((t - 0.12) / 0.88, 0.75))));
  }
  // nœud central
  d += ellipseD(0, -3, thick * 0.42, thick * 0.38);
  return d;
}

/** Barbe grise taillée (Even) avec sa moustache sobre. Haut de la barbe à y=0, largeur ≈ 150. */
function neatBeard() {
  const beard = 'M-72 -26 C-78 40 -38 98 0 104 C38 98 78 40 72 -26 C56 -2 30 10 0 10 C-30 10 -56 -2 -72 -26 Z';
  const mouth = 'M-20 30 C-10 36 10 36 20 30 C12 42 -12 42 -20 30 Z';
  let stache = '';
  for (const sx of [-1, 1]) stache += polyD(sampleBeziers([[[sx * 3, 4], [sx * 18, -12], [sx * 48, -10], [sx * 62, 8]], [[sx * 62, 8], [sx * 44, 2], [sx * 22, 12], [sx * 3, 18]]], 16));
  return { beard, mouth, stache };
}

// ── 5d. Pistolet de 2085 (profil, bouche du canon vers +x ; ≈ 300 × 195) ──
const PISTOL = {
  slide: 'M34 20 L46 10 L292 10 L306 18 L308 50 L296 58 L40 58 L34 50 Z',
  rsight: 'M50 11 L53 3 L66 3 L68 11 Z',
  fsight: 'M280 11 L283 4 L292 4 L294 11 Z',
  muzzle: 'M306 23 L318 23 L321 27 L321 41 L318 45 L306 45 Z',
  rail: 'M150 57 L300 57 L302 64 L292 75 L150 75 Z',
  frame: 'M40 57 L158 57 L158 77 L128 81 L62 79 L42 66 Z',
  beaver: 'M46 57 L26 59 C19 60 18 68 25 70 L48 71 Z',
  grip: 'M58 70 L130 74 L123 94 L106 176 C105 183 100 187 93 187 L46 187 C39 187 36 182 37 176 L57 82 Z',
  mag: 'M33 183 L110 183 L108 197 L31 197 Z',
  trigger: 'M150 76 C153 88 151 99 143 107 L139 103 C144 95 146 86 144 76 Z',
  muzzleTip: [321, 34],
};
PISTOL.guard = taperedStroke(sampleBeziers([[[124, 74], [121, 100], [126, 120], [152, 120]], [[152, 120], [178, 120], [186, 100], [190, 74]]], 18), () => 7);
PISTOL.inlay = 'M66 92 L118 95 L104 168 L56 168 Z';
PISTOL.strip = rectD(112, 30, 168, 6);
PISTOL.vents = Array.from({ length: 6 }, (_, i) => { const x = 196 + i * 13; return `M${x} 15L${x + 7} 15L${x + 1} 25L${x - 6} 25Z`; }).join('');
PISTOL.silhouette = ['slide', 'rsight', 'fsight', 'muzzle', 'rail', 'frame', 'beaver', 'grip', 'mag', 'guard'].map((k) => PISTOL[k]).join('');

/**
 * Pistolet d'une faction. finish 'gold' (Dadou : culasse dorée, crosse noire, néon cramoisi) ou
 * 'chrome' (Even : culasse chromée, crosse marine, néon cyan). Coordonnées locales.
 */
function pistol(doc, { finish = 'gold', line = 2.4 } = {}) {
  const G = finish === 'gold';
  const ink = G ? PALETTE.inkWarm : PALETTE.ink;
  const neon = G ? DAD.neon : EVE.neon;
  const slideFill = doc.linear(G ? METAL.gold : METAL.silver, { x1: 0, y1: 10, x2: 0, y2: 58, user: true, name: 'ps' });
  const darkFill = doc.linear(G ? [[0, '#5a2a32'], [1, '#1c0b0f']] : [[0, '#33507e'], [1, '#101c36']], { name: 'pd' });
  const gripFill = doc.linear(G ? [[0, '#4a1c24'], [1, '#160709']] : [[0, '#2a4478'], [1, '#0b1630']], { x1: 0, y1: 0, x2: 1, y2: 1, name: 'pg' });
  const inlay = doc.linear(G ? [[0, '#ff4a62'], [1, '#7a0a1c']] : [[0, '#7fe6ff'], [1, '#1a4c8c']], { x1: 0, y1: 0, x2: 1, y2: 1, name: 'pi' });
  let s = `<path d="${PISTOL.silhouette}" fill="none" stroke="${neon}" stroke-width="${line * 4.5}" stroke-linejoin="round" opacity=".75" filter="${doc.blur(6)}"/>`;
  s += `<path d="${PISTOL.silhouette}" fill="${ink}" stroke="${ink}" stroke-width="${line * 2.2}" stroke-linejoin="round"/>`;
  s += `<path d="${PISTOL.grip}${PISTOL.mag}${PISTOL.beaver}" fill="${gripFill}"/>`;
  s += `<path d="${PISTOL.frame}${PISTOL.rail}${PISTOL.guard}${PISTOL.trigger}" fill="${darkFill}"/>`;
  s += `<path d="${PISTOL.frame}${PISTOL.rail}${PISTOL.guard}${PISTOL.grip}${PISTOL.mag}" fill="none" stroke="${G ? '#c8707c' : '#8fb4e8'}" stroke-width="${line * 0.6}" stroke-linejoin="round" opacity=".55"/>`;
  s += `<path d="${PISTOL.inlay}" fill="${inlay}" stroke="${ink}" stroke-width="${line}"/>`;
  // stries de la crosse
  let st = '';
  for (let i = 0; i < 7; i++) st += rectD(62 + i * 0.4 - i * 2.2, 100 + i * 9, 40, 1.6);
  s += `<path d="${st}" fill="#000" opacity=".35"/>`;
  s += `<path d="${PISTOL.slide}${PISTOL.rsight}${PISTOL.fsight}${PISTOL.muzzle}" fill="${slideFill}" stroke="${ink}" stroke-width="${line}" stroke-linejoin="round"/>`;
  s += `<path d="${PISTOL.vents}" fill="${ink}" opacity=".85"/>`;
  s += `<path d="${rectD(48, 14, 230, 2.4)}" fill="#fff" opacity=".55"/>`; // reflet de l'arête
  // cellule d'énergie et bande néon
  s += `<path d="${PISTOL.strip}" fill="${neon}" filter="${doc.blur(4)}" opacity=".9"/>`;
  s += `<path d="${PISTOL.strip}" fill="${neon}" stroke="${ink}" stroke-width="1.2"/>`;
  s += `<path d="${rectD(114, 32, 164, 1.6)}" fill="#fff" opacity=".7"/>`;
  s += `<circle cx="82" cy="34" r="9" fill="${neon}" filter="${doc.blur(5)}"/>`;
  s += `<circle cx="82" cy="34" r="7" fill="${neon}" stroke="${ink}" stroke-width="2"/><circle cx="80" cy="32" r="2.6" fill="#fff" opacity=".85"/>`;
  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Blocs du logo
// ════════════════════════════════════════════════════════════════════════════

/**
 * Titre « MAFIA WARS Ⅱ » : MAFIA WARS en chrome à liseré néon (cramoisi → cyan), Ⅱ en or.
 * Renvoie le balisage et la boîte englobante du bloc.
 */
function titleBlock(doc, { cx, baseline, size, outline, rimW, neonW, glow, shadow, sparkles = true, gap = 0.34, numScale = 1.16, text = 'MAFIA WARS' }) {
  const cap = CAP * size;
  const t = setText(FONTS.title, text, { size, tracking: -0.015 });
  const tb = bboxOf(t.cmds);
  const nh = cap * numScale; // le Ⅱ dépasse un peu en haut et en bas
  const nn = numeralII(0, 0, nh);
  const total = tb.w + gap * size + nn.w;
  const left = cx - total / 2;
  const cmds = xform(t.cmds, Mx.t(left - tb.x1, baseline));
  const nb = baseline + (nh - cap) / 2;
  const num = numeralII(left + tb.w + gap * size - nn.left, nb, nh);
  const x1 = left, x2 = left + total;
  const neon = { fill: doc.linear(RIVAL, { x1, y1: 0, x2, y2: 0, user: true, name: 'tn' }), width: neonW, glow, glowOpacity: 0.55, core: 0.5 };
  let s = metalText(doc, cmds, { top: baseline - cap, bottom: baseline, face: METAL.chrome, rim: METAL.chromeRim, outline, rimW, neon, shadow });
  const nbb = { x1: num.left, y1: num.top, x2: num.right, y2: num.bottom, w: num.right - num.left, h: nh };
  s += metalText(doc, num.d, {
    bbox: nbb, top: num.top, bottom: num.bottom, face: METAL.gold, rim: METAL.goldRim, ink: PALETTE.inkWarm, outline, rimW, shadow,
    neon: { fill: doc.linear([[0, '#ffc45a'], [1, '#ff8a2a']], { name: 'nn' }), width: neonW, glow, glowOpacity: 0.5, core: 0.55 }, hi: '#fffbe8', lo: '#3a1e04',
  });
  if (sparkles) {
    s += sparkle(doc, num.right + size * 0.02, num.top + nh * 0.04, size * 0.26, { glow: '#ffd27a' });
    s += sparkle(doc, x1 + size * 0.06, baseline - cap * 1.0, size * 0.2, { glow: '#ff9ab0', opacity: 0.8 });
  }
  return { markup: s, bbox: { x1, x2, y1: num.top, y2: num.bottom }, num };
}

/** Plaque scindée (cramoisi | marine) en forme de lame hexagonale, liseré or / argent, filets néon. */
function splitPlate(doc, { cx, cy, half, h, line = 3, glow = 10 }) {
  const t = h * 0.42; // pointe
  const shape = (inset) => polyD([[cx - half - t + inset * 1.6, cy], [cx - half + inset * 0.6, cy - h / 2 + inset], [cx + half - inset * 0.6, cy - h / 2 + inset], [cx + half + t - inset * 1.6, cy], [cx + half - inset * 0.6, cy + h / 2 - inset], [cx - half + inset * 0.6, cy + h / 2 - inset]]);
  const outer = shape(0);
  const id = doc.path(outer, 'plate');
  const L = doc.clip(rectD(cx - half - t - 40, cy - h, half + t + 40, 2 * h));
  const R = doc.clip(rectD(cx, cy - h, half + t + 40, 2 * h));
  const region = [r1(cx - half - t - 80), r1(cy - h - 60), r1(2 * (half + t + 80)), r1(2 * h + 120)];
  let s = '';
  s += use(id, `fill="#000" opacity=".6" transform="translate(0,${r2(h * 0.08)})" filter="${doc.blur(h * 0.09, region)}"`);
  // halos néon de chaque camp
  s += `<g clip-path="${L}">${use(id, `fill="none" stroke="${DAD.neon}" stroke-width="${r2(line * 3.4)}" opacity=".6" filter="${doc.blur(glow, region)}"`)}</g>`;
  s += `<g clip-path="${R}">${use(id, `fill="none" stroke="${EVE.neon}" stroke-width="${r2(line * 3.4)}" opacity=".6" filter="${doc.blur(glow, region)}"`)}</g>`;
  s += use(id, `fill="${PALETTE.ink}" stroke="${PALETTE.ink}" stroke-width="${r2(line * 3.2)}" stroke-linejoin="round"`);
  s += `<g clip-path="${L}">${use(id, `fill="${doc.linear([[0, '#ff4057'], [0.18, '#d4142f'], [0.62, '#8a0c1e'], [1, '#3e0610']], { x1: 0, y1: cy - h / 2, x2: 0, y2: cy + h / 2, user: true })}"`)}</g>`;
  s += `<g clip-path="${R}">${use(id, `fill="${doc.linear([[0, '#4a78d6'], [0.18, '#24438a'], [0.62, '#132a5c'], [1, '#081433']], { x1: 0, y1: cy - h / 2, x2: 0, y2: cy + h / 2, user: true })}"`)}</g>`;
  // trame de lignes fines (écran holographique) et reflet supérieur
  const pat = doc.id('scan');
  doc.def(`<pattern id="${pat}" width="8" height="${r2(h / 16)}" patternUnits="userSpaceOnUse"><rect width="8" height="${r2(h / 40)}" fill="#000" opacity=".22"/></pattern>`);
  s += use(id, `fill="url(#${pat})"`);
  s += `<path d="${polyD([[cx - half + 2, cy - h / 2 + 3], [cx + half - 2, cy - h / 2 + 3], [cx + half - 12, cy - h * 0.12], [cx - half + 12, cy - h * 0.12]])}" fill="${doc.linear([[0, '#fff', 0.34], [1, '#fff', 0]])}"/>`;
  // liserés or (gauche) et argent (droite), filets néon intérieurs
  s += `<g clip-path="${L}">${use(id, `fill="none" stroke="${doc.linear(METAL.goldRim, { x1: 0, y1: cy - h / 2, x2: 0, y2: cy + h / 2, user: true })}" stroke-width="${r2(line * 1.3)}" stroke-linejoin="round"`)}</g>`;
  s += `<g clip-path="${R}">${use(id, `fill="none" stroke="${doc.linear(METAL.silverRim, { x1: 0, y1: cy - h / 2, x2: 0, y2: cy + h / 2, user: true })}" stroke-width="${r2(line * 1.3)}" stroke-linejoin="round"`)}</g>`;
  const innerD = shape(h * 0.13);
  s += `<g clip-path="${L}">${neonPath(doc, innerD, { color: '#ff5a70', width: line * 0.55, glow: line * 1.6, coreOpacity: 0.5, region })}</g>`;
  s += `<g clip-path="${R}">${neonPath(doc, innerD, { color: '#6fe4ff', width: line * 0.55, glow: line * 1.6, coreOpacity: 0.5, region })}</g>`;
  return s;
}

/** Écusson hexagonal « VS » : moitiés cramoisi / marine, liseré chromé, lettres chromées au halo violet. */
function vsBadge(doc, { cx, cy, r, line = 3 }) {
  const hex = (rr) => polyD(ngonPts(cx, cy, rr, 6, -90));
  const id = doc.path(hex(r), 'hex');
  const L = doc.clip(rectD(cx - r * 2, cy - r * 2, r * 2, r * 4));
  const R = doc.clip(rectD(cx, cy - r * 2, r * 2, r * 4));
  const region = [r1(cx - r * 2), r1(cy - r * 2), r1(r * 4), r1(r * 4)];
  let s = use(id, `fill="#000" opacity=".65" transform="translate(0,${r2(r * 0.08)})" filter="${doc.blur(r * 0.1, region)}"`);
  s += use(id, `fill="none" stroke="${doc.linear(RIVAL, { x1: 0, y1: 0, x2: 1, y2: 0 })}" stroke-width="${r2(line * 4)}" opacity=".7" filter="${doc.blur(r * 0.11, region)}"`);
  s += use(id, `fill="${PALETTE.ink}" stroke="${PALETTE.ink}" stroke-width="${r2(r * 0.2)}" stroke-linejoin="round"`);
  s += use(id, `fill="none" stroke="${doc.linear(METAL.chromeRim, { x1: 0, y1: cy - r, x2: 0, y2: cy + r, user: true })}" stroke-width="${r2(r * 0.09)}" stroke-linejoin="round"`);
  s += `<g clip-path="${L}"><path d="${hex(r * 0.9)}" fill="${doc.linear(METAL.crimson)}"/></g>`;
  s += `<g clip-path="${R}"><path d="${hex(r * 0.9)}" fill="${doc.linear(METAL.navy)}"/></g>`;
  s += `<path d="${hex(r * 0.9)}" fill="${doc.radial([[0, '#000', 0], [0.7, '#000', 0.15], [1, '#000', 0.55]])}"/>`;
  s += neonPath(doc, hex(r * 0.76), { color: '#d68bff', width: line * 0.5, glow: line * 1.4, coreOpacity: 0.5, region });
  const size = r * 0.84, cap = CAP * size;
  const vs = placeText(setText(FONTS.title, 'VS', { size, tracking: -0.02 }), cx, cy + cap / 2);
  s += metalText(doc, vs, { top: cy - cap / 2, bottom: cy + cap / 2, outline: r * 0.09, rimW: r * 0.035, inner: 0, shadow: { dx: 0, dy: r * 0.04, blur: r * 0.05, opacity: 0.7 }, neon: { fill: '#c36bff', width: r * 0.03, glow: r * 0.08, glowOpacity: 0.9 }, bevel: 0.03 });
  return s;
}

/** Les noms des parrains sur la plaque : DADOU en or (gauche), EVEN en argent (droite). */
function namesOnPlate(doc, { cx, cy, half, gapR, size }) {
  const cap = CAP * size;
  const off = (half + gapR) / 2;
  const style = { top: cy - cap / 2, bottom: cy + cap / 2, outline: size * 0.13, rimW: size * 0.05, inner: 0, shadow: { dx: 0, dy: size * 0.06, blur: size * 0.06, opacity: 0.7 }, bevel: 0.03 };
  let s = metalText(doc, placeText(setText(FONTS.title, 'DADOU', { size, tracking: 0.1 }), cx - off, cy + cap / 2), { ...style, face: METAL.gold, rim: METAL.goldRim, ink: PALETTE.inkWarm, hi: '#fffbe8', lo: '#3a1e04' });
  s += metalText(doc, placeText(setText(FONTS.title, 'EVEN', { size, tracking: 0.1 }), cx + off, cy + cap / 2), { ...style, face: METAL.silver, rim: METAL.silverRim });
  return s;
}

/** Sous-titre complet : plaque + noms + écusson VS. */
function subtitleBlock(doc, { cx, cy, half, h, badgeR, nameSize, line = 3, glow = 10 }) {
  let s = splitPlate(doc, { cx, cy, half, h, line, glow });
  s += namesOnPlate(doc, { cx, cy, half, gapR: badgeR, size: nameSize });
  s += vsBadge(doc, { cx, cy, r: badgeR, line });
  return s;
}

/**
 * Deux pistolets canon contre canon derrière l'écusson VS (or pour Dadou à gauche, chrome pour
 * Even à droite, miroir). Renvoie le balisage et la boîte englobante (pour cadrer le document).
 */
function crossedPistols(doc, { cx, cy, angle = -40, scale = 1, gap = 6 }) {
  const [mx, my] = PISTOL.muzzleTip;
  let markup = '';
  let bb = null;
  // côté gauche (corps du pistolet à gauche, canon vers le haut à droite) : Dadou ; à droite, son reflet : Even
  for (const side of [-1, 1]) {
    const m = Mx.chain(Mx.t(cx + side * gap, cy - 4), Mx.s(-side, 1), Mx.r(angle), Mx.s(scale), Mx.t(-mx, -my));
    markup += `<g transform="matrix(${m.map(r2).join(' ')})">${pistol(doc, { finish: side < 0 ? 'gold' : 'chrome' })}</g>`;
    const b = bboxOf(xform(parseD(PISTOL.silhouette), m));
    bb = bb ? { x1: Math.min(bb.x1, b.x1), y1: Math.min(bb.y1, b.y1), x2: Math.max(bb.x2, b.x2), y2: Math.max(bb.y2, b.y2) } : b;
  }
  return { markup, bbox: bb };
}

/** Chapeau d'un parrain en métal sombre, liseré de son néon (melon : Dadou ; haut-de-forme : Even). */
function hatIcon(doc, { x, y, s, kind, line = 3, rot = 0 }) {
  const H = kind === 'bowler' ? BOWLER : TOPHAT;
  const D = kind === 'bowler';
  const ink = D ? PALETTE.inkWarm : PALETTE.ink;
  const neon = D ? DAD.neon : EVE.neon;
  const m = `translate(${r2(x)},${r2(y)}) rotate(${rot}) scale(${r2(s)})`;
  const all = H.crown + H.brim;
  const felt = doc.linear(D ? [[0, '#3a2226'], [0.5, '#1a0c0f'], [1, '#080304']] : [[0, '#2c3a5c'], [0.5, '#121a30'], [1, '#05080f']], { name: 'felt' });
  const band = doc.linear(D ? METAL.crimson : METAL.silverFlat, { name: 'band' });
  let o = `<g transform="${m}">`;
  o += `<path d="${all}" fill="none" stroke="${neon}" stroke-width="${r2((line * 4) / s)}" stroke-linejoin="round" opacity=".9" filter="${doc.blur(7 / s)}"/>`;
  o += `<path d="${all}" fill="${ink}" stroke="${ink}" stroke-width="${r2((line * 2.4) / s)}" stroke-linejoin="round"/>`;
  o += `<path d="${H.crown}" fill="${felt}"/>`;
  o += `<path d="${H.band}" fill="${band}"/>`;
  o += `<path d="${H.brim}" fill="${felt}"/>`;
  o += `<path d="${H.shine}" fill="#fff" opacity=".22"/>`;
  o += `<path d="${all}" fill="none" stroke="${D ? METAL.goldFlat[1][1] : EVE.silver}" stroke-width="${r2(line / s)}" stroke-linejoin="round" opacity=".75"/>`;
  return o + '</g>';
}

/**
 * Panneau publicitaire holographique (aucune marque réelle) : fond translucide, trame, liseré
 * lumineux et pictogramme — chapeau melon de Dadou, haut-de-forme d'Even, barres ou chevrons.
 */
function holoBillboard(doc, { x, y, w, h, color, icon = 'bars', opacity = 1 }) {
  const u = Math.min(w, h);
  let s = `<g opacity="${opacity}">`;
  s += `<rect x="${r1(x - u * 0.15)}" y="${r1(y - u * 0.15)}" width="${r1(w + u * 0.3)}" height="${r1(h + u * 0.3)}" fill="${color}" opacity=".4" filter="${doc.blur(u * 0.18)}"/>`;
  s += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${doc.linear([[0, color, 0.85], [1, color, 0.3]])}"/>`;
  let lines = '';
  for (let yy = y + 1.5; yy < y + h; yy += Math.max(2.2, h / 18)) lines += rectD(x, yy, w, Math.max(0.5, h / 70));
  s += `<path d="${lines}" fill="#000" opacity=".25"/>`;
  const cx = x + w / 2, cy = y + h / 2;
  if (icon === 'bowler' || icon === 'tophat') {
    const H = icon === 'bowler' ? BOWLER : TOPHAT;
    const k = (icon === 'bowler' ? Math.min(w / 190, h / 110) : Math.min(w / 175, h / 175)) * 1.0;
    const by = cy + (icon === 'bowler' ? 30 : 62) * k;
    s += `<path d="${H.crown}${H.brim}" fill="#fff" opacity=".92" transform="translate(${r2(cx)},${r2(by)}) scale(${r2(k)})"/>`;
    s += `<path d="${H.band}" fill="${color}" transform="translate(${r2(cx)},${r2(by)}) scale(${r2(k)})"/>`;
  } else if (icon === 'chevron') {
    s += `<path d="${polyD([[cx - w * 0.3, cy - h * 0.25], [cx, cy + h * 0.05], [cx + w * 0.3, cy - h * 0.25], [cx + w * 0.3, cy], [cx, cy + h * 0.3], [cx - w * 0.3, cy]])}" fill="#fff" opacity=".85"/>`;
  } else {
    let bars = '';
    for (let k = 0; k < 4; k++) bars += rectD(x + w * 0.16, y + h * (0.2 + k * 0.17), w * (0.68 - (k % 2) * 0.26), h * 0.08);
    s += `<path d="${bars}" fill="#fff" opacity=".8"/>`;
  }
  s += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="none" stroke="#fff" stroke-width="${r2(Math.max(0.8, u * 0.03))}" opacity=".7"/>`;
  return s + '</g>';
}

/** Halo circulaire holographique derrière la ville (anneau néon dégradé + voile intérieur). */
function holoRing(doc, { cx, cy, r, width = 6, fadeFrom = null, fadeTo = null }) {
  const region = [r1(cx - r - 120), r1(cy - r - 120), r1(2 * r + 240), r1(2 * r + 240)];
  const grad = doc.linear(RIVAL, { x1: cx - r, y1: 0, x2: cx + r, y2: 0, user: true, name: 'ring' });
  let mask = '';
  if (fadeFrom !== null) {
    const id = doc.id('ringm');
    doc.def(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${region[0]}" y="${region[1]}" width="${region[2]}" height="${region[3]}"><rect x="${region[0]}" y="${region[1]}" width="${region[2]}" height="${region[3]}" fill="${doc.linear([[0, '#fff'], [1, '#000']], { x1: 0, y1: fadeFrom, x2: 0, y2: fadeTo, user: true })}"/></mask>`);
    mask = ` mask="url(#${id})"`;
  }
  let s = `<g${mask}>`;
  s += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${doc.radial([[0, '#2a0f3a', 0.0], [0.6, '#3a1258', 0.16], [0.94, '#6a2a96', 0.26], [1, '#6a2a96', 0]])}"/>`;
  // lignes de balayage à l'intérieur de l'anneau
  const clip = doc.clip(circleD(cx, cy, r));
  let lines = '';
  for (let y = cy - r; y < cy + r; y += 9) lines += rectD(cx - r, y, 2 * r, 1.2);
  s += `<g clip-path="${clip}"><path d="${lines}" fill="${grad}" opacity=".16"/></g>`;
  s += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="none" stroke="${grad}" stroke-width="${width * 3}" opacity=".5" filter="${doc.blur(width * 2.2, region)}"/>`;
  s += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="none" stroke="${grad}" stroke-width="${width}"/>`;
  s += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="none" stroke="#fff" stroke-width="${r2(width * 0.35)}" opacity=".6"/>`;
  // graduations (cadran de visée) en haut de l'anneau
  let ticks = '';
  for (let i = -9; i <= 9; i++) {
    const a = (-90 + i * 5) * DEG, l = i % 3 === 0 ? 16 : 8;
    const x1 = cx + Math.cos(a) * (r + 10), y1 = cy + Math.sin(a) * (r + 10), x2 = cx + Math.cos(a) * (r + 10 + l), y2 = cy + Math.sin(a) * (r + 10 + l);
    ticks += `M${r2(x1)} ${r2(y1)}L${r2(x2)} ${r2(y2)}`;
  }
  s += `<path d="${ticks}" stroke="${grad}" stroke-width="2.4" opacity=".8"/>`;
  return s + '</g>';
}

/**
 * Skyline de 2085 au-dessus du titre : flèche « Empire State » au centre, couronne « Chrysler »
 * à droite, tours futuristes, châteaux d'eau ; liseré cramoisi à gauche, cyan à droite ;
 * fondu vers les côtés et vers le sol (caché derrière le titre).
 */
function logoSkyline(doc, { cx, ground, s, width, fadeTop, fadeBottom }) {
  const X = (u) => cx + u * s;
  const rand = rng(2085);
  let d = '';
  const wins = [];
  const towers = [];
  const add = (shape, rect) => { d += shape; if (rect) towers.push(rect); };
  // centre : Empire State
  const es = empireSpire(X(0), ground, s);
  d += es.d;
  for (const b of es.blocks.slice(0, 3)) wins.push(...windowGrid(rand, b[0] + 3 * s, b[1] + 4 * s, b[2] - 6 * s, b[3] - 8 * s, { s, p: 0.32 }));
  // droite : Chrysler
  const ch = chryslerSpire(X(232), ground, s * 0.94);
  d += ch.d;
  wins.push(...windowGrid(rand, X(232) - 32 * s, ground - 246 * s, 64 * s, 240 * s, { s, p: 0.28 }));
  // tours de 2085 (largeur, hauteur, pente) — de part et d'autre
  const left = [[-150, 66, 330, 26], [-262, 58, 400, -34], [-360, 76, 250, 0], [-452, 54, 300, 18], [-540, 70, 200, 0], [-620, 50, 150, 0], [-90, 44, 200, 0]];
  const right = [[132, 46, 210, 0], [338, 70, 300, -22], [432, 52, 360, 30], [520, 74, 230, 0], [608, 52, 170, 0], [680, 46, 120, 0]];
  for (const [u, w, h, sl] of [...left, ...right]) {
    const x = X(u), ww = w * s, hh = h * s;
    add(slabTower(x, ground, ww, hh, sl * s), [x - ww / 2, ground - hh, ww, hh]);
    wins.push(...windowGrid(rand, x - ww / 2 + 3 * s, ground - hh + Math.max(0, sl * s) + 8 * s, ww - 6 * s, hh - 12 * s, { s, p: 0.26 }));
  }
  // une tour à gradins et antenne de chaque côté
  const st1 = stepTower(X(-305), ground, 62 * s, 330 * s, s, { antenna: 60 });
  const st2 = stepTower(X(380), ground, 60 * s, 300 * s, s, { antenna: 70 });
  d += st1.d + st2.d;
  // châteaux d'eau sur les toits bas
  d += waterTower(X(-600), ground - 150 * s, s) + waterTower(X(-530), ground - 200 * s, s * 1.1) + waterTower(X(608), ground - 170 * s, s) + waterTower(X(670), ground - 120 * s, s * 0.9);

  const sil = doc.path(d, 'sky');
  const fillGrad = doc.linear([[0, '#1b1d34'], [0.55, '#0e0f1e'], [1, '#07070f']], { x1: 0, y1: ground - 600 * s, x2: 0, y2: ground, user: true });
  // masque : fondu sur les côtés et vers le sol
  const maskId = doc.id('skym');
  const hg = doc.linear([[0, '#000'], [0.14, '#fff'], [0.86, '#fff'], [1, '#000']], { x1: cx - width / 2, y1: 0, x2: cx + width / 2, y2: 0, user: true });
  const vg = doc.linear([[0, '#000', 0], [1, '#000', 1]], { x1: 0, y1: fadeTop, x2: 0, y2: fadeBottom, user: true });
  const mx = r1(cx - width / 2 - 10), my = r1(ground - 760 * s), mw = r1(width + 20), mh = r1(760 * s + 40);
  doc.def(`<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${mx}" y="${my}" width="${mw}" height="${mh}"><rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="${hg}"/><rect x="${mx}" y="${r1(fadeTop)}" width="${mw}" height="${r1(ground - fadeTop + 40)}" fill="${vg}"/></mask>`);
  const clipL = doc.clip(rectD(cx - width, ground - 900 * s, width, 900 * s + 50));
  const clipR = doc.clip(rectD(cx, ground - 900 * s, width, 900 * s + 50));

  let out = `<g mask="url(#${maskId})">`;
  // lueur de la ville derrière les toits
  out += `<ellipse cx="${cx}" cy="${r1(ground - 90 * s)}" rx="${r1(width * 0.3)}" ry="${r1(170 * s)}" fill="${doc.radial([[0, '#ff4fa8', 0.34], [0.55, '#8a3cff', 0.1], [1, '#3a1a80', 0]])}"/>`;
  // liserés : cramoisi (gauche), cyan (droite), magenta au sommet
  out += `<g clip-path="${clipL}">${use(sil, `fill="${DAD.neon}" transform="translate(${r2(-2.6 * s)},${r2(-1.6 * s)})"`)}</g>`;
  out += `<g clip-path="${clipR}">${use(sil, `fill="${EVE.neon}" transform="translate(${r2(2.6 * s)},${r2(-1.6 * s)})"`)}</g>`;
  out += use(sil, `fill="${fillGrad}"`);
  // fenêtres : chaudes et froides
  const warm = [], cool = [], pink = [];
  wins.forEach((w, i) => { const r = rand(); (r < 0.55 ? warm : r < 0.9 ? cool : pink).push(w); });
  const wd = (arr) => arr.map(([x, y, w, h]) => rectD(x, y, w, h)).join('');
  out += `<path d="${wd(warm)}" fill="#ffd9a0" opacity=".55"/><path d="${wd(cool)}" fill="#9fe6ff" opacity=".5"/><path d="${wd(pink)}" fill="#ff8ad8" opacity=".6"/>`;
  // piliers de l'Empire State et fenêtres triangulaires de la couronne
  out += `<path d="${es.piers}" fill="#8aa0ff" opacity=".22"/>`;
  out += `<path d="${ch.tri}" fill="#fff4d8" opacity=".85"/>`;
  out += `<path d="${ch.tri}" fill="#ffd27a" opacity=".6" filter="${doc.blur(3 * s)}"/>`;
  // feux rouges d'obstacle au sommet des flèches
  for (const [x, y] of [es.tip, ch.tip, [X(-305), st1.tip], [X(380), st2.tip]]) {
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(9 * s)}" fill="${doc.radial([[0, '#ff4a4a', 0.9], [1, '#ff2a2a', 0]])}"/><circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(2.2 * s)}" fill="#ffd0d0"/>`;
  }
  // panneaux holographiques (propagande des deux parrains) et enseignes verticales
  out += holoBillboard(doc, { x: X(-262) - 22 * s, y: ground - 336 * s, w: 44 * s, h: 58 * s, color: '#ff2a4d', icon: 'bowler' });
  out += holoBillboard(doc, { x: X(432) - 21 * s, y: ground - 312 * s, w: 42 * s, h: 62 * s, color: '#4fd8ff', icon: 'tophat' });
  out += holoBillboard(doc, { x: X(-452) - 17 * s, y: ground - 236 * s, w: 34 * s, h: 44 * s, color: '#ffb340', icon: 'bars' });
  out += holoBillboard(doc, { x: X(338) - 22 * s, y: ground - 226 * s, w: 44 * s, h: 32 * s, color: '#b05cff', icon: 'chevron' });
  out += neonPath(doc, `M${r1(X(-150) + 30 * s)} ${r1(ground - 300 * s)}V${r1(ground - 150 * s)}`, { color: '#ff2a4d', width: 2.4 * s, glow: 6 * s });
  out += neonPath(doc, `M${r1(X(520) - 34 * s)} ${r1(ground - 220 * s)}V${r1(ground - 90 * s)}`, { color: '#4fd8ff', width: 2.4 * s, glow: 6 * s });
  out += '</g>';
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Constructeurs des fichiers
// ════════════════════════════════════════════════════════════════════════════

/** Logo principal — 2000 × 1160, transparent. */
function buildLogo() {
  const W = 2000, H = 1160, CX = W / 2;
  const doc = new Svg('mwl', W, H);
  const size = 214, baseline = 676, capTop = baseline - CAP * size;
  let body = '';
  body += holoRing(doc, { cx: CX, cy: capTop - 150, r: 300, width: 5, fadeFrom: capTop - 60, fadeTo: capTop + 10 });
  body += logoSkyline(doc, { cx: CX, ground: capTop + 70, s: 0.84, width: 1640, fadeTop: capTop - 70, fadeBottom: capTop + 50 });
  body += titleBlock(doc, { cx: CX, baseline, size, outline: 11, rimW: 5, neonW: 3.6, glow: 9 }).markup;
  const rowY = 842;
  const guns = crossedPistols(doc, { cx: CX, cy: rowY, angle: -40, scale: 0.92 });
  if (process.env.MW_DEBUG) console.log('    pistolets :', JSON.stringify(guns.bbox));
  body += guns.markup;
  body += subtitleBlock(doc, { cx: CX, cy: rowY, half: 520, h: 98, badgeR: 82, nameSize: 62, line: 3, glow: 12 });
  body += hatIcon(doc, { x: CX - 520 - 92, y: rowY + 4, s: 0.86, kind: 'bowler', rot: -10 });
  body += hatIcon(doc, { x: CX + 520 + 92, y: rowY + 8, s: 0.8, kind: 'tophat', rot: 10 });
  return doc.render(body, { desc: 'Logo principal du jeu MAFIA WARS II : Dadou vs Even (New York, 2085).' });
}

/** Logo compact — 1200 × 380, transparent : titre + plaque, sans décor. */
function buildCompact() {
  const W = 1200, H = 380, CX = W / 2;
  const doc = new Svg('mwc', W, H);
  const size = 124, baseline = 186;
  let body = titleBlock(doc, { cx: CX, baseline, size, outline: 7.5, rimW: 3.4, neonW: 2.6, glow: 6, shadow: { dx: 0, dy: 5, blur: 5, opacity: 0.6 }, sparkles: false }).markup;
  body += subtitleBlock(doc, { cx: CX, cy: 300, half: 330, h: 64, badgeR: 54, nameSize: 42, line: 2.4, glow: 8 });
  return doc.render(body, { desc: 'Logo compact — MAFIA WARS II : Dadou vs Even.' });
}


/** Tuile sombre arrondie teintée cramoisi | cyan, filet néon « rivalité » (fond de l'icône). */
function iconTile(doc, S, { radius = 0.22, frame = true } = {}) {
  const r = S * radius;
  const tile = radius ? `M${r} 0H${S - r}A${r} ${r} 0 0 1 ${S} ${r}V${S - r}A${r} ${r} 0 0 1 ${S - r} ${S}H${r}A${r} ${r} 0 0 1 0 ${S - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z` : rectD(0, 0, S, S);
  const clip = doc.clip(tile);
  let s = `<g clip-path="${clip}">`;
  s += `<rect width="${S}" height="${S}" fill="${doc.linear([[0, '#141433'], [0.55, '#0a0a1c'], [1, '#04040b']])}"/>`;
  s += `<rect width="${S}" height="${S}" fill="${doc.radial([[0, DAD.neon, 0.55], [0.5, DAD.crimson, 0.2], [1, DAD.crimson, 0]], { cx: 0.02, cy: 0.98, r: 0.8 })}"/>`;
  s += `<rect width="${S}" height="${S}" fill="${doc.radial([[0, EVE.neon, 0.5], [0.5, '#2b5fd0', 0.2], [1, '#2b5fd0', 0]], { cx: 0.98, cy: 0.98, r: 0.8 })}"/>`;
  // trame de lignes (écran)
  let lines = '';
  for (let y = 0; y < S; y += S / 96) lines += rectD(0, y, S, S / 420);
  s += `<path d="${lines}" fill="#000" opacity=".3"/>`;
  s += '</g>';
  if (frame) {
    const i = S * 0.03, w = S * 0.012;
    const inner = (k) => { const rr = r - k; return `M${r} ${k}H${S - r}A${rr} ${rr} 0 0 1 ${S - k} ${r}V${S - r}A${rr} ${rr} 0 0 1 ${S - r} ${S - k}H${r}A${rr} ${rr} 0 0 1 ${k} ${S - r}V${r}A${rr} ${rr} 0 0 1 ${r} ${k}Z`; };
    s += neonPath(doc, inner(i), { color: doc.linear(RIVAL, { x1: 0, y1: 0, x2: 1, y2: 0 }), width: w, glow: w * 2.5, core: '#fff', coreOpacity: 0.45 });
  }
  return s;
}

/** Monogramme « MW Ⅱ » : MW en chrome à liseré néon, Ⅱ en or. */
function monogram(doc, { cx, baseline, size, outline, rimW, neonW, glow, shadow }) {
  return titleBlock(doc, { cx, baseline, size, outline, rimW, neonW, glow, shadow, sparkles: false, text: 'MW', gap: 0.16, numScale: 1.14 });
}

/**
 * Icône d'application — 512 × 512 : anneau holographique et flèche « Empire State » au-dessus
 * du monogramme MW Ⅱ. square=true → carré plein cadre sans filet (apple-touch-icon : iOS arrondit lui-même).
 */
function buildIcon({ square = false } = {}) {
  const S = 512, C = S / 2;
  const doc = new Svg(square ? 'mwa' : 'mwi', S, S);
  let body = iconTile(doc, S, { radius: square ? 0 : 0.22, frame: !square });
  const ringY = 196, ringR = 128;
  body += holoRing(doc, { cx: C, cy: ringY, r: ringR, width: 4, fadeFrom: ringY + ringR * 0.55, fadeTo: ringY + ringR * 0.95 });
  // ville miniature dans l'anneau
  const g = ringY + ringR * 0.8, s = 0.36;
  const es = empireSpire(C, g, s);
  const ch = chryslerSpire(C + 62, g, s * 0.92);
  let sky = es.d + ch.d + slabTower(C - 52, g, 26, 120, 10) + slabTower(C - 88, g, 30, 80, 0) + slabTower(C + 98, g, 28, 92, -8) + slabTower(C + 30, g, 20, 70, 0) + stepTower(C - 116, g, 24, 60, s, { antenna: 0 }).d + slabTower(C + 124, g, 22, 56, 0);
  const clip = doc.clip(circleD(C, ringY, ringR - 3));
  const skyId = doc.path(sky, 'isky');
  body += `<g clip-path="${clip}">`;
  body += use(skyId, `fill="${DAD.neon}" transform="translate(-2,-1.5)"`) + use(skyId, `fill="${EVE.neon}" transform="translate(2,-1.5)"`);
  body += use(skyId, `fill="${doc.linear([[0, '#1d1d3a'], [1, '#0a0a18']])}"`);
  body += `<path d="${ch.tri}" fill="#fff1cc" opacity=".9"/>`;
  body += `<rect x="${C - ringR}" y="${g - 2}" width="${2 * ringR}" height="${ringR}" fill="#07071a"/>`;
  body += '</g>';
  body += `<circle cx="${r1(es.tip[0])}" cy="${r1(es.tip[1])}" r="7" fill="${doc.radial([[0, '#ff4a4a', 0.9], [1, '#ff2a2a', 0]])}"/>`;
  body += monogram(doc, { cx: C, baseline: 420, size: 150, outline: 10, rimW: 4.5, neonW: 3.4, glow: 8, shadow: { dx: 0, dy: 6, blur: 6, opacity: 0.7 } }).markup;
  return doc.render(body, { title: 'MAFIA WARS II', desc: 'Icône — MAFIA WARS II : Dadou vs Even.' });
}

/**
 * Favicon — dessiné pour 16 et 32 px : tuile scindée cramoisi | marine, filet néon, et le
 * chiffre Ⅱ doré cerné de noir (lisible même en 16 px).
 */
function buildFavicon() {
  const S = 64, C = S / 2;
  const doc = new Svg('mwf', S, S);
  const tile = `M14 0H50A14 14 0 0 1 64 14V50A14 14 0 0 1 50 64H14A14 14 0 0 1 0 50V14A14 14 0 0 1 14 0Z`;
  const clip = doc.clip(tile);
  let body = `<g clip-path="${clip}"><rect width="${C}" height="${S}" fill="${doc.linear([[0, '#e8213f'], [1, '#5c0a16']])}"/><rect x="${C}" width="${C}" height="${S}" fill="${doc.linear([[0, '#3a74e0'], [1, '#0a1533']])}"/>`;
  body += `<rect width="${S}" height="${S}" fill="${doc.radial([[0.5, '#000', 0], [1, '#000', 0.45]])}"/></g>`;
  body += `<path d="${tile}" fill="none" stroke="${doc.linear(RIVAL, { x1: 0, y1: 0, x2: 1, y2: 0 })}" stroke-width="3"/>`;
  const nn = numeralII(0, 0, 44);
  const n = numeralII(C - (nn.right - nn.left) / 2 - nn.left, C + 22, 44);
  const id = doc.path(n.d, 'n');
  body += use(id, `fill="${PALETTE.inkWarm}" stroke="${PALETTE.inkWarm}" stroke-width="5" stroke-linejoin="round"`);
  body += use(id, `fill="${doc.linear([[0, '#fff3c4'], [0.45, '#f5c04e'], [0.55, '#c7861e'], [1, '#ffd679']], { x1: 0, y1: C - 22, x2: 0, y2: C + 22, user: true })}"`);
  return doc.render(body, { title: 'MAFIA WARS II', desc: 'Favicon — MAFIA WARS II : Dadou vs Even.' });
}

/** Motif hexagonal (nid d'abeille) pour les champs des emblèmes ; renvoie `url(#id)`. */
function hexPattern(doc, { size = 14, color = '#fff', opacity = 0.1, width = 1 }) {
  const w = size * Math.sqrt(3), h = size * 3;
  const id = doc.id('hexp');
  const hex = (cx, cy) => polyD(ngonPts(cx, cy, size, 6, -90));
  doc.def(`<pattern id="${id}" width="${r2(w)}" height="${r2(h)}" patternUnits="userSpaceOnUse"><path d="${hex(w / 2, size)}${hex(0, size * 2.5)}${hex(w, size * 2.5)}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/></pattern>`);
  return `url(#${id})`;
}

/**
 * Emblème de faction — 512 × 512, transparent. Même construction pour les deux camps :
 * anneau néon, couronne métallique crantée, bande sombre lettrée (« LA MAFIA DE DADOU » /
 * « LA MAFIA D’EVEN », « NEW YORK ◆ 2085 »), champ émaillé à nid d'abeille et skyline, puis la
 * charge : chapeau melon et moustache en guidon (Dadou : cramoisi, noir, or) ou haut-de-forme,
 * monocle cybernétique et barbe grise (Even : marine, argent, cyan).
 */
function buildEmblem(faction) {
  const D = faction === 'dadou';
  const S = 512, C = S / 2;
  const doc = new Svg(D ? 'emd' : 'eme', S, S);
  const neon = D ? DAD.neon : EVE.neon;
  const ink = D ? PALETTE.inkWarm : PALETTE.ink;
  const rimG = D ? METAL.goldRim : METAL.silverRim;
  const flat = doc.linear(D ? METAL.goldFlat : METAL.silverFlat, { name: 'ef' });
  const R0 = 240, R1 = 226, R2 = 176, R3 = 164; // couronne / bande / anneau intérieur / champ
  const region = [0, 0, S, S];
  let b = '';
  b += `<circle cx="${C}" cy="${C + 6}" r="${R0}" fill="#000" opacity=".5" filter="${doc.blur(6, region)}"/>`;
  // anneau néon extérieur
  b += `<circle cx="${C}" cy="${C}" r="${R0 + 4}" fill="none" stroke="${neon}" stroke-width="10" opacity=".75" filter="${doc.blur(7, region)}"/>`;
  b += `<circle cx="${C}" cy="${C}" r="${R0}" fill="${ink}"/>`;
  b += `<circle cx="${C}" cy="${C}" r="${R0 + 1}" fill="none" stroke="${neon}" stroke-width="3.2"/>`;
  b += `<circle cx="${C}" cy="${C}" r="${R0 + 1}" fill="none" stroke="#fff" stroke-width="1.1" opacity=".6"/>`;
  // couronne métallique crantée
  b += `<circle cx="${C}" cy="${C}" r="${(R0 + R1) / 2}" fill="none" stroke="${doc.linear(rimG, { name: 'er' })}" stroke-width="${R0 - R1 - 3}"/>`;
  let notches = '';
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * 360;
    const m = Mx.chain(Mx.t(C, C), Mx.r(a));
    const [x1, y1] = Mx.apply(m, R1 + 1.5, -1.6), [x2, y2] = Mx.apply(m, R0 - 2, -1.6), [x3, y3] = Mx.apply(m, R0 - 2, 1.6), [x4, y4] = Mx.apply(m, R1 + 1.5, 1.6);
    notches += polyD([[x1, y1], [x2, y2], [x3, y3], [x4, y4]]);
  }
  b += `<path d="${notches}" fill="${ink}" opacity=".7"/>`;
  // bande sombre
  const band = D ? [[0, '#2c0710'], [1, '#100306']] : [[0, '#0c1a3a'], [1, '#040914']];
  b += `<circle cx="${C}" cy="${C}" r="${R1}" fill="${doc.linear(band, { name: 'eb' })}" stroke="${ink}" stroke-width="3"/>`;
  // fines graduations de cadran dans la bande
  let ticks = '';
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * 2 * Math.PI, l = i % 10 === 0 ? 7 : 3.5;
    ticks += `M${r2(C + Math.cos(a) * (R1 - 4))} ${r2(C + Math.sin(a) * (R1 - 4))}L${r2(C + Math.cos(a) * (R1 - 4 - l))} ${r2(C + Math.sin(a) * (R1 - 4 - l))}`;
  }
  b += `<path d="${ticks}" stroke="${neon}" stroke-width="1.2" opacity=".45"/>`;
  // lettrage
  const size = 29, cap = CAP * size, mid = (R1 + R2) / 2 - 2;
  const ringFace = D ? [[0, '#fff2c4'], [0.5, '#f2bd55'], [1, '#c48a2c']] : [[0, '#ffffff'], [0.5, '#d9e1ec'], [1, '#9eabbd']];
  const txtStyle = { top: C - R1, bottom: C + R1, face: ringFace, rim: null, ink, outline: 3.6, inner: 0, shadow: { dx: 0, dy: 1.5, blur: 1.5, opacity: 0.8 }, bevel: 0, hiOpacity: 0, loOpacity: 0 };
  const topTxt = arcText(FONTS.bold, D ? 'LA MAFIA DE DADOU' : 'LA MAFIA D’EVEN', { size, tracking: 0.13, cx: C, cy: C, r: mid - cap / 2, centerAngle: -90, top: true });
  b += metalText(doc, topTxt.cmds, txtStyle);
  const rb = mid + cap / 2;
  const sub = (txt, ca) => arcText(FONTS.bold, txt, { size: size * 0.92, tracking: 0.16, cx: C, cy: C, r: rb, centerAngle: ca, top: false });
  const a1 = sub('NEW YORK', 90).angle, a2 = sub('2085', 90).angle, gapA = 9;
  const total = a1 + gapA + a2;
  b += metalText(doc, sub('NEW YORK', 90 + total / 2 - a1 / 2).cmds, txtStyle);
  b += metalText(doc, sub('2085', 90 - total / 2 + a2 / 2).cmds, txtStyle);
  const sepA = 90 + total / 2 - a1 - gapA / 2;
  // losanges séparateurs (bas, gauche, droite)
  for (const a of [sepA, 180, 0]) {
    const x = C + Math.cos(a * DEG) * mid, y = C + Math.sin(a * DEG) * mid;
    b += `<path d="${polyD([[x, y - 8], [x + 8, y], [x, y + 8], [x - 8, y]])}" fill="${flat}" stroke="${ink}" stroke-width="2"/>`;
  }
  // anneau intérieur
  b += `<circle cx="${C}" cy="${C}" r="${(R2 + R3) / 2}" fill="none" stroke="${ink}" stroke-width="${R2 - R3 + 5}"/>`;
  b += `<circle cx="${C}" cy="${C}" r="${(R2 + R3) / 2}" fill="none" stroke="${doc.linear(rimG, { name: 'eir' })}" stroke-width="${R2 - R3 - 3}"/>`;
  // champ émaillé
  const field = doc.clip(circleD(C, C, R3));
  const fieldStops = D ? [[0, '#e0263f'], [0.5, '#9a0c22'], [1, '#3a0510']] : [[0, '#3a68c4'], [0.5, '#16306a'], [1, '#071028']];
  b += `<g clip-path="${field}"><rect x="${C - R3}" y="${C - R3}" width="${2 * R3}" height="${2 * R3}" fill="${doc.radial(fieldStops, { cy: 0.38, r: 0.72 })}"/>`;
  b += `<rect x="${C - R3}" y="${C - R3}" width="${2 * R3}" height="${2 * R3}" fill="${hexPattern(doc, { size: 13, color: D ? '#ffb0b8' : '#9fe8ff', opacity: 0.14 })}"/>`;
  // skyline sombre au pied du champ
  const g = C + R3, k = 0.42;
  let city = empireSpire(C, g, k).d + chryslerSpire(C + 92, g, k * 0.85).d;
  for (const [u, w, h, sl] of [[-120, 40, 150, 14], [-74, 34, 110, 0], [-36, 30, 170, -10], [44, 30, 120, 0], [132, 38, 170, 16], [170, 30, 90, 0]]) city += slabTower(C + u, g, w, h, sl);
  b += `<path d="${city}" fill="${D ? '#2a0409' : '#050c22'}" opacity=".75"/>`;
  b += `<circle cx="${C}" cy="${C}" r="${R3}" fill="none" stroke="#000" stroke-width="30" opacity=".45" filter="${doc.blur(10)}"/></g>`;
  b += `<circle cx="${C}" cy="${C}" r="${R3}" fill="none" stroke="${neon}" stroke-width="1.6" opacity=".7"/>`;

  // la charge
  if (D) {
    const hy = C - 14, hs = 1.42;
    b += hatCharge(doc, { x: C, y: hy, s: hs, kind: 'bowler' });
    const mus = handlebarMustache(98, 30);
    const my = C + 62;
    const mid2 = doc.path(mus, 'mus');
    b += `<g transform="translate(${C},${my})">`;
    b += use(mid2, `fill="none" stroke="${neon}" stroke-width="10" opacity=".6" filter="${doc.blur(6)}"`);
    b += use(mid2, `fill="${ink}" stroke="${ink}" stroke-width="7" stroke-linejoin="round"`);
    b += use(mid2, `fill="${doc.linear(METAL.gold, { x1: 0, y1: -40, x2: 0, y2: 22, user: true })}"`);
    b += use(mid2, `fill="#fff" opacity=".35" transform="translate(0,-2.4) scale(.98)" mask="url(#${maskTop(doc, mid2)})"`);
    b += '</g>';
  } else {
    const hy = C - 28, hs = 0.92;
    b += hatCharge(doc, { x: C, y: hy, s: hs, kind: 'tophat' });
    // barbe grise et moustache sobre
    const nb = neatBeard();
    const by = C + 30, bs = 0.86;
    const beardId = doc.path(nb.beard + nb.stache, 'beard');
    b += `<g transform="translate(${C},${by}) scale(${bs})">`;
    b += use(beardId, `fill="none" stroke="${neon}" stroke-width="10" opacity=".55" filter="${doc.blur(6)}"`);
    b += use(beardId, `fill="${ink}" stroke="${ink}" stroke-width="8" stroke-linejoin="round"`);
    b += `<path d="${nb.beard}" fill="${doc.linear([[0, '#f4f7fb'], [0.3, '#c9d2de'], [0.62, '#98a4b6'], [1, '#6c788c']], { x1: 0, y1: -30, x2: 0, y2: 104, user: true })}"/>`;
    // mèches
    let strands = '';
    for (let i = -4; i <= 4; i++) strands += taperedStroke(sampleBeziers([[[i * 12, 22], [i * 13, 50], [i * 10, 72], [i * 6, 92 - Math.abs(i) * 6]]], 10), (t) => lerp(2.4, 0.4, t));
    b += `<path d="${strands}" fill="#5d6a80" opacity=".55"/>`;
    b += `<path d="M0 26C-2 40 -1 58 0 70" fill="none" stroke="#4e5a6e" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>`;
    b += `<path d="${nb.stache}" fill="${doc.linear(METAL.silverFlat, { x1: 0, y1: -12, x2: 0, y2: 18, user: true })}" stroke="${ink}" stroke-width="2.5"/>`;
    b += '</g>';
    // monocle cybernétique : anneau argent, verre cyan lumineux, réticule, chaînette
    const mx = C + 40, my = C + 4, mr = 24;
    b += `<circle cx="${mx}" cy="${my}" r="${mr + 8}" fill="${EVE.neon}" opacity=".45" filter="${doc.blur(8)}"/>`;
    b += `<circle cx="${mx}" cy="${my}" r="${mr}" fill="${doc.radial([[0, '#d8fbff'], [0.35, '#6fe8ff'], [1, '#1a6fb0']], { fx: 0.38, fy: 0.35 })}" stroke="${ink}" stroke-width="10"/>`;
    b += `<circle cx="${mx}" cy="${my}" r="${mr}" fill="none" stroke="${doc.linear(METAL.silverRim)}" stroke-width="5"/>`;
    b += `<path d="M${mx - mr * 0.6} ${my}H${mx - mr * 0.2}M${mx + mr * 0.2} ${my}H${mx + mr * 0.6}M${mx} ${my - mr * 0.6}V${my - mr * 0.2}M${mx} ${my + mr * 0.2}V${my + mr * 0.6}" stroke="#063a5a" stroke-width="2" opacity=".8"/>`;
    b += `<circle cx="${mx}" cy="${my}" r="${mr * 0.32}" fill="none" stroke="#063a5a" stroke-width="1.6" opacity=".7"/>`;
    let chain = '';
    sampleBeziers([[[mx + mr * 0.7, my + mr * 0.75], [mx + 52, my + 40], [mx + 66, my + 70], [mx + 92, my + 74]]], 11).forEach(([x, y]) => (chain += circleD(x, y, 2.4)));
    b += `<path d="${chain}" fill="${flat}" stroke="${ink}" stroke-width="1.2"/>`;
  }
  const name = D ? 'La Mafia de Dadou' : 'La Mafia d’Even';
  return doc.render(b, { title: name, desc: `Emblème de faction — ${name} (New York, 2085).` });
}

/** Masque « reflet » : la forme moins sa copie décalée vers le bas (arête supérieure éclairée). */
function maskTop(doc, id) {
  const m = doc.id('mt');
  doc.def(`<mask id="${m}" maskUnits="userSpaceOnUse" x="-300" y="-300" width="600" height="600">${use(id, 'fill="#fff"')}${use(id, 'fill="#000" transform="translate(0,4)"')}</mask>`);
  return m;
}

/** Chapeau des emblèmes (grand format) : feutre sombre lustré, ruban à l'initiale, liseré néon. */
function hatCharge(doc, { x, y, s, kind }) {
  const D = kind === 'bowler';
  const H = D ? BOWLER : TOPHAT;
  const ink = D ? PALETTE.inkWarm : PALETTE.ink;
  const neon = D ? DAD.neon : EVE.neon;
  const all = H.crown + H.brim;
  const felt = doc.linear(D ? [[0, '#4a2a30'], [0.45, '#1c0d10'], [1, '#070203']] : [[0, '#33456e'], [0.45, '#141d36'], [1, '#04070e']], { name: 'hfelt' });
  let o = `<g transform="translate(${r2(x)},${r2(y)}) scale(${r2(s)})">`;
  o += `<path d="${all}" fill="none" stroke="${neon}" stroke-width="${r2(9 / s)}" opacity=".75" stroke-linejoin="round" filter="${doc.blur(6 / s)}"/>`;
  o += `<path d="${all}" fill="${ink}" stroke="${ink}" stroke-width="${r2(7 / s)}" stroke-linejoin="round"/>`;
  o += `<path d="${H.crown}" fill="${felt}"/>`;
  o += `<path d="${H.band}" fill="${doc.linear(D ? METAL.crimson : METAL.silverFlat)}"/>`;
  o += `<path d="${H.brim}" fill="${felt}"/>`;
  o += `<path d="${H.shine}" fill="#fff" opacity=".2"/>`;
  o += `<path d="${all}" fill="none" stroke="${D ? '#f2b84b' : '#cfd8e6'}" stroke-width="${r2(2.2 / s)}" stroke-linejoin="round" opacity=".8"/>`;
  o += `<path d="${H.crown}" fill="none" stroke="${neon}" stroke-width="${r2(1.4 / s)}" opacity=".55"/>`;
  // initiale sur le ruban
  const by = D ? -14 : -21, bh = D ? 14 : 26;
  const size = bh * (D ? 1.05 : 0.78);
  const letter = placeText(setText(FONTS.title, D ? 'D' : 'E', { size }), 0, by + (CAP * size) / 2);
  o += `<path d="${toD(letter)}" fill="${D ? '#ffd06a' : '#15295a'}" stroke="${ink}" stroke-width="${r2(1.2 / s)}"/>`;
  return o + '</g>';
}


// ── Fond de menu : composants ──

/**
 * Bande de gratte-ciel génériques entre x1 et x2 (largeurs et hauteurs au hasard, gradins,
 * antennes, châteaux d'eau). Renvoie { d, windows, tops, rects }.
 */
function cityBand(rand, { x1, x2, g, hMin, hMax, wMin = 26, wMax = 70, gap = 2, p = 0.25, win = {}, water = 0.25, antenna = 0.3, setback = 0.35, shape = null }) {
  let d = '';
  const windows = [], tops = [], rects = [];
  let x = x1;
  while (x < x2) {
    const w = lerp(wMin, wMax, rand());
    const hk = shape ? shape((x + w / 2 - x1) / (x2 - x1)) : 1;
    const h = lerp(hMin, hMax, Math.pow(rand(), 1.3)) * hk;
    const cx = x + w / 2;
    d += rectD(x, g - h, w, h + 1);
    rects.push([x, g - h, w, h]);
    let top = g - h;
    if (rand() < setback) {
      const w2 = w * lerp(0.5, 0.75, rand()), h2 = h * lerp(0.08, 0.2, rand());
      d += rectD(cx - w2 / 2, top - h2, w2, h2 + 1);
      top -= h2;
      if (rand() < 0.5) { const w3 = w2 * 0.6, h3 = h2 * 0.6; d += rectD(cx - w3 / 2, top - h3, w3, h3 + 1); top -= h3; }
    }
    if (rand() < antenna) { const ah = lerp(12, 40, rand()); d += rectD(cx - 0.8, top - ah, 1.6, ah + 1); tops.push([cx, top - ah]); }
    else if (h < hMax * 0.6 && rand() < water) d += waterTower(x + w * lerp(0.25, 0.75, rand()), g - h, lerp(0.7, 1.1, rand()));
    windows.push(...windowGrid(rand, x + 2, g - h + 4, w - 4, h - 8, { p, ...win }));
    x += w + lerp(0, gap, rand());
  }
  return { d, windows, tops, rects };
}

/** Tour de 2085 démesurée (au loin) : fût effilé, anneaux, couronne à pointe. */
function megaTower(x, g, w, h, { taper = 0.62, rings = 3 } = {}) {
  const top = g - h;
  const wt = w * taper;
  // fût effilé, épaulement, couronne évidée en deux lames, flèche
  let d = polyD([[x - w / 2, g], [x - wt / 2, top + h * 0.14], [x + wt / 2, top + h * 0.14], [x + w / 2, g]]);
  d += rectD(x - wt * 0.6, top + h * 0.12, wt * 1.2, h * 0.025);
  d += polyD([[x - wt / 2, top + h * 0.125], [x - wt * 0.42, top + h * 0.02], [x - wt * 0.08, top + h * 0.06], [x - wt * 0.08, top + h * 0.125]]);
  d += polyD([[x + wt * 0.08, top + h * 0.125], [x + wt * 0.08, top + h * 0.06], [x + wt * 0.42, top + h * 0.02], [x + wt / 2, top + h * 0.125]]);
  d += polyD([[x - 2.2, top + h * 0.13], [x, top - h * 0.1], [x + 2.2, top + h * 0.13]]);
  // arêtes lumineuses (deux filets qui montent le long du fût)
  const edges = `M${r2(x - w * 0.22)} ${g}L${r2(x - wt * 0.18)} ${r2(top + h * 0.15)}M${r2(x + w * 0.22)} ${g}L${r2(x + wt * 0.18)} ${r2(top + h * 0.15)}`;
  const ringYs = [];
  for (let i = 0; i < rings; i++) ringYs.push(top + h * (0.24 + i * 0.13));
  return { d, top: top - h * 0.1, ringYs, w, edges };
}

/** Pont suspendu façon Brooklyn : tours de pierre à arcs brisés, câbles, suspentes, haubans, tablier. */
function suspensionBridge(t1, t2, deckY, base, towerTop, { towerW = 64 } = {}) {
  const tw = towerW;
  let towers = '', arches = '';
  for (const x of [t1, t2]) {
    towers += rectD(x - tw / 2, towerTop, tw, base - towerTop);
    towers += rectD(x - tw / 2 - 4, towerTop - 8, tw + 8, 10); // corniche
    towers += rectD(x - tw / 2 - 2, towerTop + 40, tw + 4, 6);
    // deux arcs brisés (gothiques)
    for (const sx of [-1, 1]) {
      const xm = x + sx * tw * 0.2, aw = tw * 0.13, spring = towerTop + (deckY - towerTop) * 0.36, apex = spring - aw * 2.2;
      arches += `M${r2(xm - aw)} ${r2(deckY)}V${r2(spring)}C${r2(xm - aw)} ${r2(spring - aw * 1.2)} ${r2(xm - aw * 0.2)} ${r2(apex + aw * 0.4)} ${r2(xm)} ${r2(apex)}C${r2(xm + aw * 0.2)} ${r2(apex + aw * 0.4)} ${r2(xm + aw)} ${r2(spring - aw * 1.2)} ${r2(xm + aw)} ${r2(spring)}V${r2(deckY)}Z`;
    }
  }
  const cables = [];
  const sag = deckY - 14;
  const qy = 2 * sag - towerTop;
  cables.push([[t1, towerTop + 4], [(t1 + t2) / 2, qy], [t2, towerTop + 4]]); // travée centrale
  const span = t2 - t1;
  cables.push([[t1, towerTop + 4], [t1 - span * 0.3, deckY - 30], [t1 - span * 0.62, deckY - 4]]); // travées latérales
  cables.push([[t2, towerTop + 4], [t2 + span * 0.3, deckY - 30], [t2 + span * 0.62, deckY - 4]]);
  const q = (c, t) => { const u = 1 - t; return [u * u * c[0][0] + 2 * u * t * c[1][0] + t * t * c[2][0], u * u * c[0][1] + 2 * u * t * c[1][1] + t * t * c[2][1]]; };
  let hangers = '';
  const lights = [];
  for (const c of cables) {
    for (let i = 1; i < 40; i++) {
      const [x, y] = q(c, i / 40);
      if (y < deckY - 3) hangers += `M${r2(x)} ${r2(y)}V${r2(deckY)}`;
      if (i % 2 === 0) lights.push([x, y]);
    }
  }
  // haubans en éventail (la toile caractéristique)
  let stays = '';
  for (const x of [t1, t2]) for (const sx of [-1, 1]) for (let k = 1; k <= 6; k++) stays += `M${r2(x + (sx * tw) / 2)} ${r2(towerTop + 30)}L${r2(x + sx * (tw / 2 + k * 26))} ${r2(deckY)}`;
  const cableD = cables.map((c) => `M${r2(c[0][0])} ${r2(c[0][1])}Q${r2(c[1][0])} ${r2(c[1][1])} ${r2(c[2][0])} ${r2(c[2][1])}`).join('');
  const deck = rectD(t1 - span * 0.7, deckY, span * 2.4, 9);
  return { towers, arches, cableD, hangers, stays, deck, lights };
}

/** Pont cantilever façon Queensboro : poutres treillis qui remontent vers les piles à flèches. */
function cantileverBridge(xs, deckY, base, { towerH = 120, rise = 70 } = {}) {
  let piers = '', truss = '';
  for (const x of xs) {
    piers += rectD(x - 16, deckY - towerH, 32, base - deckY + towerH) + rectD(x - 20, deckY + 6, 40, base - deckY - 6);
    for (const sx of [-1, 1]) piers += polyD([[x + sx * 12 - 4, deckY - towerH], [x + sx * 12, deckY - towerH - 26], [x + sx * 12 + 4, deckY - towerH]]);
  }
  // membrure haute : remonte vers chaque pile (courbe), membrure basse au tablier
  const upper = (x) => {
    let best = Infinity;
    for (const t of xs) best = Math.min(best, Math.abs(x - t));
    const k = clamp(best / 150, 0, 1);
    return deckY - 18 - rise * Math.pow(1 - k, 1.6);
  };
  const x0 = xs[0] - 220, x1 = xs[xs.length - 1] + 260;
  let top = `M${x0} ${r2(upper(x0))}`;
  for (let x = x0; x <= x1; x += 10) top += `L${x} ${r2(upper(x))}`;
  truss += top + `M${x0} ${deckY}H${x1}`;
  for (let x = x0; x < x1; x += 22) truss += `M${x} ${deckY}L${x + 11} ${r2(upper(x + 11))}L${x + 22} ${deckY}M${x} ${deckY}V${r2(upper(x))}`;
  const deck = rectD(x0, deckY, x1 - x0, 8);
  const lights = [];
  for (let x = x0 + 6; x < x1; x += 18) lights.push([x, deckY + 3]);
  return { piers, truss, deck, lights, x0, x1 };
}

/** Taxi volant jaune (héritier des yellow cabs) avec halo cyan sous la caisse et phares. */
function hoverCab(doc, x, y, s = 1, dir = 1) {
  const m = `translate(${r2(x)},${r2(y)}) scale(${r2(dir * s)},${r2(s)})`;
  let o = `<g transform="${m}">`;
  o += `<ellipse cx="0" cy="9" rx="26" ry="6" fill="#4fd8ff" opacity=".55" filter="${doc.blur(4)}"/>`;
  o += `<path d="M24 0 L120 -8 L120 8 L24 6 Z" fill="${doc.linear([[0, '#fff2c0', 0.55], [1, '#fff2c0', 0]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`; // faisceau
  o += `<path d="M-24 4 C-24 -2 -20 -5 -14 -6 L-8 -12 C-6 -14 -3 -15 0 -15 L10 -15 C14 -15 16 -13 18 -10 L22 -5 C25 -4 26 -1 26 3 L26 6 C26 8 24 9 22 9 L-21 9 C-23 9 -24 7 -24 4 Z" fill="#ffc72e" stroke="#2a1a00" stroke-width="1.2"/>`;
  o += `<path d="M-6 -11 L0 -13 L10 -13 L15 -6 L-10 -6 Z" fill="#1a2440"/>`;
  o += `<rect x="-4" y="-19" width="9" height="4" rx="1" fill="#fff6c8"/>`;
  o += `<path d="M-24 3 H26" stroke="#2a1a00" stroke-width="1" opacity=".6"/>`;
  o += `<circle cx="24" cy="0" r="2.2" fill="#fff"/><circle cx="-23" cy="1" r="1.8" fill="#ff3a3a"/>`;
  return o + '</g>';
}

/** Reflet d'une lumière sur l'eau ridée : colonne douce + ridules brisées. */
function waterGlint(doc, x, y0, { len = 160, w = 26, color = '#f2b65e', opacity = 0.5, seed = 1 } = {}) {
  const rand = rng(seed);
  let o = `<rect x="${r1(x - w / 2)}" y="${r1(y0)}" width="${r1(w)}" height="${r1(len)}" fill="${doc.linear([[0, color, opacity * 0.5], [1, color, 0]], { name: 'wg' })}" filter="${doc.blur(w * 0.4)}"/>`;
  let a = '', bb = '';
  for (let k = 0; k < 18; k++) {
    const t = Math.pow(rand(), 1.4);
    const y = y0 + 3 + t * len;
    const dw = w * (0.25 + rand() * 0.9) * (1 - t * 0.6);
    const cx = x + (rand() - 0.5) * w * (0.5 + t);
    if (t < 0.35) a += ellipseD(cx, y, dw / 2, 0.8 + rand() * 0.9); else bb += ellipseD(cx, y, dw / 2, 0.7 + rand() * 0.8);
  }
  o += `<path d="${a}" fill="${color}" opacity="${r2(opacity)}" filter="${doc.blur(0.7)}"/>`;
  o += `<path d="${bb}" fill="${color}" opacity="${r2(opacity * 0.6)}" filter="${doc.blur(1)}"/>`;
  return o;
}

/**
 * Fond du menu principal — 1920 × 1080 : New York la nuit, en 2085, vu depuis l'East River.
 * Couches : ciel et smog → mégatours lointaines → ville lointaine → « Empire State » (gauche) et
 * « Chrysler » (droite) au milieu des tours néon → hologrammes de propagande (melon de Dadou à
 * gauche, haut-de-forme d'Even à droite) → ponts (Brooklyn à gauche, Queensboro à droite) →
 * fleuve et reflets → taxis volants, traînées lumineuses, pluie → vignettage.
 * Lueur cramoisie à gauche (Dadou), cyan à droite (Even). Centre et haut calmes pour le logo
 * et les boutons. Aucun texte.
 */
function buildBackdrop() {
  const W = 1920, H = 1080;
  const doc = new Svg('mwb', W, H);
  const water = 838;
  const rand = rng(2085);
  let b = '';
  // ── ciel
  b += `<rect width="${W}" height="${H}" fill="${doc.linear([[0, '#020208'], [0.28, '#060718'], [0.52, '#120a28'], [0.68, '#24103a'], [0.77, '#3a1446'], [0.8, '#1a0a22'], [1, '#05030a']], { x1: 0, y1: 0, x2: 0, y2: H, user: true })}"/>`;
  b += `<ellipse cx="40" cy="760" rx="980" ry="640" fill="${doc.radial([[0, '#ff2a4d', 0.5], [0.42, '#a8102e', 0.2], [1, '#5c0a16', 0]])}"/>`;
  b += `<ellipse cx="1880" cy="760" rx="980" ry="640" fill="${doc.radial([[0, '#4fd8ff', 0.4], [0.42, '#2b5fd0', 0.2], [1, '#0a1533', 0]])}"/>`;
  b += `<ellipse cx="960" cy="${water - 30}" rx="1250" ry="300" fill="${doc.radial([[0, '#ff4fa8', 0.36], [0.5, '#8a3cff', 0.14], [1, '#3a1a80', 0]])}"/>`;
  // smog bas éclairé par la ville, nuages sombres en haut
  b += hazeBand(doc, { cx: 480, cy: 250, rx: 760, ry: 110, opacity: 0.55, color: [0.16, 0.08, 0.24], freq: [0.0035, 0.018], seed: 5, soft: 30, contrast: 2, cut: 0.75 });
  b += hazeBand(doc, { cx: 1450, cy: 170, rx: 700, ry: 90, opacity: 0.55, color: [0.1, 0.1, 0.24], freq: [0.004, 0.02], seed: 11, soft: 26, contrast: 2.2, cut: 0.8 });
  b += hazeBand(doc, { cx: 960, cy: 470, rx: 1100, ry: 120, opacity: 0.45, color: [0.5, 0.22, 0.55], freq: [0.003, 0.016], seed: 8, soft: 34, contrast: 1.8, cut: 0.7 });

  // ── mégatours de 2085, au loin dans la brume
  const MX = [70, 1858, 1120, 800];
  const megas = [megaTower(MX[0], water, 120, 780, { rings: 3 }), megaTower(MX[1], water, 130, 800, { rings: 4 }), megaTower(MX[2], water, 80, 540, { rings: 2 }), megaTower(MX[3], water, 70, 470, { rings: 2 })];
  b += `<path d="${megas.map((m) => m.d).join('')}" fill="${doc.linear([[0, '#2a2050'], [1, '#1a1235']], { x1: 0, y1: 0, x2: 0, y2: water, user: true })}" opacity=".7"/>`;
  for (const [i, m] of megas.entries()) {
    const x = MX[i];
    b += `<path d="${m.edges}" stroke="${i % 2 ? '#4fd8ff' : '#ff3d9e'}" stroke-width="1.4" opacity=".35"/>`;
    for (const ry of m.ringYs) b += `<ellipse cx="${x}" cy="${r1(ry)}" rx="${r1(m.w * 0.58)}" ry="${r1(m.w * 0.08)}" fill="none" stroke="${i % 2 ? '#4fd8ff' : '#ff3d9e'}" stroke-width="1.4" opacity=".45"/>`;
    b += `<circle cx="${x}" cy="${r1(m.top)}" r="9" fill="${doc.radial([[0, '#ff3a3a', 0.9], [1, '#ff3a3a', 0]])}"/><circle cx="${x}" cy="${r1(m.top)}" r="1.8" fill="#ffd8d8"/>`;
  }
  b += hazeBand(doc, { cx: 960, cy: 560, rx: 1150, ry: 110, opacity: 0.5, color: [0.42, 0.2, 0.5], freq: [0.0028, 0.014], seed: 3, soft: 30 });

  // ── ville lointaine (brumeuse)
  const far = cityBand(rand, { x1: -10, x2: 1940, g: water - 6, hMin: 70, hMax: 250, wMin: 22, wMax: 54, p: 0.22, win: { cw: 6, ch: 8, ww: 2, wh: 3 }, shape: (t) => 0.75 + 0.5 * Math.abs(t - 0.5) });
  b += `<path d="${far.d}" fill="#1c1636" opacity=".95"/>`;
  b += `<path d="${far.windows.map(([x, y, w, h]) => rectD(x, y, w, h)).join('')}" fill="#d8a0ff" opacity=".28"/>`;

  // ── couche moyenne : Empire State (gauche), Chrysler (droite) et tours néon
  const g = water;
  const es = empireSpire(470, g, 1.05);
  const ch = chryslerSpire(1500, g, 1.1);
  const left = cityBand(rand, { x1: -20, x2: 700, g, hMin: 150, hMax: 430, wMin: 40, wMax: 96, gap: 6, p: 0.3, shape: (t) => 1.1 - t * 0.5 });
  const centre = cityBand(rand, { x1: 700, x2: 1240, g, hMin: 70, hMax: 190, wMin: 36, wMax: 80, gap: 4, p: 0.3 });
  const right = cityBand(rand, { x1: 1240, x2: 1950, g, hMin: 150, hMax: 430, wMin: 40, wMax: 96, gap: 6, p: 0.3, shape: (t) => 0.6 + t * 0.5 });
  // tours qui portent les hologrammes géants
  const bbL = rectD(176, 300, 118, water - 300) + rectD(196, 270, 78, 32) + rectD(233, 210, 3, 62);
  const bbR = rectD(1632, 286, 120, water - 286) + rectD(1652, 256, 80, 32) + rectD(1690, 196, 3, 62);
  const midD = es.d + ch.d + left.d + centre.d + right.d + bbL + bbR;
  const midId = doc.path(midD, 'mid');
  const clipL = doc.clip(rectD(0, 0, 960, H)), clipR = doc.clip(rectD(960, 0, 960, H));
  b += `<g clip-path="${clipL}">${use(midId, `fill="#ff2a4d" opacity=".8" transform="translate(-2,-1.5)"`)}</g>`;
  b += `<g clip-path="${clipR}">${use(midId, `fill="#4fd8ff" opacity=".8" transform="translate(2,-1.5)"`)}</g>`;
  b += use(midId, `fill="${doc.linear([[0, '#151530'], [0.6, '#0b0b1d'], [1, '#06060f']], { x1: 0, y1: 300, x2: 0, y2: water, user: true })}"`);
  const wins = [...left.windows, ...centre.windows, ...right.windows];
  for (const bl of es.blocks.slice(0, 3)) wins.push(...windowGrid(rand, bl[0] + 3, bl[1] + 4, bl[2] - 6, bl[3] - 8, { p: 0.34 }));
  wins.push(...windowGrid(rand, 1500 - 36, g - 280, 72, 270, { p: 0.3 }));
  const wsets = [[], [], [], []];
  for (const w of wins) { const r = rand(); wsets[r < 0.5 ? 0 : r < 0.8 ? 1 : r < 0.93 ? 2 : 3].push(w); }
  const wcol = ['#ffd9a0', '#9fe6ff', '#ff8ad8', '#ffffff'];
  wsets.forEach((set, i) => { b += `<path d="${set.map(([x, y, w, h]) => rectD(x, y, w, h)).join('')}" fill="${wcol[i]}" opacity="${[0.6, 0.55, 0.65, 0.5][i]}"/>`; });
  b += `<path d="${es.piers}" fill="#8aa0ff" opacity=".25"/>`;
  b += `<path d="${ch.tri}" fill="#fff4d8" opacity=".9"/><path d="${ch.tri}" fill="#ffd27a" opacity=".7" filter="${doc.blur(4)}"/>`;
  for (const [x, y] of [es.tip, ch.tip, ...left.tops, ...right.tops]) b += `<circle cx="${r1(x)}" cy="${r1(y)}" r="7" fill="${doc.radial([[0, '#ff3a3a', 0.85], [1, '#ff3a3a', 0]])}"/><circle cx="${r1(x)}" cy="${r1(y)}" r="1.6" fill="#ffd0d0"/>`;
  // enseignes néon verticales et bandeaux sur les façades
  const neonSpots = [[120, 520, 150, '#ff2a4d'], [610, 600, 120, '#ff3d9e'], [330, 640, 90, '#ffb340'], [1310, 590, 110, '#4fd8ff'], [1800, 520, 160, '#4fd8ff'], [1660, 650, 90, '#b05cff'], [880, 720, 60, '#ff3d9e'], [1080, 730, 50, '#4fd8ff']];
  for (const [x, y, h, c] of neonSpots) b += neonPath(doc, `M${x} ${y}V${y + h}`, { color: c, width: 3, glow: 8, glowOpacity: 0.8 });
  b += neonPath(doc, `M560 700H660`, { color: '#ff2a4d', width: 2.4, glow: 7 }) + neonPath(doc, `M1250 690H1370`, { color: '#4fd8ff', width: 2.4, glow: 7 });

  // ── hologrammes géants : propagande des deux parrains
  b += holoBillboard(doc, { x: 168, y: 330, w: 134, h: 96, color: '#ff2a4d', icon: 'bowler', opacity: 0.78 });
  b += holoBillboard(doc, { x: 1626, y: 318, w: 132, h: 100, color: '#4fd8ff', icon: 'tophat', opacity: 0.78 });
  b += holoBillboard(doc, { x: 668, y: 600, w: 46, h: 66, color: '#ffb340', icon: 'bars', opacity: 0.6 });
  b += holoBillboard(doc, { x: 1222, y: 612, w: 62, h: 42, color: '#b05cff', icon: 'chevron', opacity: 0.6 });
  b += hazeBand(doc, { cx: 960, cy: water - 20, rx: 1250, ry: 50, opacity: 0.45, color: [0.6, 0.35, 0.65], freq: [0.003, 0.022], seed: 9, soft: 18 });

  b += `<rect y="640" width="${W}" height="${water - 640}" fill="${doc.linear([[0, '#2a1240', 0], [1, '#3a1650', 0.55]], { x1: 0, y1: 640, x2: 0, y2: water, user: true })}"/>`;
  b += hazeBand(doc, { cx: 520, cy: water - 60, rx: 620, ry: 70, opacity: 0.5, color: [0.55, 0.25, 0.5], freq: [0.004, 0.02], seed: 21, soft: 20 });
  b += hazeBand(doc, { cx: 1500, cy: water - 50, rx: 560, ry: 60, opacity: 0.45, color: [0.3, 0.35, 0.6], freq: [0.004, 0.02], seed: 23, soft: 20 });
  // ── ponts : Brooklyn (gauche), Queensboro (droite)
  const br = suspensionBridge(150, 640, 790, water + 4, 560);
  const qb = cantileverBridge([1360, 1720], 800, water + 4, { towerH: 110, rise: 64 });
  const bridgeG = doc.id('brg');
  doc.def(`<g id="${bridgeG}"><path d="${br.towers}${br.deck}${qb.piers}${qb.deck}"/><path d="${br.cableD}" fill="none" stroke="#000" stroke-width="3.2"/><path d="${br.hangers}${br.stays}" fill="none" stroke="#000" stroke-width="1"/><path d="${qb.truss}" fill="none" stroke="#000" stroke-width="2.2"/></g>`);
  b += `<g clip-path="${clipL}">${use(bridgeG, 'fill="#ff2a4d" stroke="#ff2a4d" opacity=".55" transform="translate(-1.5,-1.5)"')}</g>`;
  b += `<g clip-path="${clipR}">${use(bridgeG, 'fill="#4fd8ff" stroke="#4fd8ff" opacity=".55" transform="translate(1.5,-1.5)"')}</g>`;
  b += `<path d="${br.towers}${br.deck}" fill="${doc.linear([[0, '#1c1830'], [1, '#08070f']], { x1: 0, y1: 560, x2: 0, y2: water, user: true })}"/>`;
  b += `<path d="${br.arches}" fill="${doc.linear([[0, '#ff5a9a', 0.7], [1, '#7a1c5a', 0.6]], { x1: 0, y1: 600, x2: 0, y2: 790, user: true })}"/>`;
  b += `<path d="${br.cableD}" fill="none" stroke="#0c0a16" stroke-width="3.2"/><path d="${br.hangers}${br.stays}" fill="none" stroke="#0c0a16" stroke-width="1" opacity=".9"/>`;
  b += `<path d="${qb.piers}${qb.deck}" fill="#0a0b16"/><path d="${qb.truss}" fill="none" stroke="#0a0b16" stroke-width="2.2"/>`;
  // guirlandes lumineuses et néons des tabliers
  b += `<path d="${br.lights.map(([x, y]) => circleD(x, y, 1.7)).join('')}" fill="#ffe6b0"/>`;
  b += `<path d="${br.lights.map(([x, y]) => circleD(x, y, 4)).join('')}" fill="#ffc070" opacity=".35" filter="${doc.blur(3)}"/>`;
  b += `<path d="${qb.lights.map(([x, y]) => circleD(x, y, 1.6)).join('')}" fill="#bff4ff"/>`;
  b += neonPath(doc, `M0 ${794}H1000`, { color: '#ff3d9e', width: 2, glow: 6, glowOpacity: 0.7 });
  b += neonPath(doc, `M${qb.x0} ${804}H${qb.x1}`, { color: '#4fd8ff', width: 2, glow: 6, glowOpacity: 0.7 });

  // vapeur des bouches d'aération sur les quais
  for (const [x, h, sd] of [[1010, 150, 41], [1180, 110, 43], [860, 90, 47]]) b += hazeBand(doc, { cx: x, cy: water - h / 2, rx: 34, ry: h / 2, opacity: 0.5, color: [0.85, 0.82, 0.92], freq: [0.02, 0.012], seed: sd, soft: 12, contrast: 1.6, cut: 0.55 });
  // ── fleuve et reflets
  b += `<rect y="${water}" width="${W}" height="${H - water}" fill="${doc.linear([[0, '#120c22'], [0.4, '#0a0816'], [1, '#030207']], { x1: 0, y1: water, x2: 0, y2: H, user: true })}"/>`;
  const refl = doc.id('refl');
  doc.def(`<mask id="${refl}" maskUnits="userSpaceOnUse" x="0" y="${water}" width="${W}" height="${H - water}"><rect y="${water}" width="${W}" height="${H - water}" fill="${doc.linear([[0, '#fff', 0.5], [0.6, '#fff', 0]], { x1: 0, y1: water, x2: 0, y2: H, user: true })}"/></mask>`);
  b += `<g mask="url(#${refl})"><g transform="translate(0,${2 * water}) scale(1,-1)" filter="${doc.blur(2.5)}">${use(midId, 'fill="#2a1f45"')}${use(bridgeG, 'fill="#1a1530" stroke="#1a1530"')}</g></g>`;
  const glints = [[235, '#ff2a4d', 0.6, 60], [1690, '#4fd8ff', 0.55, 50], [470, '#ffd27a', 0.4, 30], [1500, '#fff1cc', 0.45, 34], [900, '#ff3d9e', 0.4, 40], [1080, '#4fd8ff', 0.35, 30], [620, '#ff3d9e', 0.4, 26], [1310, '#4fd8ff', 0.45, 26], [120, '#ff2a4d', 0.45, 24], [1800, '#4fd8ff', 0.45, 24]];
  glints.forEach(([x, c, o, w], i) => { b += waterGlint(doc, x, water + 3, { len: 200, w, color: c, opacity: o, seed: 30 + i }); });
  for (const [x] of br.lights.filter((_, i) => i % 3 === 0)) b += waterGlint(doc, x, water + 2, { len: 70, w: 8, color: '#ffc070', opacity: 0.35, seed: Math.round(x) });

  // ── trafic aérien : traînées lumineuses, taxis volants, drones
  const trail = (d, c, w, o) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" opacity="${o}" filter="${doc.blur(1.2)}"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w * 4}" stroke-linecap="round" opacity="${o * 0.25}" filter="${doc.blur(5)}"/>`;
  b += trail('M-20 455C320 420 620 470 980 438S1600 400 1940 430', '#ff3d9e', 1.6, 0.55);
  b += trail('M-20 300C400 330 760 280 1100 300', '#4fd8ff', 1.2, 0.4);
  b += trail('M880 250C1180 230 1500 265 1940 238', '#ffb340', 1.2, 0.4);
  b += trail('M-20 610C200 600 380 616 560 604', '#ff2a4d', 1.4, 0.5);
  b += trail('M1380 616C1560 606 1760 622 1940 610', '#4fd8ff', 1.4, 0.5);
  b += hoverCab(doc, 520, 440, 0.9, 1) + hoverCab(doc, 1420, 410, 0.8, -1) + hoverCab(doc, 980, 296, 0.5, 1) + hoverCab(doc, 300, 600, 0.6, -1) + hoverCab(doc, 1620, 612, 0.6, 1);
  let drones = '';
  for (let i = 0; i < 26; i++) { const x = rand() * W, y = 120 + rand() * 520; drones += circleD(x, y, 1 + rand() * 0.8); }
  b += `<path d="${drones}" fill="#ffdede" opacity=".55"/>`;

  // ── pluie fine
  let rain = '', rain2 = '';
  for (let i = 0; i < 900; i++) {
    const x = rand() * (W + 200) - 100, y = rand() * H, l = 14 + rand() * 30;
    const seg = `M${r1(x)} ${r1(y)}l${r1(-l * 0.18)} ${r1(l)}`;
    if (rand() < 0.7) rain += seg; else rain2 += seg;
  }
  b += `<path d="${rain}" stroke="#b9c8ff" stroke-width=".8" opacity=".13"/><path d="${rain2}" stroke="#e6ecff" stroke-width="1.1" opacity=".2"/>`;
  // vignettage et assombrissement du haut-centre (logo) et du centre (boutons)
  b += `<ellipse cx="960" cy="380" rx="620" ry="420" fill="${doc.radial([[0, '#03020a', 0.55], [1, '#03020a', 0]])}"/>`;
  b += `<rect width="${W}" height="${H}" fill="${doc.radial([[0.5, '#000', 0], [1, '#000', 0.75]], { cy: 0.46, r: 0.78 })}"/>`;
  return doc.render(b, { title: 'MAFIA WARS II — menu', desc: 'Fond du menu principal : New York la nuit en 2085, ses gratte-ciel, ses ponts et ses hologrammes.' });
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Sorties raster : PNG via resvg, JPEG via un petit encodeur intégré
// ════════════════════════════════════════════════════════════════════════════
function rasterize(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
}

/**
 * Encodeur JPEG « baseline » minimal (4:4:4, tables de Huffman standard de l'UIT-T T.81, annexe K).
 * Sert uniquement au fond de menu opaque, pour l'alléger (≈ 10 × plus petit qu'un PNG).
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
  /** codes de Huffman canoniques : symbole → [code, longueur] */
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

  // données codées (entropie)
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
  if (nbits > 0) writeBits((1 << (8 - nbits)) - 1, 8 - nbits); // bourrage avec des bits à 1
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
// 9. Programme principal
// ════════════════════════════════════════════════════════════════════════════
function main() {
  const t0 = Date.now();
  const only = (process.env.MW_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const want = (k) => !only.length || only.includes(k);
  console.log('MAFIA WARS II : Dadou vs Even — génération des assets de marque…');
  const B = (f) => path.join(OUT_BRAND, f);
  const P = (f) => path.join(OUT_PUBLIC, f);

  if (want('logo')) writeSvgAndPngs(B('logo.svg'), buildLogo(), [[B('logo.png'), 2000]]);
  if (want('compact')) writeSvgAndPngs(B('logo-compact.svg'), buildCompact(), [[B('logo-compact.png'), 1200]]);
  if (want('icon')) {
    writeSvgAndPngs(B('icon.svg'), buildIcon(), [[B('icon-512.png'), 512], [B('icon-192.png'), 192]]);
    write(P('apple-touch-icon.png'), rasterize(buildIcon({ square: true }), 180).asPng());
  }
  if (want('favicon')) writeSvgAndPngs(P('favicon.svg'), buildFavicon(), [[P('favicon-32.png'), 32], [P('favicon-16.png'), 16]]);
  if (want('emblems')) {
    writeSvgAndPngs(B('emblem-dadou.svg'), buildEmblem('dadou'), [[B('emblem-dadou.png'), 512]]);
    writeSvgAndPngs(B('emblem-even.svg'), buildEmblem('even'), [[B('emblem-even.png'), 512]]);
  }
  if (want('backdrop')) {
    const backdrop = buildBackdrop();
    write(B('menu-backdrop.svg'), backdrop);
    const img = rasterize(backdrop, 1920);
    write(B('menu-backdrop.jpg'), encodeJpeg(img.pixels, img.width, img.height, 88));
  }

  console.log(`Terminé en ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
}

export const BUILDERS = { buildLogo, buildCompact, buildIcon, buildFavicon, buildEmblem, buildBackdrop };

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
