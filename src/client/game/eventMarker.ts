// Repère 3D des événements aléatoires : la cargaison de contrebande (caisses, tonneaux et
// lanterne) surmontée d'une colonne de lumière dorée visible de loin.

import * as THREE from 'three';
import { meshModel } from '../models/modelMesher';
import { propModelEntry } from '../models/props';
import { SLOT, VoxelModel } from '../models/voxelModel';
import { createObjectMaterial } from '../render/voxelObjectMaterial';

const BEAM_VERT = /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  vH = position.y / 40.0;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
  float fade = (1.0 - vH) * (1.0 - vH);
  float pulse = 0.75 + 0.25 * sin(uTime * 3.0 - vH * 12.0);
  float a = (0.18 + 0.5 * (1.0 - edge)) * fade * pulse;
  gl_FragColor = vec4(uColor * a, a);
}`;

function lantern(): VoxelModel {
  const m = new VoxelModel(6, 10, 6);
  m.box(1, 0, 1, 5, 1, 5, 0x2a2a2c);
  m.box(1, 1, 1, 5, 7, 5, SLOT.GLOW);
  m.box(1, 1, 1, 2, 7, 2, 0x2a2a2c);
  m.box(4, 1, 1, 5, 7, 2, 0x2a2a2c);
  m.box(1, 1, 4, 2, 7, 5, 0x2a2a2c);
  m.box(4, 1, 4, 5, 7, 5, 0x2a2a2c);
  m.box(0, 7, 0, 6, 8, 6, 0x2a2a2c);
  m.box(2, 8, 2, 4, 10, 4, 0x2a2a2c);
  return m;
}

export class EventMarker {
  readonly group = new THREE.Group();
  private beam: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  private stack = new THREE.Group();
  private material = createObjectMaterial({ key: 'event' });

  constructor() {
    this.group.name = 'événement';
    this.group.visible = false;
    const add = (m: VoxelModel, x: number, y: number, z: number, yaw = 0) => {
      const mesh = new THREE.Mesh(meshModel(m), this.material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.stack.add(mesh);
    };
    add(propModelEntry('CRATE').make(0), 0, 0, 0, 0.1);
    add(propModelEntry('CRATE').make(1), 0.05, 0.88, 0.02, -0.25);
    add(propModelEntry('BARREL').make(0), 1.0, 0, 0.25);
    add(propModelEntry('BARREL').make(1), 0.85, 0, -0.75);
    add(lantern(), 0.1, 1.76, 0.05);
    this.group.add(this.stack);
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.78, 0.32) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.CylinderGeometry(0.55, 0.9, 40, 20, 1, true);
    geo.translate(0, 20, 0);
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 5;
    this.group.add(this.beam);
  }

  show(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  update(now: number): void {
    if (!this.group.visible) return;
    this.beamMat.uniforms.uTime.value = now;
  }
}
