// Rendu des véhicules (entités du serveur) : modèles voxel, flottement des coussins
// magnétiques, inclinaison des motos, épaves calcinées.

import * as THREE from 'three';
import { Anim } from '../../shared/characters';
import { VEHICLES } from '../../shared/constants';
import type { CharView } from '../characters/characterRenderer';
import { meshModel } from '../models/modelMesher';
import { vehicleModel } from '../models/vehicles';
import { shade } from '../models/voxelModel';
import { createObjectMaterial } from '../render/voxelObjectMaterial';

interface Inst {
  mesh: THREE.Mesh;
  owner: number;
  def: number;
  lean: number;
  lastYaw: number;
  wreck: boolean;
}

export class VehicleRenderer {
  readonly group = new THREE.Group();
  private material = createObjectMaterial({ key: 'vehicles' });
  private geos = new Map<string, THREE.BufferGeometry>();
  private insts = new Map<number, Inst>();
  private t = 0;

  constructor() {
    this.group.name = 'véhicules';
  }

  private geo(def: number, owner: number, wreck: boolean): THREE.BufferGeometry {
    const key = `${def}:${owner}:${wreck ? 1 : 0}`;
    let g = this.geos.get(key);
    if (!g) {
      const model = vehicleModel(def, (owner === 1 || owner === 2 ? owner : 0) as 0 | 1 | 2);
      if (wreck) {
        // épave calcinée : tout noircit, les néons s'éteignent, la tôle est trouée
        let k = 0;
        model.forEach((x, y, z, c) => {
          k = (k * 1103515245 + x * 31 + y * 17 + z * 7 + 12345) & 0x7fffffff;
          if (k % 9 === 0 && y > 4) return -1;
          return c >= 0xf00000 ? 0x141210 : shade(c, 0.22 + (k % 7) * 0.02);
        });
      }
      g = meshModel(model);
      // l'attribut de propriétaire (teintes de faction des SLOT.TINT*)
      const n = g.getAttribute('position').count;
      g.setAttribute('aOwner', new THREE.BufferAttribute(new Float32Array(n).fill(owner === 1 || owner === 2 ? owner : 0), 1));
      this.geos.set(key, g);
    }
    return g;
  }

  /**
   * views : vues des entités véhicules (kind VEHICLE, gang = VehicleDef) ;
   * local : le véhicule conduit par le joueur (position immédiate, sans attendre le serveur).
   */
  update(views: CharView[], dt: number, local: { id: number; x: number; y: number; z: number; yaw: number; speed: number } | null): void {
    this.t += dt;
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      let it = this.insts.get(v.id);
      const wreck = v.anim === Anim.DEAD;
      if (!it || it.def !== v.gang || it.owner !== v.faction || it.wreck !== wreck) {
        if (it) this.group.remove(it.mesh);
        const mesh = new THREE.Mesh(this.geo(v.gang, v.faction, wreck), this.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        it = { mesh, owner: v.faction, def: v.gang, lean: 0, lastYaw: v.yaw, wreck };
        this.insts.set(v.id, it);
        this.group.add(it.mesh);
      }
      const def = VEHICLES[v.gang] ?? VEHICLES[0];
      const mine = local && local.id === v.id;
      const x = mine ? local.x : v.x;
      const y = mine ? local.y : v.y;
      const z = mine ? local.z : v.z;
      const yaw = mine ? local.yaw : v.yaw;
      // flottement (sauf épaves et motos)
      const bob = wreck || def.cls === 'moto' ? 0 : Math.sin(this.t * 2.1 + v.id) * 0.025;
      const fly = def.cls === 'vtol' || def.cls === 'drone' ? Math.sin(this.t * 1.3 + v.id) * 0.06 : 0;
      it.mesh.position.set(x, y + bob + fly + (wreck ? -0.18 : 0), z);
      // inclinaison des motos dans les virages
      let turn = yaw - it.lastYaw;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      it.lastYaw = yaw;
      const speed = mine ? Math.abs(local.speed) : Math.hypot(v.vx, v.vz);
      const wantLean = def.cls === 'moto' && dt > 0 ? Math.max(-0.5, Math.min(0.5, (-turn / dt) * 0.08 * Math.min(1, speed / 8))) : 0;
      it.lean += (wantLean - it.lean) * Math.min(1, dt * 6);
      it.mesh.rotation.set(0, yaw, it.lean, 'YXZ');
      if (wreck) it.mesh.rotation.z = 0.08;
    }
    for (const [id, it] of this.insts) {
      if (seen.has(id)) continue;
      this.group.remove(it.mesh);
      this.insts.delete(id);
    }
  }

  /** Position d'une selle de moto (pour asseoir le pilote). */
  static seat(defId: number, x: number, y: number, z: number, yaw: number): { x: number; y: number; z: number } {
    const def = VEHICLES[defId];
    const back = def.cls === 'moto' ? -0.25 : 0;
    return { x: x + Math.sin(yaw) * back, y: y + (def.cls === 'moto' ? 0.28 : 0.35), z: z + Math.cos(yaw) * back };
  }
}
