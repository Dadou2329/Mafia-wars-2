// Maillage des membres des personnages (voxels au 1/64 m) : maillage glouton avec occlusion
// ambiante par sommet, comme models/modelMesher, mais avec les emplacements de palette
// étendus des personnages (XS.* : ombres et reflets de la peau, des cheveux, des étoffes),
// lus par le shader dans les colonnes 16 à 31 de la ligne de palette du personnage. Fournit
// aussi la réduction de résolution des niveaux de détail.

import * as THREE from 'three';
import { quadIndex } from '../models/modelMesher';
import { SLOT_INDEX, VoxelModel } from '../models/voxelModel';

/**
 * Emplacements de palette étendus (index de shader 32 à 47). Leur couleur est dérivée de la
 * tenue (ombre ou reflet d'un emplacement de base) dans `extendedPalette` (styles.ts).
 */
export const XS = {
  SKIN_D: 0xf00020, // plis de la peau, narines, ombre sous la mâchoire
  SKIN_L: 0xf00021, // arête du nez, pommettes, front
  LIP: 0xf00022, // lèvres (rouge à lèvres des femmes)
  HAIR_L: 0xf00023, // reflets des cheveux
  HAIR_D: 0xf00024, // mèches sombres, raie
  COAT_D: 0xf00025, // plis et coutures du vêtement principal
  COAT_L: 0xf00026, // surpiqûres, arêtes éclairées
  PANTS_D: 0xf00027, // pli du pantalon, coutures
  SHIRT_D: 0xf00028, // plis de la chemise
  SHOES_L: 0xf00029, // reflet du cuir ciré
  VEST_D: 0xf0002a, // ombre du gilet, du plastron
  HAT_L: 0xf0002b, // reflet du chapeau
  DRESS_D: 0xf0002c, // plis de la robe, de l'équipement
  COAT2_D: 0xf0002d, // ombre de la doublure, des revers
  MAKEUP: 0xf0002e, // fard à paupières, ombre des orbites
  IRIS: 0xf0002f, // iris (couleur des yeux), distinct de la pupille
} as const;

/**
 * Couleurs lumineuses des implants : couleur sRGB (24 bits) + drapeau GLOW + canal d'intensité
 * (0 à 15, bits 25 à 28). Le maillage les range dans les emplacements de shader 48 à 63 en
 * gardant leur couleur ; le matériau des personnages (charMaterial.ts) les rend émissives selon
 * l'intensité de leur canal, propre à chaque personnage (bouclier levé, surcharge, sprint…).
 */
export const GLOW_FLAG = 0x1000000;

/** Couleur lumineuse `rgb` sur le canal d'intensité `ch` (voir GLOW_CH dans cyber.ts). */
export function glow(rgb: number, ch: number): number {
  return GLOW_FLAG | ((ch & 15) << 25) | (rgb & 0xffffff);
}

/** La couleur est-elle lumineuse (implant) ? */
export function isGlow(c: number): boolean {
  return c >= GLOW_FLAG && (c & GLOW_FLAG) !== 0;
}

/** Index de shader d'une couleur (0 = couleur sRGB fixe). */
export function charSlotIndex(c: number): number {
  if (c < 0xf00000) return 0;
  if (c >= GLOW_FLAG) return c & GLOW_FLAG ? 48 + ((c >>> 25) & 15) : 0;
  const s = SLOT_INDEX[c];
  if (s !== undefined) return s;
  if (c >= 0xf00020 && c <= 0xf0002f) return 32 + (c - 0xf00020);
  return 0;
}

/**
 * Maillage glouton d'un modèle : une face par côté exposé, fusionnées en rectangles de même
 * couleur et d'occlusion uniforme. Attributs : position (m, relative à l'origine du modèle),
 * normal, color (sRGB), aExt (emplacement, occlusion 0..3).
 */
export function meshChar(m: VoxelModel, aoKeep = -1): THREE.BufferGeometry {
  const sx = m.sx;
  const sy = m.sy;
  const sz = m.sz;
  const data = m.data;
  const dims = [sx, sy, sz];
  // index de couleur compact (0 = vide)
  const colorIdx = new Map<number, number>();
  const colors: number[] = [0];
  const vox = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === 0) continue;
    let ci = colorIdx.get(v);
    if (ci === undefined) {
      ci = colors.length;
      colorIdx.set(v, ci);
      colors.push(v - 1);
    }
    vox[i] = ci;
  }
  const filled = (x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : vox[(y * sz + z) * sx + x] !== 0 ? 1 : 0);
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const ext: number[] = [];
  const res = m.res;
  const ox = m.ox;
  const oy = m.oy;
  const oz = m.oz;
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const v = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const w = (a + 2) % 3;
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
            const ci = vox[(p[1] * sz + p[2]) * sx + p[0]];
            let key = 0;
            if (ci !== 0) {
              q[0] = p[0];
              q[1] = p[1];
              q[2] = p[2];
              q[a] += dir;
              if (!filled(q[0], q[1], q[2])) {
                // occlusion des quatre coins (voisins du côté exposé)
                const occ = (du_: number, dw_: number): number => {
                  v[0] = q[0];
                  v[1] = q[1];
                  v[2] = q[2];
                  v[u] += du_;
                  v[w] += dw_;
                  return filled(v[0], v[1], v[2]);
                };
                const s1m = occ(-1, 0);
                const s1p = occ(1, 0);
                const s2m = occ(0, -1);
                const s2p = occ(0, 1);
                // occlusion faible (une seule marche d'escalier) ignorée : elle ne ferait que
                // strier les surfaces courbes et empêcherait la fusion des faces
                let ao0 = s1m && s2m ? 0 : 3 - (s1m + s2m + occ(-1, -1));
                let ao1 = s1p && s2m ? 0 : 3 - (s1p + s2m + occ(1, -1));
                let ao2 = s1p && s2p ? 0 : 3 - (s1p + s2p + occ(1, 1));
                let ao3 = s1m && s2p ? 0 : 3 - (s1m + s2p + occ(-1, 1));
                if (ao0 > aoKeep) ao0 = 3;
                if (ao1 > aoKeep) ao1 = 3;
                if (ao2 > aoKeep) ao2 = 3;
                if (ao3 > aoKeep) ao3 = 3;
                key = ((ci << 8) | (ao0 << 6) | (ao1 << 4) | (ao2 << 2) | ao3) + 1;
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
            // fusion directionnelle : l'occlusion interpolée reste exacte si elle est
            // constante le long de l'axe de fusion (même clé = même motif d'occlusion)
            const alongU = ao0 === ao1 && ao3 === ao2;
            const alongW = ao0 === ao3 && ao1 === ao2;
            let wd = 1;
            let ht = 1;
            if (alongU) while (i + wd < du && mask[j * du + i + wd] === key) wd++;
            if (alongW)
              outer: while (j + ht < dw) {
                for (let t = 0; t < wd; t++) if (mask[(j + ht) * du + i + t] !== key) break outer;
                ht++;
              }
            for (let jj = 0; jj < ht; jj++) for (let ii = 0; ii < wd; ii++) mask[(j + jj) * du + i + ii] = 0;
            const c = colors[raw >> 8];
            const slot = charSlotIndex(c);
            // les couleurs lumineuses (48+) gardent leur teinte ; les emplacements de palette sont blancs
            const keep = slot === 0 || slot >= 48;
            const cr = keep ? (c >> 16) & 255 : 255;
            const cg = keep ? (c >> 8) & 255 : 255;
            const cb = keep ? c & 255 : 255;
            // coins dans l'ordre direct vu de l'extérieur
            const cu = dir > 0 ? [i, i + wd, i + wd, i] : [i, i, i + wd, i + wd];
            const cw = dir > 0 ? [j, j, j + ht, j + ht] : [j, j + ht, j + ht, j];
            const aoc = dir > 0 ? [ao0, ao1, ao2, ao3] : [ao0, ao3, ao2, ao1];
            // diagonale qui suit le gradient d'occlusion (pas d'artefact en losange)
            const start = aoc[0] + aoc[2] < aoc[1] + aoc[3] ? 1 : 0;
            for (let n = 0; n < 4; n++) {
              const s = (start + n) & 3;
              v[a] = plane;
              v[u] = cu[s];
              v[w] = cw[s];
              pos.push((v[0] - ox) * res, (v[1] - oy) * res, (v[2] - oz) * res);
              nrm.push(a === 0 ? dir * 127 : 0, a === 1 ? dir * 127 : 0, a === 2 ? dir * 127 : 0);
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
  geo.setIndex(quadIndex(Math.max(1, quads)));
  geo.setDrawRange(0, quads * 6);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  geo.userData.quads = quads;
  return geo;
}

/** Couleurs qui doivent survivre à la réduction (néons, yeux) : priorité dans le vote. */
function weight(c: number): number {
  const s = charSlotIndex(c);
  if (s === 7 || (s >= 8 && s <= 15) || s >= 48) return 2.5; // lumineux (néons, implants)
  if (s === 28 || c === XS.IRIS) return 1.6; // yeux
  return 1;
}

/**
 * Réduit la résolution d'un facteur 2 (niveau de détail lointain). Une case est pleine si au
 * moins `minFill` de ses huit sous-cases le sont ; sa couleur est la plus représentée (les
 * néons et les yeux comptent davantage pour ne pas disparaître).
 */
export function downsampleChar(m: VoxelModel, minFill = 3): VoxelModel {
  const r = new VoxelModel(Math.ceil(m.sx / 2), Math.ceil(m.sy / 2), Math.ceil(m.sz / 2), m.res * 2);
  r.setOrigin(m.ox / 2, m.oy / 2, m.oz / 2);
  const cs: number[] = [];
  const ws: number[] = [];
  for (let y = 0; y < r.sy; y++)
    for (let z = 0; z < r.sz; z++)
      for (let x = 0; x < r.sx; x++) {
        cs.length = 0;
        ws.length = 0;
        let filled = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dz = 0; dz < 2; dz++)
            for (let dx = 0; dx < 2; dx++) {
              const c = m.get(x * 2 + dx, y * 2 + dy, z * 2 + dz);
              if (c < 0) continue;
              filled++;
              const i = cs.indexOf(c);
              if (i >= 0) ws[i] += weight(c);
              else {
                cs.push(c);
                ws.push(weight(c));
              }
            }
        if (filled < minFill) continue;
        let best = 0;
        for (let i = 1; i < cs.length; i++) if (ws[i] > ws[best]) best = i;
        r.set(x, y, z, cs[best]);
      }
  return r;
}
