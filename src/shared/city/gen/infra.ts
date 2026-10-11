// Infrastructures de New York : ponts sur l'East River et sur Newtown Creek, métro (stations,
// tunnels, escaliers, rames), viaducs ferroviaires au nord et au sud de Brooklyn, voie rapide
// surélevée (BQE) à l'est.

import { M } from '../../materials';
import { GROUND_VY, INV_VOXEL, VOXEL } from '../../voxel';
import {
  BRIDGES,
  EAST_LIMIT,
  RIVER_X0,
  RIVER_X1,
  SUBWAY_LINES,
  SUBWAY_STATIONS,
  SUBWAY_TUNNELS,
  SUBWAY_Y,
  WORLD_D,
  WORLD_W,
  isWater,
  stationHub,
  type Rect,
  type Side,
  type SubwayStation,
} from '../plan';
import type { GenContext } from './context';

const V = (m: number): number => Math.round(m * INV_VOXEL);
/** Couche voxel (absolue) d'une altitude en mètres. */
const Y = (m: number): number => Math.round(m * INV_VOXEL) + GROUND_VY;

// ======================================================================= ponts

export function buildBridges(ctx: GenContext): void {
  for (const br of BRIDGES) {
    if (br.axis === 'x') riverBridge(ctx, br);
    else creekBridge(ctx, br.rect);
  }
}

/** Pont sur l'East River (tablier est-ouest) : chaussée, trottoirs de bois, superstructure. */
function riverBridge(ctx: GenContext, br: (typeof BRIDGES)[number]): void {
  const w = ctx.world;
  const [, bz0, , bz1] = br.rect;
  const z0 = V(bz0);
  const z1 = V(bz1);
  const rx0 = V(RIVER_X0);
  const rx1 = V(RIVER_X1);
  const girder = br.key === 'brooklyn' ? M.GRANITE : br.key === 'queensboro' ? M.STEEL_GREEN : br.key === 'williamsburg' ? M.PAINT_RED : M.STEEL;
  // tablier : poutres sous la chaussée, trottoirs surélevés, garde-corps
  for (let x = rx0 - 2; x < rx1 + 2; x++) {
    w.fill(x, GROUND_VY - 6, z0, x + 1, GROUND_VY - 1, z1, girder);
    w.fill(x, GROUND_VY - 1, z0 + 8, x + 1, GROUND_VY, z1 - 8, M.ASPHALT);
    w.fill(x, GROUND_VY - 1, z0, x + 1, GROUND_VY + 1, z0 + 8, M.DECK_WOOD);
    w.fill(x, GROUND_VY - 1, z1 - 8, x + 1, GROUND_VY + 1, z1, M.DECK_WOOD);
    w.fill(x, GROUND_VY + 1, z0, x + 1, GROUND_VY + 5, z0 + 1, M.BARRIER);
    w.fill(x, GROUND_VY + 1, z1 - 1, x + 1, GROUND_VY + 5, z1, M.BARRIER);
    if (x % 4 === 0) {
      w.fill(x, GROUND_VY + 1, z0, x + 1, GROUND_VY + 5, z0 + 1, M.IRON);
      w.fill(x, GROUND_VY + 1, z1 - 1, x + 1, GROUND_VY + 5, z1, M.IRON);
    }
    w.fill(x, GROUND_VY + 4, z0, x + 1, GROUND_VY + 5, z0 + 1, M.IRON);
    w.fill(x, GROUND_VY + 4, z1 - 1, x + 1, GROUND_VY + 5, z1, M.IRON);
    // marquage central
    const mid = Math.round((z0 + z1) / 2);
    if (x % 12 < 6) w.fill(x, GROUND_VY - 1, mid - 1, x + 1, GROUND_VY, mid + 1, M.LINE_YELLOW);
  }
  // piles dans la rivière
  for (const px of [rx0 + 36, rx1 - 40]) w.fill(px, 0, z0 + 2, px + 4, GROUND_VY - 6, z1 - 2, M.GRANITE);
  if (br.key === 'brooklyn') brooklynTowers(ctx, rx0, rx1, z0, z1);
  else if (br.key === 'queensboro') queensboroTruss(ctx, rx0, rx1, z0, z1);
  else steelSuspension(ctx, rx0, rx1, z0, z1, br.key === 'williamsburg' ? M.PAINT_RED : M.STEEL, br.key === 'williamsburg');
  // lampadaires sur le pont
  for (let xm = RIVER_X0 + 3; xm < RIVER_X1 - 2; xm += 7) {
    ctx.prop('PARK_LAMP', xm, 0.25, bz0 + 0.6, 0);
    ctx.prop('PARK_LAMP', xm + 3.5, 0.25, bz1 - 0.6, Math.PI);
  }
}

/** Câbles porteurs et suspentes entre deux tours (et vers les rives). */
function cables(ctx: GenContext, rx0: number, rx1: number, z0: number, z1: number, towers: number[], tw: number, cableTop: number, mat: number): void {
  const w = ctx.world;
  // les travées de rive s'arrêtent sur les promenades (pas de câble au-dessus des voies rapides)
  const spans: [number, number][] = [
    [rx0 - 18, towers[0]],
    [towers[0] + tw, towers[1]],
    [towers[1] + tw, rx1 + 18],
  ];
  for (const [a, b] of spans) {
    for (let x = a; x < b; x++) {
      const t = (x - a) / (b - a);
      const sag = 4 * t * (1 - t);
      const y = Math.round(cableTop - sag * (cableTop - GROUND_VY - 8));
      const yy = a < towers[0] ? Math.round(GROUND_VY + 4 + t * (cableTop - GROUND_VY - 4)) : a > towers[1] ? Math.round(cableTop - t * (cableTop - GROUND_VY - 4)) : y;
      for (const cz of [z0 + 1, z1 - 2]) {
        w.set(x, yy, cz, mat);
        if (x % 6 === 0) w.fill(x, GROUND_VY + 4, cz, x + 1, yy, cz + 1, mat);
      }
    }
  }
}

/** Tours gothiques en granit et câbles du pont de Brooklyn. */
function brooklynTowers(ctx: GenContext, rx0: number, rx1: number, z0: number, z1: number): void {
  const w = ctx.world;
  const top = GROUND_VY + 120;
  const towers = [rx0 + 18, rx1 - 24];
  for (const tx of towers) {
    // deux piles reliées par des arches ogivales au-dessus de la chaussée
    w.fill(tx, GROUND_VY - 6, z0 - 6, tx + 6, top, z0 + 4, M.GRANITE);
    w.fill(tx, GROUND_VY - 6, z1 - 4, tx + 6, top, z1 + 6, M.GRANITE);
    w.fill(tx, GROUND_VY + 64, z0 - 6, tx + 6, top, z1 + 6, M.GRANITE);
    // arche ogivale
    for (let z = z0 + 4; z < z1 - 4; z++) {
      const t = Math.abs(z - (z0 + z1) / 2) / ((z1 - z0) / 2 - 4);
      const archTop = GROUND_VY + 64 - Math.round(t * t * 14);
      w.fill(tx, archTop, z, tx + 6, GROUND_VY + 64, z + 1, M.GRANITE);
    }
    // corniche et lumières
    w.fill(tx - 1, top, z0 - 7, tx + 7, top + 2, z1 + 7, M.GRANITE);
    w.fill(tx - 1, top + 2, z0 - 7, tx + 7, top + 3, z1 + 7, M.LED_WARM);
    ctx.light((tx + 3) * VOXEL, (top - GROUND_VY) * VOXEL + 2, ((z0 + z1) / 2) * VOXEL, 1, 14, 0xffd8a0);
  }
  cables(ctx, rx0, rx1, z0, z1, towers, 6, top - 2, M.STEEL);
}

/** Tours d'acier en treillis et câbles (ponts de Williamsburg et de Triborough). */
function steelSuspension(ctx: GenContext, rx0: number, rx1: number, z0: number, z1: number, mat: number, lattice: boolean): void {
  const w = ctx.world;
  const top = GROUND_VY + 112;
  const towers = [rx0 + 20, rx1 - 24];
  for (const tx of towers) {
    for (const [za, zb] of [
      [z0 - 5, z0 + 2],
      [z1 - 2, z1 + 5],
    ]) {
      // pile : quatre montants reliés par des croisillons
      w.fill(tx, GROUND_VY - 6, za, tx + 1, top, za + 1, mat);
      w.fill(tx + 3, GROUND_VY - 6, za, tx + 4, top, za + 1, mat);
      w.fill(tx, GROUND_VY - 6, zb - 1, tx + 1, top, zb, mat);
      w.fill(tx + 3, GROUND_VY - 6, zb - 1, tx + 4, top, zb, mat);
      for (let y = GROUND_VY + 2; y < top; y += lattice ? 6 : 10) {
        w.fill(tx, y, za, tx + 4, y + 1, zb, mat);
        if (lattice) for (let k = 0; k < 4; k++) w.set(tx + k, y + 1 + k, za, mat);
      }
    }
    // portiques entre les deux piles, au-dessus de la chaussée
    for (const y of [GROUND_VY + 48, GROUND_VY + 80, top - 4]) w.fill(tx, y, z0 - 5, tx + 4, y + 3, z1 + 5, mat);
    w.fill(tx - 1, top, z0 - 6, tx + 5, top + 2, z1 + 6, mat);
    w.fill(tx + 1, top + 2, z0 - 3, tx + 3, top + 3, z1 + 3, M.LED_WHITE);
    ctx.light((tx + 2) * VOXEL, (top - GROUND_VY) * VOXEL + 1, ((z0 + z1) / 2) * VOXEL, 0.9, 12, 0xe0ecff);
  }
  cables(ctx, rx0, rx1, z0, z1, towers, 4, top - 2, mat);
  // poutre de rigidité en treillis le long du tablier (Williamsburg)
  if (lattice) {
    for (const cz of [z0 - 1, z1]) {
      for (let x = rx0 - 2; x < rx1 + 2; x++) {
        w.set(x, GROUND_VY + 9, cz, mat);
        const p = (x - rx0) % 12;
        w.set(x, GROUND_VY + 1 + Math.round((p * 8) / 12), cz, mat);
        if (p === 0) w.fill(x, GROUND_VY - 1, cz, x + 1, GROUND_VY + 9, cz + 1, mat);
      }
    }
  }
}

/** Treillis d'acier du pont de Queensboro. */
function queensboroTruss(ctx: GenContext, rx0: number, rx1: number, z0: number, z1: number): void {
  const w = ctx.world;
  const h = 40;
  for (const cz of [z0, z1 - 1]) {
    for (let x = rx0 - 4; x < rx1 + 4; x++) {
      const local = x - (rx0 - 4);
      const span = rx1 - rx0 + 8;
      const t = local / span;
      const top = GROUND_VY + 5 + Math.round(h * (0.55 + 0.45 * Math.abs(Math.cos(t * Math.PI * 2))));
      w.set(x, top, cz, M.STEEL_GREEN);
      w.set(x, GROUND_VY + 5, cz, M.STEEL_GREEN);
      // croisillons en X
      const p = local % 16;
      const yd = Math.round(((top - GROUND_VY - 5) * p) / 16);
      w.set(x, GROUND_VY + 5 + yd, cz, M.STEEL_GREEN);
      w.set(x, top - yd, cz, M.STEEL_GREEN);
      if (p === 0) w.fill(x, GROUND_VY + 1, cz, x + 1, top, cz + 1, M.STEEL_GREEN);
    }
  }
  // traverses hautes
  for (let x = rx0 - 4; x < rx1 + 4; x += 16) w.fill(x, GROUND_VY + 30, z0, x + 1, GROUND_VY + 31, z1, M.STEEL_GREEN);
  // tours d'extrémité à flèches
  for (const tx of [rx0 - 6, rx1 + 2]) {
    for (const cz of [z0 - 2, z1 - 2]) {
      w.fill(tx, GROUND_VY - 6, cz, tx + 4, GROUND_VY + 60, cz + 4, M.STEEL_GREEN);
      w.fill(tx + 1, GROUND_VY + 60, cz + 1, tx + 3, GROUND_VY + 70, cz + 3, M.STEEL_GREEN);
      w.fill(tx + 1, GROUND_VY + 70, cz + 1, tx + 3, GROUND_VY + 71, cz + 3, M.LED_WHITE);
    }
    w.fill(tx, GROUND_VY + 56, z0 - 2, tx + 4, GROUND_VY + 60, z1 + 2, M.STEEL_GREEN);
  }
  void ctx;
}

/** Pont basculant Pulaski sur Newtown Creek (tablier nord-sud, poutres d'acier, guérites). */
function creekBridge(ctx: GenContext, r: Rect): void {
  const w = ctx.world;
  const [x0, z0, x1, z1] = r.map(V);
  for (let z = z0 - 2; z < z1 + 2; z++) {
    w.fill(x0, GROUND_VY - 5, z, x1, GROUND_VY - 1, z + 1, M.STEEL_BLUE);
    w.fill(x0 + 8, GROUND_VY - 1, z, x1 - 8, GROUND_VY, z + 1, M.ASPHALT);
    w.fill(x0, GROUND_VY - 1, z, x0 + 8, GROUND_VY + 1, z + 1, M.CONCRETE);
    w.fill(x1 - 8, GROUND_VY - 1, z, x1, GROUND_VY + 1, z + 1, M.CONCRETE);
    // poutres latérales en treillis
    for (const cx of [x0, x1 - 1]) {
      w.fill(cx, GROUND_VY + 1, z, cx + 1, GROUND_VY + 6, z + 1, M.BARRIER);
      w.set(cx, GROUND_VY + 6, z, M.STEEL_BLUE);
      const p = (z - z0 + 64) % 10;
      w.set(cx, GROUND_VY + 1 + Math.round(p / 2), z, M.STEEL_BLUE);
      if (p === 0) w.fill(cx, GROUND_VY + 1, z, cx + 1, GROUND_VY + 6, z + 1, M.STEEL_BLUE);
    }
    const mid = Math.round((x0 + x1) / 2);
    if (z % 12 < 6) w.fill(mid - 1, GROUND_VY - 1, z, mid + 1, GROUND_VY, z + 1, M.LINE_YELLOW);
  }
  // guérites de l'éclusier aux deux bouts
  for (const [gx, gz] of [
    [x0 - 10, z0 - 4],
    [x1 + 2, z1 - 4],
  ]) {
    w.fill(gx, GROUND_VY + 1, gz, gx + 8, GROUND_VY + 12, gz + 8, M.BRICK_RED);
    w.fill(gx + 1, GROUND_VY + 6, gz, gx + 7, GROUND_VY + 10, gz + 1, M.GLASS_LIT);
    w.fill(gx - 1, GROUND_VY + 12, gz - 1, gx + 9, GROUND_VY + 13, gz + 9, M.COPPER_GREEN);
  }
  for (let zm = r[1] + 2; zm < r[3]; zm += 7) {
    ctx.prop('PARK_LAMP', r[0] + 0.6, 0.25, zm, Math.PI / 2);
    ctx.prop('PARK_LAMP', r[2] - 0.6, 0.25, zm + 3.5, -Math.PI / 2);
  }
}

// ======================================================================= métro

/** Longueur au sol (m) d'un escalier de bouche de métro. */
const STAIR_LEN = 8.75;

/** Emprise au sol (m) de l'escalier d'une bouche de métro. */
export function stairRect(x: number, z: number, dir: Side): Rect {
  switch (dir) {
    case 'S':
      return [x - 1.5, z, x + 1.5, z + STAIR_LEN];
    case 'N':
      return [x - 1.5, z - STAIR_LEN, x + 1.5, z];
    case 'E':
      return [x, z - 1.5, x + STAIR_LEN, z + 1.5];
    case 'W':
      return [x - STAIR_LEN, z - 1.5, x, z + 1.5];
  }
}

/** Voies d'une station : tranchée de 4 m de large dans le quai (rect en m) et axe. */
interface Track {
  line: string;
  axis: 'x' | 'z';
  /** Coordonnée de l'axe de la voie (m). */
  at: number;
  /** Étendue le long de la voie dans la station (m). */
  a0: number;
  a1: number;
}

function stationTracks(st: SubwayStation): Track[] {
  const out: Track[] = [];
  const [sx0, sz0, sx1, sz1] = st.rect;
  for (const t of SUBWAY_TUNNELS) {
    if (!st.lines.includes(t.line)) continue;
    for (let i = 0; i + 1 < t.pts.length; i++) {
      const [ax, az] = t.pts[i];
      const [bx, bz] = t.pts[i + 1];
      if (ax === bx) {
        if (ax <= sx0 || ax >= sx1) continue;
        const a0 = Math.max(sz0, Math.min(az, bz) - 2);
        const a1 = Math.min(sz1, Math.max(az, bz) + 2);
        if (a1 > a0) out.push({ line: t.line, axis: 'z', at: ax, a0, a1 });
      } else {
        if (az <= sz0 || az >= sz1) continue;
        const a0 = Math.max(sx0, Math.min(ax, bx) - 2);
        const a1 = Math.min(sx1, Math.max(ax, bx) + 2);
        if (a1 > a0) out.push({ line: t.line, axis: 'x', at: az, a0, a1 });
      }
    }
  }
  return out;
}

/** Point sur le quai, au bord de la voie d'une ligne (là où l'on attend la rame). */
function platformPoint(st: SubwayStation, line: string): { x: number; z: number; y: number } {
  const tracks = stationTracks(st);
  const [sx0, sz0, sx1, sz1] = st.rect;
  const inTrench = (x: number, z: number) => tracks.some((t) => (t.axis === 'z' ? Math.abs(x - t.at) < 2.3 && z >= t.a0 && z < t.a1 : Math.abs(z - t.at) < 2.3 && x >= t.a0 && x < t.a1));
  const y = SUBWAY_Y + 0.5;
  const t = tracks.find((k) => k.line === line);
  if (!t) return { x: (sx0 + sx1) / 2, z: (sz0 + sz1) / 2, y };
  const mid = t.axis === 'z' ? Math.max(t.a0 + 2, Math.min(t.a1 - 2, (sz0 + sz1) / 2)) : Math.max(t.a0 + 2, Math.min(t.a1 - 2, (sx0 + sx1) / 2));
  for (const off of [3.2, -3.2, 4.5, -4.5]) {
    const x = t.axis === 'z' ? t.at + off : mid;
    const z = t.axis === 'z' ? mid : t.at + off;
    if (x > sx0 + 0.8 && x < sx1 - 0.8 && z > sz0 + 0.8 && z < sz1 - 0.8 && !inTrench(x, z)) return { x, z, y };
  }
  return { x: (sx0 + sx1) / 2, z: (sz0 + sz1) / 2, y };
}

export function buildSubway(ctx: GenContext): void {
  const w = ctx.world;
  const floor = Y(SUBWAY_Y); // première couche d'air du tunnel
  const ceil = Y(-4.0); // première couche du plafond des tunnels
  const stCeil = Y(-3.0); // plafond des stations
  // tunnels
  for (const t of SUBWAY_TUNNELS) {
    const color = SUBWAY_LINES.find((l) => l.id === t.line)?.color ?? 0xffffff;
    for (let i = 0; i + 1 < t.pts.length; i++) {
      const [ax, az] = t.pts[i];
      const [bx, bz] = t.pts[i + 1];
      const x0 = V(Math.min(ax, bx) - 2);
      const x1 = V(Math.max(ax, bx) + 2);
      const z0 = V(Math.min(az, bz) - 2);
      const z1 = V(Math.max(az, bz) + 2);
      // coffrage de béton puis vide intérieur
      w.fill(x0 - 2, floor - 2, z0 - 2, x1 + 2, ceil + 2, z1 + 2, M.CONCRETE_DARK);
      w.fill(x0, floor, z0, x1, ceil, z1, 0);
      w.fill(x0, floor - 1, z0, x1, floor, z1, M.GRAVEL);
      // rails
      const alongX = ax !== bx;
      if (alongX) {
        const mz = Math.round((z0 + z1) / 2);
        for (const rz of [mz - 3, mz + 3]) w.fill(x0, floor, rz, x1, floor + 1, rz + 1, M.STEEL);
        for (let x = x0; x < x1; x += 4) w.fill(x, floor - 1, mz - 4, x + 1, floor, mz + 5, M.WALNUT);
      } else {
        const mx = Math.round((x0 + x1) / 2);
        for (const rx of [mx - 3, mx + 3]) w.fill(rx, floor, z0, rx + 1, floor + 1, z1, M.STEEL);
        for (let z = z0; z < z1; z += 4) w.fill(mx - 4, floor - 1, z, mx + 5, floor, z + 1, M.WALNUT);
      }
      // éclairage du tunnel
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 4; s < len; s += 12) {
        const px = ax + ((bx - ax) * s) / len;
        const pz = az + ((bz - az) * s) / len;
        ctx.light(px, SUBWAY_Y + 3, pz, 0.55, 6, s % 24 < 12 ? 0xdfe8ff : color);
        const vx = V(px);
        const vz = V(pz);
        if (alongX) w.fill(vx, ceil - 1, z0, vx + 2, ceil, z0 + 1, M.LED_WHITE);
        else w.fill(x0, ceil - 1, vz, x0 + 1, ceil, vz + 2, M.LED_WHITE);
      }
    }
  }
  // stations
  const lineMat: Record<string, number> = { '1': M.NEON_RED, '6': M.NEON_GREEN, '7': M.NEON_PURPLE, L: M.STEEL };
  for (const st of SUBWAY_STATIONS) {
    const [sx0, sz0, sx1, sz1] = st.rect.map(V);
    w.fill(sx0 - 2, floor - 2, sz0 - 2, sx1 + 2, stCeil + 2, sz1 + 2, M.CONCRETE_DARK);
    w.fill(sx0, floor, sz0, sx1, stCeil, sz1, 0);
    // murs carrelés de blanc (carreaux de métro), bandeau de couleur de la ligne
    const band = lineMat[st.lines[0]] ?? M.STEEL;
    for (let y = floor; y < stCeil; y++) {
      const m = y === floor + 9 ? M.TILE_GREEN : y === floor + 10 ? band : M.TILE_WHITE;
      w.fill(sx0, y, sz0, sx1, y + 1, sz0 + 1, m);
      w.fill(sx0, y, sz1 - 1, sx1, y + 1, sz1, m);
      w.fill(sx0, y, sz0, sx0 + 1, y + 1, sz1, m);
      w.fill(sx1 - 1, y, sz0, sx1, y + 1, sz1, m);
    }
    w.fill(sx0, stCeil - 1, sz0, sx1, stCeil, sz1, M.CEILING_PANEL);
    // quai
    w.fill(sx0 + 1, floor - 1, sz0 + 1, sx1 - 1, floor + 2, sz1 - 1, M.TERRAZZO);
    // voies : tranchées dans le quai, ouvertes sur les tunnels
    const tracks = stationTracks(st);
    for (const t of tracks) {
      const a0 = V(t.a0);
      const a1 = V(t.a1);
      const c0 = V(t.at - 2);
      const c1 = V(t.at + 2);
      const box = (u0: number, y0: number, u1: number, y1: number, v0: number, v1: number, m: number) =>
        t.axis === 'z' ? w.fill(u0, y0, v0, u1, y1, v1, m) : w.fill(v0, y0, u0, v1, y1, u1, m);
      // (u : travers de la voie, v : long de la voie)
      box(c0, floor - 1, c1, floor + 2, a0, a1, 0);
      box(c0, floor - 1, c1, floor, a0, a1, M.GRAVEL);
      box(c0 + 4, floor, c0 + 5, floor + 1, a0, a1, M.STEEL);
      box(c1 - 5, floor, c1 - 4, floor + 1, a0, a1, M.STEEL);
      // bords de quai jaunes
      box(c0 - 1, floor + 1, c0, floor + 2, a0, a1, M.LINE_YELLOW);
      box(c1, floor + 1, c1 + 1, floor + 2, a0, a1, M.LINE_YELLOW);
      // le tunnel débouche dans la station : on ouvre les murs à ses extrémités
      const sMin = t.axis === 'z' ? sz0 : sx0;
      const sMax = t.axis === 'z' ? sz1 : sx1;
      if (a0 <= sMin + 1) box(c0, floor, c1, ceil, sMin - 3, sMin + 1, 0);
      if (a1 >= sMax - 1) box(c0, floor, c1, ceil, sMax - 1, sMax + 3, 0);
    }
    // piliers carrelés de vert entre les voies, dans les grandes stations
    const W = st.rect[2] - st.rect[0];
    const D = st.rect[3] - st.rect[1];
    if (W >= 30 && D >= 30) {
      const clear = (x: number, z: number) => tracks.every((t) => (t.axis === 'z' ? Math.abs(x - t.at) > 3.5 : Math.abs(z - t.at) > 3.5));
      for (let xm = st.rect[0] + 6; xm < st.rect[2] - 4; xm += 9)
        for (let zm = st.rect[1] + 6; zm < st.rect[3] - 4; zm += 9) {
          if (!clear(xm, zm)) continue;
          w.fill(V(xm), floor + 2, V(zm), V(xm) + 3, stCeil, V(zm) + 3, M.TILE_GREEN);
        }
    }
    // panneaux du nom de la station (bandeau noir) sur les grands murs
    const cxv = Math.round((sx0 + sx1) / 2);
    const czv = Math.round((sz0 + sz1) / 2);
    if (sx1 - sx0 >= sz1 - sz0) {
      w.fill(cxv - 16, floor + 12, sz0 + 1, cxv + 16, floor + 15, sz0 + 2, M.PAINT_BLACK);
      w.fill(cxv - 16, floor + 12, sz1 - 2, cxv + 16, floor + 15, sz1 - 1, M.PAINT_BLACK);
    } else {
      w.fill(sx0 + 1, floor + 12, czv - 16, sx0 + 2, floor + 15, czv + 16, M.PAINT_BLACK);
      w.fill(sx1 - 2, floor + 12, czv - 16, sx1 - 1, floor + 15, czv + 16, M.PAINT_BLACK);
    }
    // éclairage, bancs et distributeurs
    for (let x = st.rect[0] + 3; x < st.rect[2] - 2; x += 8)
      for (let z = st.rect[1] + 3; z < st.rect[3] - 2; z += 8) ctx.light(x, SUBWAY_Y + 3.6, z, 0.75, 8, 0xe8f0ff);
    const py = SUBWAY_Y + 0.5;
    for (const line of st.lines) {
      const p = platformPoint(st, line);
      const t = tracks.find((k) => k.line === line);
      if (!t) continue;
      // un banc le dos à la voie, un peu plus loin sur le quai
      const along = t.axis === 'z' ? { x: p.x + Math.sign(p.x - t.at) * 1.2, z: p.z + 3 } : { x: p.x + 3, z: p.z + Math.sign(p.z - t.at) * 1.2 };
      const yaw = t.axis === 'z' ? (p.x > t.at ? -Math.PI / 2 : Math.PI / 2) : p.z > t.at ? Math.PI : 0;
      ctx.prop('BENCH', along.x, py, along.z, yaw, 0);
    }
    const vend = { x: st.rect[0] + 1.4, z: (st.rect[1] + st.rect[3]) / 2 + 2 };
    if (!tracks.some((t) => (t.axis === 'z' ? Math.abs(vend.x - t.at) < 4 : Math.abs(vend.z - t.at) < 4))) ctx.prop('VENDING_MACHINE', vend.x, py, vend.z, Math.PI / 2, 1);
    // escaliers d'accès
    for (const e of st.entrances) stairsDown(ctx, e.x, e.z, e.dir, floor + 2);
  }
  // rames : portails de navigation entre stations voisines d'une même ligne (les PNJ « prennent le
  // métro »). Toutes les rames d'une station partent du centre du quai (correspondances immédiates).
  const byKey = new Map(SUBWAY_STATIONS.map((s) => [s.key, s]));
  for (const line of SUBWAY_LINES) {
    for (let i = 0; i + 1 < line.stations.length; i++) {
      const a = byKey.get(line.stations[i]);
      const b = byKey.get(line.stations[i + 1]);
      if (!a || !b) continue;
      const pa = stationHub(a);
      const pb = stationHub(b);
      const dist = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      ctx.portals.push({ kind: 'train', ax: pa.x, ay: pa.y, az: pa.z, bx: pb.x, by: pb.y, bz: pb.z, cost: 40 + dist * 0.5 });
    }
  }
}

/** Escalier de bouche de métro : départ au niveau de la rue en (x, z), descente dans la direction donnée. */
function stairsDown(ctx: GenContext, xm: number, zm: number, dir: Side, bottomVy: number): void {
  const w = ctx.world;
  const width = 10;
  const dx = dir === 'E' ? 1 : dir === 'W' ? -1 : 0;
  const dz = dir === 'S' ? 1 : dir === 'N' ? -1 : 0;
  const ox = V(xm);
  const oz = V(zm);
  const steps = GROUND_VY + 1 - bottomVy;
  // axe perpendiculaire
  const px = dz !== 0 ? 1 : 0;
  const pz = dx !== 0 ? 1 : 0;
  const half = width / 2;
  for (let k = 0; k < steps + 6; k++) {
    const y = Math.max(bottomVy, GROUND_VY + 1 - k);
    for (let s = -half - 1; s < half + 1; s++) {
      const x = ox + dx * k + px * s;
      const z = oz + dz * k + pz * s;
      const edge = s < -half || s >= half;
      if (edge) {
        // murs latéraux carrelés
        w.fill(x, y - 2, z, x + 1, GROUND_VY + 1, z + 1, M.TILE_WHITE);
        if (k < steps) w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 5, z + 1, M.BARRIER);
        continue;
      }
      // marche : plein dessous, vide au-dessus
      w.fill(x, y - 3, z, x + 1, y, z + 1, k < steps ? M.CONCRETE : M.TERRAZZO);
      w.fill(x, y, z, x + 1, Math.max(y + 9, GROUND_VY + 1), z + 1, 0);
    }
  }
  // rambardes et globes verts à l'entrée
  const sideA = { x: xm - px * (half + 1) * VOXEL, z: zm - pz * (half + 1) * VOXEL };
  const sideB = { x: xm + px * (half + 1) * VOXEL, z: zm + pz * (half + 1) * VOXEL };
  ctx.prop('SUBWAY_GLOBE', sideA.x - dx * 0.4, 0.25, sideA.z - dz * 0.4, 0, 0);
  ctx.prop('SUBWAY_GLOBE', sideB.x - dx * 0.4, 0.25, sideB.z - dz * 0.4, 0, 0);
  ctx.light(xm + dx * 4, -3.5, zm + dz * 4, 0.7, 7, 0xe8f0ff);
}

// ======================================================================= limites de la ville

/**
 * Viaduc ferroviaire en briques sur la bande [zOut, zIn) (zOut côté extérieur de la ville) entre x0 et
 * x1 (voxels) ; au-dessus de l'eau, une arche d'acier (pont de Hell Gate).
 */
function viaduct(ctx: GenContext, x0: number, x1: number, zOut: number, zIn: number): void {
  const w = ctx.world;
  const s = Math.sign(zIn - zOut); // vers l'intérieur de la ville
  const n = Math.abs(zIn - zOut); // épaisseur (voxels)
  const zAt = (k: number) => zOut + s * k; // k-ième couche depuis l'extérieur
  const band = (x: number, k0: number, k1: number, y0: number, y1: number, m: number) => {
    const a = zAt(k0);
    const b = zAt(k1 - 1);
    w.fill(x, y0, Math.min(a, b), x + 1, y1, Math.max(a, b) + 1, m);
  };
  const deck = GROUND_VY + 32;
  for (let x = x0; x < x1; x++) {
    const xm = x * VOXEL;
    const overRiver = xm >= RIVER_X0 && xm < RIVER_X1;
    if (overRiver) {
      // arche d'acier au-dessus de l'eau (pont de Hell Gate)
      const t = (xm - RIVER_X0) / (RIVER_X1 - RIVER_X0);
      const archY = deck + Math.round(Math.sin(t * Math.PI) * 40);
      for (const k of [1, n - 2]) band(x, k, k + 1, archY, archY + 2, M.STEEL);
      if (x % 8 === 0) for (const k of [1, n - 2]) band(x, k, k + 1, deck, archY, M.STEEL);
      band(x, 0, n, deck - 2, deck, M.STEEL);
      continue;
    }
    // piles en brique et arches fermées par des grilles
    const inArch = x % 40 > 4;
    band(x, 0, 3, GROUND_VY, deck, M.BRICK_DARK);
    if (!inArch) band(x, 3, n, GROUND_VY, deck, M.BRICK_DARK);
    else {
      const ax = (x % 40) - 22.5;
      const archTop = GROUND_VY + 22 + Math.round(Math.sqrt(Math.max(0, 18 * 18 - ax * ax)) * 0.4);
      band(x, 3, n, archTop, deck, M.BRICK_DARK);
      // grille (barreaux) : infranchissable mais on voit à travers
      band(x, n - 1, n, GROUND_VY, archTop, x % 2 === 0 ? M.IRON : M.BARRIER);
    }
    band(x, 0, n, deck, deck + 1, M.GRAVEL);
    band(x, 0, 1, deck + 1, deck + 4, M.BRICK_DARK);
    band(x, n - 1, n, deck + 1, deck + 4, M.BRICK_DARK);
    if (x % 3 === 0) band(x, 2, n - 2, deck + 1, deck + 2, M.WALNUT);
  }
  for (const k of [8, 16]) {
    const z = zAt(k);
    w.fill(x0, deck + 2, z, x1, deck + 3, z + 1, M.STEEL);
  }
}

/** Viaducs ferroviaires au nord et au sud de Brooklyn, BQE à l'est, garde-corps sur l'Hudson et la baie. */
export function buildBoundaries(ctx: GenContext): void {
  const w = ctx.world;
  const sx = w.sx;
  const sz = w.sz;
  // --- viaduc nord (Metro-North, pont de Hell Gate) : z 0..6 m
  viaduct(ctx, 0, sx, 0, V(6));
  // --- viaduc de l'Atlantic Avenue au sud de Brooklyn : z D-6..D m
  viaduct(ctx, V(RIVER_X1), sx, sz - 1, sz - 1 - V(6));
  // --- BQE : voie rapide sur pilotis, de EAST_LIMIT au bord est (elle enjambe Newtown Creek)
  const bx0 = V(EAST_LIMIT);
  const bz0 = V(6);
  const bz1 = sz - V(6);
  const bdeck = GROUND_VY + 30;
  for (let z = bz0; z < bz1; z++) {
    const water = isWater(EAST_LIMIT + 4, (z + 0.5) * VOXEL);
    if (!water) {
      w.fill(bx0, GROUND_VY, z, bx0 + 2, GROUND_VY + 14, z + 1, M.CONCRETE);
      if (z % 2 === 0) w.fill(bx0, GROUND_VY + 14, z, bx0 + 1, GROUND_VY + 18, z + 1, M.IRON);
      if ((z - bz0) % 64 < 6) w.fill(bx0 + 2, GROUND_VY, z, sx, bdeck, z + 1, M.CONCRETE);
      w.fill(bx0 + 2, GROUND_VY, z, sx, GROUND_VY + 14, z + 1, M.CONCRETE_DARK);
    } else {
      // l'eau sous la voie rapide : la grille longe le quai
      w.fill(bx0, GROUND_VY + 22, z, sx, GROUND_VY + 24, z + 1, M.CONCRETE_DARK);
    }
  }
  w.fill(bx0, bdeck, bz0, sx, bdeck + 3, bz1, M.CONCRETE);
  w.fill(bx0, bdeck + 3, bz0, bx0 + 1, bdeck + 7, bz1, M.CONCRETE);
  w.fill(bx0 + 1, bdeck + 2, bz0, sx, bdeck + 3, bz1, M.ASPHALT);
  for (let z = bz0; z < bz1; z += 56) ctx.light(EAST_LIMIT + 1.5, (bdeck - GROUND_VY) * VOXEL + 6, z * VOXEL, 0.9, 12, 0xffc070);
  // --- Hudson (ouest) et baie (sud de Manhattan) : garde-corps au bord de l'eau
  w.fill(0, GROUND_VY + 1, V(6), 1, GROUND_VY + 6, sz, M.BARRIER);
  w.fill(0, GROUND_VY + 1, sz - 1, V(RIVER_X0), GROUND_VY + 6, sz, M.BARRIER);
  for (let zm = 8; zm < WORLD_D - 1; zm += 2) ctx.prop('RAILING', 0.15, 0.25, zm, Math.PI / 2, 0);
  for (let xm = 1; xm < RIVER_X0 - 4; xm += 2) ctx.prop('RAILING', xm + 1, 0.25, WORLD_D - 0.15, 0, 0);
  void WORLD_W;
}
