// Garde-fou d'accessibilité : après l'ameublement d'un bâtiment, on vérifie à chaque étage que
// tout l'espace libre forme une seule zone praticable. Si des chaises ou des tables enferment
// une poche (une rangée de tables de mah-jong trop serrée, par exemple), on retire le plus petit
// objet qui la sépare du reste, jusqu'à ce que tout soit relié.

import { M } from '../../materials';
import { GROUND_VY, INV_VOXEL } from '../../voxel';
import { PROP_DEFS, PROP_KINDS, type PropDef } from '../props';
import type { BuildingInfo, GenContext, PropPlacement } from './context';

/** Encombrement au sol d'un accessoire (voxels monde), comme dans GenContext.prop. */
function propBox(p: PropPlacement): { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number } | null {
  const def = PROP_DEFS[PROP_KINDS[p.kind]] as PropDef;
  if (def.collide === 'none') return null;
  const s = p.scale ?? 1;
  const q = Math.round(p.yaw / (Math.PI / 2)) & 3;
  const w = (q & 1 ? def.size[2] : def.size[0]) * s;
  const d = (q & 1 ? def.size[0] : def.size[2]) * s;
  const h = (def.collideH ?? def.size[1]) * s;
  const x0 = Math.round((p.x - w / 2 + 0.06) * INV_VOXEL);
  const x1 = Math.round((p.x + w / 2 - 0.06) * INV_VOXEL);
  const z0 = Math.round((p.z - d / 2 + 0.06) * INV_VOXEL);
  const z1 = Math.round((p.z + d / 2 - 0.06) * INV_VOXEL);
  const y0 = Math.round(p.y * INV_VOXEL) + GROUND_VY;
  return { x0: Math.min(x0, x1 - 1), z0: Math.min(z0, z1 - 1), x1: Math.max(x1, x0 + 1), z1: Math.max(z1, z0 + 1), y0, y1: y0 + Math.max(1, Math.round(h * INV_VOXEL)) };
}

export function repairConnectivity(ctx: GenContext, info: BuildingInfo, propsFrom: number): number {
  const world = ctx.world;
  const fp = info.footprint;
  const X0 = Math.round(fp[0] * INV_VOXEL);
  const Z0 = Math.round(fp[1] * INV_VOXEL);
  const X1 = Math.round(fp[2] * INV_VOXEL);
  const Z1 = Math.round(fp[3] * INV_VOXEL);
  const W = X1 - X0;
  const D = Z1 - Z0;
  let removed = 0;
  for (const floor of info.floors) {
    const vy = Math.round(floor.y * INV_VOXEL) + GROUND_VY;
    const head = Math.min(6, Math.round((floor.ceil - floor.y) * INV_VOXEL) - 1);
    for (let iter = 0; iter < 60; iter++) {
      // cases libres (un personnage tient debout dans un bloc 2×2)
      const free = new Uint8Array(W * D);
      for (let z = 0; z < D; z++)
        for (let x = 0; x < W; x++) {
          const wx = X0 + x;
          const wz = Z0 + z;
          if (world.get(wx, vy - 1, wz) === 0) continue;
          let ok = true;
          for (let y = 0; y < head && ok; y++) if (world.get(wx, vy + y, wz) !== 0) ok = false;
          if (ok) free[z * W + x] = 1;
        }
      const pass = new Uint8Array(W * D);
      for (let z = 0; z < D - 1; z++)
        for (let x = 0; x < W - 1; x++) if (free[z * W + x] && free[z * W + x + 1] && free[(z + 1) * W + x] && free[(z + 1) * W + x + 1]) pass[z * W + x] = 1;
      // composantes connexes
      const comp = new Int32Array(W * D).fill(-1);
      const sizes: number[] = [];
      const stack: number[] = [];
      for (let i = 0; i < W * D; i++) {
        if (!pass[i] || comp[i] >= 0) continue;
        const c = sizes.length;
        let n = 0;
        comp[i] = c;
        stack.push(i);
        while (stack.length) {
          const k = stack.pop()!;
          n++;
          const x = k % W;
          const z = (k - x) / W;
          const nb = [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, z > 0 ? k - W : -1, z < D - 1 ? k + W : -1];
          for (const j of nb) {
            if (j >= 0 && pass[j] && comp[j] < 0) {
              comp[j] = c;
              stack.push(j);
            }
          }
        }
        sizes.push(n);
      }
      if (sizes.length <= 1) break;
      // la zone principale est la plus grande ; les poches assez grandes pour qu'on s'y tienne sont à relier
      let main = 0;
      for (let c = 1; c < sizes.length; c++) if (sizes[c] > sizes[main]) main = c;
      const pockets = new Set<number>();
      for (let c = 0; c < sizes.length; c++) if (c !== main && sizes[c] >= 10) pockets.add(c);
      if (pockets.size === 0) break;
      // objets qui touchent à la fois une poche et la zone principale : on retire le plus petit
      let best = -1;
      let bestArea = Infinity;
      for (let i = propsFrom; i < ctx.props.length; i++) {
        const p = ctx.props[i];
        if (p.building !== info.id) continue;
        const b = propBox(p);
        if (!b || b.y0 > vy + 2 || b.y1 <= vy) continue;
        if (b.x1 <= X0 || b.x0 >= X1 || b.z1 <= Z0 || b.z0 >= Z1) continue;
        let touchMain = false;
        let touchPocket = false;
        for (let z = b.z0 - 2; z <= b.z1 + 1 && !(touchMain && touchPocket); z++)
          for (let x = b.x0 - 2; x <= b.x1 + 1; x++) {
            const lx = x - X0;
            const lz = z - Z0;
            if (lx < 0 || lz < 0 || lx >= W || lz >= D) continue;
            const c = comp[lz * W + lx];
            if (c === main) touchMain = true;
            else if (pockets.has(c)) touchPocket = true;
          }
        if (!touchMain || !touchPocket) continue;
        const area = (b.x1 - b.x0) * (b.z1 - b.z0);
        if (area < bestArea) {
          bestArea = area;
          best = i;
        }
      }
      if (best < 0) break;
      const b = propBox(ctx.props[best])!;
      for (let y = b.y0; y < b.y1; y++)
        for (let z = b.z0; z < b.z1; z++)
          for (let x = b.x0; x < b.x1; x++) {
            const m = world.get(x, y, z);
            if (m === M.COVER || m === M.COLLIDE) world.set(x, y, z, 0);
          }
      ctx.props.splice(best, 1);
      removed++;
    }
  }
  return removed;
}
