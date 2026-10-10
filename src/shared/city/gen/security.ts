// Sécurité des bâtiments protégés : terminal piratable près de l'entrée, caméras au-dessus de
// la porte. (Les tourelles sont des entités du serveur, placées aux points de défense.)

import { MAT_SOLID } from '../../materials';
import { GROUND_VY, INV_VOXEL } from '../../voxel';
import type { BuildingInfo, GenContext } from './context';

export function placeSecurity(ctx: GenContext, info: BuildingInfo): void {
  const door = info.doors[0];
  const dx = door.in.x - door.out.x;
  const dz = door.in.z - door.out.z;
  const l = Math.hypot(dx, dz) || 1;
  const ix = dx / l;
  const iz = dz / l;
  const sx = iz;
  const sz = -ix;
  const y = door.in.y ?? info.floorY;
  const w = ctx.world;
  const free = (x: number, z: number): boolean => {
    const vx = Math.floor(x * INV_VOXEL);
    const vz = Math.floor(z * INV_VOXEL);
    const vy = Math.round(y * INV_VOXEL) + GROUND_VY;
    if (!MAT_SOLID[w.get(vx, vy - 1, vz)]) return false;
    for (let k = 0; k < 8; k++) if (w.get(vx, vy + k, vz) !== 0) return false;
    return true;
  };
  // terminal : sur le côté de l'entrée, tourné vers l'intérieur
  for (const side of [1, -1]) {
    for (const off of [1.9, 2.4, 1.6]) {
      const x = door.in.x + sx * side * off + ix * 0.4;
      const z = door.in.z + sz * side * off + iz * 0.4;
      if (!free(x, z) || !free(x + ix * 0.3, z + iz * 0.3) || !free(x - ix * 0.3, z - iz * 0.3)) continue;
      // le terminal fait face au centre de l'entrée
      const yaw = Math.atan2(-sx * side, -sz * side);
      ctx.prop('SECURITY_PANEL', x, y, z, yaw, 0, info.id);
      info.terminal = { x: x - sx * side * 0.8, z: z - sz * side * 0.8, y };
      break;
    }
    if (info.terminal) break;
  }
  if (!info.terminal) info.terminal = { x: door.in.x + ix * 0.8, z: door.in.z + iz * 0.8, y };
  // caméras : au-dessus de la porte (dehors) et dans l'entrée
  const outYaw = Math.atan2(-ix, -iz);
  ctx.prop('SECURITY_CAMERA', door.x - ix * 0.25 + sx * 1.6, y + 3.1, door.z - iz * 0.25 + sz * 1.6, outYaw, 0, info.id);
  ctx.prop('SECURITY_CAMERA', door.x + ix * 0.35 - sx * 1.6, y + 2.9, door.z + iz * 0.35 - sz * 1.6, Math.atan2(ix, iz), 0, info.id);
}
