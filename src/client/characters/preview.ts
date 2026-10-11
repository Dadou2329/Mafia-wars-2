// Aperçu 3D d'un personnage (écran CYBERNÉTIQUE : le parrain et ses implants) : le moteur des
// personnages dessine un seul personnage dans son propre canevas, au repos, sur un plateau qui
// tourne lentement ; on le fait pivoter en le glissant. highlightSlot() entoure d'un liseré pulsé
// la région du corps de l'emplacement survolé, tourne le personnage pour la présenter et cadre
// au plus près (tête pour les implants neuraux et oculaires, jambes…) ; une arme de bras de
// l'emplacement choisi est montrée sortie, le bouclier allumé.
//
// Utilisation (src/client/game/cyberUi.ts) :
//
//   const p = createCharacterPreview(canvas, { interactive: true, rotate: true, background: null });
//   p.setLook(CharKind.BOSS_DADOU, settings.custom.dadou, cyberLook(equip, owned));
//   p.highlightSlot('brasG');      // emplacement survolé ou choisi, null pour aucun
//   p.render(dt);                  // à chaque image tant que l'écran est ouvert
//   p.dispose();                   // à la fermeture : contexte WebGL et lignes de palette rendus
//
// La taille de l'image suit canvas.width × canvas.height (en pixels de l'écran, déjà multipliés
// par devicePixelRatio par l'appelant). L'éclairage est propre à l'aperçu (indépendant de l'heure
// et du quartier) : pendant le rendu, les volumes de lumière de la ville sont remplacés par un
// ciel uniforme, puis rétablis.

import * as THREE from 'three';
import { Anim, CharKind, IMPLANT_ARM_WEAPON, Weapon } from '../../shared/characters';
import { CFX, parseCyberLook, type SlotId } from '../../shared/implants';
import { envUniforms } from '../render/env';
import { CharacterRenderer, type CharView } from './characterRenderer';
import { regionOfSlot, type BodyRegion } from './cyber';
import type { BossCustom } from './styles';

export interface CharacterPreviewOptions {
  /** Glisser (souris, doigt) pour tourner le personnage. Défaut : vrai. */
  interactive?: boolean;
  /** Rotation lente du plateau quand on ne touche à rien. Défaut : vrai. */
  rotate?: boolean;
  /** Couleur du fond (sRGB) ; null ou absent : fond transparent. */
  background?: number | null;
  /** Couleur de la surbrillance des emplacements (sRGB). Défaut : 0x46d8ff. */
  highlightColor?: number;
  /** Anticrénelage (plus coûteux). Défaut : vrai. */
  antialias?: boolean;
}

export interface CharacterPreview {
  /** Personnage montré : genre, personnalisation (parrains), implants « emplacement=identifiant:niveau ». */
  setLook(kind: CharKind, custom: BossCustom | Record<string, unknown> | undefined, cyber: string[] | null | undefined): void;
  /** Emplacement d'implant mis en valeur (liseré, rotation, cadrage) ; null : aucun. */
  highlightSlot(slot: SlotId | BodyRegion | null): void;
  /** Avance l'animation de `dt` secondes et dessine. */
  render(dt: number): void;
  /** Libère tout (le canevas reste à l'appelant). */
  dispose(): void;
}

/** Orientation présentée (rad, 0 = de face) et cadrage (hauteur visée, distance) par région du corps. */
const FRAMING: Record<BodyRegion, { yaw: number; y: number; dist: number }> = {
  all: { yaw: 0, y: 0.93, dist: 4.9 },
  skin: { yaw: 0.35, y: 0.93, dist: 4.9 },
  head: { yaw: 0.3, y: 1.58, dist: 2.05 },
  torso: { yaw: 0.25, y: 1.22, dist: 2.9 },
  spine: { yaw: Math.PI, y: 1.22, dist: 3.0 },
  armL: { yaw: -0.85, y: 1.05, dist: 3.1 },
  armR: { yaw: 0.85, y: 1.05, dist: 3.1 },
  legs: { yaw: 0.45, y: 0.55, dist: 3.2 },
};

/** Volume 3D minuscule (remplace les volumes de lumière de la ville pendant le rendu de l'aperçu). */
function tinyVolume(format: THREE.PixelFormat, channels: number, v: number[]): THREE.Data3DTexture {
  const data = new Uint8Array(8 * channels);
  for (let i = 0; i < 8; i++) for (let c = 0; c < channels; c++) data[i * channels + c] = v[c] ?? 0;
  const t = new THREE.Data3DTexture(data, 2, 2, 2);
  t.format = format;
  t.type = THREE.UnsignedByteType;
  t.needsUpdate = true;
  return t;
}

const angleTo = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function createCharacterPreview(canvas: HTMLCanvasElement, opts: CharacterPreviewOptions = {}): CharacterPreview {
  const interactive = opts.interactive ?? true;
  const rotate = opts.rotate ?? true;
  const bg = opts.background ?? null;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: opts.antialias ?? true });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(bg ?? 0x000000, bg === null ? 0 : 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40);
  // éclairage de studio : lumière principale chaude, contre-jour froid (silhouette), débouchage
  const keyLight = new THREE.DirectionalLight(0xfff0de, 2.3);
  keyLight.position.set(-2.2, 4, 3.2);
  const rimLight = new THREE.DirectionalLight(0x8fb6ff, 1.3);
  rimLight.position.set(2.6, 2.4, -3.2);
  const fillLight = new THREE.DirectionalLight(0xffd8bc, 0.45);
  fillLight.position.set(3.2, 1.2, 2.4);
  scene.add(keyLight, rimLight, fillLight);

  const chars = new CharacterRenderer();
  chars.setHighlightColor(opts.highlightColor ?? 0x46d8ff);
  scene.add(chars.group);

  // environnement propre à l'aperçu (échangé avec celui de la ville le temps du rendu)
  const own = {
    uLightTex: tinyVolume(THREE.RGFormat, 2, [255, 0]),
    uLightCoarse: tinyVolume(THREE.RGFormat, 2, [255, 0]),
    uTintTex: tinyVolume(THREE.RGBAFormat, 4, [0, 0, 0, 0]),
    // volume placé sous le plateau : tout point au-dessus reçoit le ciel entier, sans lampe
    uLightOrigin: new THREE.Vector3(0, -10, 0),
    uLightSize: new THREE.Vector3(1, 1, 1),
    uLightWin: new THREE.Vector4(-1e9, -1e9, 1e9, 1e9),
    uLightCoarseSize: new THREE.Vector3(1, 1, 1),
    uTintOrigin: new THREE.Vector3(0, -10, 0),
    uTintSize: new THREE.Vector3(1, 1, 1),
    uSkyAmb: new THREE.Color(0.46, 0.49, 0.56),
    uNight: 0.25,
    uFogDensity: 0,
    uWet: 0,
    uLampBoost: 1,
  };
  type EnvKey = keyof typeof own;
  const keys = Object.keys(own) as EnvKey[];
  const env = envUniforms as unknown as Record<EnvKey, { value: unknown }>;
  const swapEnv = () => {
    for (const k of keys) {
      const u = env[k];
      if (!u) continue;
      const v = u.value;
      u.value = own[k];
      (own as Record<EnvKey, unknown>)[k] = v;
    }
  };

  const view: CharView = {
    id: 1,
    kind: CharKind.BOSS_DADOU,
    faction: 1,
    look: 1,
    gang: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: 0,
    anim: Anim.IDLE,
    aiming: false,
    weapon: Weapon.FISTS,
    shotAt: -100,
    hitAt: -100,
    meleeAt: -100,
    interactAt: -100,
    deathAt: 0,
    cyber: [],
    fx: 0,
  };
  let cyberList: string[] = [];
  let slot: SlotId | BodyRegion | null = null;
  let clock = 0;
  // plateau : orientation, consigne (emplacement présenté), dernier geste de l'utilisateur
  let yaw = 0.35;
  let yawTarget: number | null = null;
  let lastTouch = -100;
  let camY = FRAMING.all.y;
  let camDist = FRAMING.all.dist;
  let lastW = 0;
  let lastH = 0;
  let disposed = false;

  /** Bits d'effets montrés pour l'emplacement choisi : arme de bras sortie, bouclier allumé. */
  const fxFor = (s: SlotId | BodyRegion | null): number => {
    if (s !== 'brasG' && s !== 'brasD') return 0;
    const it = parseCyberLook(cyberList).find((c) => c.slot === s);
    if (!it) return 0;
    if (IMPLANT_ARM_WEAPON[it.id] !== undefined) return s === 'brasG' ? CFX.ARM_L : CFX.ARM_R;
    if (it.id === 'bouclier') return CFX.SHIELD;
    return 0;
  };

  // --- rotation à la main
  let drag: { x: number; y0: number; id: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y0: yaw, id: e.pointerId };
    yawTarget = null;
    lastTouch = clock;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture indisponible */
    }
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    yaw = drag.y0 + (e.clientX - drag.x) * 0.012;
    lastTouch = clock;
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    lastTouch = clock;
  };
  if (interactive) {
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  return {
    setLook(kind, custom, cyber) {
      view.kind = kind;
      view.faction = kind === CharKind.BOSS_EVEN ? 2 : kind === CharKind.BOSS_DADOU ? 1 : 0;
      view.custom = (custom ?? undefined) as BossCustom | undefined;
      cyberList = cyber ? [...cyber] : [];
      view.cyber = cyberList;
      view.fx = fxFor(slot);
    },

    highlightSlot(s) {
      if (s === slot) return;
      slot = s;
      chars.highlightRegion(view.id, s);
      view.fx = fxFor(s);
      const region: BodyRegion = !s ? 'all' : (['armL', 'armR', 'legs', 'torso', 'spine', 'head', 'skin', 'all'] as string[]).includes(s) ? (s as BodyRegion) : regionOfSlot(s as SlotId);
      yawTarget = FRAMING[region].yaw;
      lastTouch = clock;
    },

    render(dt) {
      if (disposed) return;
      dt = Math.min(Math.max(dt, 0), 0.1);
      clock += dt;
      // taille de l'image (fixée par l'appelant sur le canevas)
      const w = Math.max(2, canvas.width);
      const h = Math.max(2, canvas.height);
      if (w !== lastW || h !== lastH) {
        lastW = w;
        lastH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      // plateau : vers l'emplacement présenté, sinon rotation lente après un moment sans geste
      if (!drag) {
        if (yawTarget !== null) {
          const d = angleTo(yaw, yawTarget);
          yaw += d * Math.min(1, dt * 4);
          if (Math.abs(d) < 0.002) yawTarget = null;
        } else if (rotate && clock - lastTouch > (slot ? 6 : 2.5)) yaw += dt * 0.32;
      }
      // cadrage : plus près des petites pièces (tête), un peu plus large en mode paysage
      const region: BodyRegion = !slot ? 'all' : (['armL', 'armR', 'legs', 'torso', 'spine', 'head', 'skin', 'all'] as string[]).includes(slot) ? (slot as BodyRegion) : regionOfSlot(slot as SlotId);
      const fr = FRAMING[region];
      const wide = camera.aspect < 0.62 ? 0.62 / camera.aspect : 1;
      const k = Math.min(1, dt * 4);
      camY += (fr.y - camY) * k;
      camDist += (fr.dist * wide - camDist) * k;
      camera.position.set(0, camY + 0.12 + camDist * 0.05, camDist);
      camera.lookAt(0, camY, 0);
      camera.updateMatrixWorld();
      // le personnage tourne sur le plateau (la caméra et les lumières restent fixes)
      view.yaw = yaw;
      swapEnv();
      try {
        chars.update([view], camera, clock, dt);
        renderer.render(scene, camera);
      } finally {
        swapEnv();
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (interactive) {
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
      chars.dispose();
      own.uLightTex.dispose();
      own.uLightCoarse.dispose();
      own.uTintTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
