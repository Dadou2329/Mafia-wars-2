// Infrastructures de New York : ponts sur l'East River, métro (stations, tunnels, escaliers),
// viaduc ferroviaire au nord et voie rapide surélevée (BQE) à l'est.

import { M } from '../../materials';
import { GROUND_VY, INV_VOXEL, VOXEL } from '../../voxel';
import { BRIDGES, RIVER_X0, RIVER_X1, SUBWAY_LINES, SUBWAY_STATIONS, SUBWAY_TUNNELS, SUBWAY_Y, WORLD_D, WORLD_W } from '../plan';
import type { GenContext } from './context';

const V = (m: number): number => Math.round(m * INV_VOXEL);
/** Couche voxel (absolue) d'une altitude en mètres. */
const Y = (m: number): number => Math.round(m * INV_VOXEL) + GROUND_VY;

// ======================================================================= ponts

export function buildBridges(ctx: GenContext): void {
  const w = ctx.world;
  for (const br of BRIDGES) {
    const [bx0, bz0, bx1, bz1] = br.rect;
    const x0 = V(bx0);
    const x1 = V(bx1);
    const z0 = V(bz0);
    const z1 = V(bz1);
    const rx0 = V(RIVER_X0);
    const rx1 = V(RIVER_X1);
    // tablier : poutres sous la chaussée, trottoirs surélevés, garde-corps
    for (let x = rx0 - 2; x < rx1 + 2; x++) {
      w.fill(x, GROUND_VY - 6, z0, x + 1, GROUND_VY - 1, z1, br.key === 'brooklyn' ? M.GRANITE : M.STEEL_GREEN);
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
    for (const px of [rx0 + 24, rx1 - 26]) w.fill(px, 0, z0 + 2, px + 4, GROUND_VY - 6, z1 - 2, M.GRANITE);
    if (br.key === 'brooklyn') brooklynTowers(ctx, rx0, rx1, z0, z1);
    else queensboroTruss(ctx, rx0, rx1, z0, z1);
    // lampadaires sur le pont
    for (let xm = RIVER_X0 + 3; xm < RIVER_X1 - 2; xm += 7) {
      ctx.prop('PARK_LAMP', xm, 0.25, bz0 + 0.6, 0);
      ctx.prop('PARK_LAMP', xm + 3.5, 0.25, bz1 - 0.6, Math.PI);
    }
    void x0;
    void x1;
  }
}

/** Tours gothiques en granit et câbles du pont de Brooklyn. */
function brooklynTowers(ctx: GenContext, rx0: number, rx1: number, z0: number, z1: number): void {
  const w = ctx.world;
  const top = GROUND_VY + 120;
  const towers = [rx0 + 18, rx1 - 22];
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
  // câbles principaux et suspentes
  const cableTop = top - 2;
  const spans: [number, number][] = [
    [rx0 - 30, towers[0]],
    [towers[0] + 6, towers[1]],
    [towers[1] + 6, rx1 + 30],
  ];
  for (const [a, b] of spans) {
    for (let x = a; x < b; x++) {
      const t = (x - a) / (b - a);
      const sag = 4 * t * (1 - t);
      const y = Math.round(cableTop - sag * (cableTop - GROUND_VY - 8) - (a < towers[0] ? (1 - t) * 0 : 0));
      const yy = a < towers[0] ? Math.round(GROUND_VY + 4 + t * (cableTop - GROUND_VY - 4)) : a > towers[1] ? Math.round(cableTop - t * (cableTop - GROUND_VY - 4)) : y;
      for (const cz of [z0 + 1, z1 - 2]) {
        w.set(x, yy, cz, M.STEEL);
        if (x % 6 === 0) w.fill(x, GROUND_VY + 4, cz, x + 1, yy, cz + 1, M.STEEL);
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

// ======================================================================= métro

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
      for (let s = 4; s < len; s += 9) {
        const px = ax + ((bx - ax) * s) / len;
        const pz = az + ((bz - az) * s) / len;
        ctx.light(px, SUBWAY_Y + 3, pz, 0.55, 6, s % 18 < 9 ? 0xdfe8ff : color);
        const vx = V(px);
        const vz = V(pz);
        if (alongX) w.fill(vx, ceil - 1, z0, vx + 2, ceil, z0 + 1, M.LED_WHITE);
        else w.fill(x0, ceil - 1, vz, x0 + 1, ceil, vz + 2, M.LED_WHITE);
      }
    }
  }
  // stations
  for (const st of SUBWAY_STATIONS) {
    const [sx0, sz0, sx1, sz1] = st.rect.map(V);
    w.fill(sx0 - 2, floor - 2, sz0 - 2, sx1 + 2, stCeil + 2, sz1 + 2, M.CONCRETE_DARK);
    w.fill(sx0, floor, sz0, sx1, stCeil, sz1, 0);
    // murs carrelés de blanc (carreaux de métro), bandeau de couleur de la ligne
    const line = SUBWAY_LINES.find((l) => l.id === st.lines[0])!;
    const band = line.id === '7' ? M.NEON_PURPLE : M.STEEL;
    for (let y = floor; y < stCeil; y++) {
      const m = y === floor + 9 ? M.TILE_GREEN : y === floor + 10 ? band : M.TILE_WHITE;
      w.fill(sx0, y, sz0, sx1, y + 1, sz0 + 1, m);
      w.fill(sx0, y, sz1 - 1, sx1, y + 1, sz1, m);
      w.fill(sx0, y, sz0, sx0 + 1, y + 1, sz1, m);
      w.fill(sx1 - 1, y, sz0, sx1, y + 1, sz1, m);
    }
    w.fill(sx0, stCeil - 1, sz0, sx1, stCeil, sz1, M.CEILING_PANEL);
    if (st.key === 'times_square') {
      // hall ouest (escaliers) + quai central entre les deux voies
      w.fill(sx0 + 1, floor - 1, sz0 + 1, sx1 - 1, floor + 2, sz1 - 1, M.TERRAZZO);
      const trackX0 = V(86);
      for (const [tz0, tz1] of [
        [V(108), V(112)],
        [V(128), V(132)],
      ]) {
        w.fill(trackX0, floor - 1, tz0, sx1, floor + 2, tz1, 0);
        w.fill(trackX0, floor - 1, tz0, sx1, floor, tz1, M.GRAVEL);
        w.fill(trackX0, floor, tz0 + 4, sx1, floor + 1, tz0 + 5, M.STEEL);
        w.fill(trackX0, floor, tz1 - 5, sx1, floor + 1, tz1 - 4, M.STEEL);
        // bord de quai jaune
        const edge = tz0 === V(108) ? tz1 : tz0 - 1;
        w.fill(trackX0, floor + 1, edge, sx1, floor + 2, edge + 1, M.LINE_YELLOW);
      }
      // piliers
      for (let x = V(90); x < sx1 - 4; x += 24) for (const z of [V(115), V(124)]) w.fill(x, floor + 2, z, x + 3, stCeil, z + 3, M.TILE_GREEN);
      // nom de la station en carreaux (le texte est sur les panneaux du client)
      w.fill(V(96), floor + 8, sz0 + 1, V(108), floor + 11, sz0 + 2, M.PAINT_BLACK);
      w.fill(V(96), floor + 8, sz1 - 2, V(108), floor + 11, sz1 - 1, M.PAINT_BLACK);
    } else {
      // voie centrale nord-sud et quais latéraux surélevés
      w.fill(sx0 + 1, floor - 1, sz0 + 1, sx1 - 1, floor + 2, sz1 - 1, M.TERRAZZO);
      const tx0 = V(229);
      const tx1 = V(233);
      w.fill(tx0, floor - 1, sz0, tx1, floor + 2, sz1, 0);
      w.fill(tx0, floor - 1, sz0, tx1, floor, sz1, M.GRAVEL);
      w.fill(tx0 + 4, floor, sz0, tx0 + 5, floor + 1, sz1, M.STEEL);
      w.fill(tx1 - 5, floor, sz0, tx1 - 4, floor + 1, sz1, M.STEEL);
      w.fill(tx0 - 1, floor + 1, sz0, tx0, floor + 2, sz1, M.LINE_YELLOW);
      w.fill(tx1, floor + 1, sz0, tx1 + 1, floor + 2, sz1, M.LINE_YELLOW);
    }
    // éclairage et bancs
    const cx = (st.rect[0] + st.rect[2]) / 2;
    const cz = (st.rect[1] + st.rect[3]) / 2;
    for (let x = st.rect[0] + 3; x < st.rect[2] - 2; x += 8)
      for (let z = st.rect[1] + 3; z < st.rect[3] - 2; z += 8) ctx.light(x, SUBWAY_Y + 3.6, z, 0.75, 8, 0xe8f0ff);
    const py = SUBWAY_Y + 0.5;
    if (st.key === 'times_square') {
      for (let x = 90; x < 116; x += 8) ctx.prop('BENCH', x, py, 120, 0);
      ctx.prop('VENDING_MACHINE', 79.2, py, 120, Math.PI / 2, 1);
      ctx.prop('HOLO_KIOSK', 84, py, 120, -Math.PI / 2, 0);
    } else {
      ctx.prop('BENCH', 234.5, py, cz, -Math.PI / 2, 0);
      ctx.prop('VENDING_MACHINE', 235.4, py, cz + 6, -Math.PI / 2, 2);
    }
    void cx;
    // escaliers d'accès
    for (const e of st.entrances) stairsDown(ctx, e.x, e.z, e.dir, floor + 2);
  }
  // rames : portails de navigation entre stations (les PNJ « prennent le métro »)
  const ts = SUBWAY_STATIONS[0];
  const tsPt = { x: 82, z: 120, y: SUBWAY_Y + 0.5 };
  for (const st of SUBWAY_STATIONS.slice(1)) {
    const p = { x: 234.5, z: (st.rect[1] + st.rect[3]) / 2, y: SUBWAY_Y + 0.5 };
    ctx.portals.push({ kind: 'train', ax: tsPt.x, ay: tsPt.y, az: tsPt.z, bx: p.x, by: p.y, bz: p.z, cost: 140 });
  }
  void ts;
}

/** Escalier de bouche de métro : départ au niveau de la rue en (x, z), descente dans la direction donnée. */
function stairsDown(ctx: GenContext, xm: number, zm: number, dir: 'N' | 'S' | 'E' | 'W', bottomVy: number): void {
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

/** Viaduc ferroviaire (Metro-North / pont de Hell Gate) au nord, voie rapide BQE à l'est. */
export function buildBoundaries(ctx: GenContext): void {
  const w = ctx.world;
  const sx = w.sx;
  const sz = w.sz;
  // --- viaduc nord : z 0..6 m
  const vz1 = V(6);
  const deck = GROUND_VY + 32;
  for (let x = 0; x < sx; x++) {
    const xm = x * VOXEL;
    const overRiver = xm >= RIVER_X0 && xm < RIVER_X1;
    if (overRiver) {
      // arche d'acier au-dessus de l'eau (pont de Hell Gate)
      const t = (xm - RIVER_X0) / (RIVER_X1 - RIVER_X0);
      const archY = deck + Math.round(Math.sin(t * Math.PI) * 40);
      for (const z of [1, vz1 - 2]) w.fill(x, archY, z, x + 1, archY + 2, z + 1, M.STEEL);
      if (x % 8 === 0) for (const z of [1, vz1 - 2]) w.fill(x, deck, z, x + 1, archY, z + 1, M.STEEL);
      w.fill(x, deck - 2, 0, x + 1, deck, vz1, M.STEEL);
      continue;
    }
    // piles en brique et arches fermées par des grilles
    const inArch = x % 40 > 4;
    w.fill(x, GROUND_VY, 0, x + 1, deck, 3, M.BRICK_DARK);
    if (!inArch) w.fill(x, GROUND_VY, 3, x + 1, deck, vz1, M.BRICK_DARK);
    else {
      const ax = (x % 40) - 22.5;
      const archTop = GROUND_VY + 22 + Math.round(Math.sqrt(Math.max(0, 18 * 18 - ax * ax)) * 0.4);
      w.fill(x, archTop, 3, x + 1, deck, vz1, M.BRICK_DARK);
      // grille (barreaux) : infranchissable mais on voit à travers
      w.fill(x, GROUND_VY, vz1 - 1, x + 1, archTop, vz1, x % 2 === 0 ? M.IRON : M.BARRIER);
    }
    w.fill(x, deck, 0, x + 1, deck + 1, vz1, M.GRAVEL);
    w.fill(x, deck + 1, 0, x + 1, deck + 4, 1, M.BRICK_DARK);
    w.fill(x, deck + 1, vz1 - 1, x + 1, deck + 4, vz1, M.BRICK_DARK);
    if (x % 3 === 0) w.fill(x, deck + 1, 2, x + 1, deck + 2, vz1 - 2, M.WALNUT);
  }
  for (const rz of [V(2), V(4)]) w.fill(0, deck + 2, rz, sx, deck + 3, rz + 1, M.STEEL);
  // --- BQE : voie rapide sur pilotis, x 284..288
  const bx0 = V(284);
  const bdeck = GROUND_VY + 30;
  w.fill(bx0, GROUND_VY, V(6), bx0 + 2, GROUND_VY + 14, sz, M.CONCRETE);
  for (let z = V(6); z < sz; z++) {
    if (z % 2 === 0) w.fill(bx0, GROUND_VY + 14, z, bx0 + 1, GROUND_VY + 18, z + 1, M.IRON);
    if ((z - V(6)) % 64 < 6) w.fill(bx0 + 2, GROUND_VY, z, sx, bdeck, z + 1, M.CONCRETE);
  }
  w.fill(bx0 + 2, GROUND_VY, V(6), sx, GROUND_VY + 14, sz, M.CONCRETE_DARK);
  w.fill(bx0, bdeck, V(6), sx, bdeck + 3, sz, M.CONCRETE);
  w.fill(bx0, bdeck + 3, V(6), bx0 + 1, bdeck + 7, sz, M.CONCRETE);
  w.fill(bx0 + 1, bdeck + 2, V(6), sx, bdeck + 3, sz, M.ASPHALT);
  for (let z = V(6); z < sz; z += 56) ctx.light(285.5, (bdeck - GROUND_VY) * VOXEL + 6, z * VOXEL, 0.9, 12, 0xffc070);
  // --- Hudson (ouest) et baie (sud) : garde-corps au bord de l'eau
  w.fill(0, GROUND_VY + 1, V(6), 1, GROUND_VY + 6, sz, M.BARRIER);
  w.fill(0, GROUND_VY + 1, sz - 1, sx, GROUND_VY + 6, sz, M.BARRIER);
  for (let zm = 8; zm < WORLD_D - 1; zm += 2) ctx.prop('RAILING', 0.15, 0.25, zm, Math.PI / 2, 0);
  for (let xm = 1; xm < WORLD_W - 4; xm += 2) {
    if (xm >= RIVER_X0 - 1 && xm < RIVER_X1 + 1) continue;
    ctx.prop('RAILING', xm + 1, 0.25, WORLD_D - 0.15, 0, 0);
  }
}
