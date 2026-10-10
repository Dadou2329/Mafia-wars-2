// Verre brisé côté client : retire les voxels de verre annoncés par le serveur, remaille les
// régions touchées et mémorise ce qui a été retiré pour tout remettre en place (revanche, retour
// au menu : le monde chargé sert pour la partie suivante).

import type * as THREE from 'three';
import { glassInSphere } from '../../shared/glass';
import type { VoxelWorld } from '../../shared/voxel';
import { REGION_VOXELS, meshRegion, regionGeometry } from '../render/worldMesh';

export class GlassBreaker {
  /** Voxels retirés : x, y, z, matériau (à plat). */
  private removed: number[] = [];

  constructor(
    private world: VoxelWorld,
    /** Maillages des régions, par clé « gx,gz ». */
    private meshes: Map<string, THREE.Mesh>,
  ) {}

  /** Brise le verre dans la sphère ; renvoie le nombre de voxels retirés. */
  apply(x: number, y: number, z: number, r: number): number {
    let n = 0;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    glassInSphere(this.world, x, y, z, r, (vx, vy, vz, m) => {
      this.world.set(vx, vy, vz, 0);
      this.removed.push(vx, vy, vz, m);
      n++;
      x0 = Math.min(x0, vx);
      z0 = Math.min(z0, vz);
      x1 = Math.max(x1, vx);
      z1 = Math.max(z1, vz);
    });
    if (n > 0) this.remesh(x0, z0, x1, z1);
    return n;
  }

  /** Remet tout le verre en place. */
  restore(): void {
    if (this.removed.length === 0) return;
    // boîte des voxels remis, par région
    const boxes = new Map<string, number[]>();
    for (let i = 0; i < this.removed.length; i += 4) {
      const vx = this.removed[i];
      const vz = this.removed[i + 2];
      this.world.set(vx, this.removed[i + 1], vz, this.removed[i + 3]);
      const key = `${Math.floor(vx / REGION_VOXELS)},${Math.floor(vz / REGION_VOXELS)}`;
      const b = boxes.get(key);
      if (!b) boxes.set(key, [vx, vz, vx, vz]);
      else {
        b[0] = Math.min(b[0], vx);
        b[1] = Math.min(b[1], vz);
        b[2] = Math.max(b[2], vx);
        b[3] = Math.max(b[3], vz);
      }
    }
    this.removed = [];
    for (const b of boxes.values()) this.remesh(b[0], b[1], b[2], b[3]);
  }

  /** Remaille les régions qui contiennent la boîte (et leurs voisines si la boîte touche un bord). */
  private remesh(x0: number, z0: number, x1: number, z1: number): void {
    const gx0 = Math.floor((x0 - 1) / REGION_VOXELS);
    const gx1 = Math.floor((x1 + 1) / REGION_VOXELS);
    const gz0 = Math.floor((z0 - 1) / REGION_VOXELS);
    const gz1 = Math.floor((z1 + 1) / REGION_VOXELS);
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gz = gz0; gz <= gz1; gz++) {
        const mesh = this.meshes.get(`${gx},${gz}`);
        if (!mesh) continue;
        const r = meshRegion(this.world, gx, gz);
        mesh.geometry.dispose();
        mesh.geometry = regionGeometry(r);
      }
  }
}
