// Ligne d'horizon de New York 2085 autour de la ville jouable : tours de Upper Manhattan au nord,
// Long Island City (Queens) et Downtown Brooklyn de l'autre côté de l'East River, Jersey City
// derrière l'Hudson, et la statue de la Liberté dans la baie. Un seul maillage instancié pour les
// tours (fenêtres, bandeaux de LED, couronnes), des points pour les feux d'obstacle clignotants.

import * as THREE from 'three';
import { envUniforms } from './env';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL } from './shaderChunks';
import { RIVER_X0, RIVER_X1, WORLD_D, WORLD_W } from '../../shared/city/plan';

// brouillard allégé : les silhouettes lointaines restent lisibles dans le smog
const FAR_FOG_GLSL = /* glsl */ `
vec3 farFog(vec3 col, vec3 wpos, float k) {
  float dist = length(wpos - cameraPosition);
  float h = clamp(wpos.y, 0.0, 120.0);
  float dens = uFogDensity * k * (0.35 + 0.65 * exp(-h * uFogHeightK));
  float f = 1.0 - exp(-dist * dens);
  return mix(col, uFogColor, clamp(f, 0.0, 1.0));
}
`;

const TOWER_VERT = /* glsl */ `
attribute vec4 aInfo;
varying vec3 vW;
varying vec3 vN;
varying vec4 vInfo;
varying float vTop;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normal;
  vInfo = aInfo;
  vTop = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);
}
`;

const TOWER_FRAG = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${FAR_FOG_GLSL}
varying vec3 vW;
varying vec3 vN;
varying vec4 vInfo;
varying float vTop;
void main() {
  vec3 n = normalize(vN);
  float seed = vInfo.x;
  vec3 base = mix(vec3(0.05, 0.055, 0.07), vec3(0.09, 0.085, 0.1), fract(seed * 7.13));
  // le jour : béton et verre gris-bleu
  vec3 dayCol = mix(vec3(0.42, 0.45, 0.52), vec3(0.58, 0.56, 0.54), fract(seed * 3.7));
  vec3 col = mix(dayCol, base, uNight);
  vec3 emi = vec3(0.0);
  if (abs(n.y) < 0.5) {
    float u = abs(n.x) > 0.5 ? vW.z : vW.x;
    float fy = vW.y / 3.3;
    float fx = u / (2.0 + fract(seed * 3.3) * 1.4);
    vec2 cell = floor(vec2(fx, fy));
    vec2 f = fract(vec2(fx, fy));
    float glassy = step(0.5, fract(seed * 5.9));
    float isWin = glassy > 0.5 ? step(0.08, f.x) * step(0.12, f.y) * step(f.y, 0.9) : step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.78);
    float litP = (0.1 + 0.42 * uNight) * vInfo.y;
    float lit = step(1.0 - litP, h12(cell + seed * 91.0));
    float hue = h12(cell * 0.37 + seed * 13.0);
    vec3 wc = hue < 0.62 ? vec3(1.0, 0.8, 0.55) : hue < 0.86 ? vec3(0.45, 0.85, 1.0) : vec3(1.0, 0.42, 0.85);
    col = mix(col, col * 0.75 + vec3(0.08, 0.1, 0.14) * (1.0 - uNight), isWin * 0.7);
    emi += wc * isWin * lit * mix(0.06, 0.85, uNight);
    // bandeau de LED près du sommet, ou arêtes lumineuses
    float band = vInfo.z;
    if (band > 0.5) {
      vec3 bc = band < 1.5 ? vec3(1.0, 0.15, 0.55) : band < 2.5 ? vec3(0.1, 0.85, 1.0) : band < 3.5 ? vec3(0.95, 0.75, 0.25) : vec3(0.6, 0.3, 1.0);
      float b = step(vTop - 2.4, vW.y) * step(vW.y, vTop - 1.2);
      // rangée de LED qui défilent sur certaines tours
      float run = step(0.5, fract(seed * 17.0)) * (0.5 + 0.5 * sin(u * 0.6 - uTime * 3.0 + seed * 40.0));
      emi += bc * b * mix(0.5, 2.2, uNight) * (0.7 + 0.6 * run);
      float edge = step(0.5, fract(seed * 23.0)) * step(abs(fract(u / 4.0) - 0.5), 0.03) * step(vTop * 0.15, vW.y);
      emi += bc * edge * 0.5 * uNight;
    }
    // panneau publicitaire géant (écran) sur quelques tours
    if (vInfo.w > 0.5) {
      float y0 = vTop * 0.45;
      float y1 = vTop * 0.75;
      float inside = step(y0, vW.y) * step(vW.y, y1);
      vec3 ad = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + uTime * 0.08 + seed * 5.0 + vW.y * 0.02));
      float scan = 0.82 + 0.18 * step(0.5, fract(vW.y * 2.0));
      emi = mix(emi, ad * scan * mix(0.6, 1.6, uNight), inside);
    }
  } else if (n.y > 0.5) {
    col *= 0.6;
  }
  vec3 lightC = mix(vec3(0.95, 0.93, 0.9), uSkyAmb * 1.4 + vec3(0.02, 0.015, 0.03), uNight);
  float shade = abs(n.x) > 0.5 ? 0.82 : abs(n.z) > 0.5 ? 1.0 : 1.1;
  vec3 c = col * lightC * shade + emi;
  // la pluie de néons au pied des tours (halo de la ville)
  c += vec3(0.25, 0.08, 0.3) * uNight * exp(-vW.y * 0.06) * 0.25;
  c = farFog(c, vW, 0.55);
  // les fenêtres et LED percent un peu le brouillard
  c += emi * 0.18 * smoothstep(60.0, 260.0, length(vW - cameraPosition));
  gl_FragColor = vec4(c, 1.0);
}
`;

const LIGHT_VERT = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
attribute float aPhase;
varying float vOn;
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vOn = step(0.45, fract(uTime * 0.55 + aPhase));
  vec4 mv = viewMatrix * wp;
  gl_PointSize = clamp(260.0 / -mv.z, 2.0, 9.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99998);
}
`;

const LIGHT_FRAG = /* glsl */ `
varying float vOn;
varying vec3 vW;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c)) * vOn;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(1.0, 0.1, 0.06) * 2.0 * a, a);
}
`;

const STATUE_FRAG = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${FAR_FOG_GLSL}
uniform vec3 uColor;
uniform float uGlow;
uniform float uUp;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  float shade = 0.55 + 0.45 * max(0.0, dot(n, normalize(vec3(0.4, 0.7, 0.3))));
  vec3 lightC = mix(vec3(1.0, 0.97, 0.92), uSkyAmb * 1.3 + vec3(0.03), uNight);
  vec3 c = uColor * lightC * shade;
  // projecteurs au pied : la statue est éclairée par en dessous la nuit
  c += uColor * vec3(0.55, 0.95, 0.9) * uNight * (0.45 + 0.55 * exp(-max(0.0, vW.y - 20.0) * 0.025)) * 1.3 * uUp;
  c += uGlow * vec3(1.0, 0.75, 0.3) * 3.0;
  c = farFog(c, vW, uUp > 0.5 ? 0.3 : 0.5);
  // la flamme perce le brouillard
  c += uGlow * vec3(1.0, 0.7, 0.25) * 0.8;
  gl_FragColor = vec4(c, 1.0);
}
`;

const STATUE_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);
}
`;

interface Tower {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y: number;
  lit: number;
  band: number;
  ad: number;
  seed: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Génère les tours d'une zone (rectangle), plus hautes près des « centres » donnés. */
function zone(out: Tower[], r: () => number, x0: number, z0: number, x1: number, z1: number, base: [number, number], centers: { x: number; z: number; h: number; s: number }[], cell = 26, fill = 0.72): void {
  for (let gx = x0; gx < x1; gx += cell) {
    for (let gz = z0; gz < z1; gz += cell) {
      if (r() > fill) continue;
      const w = 10 + r() * 14;
      const d = 10 + r() * 14;
      const x = gx + cell / 2 + (r() - 0.5) * (cell - w) * 0.8;
      const z = gz + cell / 2 + (r() - 0.5) * (cell - d) * 0.8;
      let h = base[0] + r() * (base[1] - base[0]);
      for (const c of centers) {
        const k = Math.exp(-((x - c.x) ** 2 + (z - c.z) ** 2) / (2 * c.s * c.s));
        h += c.h * k * (0.45 + r() * 0.75);
      }
      out.push({ x, z, w, d, h, y: 0, lit: 0.6 + r() * 0.5, band: r() < 0.32 ? 1 + Math.floor(r() * 4) : 0, ad: h > 45 && r() < 0.12 ? 1 : 0, seed: r() });
    }
  }
}

export interface Skyline {
  group: THREE.Group;
  /** Lueur de la flamme de la statue (vacille). */
  update(now: number): void;
}

export function createSkyline(): Skyline {
  const r = rng(2085);
  const towers: Tower[] = [];
  // Upper Manhattan (au nord, au-delà de Central Park) : tours résidentielles et quelques géantes
  zone(towers, r, 0, -330, RIVER_X0 - 6, -24, [18, 55], [
    { x: 90, z: -60, h: 70, s: 50 },
    { x: 40, z: -200, h: 35, s: 70 },
  ]);
  // Long Island City (Queens, au nord-est) : tours de verre au bord de l'eau
  zone(towers, r, RIVER_X1 + 8, -300, WORLD_W + 320, -22, [14, 40], [{ x: RIVER_X1 + 40, z: -40, h: 85, s: 45 }]);
  // Queens et Brooklyn à l'est
  zone(towers, r, WORLD_W + 22, -22, WORLD_W + 330, WORLD_D + 20, [12, 34], [{ x: WORLD_W + 60, z: 60, h: 30, s: 60 }], 28, 0.6);
  // Downtown Brooklyn (au sud) : nouvelles tours
  zone(towers, r, RIVER_X1 + 8, WORLD_D + 22, WORLD_W + 330, WORLD_D + 320, [14, 38], [{ x: RIVER_X1 + 50, z: WORLD_D + 60, h: 95, s: 45 }]);
  // Jersey City, de l'autre côté de l'Hudson
  zone(towers, r, -560, -260, -330, WORLD_D + 260, [16, 50], [
    { x: -350, z: 150, h: 110, s: 70 },
    { x: -360, z: -60, h: 50, s: 80 },
  ], 30, 0.65);
  // gradins et flèches : on empile des volumes plus étroits sur les grandes tours
  const extra: Tower[] = [];
  const lights: number[] = [];
  const phases: number[] = [];
  for (const t of towers) {
    let top = t.h;
    if (t.h > 60 && r() < 0.7) {
      const s1 = 0.62 + r() * 0.2;
      const h1 = t.h * (0.12 + r() * 0.18);
      extra.push({ ...t, w: t.w * s1, d: t.d * s1, h: h1, y: top, band: t.band || (r() < 0.5 ? 1 + Math.floor(r() * 4) : 0), ad: 0, seed: r() });
      top += h1;
      if (r() < 0.5) {
        const s2 = s1 * (0.55 + r() * 0.2);
        const h2 = t.h * (0.06 + r() * 0.1);
        extra.push({ ...t, w: t.w * s2, d: t.d * s2, h: h2, y: top, band: 0, ad: 0, seed: r() });
        top += h2;
      }
    }
    if (t.h > 50 && r() < 0.45) {
      const hs = 8 + r() * 18;
      extra.push({ ...t, w: 0.7, d: 0.7, h: hs, y: top, band: 0, ad: 0, lit: 0, seed: r() });
      top += hs;
    }
    if (top > 45) {
      lights.push(t.x, top + 0.6, t.z);
      phases.push(r());
    }
  }
  const cx = WORLD_W / 2;
  const cz = WORLD_D / 2;
  const all = towers.concat(extra).sort((a, b) => Math.hypot(b.x - cx, b.z - cz) - Math.hypot(a.x - cx, a.z - cz) || a.y - b.y);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const info = new Float32Array(all.length * 4);
  all.forEach((t, i) => {
    info[i * 4] = t.seed;
    info[i * 4 + 1] = t.lit;
    info[i * 4 + 2] = t.band;
    info[i * 4 + 3] = t.ad;
  });
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  const mat = new THREE.ShaderMaterial({ vertexShader: TOWER_VERT, fragmentShader: TOWER_FRAG, uniforms: { ...envUniforms } });
  mat.toneMapped = false;
  const mesh = new THREE.InstancedMesh(geo, mat, all.length);
  const m = new THREE.Matrix4();
  all.forEach((t, i) => {
    m.makeScale(t.w, t.h, t.d);
    m.setPosition(t.x, t.y - 0.05, t.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.name = 'horizon';
  const group = new THREE.Group();
  group.name = 'ligne d’horizon';
  group.add(mesh);
  // feux d'obstacle
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3));
  lg.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  const lmat = new THREE.ShaderMaterial({ vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG, uniforms: { ...envUniforms }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  lmat.toneMapped = false;
  const pts = new THREE.Points(lg, lmat);
  pts.frustumCulled = false;
  group.add(pts);
  // sol de Jersey City (l'Hudson s'arrête au quai)
  const groundMat = new THREE.ShaderMaterial({ vertexShader: STATUE_VERT, fragmentShader: STATUE_FRAG, uniforms: { ...envUniforms, uColor: { value: new THREE.Color(0x1c1e22) }, uGlow: { value: 0 }, uUp: { value: 0 } } });
  groundMat.toneMapped = false;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, WORLD_D + 1400).rotateX(-Math.PI / 2), groundMat);
  ground.position.set(-320 - 200, -0.02, WORLD_D / 2);
  ground.frustumCulled = false;
  group.add(ground);
  // statue de la Liberté, dans la baie au sud-ouest
  const statue = buildStatue();
  statue.group.position.set(-95, 0, WORLD_D + 175);
  statue.group.rotation.y = Math.PI * 0.8;
  group.add(statue.group);
  return {
    group,
    update(now: number) {
      statue.flame.uniforms.uGlow.value = 0.85 + 0.15 * Math.sin(now * 7.3) * Math.sin(now * 3.1);
    },
  };
}

function buildStatue(): { group: THREE.Group; flame: THREE.ShaderMaterial } {
  const g = new THREE.Group();
  const mk = (color: number, glow = 0): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({ vertexShader: STATUE_VERT, fragmentShader: STATUE_FRAG, uniforms: { ...envUniforms, uColor: { value: new THREE.Color(color) }, uGlow: { value: glow }, uUp: { value: 1 } } });
    m.toneMapped = false;
    return m;
  };
  const stone = mk(0x8a8478);
  const copper = mk(0x5fae96);
  const flame = mk(0xffb040, 1);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    // au-delà du plan lointain : jamais écartée (la profondeur est plafonnée dans le shader)
    mesh.frustumCulled = false;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    g.add(mesh);
    return mesh;
  };
  // île et fort en étoile
  add(new THREE.CylinderGeometry(26, 28, 2, 10), stone, 0, 0, 0);
  const fort = add(new THREE.BoxGeometry(22, 5, 22), stone, 0, 3.5, 0);
  fort.rotation.y = Math.PI / 4;
  add(new THREE.BoxGeometry(22, 5, 22), stone, 0, 3.5, 0);
  // piédestal
  add(new THREE.BoxGeometry(12, 14, 12), stone, 0, 13, 0);
  add(new THREE.BoxGeometry(9.5, 10, 9.5), stone, 0, 25, 0);
  add(new THREE.BoxGeometry(11, 1.6, 11), stone, 0, 30.6, 0);
  // drapé : corps conique
  add(new THREE.CylinderGeometry(2.3, 4.2, 20, 12), copper, 0, 41.4, 0);
  add(new THREE.CylinderGeometry(1.6, 2.3, 6, 12), copper, 0, 54.4, 0);
  // tête et couronne
  add(new THREE.SphereGeometry(1.7, 12, 10), copper, 0, 59, 0);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + ((i - 3) / 3) * 1.1;
    const spike = add(new THREE.ConeGeometry(0.22, 2.6, 5), copper, Math.sin(a) * 1.6, 60.3, Math.cos(a) * 1.6);
    spike.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
  }
  // bras droit levé, flambeau
  add(new THREE.CylinderGeometry(0.7, 0.9, 10, 8), copper, 1.6, 61.5, 0, 0, -0.18);
  add(new THREE.CylinderGeometry(0.75, 0.45, 2.2, 8), mk(0xb89a50), 2.55, 67.4, 0);
  add(new THREE.SphereGeometry(1.3, 10, 8), flame, 2.6, 69.3, 0);
  // halo de la flamme, visible de loin
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: STATUE_VERT,
    fragmentShader: /* glsl */ `
varying vec3 vW;
varying vec3 vN;
void main() {
  float f = pow(max(0.0, dot(normalize(vN), normalize(cameraPosition - vW))), 2.0);
  gl_FragColor = vec4(vec3(1.0, 0.62, 0.22) * f * 0.55, 1.0);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  haloMat.toneMapped = false;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 10), haloMat);
  halo.position.set(2.6, 69.3, 0);
  halo.frustumCulled = false;
  g.add(halo);
  // bras gauche et tablette
  add(new THREE.BoxGeometry(1.2, 4.2, 2.6), copper, -2.7, 49.5, 0.6, 0.2, 0.1);
  return { group: g, flame };
}
