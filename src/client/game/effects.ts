// Effets visuels : traînées de balles, éclairs de bouche, débris voxel, fumées.

import * as THREE from 'three';
import { envUniforms } from '../render/env';
import { NOISE_GLSL } from '../render/shaderChunks';

interface Tracer {
  a: THREE.Vector3;
  b: THREE.Vector3;
  life: number;
  max: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  grav: number;
  rot: number;
}

interface Smoke {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  shade: number;
  alpha: number;
}

const MAX_TRACERS = 96;
const MAX_PARTS = 900;
const MAX_SMOKE = 700;

const SMOKE_VERT = /* glsl */ `
attribute vec4 aSmoke; // taille, alpha, teinte, rotation
varying float vAlpha;
varying float vShade;
varying vec3 vWPos;
varying vec3 vN;
void main() {
  float s = aSmoke.x;
  vec3 p = position * s;
  float c = cos(aSmoke.w), sn = sin(aSmoke.w);
  p.xz = mat2(c, -sn, sn, c) * p.xz;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWPos = wp.xyz;
  vAlpha = aSmoke.y;
  vShade = aSmoke.z;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SMOKE_FRAG = /* glsl */ `
uniform vec3 uSkyAmb;
uniform vec3 uLampCol;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vAlpha;
varying float vShade;
varying vec3 vWPos;
varying vec3 vN;
${NOISE_GLSL}
void main() {
  float light = 0.55 + 0.45 * max(vN.y, 0.0);
  vec3 col = vec3(vShade) * (uSkyAmb * 1.6 + uLampCol * 0.12 + 0.08) * light;
  float d = length(vWPos - cameraPosition);
  float f = 1.0 - exp(-d * uFogDensity * 0.8);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, vAlpha);
}
`;

export class Effects {
  readonly group = new THREE.Group();
  private tracers: Tracer[] = [];
  private tracerGeo: THREE.BufferGeometry;
  private tracerPos: Float32Array;
  private tracerCol: Float32Array;
  private parts: Particle[] = [];
  private partMesh: THREE.InstancedMesh;
  private smokes: Smoke[] = [];
  private smokeMesh: THREE.InstancedMesh;
  private smokeAttr: THREE.InstancedBufferAttribute;
  private flashes: { light: THREE.PointLight; life: number }[] = [];
  private flashSprites: { mesh: THREE.Mesh; life: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private e = new THREE.Euler();
  /** Cheminées fumantes (émetteurs permanents). */
  private emitters: { x: number; y: number; z: number; big: boolean; acc: number }[] = [];
  quality = 1;

  constructor() {
    this.group.name = 'effets';
    // traînées
    this.tracerPos = new Float32Array(MAX_TRACERS * 6);
    this.tracerCol = new Float32Array(MAX_TRACERS * 6);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    const tracerMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    tracerMat.toneMapped = false;
    const lines = new THREE.LineSegments(this.tracerGeo, tracerMat);
    lines.frustumCulled = false;
    this.group.add(lines);
    // débris
    const pg = new THREE.BoxGeometry(1, 1, 1);
    const pm = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.partMesh = new THREE.InstancedMesh(pg, pm, MAX_PARTS);
    this.partMesh.count = 0;
    this.partMesh.frustumCulled = false;
    this.partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.partMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTS * 3), 3);
    this.group.add(this.partMesh);
    // fumées
    const sg = new THREE.BoxGeometry(1, 1, 1);
    this.smokeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SMOKE * 4), 4);
    this.smokeAttr.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aSmoke', this.smokeAttr);
    const sm = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: { uSkyAmb: envUniforms.uSkyAmb, uLampCol: envUniforms.uLampCol, uFogColor: envUniforms.uFogColor, uFogDensity: envUniforms.uFogDensity },
      transparent: true,
      depthWrite: false,
    });
    sm.toneMapped = false;
    this.smokeMesh = new THREE.InstancedMesh(sg, sm, MAX_SMOKE);
    this.smokeMesh.count = 0;
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 10;
    this.group.add(this.smokeMesh);
    // éclairs (lumières ponctuelles en nombre fixe : pas de recompilation des shaders)
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 9, 1.6);
      l.castShadow = false;
      this.group.add(l);
      this.flashes.push({ light: l, life: 0 });
    }
    const flashGeo = new THREE.PlaneGeometry(1, 1);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    flashMat.toneMapped = false;
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(flashGeo, flashMat);
      m.visible = false;
      this.group.add(m);
      this.flashSprites.push({ mesh: m, life: 0 });
    }
  }

  setEmitters(list: { x: number; y: number; z: number; big: boolean }[]): void {
    this.emitters = list.map((e) => ({ ...e, acc: Math.random() }));
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3): void {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    this.tracers.push({ a: a.clone(), b: b.clone(), life: 0.09, max: 0.09 });
  }

  muzzleFlash(p: THREE.Vector3, dir: THREE.Vector3, big = false, camera?: THREE.Camera): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.life = 0.06;
    f.light.position.copy(p).addScaledVector(dir, 0.2);
    f.light.intensity = big ? 9 : 6;
    const s = this.flashSprites.find((x) => x.life <= 0) ?? this.flashSprites[0];
    s.life = 0.05;
    s.mesh.visible = true;
    s.mesh.position.copy(p).addScaledVector(dir, 0.08);
    s.mesh.scale.setScalar(big ? 0.55 : 0.35);
    if (camera) s.mesh.quaternion.copy(camera.quaternion);
    s.mesh.rotateZ(Math.random() * Math.PI);
    // fumée de poudre noire
    for (let i = 0; i < (big ? 6 : 3); i++) {
      this.addSmoke(p.x + dir.x * 0.3, p.y + dir.y * 0.3, p.z + dir.z * 0.3, dir.x * 1.2 + (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, dir.z * 1.2 + (Math.random() - 0.5) * 0.4, 1.4 + Math.random(), 0.12, 0.6, 0.75, 0.5);
    }
  }

  private addPart(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color, grav = 9.8): void {
    if (this.parts.length >= MAX_PARTS) this.parts.shift();
    this.parts.push({ x, y, z, vx, vy, vz, life, max: life, size, color, grav, rot: Math.random() * 6 });
  }

  addSmoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, shade: number, alpha: number): void {
    if (this.smokes.length >= MAX_SMOKE) this.smokes.shift();
    this.smokes.push({ x, y, z, vx, vy, vz, life, max: life, size, grow, shade, alpha });
  }

  /** Impact sur une surface : poussière ou étincelles selon le matériau. */
  impact(p: THREE.Vector3, n: THREE.Vector3, kind: 'stone' | 'wood' | 'metal' | 'glass' | 'dirt'): void {
    const cols: Record<string, number[]> = {
      stone: [0x8a8478, 0x6a6458, 0xa49c8c],
      wood: [0x6a4a2a, 0x8a6238, 0x4a3018],
      metal: [0xffd070, 0xffa040, 0xfff0b0],
      glass: [0xc8d8e0, 0x9ab0c0, 0xe8f0f4],
      dirt: [0x5a4a38, 0x4a3a2a, 0x6a5a48],
    };
    const c = cols[kind];
    const n2 = kind === 'metal' ? 7 : 9;
    for (let i = 0; i < n2 * this.quality; i++) {
      const sp = kind === 'metal' ? 6 : 3;
      this.addPart(
        p.x + n.x * 0.03,
        p.y + n.y * 0.03,
        p.z + n.z * 0.03,
        n.x * sp * Math.random() + (Math.random() - 0.5) * sp,
        n.y * sp * Math.random() + Math.random() * 2,
        n.z * sp * Math.random() + (Math.random() - 0.5) * sp,
        0.4 + Math.random() * 0.5,
        kind === 'metal' ? 0.025 : 0.04 + Math.random() * 0.04,
        new THREE.Color(c[i % c.length]),
      );
    }
    if (kind !== 'metal') this.addSmoke(p.x + n.x * 0.1, p.y + n.y * 0.1, p.z + n.z * 0.1, n.x * 0.5, 0.3, n.z * 0.5, 1.2, 0.1, 0.5, kind === 'wood' ? 0.55 : 0.7, 0.45);
  }

  blood(p: THREE.Vector3, dir: THREE.Vector3, heavy = false): void {
    const n = (heavy ? 16 : 9) * this.quality;
    for (let i = 0; i < n; i++) {
      this.addPart(
        p.x,
        p.y,
        p.z,
        dir.x * 2.5 + (Math.random() - 0.5) * 2.2,
        Math.random() * 2.2,
        dir.z * 2.5 + (Math.random() - 0.5) * 2.2,
        0.5 + Math.random() * 0.4,
        0.035 + Math.random() * 0.035,
        new THREE.Color(Math.random() < 0.5 ? 0x7a0e10 : 0x5a080a),
      );
    }
  }

  /** Étincelles de capture, pièces d'or… */
  burst(p: THREE.Vector3, color: number, n = 20): void {
    for (let i = 0; i < n; i++) {
      this.addPart(p.x, p.y, p.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.9 + Math.random() * 0.5, 0.05, new THREE.Color(color), 6);
    }
  }

  update(dt: number, camPos: THREE.Vector3): void {
    // traînées
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
    }
    for (const t of this.tracers) {
      const k = t.life / t.max;
      // segment qui avance le long de la trajectoire
      const head = 1 - k;
      const a = t.a.clone().lerp(t.b, Math.max(0, head - 0.35));
      const b = t.a.clone().lerp(t.b, Math.min(1, head + 0.15));
      this.tracerPos.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6);
      const br = 0.9 * k;
      this.tracerCol.set([br * 0.4, br * 0.3, br * 0.15, br, br * 0.85, br * 0.5], n * 6);
      n++;
    }
    for (let i = n; i < MAX_TRACERS; i++) this.tracerPos.fill(0, i * 6, i * 6 + 6);
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.tracerGeo.setDrawRange(0, n * 2);
    // éclairs
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        if (f.life <= 0) f.light.intensity = 0;
      }
    }
    for (const s of this.flashSprites) {
      if (s.life > 0) {
        s.life -= dt;
        if (s.life <= 0) s.mesh.visible = false;
      }
    }
    // débris
    let c = 0;
    const arr = this.partMesh.instanceMatrix.array as Float32Array;
    const carr = this.partMesh.instanceColor!.array as Float32Array;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += dt * 8;
      if (p.y < 0.02 && p.vy < 0) {
        p.y = 0.02;
        p.vy *= -0.25;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
    }
    for (const p of this.parts) {
      const k = Math.min(1, p.life / (p.max * 0.4));
      this.e.set(p.rot, p.rot * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.v.set(p.x, p.y, p.z);
      this.s.setScalar(p.size * k);
      this.m.compose(this.v, this.q, this.s);
      this.m.toArray(arr, c * 16);
      carr[c * 3] = p.color.r;
      carr[c * 3 + 1] = p.color.g;
      carr[c * 3 + 2] = p.color.b;
      c++;
    }
    this.partMesh.count = c;
    this.partMesh.instanceMatrix.needsUpdate = true;
    this.partMesh.instanceColor!.needsUpdate = true;
    // émetteurs de fumée (cheminées proches)
    for (const em of this.emitters) {
      const d2 = (em.x - camPos.x) ** 2 + (em.z - camPos.z) ** 2;
      if (d2 > 140 * 140) continue;
      em.acc += dt * (em.big ? 3.5 : 1.2) * this.quality;
      while (em.acc > 1) {
        em.acc -= 1;
        this.addSmoke(
          em.x + (Math.random() - 0.5) * 0.3,
          em.y,
          em.z + (Math.random() - 0.5) * 0.3,
          0.35 + Math.random() * 0.2,
          em.big ? 1.6 : 0.9,
          0.15 + Math.random() * 0.1,
          em.big ? 9 : 6,
          em.big ? 0.9 : 0.4,
          em.big ? 0.55 : 0.35,
          em.big ? 0.3 : 0.45,
          em.big ? 0.42 : 0.3,
        );
      }
    }
    // fumées
    let k = 0;
    const sarr = this.smokeMesh.instanceMatrix.array as Float32Array;
    const sattr = this.smokeAttr.array as Float32Array;
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.smokes.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.vx *= 1 - dt * 0.3;
      s.vz *= 1 - dt * 0.3;
      s.size += s.grow * dt;
    }
    for (const s of this.smokes) {
      const t = 1 - s.life / s.max;
      const a = s.alpha * Math.min(1, t * 6) * (1 - t);
      this.m.makeTranslation(s.x, s.y, s.z);
      this.m.toArray(sarr, k * 16);
      sattr[k * 4] = s.size;
      sattr[k * 4 + 1] = a;
      sattr[k * 4 + 2] = s.shade;
      sattr[k * 4 + 3] = (s.x * 3.1 + s.z) % 6.28;
      k++;
    }
    this.smokeMesh.count = k;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.smokeAttr.needsUpdate = true;
  }
}
