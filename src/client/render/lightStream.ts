// Éclairage en continu côté rendu : une fenêtre fine (cellules de 0,5 m, 128 m de côté) suit la
// caméra dans une texture 3D torique ; au-delà, le volume grossier de toute la ville (cellules de
// 1 m). Les tuiles arrivent du worker d'éclairage et sont téléversées par petits morceaux.

import * as THREE from 'three';
import { GROUND_VY, VOXEL } from '../../shared/voxel';
import type { LightFeed } from '../world/lightFeed';
import { envUniforms } from './env';
import { LIGHT_TILE, tileSize, type LightDims } from './lightService';

const CELL = 0.5;
const TILE_M = LIGHT_TILE * CELL;
/** Fenêtre fine : tuiles par côté (8 × 16 m = 128 m). */
const WIN_TILES = 8;
/** Téléversements au plus par image. */
const MAX_FINE_PER_FRAME = 4;
const MAX_COARSE_PER_FRAME = 32;

function volume(data: Uint8Array, w: number, h: number, d: number, repeat: boolean): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(data, w, h, d);
  t.format = THREE.RGFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapR = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class LightStream {
  private dims: LightDims;
  private wtx: number;
  private wtz: number;
  private win: THREE.Data3DTexture;
  private coarseTex: THREE.Data3DTexture;
  /** Même tableau que coarseTex, jamais téléversé : source des mises à jour partielles. */
  private coarseSrc: THREE.Data3DTexture;
  /** Tuile présente dans chaque case de la fenêtre (−1 : aucune). */
  private slots: Int32Array;
  private ox = -1;
  private oz = -1;
  private queue: { t: number; fine: Uint8Array }[] = [];
  private coarseQueue: number[] = [];
  private box = new THREE.Box3();
  private dst = new THREE.Vector3();

  constructor(
    private feed: LightFeed,
    private renderer: THREE.WebGLRenderer,
  ) {
    const d = (this.dims = feed.dims);
    this.wtx = Math.min(WIN_TILES, d.tx);
    this.wtz = Math.min(WIN_TILES, d.tz);
    const wx = this.wtx * LIGHT_TILE;
    const wz = this.wtz * LIGHT_TILE;
    this.win = volume(new Uint8Array(wx * d.ny * wz * 2), wx, d.ny, wz, true);
    this.coarseTex = volume(feed.coarse, d.cnx, d.cny, d.cnz, false);
    this.coarseSrc = volume(feed.coarse, d.cnx, d.cny, d.cnz, false);
    this.slots = new Int32Array(this.wtx * this.wtz).fill(-1);
    envUniforms.uLightTex.value = this.win;
    envUniforms.uLightOrigin.value.set(0, -GROUND_VY * VOXEL, 0);
    envUniforms.uLightSize.value.set(wx * CELL, d.ny * CELL, wz * CELL);
    envUniforms.uLightCoarse.value = this.coarseTex;
    envUniforms.uLightCoarseSize.value.set(d.cnx * CELL * 2, d.cny * CELL * 2, d.cnz * CELL * 2);
    envUniforms.uLightWin.value.set(0, 0, 0, 0);
    // la texture grossière part entière au premier rendu : les mises à jour en attente sont incluses
    feed.takeCoarse();
    feed.onTile = (t, fine) => this.queue.push({ t, fine });
  }

  private slotOf(tx: number, tz: number): number {
    return (tz % this.wtz) * this.wtx + (tx % this.wtx);
  }

  private loaded(tx: number, tz: number): boolean {
    if (tx < this.ox || tz < this.oz || tx >= this.ox + this.wtx || tz >= this.oz + this.wtz) return false;
    return this.slots[this.slotOf(tx, tz)] === tz * this.dims.tx + tx;
  }

  /** À chaque image : déplace la fenêtre, téléverse ce qui est arrivé, met à jour le rectangle valable. */
  update(camX: number, camZ: number): void {
    const d = this.dims;
    const ctx = Math.min(d.tx - 1, Math.max(0, Math.floor(camX / TILE_M)));
    const ctz = Math.min(d.tz - 1, Math.max(0, Math.floor(camZ / TILE_M)));
    const ox = Math.min(d.tx - this.wtx, Math.max(0, ctx - (this.wtx >> 1)));
    const oz = Math.min(d.tz - this.wtz, Math.max(0, ctz - (this.wtz >> 1)));
    if (ox !== this.ox || oz !== this.oz) {
      this.ox = ox;
      this.oz = oz;
      // tuiles manquantes de la nouvelle fenêtre, les plus proches de la caméra d'abord
      const miss: { t: number; d: number }[] = [];
      for (let tz = oz; tz < oz + this.wtz; tz++)
        for (let tx = ox; tx < ox + this.wtx; tx++) {
          if (this.loaded(tx, tz)) continue;
          miss.push({ t: tz * d.tx + tx, d: Math.hypot((tx + 0.5) * TILE_M - camX, (tz + 0.5) * TILE_M - camZ) });
        }
      miss.sort((a, b) => a.d - b.d);
      this.feed.want(
        miss.map((m) => m.t),
        camX,
        camZ,
      );
    }
    this.feed.pump();
    // tuiles fines reçues
    let n = 0;
    while (this.queue.length > 0 && n < MAX_FINE_PER_FRAME) {
      const { t, fine } = this.queue.shift()!;
      const tx = t % d.tx;
      const tz = (t - tx) / d.tx;
      if (tx < this.ox || tz < this.oz || tx >= this.ox + this.wtx || tz >= this.oz + this.wtz) continue;
      const [w, dz] = tileSize(d, t);
      const src = volume(fine, w, d.ny, dz, false);
      this.dst.set((tx % this.wtx) * LIGHT_TILE, 0, (tz % this.wtz) * LIGHT_TILE);
      this.upload(src, this.win, null);
      this.slots[this.slotOf(tx, tz)] = t;
      n++;
    }
    // volume grossier
    for (const t of this.feed.takeCoarse()) this.coarseQueue.push(t);
    for (let k = 0; k < MAX_COARSE_PER_FRAME && this.coarseQueue.length > 0; k++) {
      const t = this.coarseQueue.shift()!;
      const tx = t % d.tx;
      const tz = (t - tx) / d.tx;
      const [w, dz] = tileSize(d, t);
      const ci = (tx * LIGHT_TILE) / 2;
      const ck = (tz * LIGHT_TILE) / 2;
      this.box.min.set(ci, 0, ck);
      this.box.max.set(ci + Math.ceil(w / 2), d.cny, ck + Math.ceil(dz / 2));
      this.dst.set(ci, 0, ck);
      this.upload(this.coarseSrc, this.coarseTex, this.box);
    }
    // plus grand rectangle de tuiles chargées autour de la caméra
    if (!this.loaded(ctx, ctz)) {
      envUniforms.uLightWin.value.set(0, 0, 0, 0);
      return;
    }
    let x0 = ctx;
    let x1 = ctx + 1;
    let z0 = ctz;
    let z1 = ctz + 1;
    const col = (tx: number): boolean => {
      for (let tz = z0; tz < z1; tz++) if (!this.loaded(tx, tz)) return false;
      return true;
    };
    const row = (tz: number): boolean => {
      for (let tx = x0; tx < x1; tx++) if (!this.loaded(tx, tz)) return false;
      return true;
    };
    for (let grew = true; grew; ) {
      grew = false;
      if (col(x0 - 1)) {
        x0--;
        grew = true;
      }
      if (col(x1)) {
        x1++;
        grew = true;
      }
      if (row(z0 - 1)) {
        z0--;
        grew = true;
      }
      if (row(z1)) {
        z1++;
        grew = true;
      }
    }
    envUniforms.uLightWin.value.set(x0 * TILE_M, z0 * TILE_M, Math.min(x1 * TILE_M, d.nx * CELL), Math.min(z1 * TILE_M, d.nz * CELL));
  }

  /**
   * Téléversement partiel. three.js lie la texture à l'unité 0 sans la rendre active si elle y est
   * déjà liée : on active l'unité 0 d'abord, sinon texSubImage3D viserait une autre unité.
   */
  private upload(src: THREE.Data3DTexture, dst: THREE.Data3DTexture, box: THREE.Box3 | null): void {
    const gl = this.renderer.getContext();
    this.renderer.state.activeTexture(gl.TEXTURE0);
    this.renderer.copyTextureToTexture(src, dst, box, this.dst);
  }

  dispose(): void {
    if (this.feed.onTile) this.feed.onTile = null;
    this.win.dispose();
    this.coarseTex.dispose();
  }
}
