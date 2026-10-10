// Hologrammes publicitaires géants au-dessus des rues (danseuse de Times Square, carpes koï,
// dragon de Chinatown, anneaux, logos…) : silhouettes dessinées une fois sur une toile, puis
// animées par le shader (ondulation, balayage, scintillement), en mélange additif.

import * as THREE from 'three';
import type { HoloInfo } from '../../shared/city/gen/context';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL } from './shaderChunks';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWave;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec3 p = position;
  // ondulation (dragon, carpes) le long de l'axe x
  p.y += sin(p.x * 1.6 + uTime * 2.2 + uSeed) * uWave;
  p.z += cos(p.x * 1.1 + uTime * 1.7 + uSeed) * uWave * 0.6;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uSeed;
uniform float uUseMap;
varying vec2 vUv;
varying vec3 vW;
void main() {
  float a = uUseMap > 0.5 ? texture2D(uMap, vUv).a : 1.0;
  float scan = 0.65 + 0.35 * step(0.5, fract(vW.y * 3.0 - uTime * 1.5));
  float band = smoothstep(0.0, 0.08, abs(fract(vUv.y * 0.5 - uTime * 0.18 + uSeed) - 0.5));
  float flick = 0.86 + 0.14 * sin(uTime * 37.0 + uSeed * 9.0) * sin(uTime * 13.0);
  if (fract(uTime * 0.23 + uSeed) < 0.012) flick *= 0.3;
  float edge = uUseMap > 0.5 ? 1.0 : 1.0;
  vec3 c = uColor * a * scan * (0.55 + 0.45 * band) * flick * edge * mix(0.45, 1.25, uNight);
  // le brouillard estompe les hologrammes lointains
  float dist = length(vW - cameraPosition);
  c *= exp(-dist * uFogDensity * 0.7);
  gl_FragColor = vec4(c, 1.0);
}
`;

type Drawer = (c: CanvasRenderingContext2D, S: number) => void;

const DRAW: Record<HoloInfo['kind'], { w: number; h: number; draw: Drawer }> = {
  dancer: {
    w: 0.6,
    h: 1,
    draw: (c, S) => {
      const W = S * 0.6;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = '#fff';
      c.fillStyle = '#fff';
      c.lineWidth = S * 0.035;
      c.beginPath();
      c.arc(W / 2, S * 0.12, S * 0.06, 0, Math.PI * 2);
      c.fill();
      // cheveux au vent
      c.beginPath();
      c.moveTo(W / 2 + S * 0.04, S * 0.08);
      c.quadraticCurveTo(W / 2 + S * 0.22, S * 0.1, W / 2 + S * 0.2, S * 0.24);
      c.stroke();
      // buste, robe
      c.beginPath();
      c.moveTo(W / 2, S * 0.18);
      c.lineTo(W / 2 + S * 0.02, S * 0.42);
      c.stroke();
      c.beginPath();
      c.moveTo(W / 2 - S * 0.02, S * 0.4);
      c.lineTo(W / 2 - S * 0.16, S * 0.66);
      c.lineTo(W / 2 + S * 0.2, S * 0.64);
      c.closePath();
      c.fill();
      // bras levés
      c.beginPath();
      c.moveTo(W / 2, S * 0.22);
      c.lineTo(W / 2 - S * 0.14, S * 0.12);
      c.lineTo(W / 2 - S * 0.1, S * 0.0 + S * 0.02);
      c.moveTo(W / 2, S * 0.22);
      c.lineTo(W / 2 + S * 0.16, S * 0.18);
      c.lineTo(W / 2 + S * 0.25, S * 0.08);
      c.stroke();
      // jambes
      c.beginPath();
      c.moveTo(W / 2 - S * 0.03, S * 0.64);
      c.lineTo(W / 2 - S * 0.06, S * 0.96);
      c.moveTo(W / 2 + S * 0.06, S * 0.64);
      c.lineTo(W / 2 + S * 0.16, S * 0.82);
      c.lineTo(W / 2 + S * 0.1, S * 0.98);
      c.stroke();
    },
  },
  koi: {
    w: 1,
    h: 0.45,
    draw: (c, S) => {
      const H = S * 0.45;
      c.fillStyle = '#fff';
      c.beginPath();
      c.moveTo(S * 0.08, H * 0.5);
      c.bezierCurveTo(S * 0.25, H * 0.05, S * 0.62, H * 0.08, S * 0.74, H * 0.5);
      c.bezierCurveTo(S * 0.62, H * 0.92, S * 0.25, H * 0.95, S * 0.08, H * 0.5);
      c.fill();
      // queue en éventail
      c.beginPath();
      c.moveTo(S * 0.72, H * 0.5);
      c.lineTo(S * 0.98, H * 0.12);
      c.quadraticCurveTo(S * 0.9, H * 0.5, S * 0.98, H * 0.88);
      c.closePath();
      c.fill();
      // nageoires et barbillons
      c.beginPath();
      c.moveTo(S * 0.32, H * 0.8);
      c.lineTo(S * 0.42, H * 1.0);
      c.lineTo(S * 0.48, H * 0.78);
      c.fill();
      c.globalCompositeOperation = 'destination-out';
      c.beginPath();
      c.arc(S * 0.16, H * 0.42, S * 0.022, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.arc(S * (0.3 + i * 0.08), H * (0.5 + Math.sin(i * 2.1) * 0.15), S * 0.03, 0, Math.PI * 2);
        c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    },
  },
  dragon: {
    w: 1,
    h: 0.3,
    draw: (c, S) => {
      const H = S * 0.3;
      c.strokeStyle = '#fff';
      c.fillStyle = '#fff';
      c.lineCap = 'round';
      // corps sinueux
      c.lineWidth = H * 0.22;
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const x = S * 0.12 + (i / 40) * S * 0.84;
        const y = H * 0.5 + Math.sin(i * 0.45) * H * 0.22 * (1 - i / 60);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
      // écailles (dents de scie sur le dos)
      c.lineWidth = H * 0.05;
      for (let i = 2; i < 38; i += 2) {
        const x = S * 0.12 + (i / 40) * S * 0.84;
        const y = H * 0.5 + Math.sin(i * 0.45) * H * 0.22 * (1 - i / 60);
        c.beginPath();
        c.moveTo(x, y - H * 0.1);
        c.lineTo(x + S * 0.01, y - H * 0.22);
        c.stroke();
      }
      // tête, cornes, moustaches
      c.beginPath();
      c.ellipse(S * 0.09, H * 0.5, S * 0.06, H * 0.2, 0, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = H * 0.04;
      c.beginPath();
      c.moveTo(S * 0.1, H * 0.34);
      c.lineTo(S * 0.16, H * 0.06);
      c.moveTo(S * 0.06, H * 0.36);
      c.lineTo(S * 0.08, H * 0.04);
      c.moveTo(S * 0.04, H * 0.58);
      c.quadraticCurveTo(S * 0.0, H * 0.9, S * 0.05, H * 0.98);
      c.moveTo(S * 0.07, H * 0.62);
      c.quadraticCurveTo(S * 0.06, H * 0.95, S * 0.12, H * 0.99);
      c.stroke();
    },
  },
  bottle: {
    w: 0.4,
    h: 1,
    draw: (c, S) => {
      const W = S * 0.4;
      c.fillStyle = '#fff';
      c.beginPath();
      c.roundRect(W * 0.18, S * 0.32, W * 0.64, S * 0.64, W * 0.18);
      c.fill();
      c.beginPath();
      c.moveTo(W * 0.22, S * 0.36);
      c.lineTo(W * 0.38, S * 0.14);
      c.lineTo(W * 0.62, S * 0.14);
      c.lineTo(W * 0.78, S * 0.36);
      c.fill();
      c.fillRect(W * 0.38, S * 0.04, W * 0.24, S * 0.12);
      c.globalCompositeOperation = 'destination-out';
      c.fillRect(W * 0.18, S * 0.56, W * 0.64, S * 0.12);
      c.globalCompositeOperation = 'source-over';
      c.font = `900 ${W * 0.14}px 'Orbitron', sans-serif`;
      c.textAlign = 'center';
      c.fillText('NÉO-COLA', W / 2, S * 0.645);
    },
  },
  logo: {
    w: 1,
    h: 1,
    draw: (c, S) => {
      c.strokeStyle = '#fff';
      c.fillStyle = '#fff';
      c.lineWidth = S * 0.04;
      c.beginPath();
      c.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2);
      c.stroke();
      c.font = `900 ${S * 0.3}px 'Orbitron', sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('2085', S / 2, S * 0.46);
      c.font = `700 ${S * 0.09}px 'Rajdhani', sans-serif`;
      c.fillText('NEW YORK', S / 2, S * 0.68);
    },
  },
  face: {
    w: 0.8,
    h: 1,
    draw: (c, S) => {
      const W = S * 0.8;
      c.strokeStyle = '#fff';
      c.lineWidth = S * 0.012;
      // visage en lignes de niveau (tête de mannequin numérique)
      for (let i = 0; i < 14; i++) {
        const y = S * (0.1 + i * 0.06);
        const w = Math.sin((i / 13) * Math.PI) * W * 0.36 + W * 0.04;
        c.beginPath();
        c.ellipse(W / 2, y, w, S * 0.012, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = '#fff';
      c.fillRect(W * 0.34, S * 0.38, W * 0.1, S * 0.025);
      c.fillRect(W * 0.56, S * 0.38, W * 0.1, S * 0.025);
      c.fillRect(W * 0.42, S * 0.62, W * 0.16, S * 0.02);
    },
  },
  city: {
    w: 1,
    h: 0.5,
    draw: (c, S) => {
      const H = S * 0.5;
      c.fillStyle = '#fff';
      let x = 0;
      let i = 0;
      while (x < S) {
        const w = S * (0.04 + ((i * 37) % 7) * 0.012);
        const h = H * (0.25 + ((i * 53) % 11) * 0.06);
        c.fillRect(x, H - h, w - 2, h);
        x += w;
        i++;
      }
    },
  },
  ring: { w: 1, h: 1, draw: () => undefined },
};

interface Holo {
  info: HoloInfo;
  obj: THREE.Object3D;
  mats: THREE.ShaderMaterial[];
  spin: number;
  orbit?: THREE.Object3D;
}

export class Holograms {
  readonly group = new THREE.Group();
  private holos: Holo[] = [];

  constructor(list: HoloInfo[]) {
    this.group.name = 'hologrammes';
    list.forEach((info, idx) => this.add(info, idx));
  }

  private material(info: HoloInfo, idx: number, map: THREE.Texture | null, wave: number): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...envUniforms,
        uMap: { value: map },
        uUseMap: { value: map ? 1 : 0 },
        uColor: { value: new THREE.Color(info.color).multiplyScalar(1.6) },
        uTime: { value: 0 },
        uWave: { value: wave },
        uSeed: { value: idx * 0.37 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    m.toneMapped = false;
    return m;
  }

  private add(info: HoloInfo, idx: number): void {
    const root = new THREE.Group();
    root.position.set(info.x, info.y, info.z);
    root.rotation.y = info.yaw;
    const mats: THREE.ShaderMaterial[] = [];
    const s = info.scale;
    let spin = 0.15;
    let orbit: THREE.Object3D | undefined;
    if (info.kind === 'ring') {
      for (let i = 0; i < 3; i++) {
        const m = this.material(info, idx + i, null, 0);
        const torus = new THREE.Mesh(new THREE.TorusGeometry(s * (0.6 + i * 0.22), s * 0.025, 6, 64), m);
        torus.rotation.x = Math.PI / 2 + i * 0.5;
        torus.rotation.y = i * 0.8;
        root.add(torus);
        mats.push(m);
      }
      spin = 0.5;
    } else {
      const d = DRAW[info.kind];
      const S = 512;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(S * d.w);
      canvas.height = Math.round(S * d.h);
      const c = canvas.getContext('2d')!;
      d.draw(c, S);
      const tex = new THREE.CanvasTexture(canvas);
      const wave = info.kind === 'dragon' ? s * 0.05 : info.kind === 'koi' ? s * 0.04 : 0;
      const segs = info.kind === 'dragon' || info.kind === 'koi' ? 32 : 1;
      const geo = new THREE.PlaneGeometry(s * d.w * 2, s * d.h * 2, segs, 1);
      if (info.kind === 'koi') {
        // deux carpes qui tournent l'une autour de l'autre
        orbit = new THREE.Group();
        for (let k = 0; k < 2; k++) {
          const m = this.material(info, idx + k, tex, wave);
          const fish = new THREE.Mesh(geo, m);
          const a = k * Math.PI;
          fish.position.set(Math.cos(a) * s * 0.9, k * s * 0.3, Math.sin(a) * s * 0.9);
          fish.rotation.y = -a + (k ? Math.PI : 0);
          orbit.add(fish);
          mats.push(m);
        }
        root.add(orbit);
        spin = 0;
      } else {
        const m = this.material(info, idx, tex, wave);
        const mesh = new THREE.Mesh(geo, m);
        root.add(mesh);
        mats.push(m);
        spin = info.kind === 'logo' || info.kind === 'bottle' ? 0.6 : info.kind === 'dragon' ? 0 : 0.25;
      }
    }
    // socle projecteur : faisceau ténu vers le bas
    this.group.add(root);
    this.holos.push({ info, obj: root, mats, spin, orbit });
  }

  update(now: number, dt: number, cam: THREE.Vector3): void {
    for (const h of this.holos) {
      const d = Math.hypot(h.info.x - cam.x, h.info.z - cam.z);
      h.obj.visible = d < 260;
      if (!h.obj.visible) continue;
      for (const m of h.mats) m.uniforms.uTime.value = now;
      if (h.spin) h.obj.rotation.y += h.spin * dt;
      if (h.orbit) h.orbit.rotation.y -= 0.45 * dt;
      if (h.info.kind === 'dancer') h.obj.rotation.z = Math.sin(now * 1.4) * 0.08;
      h.obj.position.y = h.info.y + Math.sin(now * 0.8 + h.info.x) * 0.3;
    }
  }
}
