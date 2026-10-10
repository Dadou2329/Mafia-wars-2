// Enseignes lumineuses des bâtiments (néons sur plaque sombre) et étiquette holographique
// « Bureau de Dadou » / « Bureau d’Even » au-dessus du bureau de chaque logement du parrain.
// Les enseignes portent les marques du propriétaire actuel (D ou E, rouge ou bleu).

import * as THREE from 'three';
import { DE_BOSS, tierDef } from '../../shared/constants';
import type { BuildingInfo } from '../../shared/city/gen/context';
import { Faction, type BuildingType } from '../../shared/city/plan';
import type { Slot } from '../../shared/protocol';
import { envUniforms } from '../render/env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL } from '../render/shaderChunks';

interface Board {
  /** Plaque de fond. */
  bg: string;
  /** Couleur du néon. */
  neon: string;
  /** Police (Orbitron, Rajdhani). */
  font: string;
  weight: number;
}

const F_TITLE = 'Orbitron';
const F_BODY = 'Rajdhani';

const BOARDS: Partial<Record<BuildingType, Board>> = {
  club: { bg: '#0b0610', neon: '#ff3cc8', font: F_TITLE, weight: 800 },
  jazz: { bg: '#100a04', neon: '#ffb020', font: F_BODY, weight: 700 },
  casino: { bg: '#0e0608', neon: '#ffd040', font: F_TITLE, weight: 900 },
  theatre: { bg: '#0e0606', neon: '#ff5a3c', font: F_TITLE, weight: 800 },
  gym: { bg: '#0a0a0a', neon: '#ff2a40', font: F_BODY, weight: 700 },
  bodega: { bg: '#06100a', neon: '#40ff80', font: F_BODY, weight: 700 },
  diner: { bg: '#100606', neon: '#ff4060', font: F_BODY, weight: 700 },
  pharmacy: { bg: '#060c10', neon: '#40ff9a', font: F_BODY, weight: 700 },
  herbalist: { bg: '#100604', neon: '#ff6a2a', font: F_BODY, weight: 700 },
  teahouse: { bg: '#100406', neon: '#ff3040', font: F_BODY, weight: 700 },
  mahjong: { bg: '#100406', neon: '#ffd040', font: F_BODY, weight: 700 },
  techmarket: { bg: '#04080e', neon: '#3ce8ff', font: F_TITLE, weight: 700 },
  restaurant: { bg: '#0c0806', neon: '#ffc070', font: F_BODY, weight: 600 },
  boathouse: { bg: '#060a0c', neon: '#9fe8ff', font: F_BODY, weight: 600 },
  hotel: { bg: '#0c0a06', neon: '#ffe0a0', font: F_TITLE, weight: 700 },
  gallery: { bg: '#0a0a0a', neon: '#f0f0ff', font: F_BODY, weight: 600 },
  bank: { bg: '#06080c', neon: '#bcdcff', font: F_TITLE, weight: 700 },
  exchange: { bg: '#06080c', neon: '#40c8ff', font: F_TITLE, weight: 700 },
  corp: { bg: '#04060c', neon: '#7ab8ff', font: F_TITLE, weight: 700 },
  security: { bg: '#04080c', neon: '#40a0ff', font: F_TITLE, weight: 700 },
  studio: { bg: '#06040c', neon: '#a848ff', font: F_TITLE, weight: 800 },
  station: { bg: '#0a0a08', neon: '#ffe8b0', font: F_TITLE, weight: 700 },
  showroom: { bg: '#06060c', neon: '#ff8ae0', font: F_TITLE, weight: 700 },
  depot: { bg: '#0a0a08', neon: '#ffb020', font: F_BODY, weight: 700 },
  nightmarket: { bg: '#0c0408', neon: '#ff3cc8', font: F_BODY, weight: 700 },
  factory: { bg: '#080a0a', neon: '#40ff80', font: F_BODY, weight: 700 },
  brewery: { bg: '#0c0806', neon: '#ffb020', font: F_BODY, weight: 700 },
  junkyard: { bg: '#0a0806', neon: '#ff8a20', font: F_BODY, weight: 700 },
  tattoo: { bg: '#0a040a', neon: '#a848ff', font: F_BODY, weight: 700 },
  police: { bg: '#04081a', neon: '#4a8aff', font: F_TITLE, weight: 800 },
  garage: { bg: '#0a0808', neon: '#ff8a20', font: F_BODY, weight: 700 },
};

const DEFAULT_BOARD: Board = { bg: '#08080c', neon: '#3ce8ff', font: F_BODY, weight: 700 };

const OWNER_COLOR: Record<number, string> = { [Faction.DADOU]: '#ff2a3c', [Faction.EVEN]: '#4a8aff' };

/** Matériau éclairé par le volume de lumière du monde, avec émission (néons, hologrammes). */
function signMaterial(map: THREE.Texture, glow = 1, transparent = false): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: glow, transparent, depthWrite: !transparent, side: transparent ? THREE.DoubleSide : THREE.FrontSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, envUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSWPos;\nvarying vec3 vSWNrm;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSWNrm = normalize(mat3(modelMatrix) * normal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_UNIFORMS_GLSL}\n${LIGHT_GLSL}\nvarying vec3 vSWPos;\nvarying vec3 vSWNrm;`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
vec3 sn = normalize(vSWNrm);
vec2 sL = sampleLightVol(vSWPos + sn * 0.3);
reflectedLight.directDiffuse *= smoothstep(0.02, 0.3, sL.x);
reflectedLight.indirectDiffuse += diffuseColor.rgb * ambientLight(sL, sn, vSWPos);`,
      )
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyHeightFog(gl_FragColor.rgb, vSWPos);');
  };
  mat.customProgramCacheKey = () => `sign-v2-${transparent ? 't' : 'o'}`;
  return mat;
}

interface Sign {
  building: number;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  mesh: THREE.Object3D;
  draw: (owner: number) => void;
  owner: number;
  x: number;
  z: number;
  /** Étiquette du bureau : visible seulement quand le logement appartient à son parrain. */
  deskOf?: Slot;
  /** Hologramme : léger flottement. */
  holo?: boolean;
  baseY?: number;
}

/** Ajuste la taille de police pour que le texte tienne dans la largeur. */
function fitFont(c: CanvasRenderingContext2D, text: string, family: string, weight: number, maxW: number, maxH: number): number {
  let size = maxH;
  for (; size > 8; size -= 2) {
    c.font = `${weight} ${size}px '${family}', sans-serif`;
    if (c.measureText(text).width <= maxW) break;
  }
  return size;
}

export class SignSystem {
  readonly group = new THREE.Group();
  private signs: Sign[] = [];
  private byBuilding = new Map<number, Sign[]>();
  private t = 0;

  constructor(buildings: BuildingInfo[], you: Slot) {
    void you;
    this.group.name = 'enseignes';
    for (const b of buildings) {
      if (b.sign && b.def.type !== 'landmark' && b.def.type !== 'filler') this.addFascia(b);
      if (b.def.residence && b.desk) this.addDeskHolo(b);
    }
    // les polices web arrivent parfois après la création : on redessine
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      Promise.all([fonts.load(`800 64px '${F_TITLE}'`), fonts.load(`700 64px '${F_BODY}'`)])
        .then(() => this.redrawAll())
        .catch(() => undefined);
    }
  }

  private register(s: Sign): void {
    this.signs.push(s);
    let l = this.byBuilding.get(s.building);
    if (!l) this.byBuilding.set(s.building, (l = []));
    l.push(s);
    this.group.add(s.mesh);
  }

  private addFascia(b: BuildingInfo): void {
    const sg = b.sign!;
    const def = b.def;
    const boss = def.residence?.boss;
    const board: Board = boss === 'dadou'
      ? { bg: '#0c0204', neon: '#ff2a3c', font: F_TITLE, weight: 900 }
      : boss === 'even'
        ? { bg: '#02050c', neon: '#7ab8ff', font: F_TITLE, weight: 900 }
        : BOARDS[def.type] ?? DEFAULT_BOARD;
    // longueur raisonnable : l'enseigne ne couvre pas toute la façade des grands bâtiments
    const w = Math.min(sg.w, Math.max(3.2, def.name.length * 0.34 + 1.2));
    const h = sg.h;
    const pxPerM = 150;
    const cw = Math.min(2048, Math.round(w * pxPerM));
    const ch = Math.round(h * pxPerM);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const text = def.name.toUpperCase();
    const draw = (owner: number) => {
      const c = canvas.getContext('2d')!;
      c.clearRect(0, 0, cw, ch);
      // plaque sombre brossée
      c.fillStyle = board.bg;
      c.fillRect(0, 0, cw, ch);
      c.globalAlpha = 0.05;
      for (let i = 0; i < 24; i++) {
        c.fillStyle = i % 2 ? '#fff' : '#000';
        c.fillRect(0, (i / 24) * ch, cw, 1);
      }
      c.globalAlpha = 1;
      // tube néon du cadre
      c.shadowColor = board.neon;
      c.shadowBlur = ch * 0.12;
      c.strokeStyle = board.neon;
      c.globalAlpha = 0.85;
      c.lineWidth = ch * 0.035;
      c.strokeRect(ch * 0.08, ch * 0.08, cw - ch * 0.16, ch - ch * 0.16);
      c.globalAlpha = 1;
      // marques du propriétaire
      const oc = OWNER_COLOR[owner];
      let pad = ch * 0.3;
      if (oc && !boss) {
        c.shadowColor = oc;
        c.fillStyle = oc;
        c.fillRect(ch * 0.18, ch * 0.2, ch * 0.36, ch - ch * 0.4);
        c.fillRect(cw - ch * 0.54, ch * 0.2, ch * 0.36, ch - ch * 0.4);
        c.shadowBlur = 0;
        c.fillStyle = '#ffffff';
        c.font = `900 ${Math.round(ch * 0.32)}px '${F_TITLE}', sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const mark = owner === Faction.DADOU ? 'D' : 'E';
        c.fillText(mark, ch * 0.36, ch * 0.52);
        c.fillText(mark, cw - ch * 0.36, ch * 0.52);
        pad = ch * 0.7;
      }
      // texte néon : halo coloré puis cœur presque blanc
      const size = fitFont(c, text, board.font, board.weight, cw - pad * 2, ch * 0.52);
      c.font = `${board.weight} ${size}px '${board.font}', sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.shadowColor = board.neon;
      c.shadowBlur = size * 0.45;
      c.fillStyle = board.neon;
      c.fillText(text, cw / 2, ch / 2 + size * 0.04);
      c.shadowBlur = size * 0.15;
      c.fillStyle = mixWhite(board.neon, 0.55);
      c.fillText(text, cw / 2, ch / 2 + size * 0.04);
      c.shadowBlur = 0;
      tex.needsUpdate = true;
    };
    draw(def.startOwner);
    const geo = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(geo, signMaterial(tex, 1.1));
    // la façade fait face à l'extérieur : la normale du plan (+Z) doit pointer vers la rue
    mesh.position.set(sg.x, sg.y, sg.z);
    mesh.rotation.y = sg.yaw;
    mesh.receiveShadow = true;
    // caisson (épaisseur)
    const backing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.08), signMaterial(this.solidTexture('#0a0c10'), 0));
    backing.position.set(0, 0, -0.045);
    mesh.add(backing);
    this.register({ building: b.id, canvas, tex, mesh, draw, owner: def.startOwner, x: sg.x, z: sg.z });
  }

  private solidTexture(color: string): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.fillRect(0, 0, 4, 4);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Étiquette holographique flottant au-dessus du bureau : « Bureau de Dadou », palier et touche E. */
  private addDeskHolo(b: BuildingInfo): void {
    const desk = b.desk!;
    const boss = b.def.residence!.boss;
    const color = boss === 'dadou' ? '#ff4050' : '#6aa8ff';
    const w = 1.5;
    const hgt = 0.5;
    const pxPerM = 500;
    const cw = Math.round(w * pxPerM);
    const ch = Math.round(hgt * pxPerM);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const title = `Bureau ${DE_BOSS[boss]}`;
    const sub = `${tierDef(b.def.residence!.tier).name} — carte stratégique [E]`;
    const draw = () => {
      const c = canvas.getContext('2d')!;
      c.clearRect(0, 0, cw, ch);
      // cadre holographique translucide
      const g = c.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, 'rgba(10,20,40,0.15)');
      g.addColorStop(1, 'rgba(10,20,40,0.45)');
      c.fillStyle = g;
      c.fillRect(0, 0, cw, ch);
      c.strokeStyle = color;
      c.shadowColor = color;
      c.shadowBlur = 18;
      c.lineWidth = 4;
      c.strokeRect(6, 6, cw - 12, ch - 12);
      // lignes de balayage
      c.shadowBlur = 0;
      c.globalAlpha = 0.18;
      c.fillStyle = color;
      for (let y = 10; y < ch; y += 6) c.fillRect(8, y, cw - 16, 1);
      c.globalAlpha = 1;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.shadowColor = color;
      c.shadowBlur = 22;
      c.fillStyle = '#ffffff';
      const s1 = fitFont(c, title.toUpperCase(), F_TITLE, 900, cw - 60, ch * 0.42);
      c.font = `900 ${s1}px '${F_TITLE}', sans-serif`;
      c.fillText(title.toUpperCase(), cw / 2, ch * 0.38);
      c.shadowBlur = 10;
      c.fillStyle = color;
      const s2 = fitFont(c, sub, F_BODY, 700, cw - 60, ch * 0.26);
      c.font = `700 ${s2}px '${F_BODY}', sans-serif`;
      c.fillText(sub, cw / 2, ch * 0.74);
      c.shadowBlur = 0;
      tex.needsUpdate = true;
    };
    draw();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), signMaterial(tex, 1.4, true));
    const y = (desk.y ?? b.floorY) + 1.75;
    mesh.position.set(desk.x, y, desk.z);
    mesh.renderOrder = 5;
    const owner = boss === 'dadou' ? Faction.DADOU : Faction.EVEN;
    mesh.visible = b.def.startOwner === owner;
    this.register({ building: b.id, canvas, tex, mesh, draw: () => draw(), owner: b.def.startOwner, x: desk.x, z: desk.z, deskOf: boss, holo: true, baseY: y });
  }

  private redrawAll(): void {
    for (const s of this.signs) s.draw(s.owner);
  }

  setOwner(building: number, owner: number): void {
    const list = this.byBuilding.get(building);
    if (!list) return;
    for (const s of list) {
      if (s.owner === owner) continue;
      s.owner = owner;
      s.draw(owner);
    }
  }

  update(camPos: THREE.Vector3, dt = 1 / 60): void {
    this.t += dt;
    for (const s of this.signs) {
      const dx = s.x - camPos.x;
      const dz = s.z - camPos.z;
      const near = dx * dx + dz * dz < 110 * 110;
      if (s.deskOf) {
        const mine = s.owner === (s.deskOf === 'dadou' ? Faction.DADOU : Faction.EVEN);
        s.mesh.visible = near && mine && dx * dx + dz * dz < 30 * 30;
        if (s.mesh.visible) {
          // l'hologramme tourne vers la caméra et flotte doucement
          s.mesh.rotation.y = Math.atan2(camPos.x - s.x, camPos.z - s.z);
          s.mesh.position.y = (s.baseY ?? 0) + Math.sin(this.t * 1.6) * 0.04;
        }
      } else s.mesh.visible = near;
    }
  }
}

/** Mélange une couleur CSS #rrggbb avec du blanc. */
function mixWhite(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const m = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
