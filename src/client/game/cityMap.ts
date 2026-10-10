// Carte tactique holographique de New York 2085 : fond partagé par la mini-carte et la
// carte stratégique (rues, eau, parcs, immeubles, métro, limites des quartiers).

import type { BuildingInfo } from '../../shared/city/gen/context';
import {
  AREAS,
  BRIDGES,
  BUILDINGS,
  DISTRICTS,
  STREETS,
  SUBWAY_LINES,
  SUBWAY_STATIONS,
  SUBWAY_TUNNELS,
  WORLD_D,
  WORLD_W,
  type BuildingType,
} from '../../shared/city/plan';
import { GM } from '../../shared/city/gen/city';
import type { WorldData } from '../world/worldLoader';

export const MAP_SCALE = 6; // pixels par mètre

/** Polices de la carte (chargées par l'interface). */
export const MAP_FONT_TITLE = "'Orbitron', 'Rajdhani', sans-serif";
export const MAP_FONT = "'Rajdhani', 'Segoe UI', sans-serif";

/** Teinte de fond des bâtiments selon leur catégorie. */
const TYPE_COLOR: Partial<Record<BuildingType, string>> = {
  hideout: '#2a2230',
  garage: '#2a2a30',
  loft: '#2c2838',
  penthouse: '#302a40',
  tower: '#2c3048',
  bank: '#22324a',
  exchange: '#22324a',
  corp: '#22324a',
  security: '#1f3040',
  casino: '#3a2240',
  club: '#36203c',
  jazz: '#36283a',
  theatre: '#38243a',
  studio: '#24304a',
  police: '#1a2a44',
  depot: '#262c30',
  factory: '#282c2c',
  junkyard: '#2a2a26',
  brewery: '#2c2a28',
  station: '#2a2e3c',
  landmark: '#323a4c',
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (c: number, a = 1): string => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

export class CityMap {
  readonly base: HTMLCanvasElement;
  readonly w = WORLD_W * MAP_SCALE;
  readonly d = WORLD_D * MAP_SCALE;
  readonly buildings: BuildingInfo[];

  constructor(world: WorldData) {
    this.buildings = world.buildings;
    this.base = document.createElement('canvas');
    this.base.width = this.w;
    this.base.height = this.d;
    this.draw(world);
  }

  private draw(world: WorldData): void {
    const c = this.base.getContext('2d')!;
    const S = MAP_SCALE;
    const r = rng(2085);
    // fond : nuit profonde
    c.fillStyle = '#060a12';
    c.fillRect(0, 0, this.w, this.d);
    // sol : chaussées, trottoirs, parcs, eau… depuis la carte au sol (voxels)
    const gm = world.groundMap;
    const gw = world.gw;
    const img = c.getImageData(0, 0, this.w, this.d);
    const data = img.data;
    const COL: Record<number, [number, number, number]> = {
      [GM.ROAD]: [14, 19, 30],
      [GM.SIDEWALK]: [28, 35, 50],
      [GM.CURB]: [36, 44, 62],
      [GM.BUILDING]: [24, 29, 42],
      [GM.AREA]: [22, 27, 38],
      [GM.WATER]: [5, 22, 40],
      [GM.BRIDGE]: [40, 48, 66],
      [GM.BOUNDARY]: [10, 13, 20],
      [GM.PLAZA]: [30, 30, 46],
      [GM.PARK]: [12, 38, 28],
    };
    for (let py = 0; py < this.d; py++) {
      const vz = Math.min(world.gd - 1, Math.floor((py / S) * 4));
      for (let px = 0; px < this.w; px++) {
        const vx = Math.min(gw - 1, Math.floor((px / S) * 4));
        const g = gm[vz * gw + vx];
        const col = COL[g] ?? COL[GM.ROAD];
        const i = (py * this.w + px) * 4;
        let k = 1;
        if (g === GM.WATER) k = 0.85 + 0.25 * Math.sin(py * 0.9 + Math.sin(px * 0.05) * 2) * (py % 3 === 0 ? 1 : 0.3);
        data[i] = col[0] * k;
        data[i + 1] = col[1] * k;
        data[i + 2] = col[2] * k;
        data[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    // quadrillage tactique (10 m, renforcé tous les 50 m)
    c.lineWidth = 1;
    for (let m = 0; m <= Math.max(WORLD_W, WORLD_D); m += 10) {
      const major = m % 50 === 0;
      c.strokeStyle = major ? 'rgba(60,200,255,0.10)' : 'rgba(60,200,255,0.045)';
      if (m <= WORLD_W) {
        c.beginPath();
        c.moveTo(m * S + 0.5, 0);
        c.lineTo(m * S + 0.5, this.d);
        c.stroke();
      }
      if (m <= WORLD_D) {
        c.beginPath();
        c.moveTo(0, m * S + 0.5);
        c.lineTo(this.w, m * S + 0.5);
        c.stroke();
      }
    }
    // parcs : arbres en points lumineux, lac
    for (const a of AREAS) {
      const [x0, z0, x1, z1] = a.rect.map((v) => v * S);
      if (a.kind === 'park') {
        c.fillStyle = 'rgba(60,220,140,0.18)';
        for (let i = 0; i < ((x1 - x0) * (z1 - z0)) / 700; i++) {
          c.beginPath();
          c.arc(x0 + r() * (x1 - x0), z0 + r() * (z1 - z0), 2 + r() * 3, 0, Math.PI * 2);
          c.fill();
        }
        c.strokeStyle = 'rgba(60,220,140,0.45)';
        c.lineWidth = 1.5;
        c.strokeRect(x0 + 0.5, z0 + 0.5, x1 - x0 - 1, z1 - z0 - 1);
      } else if (a.kind === 'lake') {
        c.fillStyle = 'rgba(10,50,90,0.85)';
        c.beginPath();
        c.ellipse((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(80,190,255,0.5)';
        c.stroke();
      } else if (a.kind === 'plaza' || a.kind === 'square') {
        c.fillStyle = 'rgba(255,60,200,0.06)';
        c.fillRect(x0, z0, x1 - x0, z1 - z0);
        c.strokeStyle = 'rgba(255,60,200,0.35)';
        c.setLineDash([6, 6]);
        c.strokeRect(x0 + 0.5, z0 + 0.5, x1 - x0 - 1, z1 - z0 - 1);
        c.setLineDash([]);
      }
    }
    // tunnels et stations de métro (accès souterrains)
    c.lineCap = 'round';
    for (const t of SUBWAY_TUNNELS) {
      const line = SUBWAY_LINES.find((l) => l.id === t.line)!;
      c.strokeStyle = hex(line.color, 0.55);
      c.lineWidth = 5;
      c.setLineDash([10, 8]);
      c.beginPath();
      t.pts.forEach(([x, z], i) => (i ? c.lineTo(x * S, z * S) : c.moveTo(x * S, z * S)));
      c.stroke();
      c.setLineDash([]);
    }
    for (const s of SUBWAY_STATIONS) {
      const [x0, z0, x1, z1] = s.rect.map((v) => v * S);
      c.fillStyle = 'rgba(176,79,216,0.12)';
      c.fillRect(x0, z0, x1 - x0, z1 - z0);
      c.strokeStyle = 'rgba(200,140,255,0.5)';
      c.lineWidth = 1.5;
      c.setLineDash([4, 4]);
      c.strokeRect(x0, z0, x1 - x0, z1 - z0);
      c.setLineDash([]);
      for (const e of s.entrances) {
        c.fillStyle = '#0b0f18';
        c.beginPath();
        c.arc(e.x * S, e.z * S, 9, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#d7a8ff';
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = '#e8d0ff';
        c.font = `700 11px ${MAP_FONT_TITLE}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('M', e.x * S, e.z * S + 0.5);
      }
    }
    // ponts
    for (const b of BRIDGES) {
      const [x0, z0, x1, z1] = b.rect.map((v) => v * S);
      c.strokeStyle = 'rgba(160,200,255,0.55)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x0, z0 + 2);
      c.lineTo(x1, z0 + 2);
      c.moveTo(x0, z1 - 2);
      c.lineTo(x1, z1 - 2);
      c.stroke();
    }
    // bâtiments : aplats sombres et liseré lumineux
    for (const b of this.buildings) {
      const [x0, z0, x1, z1] = b.footprint.map((v) => v * S);
      c.fillStyle = TYPE_COLOR[b.def.type] ?? '#262c3c';
      c.fillRect(x0, z0, x1 - x0, z1 - z0);
      // trame fine (immeubles hauts : plus dense)
      c.save();
      c.beginPath();
      c.rect(x0, z0, x1 - x0, z1 - z0);
      c.clip();
      c.strokeStyle = 'rgba(120,180,255,0.07)';
      c.lineWidth = 1;
      const step = b.height > 30 ? 4 : 7;
      for (let k = -this.d; k < this.w; k += step) {
        c.beginPath();
        c.moveTo(k, z0);
        c.lineTo(k + (z1 - z0), z1);
        c.stroke();
      }
      c.restore();
      c.strokeStyle = b.def.capturable ? 'rgba(140,200,255,0.55)' : 'rgba(100,120,150,0.35)';
      c.lineWidth = 1.5;
      c.strokeRect(x0 + 0.75, z0 + 0.75, x1 - x0 - 1.5, z1 - z0 - 1.5);
      // entrée
      for (const dr of b.doors) {
        c.fillStyle = 'rgba(220,240,255,0.85)';
        c.fillRect(dr.x * S - 2.5, dr.z * S - 2.5, 5, 5);
      }
    }
    // quartiers : limites néon en pointillés
    c.setLineDash([12, 8]);
    c.lineWidth = 2;
    for (const d of DISTRICTS) {
      const [x0, z0, x1, z1] = d.rect.map((v) => v * S);
      c.strokeStyle = hex(d.neon, 0.5);
      c.strokeRect(x0 + 4, z0 + 4, Math.min(x1, this.w) - x0 - 8, Math.min(z1, this.d) - z0 - 8);
    }
    c.setLineDash([]);
    // noms des rues
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const s of STREETS) {
      if (s.x < 0 || s.x > WORLD_W) continue;
      c.save();
      c.translate(s.x * S, s.z * S);
      if (s.vertical) c.rotate(-Math.PI / 2);
      const water = s.name === 'East River' || s.name === 'Hudson';
      c.font = water ? `700 34px ${MAP_FONT_TITLE}` : `600 19px ${MAP_FONT}`;
      c.fillStyle = water ? 'rgba(90,190,255,0.55)' : 'rgba(150,185,225,0.62)';
      c.fillText(water ? s.name.toUpperCase() : s.name, 0, 0);
      c.restore();
    }
    for (const b of BRIDGES) {
      c.font = `600 16px ${MAP_FONT}`;
      c.fillStyle = 'rgba(170,210,255,0.7)';
      c.fillText(b.name, ((b.rect[0] + b.rect[2]) / 2) * S, b.rect[1] * S - 10);
    }
    // cartouche
    const cw = 360;
    const ch = 86;
    const cx = this.w - cw - 28;
    const cy = this.d - ch - 24;
    c.fillStyle = 'rgba(6,10,18,0.88)';
    c.fillRect(cx, cy, cw, ch);
    c.strokeStyle = 'rgba(60,220,255,0.7)';
    c.lineWidth = 2;
    c.strokeRect(cx, cy, cw, ch);
    c.strokeStyle = 'rgba(255,60,200,0.5)';
    c.lineWidth = 1;
    c.strokeRect(cx + 5, cy + 5, cw - 10, ch - 10);
    c.fillStyle = '#d8f4ff';
    c.font = `900 30px ${MAP_FONT_TITLE}`;
    c.fillText('NEW YORK · 2085', cx + cw / 2, cy + 32);
    c.fillStyle = 'rgba(160,210,240,0.85)';
    c.font = `600 18px ${MAP_FONT}`;
    c.fillText('Carte tactique de la guerre des gangs', cx + cw / 2, cy + 62);
    // nord
    const rx = 64;
    const ry = this.d - 86;
    c.save();
    c.translate(rx, ry);
    c.strokeStyle = 'rgba(60,220,255,0.8)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, 30, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = 'rgba(60,220,255,0.9)';
    c.beginPath();
    c.moveTo(0, -26);
    c.lineTo(8, 4);
    c.lineTo(0, -2);
    c.lineTo(-8, 4);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = '#d8f4ff';
    c.font = `700 18px ${MAP_FONT_TITLE}`;
    c.fillText('N', rx, ry - 44);
    // échelle
    c.fillStyle = 'rgba(60,220,255,0.9)';
    c.fillRect(120, this.d - 38, 20 * S, 3);
    c.fillRect(120, this.d - 44, 2, 15);
    c.fillRect(120 + 20 * S - 2, this.d - 44, 2, 15);
    c.font = `600 15px ${MAP_FONT}`;
    c.fillText('20 m', 120 + 10 * S, this.d - 54);
    // cadre
    c.strokeStyle = 'rgba(60,220,255,0.65)';
    c.lineWidth = 4;
    c.strokeRect(2, 2, this.w - 4, this.d - 4);
    c.strokeStyle = 'rgba(255,60,200,0.35)';
    c.lineWidth = 1.5;
    c.strokeRect(10, 10, this.w - 20, this.d - 20);
  }

  /** Noms des quartiers (dessinés par-dessus pour rester lisibles). */
  drawDistrictLabels(c: CanvasRenderingContext2D, s: number, ox: number, oy: number, alpha = 0.8): void {
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 ${Math.max(11, 28 * s)}px ${MAP_FONT_TITLE}`;
    for (const d of DISTRICTS) {
      const x = ox + d.label[0] * MAP_SCALE * s;
      const y = oy + d.label[1] * MAP_SCALE * s;
      const text = d.name.toUpperCase();
      const w = c.measureText(text).width;
      const hgt = 34 * Math.max(0.5, s);
      c.fillStyle = `rgba(6,10,18,${alpha * 0.72})`;
      c.fillRect(x - w / 2 - 10, y - hgt / 2, w + 20, hgt);
      c.strokeStyle = hex(d.neon, alpha * 0.8);
      c.lineWidth = 1.5;
      c.strokeRect(x - w / 2 - 10, y - hgt / 2, w + 20, hgt);
      c.shadowColor = hex(d.neon, 0.9);
      c.shadowBlur = 10;
      c.fillStyle = `rgba(235,248,255,${alpha})`;
      c.fillText(text, x, y + 1);
      c.shadowBlur = 0;
    }
    c.restore();
  }
}

export const BUILDING_DEFS = BUILDINGS;
