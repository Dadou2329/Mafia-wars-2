// Grenades en vol côté client : même trajectoire que le serveur (src/shared/grenade.ts), une
// petite grenade sombre dont la diode rouge clignote de plus en plus vite. L'explosion arrive
// par l'événement « boom » du serveur.

import * as THREE from 'three';
import { GRENADE_FUSE, stepGrenade, type GrenadeBody } from '../../shared/grenade';
import type { VoxelWorld } from '../../shared/voxel';

interface Flying extends GrenadeBody {
  id: number;
  age: number;
  mesh: THREE.Group;
  led: THREE.Mesh;
}

export class GrenadeFx {
  readonly group = new THREE.Group();
  private list: Flying[] = [];
  private bodyGeo = new THREE.SphereGeometry(0.075, 8, 6);
  private ledGeo = new THREE.SphereGeometry(0.025, 6, 4);
  private bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2e26, roughness: 0.6, metalness: 0.4 });
  private ledOn = new THREE.MeshBasicMaterial({ color: 0xff2a20 });
  private ledOff = new THREE.MeshBasicMaterial({ color: 0x401010 });

  constructor(private world: VoxelWorld) {
    this.group.name = 'grenades';
    this.ledOn.toneMapped = false;
  }

  spawn(id: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    body.scale.set(1, 1.25, 1);
    const led = new THREE.Mesh(this.ledGeo, this.ledOn);
    led.position.y = 0.1;
    mesh.add(body, led);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.list.push({ id, x, y, z, vx, vy, vz, age: 0, mesh, led });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.age += dt;
      if (g.age > GRENADE_FUSE + 0.15) {
        this.group.remove(g.mesh);
        this.list.splice(i, 1);
        continue;
      }
      stepGrenade(this.world, g, dt);
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.rotation.x += dt * Math.hypot(g.vx, g.vz) * 2;
      // la diode clignote de plus en plus vite
      const rate = 3 + (g.age / GRENADE_FUSE) * 14;
      g.led.material = Math.sin(g.age * rate * Math.PI * 2) > 0 ? this.ledOn : this.ledOff;
    }
  }

  clear(): void {
    for (const g of this.list) this.group.remove(g.mesh);
    this.list = [];
  }
}
