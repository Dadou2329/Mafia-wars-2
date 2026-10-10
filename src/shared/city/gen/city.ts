// Génération complète de New York 2085 (identique sur le client et le serveur).

import { M } from '../../materials';
import { Rng, hash32 } from '../../util';
import { GROUND_VY, INV_VOXEL, VOXEL, VoxelWorld } from '../../voxel';
import {
  AREAS,
  BUILDINGS,
  CREEK,
  FILLERS,
  RIVERBED_Y,
  RIVER_X0,
  RIVER_X1,
  ROADS,
  WORLD_D,
  WORLD_H,
  WORLD_W,
  districtAt,
  isWater,
  type AreaDef,
  type FillerDef,
} from '../plan';
import { GenContext, type BuildingInfo } from './context';
import { generateBuilding } from './buildings';
import { buildBoundaries, buildBridges, buildSubway } from './infra';
import { Frame } from './frame';
import { FACADE_DEFAULT, cladFace, curtainBlock, hollowBlock, ledRing, piers, windowRow, type Facade, type Wall } from './facade';
import { cornice, parapet, waterTower } from './structure';

export const CITY_SEED = 20852085;

export interface City {
  world: VoxelWorld;
  ctx: GenContext;
  buildings: BuildingInfo[];
  /** Carte 2D (voxels) : voir GM. */
  groundMap: Uint8Array;
  gw: number;
  gd: number;
}

export const GM = { ROAD: 0, SIDEWALK: 1, CURB: 2, BUILDING: 3, AREA: 4, WATER: 5, BRIDGE: 6, BOUNDARY: 7, PLAZA: 8, PARK: 9 } as const;

const V = (m: number): number => Math.round(m * INV_VOXEL);

export function generateCity(seed = CITY_SEED): City {
  const sx = WORLD_W * INV_VOXEL;
  const sz = WORLD_D * INV_VOXEL;
  const sy = WORLD_H * INV_VOXEL;
  const world = new VoxelWorld(sx, sy, sz);
  const ctx = new GenContext(world, seed);
  const rng = new Rng(seed);
  for (const b of BUILDINGS) ctx.footprints.push(b.rect);
  for (const f of FILLERS) ctx.footprints.push(f.rect);
  ctx.footprints.push(ONE_TIMES_SQUARE);

  // ------------------------------------------------------------------ sous-sol
  world.fill(0, 0, 0, sx, GROUND_VY - 1, sz, M.BEDROCK);
  world.fill(0, GROUND_VY - 1, 0, sx, GROUND_VY, sz, M.ASPHALT);

  // ------------------------------------------------------------------ carte au sol 2D
  const gm = new Uint8Array(sx * sz).fill(GM.SIDEWALK);
  const idx = (x: number, z: number) => z * sx + x;
  const markRect = (r: readonly number[], v: number, onlyIf?: number) => {
    const x0 = Math.max(0, V(r[0]));
    const z0 = Math.max(0, V(r[1]));
    const x1 = Math.min(sx, V(r[2]));
    const z1 = Math.min(sz, V(r[3]));
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (onlyIf === undefined || gm[idx(x, z)] === onlyIf) gm[idx(x, z)] = v;
  };
  for (const r of ROADS) markRect(r.rect, GM.ROAD);
  for (const a of AREAS) {
    if (a.kind === 'park' || a.kind === 'lake') markRect(a.rect, GM.PARK);
    else if (a.kind === 'plaza' || a.kind === 'square') markRect(a.rect, GM.PLAZA, GM.SIDEWALK);
  }
  for (const b of BUILDINGS) markRect(b.rect, GM.BUILDING);
  for (const f of FILLERS) markRect(f.rect, GM.BUILDING);
  markRect(ONE_TIMES_SQUARE, GM.BUILDING);
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const xm = (x + 0.5) * VOXEL;
      const zm = (z + 0.5) * VOXEL;
      if (isWater(xm, zm)) gm[idx(x, z)] = GM.WATER;
    }
  // limites : viaduc nord, BQE à l'est
  markRect([0, 0, WORLD_W, 6], GM.BOUNDARY);
  markRect([284, 6, WORLD_W, WORLD_D], GM.BOUNDARY);
  // ponts
  for (const r of ROADS) if (r.name.startsWith('Pont')) markRect(r.rect, GM.BRIDGE, GM.WATER);
  // bordures : trottoir au contact de la chaussée
  for (let z = 1; z < sz - 1; z++)
    for (let x = 1; x < sx - 1; x++) {
      const g = gm[idx(x, z)];
      if (g !== GM.SIDEWALK && g !== GM.PLAZA) continue;
      if (gm[idx(x + 1, z)] === GM.ROAD || gm[idx(x - 1, z)] === GM.ROAD || gm[idx(x, z + 1)] === GM.ROAD || gm[idx(x, z - 1)] === GM.ROAD) gm[idx(x, z)] = GM.CURB;
    }
  // écriture des voxels du sol
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const g = gm[idx(x, z)];
      if (g === GM.SIDEWALK || g === GM.BOUNDARY) world.set(x, GROUND_VY, z, ((x >> 6) + (z >> 6)) % 7 === 0 ? M.SIDEWALK_DARK : M.SIDEWALK);
      else if (g === GM.CURB) world.set(x, GROUND_VY, z, M.CURB);
      else if (g === GM.PLAZA) world.set(x, GROUND_VY, z, M.SIDEWALK_DARK);
      else if (g === GM.BUILDING) world.set(x, GROUND_VY, z, M.SIDEWALK);
      else if (g === GM.ROAD && ((x * 7 + z * 13) & 255) < 3) world.set(x, GROUND_VY - 1, z, M.ASPHALT_WORN);
    }
  roadMarkings(world, gm, sx, sz);

  // ------------------------------------------------------------------ eau : East River et Newtown Creek
  const bedVy = Math.round(RIVERBED_Y * INV_VOXEL) + GROUND_VY;
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      if (gm[idx(x, z)] !== GM.WATER) continue;
      world.fill(x, bedVy, z, x + 1, GROUND_VY + 1, z + 1, 0);
      world.set(x, bedVy - 1, z, M.RIVERBED);
    }
  // quais : murs de granit le long de l'eau, garde-corps
  quayWalls(ctx, gm, sx, sz, bedVy);

  // ------------------------------------------------------------------ infrastructures
  buildBridges(ctx);
  buildSubway(ctx);
  buildBoundaries(ctx);

  // ------------------------------------------------------------------ espaces publics
  for (const a of AREAS) buildArea(ctx, a, rng.fork(hash32(a.rect[0] * 31 + a.rect[1])));
  oneTimesSquare(ctx);

  // ------------------------------------------------------------------ bâtiments
  for (const def of BUILDINGS) generateBuilding(ctx, def);
  for (const f of FILLERS) buildFiller(ctx, f, rng.fork(hash32(f.rect[0] * 131 + f.rect[1])));

  // ------------------------------------------------------------------ mobilier urbain
  streetFurniture(ctx, gm, sx, sz, rng);
  holograms(ctx);

  world.compact();
  return { world, ctx, buildings: ctx.buildings, groundMap: gm, gw: sx, gd: sz };
}

// ======================================================================================
// Marquages routiers

function roadMarkings(world: VoxelWorld, gm: Uint8Array, sx: number, sz: number): void {
  const inCross = (x: number, z: number, axis: 'x' | 'z') => {
    // vrai si la cellule est dans une chaussée d'axe opposé (carrefour)
    for (const r of ROADS) {
      if (r.axis === axis) continue;
      if (x >= V(r.rect[0]) && x < V(r.rect[2]) && z >= V(r.rect[1]) && z < V(r.rect[3])) return true;
    }
    return false;
  };
  const y = GROUND_VY - 1;
  for (const r of ROADS) {
    const [x0, z0, x1, z1] = [V(r.rect[0]), V(r.rect[1]), V(r.rect[2]), V(r.rect[3])];
    const bridge = r.name.startsWith('Pont');
    if (r.axis === 'z') {
      const mid = Math.round((x0 + x1) / 2);
      for (let z = z0; z < z1; z++) {
        if (inCross(mid, z, 'z')) continue;
        if (gm[z * sx + mid] !== 0 && !bridge) continue;
        // double ligne jaune centrale, lignes de rive blanches
        world.set(mid - 2, y, z, M.LINE_YELLOW);
        world.set(mid + 1, y, z, M.LINE_YELLOW);
        world.set(x0 + 1, y, z, M.LINE_WHITE);
        world.set(x1 - 2, y, z, M.LINE_WHITE);
      }
      // passages piétons de part et d'autre des carrefours
      for (let z = z0; z < z1; z++) {
        if (!inCross(mid, z, 'z')) continue;
        const before = !inCross(mid, z - 1, 'z');
        const after = !inCross(mid, z + 1, 'z');
        if (before) zebra(world, x0, z - 14, x1, z - 2, 'x');
        if (after) zebra(world, x0, z + 2, x1, z + 14, 'x');
      }
    } else {
      const mid = Math.round((z0 + z1) / 2);
      for (let x = x0; x < x1; x++) {
        if (inCross(x, mid, 'x')) continue;
        if (gm[mid * sx + x] !== 0 && !bridge) continue;
        world.set(x, y, mid - 2, M.LINE_YELLOW);
        world.set(x, y, mid + 1, M.LINE_YELLOW);
        world.set(x, y, z0 + 1, M.LINE_WHITE);
        world.set(x, y, z1 - 2, M.LINE_WHITE);
      }
      for (let x = x0; x < x1; x++) {
        if (!inCross(x, mid, 'x')) continue;
        if (!inCross(x - 1, mid, 'x')) zebra(world, x - 14, z0, x - 2, z1, 'z');
        if (!inCross(x + 1, mid, 'x')) zebra(world, x + 2, z0, x + 14, z1, 'z');
      }
    }
  }
  void sz;
}

/** Bandes de passage piéton (les bandes sont parallèles à la circulation). */
function zebra(world: VoxelWorld, x0: number, z0: number, x1: number, z1: number, stripesAlong: 'x' | 'z'): void {
  const y = GROUND_VY - 1;
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      if (world.get(x, y, z) !== M.ASPHALT && world.get(x, y, z) !== M.ASPHALT_WORN) continue;
      if (world.get(x, GROUND_VY, z) !== 0) continue;
      const k = stripesAlong === 'x' ? x : z;
      if (((k % 6) + 6) % 6 < 3) world.set(x, y, z, M.LINE_WHITE);
    }
}

// ======================================================================================
// Quais

function quayWalls(ctx: GenContext, gm: Uint8Array, sx: number, sz: number, bedVy: number): void {
  const w = ctx.world;
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= sx || z >= sz ? GM.BOUNDARY : gm[z * sx + x]);
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const g = at(x, z);
      if (g === GM.WATER || g === GM.BRIDGE) continue;
      const nearWater = at(x + 1, z) === GM.WATER || at(x - 1, z) === GM.WATER || at(x, z + 1) === GM.WATER || at(x, z - 1) === GM.WATER;
      if (!nearWater) continue;
      // mur de quai (granit) du lit jusqu'au niveau de la rue, garde-corps au-dessus
      w.fill(x, bedVy - 1, z, x + 1, GROUND_VY + 1, z + 1, M.QUAY);
      w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 6, z + 1, M.BARRIER);
      if ((x + z) % 8 === 0) w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 5, z + 1, M.IRON);
      w.fill(x, GROUND_VY + 4, z, x + 1, GROUND_VY + 5, z + 1, M.IRON);
    }
}

// ======================================================================================
// Parcs, places, promenades

const ONE_TIMES_SQUARE: [number, number, number, number] = [100, 126, 108, 136];

function buildArea(ctx: GenContext, a: AreaDef, rng: Rng): void {
  const w = ctx.world;
  const [x0m, z0m, x1m, z1m] = a.rect;
  const x0 = V(x0m);
  const z0 = V(z0m);
  const x1 = V(x1m);
  const z1 = V(z1m);
  const cxm = (x0m + x1m) / 2;
  const czm = (z0m + z1m) / 2;
  switch (a.kind) {
    case 'park': {
      // pelouse, allées sinueuses, muret de pierre, arbres, rochers de schiste, lampadaires
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) {
          const xm = x * VOXEL;
          const zm = z * VOXEL;
          const edge = x < x0 + 2 || x >= x1 - 2 || z < z0 + 2 || z >= z1 - 2;
          const path =
            Math.abs(zm - (czm + Math.sin(xm * 0.09) * 6)) < 1.6 ||
            Math.abs(xm - (110 + Math.sin(zm * 0.2) * 3)) < 1.4 ||
            Math.abs(xm - (176 + Math.sin(zm * 0.25) * 2)) < 1.4;
          if (edge) w.fill(x, GROUND_VY, z, x + 1, GROUND_VY + 3, z + 1, M.LIMESTONE);
          else w.set(x, GROUND_VY, z, path ? M.GRAVEL : M.GRASS);
        }
      // entrées dans le muret
      for (const ex of [104, 140, 178]) {
        w.fill(V(ex) - 8, GROUND_VY + 1, z1 - 2, V(ex) + 8, GROUND_VY + 3, z1, 0);
        w.fill(V(ex) - 8, GROUND_VY + 1, z0, V(ex) + 8, GROUND_VY + 3, z0 + 2, 0);
      }
      w.fill(x0, GROUND_VY + 1, V(30) - 8, x0 + 2, GROUND_VY + 3, V(30) + 8, 0);
      w.fill(x1 - 2, GROUND_VY + 1, V(30) - 8, x1, GROUND_VY + 3, V(30) + 8, 0);
      // arbres
      for (let i = 0; i < 46; i++) {
        const tx = rng.range(x0m + 3, x1m - 3);
        const tz = rng.range(z0m + 3, z1m - 3);
        if (inRect(tx, tz, [124, 20, 156, 42], 1.5) || inRect(tx, tz, [102, 20, 122, 36], 2) || inRect(tx, tz, [158, 20, 178, 34], 2)) continue;
        if (Math.abs(tz - (czm + Math.sin(tx * 0.09) * 6)) < 2.6) continue;
        tree(w, tx * INV_VOXEL, GROUND_VY + 1, tz * INV_VOXEL, rng, rng.range(0.9, 1.35), rng.chance(0.12));
      }
      // rochers de schiste
      for (let i = 0; i < 7; i++) {
        const rx = rng.range(x0m + 5, x1m - 5);
        const rz = rng.range(z0m + 5, z1m - 5);
        if (inRect(rx, rz, [122, 18, 158, 44], 1) || inRect(rx, rz, [100, 18, 124, 38], 1)) continue;
        rock(w, V(rx), V(rz), rng);
      }
      for (let xm = x0m + 6; xm < x1m - 4; xm += 12) {
        ctx.prop('PARK_LAMP', xm, 0.25, czm + Math.sin(xm * 0.09) * 6 + 2.2, 0, 0);
        if (rng.chance(0.6)) ctx.prop('BENCH', xm + 4, 0.25, czm + Math.sin((xm + 4) * 0.09) * 6 + 2.4, Math.PI, 0);
      }
      // fontaine de Bethesda : bassin et ange
      fountain(ctx, 116, 41);
      break;
    }
    case 'lake': {
      // le lac : creusé sous la pelouse, bords de pierre, pont de fonte (Bow Bridge)
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) {
          const dx = (x + 0.5 - (x0 + x1) / 2) / ((x1 - x0) / 2);
          const dz = (z + 0.5 - (z0 + z1) / 2) / ((z1 - z0) / 2);
          const n = Math.sin(x * 0.11) * 0.08 + Math.sin(z * 0.13) * 0.07;
          const d = dx * dx + dz * dz + n;
          if (d > 1.0) continue;
          if (d > 0.86) {
            w.fill(x, GROUND_VY - 2, z, x + 1, GROUND_VY + 1, z + 1, M.ROCK);
            continue;
          }
          w.fill(x, GROUND_VY - 6, z, x + 1, GROUND_VY + 1, z + 1, 0);
          w.set(x, GROUND_VY - 7, z, M.RIVERBED);
        }
      // Bow Bridge : arche de fonte blanche
      const bz = V(czm);
      for (let x = x0 + 6; x < x1 - 6; x++) {
        const t = (x - x0 - 6) / (x1 - x0 - 12);
        const y = GROUND_VY + 1 + Math.round(Math.sin(t * Math.PI) * 4);
        w.fill(x, y - 1, bz - 6, x + 1, y, bz + 6, M.PAINT_CREAM);
        w.fill(x, y, bz - 6, x + 1, y + 4, bz - 5, (x % 3 === 0 ? M.PAINT_CREAM : M.BARRIER));
        w.fill(x, y, bz + 5, x + 1, y + 4, bz + 6, (x % 3 === 0 ? M.PAINT_CREAM : M.BARRIER));
        w.fill(x, y + 3, bz - 6, x + 1, y + 4, bz - 5, M.PAINT_CREAM);
        w.fill(x, y + 3, bz + 5, x + 1, y + 4, bz + 6, M.PAINT_CREAM);
      }
      ctx.prop('BOAT', cxm - 5, -0.9, czm - 4, 0.6, 0, -1);
      ctx.prop('BOAT', cxm + 6, -0.9, czm + 5, 2.1, 1, -1);
      break;
    }
    case 'plaza': {
      // Times Square : dalles rouges et lumineuses, gradins rouges, écrans, chaussée de Broadway
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) {
          if (w.get(x, GROUND_VY, z) === 0) continue; // chaussée
          const xm = x * VOXEL;
          const zm = z * VOXEL;
          const led = ((Math.floor(xm / 3) + Math.floor(zm / 3)) & 3) === 0;
          w.set(x, GROUND_VY, z, led ? M.PAVER_LED : M.PLAZA_RED);
        }
      // les marches rouges (TKTS) face au sud
      const sx0 = V(102);
      const sx1 = V(118);
      const sz0 = V(103);
      for (let k = 0; k < 8; k++) {
        w.fill(sx0, GROUND_VY + 1, sz0 + k * 3, sx1, GROUND_VY + 1 + (8 - k) * 2, sz0 + k * 3 + 3, k % 2 === 0 ? M.LED_RED : M.STUCCO_RED);
      }
      ctx.light(110, 2, 108, 0.9, 9, 0xff3040);
      // bornes et mobilier
      for (let xm = x0m + 4; xm < x1m - 2; xm += 8) {
        if (xm > 86 && xm < 98) continue;
        ctx.prop('STREET_LIGHT_DOUBLE', xm, 0.25, czm - 14, 0, 0);
        ctx.prop('STREET_LIGHT_DOUBLE', xm + 4, 0.25, czm + 14, 0, 0);
      }
      ctx.prop('HOLO_KIOSK', 78, 0.25, 116, Math.PI / 2, 0);
      ctx.prop('FOOD_CART', 112, 0.25, 132, 0, 0);
      ctx.prop('FOOD_CART', 80, 0.25, 128, Math.PI, 1);
      ctx.prop('NEWS_STAND', 118, 0.25, 116, -Math.PI / 2, 0);
      ctx.prop('VENDING_MACHINE', 75, 0.25, 132, Math.PI / 2, 4);
      for (const [x, z] of [
        [86, 101],
        [98, 101],
        [86, 139],
        [98, 139],
      ])
        ctx.prop('BOLLARD', x, 0.25, z, 0, 0);
      break;
    }
    case 'square': {
      // place du Taureau : le taureau de bronze, arbres, bancs
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) w.set(x, GROUND_VY, z, ((x + z) & 15) < 8 ? M.GRANITE : M.SIDEWALK);
      ctx.prop('BULL_STATUE', cxm, 0.25, czm, Math.PI * 0.75, 0);
      for (const [dx, dz] of [
        [-7, -8],
        [7, -8],
        [-7, 8],
        [7, 8],
      ])
        tree(w, V(cxm + dx), GROUND_VY + 1, V(czm + dz), rng, 0.8, false);
      ctx.prop('BENCH', cxm - 7, 0.25, czm, Math.PI / 2, 0);
      ctx.prop('BENCH', cxm + 7, 0.25, czm, -Math.PI / 2, 0);
      ctx.prop('PARK_LAMP', cxm - 4, 0.25, czm - 10, 0, 0);
      ctx.prop('PARK_LAMP', cxm + 4, 0.25, czm + 10, 0, 0);
      break;
    }
    case 'promenade': {
      // promenades le long de l'eau : arbres et bancs
      const alongX = x1m - x0m > z1m - z0m;
      const len = alongX ? x1m - x0m : z1m - z0m;
      for (let s = 6; s < len - 4; s += 11) {
        const px = alongX ? x0m + s : (x0m + x1m) / 2;
        const pz = alongX ? (z0m + z1m) / 2 : z0m + s;
        if (isWater(px, pz) || ctx.inFootprint(px, pz, 1)) continue;
        if (alongX && px > RIVER_X0 - 2 && px < RIVER_X1 + 2) continue;
        if (rng.chance(0.55)) ctx.prop('BENCH', px, 0.25, pz, alongX ? 0 : Math.PI / 2, 0);
        else ctx.prop('PARK_LAMP', px, 0.25, pz, 0, 0);
      }
      break;
    }
    case 'yard':
      break;
  }
}

function inRect(x: number, z: number, r: readonly number[], m = 0): boolean {
  return x >= r[0] - m && x < r[2] + m && z >= r[1] - m && z < r[3] + m;
}

/** One Times Square : la tour d'écrans et la boule du Nouvel An. */
function oneTimesSquare(ctx: GenContext): void {
  const f = new Frame(ctx, ONE_TIMES_SQUARE, 'N', -1);
  const top = 150;
  f.fill(0, 0, 0, f.W, top, f.D, M.METAL_PANEL_DARK);
  // écrans sur les quatre faces, empilés
  const faces: Wall[] = ['front', 'back', 'left', 'right'];
  for (const wl of faces) {
    cladFace(f, wl, 8, 40, M.SCREEN_ADS);
    cladFace(f, wl, 42, 74, M.SCREEN);
    cladFace(f, wl, 76, 100, M.SCREEN_ADS);
    cladFace(f, wl, 102, 108, M.SCREEN_TICKER);
    cladFace(f, wl, 110, 140, M.SCREEN);
  }
  ledRing(f, 0, 0, f.W, f.D, 41, M.LED_WHITE);
  ledRing(f, 0, 0, f.W, f.D, 101, M.LED_WHITE);
  f.fill(Math.round(f.W / 2) - 1, top, Math.round(f.D / 2) - 1, Math.round(f.W / 2) + 1, top + 18, Math.round(f.D / 2) + 1, M.STEEL);
  const c = f.pt(f.W / 2, f.D / 2);
  ctx.prop('BALL_TOWER', c.x, top * VOXEL + 2.5, c.z, 0, 0);
  const faceYaw: Record<Wall, number> = { front: f.yaw(Math.PI), back: f.yaw(0), left: f.yaw(-Math.PI / 2), right: f.yaw(Math.PI / 2) };
  for (const wl of faces) {
    const len = wl === 'front' || wl === 'back' ? f.W : f.D;
    const off = wl === 'front' ? f.pt(f.W / 2, -0.08) : wl === 'back' ? f.pt(f.W / 2, f.D + 0.08) : wl === 'left' ? f.pt(-0.08, f.D / 2) : f.pt(f.W + 0.08, f.D / 2);
    ctx.screens.push({ x: off.x, y: 15, z: off.z, yaw: faceYaw[wl], w: len * VOXEL - 0.2, h: 7.6, kind: wl === 'front' || wl === 'back' ? 'boss' : 'ad', district: 'midtown', seed: ctx.screens.length * 17 + 5 });
  }
}

/** Fontaine de Bethesda (bassin circulaire et ange). */
function fountain(ctx: GenContext, xm: number, zm: number): void {
  const w = ctx.world;
  const cx = V(xm);
  const cz = V(zm);
  for (let x = cx - 14; x < cx + 14; x++)
    for (let z = cz - 14; z < cz + 14; z++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d > 13) continue;
      if (d > 11.5) w.fill(x, GROUND_VY + 1, z, x + 1, GROUND_VY + 3, z + 1, M.LIMESTONE);
      else w.set(x, GROUND_VY, z, M.SIDEWALK_DARK);
    }
  ctx.prop('FOUNTAIN_ANGEL', xm, 0.25, zm, Math.PI, 0);
  ctx.light(xm, 1.5, zm, 0.6, 7, 0xa8e0ff);
}

/** Arbre (feuillu) en voxels. Coordonnées en voxels. */
export function tree(w: VoxelWorld, x: number, y: number, z: number, rng: Rng, scale = 1, blossom = false): void {
  x = Math.round(x);
  z = Math.round(z);
  const trunkH = Math.round((14 + rng.int(0, 5)) * scale);
  w.fill(x - 1, y, z - 1, x + 1, y + trunkH, z + 1, M.BARK);
  const blobs = 4 + rng.int(0, 2);
  for (let i = 0; i < blobs; i++) {
    const r = (5 + rng.range(0, 3)) * scale;
    const bx = x + rng.range(-4, 4) * scale;
    const bz = z + rng.range(-4, 4) * scale;
    const by = y + trunkH + rng.range(-1, 5) * scale;
    const mat = blossom ? M.LEAVES_PINK : rng.chance(0.5) ? M.LEAVES : M.LEAVES_DARK;
    for (let vx = Math.floor(bx - r); vx <= bx + r; vx++)
      for (let vy = Math.floor(by - r * 0.8); vy <= by + r * 0.8; vy++)
        for (let vz = Math.floor(bz - r); vz <= bz + r; vz++) {
          const dx = (vx - bx) / r;
          const dy = (vy - by) / (r * 0.8);
          const dz = (vz - bz) / r;
          const d = dx * dx + dy * dy + dz * dz;
          if (d > 1) continue;
          if (d > 0.7 && (hash32(vx * 73 + vy * 151 + vz * 997) & 3) === 0) continue;
          if (w.get(vx, vy, vz) === 0) w.set(vx, vy, vz, mat);
        }
  }
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    for (let k = 0; k < 5 * scale; k++) w.set(Math.round(x + Math.cos(a) * k), y + trunkH - 3 + Math.floor(k / 2), Math.round(z + Math.sin(a) * k), M.BARK);
  }
}

/** Affleurement de schiste (Central Park). */
function rock(w: VoxelWorld, x: number, z: number, rng: Rng): void {
  const r = rng.range(6, 11);
  for (let vx = Math.floor(x - r); vx <= x + r; vx++)
    for (let vz = Math.floor(z - r); vz <= z + r; vz++) {
      const d = Math.hypot(vx - x, (vz - z) * 1.3) / r;
      if (d > 1) continue;
      const h = Math.round((1 - d * d) * r * 0.5 + rng.range(0, 1));
      w.fill(vx, GROUND_VY, vz, vx + 1, GROUND_VY + h, vz + 1, M.ROCK);
    }
}

// ======================================================================================
// Immeubles de décor (fermés)

function buildFiller(ctx: GenContext, def: FillerDef, rng: Rng): void {
  const f = new Frame(ctx, def.rect, def.front, -1);
  const top = Math.round(def.height * INV_VOXEL);
  const { W, D } = f;
  const st: Facade = {
    ...FACADE_DEFAULT,
    wall: def.style === 'walkup' ? rng.pick([M.BRICK_RED, M.BRICK_BROWN, M.BRICK_YELLOW]) : def.style === 'deco' ? M.LIMESTONE : M.METAL_PANEL_DARK,
    wallSide: M.BRICK_BROWN,
    lit: 0.5,
  };
  f.fill(0, 0, 0, W, 1, D, M.GRANITE);
  hollowBlock(f, 0, 0, W, D, 1, top, st.wall, M.ROOF_TAR);
  if (def.style === 'glass') {
    curtainBlock(f, 0, 0, W, D, 18, top - 2, rng.chance(0.5) ? M.CURTAIN_BLUE : M.CURTAIN_DARK, M.METAL_PANEL_DARK);
    cladFace(f, 'front', 1, 16, M.GLASS_SHOP);
    ledRing(f, 0, 0, W, D, 17, M.LED_WHITE);
  } else {
    for (let base = 1; base < top - 10; base += 14) for (const wl of ['front', 'back', 'left', 'right'] as Wall[]) windowRow(f, wl, st, rng, base + 4, 7);
    if (def.style === 'deco') for (const wl of ['front', 'back'] as Wall[]) piers(f, wl, st, 14, top - 2, M.LIMESTONE);
    if (def.style === 'walkup') {
      cornice(f, top - 2, M.LIMESTONE, true);
      waterTower(f, Math.round(W / 2), Math.round(D / 2), top, 5);
    }
  }
  parapet(f, top, st.wall, 3);
}

// ======================================================================================
// Mobilier urbain

function streetFurniture(ctx: GenContext, gm: Uint8Array, sx: number, sz: number, rng: Rng): void {
  const g = (x: number, z: number) => {
    const vx = Math.floor(x * INV_VOXEL);
    const vz = Math.floor(z * INV_VOXEL);
    if (vx < 0 || vz < 0 || vx >= sx || vz >= sz) return GM.BOUNDARY;
    return gm[vz * sx + vx];
  };
  const doors = ctx.buildings.flatMap((b) => b.doors.map((d) => [d.x, d.z] as [number, number]));
  const nearDoor = (x: number, z: number, r: number) => doors.some(([dx, dz]) => (dx - x) ** 2 + (dz - z) ** 2 < r * r);
  const solidAt = (x: number, z: number) => ctx.world.get(Math.floor(x * INV_VOXEL), GROUND_VY + 1, Math.floor(z * INV_VOXEL)) !== 0;
  const free = (x: number, z: number, m = 0.6) => !nearDoor(x, z, 3.2) && !solidAt(x, z) && !ctx.inFootprint(x, z, m) && !isWater(x, z);
  const placed: [number, number][] = [];
  const far = (x: number, z: number, d: number) => placed.every(([a, b]) => (a - x) ** 2 + (b - z) ** 2 > d * d);
  // ---------------------------------------------- lampadaires LED le long des bordures (bras vers la chaussée)
  for (const r of ROADS) {
    if (r.name.startsWith('Pont')) continue;
    const [x0, z0, x1, z1] = r.rect;
    const along = r.axis === 'z';
    const len = along ? z1 - z0 : x1 - x0;
    for (let s = 5; s < len - 3; s += 14) {
      for (const side of [0, 1]) {
        if ((Math.floor(s / 14) + side) % 2 === 1) continue;
        const x = along ? (side === 0 ? x0 - 0.15 : x1 + 0.15) : x0 + s;
        const z = along ? z0 + s : side === 0 ? z0 - 0.15 : z1 + 0.15;
        if (g(x, z) !== GM.CURB || !free(x, z, 0.3) || !far(x, z, 9)) continue;
        // le bras pointe vers la chaussée
        const yaw = along ? (side === 0 ? Math.PI / 2 : -Math.PI / 2) : side === 0 ? 0 : Math.PI;
        ctx.prop('STREET_LIGHT', x, 0.25, z, yaw, 0);
        placed.push([x, z]);
      }
    }
  }
  // ---------------------------------------------- feux tricolores aux angles des carrefours
  for (const a of ROADS)
    for (const b of ROADS) {
      if (a.axis !== 'z' || b.axis !== 'x') continue;
      const ix0 = Math.max(a.rect[0], b.rect[0]);
      const ix1 = Math.min(a.rect[2], b.rect[2]);
      const iz0 = Math.max(a.rect[1], b.rect[1]);
      const iz1 = Math.min(a.rect[3], b.rect[3]);
      if (ix1 <= ix0 || iz1 <= iz0) continue;
      const corners: [number, number, number][] = [
        [ix0 - 0.6, iz0 - 0.6, 0],
        [ix1 + 0.6, iz1 + 0.6, Math.PI],
        [ix0 - 0.6, iz1 + 0.6, Math.PI / 2],
        [ix1 + 0.6, iz0 - 0.6, -Math.PI / 2],
      ];
      for (const [x, z, yaw] of corners) {
        if (g(x, z) !== GM.CURB && g(x, z) !== GM.SIDEWALK) continue;
        if (!free(x, z, 0.3) || !far(x, z, 3)) continue;
        ctx.prop('TRAFFIC_LIGHT', x, 0.25, z, yaw, 0);
        placed.push([x, z]);
        // bouche d'incendie et poubelle près du coin
        const hx = x + Math.sin(yaw + 0.8) * 2.5;
        const hz = z + Math.cos(yaw + 0.8) * 2.5;
        if ((g(hx, hz) === GM.SIDEWALK || g(hx, hz) === GM.CURB) && free(hx, hz) && far(hx, hz, 2)) {
          ctx.prop(rng.chance(0.5) ? 'HYDRANT' : 'TRASH_CAN', hx, 0.25, hz, rng.range(0, 3), 0);
          placed.push([hx, hz]);
        }
      }
    }
  // ---------------------------------------------- mobilier dispersé sur les trottoirs
  const kinds = ['HYDRANT', 'TRASH_CAN', 'MAILBOX', 'VENDING_MACHINE', 'HOLO_KIOSK', 'BENCH', 'AD_COLUMN', 'BIKE_RACK', 'CHARGING_POST', 'PLANTER', 'NEWS_STAND', 'FOOD_CART', 'HOLO_BOOTH', 'PARKING_METER', 'DUMPSTER'] as const;
  for (let i = 0; i < 520; i++) {
    const x = rng.range(4, WORLD_W - 6);
    const z = rng.range(8, WORLD_D - 2);
    if (g(x, z) !== GM.SIDEWALK || !free(x, z, 0.8) || !far(x, z, 3.2)) continue;
    // il faut un bord de trottoir proche (mobilier aligné sur la rue)
    let nx = 0;
    let nz = 0;
    for (const [ox, oz] of [
      [1.2, 0],
      [-1.2, 0],
      [0, 1.2],
      [0, -1.2],
    ])
      if (g(x + ox, z + oz) === GM.CURB) {
        nx = ox;
        nz = oz;
      }
    if (nx === 0 && nz === 0) continue;
    const d = districtAt(x, z).id;
    let k: (typeof kinds)[number] = rng.pick(kinds);
    if (k === 'DUMPSTER' && d !== 'brooklyn' && d !== 'queens' && d !== 'chinatown') k = 'TRASH_CAN';
    if (k === 'FOOD_CART' && d !== 'midtown' && d !== 'wallstreet' && d !== 'chinatown') k = 'HYDRANT';
    const yaw = Math.atan2(nx, nz);
    ctx.prop(k, x, 0.25, z, yaw, rng.int(0, 7));
    placed.push([x, z]);
  }
  // ---------------------------------------------- bouches à vapeur sur la chaussée
  for (let i = 0; i < 40; i++) {
    const r = rng.pick(ROADS);
    if (r.name.startsWith('Pont')) continue;
    const x = rng.range(r.rect[0] + 1.5, r.rect[2] - 1.5);
    const z = rng.range(r.rect[1] + 1.5, r.rect[3] - 1.5);
    if (g(x, z) !== GM.ROAD || isWater(x, z)) continue;
    ctx.prop('STEAM_VENT', x, 0, z, 0, 0);
    ctx.smokes.push({ x, y: 0.1, z, big: rng.chance(0.25) });
  }
  // ---------------------------------------------- arbres d'alignement (Harlem, Brooklyn, Queens, Chinatown)
  for (let i = 0; i < 160; i++) {
    const x = rng.range(4, WORLD_W - 6);
    const z = rng.range(8, WORLD_D - 2);
    const d = districtAt(x, z).id;
    if (d === 'midtown' || d === 'wallstreet') continue;
    if (g(x, z) !== GM.SIDEWALK || !free(x, z, 2.2) || !far(x, z, 6)) continue;
    let curb = false;
    for (const [ox, oz] of [
      [1.2, 0],
      [-1.2, 0],
      [0, 1.2],
      [0, -1.2],
    ])
      if (g(x + ox, z + oz) === GM.CURB) curb = true;
    if (!curb) continue;
    const w = ctx.world;
    const vx = Math.floor(x * INV_VOXEL);
    const vz = Math.floor(z * INV_VOXEL);
    w.fill(vx - 2, GROUND_VY, vz - 2, vx + 2, GROUND_VY + 1, vz + 2, M.DIRT);
    tree(w, vx, GROUND_VY + 1, vz, rng, 0.75, d === 'chinatown' && rng.chance(0.4));
    placed.push([x, z]);
  }
  // ---------------------------------------------- néons de rue (Chinatown, Times Square, Brooklyn)
  for (const b of ctx.buildings) {
    const d = b.def.district;
    if (d !== 'chinatown' && d !== 'midtown' && d !== 'brooklyn') continue;
    if (b.def.type === 'tower' || b.def.type === 'penthouse' || b.def.type === 'landmark') continue;
    const door = b.doors[0];
    const ox = door.out.x - door.x;
    const oz = door.out.z - door.z;
    const l = Math.hypot(ox, oz) || 1;
    const px = door.x + (ox / l) * 0.6 + (oz / l) * 5;
    const pz = door.z + (oz / l) * 0.6 - (ox / l) * 5;
    ctx.prop('NEON_SIGN', px, 4.2, pz, Math.atan2(oz, ox), rng.int(0, 7), -1);
  }
}

/** Hologrammes géants (silhouettes animées dessinées par le client). */
function holograms(ctx: GenContext): void {
  ctx.holos.push({ x: 98, y: 24, z: 112, yaw: 0, scale: 6, kind: 'dancer', color: 0xff3cc8 });
  ctx.holos.push({ x: 84, y: 30, z: 128, yaw: 0.4, scale: 7, kind: 'koi', color: 0x3ce8ff });
  ctx.holos.push({ x: 114, y: 32, z: 120, yaw: -0.3, scale: 5, kind: 'bottle', color: 0xffd040 });
  ctx.holos.push({ x: 40, y: 22, z: 186, yaw: 0, scale: 6, kind: 'dragon', color: 0xff4040 });
  ctx.holos.push({ x: 70, y: 18, z: 211, yaw: 0, scale: 4, kind: 'koi', color: 0xff8a20 });
  ctx.holos.push({ x: 145, y: 34, z: 211, yaw: 0, scale: 6, kind: 'logo', color: 0x40c8ff });
  ctx.holos.push({ x: 272, y: 18, z: 216, yaw: 0, scale: 4, kind: 'dancer', color: 0xff3050 });
  ctx.holos.push({ x: 272, y: 18, z: 24, yaw: 0, scale: 4, kind: 'ring', color: 0x40a0ff });
  ctx.holos.push({ x: 168, y: 48, z: 152, yaw: 0, scale: 8, kind: 'ring', color: 0xa848ff });
  ctx.holos.push({ x: 140, y: 26, z: 60, yaw: 0, scale: 4, kind: 'face', color: 0x7dffb0 });
  ctx.holos.push({ x: 28, y: 20, z: 56, yaw: 0, scale: 5, kind: 'logo', color: 0xffb020 });
  void CREEK;
}
