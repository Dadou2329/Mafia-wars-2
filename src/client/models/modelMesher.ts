// Maillage glouton d'un VoxelModel → BufferGeometry (positions en mètres par rapport à
// l'origine du modèle, couleurs sRGB, emplacement spécial, occlusion ambiante).

import * as THREE from 'three';
import { SLOT_INDEX, VoxelModel } from './voxelModel';

let sharedIndex: THREE.BufferAttribute | null = null;
let sharedQuads = 0;
export function quadIndex(quads: number): THREE.BufferAttribute {
  if (sharedIndex && sharedQuads >= quads) return sharedIndex;
  const n = Math.max(quads, sharedQuads * 2, 16384);
  const arr = new Uint32Array(n * 6);
  for (let q = 0; q < n; q++) {
    const b = q * 4;
    const i = q * 6;
    arr[i] = b;
    arr[i + 1] = b + 1;
    arr[i + 2] = b + 2;
    arr[i + 3] = b;
    arr[i + 4] = b + 2;
    arr[i + 5] = b + 3;
  }
  sharedIndex = new THREE.BufferAttribute(arr, 1);
  sharedQuads = n;
  return sharedIndex;
}

const AX = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
];

export interface MeshOptions {
  /** Facteur d'échelle supplémentaire. */
  scale?: number;
  /** Ne pas fusionner (utile pour garder la variation par voxel). */
  noMerge?: boolean;
}

export function meshModel(m: VoxelModel, opts: MeshOptions = {}): THREE.BufferGeometry {
  const { sx, sy, sz } = m;
  const dims = [sx, sy, sz];
  const data = m.data;
  const at = (x: number, y: number, z: number): number => {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
    return data[(y * sz + z) * sx + x];
  };
  // couleurs → index de palette compact
  const colorIndex = new Map<number, number>();
  const colors: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v !== 0 && !colorIndex.has(v)) {
      colorIndex.set(v, colors.length);
      colors.push(v - 1);
    }
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const ext: number[] = [];
  const res = m.res * (opts.scale ?? 1);
  const ox = m.ox;
  const oy = m.oy;
  const oz = m.oz;
  const p = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const u = AX[a][1];
    const w = AX[a][2];
    const da = dims[a];
    const du = dims[u];
    const dw = dims[w];
    const mask = new Int32Array(du * dw);
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let k = 0; k < da; k++) {
        let any = false;
        for (let j = 0; j < dw; j++) {
          for (let i = 0; i < du; i++) {
            p[a] = k;
            p[u] = i;
            p[w] = j;
            const v = at(p[0], p[1], p[2]);
            let key = 0;
            if (v !== 0) {
              const q = [p[0], p[1], p[2]];
              q[a] += dir;
              if (at(q[0], q[1], q[2]) === 0) {
                const occ = (du_: number, dw_: number): number => {
                  const r = [q[0], q[1], q[2]];
                  r[u] += du_;
                  r[w] += dw_;
                  return at(r[0], r[1], r[2]) !== 0 ? 1 : 0;
                };
                const s1m = occ(-1, 0);
                const s1p = occ(1, 0);
                const s2m = occ(0, -1);
                const s2p = occ(0, 1);
                const ao0 = s1m && s2m ? 0 : 3 - (s1m + s2m + occ(-1, -1));
                const ao1 = s1p && s2m ? 0 : 3 - (s1p + s2m + occ(1, -1));
                const ao2 = s1p && s2p ? 0 : 3 - (s1p + s2p + occ(1, 1));
                const ao3 = s1m && s2p ? 0 : 3 - (s1m + s2p + occ(-1, 1));
                key = ((colorIndex.get(v)! << 8) | (ao0 << 6) | (ao1 << 4) | (ao2 << 2) | ao3) + 1;
                any = true;
              }
            }
            mask[j * du + i] = key;
          }
        }
        if (!any) continue;
        const plane = k + (dir > 0 ? 1 : 0);
        for (let j = 0; j < dw; j++) {
          for (let i = 0; i < du; ) {
            const key = mask[j * du + i];
            if (key === 0) {
              i++;
              continue;
            }
            const raw = key - 1;
            const ao0 = (raw >> 6) & 3;
            const ao1 = (raw >> 4) & 3;
            const ao2 = (raw >> 2) & 3;
            const ao3 = raw & 3;
            const uniform = ao0 === ao1 && ao1 === ao2 && ao2 === ao3 && !opts.noMerge;
            let wd = 1;
            let ht = 1;
            if (uniform) {
              while (i + wd < du && mask[j * du + i + wd] === key) wd++;
              outer: while (j + ht < dw) {
                for (let t = 0; t < wd; t++) if (mask[(j + ht) * du + i + t] !== key) break outer;
                ht++;
              }
            }
            for (let jj = 0; jj < ht; jj++) for (let ii = 0; ii < wd; ii++) mask[(j + jj) * du + i + ii] = 0;
            const corners =
              dir > 0
                ? [
                    [i, j],
                    [i + wd, j],
                    [i + wd, j + ht],
                    [i, j + ht],
                  ]
                : [
                    [i, j],
                    [i, j + ht],
                    [i + wd, j + ht],
                    [i + wd, j],
                  ];
            const aoc = dir > 0 ? [ao0, ao1, ao2, ao3] : [ao0, ao3, ao2, ao1];
            const flip = aoc[0] + aoc[2] < aoc[1] + aoc[3];
            const order = flip ? [1, 2, 3, 0] : [0, 1, 2, 3];
            const c = colors[raw >> 8];
            const slot = c >= 0xf00000 ? SLOT_INDEX[c] ?? 0 : 0;
            const cr = slot ? 255 : (c >> 16) & 255;
            const cg = slot ? 255 : (c >> 8) & 255;
            const cb = slot ? 255 : c & 255;
            for (const s of order) {
              const v = [0, 0, 0];
              v[a] = plane;
              v[u] = corners[s][0];
              v[w] = corners[s][1];
              pos.push((v[0] - ox) * res, (v[1] - oy) * res, (v[2] - oz) * res);
              const nn = [0, 0, 0];
              nn[a] = dir * 127;
              nrm.push(nn[0], nn[1], nn[2]);
              col.push(cr, cg, cb);
              ext.push(slot, aoc[s]);
            }
            i += wd;
          }
        }
      }
    }
  }
  const quads = pos.length / 12;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(nrm), 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true));
  geo.setAttribute('aExt', new THREE.BufferAttribute(new Uint8Array(ext), 2));
  geo.setIndex(quadIndex(quads));
  geo.setDrawRange(0, quads * 6);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  geo.userData.quads = quads;
  return geo;
}

/** Réduit la résolution d'un modèle d'un facteur 2 (pour les niveaux de détail). */
export function downsample(m: VoxelModel): VoxelModel {
  const r = new VoxelModel(Math.ceil(m.sx / 2), Math.ceil(m.sy / 2), Math.ceil(m.sz / 2), m.res * 2);
  r.setOrigin(m.ox / 2, m.oy / 2, m.oz / 2);
  for (let y = 0; y < r.sy; y++)
    for (let z = 0; z < r.sz; z++)
      for (let x = 0; x < r.sx; x++) {
        const counts = new Map<number, number>();
        let filled = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dz = 0; dz < 2; dz++)
            for (let dx = 0; dx < 2; dx++) {
              const v = m.get(x * 2 + dx, y * 2 + dy, z * 2 + dz);
              if (v >= 0) {
                filled++;
                counts.set(v, (counts.get(v) ?? 0) + 1);
              }
            }
        if (filled >= 3) {
          let best = -1;
          let bc = 0;
          for (const [c, n] of counts) if (n > bc) [best, bc] = [c, n];
          r.set(x, y, z, best);
        }
      }
  return r;
}
