// Maillage glouton (greedy meshing) des tronçons voxel avec occlusion ambiante par sommet.
// Sortie : positions en coordonnées voxel absolues (Int16), normales (Int8), et un attribut
// aData = [ao (0..3), matériau]. Les quads n'utilisent pas d'index propres : on émet les
// sommets dans un ordre qui permet un tampon d'index partagé (0,1,2 / 0,2,3).

import { MAT_VISIBLE } from '../../shared/materials';
import { CHUNK, type VoxelWorld } from '../../shared/voxel';

const P = CHUNK + 2; // tronçon avec bordure
const P2 = P * P;

export class MeshBuffers {
  pos: Int16Array;
  nrm: Int8Array;
  dat: Uint8Array;
  quads = 0;
  constructor(cap = 4096) {
    this.pos = new Int16Array(cap * 12);
    this.nrm = new Int8Array(cap * 12);
    this.dat = new Uint8Array(cap * 8);
  }
  private grow(): void {
    const cap = (this.pos.length / 12) * 2;
    const pos = new Int16Array(cap * 12);
    pos.set(this.pos);
    const nrm = new Int8Array(cap * 12);
    nrm.set(this.nrm);
    const dat = new Uint8Array(cap * 8);
    dat.set(this.dat);
    this.pos = pos;
    this.nrm = nrm;
    this.dat = dat;
  }
  /** Ajoute un quad : 4 sommets (x,y,z) déjà ordonnés, normale, ao par sommet, matériau. */
  quad(
    v: number[], // 12 valeurs
    nx: number,
    ny: number,
    nz: number,
    ao0: number,
    ao1: number,
    ao2: number,
    ao3: number,
    mat: number,
  ): void {
    if ((this.quads + 1) * 12 > this.pos.length) this.grow();
    const q = this.quads++;
    const p = q * 12;
    // inversion de diagonale pour une interpolation d'AO correcte
    const flip = ao0 + ao2 < ao1 + ao3;
    const order = flip ? [1, 2, 3, 0] : [0, 1, 2, 3];
    const aos = [ao0, ao1, ao2, ao3];
    for (let k = 0; k < 4; k++) {
      const s = order[k];
      this.pos[p + k * 3] = v[s * 3];
      this.pos[p + k * 3 + 1] = v[s * 3 + 1];
      this.pos[p + k * 3 + 2] = v[s * 3 + 2];
      this.nrm[p + k * 3] = nx * 127;
      this.nrm[p + k * 3 + 1] = ny * 127;
      this.nrm[p + k * 3 + 2] = nz * 127;
      this.dat[q * 8 + k * 2] = aos[s];
      this.dat[q * 8 + k * 2 + 1] = mat;
    }
  }
}

const pad = new Uint8Array(P * P * P);
const mask = new Int32Array(CHUNK * CHUNK);

/** Copie le tronçon (cx,cy,cz) et sa bordure d'un voxel dans `pad`. */
function fillPad(world: VoxelWorld, cx: number, cy: number, cz: number): boolean {
  const ox = cx * CHUNK - 1;
  const oy = cy * CHUNK - 1;
  const oz = cz * CHUNK - 1;
  const chunk = world.getChunk(cx, cy, cz);
  let any = false;
  for (let y = 0; y < P; y++) {
    const wy = oy + y;
    for (let z = 0; z < P; z++) {
      const wz = oz + z;
      const row = y * P2 + z * P;
      const inner = chunk !== null && y > 0 && y < P - 1 && z > 0 && z < P - 1;
      for (let x = 0; x < P; x++) {
        let m: number;
        if (inner && x > 0 && x < P - 1) {
          m = chunk![((y - 1) << 10) | ((z - 1) << 5) | (x - 1)];
          if (m !== 0) any = true;
        } else if (wy < 0) m = 1;
        else m = world.get(ox + x, wy, wz);
        pad[row + x] = m;
      }
    }
  }
  return any;
}

// axes : pour chaque axe a, (u, v) tels que u × v = a
const AX = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
];
const STRIDE = [1, P2, P]; // x, y, z dans pad

export function meshChunk(world: VoxelWorld, cx: number, cy: number, cz: number, out: MeshBuffers): void {
  if (world.getChunk(cx, cy, cz) === null) return;
  if (!fillPad(world, cx, cy, cz)) return;
  const base = [cx * CHUNK, cy * CHUNK, cz * CHUNK];
  const v = new Array<number>(12);
  for (let a = 0; a < 3; a++) {
    const u = AX[a][1];
    const w = AX[a][2];
    const sa = STRIDE[a];
    const su = STRIDE[u];
    const sw = STRIDE[w];
    for (let dir = -1; dir <= 1; dir += 2) {
      const nOff = sa * dir;
      for (let k = 0; k < CHUNK; k++) {
        // construction du masque de la tranche k
        let anyFace = false;
        for (let j = 0; j < CHUNK; j++) {
          for (let i = 0; i < CHUNK; i++) {
            // index dans pad de la cellule (a=k, u=i, w=j)
            const pi = (k + 1) * sa + (i + 1) * su + (j + 1) * sw;
            const m = pad[pi];
            let key = 0;
            if (m !== 0 && MAT_VISIBLE[m] === 1) {
              const q = pi + nOff;
              if (MAT_VISIBLE[pad[q]] === 0) {
                // AO : voisins dans la couche q
                const s1m = MAT_VISIBLE[pad[q - su]];
                const s1p = MAT_VISIBLE[pad[q + su]];
                const s2m = MAT_VISIBLE[pad[q - sw]];
                const s2p = MAT_VISIBLE[pad[q + sw]];
                const cmm = MAT_VISIBLE[pad[q - su - sw]];
                const cpm = MAT_VISIBLE[pad[q + su - sw]];
                const cpp = MAT_VISIBLE[pad[q + su + sw]];
                const cmp = MAT_VISIBLE[pad[q - su + sw]];
                const ao0 = s1m && s2m ? 0 : 3 - (s1m + s2m + cmm);
                const ao1 = s1p && s2m ? 0 : 3 - (s1p + s2m + cpm);
                const ao2 = s1p && s2p ? 0 : 3 - (s1p + s2p + cpp);
                const ao3 = s1m && s2p ? 0 : 3 - (s1m + s2p + cmp);
                key = (m | (ao0 << 8) | (ao1 << 10) | (ao2 << 12) | (ao3 << 14)) + 1;
                anyFace = true;
              }
            }
            mask[j * CHUNK + i] = key;
          }
        }
        if (!anyFace) continue;
        // fusion gloutonne
        const plane = base[a] + k + (dir > 0 ? 1 : 0);
        for (let j = 0; j < CHUNK; j++) {
          for (let i = 0; i < CHUNK; ) {
            const key = mask[j * CHUNK + i];
            if (key === 0) {
              i++;
              continue;
            }
            const raw = key - 1;
            const ao0 = (raw >> 8) & 3;
            const ao1 = (raw >> 10) & 3;
            const ao2 = (raw >> 12) & 3;
            const ao3 = (raw >> 14) & 3;
            const uniform = ao0 === ao1 && ao1 === ao2 && ao2 === ao3;
            let wd = 1;
            let ht = 1;
            if (uniform) {
              while (i + wd < CHUNK && mask[j * CHUNK + i + wd] === key) wd++;
              outer: while (j + ht < CHUNK) {
                for (let t = 0; t < wd; t++) if (mask[(j + ht) * CHUNK + i + t] !== key) break outer;
                ht++;
              }
            }
            for (let jj = 0; jj < ht; jj++) for (let ii = 0; ii < wd; ii++) mask[(j + jj) * CHUNK + i + ii] = 0;
            const u0 = base[u] + i;
            const u1 = u0 + wd;
            const w0 = base[w] + j;
            const w1 = w0 + ht;
            // sommets (u,w) : (u0,w0) (u1,w0) (u1,w1) (u0,w1) — sens direct vu depuis +a
            const corners =
              dir > 0
                ? [
                    [u0, w0],
                    [u1, w0],
                    [u1, w1],
                    [u0, w1],
                  ]
                : [
                    [u0, w0],
                    [u0, w1],
                    [u1, w1],
                    [u1, w0],
                  ];
            const aoc = dir > 0 ? [ao0, ao1, ao2, ao3] : [ao0, ao3, ao2, ao1];
            for (let c = 0; c < 4; c++) {
              const pos = [0, 0, 0];
              pos[a] = plane;
              pos[u] = corners[c][0];
              pos[w] = corners[c][1];
              v[c * 3] = pos[0];
              v[c * 3 + 1] = pos[1];
              v[c * 3 + 2] = pos[2];
            }
            const n = [0, 0, 0];
            n[a] = dir;
            out.quad(v, n[0], n[1], n[2], aoc[0], aoc[1], aoc[2], aoc[3], raw & 255);
            i += wd;
          }
        }
      }
    }
  }
}
