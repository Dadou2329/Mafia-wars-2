// Écrans géants de New York 2085 (Times Square, tours, studios) : publicités fictives, journal
// télévisé alimenté par la partie (captures, quartiers conquis, braquages, convois) et propagande
// du parrain qui contrôle le quartier : « DADOU RÈGNE SUR TIMES SQUARE ».
// Chaque écran est une toile 2D redessinée quelques fois par seconde quand il est proche.

import * as THREE from 'three';
import type { ScreenInfo } from '../../shared/city/gen/context';
import { BUILDINGS, DISTRICTS, Faction, type DistrictId } from '../../shared/city/plan';
import type { PublicState } from '../../shared/protocol';
import { formatMoney } from '../../shared/util';
import { envUniforms } from '../render/env';
import { COMMON_UNIFORMS_GLSL } from '../render/shaderChunks';
import { aNom, deNom } from '../../shared/french';

const F_TITLE = "'Orbitron', 'Rajdhani', sans-serif";
const F_BODY = "'Rajdhani', 'Segoe UI', sans-serif";

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
uniform sampler2D uMap;
uniform float uBright;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  // trame des diodes
  vec2 px = fract(vUv * vec2(220.0, 120.0));
  float led = 0.78 + 0.22 * step(0.18, px.x) * step(0.18, px.y);
  c *= led * uBright * mix(0.75, 1.35, uNight);
  // l'écran perce le brouillard plus que le reste de la ville
  float dist = length(vW - cameraPosition);
  float f = 1.0 - exp(-dist * uFogDensity * 0.45);
  c = mix(c, uFogColor, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

interface Ad {
  brand: string;
  line: string;
  small?: string;
  bg: [string, string];
  fg: string;
  accent: string;
  icon: (c: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) => void;
}

const ADS: Ad[] = [
  {
    brand: 'NÉO-COLA',
    line: 'Le goût de 2085',
    bg: ['#b0001e', '#ff2a4a'],
    fg: '#ffffff',
    accent: '#ffe0e6',
    icon: (c, x, y, s, t) => {
      c.save();
      c.translate(x, y);
      c.rotate(Math.sin(t * 1.5) * 0.12);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.beginPath();
      c.roundRect(-s * 0.18, -s * 0.2, s * 0.36, s * 0.75, s * 0.12);
      c.fill();
      c.fillRect(-s * 0.08, -s * 0.45, s * 0.16, s * 0.3);
      c.fillStyle = '#d0002a';
      c.fillRect(-s * 0.18, s * 0.05, s * 0.36, s * 0.16);
      c.restore();
    },
  },
  {
    brand: 'YELLOWJET',
    line: 'Taxis volants · décollage en 2 min',
    bg: ['#141000', '#2a2200'],
    fg: '#ffd21a',
    accent: '#ffffff',
    icon: (c, x, y, s, t) => {
      c.save();
      c.translate(x + Math.sin(t) * s * 0.15, y + Math.sin(t * 2.3) * s * 0.05);
      c.fillStyle = '#ffd21a';
      c.beginPath();
      c.roundRect(-s * 0.45, -s * 0.12, s * 0.9, s * 0.26, s * 0.1);
      c.fill();
      c.fillStyle = '#7fe8ff';
      c.fillRect(-s * 0.18, -s * 0.22, s * 0.36, s * 0.12);
      c.fillStyle = '#ffd21a';
      for (const k of [-1, 1]) c.fillRect(k * s * 0.5 - s * 0.12, s * 0.14, s * 0.24, s * 0.05);
      c.restore();
    },
  },
  {
    brand: 'KŌJI OPTIQUE',
    line: 'Implants oculaires · voyez la nuit',
    bg: ['#00141c', '#003848'],
    fg: '#5ff0ff',
    accent: '#ffffff',
    icon: (c, x, y, s, t) => {
      c.save();
      c.translate(x, y);
      c.strokeStyle = '#5ff0ff';
      c.lineWidth = s * 0.05;
      c.beginPath();
      c.ellipse(0, 0, s * 0.42, s * 0.22, 0, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#5ff0ff';
      c.beginPath();
      c.arc(Math.sin(t * 1.3) * s * 0.12, 0, s * 0.13, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#00141c';
      c.beginPath();
      c.arc(Math.sin(t * 1.3) * s * 0.12, 0, s * 0.05, 0, Math.PI * 2);
      c.fill();
      c.restore();
    },
  },
  {
    brand: 'SYNTH-RAMEN',
    line: 'Ouvert 24 h/24 · Chinatown',
    bg: ['#2a0418', '#ff3c8c'],
    fg: '#fff2f8',
    accent: '#ffd040',
    icon: (c, x, y, s, t) => {
      c.save();
      c.translate(x, y);
      c.fillStyle = '#fff2f8';
      c.beginPath();
      c.arc(0, 0, s * 0.38, 0, Math.PI);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = s * 0.03;
      for (let i = -1; i <= 1; i++) {
        c.beginPath();
        c.moveTo(i * s * 0.12, -s * 0.08);
        c.bezierCurveTo(i * s * 0.12 + s * 0.08, -s * 0.25 - Math.sin(t * 3 + i) * s * 0.05, i * s * 0.12 - s * 0.08, -s * 0.35, i * s * 0.12, -s * 0.5);
        c.stroke();
      }
      c.restore();
    },
  },
  {
    brand: 'HOLO-OPÉRA',
    line: 'Ce soir au Néo-Apollo',
    bg: ['#12002a', '#5a18c8'],
    fg: '#e8d8ff',
    accent: '#ff5ae0',
    icon: (c, x, y, s, t) => {
      c.save();
      c.translate(x, y);
      for (let i = 0; i < 3; i++) {
        c.strokeStyle = `rgba(255,90,224,${0.9 - i * 0.25})`;
        c.lineWidth = s * 0.03;
        c.beginPath();
        c.arc(0, 0, s * (0.15 + i * 0.12 + ((t * 0.4) % 0.12)), 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
    },
  },
  {
    brand: 'BANQUE FÉDÉRALE',
    line: 'Votre argent est en sécurité*',
    small: '* sauf braquage',
    bg: ['#020a1a', '#0a2a5a'],
    fg: '#d8e8ff',
    accent: '#7ab8ff',
    icon: (c, x, y, s) => {
      c.save();
      c.translate(x, y);
      c.fillStyle = '#7ab8ff';
      c.beginPath();
      c.moveTo(-s * 0.4, -s * 0.15);
      c.lineTo(0, -s * 0.4);
      c.lineTo(s * 0.4, -s * 0.15);
      c.closePath();
      c.fill();
      for (let i = -2; i <= 2; i++) c.fillRect(i * s * 0.15 - s * 0.04, -s * 0.1, s * 0.08, s * 0.38);
      c.fillRect(-s * 0.42, s * 0.3, s * 0.84, s * 0.07);
      c.restore();
    },
  },
  {
    brand: 'NYPD 2085',
    line: 'Signalez toute activité mafieuse : 911',
    bg: ['#00061a', '#0a1a4a'],
    fg: '#ffffff',
    accent: '#ff3a3a',
    icon: (c, x, y, s, t) => {
      c.save();
      c.translate(x, y);
      c.fillStyle = Math.floor(t * 3) % 2 ? '#ff3a3a' : '#3a6aff';
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        const b = a + Math.PI / 5;
        c.lineTo(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4);
        c.lineTo(Math.cos(b) * s * 0.17, Math.sin(b) * s * 0.17);
      }
      c.closePath();
      c.fill();
      c.restore();
    },
  },
  {
    brand: 'DRONEXPRESS',
    line: 'Livré avant même d’avoir commandé',
    bg: ['#001a0c', '#00703a'],
    fg: '#d8ffe8',
    accent: '#50ffaa',
    icon: (c, x, y, s, t) => {
      c.save();
      c.translate(x, y + Math.sin(t * 2) * s * 0.06);
      c.fillStyle = '#50ffaa';
      c.fillRect(-s * 0.16, -s * 0.06, s * 0.32, s * 0.14);
      c.strokeStyle = '#50ffaa';
      c.lineWidth = s * 0.03;
      for (const k of [-1, 1]) {
        c.beginPath();
        c.moveTo(k * s * 0.16, 0);
        c.lineTo(k * s * 0.36, -s * 0.12);
        c.stroke();
        c.beginPath();
        c.ellipse(k * s * 0.36, -s * 0.14, s * 0.13 * Math.abs(Math.sin(t * 20)), s * 0.03, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = '#d8ffe8';
      c.fillRect(-s * 0.1, s * 0.1, s * 0.2, s * 0.16);
      c.restore();
    },
  },
];

interface Item {
  info: ScreenInfo;
  canvas: HTMLCanvasElement;
  c: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  W: number;
  H: number;
  next: number;
}

export class BigScreens {
  readonly group = new THREE.Group();
  private items: Item[] = [];
  private emblems: Record<'dadou' | 'even', HTMLImageElement>;
  private news: string[] = ['NEW YORK, 2085 : la guerre des gangs embrase la ville', 'BOURSE DE WALL STREET : +3,2 % sur les actions des drones', 'MÉTÉO : averses magnétiques attendues cette nuit'];
  private owners: Partial<Record<DistrictId, number>> = {};
  private prevPub: PublicState | null = null;
  private cursor = 0;

  constructor(screens: ScreenInfo[]) {
    this.group.name = 'écrans géants';
    this.emblems = { dadou: new Image(), even: new Image() };
    this.emblems.dadou.src = '/brand/emblem-dadou.png';
    this.emblems.even.src = '/brand/emblem-even.png';
    for (const info of screens) {
      if (info.w < 1 || info.h < 0.5) continue;
      const aspect = info.w / info.h;
      const W = Math.round(Math.min(768, Math.max(192, info.w * 26)));
      const H = Math.round(Math.max(96, Math.min(768, W / aspect)));
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const c = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...envUniforms, uMap: { value: tex }, uBright: { value: 1.25 } } });
      mat.toneMapped = false;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(info.w, info.h), mat);
      mesh.position.set(info.x, info.y, info.z);
      mesh.rotation.y = info.yaw;
      this.group.add(mesh);
      const it: Item = { info, canvas, c, tex, mesh, W, H, next: 0 };
      this.items.push(it);
      this.draw(it, 0);
    }
  }

  /** Suit l'état public : maîtres des quartiers et nouvelles du journal télévisé. */
  observe(pub: PublicState): void {
    for (const d of pub.districts) this.owners[d.id as DistrictId] = d.owner;
    const prev = this.prevPub;
    this.prevPub = pub;
    if (!prev) return;
    const who = (f: number): string => (f === Faction.DADOU ? 'DADOU' : f === Faction.EVEN ? 'EVEN' : 'les gangs');
    for (const d of pub.districts) {
      const before = prev.districts.find((x) => x.id === d.id)?.owner;
      if (before !== undefined && before !== d.owner) {
        const name = DISTRICTS.find((x) => x.id === d.id)?.name ?? d.id;
        this.headline(d.owner === Faction.NEUTRAL ? `FLASH : ${name} n’a plus de maître` : `FLASH : ${who(d.owner)} prend le contrôle ${deNom(name)} !`);
      }
    }
    for (const b of pub.buildings) {
      const before = prev.buildings[b.id];
      const def = BUILDINGS[b.id];
      if (!before || before.owner === b.owner || !def || (!def.isKey && !def.residence)) continue;
      if (b.owner === Faction.DADOU || b.owner === Faction.EVEN) this.headline(`${who(b.owner)} s’empare ${deNom(def.name)}`);
    }
    for (const h of pub.heists ?? []) if (!(prev.heists ?? []).some((x) => x.b === h.b)) this.headline(`ALERTE : braquage en cours ${aNom(BUILDINGS[h.b].name)}`);
    for (const cv of pub.convoys ?? []) if (!(prev.convoys ?? []).some((x) => x.id === cv.id)) this.headline(cv.slot ? `Un convoi de ${who(cv.slot === 'dadou' ? Faction.DADOU : Faction.EVEN)} traverse la ville (${formatMoney(cv.reward)})` : `Convoi blindé de la Banque Fédérale en route vers ${cv.dest}`);
    if ((pub.rain ?? 0) > 0.5 && (prev.rain ?? 0) <= 0.5) this.headline('MÉTÉO : forte pluie sur Manhattan, chaussées glissantes');
  }

  private headline(text: string): void {
    this.news.unshift(text);
    if (this.news.length > 8) this.news.length = 8;
  }

  update(now: number, cam: THREE.Vector3): void {
    // redessine au plus 2 écrans proches par image, chacun ~6 fois par seconde
    let budget = 2;
    for (let k = 0; k < this.items.length && budget > 0; k++) {
      const it = this.items[(this.cursor + k) % this.items.length];
      if (now < it.next) continue;
      const d = Math.hypot(it.info.x - cam.x, it.info.z - cam.z);
      if (d > 170) {
        it.next = now + 1.5;
        continue;
      }
      this.draw(it, now);
      it.next = now + (d < 60 ? 0.16 : 0.4);
      budget--;
      this.cursor = (this.cursor + k + 1) % this.items.length;
    }
  }

  private draw(it: Item, t: number): void {
    const { c, W, H, info } = it;
    const owner = this.owners[info.district as DistrictId] ?? Faction.NEUTRAL;
    const cycle = Math.floor((t + info.seed * 3.7) / 9);
    const phase = ((t + info.seed * 3.7) % 9) / 9;
    c.save();
    c.clearRect(0, 0, W, H);
    if (info.kind === 'news') this.drawNews(c, W, H, t);
    else if (info.kind === 'ticker') this.drawTicker(c, W, H, t, '#ffd040');
    else if (info.kind === 'boss' && owner !== Faction.NEUTRAL && cycle % 2 === 0) this.drawBoss(c, W, H, t, owner, info.district as DistrictId, phase);
    else this.drawAd(c, W, H, t, ADS[(cycle + info.seed) % ADS.length], phase);
    // reflet et lignes de balayage
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = (t * 40) % 4; y < H; y += 4) c.fillRect(0, y, W, 1);
    c.restore();
    it.tex.needsUpdate = true;
  }

  private drawAd(c: CanvasRenderingContext2D, W: number, H: number, t: number, ad: Ad, phase: number): void {
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, ad.bg[0]);
    g.addColorStop(1, ad.bg[1]);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // rayons lumineux en fond
    c.save();
    c.globalAlpha = 0.12;
    c.translate(W * 0.25, H * 0.5);
    c.rotate(t * 0.2);
    c.fillStyle = ad.accent;
    for (let i = 0; i < 12; i++) {
      c.rotate(Math.PI / 6);
      c.fillRect(0, -H * 0.03, Math.max(W, H), H * 0.06);
    }
    c.restore();
    const s = Math.min(H * 0.8, W * 0.35);
    const ease = Math.min(1, phase * 6);
    const tall = H > W * 1.2;
    c.globalAlpha = ease;
    if (tall) ad.icon(c, W / 2, H * 0.3, Math.min(W * 0.8, H * 0.4), t);
    else ad.icon(c, W * 0.2, H * 0.52, s, t);
    c.globalAlpha = 1;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const tx = tall ? W / 2 : W * 0.62;
    const maxW = tall ? W * 0.9 : W * 0.68;
    let fs = tall ? W * 0.16 : H * 0.28;
    c.font = `900 ${fs}px ${F_TITLE}`;
    while (c.measureText(ad.brand).width > maxW && fs > 10) {
      fs -= 2;
      c.font = `900 ${fs}px ${F_TITLE}`;
    }
    c.fillStyle = ad.fg;
    c.shadowColor = ad.accent;
    c.shadowBlur = fs * 0.4;
    const slide = (1 - ease) * W * 0.2;
    c.fillText(ad.brand, tx + slide, tall ? H * 0.62 : H * 0.4);
    c.shadowBlur = 0;
    let ls = fs * 0.42;
    c.font = `700 ${ls}px ${F_BODY}`;
    while (c.measureText(ad.line).width > maxW && ls > 8) {
      ls -= 1;
      c.font = `700 ${ls}px ${F_BODY}`;
    }
    c.fillStyle = ad.accent;
    c.fillText(ad.line, tx - slide, tall ? H * 0.74 : H * 0.66);
    if (ad.small) {
      c.font = `600 ${ls * 0.6}px ${F_BODY}`;
      c.globalAlpha = 0.7;
      c.fillText(ad.small, tx, tall ? H * 0.82 : H * 0.84);
      c.globalAlpha = 1;
    }
  }

  private drawBoss(c: CanvasRenderingContext2D, W: number, H: number, t: number, owner: number, district: DistrictId, phase: number): void {
    const dadou = owner === Faction.DADOU;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, dadou ? '#3a0006' : '#020a24');
    g.addColorStop(1, dadou ? '#0a0002' : '#000208');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // bandes diagonales aux couleurs du parrain
    c.save();
    c.globalAlpha = 0.18;
    c.fillStyle = dadou ? '#ff2a3c' : '#4a8aff';
    for (let x = -H + ((t * 30) % 60); x < W; x += 60) {
      c.beginPath();
      c.moveTo(x, H);
      c.lineTo(x + 24, H);
      c.lineTo(x + 24 + H, 0);
      c.lineTo(x + H, 0);
      c.closePath();
      c.fill();
    }
    c.restore();
    const img = this.emblems[dadou ? 'dadou' : 'even'];
    const tall = H > W * 1.2;
    const es = tall ? W * 0.75 : H * 0.85;
    const ex = tall ? W / 2 - es / 2 : W * 0.05;
    const ey = tall ? H * 0.06 : H / 2 - es / 2;
    if (img.complete && img.naturalWidth > 0) {
      c.save();
      c.shadowColor = dadou ? '#ff2a3c' : '#4a8aff';
      c.shadowBlur = es * 0.15 * (0.7 + 0.3 * Math.sin(t * 3));
      c.drawImage(img, ex, ey, es, es);
      c.restore();
    }
    const name = dadou ? 'DADOU' : 'EVEN';
    const dist = DISTRICTS.find((d) => d.id === district)?.name ?? 'NEW YORK';
    const line = `RÈGNE SUR ${dist.toUpperCase()}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const tx = tall ? W / 2 : W * 0.6;
    const maxW = tall ? W * 0.92 : W * 0.72;
    let fs = tall ? W * 0.22 : H * 0.36;
    c.font = `900 ${fs}px ${F_TITLE}`;
    while (c.measureText(name).width > maxW && fs > 10) {
      fs -= 2;
      c.font = `900 ${fs}px ${F_TITLE}`;
    }
    const flick = phase < 0.05 && Math.sin(t * 90) > 0 ? 0.4 : 1;
    c.globalAlpha = flick;
    c.fillStyle = dadou ? '#ffd76a' : '#e8f0ff';
    c.shadowColor = dadou ? '#ff2a3c' : '#4a8aff';
    c.shadowBlur = fs * 0.5;
    c.fillText(name, tx, tall ? H * 0.68 : H * 0.36);
    c.shadowBlur = 0;
    let ls = fs * 0.36;
    c.font = `800 ${ls}px ${F_TITLE}`;
    while (c.measureText(line).width > maxW && ls > 8) {
      ls -= 1;
      c.font = `800 ${ls}px ${F_TITLE}`;
    }
    c.fillStyle = dadou ? '#ff6a78' : '#8ab8ff';
    c.fillText(line, tx, tall ? H * 0.8 : H * 0.66);
    c.font = `600 ${ls * 0.75}px ${F_BODY}`;
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillText(dadou ? 'LA MAFIA DE DADOU' : 'LA MAFIA D’EVEN', tx, tall ? H * 0.88 : H * 0.84);
    c.globalAlpha = 1;
  }

  private drawNews(c: CanvasRenderingContext2D, W: number, H: number, t: number): void {
    c.fillStyle = '#04070e';
    c.fillRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#002a4a');
    g.addColorStop(1, '#4a0a3a');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H * 0.78);
    // logo de la chaîne
    c.fillStyle = '#ff2a6a';
    c.fillRect(W * 0.03, H * 0.08, W * 0.2, H * 0.16);
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `900 ${H * 0.1}px ${F_TITLE}`;
    c.fillText('NY-NEWS 9', W * 0.13, H * 0.16);
    c.textAlign = 'left';
    c.font = `700 ${H * 0.07}px ${F_BODY}`;
    c.fillStyle = Math.floor(t * 2) % 2 ? '#ff3a5a' : '#ffffff';
    c.fillText('● EN DIRECT', W * 0.26, H * 0.16);
    // titre principal (change toutes les 6 s)
    const head = this.news[Math.floor(t / 6) % Math.max(1, Math.min(4, this.news.length))] ?? '';
    let fs = Math.min(H * 0.17, W * 0.075);
    c.font = `800 ${fs}px ${F_BODY}`;
    const words = head.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (c.measureText(test).width > W * 0.9 && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    if (lines.length > 3) fs *= 0.75;
    c.font = `800 ${fs}px ${F_BODY}`;
    c.fillStyle = '#ffffff';
    lines.slice(0, 4).forEach((l, i) => c.fillText(l, W * 0.04, H * 0.38 + i * fs * 1.05));
    this.drawTicker(c, W, H, t, '#ffd040', H * 0.8);
  }

  private drawTicker(c: CanvasRenderingContext2D, W: number, H: number, t: number, col: string, y0 = 0): void {
    const h = H - y0;
    c.fillStyle = '#100800';
    c.fillRect(0, y0, W, h);
    c.fillStyle = col;
    c.font = `800 ${h * 0.6}px ${F_BODY}`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    const text = `${this.news.join('   ◆   ')}   ◆   `;
    const tw = c.measureText(text).width;
    const x = -((t * h * 2.2) % tw);
    c.fillText(text, x, y0 + h / 2);
    c.fillText(text, x + tw, y0 + h / 2);
  }
}
