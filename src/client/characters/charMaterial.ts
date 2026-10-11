// Matériaux des personnages augmentés : le matériau voxel des objets (render/voxelObjectMaterial)
// complété, sans le modifier, de ce qu'exigent les implants :
// - emplacements lumineux 48 à 63 (couleur de l'implant gardée dans le sommet, intensité lue
//   dans la texture d'état du personnage : un canal par organe, voir GLOW_CH) ;
// - iris lumineux (vision thermique, nocturne, marqueur, scanner) ;
// - peau traitée par le shader (fibres balistiques du derme, cellules hexagonales du camouflage,
//   reflet bleuté de l'isolant, gel violet, veines argentées des nanobots) ;
// - surbrillance d'un membre (attribut d'instance aFx.x) : liseré pulsé, pour la cible visée ou
//   l'emplacement survolé dans l'écran d'équipement ;
// - vision thermique (signatures de chaleur sans éclairage : cœur blanc-jaune, bords rouges) et
//   vision nocturne (personnages un peu plus lisibles), au choix du rendu (setVision) ;
// - camouflage optique : passe dédiée (quelques personnages) qui dessine l'arrière-plan réfracté
//   (copie de l'image) à travers une silhouette frémissante, cellules hexagonales qui basculent
//   une à une à l'activation ;
// - silhouettes thermiques à travers les murs (setXray) : passe sans test de profondeur.

import * as THREE from 'three';
import { createObjectMaterial, PALETTE_ROWS } from '../render/voxelObjectMaterial';

export type VisionMode = 'normal' | 'thermal' | 'night';
const VISION_ID: Record<VisionMode, number> = { normal: 0, thermal: 1, night: 2 };

/** Colonnes de la texture d'état (par ligne de palette, c.-à-d. par personnage). */
export const STATE_COLS = 32;
const COL_EYE = 16;
const COL_SKIN = 17;

/** Dégradé thermique (GLSL) : froid violet → rouge → orange → jaune → blanc. */
const THERMAL_GLSL = /* glsl */ `
vec3 cyThermal(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 c = mix(vec3(0.16, 0.02, 0.22), vec3(0.85, 0.07, 0.05), smoothstep(0.0, 0.42, h));
  c = mix(c, vec3(1.0, 0.45, 0.04), smoothstep(0.38, 0.64, h));
  c = mix(c, vec3(1.0, 0.88, 0.28), smoothstep(0.6, 0.84, h));
  return mix(c, vec3(1.0, 1.0, 0.9), smoothstep(0.84, 1.0, h));
}
vec4 cyHex(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  vec4 r = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 9.73);
  vec2 a = abs(r.xy);
  return vec4(0.5 - max(dot(a, s * 0.5), a.x), r.zw, 0.0);
}`;

/**
 * Données de shader partagées par les matériaux d'un rendu de personnages : texture d'état
 * (32 colonnes × une ligne par personnage), mode de vision, couleur de surbrillance, copie de
 * l'image pour le camouflage.
 */
export class CyberShaderData {
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  readonly uniforms: {
    uCyberTex: { value: THREE.DataTexture };
    uVision: { value: number };
    uHlColor: { value: THREE.Color };
    uSceneTex: { value: THREE.Texture | null };
    uScreenSize: { value: THREE.Vector2 };
  };
  vision: VisionMode = 'normal';
  private dirty = new Set<number>();
  private gpuReady = false;
  private frameTex: THREE.FramebufferTexture | null = null;
  private copiedFrame = -1;
  /** Image courante (incrémentée par le rendu des personnages avant chaque image). */
  frameId = 0;
  readonly rows: number;

  constructor(rows = PALETTE_ROWS) {
    this.rows = rows;
    this.data = new Uint8Array(STATE_COLS * rows * 4);
    this.texture = new THREE.DataTexture(this.data, STATE_COLS, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    // tant que la texture n'a pas été envoyée une première fois en entier, pas de mise à jour partielle
    this.texture.onUpdate = () => (this.gpuReady = true);
    this.uniforms = {
      uCyberTex: { value: this.texture },
      uVision: { value: 0 },
      uHlColor: { value: new THREE.Color(0x46d8ff) },
      uSceneTex: { value: null },
      uScreenSize: { value: new THREE.Vector2(1, 1) },
    };
  }

  setVision(mode: VisionMode): void {
    this.vision = mode;
    this.uniforms.uVision.value = VISION_ID[mode] ?? 0;
  }

  private put(row: number, col: number, r: number, g: number, b: number, a: number): void {
    const k = (row * STATE_COLS + col) * 4;
    const d = this.data;
    const R = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
    const G = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
    const B = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    const A = a < 0 ? 0 : a > 255 ? 255 : Math.round(a);
    if (d[k] === R && d[k + 1] === G && d[k + 2] === B && d[k + 3] === A) return;
    d[k] = R;
    d[k + 1] = G;
    d[k + 2] = B;
    d[k + 3] = A;
    this.dirty.add(row);
  }

  /**
   * Intensité d'un canal lumineux : `k` (0 à 8), pulsation (amplitude 0..1, fréquence en Hz),
   * scintillement (0..1).
   */
  setGlow(row: number, ch: number, k: number, pulse = 0, hz = 0, flicker = 0): void {
    this.put(row, ch, (k / 8) * 255, pulse * 255, hz * 10, flicker * 255);
  }

  /** Iris lumineux (couleur sRGB, intensité 0..8 ; 0 = yeux naturels). */
  setEye(row: number, rgb: number, k: number): void {
    this.put(row, COL_EYE, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, (k / 8) * 255);
  }

  /** Peau : mode (0 aucun, 1 derme, 2 camouflage, 3 isolant, 4 gel), intensité, veines des nanobots. */
  setSkin(row: number, mode: number, strength: number, veins: number): void {
    this.put(row, COL_SKIN, mode, strength * 255, veins * 255, 0);
  }

  clearRow(row: number): void {
    const k = row * STATE_COLS * 4;
    let any = false;
    for (let i = 0; i < STATE_COLS * 4; i++) {
      if (this.data[k + i]) any = true;
      this.data[k + i] = 0;
    }
    if (any) this.dirty.add(row);
  }

  /** Envoie les lignes modifiées (mise à jour partielle une fois la texture en place). */
  flush(): void {
    if (!this.dirty.size) return;
    if (this.gpuReady) for (const row of this.dirty) this.texture.addUpdateRange(row * STATE_COLS * 4, STATE_COLS * 4);
    else this.texture.clearUpdateRanges();
    this.texture.needsUpdate = true;
    this.dirty.clear();
  }

  /**
   * Copie l'image en cours (opaques déjà dessinés) pour la réfraction du camouflage : une seule
   * fois par image, juste avant le premier personnage camouflé.
   */
  copyScene(renderer: THREE.WebGLRenderer): void {
    if (this.copiedFrame === this.frameId) return;
    this.copiedFrame = this.frameId;
    const rt = renderer.getRenderTarget();
    let w: number;
    let h: number;
    if (rt) {
      // une cible multiéchantillonnée ne peut pas être copiée : réfraction sans arrière-plan
      if ((rt as THREE.WebGLRenderTarget).samples > 0) {
        this.uniforms.uSceneTex.value = null;
        return;
      }
      w = rt.width;
      h = rt.height;
    } else {
      const v = renderer.getDrawingBufferSize(_v2);
      w = v.x;
      h = v.y;
    }
    if (w < 4 || h < 4) return;
    if (!this.frameTex || this.frameTex.image.width !== w || this.frameTex.image.height !== h) {
      this.frameTex?.dispose();
      this.frameTex = new THREE.FramebufferTexture(w, h);
      this.frameTex.minFilter = THREE.LinearFilter;
      this.frameTex.magFilter = THREE.LinearFilter;
    }
    renderer.copyFramebufferToTexture(this.frameTex);
    this.uniforms.uSceneTex.value = this.frameTex;
    this.uniforms.uScreenSize.value.set(w, h);
  }

  dispose(): void {
    this.texture.dispose();
    this.frameTex?.dispose();
  }
}

const _v2 = new THREE.Vector2();

/**
 * Complète un matériau d'objet voxel (createObjectMaterial) : emplacements lumineux, iris,
 * peau, surbrillance, visions ; `camo` : variante de la passe de camouflage.
 */
export function patchCharMaterial(mat: THREE.MeshLambertMaterial, cd: CyberShaderData, camo = false): THREE.MeshLambertMaterial {
  const base = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    Object.assign(shader.uniforms, cd.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aFx;
varying vec2 vFx;
varying vec3 vLocal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFx = aFx;
vLocal = position;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${camo ? '#define CYBER_CAMO' : ''}
uniform sampler2D uCyberTex;
uniform float uVision;
uniform vec3 uHlColor;
uniform sampler2D uSceneTex;
uniform vec2 uScreenSize;
varying vec2 vFx;
varying vec3 vLocal;
${THERMAL_GLSL}`,
      )
      .replace(
        'diffuseColor.rgb = albedo;',
        `diffuseColor.rgb = albedo;
if (vSlot >= 48) {
  // implant lumineux : couleur du sommet, intensité du canal (texture d'état du personnage)
  int gch = vSlot - 48;
  vec4 gi = texelFetch(uCyberTex, ivec2(gch, vRow), 0);
  float gk = gi.r * 8.0;
  float gp = 1.0 + gi.g * sin(uTime * gi.b * 25.5 * 6.2832 + float(vRow) * 1.7 - vLocal.y * 14.0);
  float gf = 1.0;
  if (gi.a > 0.0) gf = mix(1.0, 0.3 + 0.7 * step(0.3, h12(vec2(floor(uTime * 26.0), float(vRow * 16 + gch)))), gi.a);
  vec3 gc = pow(vColor.rgb, vec3(2.2));
  // éteint : verre teinté sombre ; allumé : la couleur vient de l'émission (saturée)
  albedo = gc * mix(0.3, 0.05, clamp(gk, 0.0, 1.0)) + vec3(0.01);
  diffuseColor.rgb = albedo;
  gEm = gc * gk * max(gp, 0.0) * gf;
  gSpec = 0.15;
} else if (vSlot == 28) {
  vec4 eg = texelFetch(uCyberTex, ivec2(${COL_EYE}, vRow), 0);
  if (eg.a > 0.0) {
    vec3 ec = pow(eg.rgb, vec3(2.2));
    albedo = ec;
    diffuseColor.rgb = ec;
    gEm = ec * eg.a * 8.0 * (0.85 + 0.15 * sin(uTime * 3.1 + float(vRow)));
  }
} else if (vSlot == 16 || vSlot == 32 || vSlot == 33) {
  vec4 sk = texelFetch(uCyberTex, ivec2(${COL_SKIN}, vRow), 0);
  int smode = int(sk.r * 255.0 + 0.5);
  if (smode > 0 || sk.b > 0.0) {
    vec3 sq = floor(vLocal * 64.0 + 0.5);
    float st = sk.g;
    if (smode == 1) {
      // derme : tissage de fibres métalliques en diagonale
      float wv = mod(sq.x + sq.y + sq.z, 3.0) < 1.0 ? 1.0 : 0.0;
      float wv2 = mod(sq.x - sq.y + sq.z, 4.0) < 1.0 ? 1.0 : 0.0;
      albedo = mix(albedo, albedo * 0.62 + vec3(0.05, 0.055, 0.06), max(wv, wv2 * 0.6) * 0.55 * st);
      gSpec = max(gSpec, 0.35 * st);
    } else if (smode == 2) {
      // camouflage : cellules réfractives hexagonales à peine visibles
      vec4 hx = cyHex(vec2(vLocal.x + vLocal.z * 0.7, vLocal.y) * 52.0);
      float ln = 1.0 - smoothstep(0.0, 0.07, hx.x);
      albedo = mix(albedo, albedo * vec3(0.8, 1.05, 1.15), ln * 0.45 * st);
      gEm += vec3(0.25, 0.75, 0.85) * ln * 0.05 * st;
      gSpec = max(gSpec, 0.2 * st);
    } else if (smode == 3) {
      // isolant : reflet bleuté
      albedo = mix(albedo, albedo * vec3(0.78, 0.9, 1.18), 0.45 * st);
      gSpec = max(gSpec, 0.55 * st);
    } else if (smode == 4) {
      // gel balistique : film violet translucide
      albedo = mix(albedo, albedo * vec3(1.02, 0.82, 1.2), 0.45 * st);
      gSpec = max(gSpec, 0.75 * st);
      gEm += vec3(0.05, 0.015, 0.08) * st;
    }
    if (sk.b > 0.0) {
      // nanobots : veines argentées qui scintillent
      float vn = abs(vnoise(vec2(vLocal.x * 70.0 + vLocal.z * 45.0, vLocal.y * 70.0)) - 0.5);
      float vein = 1.0 - smoothstep(0.02, 0.06, vn);
      albedo = mix(albedo, vec3(0.62, 0.66, 0.7), vein * 0.75 * sk.b);
      gEm += vec3(0.35, 0.95, 0.55) * vein * sk.b * (0.06 + 0.08 * (0.5 + 0.5 * sin(uTime * 3.0 + vLocal.y * 40.0)));
      gSpec = max(gSpec, 0.4 * vein * sk.b);
    }
    diffuseColor.rgb = albedo;
  }
}`,
      )
      .replace(
        'totalEmissiveRadiance += gEm;',
        `totalEmissiveRadiance += gEm;
if (vFx.x > 0.0) {
  // surbrillance : liseré pulsé (cible, emplacement d'implant survolé)
  vec3 hlv = normalize(cameraPosition - vWPos);
  float hlf = pow(1.0 - max(dot(hlv, wn), 0.0), 2.0);
  totalEmissiveRadiance += uHlColor * vFx.x * (0.6 + 0.4 * sin(uTime * 5.5)) * (0.22 + 1.2 * hlf);
}`,
      )
      .replace(
        '#include <premultiplied_alpha_fragment>',
        `{
  vec3 tv = normalize(cameraPosition - vWPos);
  float tf = max(dot(tv, wn), 0.0);
#ifdef CYBER_CAMO
  // camouflage optique : arrière-plan réfracté, cellules qui basculent à l'activation
  vec4 hx = cyHex(vec2(vLocal.x + vLocal.z * 0.8, vLocal.y) * 30.0);
  float cellT = h12(hx.yz);
  float inv = smoothstep(cellT - 0.12, cellT + 0.02, vFx.y * 1.18 - 0.1);
  float rim = pow(1.0 - tf, 3.0);
  vec3 vnn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  vec2 wob = vec2(sin(uTime * 2.3 + vWPos.y * 13.0 + vWPos.x * 5.0), cos(uTime * 1.9 + vWPos.y * 11.0 - vWPos.z * 6.0));
  vec2 suv = gl_FragCoord.xy / uScreenSize;
  vec2 off = vnn.xy * (0.012 + 0.03 * rim) + wob * 0.0035;
  vec3 bg = texture2D(uSceneTex, clamp(suv - off, vec2(0.001), vec2(0.999))).rgb;
  float edge = 1.0 - smoothstep(0.0, 0.05, hx.x);
  float shim = 0.6 + 0.4 * sin(uTime * 4.5 + vWPos.y * 21.0 + vWPos.x * 7.0);
  vec3 ccol = bg * vec3(0.93, 0.98, 1.03) + vec3(0.45, 0.9, 1.0) * (rim * 0.3 + edge * 0.05) * shim;
  // bord des cellules qui basculent : un éclat bref
  float flip = smoothstep(0.0, 0.08, inv) * (1.0 - smoothstep(0.08, 0.3, inv));
  ccol += vec3(0.5, 0.95, 1.0) * flip * 0.6;
  if (uVision > 0.5 && uVision < 1.5) ccol = mix(ccol, cyThermal(0.38 + 0.25 * tf), 0.25);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, ccol, inv);
#else
  if (uVision > 0.5 && uVision < 1.5) {
    // vision thermique : signature de chaleur sans éclairage
    float temp = 0.82;
    if (vSlot == 16 || vSlot == 32 || vSlot == 33 || vSlot == 34) temp = 1.0;
    else if (vSlot >= 48) temp = 0.95;
    else if (vSlot == 0) temp = 0.52;
    else if (vSlot == 17 || vSlot == 24 || vSlot == 25) temp = 0.7;
    gl_FragColor.rgb = cyThermal(temp * (0.4 + 0.6 * pow(tf, 0.7)));
  } else if (uVision > 1.5) {
    // vision nocturne : amplification (l'étalonnage vert est appliqué à l'écran)
    gl_FragColor.rgb = gl_FragColor.rgb * 1.35 + diffuseColor.rgb * 0.05;
  }
#endif
}
#include <premultiplied_alpha_fragment>`,
      );
    if (!shader.fragmentShader.includes('uCyberTex, ivec2(gch')) console.warn('charMaterial : point d’insertion introuvable (matériau des objets modifié ?)');
  };
  mat.customProgramCacheKey = () => `${baseKey}-cyber-v1${camo ? '-camo' : ''}`;
  if (camo) {
    mat.transparent = true;
    mat.depthWrite = false;
  }
  return mat;
}

/** Matériau principal des personnages (palette par instance, implants). */
export function createCharMaterial(cd: CyberShaderData, key = 'chars'): THREE.MeshLambertMaterial {
  return patchCharMaterial(createObjectMaterial({ palette: true, key }), cd);
}

/** Matériau de la passe de camouflage. */
export function createCamoMaterial(cd: CyberShaderData, key = 'chars'): THREE.MeshLambertMaterial {
  return patchCharMaterial(createObjectMaterial({ palette: true, key }), cd, true);
}

/** Silhouettes thermiques vues à travers les murs (sans test de profondeur, additives). */
export function createXrayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vN = normalize(mat3(m) * normal);
  vV = cameraPosition - wp.xyz;
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying float vY;
${THERMAL_GLSL}
void main() {
  float f = max(dot(normalize(vV), normalize(vN)), 0.0);
  float scan = 0.85 + 0.15 * sin(vY * 60.0 - uTime * 8.0);
  vec3 c = cyThermal(0.45 + 0.5 * pow(f, 0.8)) * scan;
  gl_FragColor = vec4(c * 0.55, 1.0);
}`,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
}
