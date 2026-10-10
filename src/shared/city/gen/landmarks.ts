// Monuments de Midtown : le Chrysler Building et l'Empire State Building (hall art déco
// visitable, tour à gradins jusqu'au plafond du monde voxel ; la flèche continue en arrière-plan).

import { M } from '../../materials';
import { Rng, hash32 } from '../../util';
import { VOXEL } from '../../voxel';
import type { BuildingDef } from '../plan';
import type { BuildingInfo, GenContext } from './context';
import { Frame } from './frame';
import { Furnisher, type Room } from './furnish';
import { FACADE_DEFAULT, entrance, hollowBlock, ledRing, piers, storefront, type Facade, type Wall } from './facade';
import { finishWalls, type Levels } from './structure';
import { makeInfo, signFor } from './buildings';

export function buildLandmark(ctx: GenContext, def: BuildingDef): BuildingInfo {
  const rng = new Rng(hash32(def.id * 7919 + 101));
  const f = new Frame(ctx, def.rect, def.door, def.id);
  const chrysler = def.key === 'chrysler';
  const { W, D } = f;
  const st: Facade = { ...FACADE_DEFAULT, wall: M.LIMESTONE, wallSide: M.LIMESTONE, trim: chrysler ? M.CHROME : M.GOLD, lit: 0.65, cool: true, winW: 3, winH: 9, winSpacing: 6 };
  const lobby: Levels = { floorTop: 1, ceil: 24 };
  const top = Math.min(Math.round((def.height ?? 60) * 4), 250);
  f.fill(0, 0, 0, W, 1, D, M.GRANITE);
  f.fill(2, 0, 2, W - 2, 1, D - 2, M.MARBLE_BLACK);
  // gradins successifs
  const tiers = chrysler
    ? [
        { inset: 0, to: 26 },
        { inset: 2, to: 120 },
        { inset: 6, to: 190 },
        { inset: 10, to: top },
      ]
    : [
        { inset: 0, to: 26 },
        { inset: 3, to: 110 },
        { inset: 7, to: 170 },
        { inset: 11, to: top },
      ];
  let from = 1;
  for (const t of tiers) {
    const x0 = t.inset;
    const z0 = Math.min(t.inset, Math.floor(D / 2) - 4);
    const x1 = W - t.inset;
    const z1 = D - z0;
    hollowBlock(f, x0, z0, x1, z1, from, t.to, st.wall, M.LIMESTONE);
    // vitrages verticaux entre piliers
    for (let x = x0 + 3; x < x1 - 3; x += 5) {
      for (let y = from + 3; y < t.to - 3; y++) {
        const lit = ((x * 7 + Math.floor(y / 14) * 13) % 10) < 6;
        if (y % 14 > 10) continue;
        f.set(x, y, z0, lit ? M.GLASS_COOL : M.GLASS);
        f.set(x + 1, y, z0, lit ? M.GLASS_COOL : M.GLASS);
        f.set(x, y, z1 - 1, lit ? M.GLASS_COOL : M.GLASS);
        f.set(x + 1, y, z1 - 1, lit ? M.GLASS_COOL : M.GLASS);
      }
    }
    ledRing(f, x0, z0, x1, z1, t.to - 1, chrysler ? M.LED_WHITE : M.LED_GOLD);
    from = t.to;
  }
  for (const w of ['front', 'back'] as Wall[]) piers(f, w, st, 26, 110, M.LIMESTONE);
  // sommet
  const cx = Math.round(W / 2);
  const cz = Math.round(D / 2);
  if (chrysler) {
    // couronne d'arcs d'acier et de fenêtres triangulaires
    for (let k = 0; k < 6; k++) {
      const r = 10 - k * 1.6;
      const y = top - 26 + k * 4;
      for (let a = 0; a < 48; a++) {
        const ang = (a / 48) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(ang) * r);
        const z = Math.round(cz + Math.sin(ang) * r * 0.7);
        f.fill(x, y, z, x + 1, y + 4, z + 1, a % 4 === 0 ? M.LED_WHITE : M.CHROME);
      }
    }
  } else {
    // mât de l'Empire State (prolongé en arrière-plan)
    f.fill(cx - 3, top - 20, cz - 3, cx + 3, top - 6, cz + 3, M.LIMESTONE);
    f.fill(cx - 1, top - 6, cz - 1, cx + 1, top, cz + 1, M.STEEL);
    ledRing(f, cx - 3, cz - 3, cx + 3, cz + 3, top - 12, M.NEON_PURPLE);
  }
  // hall art déco visitable
  const doorW = 6;
  const doorLx = Math.round(W / 2 - doorW / 2);
  storefront(f, lobby, doorLx, doorW, { frame: st.trim, band: M.GRANITE_DARK, glass: M.GLASS_SHOP, height: 16 });
  entrance(f, lobby, doorLx, doorW, 12, M.GOLD, M.GRANITE, M.GRANITE_DARK);
  f.fill(2, lobby.ceil, 2, W - 2, lobby.ceil + 2, D - 2, M.LIMESTONE);
  finishWalls(f, lobby, 2, 2, W - 2, D - 2, M.MARBLE, M.GRANITE_DARK);
  f.fill(doorLx, lobby.floorTop, 0, doorLx + doorW, lobby.floorTop + 12, 2, 0);
  const fu = new Furnisher(f, lobby, rng);
  fu.reserve(doorLx - 3, 0, doorLx + doorW + 3, 10);
  const hall: Room = { kind: 'landmark_lobby', floor: 0, x0: 2, z0: 2, x1: W - 2, z1: D - 2 };
  fu.p('RECEPTION_DESK', W / 2, D - 8, Math.PI);
  for (const x of [W / 2 - 10, W / 2 + 10]) fu.column(x, D / 2, 3, M.MARBLE_BLACK, M.GOLD);
  fu.lights(hall, 'CHANDELIER', 14);
  fu.art(hall, 2, ['WALL_ART'], 9);
  f.prop('DOOR_LEAF', doorLx + doorW / 2, lobby.floorTop, 1.5, 0, 0);
  const info = makeInfo(ctx, def, f, [lobby], [hall], doorLx, doorW, fu, null, top);
  info.sign = signFor(f, lobby.floorTop + 18, doorLx, doorW);
  info.zone = [{ rect: f.rectM(2, 2, W - 2, D - 2), y0: VOXEL - 0.6, y1: lobby.ceil * VOXEL }];
  return info;
}
