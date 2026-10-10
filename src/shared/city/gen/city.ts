// Génération complète de la ville (identique sur le client et le serveur).

import { M } from '../../materials';
import { Rng, hash32 } from '../../util';
import { GROUND_VY, INV_VOXEL, VOXEL, VoxelWorld } from '../../voxel';
import { AREAS, BUILDINGS, PIERS, RIVER_Z, WORLD_D, WORLD_H, WORLD_W, type AreaDef } from '../plan';
import { GenContext, type BuildingInfo } from './context';
import { generateBuilding } from './buildings';
import { buildGasometer } from './landmarks';

export const CITY_SEED = 18881888;

export interface City {
  world: VoxelWorld;
  ctx: GenContext;
  buildings: BuildingInfo[];
  /** Carte 2D (voxels) : 0 route, 1 trottoir, 2 bordure, 3 bâtiment, 4 zone spéciale, 5 fleuve, 6 jetée. */
  groundMap: Uint8Array;
  gw: number;
  gd: number;
}

export const GM = { ROAD: 0, SIDEWALK: 1, CURB: 2, BUILDING: 3, AREA: 4, RIVER: 5, PIER: 6, BOUNDARY: 7 } as const;

export function generateCity(seed = CITY_SEED): City {
  const sx = WORLD_W * INV_VOXEL;
  const sz = WORLD_D * INV_VOXEL;
  const sy = WORLD_H * INV_VOXEL;
  const world = new VoxelWorld(sx, sy, sz);
  const ctx = new GenContext(world, seed);
  const rng = new Rng(seed);
  for (const b of BUILDINGS) ctx.footprints.push(b.rect);

  // ------------------------------------------------------------------ sol de base
  world.fill(0, 0, 0, sx, GROUND_VY - 1, sz, M.STONE_DARK);
  world.fill(0, GROUND_VY - 1, 0, sx, GROUND_VY, sz, M.ROAD);

  // ------------------------------------------------------------------ carte au sol 2D
  const gm = new Uint8Array(sx * sz);
  const idx = (x: number, z: number) => z * sx + x;
  const markRect = (r: [number, number, number, number], v: number, onlyIf?: number) => {
    const x0 = Math.max(0, Math.round(r[0] * INV_VOXEL));
    const z0 = Math.max(0, Math.round(r[1] * INV_VOXEL));
    const x1 = Math.min(sx, Math.round(r[2] * INV_VOXEL));
    const z1 = Math.min(sz, Math.round(r[3] * INV_VOXEL));
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) if (onlyIf === undefined || gm[idx(x, z)] === onlyIf) gm[idx(x, z)] = v;
  };
  const riverVZ = RIVER_Z * INV_VOXEL;
  markRect([0, RIVER_Z, WORLD_W, WORLD_D], GM.RIVER);
  for (const p of PIERS) markRect(p, GM.PIER);
  for (const b of BUILDINGS) markRect(b.rect, GM.BUILDING);
  for (const a of AREAS) markRect(a.rect, GM.AREA, GM.ROAD);
  // limites : viaduc au nord, parc à l'ouest, mur des docks à l'est
  markRect([0, 0, WORLD_W, 5], GM.BOUNDARY);
  markRect([0, 0, 4, RIVER_Z], GM.BOUNDARY);
  markRect([198, 0, WORLD_W, RIVER_Z], GM.BOUNDARY);
  // trottoirs autour des bâtiments et des zones
  const pad = 6;
  const expand = (r: [number, number, number, number]) => {
    const x0 = Math.max(0, Math.round(r[0] * INV_VOXEL) - pad);
    const z0 = Math.max(0, Math.round(r[1] * INV_VOXEL) - pad);
    const x1 = Math.min(sx, Math.round(r[2] * INV_VOXEL) + pad);
    const z1 = Math.min(sz, Math.round(r[3] * INV_VOXEL) + pad);
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (gm[idx(x, z)] === GM.ROAD) gm[idx(x, z)] = GM.SIDEWALK;
  };
  for (const b of BUILDINGS) expand(b.rect);
  for (const a of AREAS) if (a.kind !== 'market') expand(a.rect);
  // promenade le long du fleuve et pied du viaduc
  markRect([0, RIVER_Z - 2, WORLD_W, RIVER_Z], GM.SIDEWALK, GM.ROAD);
  markRect([0, 5, WORLD_W, 6.5], GM.SIDEWALK, GM.ROAD);
  markRect([4, 0, 5.5, RIVER_Z], GM.SIDEWALK, GM.ROAD);
  markRect([196.5, 0, 198, RIVER_Z], GM.SIDEWALK, GM.ROAD);
  // bordures
  for (let z = 1; z < sz - 1; z++)
    for (let x = 1; x < sx - 1; x++) {
      if (gm[idx(x, z)] !== GM.SIDEWALK) continue;
      if (
        gm[idx(x + 1, z)] === GM.ROAD ||
        gm[idx(x - 1, z)] === GM.ROAD ||
        gm[idx(x, z + 1)] === GM.ROAD ||
        gm[idx(x, z - 1)] === GM.ROAD
      )
        gm[idx(x, z)] = GM.CURB;
    }
  // écriture des voxels du sol
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      const g = gm[idx(x, z)];
      if (g === GM.SIDEWALK || g === GM.BOUNDARY) world.set(x, GROUND_VY, z, M.SIDEWALK);
      else if (g === GM.CURB) world.set(x, GROUND_VY, z, M.CURB);
      else if (g === GM.ROAD) {
        // caniveau le long des bordures + motif de pavés plus sombres sur l'axe
        const nearCurb =
          gm[idx(Math.min(sx - 1, x + 1), z)] === GM.CURB ||
          gm[idx(Math.max(0, x - 1), z)] === GM.CURB ||
          gm[idx(x, Math.min(sz - 1, z + 1))] === GM.CURB ||
          gm[idx(x, Math.max(0, z - 1))] === GM.CURB;
        if (nearCurb) world.set(x, GROUND_VY - 1, z, M.ROAD_DARK);
      }
    }

  // ------------------------------------------------------------------ fleuve et quais
  world.fill(0, 1, riverVZ, sx, GROUND_VY, sz, 0);
  world.fill(0, 0, riverVZ, sx, 1, sz, M.RIVERBED);
  world.fill(0, 0, riverVZ - 4, sx, GROUND_VY, riverVZ, M.QUAY);
  // parapet de granit le long du quai (interrompu aux jetées)
  for (let x = 16; x < sx; x++) {
    const xm = x * VOXEL;
    let atPier = false;
    for (const p of PIERS) if (xm >= p[0] - 0.5 && xm < p[2] + 0.5) atPier = true;
    if (xm > 140 && xm < 196) {
      // les docks : quai ouvert avec bollards
      if (!atPier && x % 24 === 0) world.fill(x, GROUND_VY, riverVZ - 2, x + 2, GROUND_VY + 3, riverVZ, M.IRON);
      continue;
    }
    if (atPier) continue;
    world.fill(x, GROUND_VY, riverVZ - 2, x + 1, GROUND_VY + 3, riverVZ, M.STONE_GREY);
    if (x % 2 === 0) world.set(x, GROUND_VY + 3, riverVZ - 2, M.STONE_GREY);
  }
  // jetées en bois sur pilotis
  for (const p of PIERS) {
    const x0 = Math.round(p[0] * INV_VOXEL);
    const x1 = Math.round(p[2] * INV_VOXEL);
    const z1 = Math.round(p[3] * INV_VOXEL);
    world.fill(x0, GROUND_VY - 1, riverVZ, x1, GROUND_VY, z1, M.DOCK_PLANK);
    for (let z = riverVZ + 2; z < z1; z += 8) {
      for (const x of [x0, x1 - 2]) world.fill(x, 0, z, x + 2, GROUND_VY - 1, z + 2, M.TIMBER);
      world.fill(x0, GROUND_VY - 2, z, x1, GROUND_VY - 1, z + 1, M.TIMBER);
    }
    // bollards en fonte
    for (let z = riverVZ + 6; z < z1; z += 12) {
      world.fill(x0, GROUND_VY, z, x0 + 1, GROUND_VY + 2, z + 1, M.IRON);
      world.fill(x1 - 1, GROUND_VY, z, x1, GROUND_VY + 2, z + 1, M.IRON);
    }
    ctx.prop('GAS_LANTERN_PIER', (p[0] + p[2]) / 2 - 2.2, 0, p[3] - 1.2, 0);
    ctx.prop('ROPE_COIL', p[0] + 1, 0, p[1] + 5, 0.4);
    ctx.prop('FISH_CRATES', p[2] - 1.2, 0, p[1] + 9, 1.57);
  }

  // ------------------------------------------------------------------ limites de la ville
  buildViaduct(world);
  buildDockWall(world);
  buildWestPark(ctx, rng);

  // ------------------------------------------------------------------ bâtiments
  for (const def of BUILDINGS) {
    generateBuilding(ctx, def);
  }
  buildGasometer(ctx, 122.5, 126.5, 4.6);

  // ------------------------------------------------------------------ zones spéciales
  for (const a of AREAS) buildArea(ctx, a, rng.fork(hash32(a.rect[0] * 31 + a.rect[1])));

  // ------------------------------------------------------------------ navires et grues des docks
  buildShip(world, ctx, 156, 144.5, 20, 7.5);
  buildBarge(world, ctx, 187.5, 145, 8.5, 5);
  buildCrane(world, ctx, 165, 136.5);
  buildCrane(world, ctx, 190, 136.5);

  // ------------------------------------------------------------------ mobilier urbain
  streetFurniture(ctx, gm, sx, sz, rng);

  return { world, ctx, buildings: ctx.buildings, groundMap: gm, gw: sx, gd: sz };
}

// ======================================================================================

function buildViaduct(world: VoxelWorld): void {
  const z0 = 0;
  const z1 = 20; // 5 m
  const top = GROUND_VY + 30;
  world.fill(0, GROUND_VY, z0, world.sx, top, z1, M.BRICK_SOOT);
  // arches aveugles sur la face sud
  for (let x = 6; x + 18 < world.sx; x += 24) {
    for (let y = GROUND_VY; y < GROUND_VY + 22; y++) {
      for (let dx = 0; dx < 18; dx++) {
        const cx = dx - 8.5;
        const archY = GROUND_VY + 15 + Math.sqrt(Math.max(0, 81 - cx * cx)) * 0.8;
        if (y < archY) {
          world.set(x + dx, y, z1 - 1, 0);
          world.set(x + dx, y, z1 - 2, 0);
          world.set(x + dx, y, z1 - 3, (dx + y) % 7 === 0 ? M.BRICK_BROWN : M.BRICK_SOOT);
        }
      }
    }
    // grille de fer
    for (let dx = 1; dx < 18; dx += 2) world.fill(x + dx, GROUND_VY, z1 - 2, x + dx + 1, GROUND_VY + 12, z1 - 1, M.IRON);
    world.fill(x, GROUND_VY + 12, z1 - 2, x + 18, GROUND_VY + 13, z1 - 1, M.IRON);
  }
  // corniche, parapet et rails
  world.fill(0, top, z0, world.sx, top + 1, z1 + 1, M.STONE_GREY);
  world.fill(0, top + 1, z1 - 1, world.sx, top + 4, z1, M.BRICK_SOOT);
  world.fill(0, top + 1, z0, world.sx, top + 2, z1 - 1, M.GRAVEL);
  for (const rz of [6, 12]) world.fill(0, top + 2, rz, world.sx, top + 3, rz + 1, M.IRON);
}

function buildDockWall(world: VoxelWorld): void {
  const x0 = 198 * INV_VOXEL;
  const z1 = (RIVER_Z - 1) * INV_VOXEL;
  world.fill(x0, GROUND_VY, 20, world.sx, GROUND_VY + 22, z1, M.BRICK_SOOT);
  world.fill(x0 - 1, GROUND_VY + 22, 20, world.sx, GROUND_VY + 23, z1, M.STONE_GREY);
  for (let z = 30; z < z1; z += 40) world.fill(x0 - 1, GROUND_VY, z, x0, GROUND_VY + 22, z + 3, M.BRICK_BROWN);
  // grand portail fermé
  const gz = 100 * INV_VOXEL;
  world.fill(x0 - 1, GROUND_VY, gz, x0, GROUND_VY + 16, gz + 24, M.PAINT_GREEN);
  for (let z = gz; z < gz + 24; z += 3) world.fill(x0 - 2, GROUND_VY, z, x0 - 1, GROUND_VY + 16, z + 1, M.IRON);
}

function buildWestPark(ctx: GenContext, rng: Rng): void {
  const w = ctx.world;
  w.fill(0, GROUND_VY, 20, 16, GROUND_VY + 1, (RIVER_Z - 1) * INV_VOXEL, M.GRASS);
  for (let zm = 9; zm < RIVER_Z - 4; zm += 2) ctx.prop('RAILING', 4.06, 0.25, zm + 1, Math.PI / 2);
  for (let zm = 12; zm < RIVER_Z - 6; zm += 9) tree(w, 1.6 * INV_VOXEL, GROUND_VY + 1, (zm + rng.range(-1, 1)) * INV_VOXEL, rng, 0.85);
}

/** Arbre (platane) en voxels. Coordonnées en voxels. */
export function tree(w: VoxelWorld, x: number, y: number, z: number, rng: Rng, scale = 1): void {
  x = Math.round(x);
  z = Math.round(z);
  const trunkH = Math.round((13 + rng.int(0, 4)) * scale);
  w.fill(x - 1, y, z - 1, x + 1, y + trunkH, z + 1, M.BARK);
  w.fill(x - 2, y, z - 2, x + 2, y + 1, z + 2, M.BARK);
  const blobs = 4 + rng.int(0, 2);
  for (let i = 0; i < blobs; i++) {
    const r = (5 + rng.range(0, 3)) * scale;
    const bx = x + rng.range(-4, 4) * scale;
    const bz = z + rng.range(-4, 4) * scale;
    const by = y + trunkH + rng.range(-1, 5) * scale;
    const mat = rng.chance(0.5) ? M.LEAVES : M.LEAVES_DARK;
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
  // quelques branches
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    for (let k = 0; k < 5 * scale; k++) w.set(Math.round(x + Math.cos(a) * k), y + trunkH - 3 + Math.floor(k / 2), Math.round(z + Math.sin(a) * k), M.BARK);
  }
}

function buildArea(ctx: GenContext, a: AreaDef, rng: Rng): void {
  const w = ctx.world;
  const [x0m, z0m, x1m, z1m] = a.rect;
  const x0 = Math.round(x0m * INV_VOXEL);
  const z0 = Math.round(z0m * INV_VOXEL);
  const x1 = Math.round(x1m * INV_VOXEL);
  const z1 = Math.round(z1m * INV_VOXEL);
  const cxm = (x0m + x1m) / 2;
  const czm = (z0m + z1m) / 2;
  switch (a.kind) {
    case 'garden':
    case 'park': {
      w.fill(x0, GROUND_VY, z0, x1, GROUND_VY + 1, z1, M.GRASS);
      // bordure de pierre
      w.fill(x0, GROUND_VY, z0, x1, GROUND_VY + 1, z0 + 1, M.STONE_GREY);
      w.fill(x0, GROUND_VY, z1 - 1, x1, GROUND_VY + 1, z1, M.STONE_GREY);
      w.fill(x0, GROUND_VY, z0, x0 + 1, GROUND_VY + 1, z1, M.STONE_GREY);
      w.fill(x1 - 1, GROUND_VY, z0, x1, GROUND_VY + 1, z1, M.STONE_GREY);
      // allées de gravier en croix
      const cx = Math.round((x0 + x1) / 2);
      const cz = Math.round((z0 + z1) / 2);
      w.fill(cx - 4, GROUND_VY, z0 + 1, cx + 4, GROUND_VY + 1, z1 - 1, M.GRAVEL);
      w.fill(x0 + 1, GROUND_VY, cz - 4, x1 - 1, GROUND_VY + 1, cz + 4, M.GRAVEL);
      // grilles avec portillons au milieu de chaque côté
      const big = x1m - x0m > 12 && z1m - z0m > 6;
      if (a.kind === 'garden' && big) {
        for (let xm = x0m + 1; xm < x1m - 0.5; xm += 2) {
          if (Math.abs(xm - cxm) < 2) continue;
          ctx.prop('RAILING', xm, 0.25, z0m + 0.1, 0);
          ctx.prop('RAILING', xm, 0.25, z1m - 0.1, 0);
        }
        for (let zm = z0m + 1; zm < z1m - 0.5; zm += 2) {
          if (Math.abs(zm - czm) < 2) continue;
          ctx.prop('RAILING', x0m + 0.1, 0.25, zm, Math.PI / 2);
          ctx.prop('RAILING', x1m - 0.1, 0.25, zm, Math.PI / 2);
        }
      }
      if (big) {
        // arbres aux quatre coins
        const inset = Math.min(4.5, (x1m - x0m) / 5);
        const insetZ = Math.min(4.5, (z1m - z0m) / 4);
        const spots: [number, number][] =
          a.kind === 'park'
            ? Array.from({ length: Math.floor((x1m - x0m) / 8) }, (_, i) => [x0m + 4 + i * 8, z0m + 3] as [number, number])
            : [
                [x0m + inset, z0m + insetZ],
                [x1m - inset, z0m + insetZ],
                [x0m + inset, z1m - insetZ],
                [x1m - inset, z1m - insetZ],
              ];
        for (const [tx, tz] of spots) tree(w, tx * INV_VOXEL, GROUND_VY + 1, tz * INV_VOXEL, rng, a.kind === 'park' ? 0.9 : 1.1);
        // statue centrale ou fontaine
        if (a.kind === 'garden') {
          if (a.name === 'Soho Square') {
            // fontaine : bassin + statue
            for (let vx = cx - 10; vx < cx + 10; vx++)
              for (let vz = cz - 10; vz < cz + 10; vz++) {
                const d = Math.hypot(vx + 0.5 - cx, vz + 0.5 - cz);
                if (d < 10 && d > 8.5) w.fill(vx, GROUND_VY + 1, vz, vx + 1, GROUND_VY + 4, vz + 1, M.STONE);
                else if (d <= 8.5) w.set(vx, GROUND_VY + 1, vz, M.QUAY);
              }
            ctx.prop('STATUE', cxm, 0.5, czm, Math.PI);
          } else {
            ctx.prop('STATUE', cxm, 0.25, czm, Math.PI);
          }
          for (const [dx, dz, yaw] of [
            [-5, -2.5, Math.PI / 2],
            [5, 2.5, -Math.PI / 2],
          ] as const)
            ctx.prop('BENCH', cxm + dx, 0.25, czm + dz, yaw);
          ctx.prop('LAMP_POST', cxm - 2.6, 0.25, czm - 2.6, 0);
          ctx.prop('LAMP_POST', cxm + 2.6, 0.25, czm + 2.6, 0);
        } else {
          for (let xm = x0m + 6; xm < x1m - 4; xm += 10) {
            ctx.prop('BENCH', xm, 0.25, z1m - 1.3, Math.PI);
            ctx.prop('LAMP_POST', xm + 5, 0.25, z1m - 1.1, 0);
          }
          ctx.prop('STATUE', x0m + 3, 0.25, z1m - 4, Math.PI);
        }
      }
      break;
    }
    case 'plaza': {
      w.fill(x0, GROUND_VY, z0, x1, GROUND_VY + 1, z1, M.SIDEWALK);
      // socle et statue équestre
      const cx = Math.round((x0 + x1) / 2);
      const cz = Math.round((z0 + z1) / 2);
      w.fill(cx - 10, GROUND_VY + 1, cz - 8, cx + 10, GROUND_VY + 2, cz + 8, M.STONE_GREY);
      ctx.prop('STATUE_HORSE', cxm, 0.5, czm, Math.PI / 2);
      ctx.prop('STREET_CLOCK', cxm - 12, 0.25, czm - 1.5, 0);
      ctx.prop('NEWS_STAND', cxm + 12, 0.25, czm - 2, 0);
      for (let xm = x0m + 4; xm < x1m - 2; xm += 12) {
        if (Math.abs(xm - cxm) < 6) continue;
        ctx.prop('LAMP_DOUBLE', xm, 0.25, czm, 0);
        ctx.prop('BENCH', xm + 3, 0.25, czm + 2.2, Math.PI);
      }
      break;
    }
    case 'market': {
      const along = x1m - x0m < z1m - z0m; // marché en long sur z
      if (along) {
        for (let zm = z0m + 2; zm < z1m - 2; zm += 4.2) {
          ctx.prop('MARKET_STALL', x0m + 1.6, 0, zm, Math.PI / 2, rng.int(0, 5));
          ctx.prop('MARKET_STALL', x1m - 1.6, 0, zm + 2, -Math.PI / 2, rng.int(0, 5));
          if (rng.chance(0.5)) ctx.prop(rng.chance(0.5) ? 'CRATE' : 'BARREL', x0m + 3.6, 0, zm + 1.2, rng.range(0, 3));
        }
        for (let zm = z0m + 8; zm < z1m - 4; zm += 16) ctx.prop('LAMP_POST', (x0m + x1m) / 2, 0, zm, 0);
      } else {
        for (let xm = x0m + 2; xm < x1m - 2; xm += 4.2) {
          ctx.prop('MARKET_STALL', xm, 0, z0m + 1.6, 0, rng.int(0, 5));
          ctx.prop('MARKET_STALL', xm + 2, 0, z1m - 1.6, Math.PI, rng.int(0, 5));
        }
        ctx.prop('HANDCART', cxm, 0, czm, 0.3);
        ctx.prop('LAMP_POST', cxm - 5, 0, czm, 0);
      }
      break;
    }
    case 'yard': {
      w.fill(x0, GROUND_VY - 1, z0, x1, GROUND_VY, z1, M.DIRT);
      ctx.prop('CRATE_STACK', cxm, 0, czm, 0);
      break;
    }
  }
}

function buildShip(w: VoxelWorld, ctx: GenContext, x0m: number, z0m: number, lenM: number, beamM: number): void {
  const x0 = Math.round(x0m * INV_VOXEL);
  const z0 = Math.round(z0m * INV_VOXEL);
  const L = Math.round(lenM * INV_VOXEL);
  const B = Math.round(beamM * INV_VOXEL);
  const waterY = 4; // couche voxel de la surface de l'eau
  const deck = waterY + 9;
  for (let i = 0; i < L; i++) {
    const t = i / (L - 1);
    // proue effilée côté est
    const taper = t > 0.75 ? 1 - ((t - 0.75) / 0.25) ** 1.6 : t < 0.08 ? 0.82 + 0.18 * (t / 0.08) : 1;
    const half = Math.max(1, Math.round((B / 2) * taper));
    const cz = z0 + B / 2;
    for (let y = 1; y <= deck; y++) {
      const narrow = y < 4 ? (4 - y) * 0.6 : 0;
      const hh = Math.max(1, Math.round(half - narrow));
      for (let dz = -hh; dz < hh; dz++) {
        const edge = dz === -hh || dz === hh - 1 || y <= 2;
        const m = y < waterY + 2 ? M.HULL_RED : y === deck - 1 ? M.PAINT_CREAM : M.HULL;
        if (y === deck) {
          w.set(x0 + i, y, Math.round(cz + dz), M.DOCK_PLANK);
        } else if (edge || i === 0 || i === L - 1) {
          w.set(x0 + i, y, Math.round(cz + dz), m);
        } else w.set(x0 + i, y, Math.round(cz + dz), M.HULL);
      }
      // bastingage
      if (y === deck) {
        w.set(x0 + i, deck + 1, Math.round(cz - hh), M.HULL);
        w.set(x0 + i, deck + 1, Math.round(cz + hh - 1), M.HULL);
      }
    }
  }
  // mâts, vergues et voiles carguées
  const masts = [0.22, 0.5, 0.76];
  for (const mt of masts) {
    const mx = x0 + Math.round(L * mt);
    const mz = z0 + Math.round(B / 2);
    const h = mt === 0.5 ? 92 : 80;
    w.fill(mx, deck + 1, mz, mx + 1, deck + h, mz + 1, M.TIMBER);
    for (const yy of [deck + 30, deck + 52, deck + 72]) {
      if (yy >= deck + h) continue;
      const span = yy > deck + 60 ? 9 : 14;
      w.fill(mx, yy, mz - span, mx + 1, yy + 1, mz + span, M.TIMBER);
      w.fill(mx, yy - 1, mz - span + 1, mx + 1, yy, mz + span - 1, M.SAIL);
    }
  }
  // beaupré
  for (let k = 0; k < 22; k++) w.set(x0 + L + k, deck + 2 + Math.floor(k / 3), z0 + Math.round(B / 2), M.TIMBER);
  // passerelle vers la jetée ouest
  const gx = Math.round(152 * INV_VOXEL);
  for (let x = gx; x < x0 + 2; x++) {
    const t = (x - gx) / Math.max(1, x0 + 2 - gx);
    const y = Math.round(GROUND_VY - 1 + t * (deck - GROUND_VY + 1));
    w.fill(x, y, z0 + 10, x + 1, y + 1, z0 + 16, M.DOCK_PLANK);
  }
  ctx.light(x0m + lenM * 0.5, (deck - GROUND_VY) * VOXEL + 2, z0m + beamM / 2, 0.6, 7);
  ctx.prop('SHIP_WHEEL', x0m + 2.5, (deck + 1 - GROUND_VY) * VOXEL, z0m + beamM / 2, Math.PI / 2);
  ctx.prop('BARREL', x0m + 6, (deck + 1 - GROUND_VY) * VOXEL, z0m + 1.5, 0);
  ctx.prop('CRATE', x0m + 9, (deck + 1 - GROUND_VY) * VOXEL, z0m + beamM - 1.6, 0.3);
}

function buildBarge(w: VoxelWorld, ctx: GenContext, x0m: number, z0m: number, lenM: number, beamM: number): void {
  const x0 = Math.round(x0m * INV_VOXEL);
  const z0 = Math.round(z0m * INV_VOXEL);
  const L = Math.round(lenM * INV_VOXEL);
  const B = Math.round(beamM * INV_VOXEL);
  const deck = 9;
  for (let i = 0; i < L; i++)
    for (let j = 0; j < B; j++) {
      for (let y = 2; y < deck; y++) {
        const edge = i === 0 || j === 0 || i === L - 1 || j === B - 1;
        if (edge) w.set(x0 + i, y, z0 + j, y < 5 ? M.HULL_RED : M.HULL);
      }
      w.set(x0 + i, 2, z0 + j, M.HULL);
      // cargaison de charbon
      if (i > 3 && i < L - 4 && j > 2 && j < B - 3) w.fill(x0 + i, 3, z0 + j, x0 + i + 1, 6 + ((i * 7 + j * 3) % 3), z0 + j + 1, M.COAL);
    }
  // cheminée du remorqueur
  w.fill(x0 + 3, deck, z0 + B / 2 - 1, x0 + 6, deck + 14, z0 + B / 2 + 2, M.PAINT_BLACK);
  w.fill(x0 + 3, deck + 12, z0 + B / 2 - 1, x0 + 6, deck + 13, z0 + B / 2 + 2, M.PAINT_RED);
  ctx.smokes.push({ x: x0m + 1.1, y: (deck + 14 - GROUND_VY) * VOXEL, z: z0m + beamM / 2, big: false });
}

function buildCrane(w: VoxelWorld, ctx: GenContext, xm: number, zm: number): void {
  const x = Math.round(xm * INV_VOXEL);
  const z = Math.round(zm * INV_VOXEL);
  // base en bois
  w.fill(x - 3, GROUND_VY, z - 3, x + 3, GROUND_VY + 3, z + 3, M.TIMBER);
  w.fill(x - 1, GROUND_VY + 3, z - 1, x + 1, GROUND_VY + 44, z + 1, M.TIMBER);
  // flèche inclinée vers le fleuve
  for (let k = 0; k < 40; k++) {
    w.set(x, GROUND_VY + 40 + Math.floor(k / 3), z + k, M.TIMBER);
    w.set(x, GROUND_VY + 41 + Math.floor(k / 3), z + k, M.TIMBER);
  }
  // câble et crochet
  w.fill(x, GROUND_VY + 18, z + 39, x + 1, GROUND_VY + 53, z + 40, M.ROPE);
  w.fill(x - 1, GROUND_VY + 16, z + 38, x + 2, GROUND_VY + 18, z + 41, M.IRON);
  ctx.prop('CRATE', xm, 0.75, zm + 1.6, 0.2);
}

// ======================================================================================

function streetFurniture(ctx: GenContext, gm: Uint8Array, sx: number, sz: number, rng: Rng): void {
  const lamps: [number, number][] = [];
  const doors = ctx.buildings.flatMap((b) => b.doors.map((d) => [d.x, d.z] as [number, number]));
  const nearDoor = (x: number, z: number, r: number) => doors.some(([dx, dz]) => (dx - x) ** 2 + (dz - z) ** 2 < r * r);
  const g = (x: number, z: number) => {
    const vx = Math.floor(x * INV_VOXEL);
    const vz = Math.floor(z * INV_VOXEL);
    if (vx < 0 || vz < 0 || vx >= sx || vz >= sz) return GM.BOUNDARY;
    return gm[vz * sx + vx];
  };
  const solidAt = (x: number, z: number) => ctx.world.get(Math.floor(x * INV_VOXEL), GROUND_VY + 1, Math.floor(z * INV_VOXEL)) !== 0;
  // réverbères au bord des trottoirs, tous les ~13 m
  for (let zm = 3; zm < RIVER_Z; zm += 6.5) {
    for (let xm = 3; xm < 198; xm += 6.5) {
      // on cherche une bordure proche
      let best: [number, number, number] | null = null;
      for (let dz = -3; dz <= 3; dz += 0.25) {
        for (let dx = -3; dx <= 3; dx += 0.25) {
          const x = xm + dx;
          const z = zm + dz;
          if (g(x, z) !== GM.CURB) continue;
          const d = dx * dx + dz * dz;
          if (!best || d < best[2]) best = [x, z, d];
        }
      }
      if (!best) continue;
      // direction de la chaussée
      let rx = 0;
      let rz = 0;
      for (const [ox, oz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (g(best[0] + ox * 0.5, best[1] + oz * 0.5) === GM.ROAD) {
          rx = ox;
          rz = oz;
        }
      }
      if (rx === 0 && rz === 0) continue;
      const lx = best[0] - rx * 0.45;
      const lz = best[1] - rz * 0.45;
      if (lamps.some(([ax, az]) => (ax - lx) ** 2 + (az - lz) ** 2 < 12.5 * 12.5)) continue;
      if (nearDoor(lx, lz, 3) || solidAt(lx, lz) || ctx.inFootprint(lx, lz, 0.4)) continue;
      lamps.push([lx, lz]);
      ctx.prop('LAMP_POST', lx, 0.25, lz, Math.atan2(rx, rz));
      // mobilier occasionnel à côté
      const r = rng.next();
      const ox = lx - rz * 2.2 - rx * 0.3;
      const oz = lz + rx * 2.2 - rz * 0.3;
      if (nearDoor(ox, oz, 3) || solidAt(ox, oz) || ctx.inFootprint(ox, oz, 0.5) || g(ox, oz) !== GM.SIDEWALK && g(ox, oz) !== GM.CURB) continue;
      if (r < 0.12) ctx.prop('PILLAR_BOX', ox, 0.25, oz, Math.atan2(rx, rz));
      else if (r < 0.24) ctx.prop('BENCH', ox, 0.25, oz, Math.atan2(rx, rz));
      else if (r < 0.32) ctx.prop('BOLLARD', ox, 0.25, oz, 0);
      else if (r < 0.4) ctx.prop('BARREL', ox, 0.25, oz, rng.range(0, 3));
      else if (r < 0.46) ctx.prop('WATER_PUMP', ox, 0.25, oz, Math.atan2(rx, rz));
      else if (r < 0.52) ctx.prop('HORSE_TROUGH', ox, 0.25, oz, Math.atan2(-rz, rx));
      else if (r < 0.58) ctx.prop('POSTER_BOARD', ox, 0.25, oz, Math.atan2(rx, rz));
    }
  }
  // caisses et tonneaux dans les docks et le quartier industriel
  for (let i = 0; i < 70; i++) {
    const x = rng.range(138, 196);
    const z = rng.range(78, 138);
    if (g(x, z) !== GM.SIDEWALK || nearDoor(x, z, 3.5) || solidAt(x, z) || ctx.inFootprint(x, z, 0.6)) continue;
    const k = rng.pick(['CRATE', 'CRATE', 'BARREL', 'SACKS', 'CRATE_STACK'] as const);
    ctx.prop(k, x, 0.25, z, rng.range(0, Math.PI));
  }
  for (let i = 0; i < 30; i++) {
    const x = rng.range(72, 130);
    const z = rng.range(78, 132);
    if (g(x, z) !== GM.SIDEWALK || nearDoor(x, z, 3.5) || solidAt(x, z) || ctx.inFootprint(x, z, 0.6)) continue;
    ctx.prop(rng.pick(['CRATE', 'BARREL', 'CART_WHEEL', 'SACKS'] as const), x, 0.25, z, rng.range(0, Math.PI));
  }
  // charrettes à bras dans Whitechapel et Soho
  for (let i = 0; i < 10; i++) {
    const x = rng.range(10, 196);
    const z = rng.range(10, 70);
    if (g(x, z) !== GM.ROAD || nearDoor(x, z, 4) || solidAt(x, z)) continue;
    if (g(x + 1.5, z) !== GM.ROAD || g(x - 1.5, z) !== GM.ROAD || g(x, z + 1.5) !== GM.ROAD || g(x, z - 1.5) !== GM.ROAD) continue;
    ctx.prop('HANDCART', x, 0, z, rng.range(0, Math.PI * 2));
  }
}
