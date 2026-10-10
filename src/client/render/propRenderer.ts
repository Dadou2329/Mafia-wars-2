// Rendu instancié des accessoires. Les objets intérieurs ne sont dessinés que si la caméra
// est dans le bâtiment ou tout près (les vitres sont opaques), les objets extérieurs selon
// la distance. Les accessoires teintés prennent la couleur du propriétaire du bâtiment.

import * as THREE from 'three';
import { PROP_DEFS, PROP_KINDS, type PropKind } from '../../shared/city/props';
import type { BuildingInfo, PropPlacement } from '../../shared/city/gen/context';
import { meshModel } from '../models/modelMesher';
import { propModelEntry } from '../models/props';
import { createObjectMaterial } from './voxelObjectMaterial';

interface Inst {
  matrix: THREE.Matrix4;
  x: number;
  z: number;
  building: number;
  interior: boolean;
  tinted: boolean;
}

interface Group {
  kind: PropKind;
  mesh: THREE.InstancedMesh;
  owner: THREE.InstancedBufferAttribute;
  items: Inst[];
  maxDist: number;
  big: boolean;
}

/** Accessoires gérés séparément (animés). */
const SKIP = new Set<PropKind>(['DOOR_LEAF']);

export class PropRenderer {
  readonly group = new THREE.Group();
  private groups: Group[] = [];
  private buildingOwner = new Map<number, number>();
  private footprints: Map<number, [number, number, number, number]>;
  private lastUpdate = -1e9;
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private dirty = true;
  readonly material: THREE.MeshLambertMaterial;
  stats = { kinds: 0, instances: 0, visible: 0, quads: 0 };

  constructor(placements: PropPlacement[], buildings: BuildingInfo[]) {
    this.group.name = 'accessoires';
    this.material = createObjectMaterial();
    this.footprints = new Map(buildings.map((b) => [b.id, b.footprint]));
    // regroupement par (type, variante de modèle)
    const byKey = new Map<string, { kind: PropKind; variant: number; list: PropPlacement[] }>();
    for (const p of placements) {
      const kind = PROP_KINDS[p.kind];
      if (SKIP.has(kind)) continue;
      const entry = propModelEntry(kind);
      const variant = p.variant % entry.variants;
      const key = `${kind}:${variant}`;
      let g = byKey.get(key);
      if (!g) byKey.set(key, (g = { kind, variant, list: [] }));
      g.list.push(p);
    }
    const tmpQ = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const { kind, variant, list } of byKey.values()) {
      const model = propModelEntry(kind).make(variant);
      const geo = meshModel(model);
      this.stats.quads += (geo.userData.quads as number) * list.length;
      const def = PROP_DEFS[kind] as { size: number[]; tinted?: boolean };
      const mesh = new THREE.InstancedMesh(geo, this.material, list.length);
      mesh.castShadow = def.size[1] > 0.6;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const owner = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
      owner.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aOwner', owner);
      const items: Inst[] = list.map((p) => {
        const fp = p.building >= 0 ? this.footprints.get(p.building) : undefined;
        const interior = !!fp && p.x > fp[0] + 0.3 && p.x < fp[2] - 0.3 && p.z > fp[1] + 0.3 && p.z < fp[3] - 0.3;
        const s = p.scale ?? 1;
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), tmpQ.setFromAxisAngle(up, p.yaw), new THREE.Vector3(s, s, s));
        return { matrix, x: p.x, z: p.z, building: p.building, interior, tinted: !!def.tinted };
      });
      const big = def.size[1] > 2.5 || kind === 'LAMP_POST' || kind === 'LAMP_WALL' || kind === 'LAMP_DOUBLE';
      this.groups.push({ kind, mesh, owner, items, maxDist: big ? 150 : 70, big });
      this.group.add(mesh);
      this.stats.instances += list.length;
    }
    this.stats.kinds = this.groups.length;
  }

  /** Distances d'affichage des petits et des grands accessoires (qualité graphique). */
  setDistances(small: number, big: number): void {
    for (const g of this.groups) g.maxDist = g.big ? big : small;
    this.dirty = true;
  }

  /** Change la couleur des accessoires teintés d'un bâtiment (0 neutre, 1 Dadou, 2 Even). */
  setOwner(building: number, owner: number): void {
    if (this.buildingOwner.get(building) === owner) return;
    this.buildingOwner.set(building, owner);
    this.dirty = true;
  }

  /** Bâtiment dont l'empreinte contient le point (avec marge). */
  private nearBuildings(x: number, z: number, margin: number): Set<number> {
    const s = new Set<number>();
    for (const [id, f] of this.footprints) {
      if (x > f[0] - margin && x < f[2] + margin && z > f[1] - margin && z < f[3] + margin) s.add(id);
    }
    return s;
  }

  update(cam: THREE.Vector3, force = false): void {
    const now = performance.now();
    const moved = cam.distanceToSquared(this.lastCam) > 4;
    if (!force && !this.dirty && !moved && now - this.lastUpdate < 500) return;
    this.lastUpdate = now;
    this.lastCam.copy(cam);
    this.dirty = false;
    const near = this.nearBuildings(cam.x, cam.z, 14);
    let visible = 0;
    for (const g of this.groups) {
      let n = 0;
      const md2 = g.maxDist * g.maxDist;
      const arr = g.mesh.instanceMatrix.array as Float32Array;
      const own = g.owner.array as Float32Array;
      for (const it of g.items) {
        if (it.interior) {
          if (!near.has(it.building)) continue;
        } else {
          const dx = it.x - cam.x;
          const dz = it.z - cam.z;
          if (dx * dx + dz * dz > md2) continue;
        }
        it.matrix.toArray(arr, n * 16);
        own[n] = it.building >= 0 ? this.buildingOwner.get(it.building) ?? 0 : 0;
        n++;
      }
      g.mesh.count = n;
      g.mesh.instanceMatrix.needsUpdate = true;
      g.owner.needsUpdate = true;
      visible += n;
    }
    this.stats.visible = visible;
  }
}
