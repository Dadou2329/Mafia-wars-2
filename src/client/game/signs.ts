// Enseignes peintes des bâtiments (nom en lettres dorées), plaques « Bureau de Dadou » /
// « Bureau d’Even » sur la porte du bureau et plaque nominative sur le bureau du parrain.
// Les enseignes portent un liseré aux couleurs du propriétaire actuel.

import * as THREE from 'three';
import { DE_BOSS } from '../../shared/constants';
import type { BuildingInfo } from '../../shared/city/gen/context';
import { Faction, type BuildingType } from '../../shared/city/plan';
import type { Slot } from '../../shared/protocol';
import { envUniforms } from '../render/env';
import { COMMON_UNIFORMS_GLSL, LIGHT_GLSL } from '../render/shaderChunks';

interface Board {
  bg: string;
  bg2: string;
  ink: string;
  edge: string;
  font: string;
  shadow: string;
}

const BOARDS: Partial<Record<BuildingType, Board>> = {
  pub: { bg: '#173022', bg2: '#0f2018', ink: '#e9c766', edge: '#b48a34', font: 'Cinzel', shadow: '#000' },
  cafe: { bg: '#3a1418', bg2: '#260c0f', ink: '#f2d58a', edge: '#c9a24a', font: 'Cinzel', shadow: '#000' },
  gambling: { bg: '#141414', bg2: '#0a0a0a', ink: '#e8c25a', edge: '#b48a34', font: 'Cinzel Decorative', shadow: '#000' },
  theatre: { bg: '#4a0f14', bg2: '#30080c', ink: '#f6e2a0', edge: '#d4a640', font: 'Cinzel Decorative', shadow: '#000' },
  bank: { bg: '#141414', bg2: '#060606', ink: '#e3c574', edge: '#9a7a3a', font: 'Cinzel', shadow: '#000' },
  exchange: { bg: '#141414', bg2: '#060606', ink: '#e3c574', edge: '#9a7a3a', font: 'Cinzel', shadow: '#000' },
  jeweller: { bg: '#10203a', bg2: '#0a1426', ink: '#f0d488', edge: '#c9a24a', font: 'Cinzel', shadow: '#000' },
  shop: { bg: '#1c2a3a', bg2: '#101a26', ink: '#efe0b8', edge: '#a88a4a', font: 'Cinzel', shadow: '#000' },
  bakery: { bg: '#e8dcc0', bg2: '#d4c49e', ink: '#5a2a14', edge: '#7a5a2a', font: 'Cinzel', shadow: 'rgba(0,0,0,0.25)' },
  butcher: { bg: '#e8e2d4', bg2: '#cfc6b2', ink: '#7a1a14', edge: '#5a4a3a', font: 'Cinzel', shadow: 'rgba(0,0,0,0.25)' },
  pawn: { bg: '#2a2a1a', bg2: '#1a1a0e', ink: '#e8c25a', edge: '#8a7a3a', font: 'Cinzel', shadow: '#000' },
  post: { bg: '#8a1414', bg2: '#5a0c0c', ink: '#f2e2b0', edge: '#d4a640', font: 'Cinzel', shadow: '#000' },
  warehouse: { bg: '#3a2c22', bg2: '#2a2018', ink: '#e8e0cc', edge: '#5a4a3a', font: 'Cinzel', shadow: '#000' },
  foundry: { bg: '#2a2622', bg2: '#1a1714', ink: '#e8e0cc', edge: '#4a4440', font: 'Cinzel', shadow: '#000' },
  brewery: { bg: '#2a3a22', bg2: '#1a2614', ink: '#efe0b8', edge: '#7a6a3a', font: 'Cinzel', shadow: '#000' },
  police: { bg: '#141c2e', bg2: '#0a101c', ink: '#e8ecf2', edge: '#8a96aa', font: 'Cinzel', shadow: '#000' },
};

const DEFAULT_BOARD: Board = { bg: '#1e1a16', bg2: '#12100c', ink: '#e8cf86', edge: '#9a7a3a', font: 'Cinzel', shadow: '#000' };

const OWNER_COLOR: Record<number, string> = { [Faction.DADOU]: '#b01e26', [Faction.EVEN]: '#2a4a8a' };

/** Matériau éclairé par le volume de lumière du monde (comme les accessoires). */
function signMaterial(map: THREE.Texture): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ map });
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
reflectedLight.indirectDiffuse += diffuseColor.rgb * ambientLight(sL, sn);`,
      )
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyHeightFog(gl_FragColor.rgb, vSWPos);');
  };
  mat.customProgramCacheKey = () => 'sign-v1';
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
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Ajuste la taille de police pour que le texte tienne dans la largeur. */
function fitFont(c: CanvasRenderingContext2D, text: string, family: string, weight: number, maxW: number, maxH: number): number {
  let size = maxH;
  for (; size > 8; size -= 2) {
    c.font = `${weight} ${size}px '${family}', serif`;
    if (c.measureText(text).width <= maxW) break;
  }
  return size;
}

export class SignSystem {
  readonly group = new THREE.Group();
  private signs: Sign[] = [];
  private byBuilding = new Map<number, Sign[]>();

  constructor(buildings: BuildingInfo[], you: Slot) {
    void you;
    this.group.name = 'enseignes';
    for (const b of buildings) {
      if (b.sign && b.def.type !== 'church') this.addFascia(b);
      if (b.plaque) this.addPlaque(b);
      if (b.def.hq && b.desk && b.deskSeat) this.addDeskPlate(b);
    }
    // les polices web arrivent parfois après la création : on redessine
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      Promise.all([fonts.load("700 64px 'Cinzel'"), fonts.load("700 64px 'Cinzel Decorative'"), fonts.load("600 40px 'EB Garamond'")])
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
    const hq = def.hq;
    const board: Board = hq === 'dadou'
      ? { bg: '#5a0c12', bg2: '#3a060a', ink: '#f0d488', edge: '#d4a640', font: 'Cinzel Decorative', shadow: '#000' }
      : hq === 'even'
        ? { bg: '#14284e', bg2: '#0a1630', ink: '#e8eef6', edge: '#c9d1dc', font: 'Cinzel Decorative', shadow: '#000' }
        : BOARDS[def.type] ?? DEFAULT_BOARD;
    // longueur raisonnable : l'enseigne ne couvre pas toute la façade des grands bâtiments
    const w = Math.min(sg.w, Math.max(3.2, def.name.length * 0.36 + 1.2));
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
    const text = def.name;
    const draw = (owner: number) => {
      const c = canvas.getContext('2d')!;
      c.clearRect(0, 0, cw, ch);
      const g = c.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, board.bg);
      g.addColorStop(1, board.bg2);
      c.fillStyle = g;
      c.fillRect(0, 0, cw, ch);
      // veinage léger
      c.globalAlpha = 0.06;
      for (let i = 0; i < 18; i++) {
        c.fillStyle = i % 2 ? '#fff' : '#000';
        c.fillRect(0, (i / 18) * ch, cw, 2);
      }
      c.globalAlpha = 1;
      // double filet doré
      c.strokeStyle = board.edge;
      c.lineWidth = ch * 0.06;
      c.strokeRect(ch * 0.05, ch * 0.05, cw - ch * 0.1, ch - ch * 0.1);
      c.lineWidth = ch * 0.02;
      c.strokeRect(ch * 0.14, ch * 0.14, cw - ch * 0.28, ch - ch * 0.28);
      // liseré du propriétaire
      const oc = OWNER_COLOR[owner];
      let pad = ch * 0.3;
      if (oc && !hq) {
        c.fillStyle = oc;
        c.fillRect(ch * 0.18, ch * 0.18, ch * 0.38, ch - ch * 0.36);
        c.fillRect(cw - ch * 0.56, ch * 0.18, ch * 0.38, ch - ch * 0.36);
        c.fillStyle = board.edge;
        c.font = `700 ${Math.round(ch * 0.34)}px 'Cinzel', serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const mark = owner === Faction.DADOU ? 'D' : 'E';
        c.fillText(mark, ch * 0.37, ch * 0.52);
        c.fillText(mark, cw - ch * 0.37, ch * 0.52);
        pad = ch * 0.7;
      }
      // texte doré avec ombre portée
      const size = fitFont(c, text.toUpperCase(), board.font, 700, cw - pad * 2, ch * 0.56);
      c.font = `700 ${size}px '${board.font}', serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = board.shadow;
      c.fillText(text.toUpperCase(), cw / 2 + size * 0.05, ch / 2 + size * 0.07);
      const tg = c.createLinearGradient(0, ch * 0.25, 0, ch * 0.75);
      tg.addColorStop(0, '#fff6d0');
      tg.addColorStop(0.45, board.ink);
      tg.addColorStop(1, board.edge);
      c.fillStyle = board.ink.startsWith('#e') || board.ink.startsWith('#f') ? tg : board.ink;
      c.fillText(text.toUpperCase(), cw / 2, ch / 2 + size * 0.02);
      tex.needsUpdate = true;
    };
    draw(def.startOwner);
    const geo = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(geo, signMaterial(tex));
    // la façade fait face à l'extérieur : la normale du plan (+Z) doit pointer vers la rue
    mesh.position.set(sg.x, sg.y, sg.z);
    mesh.rotation.y = sg.yaw;
    mesh.receiveShadow = true;
    // fond de planche (épaisseur)
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.06),
      signMaterial(this.solidTexture(board.bg2)),
    );
    backing.position.set(0, 0, -0.035);
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

  /** Petite plaque de laiton gravée (porte du bureau, bureau du parrain). */
  private brassPlate(lines: string[], w: number, h: number, dark = false): { mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; draw: () => void } {
    const pxPerM = 900;
    const cw = Math.round(w * pxPerM);
    const ch = Math.round(h * pxPerM);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const draw = () => {
      const c = canvas.getContext('2d')!;
      const g = c.createLinearGradient(0, 0, cw, ch);
      if (dark) {
        g.addColorStop(0, '#2a1a10');
        g.addColorStop(1, '#140c06');
      } else {
        g.addColorStop(0, '#f2d78a');
        g.addColorStop(0.45, '#c9a24a');
        g.addColorStop(0.55, '#b48a34');
        g.addColorStop(1, '#e6c66e');
      }
      c.fillStyle = g;
      c.fillRect(0, 0, cw, ch);
      // biseau
      c.strokeStyle = dark ? '#c9a24a' : 'rgba(90,60,20,0.8)';
      c.lineWidth = ch * 0.06;
      roundRect(c, ch * 0.08, ch * 0.08, cw - ch * 0.16, ch - ch * 0.16, ch * 0.08);
      c.stroke();
      // vis
      c.fillStyle = dark ? '#c9a24a' : '#7a5a24';
      for (const sx of [ch * 0.2, cw - ch * 0.2]) {
        c.beginPath();
        c.arc(sx, ch / 2, ch * 0.06, 0, Math.PI * 2);
        c.fill();
      }
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const n = lines.length;
      for (let i = 0; i < n; i++) {
        const lh = (ch * 0.62) / n;
        const size = fitFont(c, lines[i], i === 0 ? 'Cinzel' : 'EB Garamond', i === 0 ? 700 : 600, cw - ch * 0.7, lh * 0.95);
        c.font = `${i === 0 ? 700 : 600} ${size}px '${i === 0 ? 'Cinzel' : 'EB Garamond'}', serif`;
        const y = ch * 0.19 + lh * (i + 0.5);
        if (!dark) {
          c.fillStyle = 'rgba(255,240,200,0.6)';
          c.fillText(lines[i], cw / 2 + 1.5, y + 1.5);
        }
        c.fillStyle = dark ? '#f0d488' : '#2a1a0a';
        c.fillText(lines[i], cw / 2, y);
      }
      tex.needsUpdate = true;
    };
    draw();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), signMaterial(tex));
    return { mesh, canvas, tex, draw };
  }

  private addPlaque(b: BuildingInfo): void {
    const pq = b.plaque!;
    const text = b.def.hq ? `Bureau ${DE_BOSS[b.def.hq]}` : 'Direction';
    const plate = this.brassPlate([text], 0.62, 0.17);
    plate.mesh.position.set(pq.x, pq.y, pq.z);
    plate.mesh.rotation.y = pq.yaw;
    // la plaque fait face au couloir (côté opposé à la pièce) : on vérifie l'orientation
    this.register({ building: b.id, canvas: plate.canvas, tex: plate.tex, mesh: plate.mesh, draw: plate.draw, owner: 0, x: pq.x, z: pq.z });
  }

  private addDeskPlate(b: BuildingInfo): void {
    const desk = b.desk!;
    const seat = b.deskSeat!;
    // du fauteuil vers le visiteur
    let vx = desk.x - seat.x;
    let vz = desk.z - seat.z;
    const l = Math.hypot(vx, vz) || 1;
    vx /= l;
    vz /= l;
    const boss = b.def.hq!;
    const plate = this.brassPlate([`Bureau ${DE_BOSS[boss]}`, boss === 'dadou' ? 'Parrain de Soho' : 'Parrain des Docks'], 0.5, 0.15, true);
    const holder = new THREE.Group();
    // socle en noyer incliné
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.12, 0.07), signMaterial(this.solidTexture('#3a2414')));
    block.position.set(0, 0.06, -0.02);
    holder.add(block);
    plate.mesh.position.set(0, 0.075, 0.017);
    plate.mesh.scale.setScalar(0.95);
    plate.mesh.rotation.x = -0.25;
    holder.add(plate.mesh);
    holder.position.set(desk.x + vx * 0.42, b.floorY + 0.88, desk.z + vz * 0.42);
    holder.rotation.y = Math.atan2(vx, vz);
    this.register({ building: b.id, canvas: plate.canvas, tex: plate.tex, mesh: holder, draw: plate.draw, owner: 0, x: desk.x, z: desk.z });
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

  update(camPos: THREE.Vector3): void {
    for (const s of this.signs) {
      const dx = s.x - camPos.x;
      const dz = s.z - camPos.z;
      s.mesh.visible = dx * dx + dz * dz < 110 * 110;
    }
  }
}
