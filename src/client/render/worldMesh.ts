// Construction des maillages du monde par régions de 2×2 tronçons (16 m × 16 m).

import * as THREE from 'three';
import { GROUND_VY, VOXEL, type VoxelWorld } from '../../shared/voxel';
import { MeshBuffers, meshChunk } from './mesher';

let sharedIndex: THREE.BufferAttribute | null = null;
let sharedIndexQuads = 0;

function getIndex(quads: number): THREE.BufferAttribute {
  if (sharedIndex && sharedIndexQuads >= quads) return sharedIndex;
  let n = Math.max(quads, sharedIndexQuads * 2, 65536);
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
  sharedIndexQuads = n;
  return sharedIndex;
}

export interface WorldMeshStats {
  regions: number;
  quads: number;
  ms: number;
}

/** Données de maillage d'une région (transférables depuis un worker). */
export interface RegionMesh {
  pos: Int16Array;
  nrm: Int8Array;
  dat: Uint8Array;
  quads: number;
}

/** Maille toutes les régions (2×2 tronçons) du monde. */
export function meshRegions(world: VoxelWorld, onProgress?: (f: number) => void): RegionMesh[] {
  const REG = 2;
  const rx = Math.ceil(world.cx / REG);
  const rz = Math.ceil(world.cz / REG);
  const out: RegionMesh[] = [];
  for (let gz = 0; gz < rz; gz++) {
    for (let gx = 0; gx < rx; gx++) {
      const buf = new MeshBuffers(16384);
      for (let cy = 0; cy < world.cy; cy++)
        for (let cz = gz * REG; cz < Math.min(world.cz, (gz + 1) * REG); cz++)
          for (let cx = gx * REG; cx < Math.min(world.cx, (gx + 1) * REG); cx++) meshChunk(world, cx, cy, cz, buf);
      if (buf.quads === 0) continue;
      const q = buf.quads;
      out.push({ pos: buf.pos.slice(0, q * 12), nrm: buf.nrm.slice(0, q * 12), dat: buf.dat.slice(0, q * 8), quads: q });
    }
    onProgress?.((gz + 1) / rz);
  }
  return out;
}

/** Crée les maillages Three.js à partir des données de régions. */
export function buildWorldGroup(regions: RegionMesh[], material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = 'monde';
  let maxQ = 0;
  for (const r of regions) maxQ = Math.max(maxQ, r.quads);
  const index = getIndex(maxQ);
  for (const r of regions) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(r.nrm, 3, true));
    geo.setAttribute('aData', new THREE.BufferAttribute(r.dat, 2));
    geo.computeBoundingSphere();
    geo.setIndex(index);
    geo.setDrawRange(0, r.quads * 6);
    const mesh = new THREE.Mesh(geo, material);
    mesh.scale.setScalar(VOXEL);
    mesh.position.set(0, -GROUND_VY * VOXEL, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  return group;
}

export function buildWorldMeshes(
  world: VoxelWorld,
  material: THREE.Material,
  onProgress?: (f: number) => void,
): { group: THREE.Group; stats: WorldMeshStats } {
  const t0 = performance.now();
  const regions = meshRegions(world, onProgress);
  const group = buildWorldGroup(regions, material);
  let quads = 0;
  for (const r of regions) quads += r.quads;
  return { group, stats: { regions: regions.length, quads, ms: performance.now() - t0 } };
}
