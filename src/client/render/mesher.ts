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
    v: ArrayLike<number>, // 12 valeurs
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
    const pos = this.pos;
    const nrm = this.nrm;
    const dat = this.dat;
    // inversion de diagonale pour une interpolation d'AO correcte
    const flip = ao0 + ao2 < ao1 + ao3;
    const n0 = nx * 127;
    const n1 = ny * 127;
    const n2 = nz * 127;
    for (let k = 0; k < 4; k++) {
      const s = flip ? (k + 1) & 3 : k;
      const o = p + k * 3;
      pos[o] = v[s * 3];
      pos[o + 1] = v[s * 3 + 1];
      pos[o + 2] = v[s * 3 + 2];
      nrm[o] = n0;
      nrm[o + 1] = n1;
      nrm[o + 2] = n2;
      dat[q * 8 + k * 2] = s === 0 ? ao0 : s === 1 ? ao1 : s === 2 ? ao2 : ao3;
      dat[q * 8 + k * 2 + 1] = mat;
    }
  }
}

const pad = new Uint8Array(P * P * P);
/** MAT_VISIBLE de chaque cellule de `pad`. */
const vis = new Uint8Array(P * P * P);
const mask = new Int32Array(CHUNK * CHUNK);
/** Voxels visibles de chaque tranche de `pad` (section intérieure 32×32), pour chaque axe. */
const sliceCount = [new Int32Array(P), new Int32Array(P), new Int32Array(P)];
const vtx = new Int32Array(12);

/** Copie le tronçon (cx,cy,cz) et sa bordure d'un voxel dans `pad` ; faux si le tronçon est vide. */
function fillPad(world: VoxelWorld, cx: number, cy: number, cz: number): boolean {
  world.copyBox(cx * CHUNK - 1, cy * CHUNK - 1, cz * CHUNK - 1, P, P, P, pad, 0, P2, P);
  // sous le monde : plein
  if (cy === 0) pad.fill(1, 0, P2);
  const VIS = MAT_VISIBLE;
  let any = false;
  for (let y = 0; y < P; y++) {
    const inY = y > 0 && y < P - 1;
    for (let z = 0; z < P; z++) {
      const row = y * P2 + z * P;
      if (inY && z > 0 && z < P - 1) {
        vis[row] = VIS[pad[row]];
        for (let x = 1; x < P - 1; x++) {
          const m = pad[row + x];
          if (m !== 0) any = true;
          vis[row + x] = VIS[m];
        }
        vis[row + P - 1] = VIS[pad[row + P - 1]];
      } else for (let x = 0; x < P; x++) vis[row + x] = VIS[pad[row + x]];
    }
  }
  return any;
}

/** Compte les voxels visibles de chaque tranche (permet de sauter les tranches sans face). */
function countSlices(): void {
  const cx = sliceCount[0];
  const cy = sliceCount[1];
  const cz = sliceCount[2];
  cx.fill(0);
  cy.fill(0);
  cz.fill(0);
  for (let y = 0; y < P; y++) {
    const yIn = y > 0 && y < P - 1;
    for (let z = 0; z < P; z++) {
      const zIn = z > 0 && z < P - 1;
      if (!yIn && !zIn) continue;
      const row = y * P2 + z * P;
      let n = 0;
      if (yIn && zIn) {
        if (vis[row]) cx[0]++;
        if (vis[row + P - 1]) cx[P - 1]++;
        for (let x = 1; x < P - 1; x++)
          if (vis[row + x]) {
            cx[x]++;
            n++;
          }
        cy[y] += n;
        cz[z] += n;
      } else {
        for (let x = 1; x < P - 1; x++) n += vis[row + x];
        if (zIn) cy[y] += n;
        else cz[z] += n;
      }
    }
  }
}

/** La bordure du tampon (voisins immédiats du tronçon) est-elle entièrement opaque ? */
function shellOpaque(): boolean {
  for (let y = 0; y < P; y++) {
    const edgeY = y === 0 || y === P - 1;
    for (let z = 0; z < P; z++) {
      const edgeZ = edgeY || z === 0 || z === P - 1;
      const row = y * P2 + z * P;
      if (edgeZ) {
        for (let x = 0; x < P; x++) if (vis[row + x] !== 1) return false;
      } else if (vis[row] !== 1 || vis[row + P - 1] !== 1) return false;
    }
  }
  return true;
}

/** Un tronçon uniforme entièrement entouré de tronçons opaques n'a aucune face visible. */
function buried(world: VoxelWorld, cx: number, cy: number, cz: number): boolean {
  const near = [
    [cx + 1, cy, cz],
    [cx - 1, cy, cz],
    [cx, cy + 1, cz],
    [cx, cy - 1, cz],
    [cx, cy, cz + 1],
    [cx, cy, cz - 1],
  ];
  for (const [x, y, z] of near) {
    if (y < 0) continue; // sous le monde : plein
    const u = world.uniformOf(x, y, z);
    if (u <= 0 || MAT_VISIBLE[u] !== 1) return false;
  }
  return true;
}

// axes : pour chaque axe a, (u, v) tels que u × v = a
const AX = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
];
const STRIDE = [1, P2, P]; // x, y, z dans pad

export function meshChunk(world: VoxelWorld, cx: number, cy: number, cz: number, out: MeshBuffers): void {
  const ci = world.chunkIndex(cx, cy, cz);
  if (world.isUniformChunk(ci)) {
    const u = world.fillMat[ci];
    if (u === 0 || MAT_VISIBLE[u] !== 1) return;
    if (buried(world, cx, cy, cz)) return;
    fillPad(world, cx, cy, cz);
    if (shellOpaque()) return;
  } else if (!fillPad(world, cx, cy, cz)) return;
  countSlices();
  const FULL = CHUNK * CHUNK;
  for (let a = 0; a < 3; a++) {
    const u = AX[a][1];
    const w = AX[a][2];
    const sa = STRIDE[a];
    const su = STRIDE[u];
    const sw = STRIDE[w];
    const cnt = sliceCount[a];
    const baseA = a === 0 ? cx * CHUNK : a === 1 ? cy * CHUNK : cz * CHUNK;
    const baseU = u === 0 ? cx * CHUNK : u === 1 ? cy * CHUNK : cz * CHUNK;
    const baseW = w === 0 ? cx * CHUNK : w === 1 ? cy * CHUNK : cz * CHUNK;
    for (let dir = -1; dir <= 1; dir += 2) {
      const nOff = sa * dir;
      const nx = a === 0 ? dir : 0;
      const ny = a === 1 ? dir : 0;
      const nz = a === 2 ? dir : 0;
      for (let k = 0; k < CHUNK; k++) {
        // pas de face : tranche vide, ou tranche voisine entièrement pleine
        if (cnt[k + 1] === 0 || cnt[k + 1 + dir] === FULL) continue;
        // construction du masque de la tranche k
        let anyFace = false;
        for (let j = 0; j < CHUNK; j++) {
          let pi = (k + 1) * sa + su + (j + 1) * sw;
          const mrow = j * CHUNK;
          for (let i = 0; i < CHUNK; i++, pi += su) {
            let key = 0;
            if (vis[pi] === 1) {
              const q = pi + nOff;
              if (vis[q] === 0) {
                // AO : voisins dans la couche q
                const s1m = vis[q - su];
                const s1p = vis[q + su];
                const s2m = vis[q - sw];
                const s2p = vis[q + sw];
                const ao0 = s1m && s2m ? 0 : 3 - (s1m + s2m + vis[q - su - sw]);
                const ao1 = s1p && s2m ? 0 : 3 - (s1p + s2m + vis[q + su - sw]);
                const ao2 = s1p && s2p ? 0 : 3 - (s1p + s2p + vis[q + su + sw]);
                const ao3 = s1m && s2p ? 0 : 3 - (s1m + s2p + vis[q - su + sw]);
                key = (pad[pi] | (ao0 << 8) | (ao1 << 10) | (ao2 << 12) | (ao3 << 14)) + 1;
                anyFace = true;
              }
            }
            mask[mrow + i] = key;
          }
        }
        if (!anyFace) continue;
        // fusion gloutonne
        const plane = baseA + k + (dir > 0 ? 1 : 0);
        vtx[a] = plane;
        vtx[3 + a] = plane;
        vtx[6 + a] = plane;
        vtx[9 + a] = plane;
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
            // fusion : dans les deux sens si l'AO est uniforme, sinon seulement le long du sens où
            // elle ne varie pas (bandes le long des arêtes : interpolation identique)
            let wd = 1;
            let ht = 1;
            if (ao0 === ao1 && ao3 === ao2) while (i + wd < CHUNK && mask[j * CHUNK + i + wd] === key) wd++;
            if (ao0 === ao3 && ao1 === ao2) {
              outer: while (j + ht < CHUNK) {
                const r = (j + ht) * CHUNK + i;
                for (let t = 0; t < wd; t++) if (mask[r + t] !== key) break outer;
                ht++;
              }
            }
            for (let jj = 0; jj < ht; jj++) mask.fill(0, (j + jj) * CHUNK + i, (j + jj) * CHUNK + i + wd);
            const u0 = baseU + i;
            const u1 = u0 + wd;
            const w0 = baseW + j;
            const w1 = w0 + ht;
            // sommets (u,w) : (u0,w0) (u1,w0) (u1,w1) (u0,w1) — sens direct vu depuis +a
            if (dir > 0) {
              vtx[u] = u0;
              vtx[w] = w0;
              vtx[3 + u] = u1;
              vtx[3 + w] = w0;
              vtx[6 + u] = u1;
              vtx[6 + w] = w1;
              vtx[9 + u] = u0;
              vtx[9 + w] = w1;
              out.quad(vtx, nx, ny, nz, ao0, ao1, ao2, ao3, raw & 255);
            } else {
              vtx[u] = u0;
              vtx[w] = w0;
              vtx[3 + u] = u0;
              vtx[3 + w] = w1;
              vtx[6 + u] = u1;
              vtx[6 + w] = w1;
              vtx[9 + u] = u1;
              vtx[9 + w] = w0;
              out.quad(vtx, nx, ny, nz, ao0, ao3, ao2, ao1, raw & 255);
            }
            i += wd;
          }
        }
      }
    }
  }
}
