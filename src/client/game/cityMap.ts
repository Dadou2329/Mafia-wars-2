// Carte de Londres façon gravure sur papier : fond partagé par la mini-carte et la carte stratégique.

import type { BuildingInfo } from '../../shared/city/gen/context';
import { AREAS, BUILDINGS, DISTRICTS, PIERS, RIVER_Z, STREETS, WORLD_D, WORLD_W, type BuildingType } from '../../shared/city/plan';
import { GM } from '../../shared/city/gen/city';
import type { WorldData } from '../world/worldLoader';

export const MAP_SCALE = 6; // pixels par mètre

const TYPE_COLOR: Partial<Record<BuildingType, string>> = {
  bank: '#cdb98e',
  exchange: '#cdb98e',
  club: '#c9b48a',
  mansion: '#d2bf95',
  church: '#b9ab92',
  clocktower: '#b9ab92',
  police: '#a8a0b4',
  foundry: '#8f8172',
  brewery: '#9a8a74',
  mill: '#8f8172',
  gasworks: '#8a8478',
  warehouse: '#9c8a70',
  customs: '#bba989',
  shipyard: '#9c8a70',
  theatre: '#c9a98e',
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
    const r = rng(1888);
    // papier
    const grd = c.createRadialGradient(this.w * 0.45, this.d * 0.4, 50, this.w / 2, this.d / 2, this.w * 0.75);
    grd.addColorStop(0, '#efe2bf');
    grd.addColorStop(1, '#cbb68a');
    c.fillStyle = grd;
    c.fillRect(0, 0, this.w, this.d);
    for (let i = 0; i < 9000; i++) {
      c.fillStyle = `rgba(${90 + r() * 60},${60 + r() * 40},${30},${r() * 0.06})`;
      c.fillRect(r() * this.w, r() * this.d, 1 + r() * 2, 1 + r() * 2);
    }
    // taches
    for (let i = 0; i < 6; i++) {
      const x = r() * this.w;
      const y = r() * this.d;
      const rr = 30 + r() * 90;
      const g = c.createRadialGradient(x, y, rr * 0.6, x, y, rr);
      g.addColorStop(0, 'rgba(120,80,30,0)');
      g.addColorStop(0.9, 'rgba(120,80,30,0.08)');
      g.addColorStop(1, 'rgba(120,80,30,0)');
      c.fillStyle = g;
      c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    // sol : rues et trottoirs depuis la carte au sol (échantillonnée)
    const gm = world.groundMap;
    const gw = world.gw;
    const img = c.getImageData(0, 0, this.w, this.d);
    const data = img.data;
    for (let py = 0; py < this.d; py++) {
      const vz = Math.floor((py / S) * 4);
      for (let px = 0; px < this.w; px++) {
        const vx = Math.floor((px / S) * 4);
        const g = gm[vz * gw + vx];
        const i = (py * this.w + px) * 4;
        let tint: [number, number, number, number] | null = null;
        if (g === GM.SIDEWALK || g === GM.CURB) tint = [150, 120, 80, 0.16];
        else if (g === GM.BOUNDARY) tint = [90, 70, 50, 0.35];
        else if (g === GM.PIER) tint = [110, 80, 50, 0.45];
        if (tint) {
          data[i] = data[i] * (1 - tint[3]) + tint[0] * tint[3];
          data[i + 1] = data[i + 1] * (1 - tint[3]) + tint[1] * tint[3];
          data[i + 2] = data[i + 2] * (1 - tint[3]) + tint[2] * tint[3];
        }
      }
    }
    c.putImageData(img, 0, 0);
    // fleuve : lavis bleu-gris et hachures ondulées
    c.fillStyle = 'rgba(90,120,130,0.45)';
    c.fillRect(0, RIVER_Z * S, this.w, (WORLD_D - RIVER_Z) * S);
    c.strokeStyle = 'rgba(40,60,70,0.35)';
    c.lineWidth = 1;
    for (let y = RIVER_Z * S + 6; y < this.d; y += 7) {
      c.beginPath();
      for (let x = 0; x <= this.w; x += 8) c.lineTo(x, y + Math.sin(x * 0.05 + y) * 1.5);
      c.stroke();
    }
    c.strokeStyle = '#3a2a1a';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, RIVER_Z * S);
    c.lineTo(this.w, RIVER_Z * S);
    c.stroke();
    for (const p of PIERS) {
      c.fillStyle = 'rgba(120,85,50,0.8)';
      c.fillRect(p[0] * S, p[1] * S, (p[2] - p[0]) * S, (p[3] - p[1]) * S);
      c.strokeRect(p[0] * S, p[1] * S, (p[2] - p[0]) * S, (p[3] - p[1]) * S);
    }
    // jardins, places, marchés
    for (const a of AREAS) {
      const [x0, z0, x1, z1] = a.rect.map((v) => v * S);
      if (a.kind === 'garden' || a.kind === 'park') {
        c.fillStyle = 'rgba(110,140,80,0.4)';
        c.fillRect(x0, z0, x1 - x0, z1 - z0);
        c.fillStyle = 'rgba(60,90,40,0.55)';
        for (let i = 0; i < ((x1 - x0) * (z1 - z0)) / 900; i++) {
          c.beginPath();
          c.arc(x0 + r() * (x1 - x0), z0 + r() * (z1 - z0), 3 + r() * 4, 0, Math.PI * 2);
          c.fill();
        }
        c.strokeStyle = 'rgba(40,60,30,0.6)';
        c.strokeRect(x0, z0, x1 - x0, z1 - z0);
      } else if (a.kind === 'plaza') {
        c.fillStyle = 'rgba(160,140,110,0.25)';
        c.fillRect(x0, z0, x1 - x0, z1 - z0);
      } else if (a.kind === 'market') {
        c.strokeStyle = 'rgba(120,70,40,0.4)';
        for (let x = x0; x < x1; x += 6) {
          c.beginPath();
          c.moveTo(x, z0);
          c.lineTo(x, z1);
          c.stroke();
        }
      }
    }
    // limites de la ville
    c.fillStyle = 'rgba(70,50,35,0.55)';
    c.fillRect(0, 0, this.w, 5 * S);
    c.fillStyle = 'rgba(70,110,60,0.45)';
    c.fillRect(0, 5 * S, 4 * S, (RIVER_Z - 5) * S);
    c.fillStyle = 'rgba(70,50,35,0.55)';
    c.fillRect(198 * S, 5 * S, 2 * S, (RIVER_Z - 5) * S);
    // bâtiments
    for (const b of this.buildings) {
      const [x0, z0, x1, z1] = b.footprint.map((v) => v * S);
      c.fillStyle = TYPE_COLOR[b.def.type] ?? '#b98d6a';
      c.fillRect(x0, z0, x1 - x0, z1 - z0);
      // hachures d'ombre
      c.save();
      c.beginPath();
      c.rect(x0, z0, x1 - x0, z1 - z0);
      c.clip();
      c.strokeStyle = 'rgba(50,30,15,0.18)';
      c.lineWidth = 1;
      for (let k = -this.d; k < this.w; k += 5) {
        c.beginPath();
        c.moveTo(k, z0);
        c.lineTo(k + (z1 - z0), z1);
        c.stroke();
      }
      c.restore();
      // ombre portée
      c.fillStyle = 'rgba(40,25,10,0.25)';
      c.fillRect(x1, z0 + 4, 4, z1 - z0);
      c.fillRect(x0 + 4, z1, x1 - x0, 4);
      c.strokeStyle = '#2e2014';
      c.lineWidth = 2;
      c.strokeRect(x0, z0, x1 - x0, z1 - z0);
      // porte
      const dr = b.doors[0];
      c.fillStyle = '#2e2014';
      c.beginPath();
      c.arc(dr.x * S, dr.z * S, 3, 0, Math.PI * 2);
      c.fill();
    }
    // quartiers : limites en pointillés et noms
    c.setLineDash([10, 7]);
    c.strokeStyle = 'rgba(110,30,20,0.55)';
    c.lineWidth = 2;
    for (const d of DISTRICTS) {
      const [x0, z0, x1, z1] = d.rect.map((v) => v * S);
      c.strokeRect(x0 + 3, z0 + 3, Math.min(x1, this.w) - x0 - 6, Math.min(z1, RIVER_Z * S + 30) - z0 - 6);
    }
    c.setLineDash([]);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const s of STREETS) {
      c.save();
      c.translate(s.x * S, s.z * S);
      if (s.vertical) c.rotate(-Math.PI / 2);
      c.font = `italic ${s.name === 'Tamise' ? 44 : 22}px 'EB Garamond', Georgia, serif`;
      c.fillStyle = s.name === 'Tamise' ? 'rgba(30,50,60,0.75)' : 'rgba(50,35,20,0.7)';
      c.fillText(s.name === 'Tamise' ? 'La Tamise' : s.name, 0, 0);
      c.restore();
    }
    // cartouche
    const cw = 330;
    const ch = 92;
    const cx = this.w - cw - 30;
    const cy = this.d - ch - 26;
    c.fillStyle = 'rgba(239,226,191,0.95)';
    c.fillRect(cx, cy, cw, ch);
    c.strokeStyle = '#2e2014';
    c.lineWidth = 3;
    c.strokeRect(cx, cy, cw, ch);
    c.lineWidth = 1;
    c.strokeRect(cx + 6, cy + 6, cw - 12, ch - 12);
    c.fillStyle = '#2e2014';
    c.font = "700 30px 'Cinzel', serif";
    c.fillText('LONDRES', cx + cw / 2, cy + 34);
    c.font = "italic 18px 'EB Garamond', serif";
    c.fillText('Plan de la guerre des gangs — 1888', cx + cw / 2, cy + 64);
    // rose des vents
    const rx = 70;
    const ry = this.d - 90;
    c.save();
    c.translate(rx, ry);
    c.fillStyle = '#2e2014';
    for (let i = 0; i < 4; i++) {
      c.rotate(Math.PI / 2);
      c.beginPath();
      c.moveTo(0, -46);
      c.lineTo(9, 0);
      c.lineTo(-9, 0);
      c.closePath();
      c.fill();
    }
    c.fillStyle = '#efe2bf';
    c.beginPath();
    c.arc(0, 0, 6, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.fillStyle = '#2e2014';
    c.font = "700 18px 'Cinzel', serif";
    c.fillText('N', rx, ry - 58);
    // échelle
    c.fillRect(130, this.d - 40, 20 * S, 4);
    c.font = "14px 'EB Garamond', serif";
    c.fillText('20 m', 130 + 10 * S, this.d - 54);
    // cadre
    c.strokeStyle = '#2e2014';
    c.lineWidth = 6;
    c.strokeRect(3, 3, this.w - 6, this.d - 6);
    c.lineWidth = 1.5;
    c.strokeRect(12, 12, this.w - 24, this.d - 24);
  }

  /** Noms des quartiers (dessinés par-dessus pour rester lisibles). */
  drawDistrictLabels(c: CanvasRenderingContext2D, s: number, ox: number, oy: number, alpha = 0.75): void {
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${Math.max(12, 30 * s)}px 'Cinzel', serif`;
    for (const d of DISTRICTS) {
      const x = ox + d.label[0] * MAP_SCALE * s;
      const y = oy + d.label[1] * MAP_SCALE * s;
      c.fillStyle = `rgba(239,226,191,${alpha * 0.6})`;
      const w = c.measureText(d.name.toUpperCase()).width;
      c.fillRect(x - w / 2 - 8, y - 18 * Math.max(0.5, s), w + 16, 36 * Math.max(0.5, s));
      c.fillStyle = `rgba(60,25,15,${alpha})`;
      c.fillText(d.name.toUpperCase(), x, y);
    }
    c.restore();
  }
}

export const BUILDING_DEFS = BUILDINGS;
