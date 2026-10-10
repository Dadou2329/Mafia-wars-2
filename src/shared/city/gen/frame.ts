// Repère local d'un bâtiment. On dessine chaque bâtiment comme si sa façade principale
// était devant nous : lx va de gauche à droite le long de la façade, lz part de la façade
// vers le fond, ly part du niveau de la rue (couche GROUND_VY). Le repère gère les 4
// orientations possibles, ce qui permet d'écrire chaque type de bâtiment une seule fois.

import type { Side } from '../plan';
import { GROUND_VY, INV_VOXEL, VOXEL, type VoxelWorld } from '../../voxel';
import type { GenContext } from './context';
import type { PropKind } from '../props';

export class Frame {
  readonly side: Side;
  /** Empreinte en voxels (monde) : [X0, X1) × [Z0, Z1). */
  readonly X0: number;
  readonly Z0: number;
  readonly X1: number;
  readonly Z1: number;
  /** Largeur (le long de la façade) et profondeur, en voxels. */
  readonly W: number;
  readonly D: number;
  readonly world: VoxelWorld;
  readonly ctx: GenContext;
  readonly building: number;
  // vecteurs unitaires monde de lx et lz
  readonly ex: [number, number];
  readonly ez: [number, number];

  constructor(ctx: GenContext, rect: [number, number, number, number], side: Side, building = -1) {
    this.ctx = ctx;
    this.world = ctx.world;
    this.side = side;
    this.building = building;
    this.X0 = Math.round(rect[0] * INV_VOXEL);
    this.Z0 = Math.round(rect[1] * INV_VOXEL);
    this.X1 = Math.round(rect[2] * INV_VOXEL);
    this.Z1 = Math.round(rect[3] * INV_VOXEL);
    const sx = this.X1 - this.X0;
    const sz = this.Z1 - this.Z0;
    if (side === 'N' || side === 'S') {
      this.W = sx;
      this.D = sz;
    } else {
      this.W = sz;
      this.D = sx;
    }
    switch (side) {
      case 'S':
        this.ex = [1, 0];
        this.ez = [0, -1];
        break;
      case 'N':
        this.ex = [-1, 0];
        this.ez = [0, 1];
        break;
      case 'E':
        this.ex = [0, -1];
        this.ez = [-1, 0];
        break;
      case 'W':
        this.ex = [0, 1];
        this.ez = [1, 0];
        break;
    }
  }

  /** Coordonnée continue locale (voxels) → monde (voxels, continu). */
  toWorldV(lx: number, lz: number): [number, number] {
    switch (this.side) {
      case 'S':
        return [this.X0 + lx, this.Z1 - lz];
      case 'N':
        return [this.X1 - lx, this.Z0 + lz];
      case 'E':
        return [this.X1 - lz, this.Z1 - lx];
      case 'W':
        return [this.X0 + lz, this.Z0 + lx];
    }
  }

  /** Coordonnée continue locale (voxels) → monde (mètres). */
  pt(lx: number, lz: number): { x: number; z: number } {
    const [wx, wz] = this.toWorldV(lx, lz);
    return { x: wx * VOXEL, z: wz * VOXEL };
  }

  /** Cellule voxel locale → cellule monde. */
  cell(lx: number, lz: number): [number, number] {
    const [wx, wz] = this.toWorldV(lx + 0.5, lz + 0.5);
    return [Math.floor(wx), Math.floor(wz)];
  }

  /** Lacet monde à partir d'un lacet local (0 = vers +lz, c'est-à-dire vers le fond). */
  yaw(localYaw: number): number {
    const s = Math.sin(localYaw);
    const c = Math.cos(localYaw);
    const fx = s * this.ex[0] + c * this.ez[0];
    const fz = s * this.ex[1] + c * this.ez[1];
    return Math.atan2(fx, fz);
  }

  set(lx: number, ly: number, lz: number, m: number): void {
    const [wx, wz] = this.cell(lx, lz);
    this.world.set(wx, ly + GROUND_VY, wz, m);
  }

  get(lx: number, ly: number, lz: number): number {
    const [wx, wz] = this.cell(lx, lz);
    return this.world.get(wx, ly + GROUND_VY, wz);
  }

  /** Remplit la boîte locale [lx0,lx1)×[ly0,ly1)×[lz0,lz1). */
  fill(lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number, m: number): void {
    if (lx1 < lx0) [lx0, lx1] = [lx1, lx0];
    if (ly1 < ly0) [ly0, ly1] = [ly1, ly0];
    if (lz1 < lz0) [lz0, lz1] = [lz1, lz0];
    const [ax, az] = this.cell(lx0, lz0);
    const [bx, bz] = this.cell(lx1 - 1, lz1 - 1);
    this.world.fill(
      Math.min(ax, bx),
      ly0 + GROUND_VY,
      Math.min(az, bz),
      Math.max(ax, bx) + 1,
      ly1 + GROUND_VY,
      Math.max(az, bz) + 1,
      m,
    );
  }

  /** Comme fill mais seulement dans les cellules vides. */
  fillEmpty(lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number, m: number): void {
    for (let ly = ly0; ly < ly1; ly++)
      for (let lz = lz0; lz < lz1; lz++)
        for (let lx = lx0; lx < lx1; lx++) if (this.get(lx, ly, lz) === 0) this.set(lx, ly, lz, m);
  }

  /** Remplace un matériau dans une boîte locale. */
  replace(lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number, from: number, to: number): void {
    for (let ly = ly0; ly < ly1; ly++)
      for (let lz = lz0; lz < lz1; lz++)
        for (let lx = lx0; lx < lx1; lx++) if (this.get(lx, ly, lz) === from) this.set(lx, ly, lz, to);
  }

  /** Place un accessoire en coordonnées locales (voxels, continu ; ly en voxels depuis la rue). */
  prop(kind: PropKind, lx: number, ly: number, lz: number, localYaw = 0, variant = 0, scale?: number): void {
    const p = this.pt(lx, lz);
    this.ctx.prop(kind, p.x, (ly) * VOXEL, p.z, this.yaw(localYaw), variant, this.building, scale);
  }

  light(lx: number, ly: number, lz: number, intensity: number, radius: number): void {
    const p = this.pt(lx, lz);
    this.ctx.light(p.x, ly * VOXEL, p.z, intensity, radius);
  }

  /** Rectangle local (voxels) → rectangle monde (mètres) normalisé. */
  rectM(lx0: number, lz0: number, lx1: number, lz1: number): [number, number, number, number] {
    const a = this.pt(lx0, lz0);
    const b = this.pt(lx1, lz1);
    return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)];
  }
}

/** Altitude en mètres d'une couche locale ly. */
export const lyToM = (ly: number): number => ly * VOXEL;
