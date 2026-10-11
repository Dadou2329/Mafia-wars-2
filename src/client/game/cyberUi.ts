// Écran CYBERNÉTIQUE (touche I, téléphone, comptoir des cliniques et station du QG) : à gauche
// les emplacements du corps, au centre l'aperçu 3D du parrain et ses configurations, à droite
// les implants de la catégorie et la fiche détaillée (niveaux, paramètres comparés, commandes),
// avec les achats, améliorations, installations et retraits. Hors station : consultation
// seulement. L'état affiché vient toujours du serveur (état privé, 2 Hz) : les actions donnent
// un retour immédiat (« en cours… ») que confirme l'état suivant.
// Ouvert, l'écran garde le clavier (Échap / I ferment, flèches pour naviguer) ; il se ferme si le
// parrain, immobile pendant ce temps, est blessé. L'aperçu 3D (characters/preview.ts) vit le
// temps de l'ouverture (contexte WebGL rendu à la fermeture) ; en qualité « basse » ou en cas
// d'échec, une silhouette holographique le remplace.
// Le module tient aussi l'itinéraire vers une clinique (balise lumineuse et repère sur la
// mini-carte), demandé depuis cet écran ou depuis le téléphone.

import * as THREE from 'three';
import '../ui/cyber.css';
import { CharKind } from '../../shared/characters';
import { createCharacterPreview, type CharacterPreview } from '../characters/preview';
import { BOSS_NAME } from '../../shared/constants';
import type { BuildingInfo } from '../../shared/city/gen/context';
import {
  CAT_LABEL,
  IMPLANTS,
  IMPLANT_BY_ID,
  LOADOUT_COUNT,
  LOADOUT_NAMES,
  SLOT_BY_ID,
  SLOTS,
  cyberLook,
  qualityOf,
  type Equipment,
  type ImplantCat,
  type ImplantDef,
  type SlotId,
} from '../../shared/implants';
import type { ClientAction, CyberState, GameEvent, PrivateState, PublicState, Slot } from '../../shared/protocol';
import { formatMoney } from '../../shared/util';
import { audio, SFX_NAMES } from '../audio/AudioEngine';
import type { SfxName } from '../audio/types';
import { settings } from '../settings';
import { h, clear } from '../ui/dom';
import {
  CAT_ICON,
  KIND_LABEL,
  SLOT_GROUPS,
  chipKey,
  colorName,
  compareRows,
  controlFor,
  distText,
  hex,
  iconSvg,
  implantIcon,
  levelTrack,
  nearestSpot,
  paramRows,
  qualityColor,
  slotAbbr,
  slotShort,
  slotTag,
  stationName,
  stationSpots,
  type ParamRow,
  type StationSpot,
} from './cyberFormat';
import { implantControls } from './cyberState';
import type { GameClient } from './GameClient';
import type { ClientModule } from './modules';

// ------------------------------------------------------------------------------------- sons

const SFX = new Set<string>(SFX_NAMES as readonly string[]);

/** Joue un son de l'interface ; les nouveaux noms (cyber_ui_hover…) ont un son de repli. */
export function uiSfx(name: string, fallback: SfxName | null, volume = 0.6): void {
  const n = SFX.has(name) ? (name as SfxName) : fallback;
  if (n) audio.play(n, { volume });
}

// ------------------------------------------------------------------------- silhouette (repli)

/** Moitié gauche de la silhouette (vue de dos : le bras gauche est à gauche), du cou à l'entrejambe. */
const FIG_LEFT: [number, number][] = [
  [92, 74], [92, 86], [62, 94], [50, 104], [44, 124], [40, 168], [36, 220], [31, 238], [34, 252], [44, 254], [48, 236], [50, 222],
  [56, 172], [62, 132], [66, 160], [68, 196], [72, 214], [70, 236], [70, 296], [74, 312], [74, 368], [70, 386], [62, 396], [90, 396],
  [90, 382], [92, 312], [96, 250], [100, 238],
];

/** Repères des emplacements sur la silhouette (viewBox 200 × 400). */
const NODE: Record<SlotId, [number, number]> = {
  neural1: [89, 34],
  neural2: [111, 34],
  yeux1: [92, 54],
  yeux2: [108, 54],
  colonne: [100, 116],
  torse1: [84, 148],
  torse2: [116, 148],
  peau: [100, 198],
  brasG: [43, 196],
  brasD: [157, 196],
  jambes1: [81, 268],
  jambes2: [119, 268],
  jambes3: [100, 372],
};

function figureSvg(): string {
  const right = FIG_LEFT.slice(0, -1)
    .map(([x, y]) => [200 - x, y] as [number, number])
    .reverse();
  const body = 'M' + [...FIG_LEFT, ...right].map(([x, y]) => `${x} ${y}`).join('L') + 'Z';
  const nodes = SLOTS.map((s) => {
    const [x, y] = NODE[s.id];
    return `<g class="cy-node" data-slot="${s.id}" transform="translate(${x} ${y})"><circle class="halo" r="11"/><rect class="core" x="-4.6" y="-4.6" width="9.2" height="9.2" rx="1.2" transform="rotate(45)"/></g>`;
  }).join('');
  return `<svg class="cy-figure" viewBox="0 0 200 400" aria-hidden="true">
    <defs>
      <linearGradient id="cyFigFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fd8ff" stop-opacity=".22"/><stop offset=".55" stop-color="#7c8cff" stop-opacity=".12"/><stop offset="1" stop-color="#b05cff" stop-opacity=".2"/></linearGradient>
      <pattern id="cyFigGrid" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="#4fd8ff" stroke-opacity=".13" stroke-width=".6"/></pattern>
      <linearGradient id="cyScanG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fd8ff" stop-opacity="0"/><stop offset=".55" stop-color="#9ff0ff" stop-opacity=".55"/><stop offset="1" stop-color="#4fd8ff" stop-opacity="0"/></linearGradient>
      <clipPath id="cyBodyClip"><ellipse cx="100" cy="48" rx="20" ry="25"/><path d="${body}"/></clipPath>
    </defs>
    <ellipse class="cy-fig-floor" cx="100" cy="396" rx="70" ry="9"/>
    <g class="cy-fig-body">
      <ellipse cx="100" cy="48" rx="20" ry="25" fill="url(#cyFigFill)"/>
      <path d="${body}" fill="url(#cyFigFill)"/>
      <path d="${body}" fill="url(#cyFigGrid)"/>
      <ellipse cx="100" cy="48" rx="20" ry="25" class="cy-fig-line"/>
      <path d="${body}" class="cy-fig-line"/>
      <path class="cy-fig-detail" d="M100 90V232M86 102q14 8 28 0M78 128h44M80 176q20 8 40 0M76 210h48M70 304h8M122 304h8M48 170l8 2M152 170l-8 2"/>
      <text x="26" y="98" class="cy-fig-side">G</text><text x="166" y="98" class="cy-fig-side">D</text>
    </g>
    <g clip-path="url(#cyBodyClip)"><rect class="cy-fig-scan" x="0" y="0" width="200" height="22" fill="url(#cyScanG)"/></g>
    ${nodes}
  </svg>`;
}

// ---------------------------------------------------------------------------- balise d'itinéraire

const BEAM_VERT = /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main() {
  vH = position.y / 60.0;
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
  float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
  float fade = (1.0 - vH) * (1.0 - vH);
  float pulse = 0.7 + 0.3 * sin(uTime * 4.0 - vH * 26.0);
  float a = (0.16 + 0.55 * (1.0 - edge)) * fade * pulse;
  gl_FragColor = vec4(uColor * a, a);
}`;

/** Colonne de lumière cyan au-dessus de la clinique visée. */
class RouteBeam {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private ring: THREE.Mesh;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.3, 0.85, 1.0) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.CylinderGeometry(0.45, 0.8, 60, 20, 1, true);
    geo.translate(0, 30, 0);
    const beam = new THREE.Mesh(geo, this.mat);
    beam.frustumCulled = false;
    beam.renderOrder = 5;
    this.group.add(beam);
    const ringGeo = new THREE.RingGeometry(1.1, 1.35, 4);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.ring.position.y = 0.06;
    this.group.add(this.ring);
    this.group.visible = false;
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
    this.mat.uniforms.uTime.value = now;
    this.ring.rotation.y = now * 0.8;
    const s = 1 + 0.12 * Math.sin(now * 3);
    this.ring.scale.set(s, 1, s);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
}

// ------------------------------------------------------------------------------------ hôte

/** Ce dont l'écran a besoin de la partie (le laboratoire ?cyberui en fournit une imitation). */
export interface CyberHost {
  readonly you: Slot;
  /** Entité du parrain local (blessures : l'écran se ferme pour rendre la main). */
  readonly selfId?: number;
  priv(): PrivateState;
  pub(): PublicState;
  readonly world: { buildings: BuildingInfo[] } | null;
  act(a: ClientAction): void;
  /** Panneau ouvert : souris libre, parrain immobile. */
  setUiOpen(open: boolean): void;
  /** Couche d'interface où monter l'écran. */
  readonly mount: HTMLElement;
  playerPos(): { x: number; y: number; z: number };
  /** Notification du HUD (itinéraire). */
  notify?(text: string, kind: 'info' | 'good' | 'bad'): void;
  /** Scène 3D (balise d'itinéraire) et mini-carte (repère), absentes du laboratoire. */
  readonly scene?: THREE.Scene;
  readonly minimap?: HTMLCanvasElement;
  /** Pas d'aperçu 3D (essais de la silhouette de repli). */
  readonly noPreview?: boolean;
}

type Op = 'buy' | 'upgrade' | 'equip' | 'unequip' | 'save' | 'load';

interface Pending {
  op: Op;
  id?: string;
  slot?: SlotId;
  n?: number;
  at: number;
  /** L'état du serveur montre l'action accomplie. */
  done: (c: CyberState) => boolean;
  /** Retour une fois confirmée (sons, éclat). */
  ok: (c: CyberState) => void;
}

const PENDING_TEXT: Record<Op, string> = {
  buy: 'Transaction…',
  upgrade: 'Transaction…',
  equip: 'Installation…',
  unequip: 'Retrait…',
  save: 'Enregistrement…',
  load: 'Installation…',
};

function slotOf(equip: Equipment, id: string): SlotId | null {
  for (const s of SLOTS) if (equip[s.id] === id) return s.id;
  return null;
}

function sameEquip(a: Equipment, b: Equipment): boolean {
  for (const s of SLOTS) if ((a[s.id] ?? null) !== (b[s.id] ?? null)) return false;
  return true;
}

const STOP = (e: Event): void => e.stopPropagation();

// ------------------------------------------------------------------------------------ écran

export class CyberUi implements ClientModule {
  readonly el: HTMLElement;
  private host: CyberHost;
  private opened = false;
  private selSlot: SlotId = 'brasG';
  private selId: string | null = null;
  private focusCol: 'slots' | 'list' = 'list';
  private compare = false;
  private pending: Pending | null = null;
  private feedback: { text: string; kind: string; at: number } | null = null;
  private flash: { id?: string; slot?: SlotId; n?: number; at: number } | null = null;
  private sigs = new Map<string, string>();
  /** Implant de la fiche affichée (on garde son défilement tant qu'il ne change pas). */
  private detailFor = '';
  private pointerDown = false;
  private pointerAt = 0;
  private dirty = false;
  private lastHover = 0;
  private tick = 0;
  // éléments
  private stationEl: HTMLElement;
  private fundsEl: HTMLElement;
  private subEl: HTMLElement;
  private slotsEl: HTMLElement;
  private slotCount: HTMLElement;
  private listHead: HTMLElement;
  private listEl: HTMLElement;
  private detailEl: HTMLElement;
  private actionsEl: HTMLElement;
  private feedbackEl: HTMLElement;
  private stage: HTMLElement;
  /** Canevas de l'aperçu 3D (neuf à chaque ouverture : l'aperçu libère son contexte WebGL à la fermeture). */
  private canvas: HTMLCanvasElement | null = null;
  private figure: HTMLElement;
  private stageLabel: HTMLElement;
  private controlsEl: HTMLElement;
  private loadoutsEl: HTMLElement;
  // aperçu 3D
  private preview: CharacterPreview | null = null;
  /** L'aperçu 3D a échoué (contexte WebGL refusé…) : silhouette jusqu'à la fin de la partie. */
  private previewFailed = false;
  private lookSig = '';
  private drag: { x: number; rot: number } | null = null;
  private figRot = 0;
  private resizeObs: ResizeObserver | null = null;
  // itinéraire
  private route: StationSpot | null = null;
  private beam: RouteBeam | null = null;
  private mini: HTMLCanvasElement | null = null;
  private miniAcc = 0;

  constructor(host: CyberHost) {
    this.host = host;
    // ---------------------------------------------------------------- en-tête
    this.stationEl = h('div', { class: 'cy-station' });
    this.fundsEl = h('b');
    this.subEl = h('div', { class: 'cy-sub' });
    const close = h(
      'button',
      { class: 'btn small ghost cy-close', title: 'Fermer (Échap)', on: { click: () => this.close(), pointerenter: () => this.hover() } },
      'Fermer ✕',
    );
    const head = h(
      'div',
      { class: 'cy-head' },
      h('div', { class: 'cy-titles' }, h('div', { class: 'cy-title' }, 'Cybernétique'), this.subEl),
      this.stationEl,
      h('div', { class: 'cy-funds' }, h('span', null, 'Fonds'), this.fundsEl),
      close,
    );
    // ---------------------------------------------------------------- gauche : emplacements
    this.slotCount = h('span', { class: 'cy-colcount' });
    this.slotsEl = h('div', { class: 'cy-slots scroll' });
    const left = h('div', { class: 'cy-col cy-left panel' }, h('div', { class: 'cy-colhead' }, h('span', null, 'Emplacements'), this.slotCount), this.slotsEl);
    // ---------------------------------------------------------------- centre : aperçu
    this.figure = h('div', { class: 'cy-figwrap', html: figureSvg() });
    this.stageLabel = h('div', { class: 'cy-stage-label' });
    this.stage = h(
      'div',
      { class: 'cy-stage' },
      h('div', { class: 'cy-stage-grid' }),
      this.figure,
      h('div', { class: 'cy-stage-hint' }, '⟲ Glisser pour pivoter'),
      this.stageLabel,
    );
    this.controlsEl = h('div', { class: 'cy-controls' });
    this.loadoutsEl = h('div', { class: 'cy-loadouts' });
    const center = h('div', { class: 'cy-col cy-center' }, this.stage, this.controlsEl, this.loadoutsEl);
    // ---------------------------------------------------------------- droite : catalogue et fiche
    this.listHead = h('div', { class: 'cy-colhead' });
    this.listEl = h('div', { class: 'cy-list scroll' });
    this.detailEl = h('div', { class: 'cy-detail scroll' });
    this.actionsEl = h('div', { class: 'cy-actions' });
    this.feedbackEl = h('div', { class: 'cy-feedback hidden' });
    const right = h('div', { class: 'cy-col cy-right panel' }, this.listHead, this.listEl, this.detailEl, h('div', { class: 'cy-actwrap' }, this.actionsEl, this.feedbackEl));
    this.el = h('div', { class: `cy-root ${host.you} hidden`, role: 'dialog', 'aria-label': 'Écran cybernétique' }, head, h('div', { class: 'cy-main' }, left, center, right));
    // la souris reste à l'écran (pas de capture du pointeur par le jeu)
    this.el.addEventListener('mousedown', STOP);
    this.el.addEventListener('wheel', STOP, { passive: true });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    // on ne reconstruit pas un bouton entre l'appui et le relâchement (clic perdu)
    this.el.addEventListener('pointerdown', () => {
      this.pointerDown = true;
      this.pointerAt = performance.now();
    });
    window.addEventListener('pointerup', this.onPointerUp);
    // rotation de l'aperçu
    this.stage.addEventListener('pointerdown', this.onStageDown);
    window.addEventListener('pointermove', this.onStageMove);
    host.mount.appendChild(this.el);
    if (host.scene) {
      this.beam = new RouteBeam();
      host.scene.add(this.beam.group);
    }
  }

  // ======================================================================= module

  /** L'écran est-il ouvert ? */
  get isOpen(): boolean {
    return this.opened;
  }

  blocking(): boolean {
    return this.opened;
  }

  onKey(code: string): boolean {
    if (settings.bindings.cyber.includes(code)) {
      this.toggle();
      return true;
    }
    return false;
  }

  onEscape(): boolean {
    if (!this.opened) return false;
    this.close();
    return true;
  }

  onPriv(p: PrivateState): void {
    const pd = this.pending;
    if (pd && pd.done(p.cyber)) {
      this.pending = null;
      pd.ok(p.cyber);
    }
    if (this.opened) this.render();
  }

  onEvent(e: GameEvent): void {
    if (e.t === 'over') {
      this.close();
      return;
    }
    // le parrain est immobile tant que l'écran est ouvert : attaqué, on lui rend la main
    if (this.opened && this.host.selfId !== undefined && ((e.t === 'hit' && e.id === this.host.selfId) || (e.t === 'death' && e.id === this.host.selfId))) {
      this.close();
      this.host.notify?.(e.t === 'hit' ? 'Vous êtes attaqué ! L’écran CYBERNÉTIQUE se ferme.' : 'Vous êtes tombé : l’écran CYBERNÉTIQUE se ferme.', 'bad');
      return;
    }
    if (!this.opened || e.t !== 'notify') return;
    if (e.to && e.to !== this.host.you) return;
    this.setFeedback(e.text, e.kind);
    // refus du serveur : l'action en attente est abandonnée
    if (this.pending && e.kind === 'bad') {
      this.pending = null;
      this.render(true);
    }
  }

  update(dt: number, now: number): void {
    this.beam?.update(now);
    if (this.route) {
      this.miniAcc += dt;
      if (this.miniAcc > 0.2) {
        this.miniAcc = 0;
        this.updateRoute();
      }
    }
    if (!this.opened) return;
    if (this.preview) {
      try {
        this.preview.render(dt);
      } catch (err) {
        console.warn('Aperçu 3D : rendu impossible, retour à la silhouette.', err);
        this.previewFailed = true;
        this.dropPreview();
      }
    }
    this.tick += dt;
    if (this.tick < 0.25) return;
    this.tick = 0;
    // relâchement perdu (hors de la fenêtre) : on ne bloque pas les mises à jour plus longtemps
    if (this.pointerDown && performance.now() - this.pointerAt > 1500) this.onPointerUp();
    // délai de garde : sans confirmation, l'action en attente est abandonnée
    if (this.pending && performance.now() - this.pending.at > 3500) {
      this.pending = null;
      this.render(true);
    }
    if (this.feedback && performance.now() - this.feedback.at > 5000) {
      this.feedback = null;
      this.feedbackEl.classList.add('hidden');
    }
    // distances (hors station) et argent
    this.renderHead();
  }

  reset(): void {
    this.close();
    this.pending = null;
    this.feedback = null;
    this.flash = null;
    this.selId = null;
    this.setRoute(null);
    this.sigs.clear();
  }

  dispose(): void {
    this.close();
    this.setRoute(null);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onStageMove);
    this.resizeObs?.disconnect();
    this.dropPreview();
    this.beam?.dispose();
    this.mini?.remove();
    this.el.remove();
  }

  // ======================================================================= ouverture

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /**
   * Ouvre l'écran. focus : emplacement (« brasG »), catégorie (« jambes ») ou implant (« grappin »).
   */
  open(focus?: string): void {
    if (!this.opened) {
      this.opened = true;
      this.el.classList.remove('hidden');
      this.host.setUiOpen(true);
      window.addEventListener('keydown', this.onKeyCapture, true);
      audio.play('ui_open', { volume: 0.6 });
      this.sigs.clear();
      if (!this.selId) this.selectSlot(this.firstSlot(), false);
      this.ensurePreview();
    }
    if (focus) this.applyFocus(focus);
    this.render(true);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.el.classList.add('hidden');
    window.removeEventListener('keydown', this.onKeyCapture, true);
    this.drag = null;
    this.dropPreview();
    this.host.setUiOpen(false);
    audio.play('ui_close', { volume: 0.5 });
  }

  private firstSlot(): SlotId {
    const eq = this.host.priv().cyber.equip;
    return SLOTS.find((s) => eq[s.id])?.id ?? 'brasG';
  }

  private applyFocus(focus: string): void {
    const c = this.host.priv().cyber;
    if (SLOT_BY_ID[focus as SlotId]) return this.selectSlot(focus as SlotId, false);
    if (focus in CAT_LABEL) {
      const cat = focus as ImplantCat;
      const s = SLOTS.find((x) => x.cat === cat && !c.equip[x.id]) ?? SLOTS.find((x) => x.cat === cat)!;
      return this.selectSlot(s.id, false);
    }
    const def = IMPLANT_BY_ID[focus];
    if (def) {
      const at = slotOf(c.equip, def.id);
      const s = at ?? SLOTS.find((x) => x.cat === def.cat && !c.equip[x.id])?.id ?? SLOTS.find((x) => x.cat === def.cat)!.id;
      this.selSlot = s;
      this.selId = def.id;
      this.focusCol = 'list';
    }
  }

  // ======================================================================= clavier

  /** Pendant que l'écran est ouvert, il garde le clavier (rien ne s'ouvre par-dessus). */
  private onKeyCapture = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    const code = e.code;
    // raccourcis du navigateur (outils, plein écran…) : on laisse passer
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(code)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (code === 'Escape' || settings.bindings.cyber.includes(code)) this.close();
    else if (code === 'ArrowUp' || code === 'ArrowDown') this.move(code === 'ArrowUp' ? -1 : 1);
    else if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const col = code === 'ArrowLeft' ? 'slots' : 'list';
      if (col !== this.focusCol) {
        this.focusCol = col;
        uiSfx('cyber_ui_hover', 'ui_hover', 0.35);
        this.render(true);
      }
    }
  };

  private move(d: number): void {
    if (this.focusCol === 'slots') {
      const i = SLOTS.findIndex((s) => s.id === this.selSlot);
      const n = SLOTS[(i + d + SLOTS.length) % SLOTS.length];
      this.selectSlot(n.id, true);
    } else {
      const items = IMPLANTS.filter((x) => x.cat === SLOT_BY_ID[this.selSlot].cat);
      const i = Math.max(0, items.findIndex((x) => x.id === this.selId));
      const n = items[(i + d + items.length) % items.length];
      this.selectImplant(n.id);
    }
    this.render(true);
    const el = this.el.querySelector<HTMLElement>(this.focusCol === 'slots' ? '.cy-slot.sel' : '.cy-item.sel');
    el?.scrollIntoView({ block: 'nearest' });
  }

  // ======================================================================= sélection

  private selectSlot(slot: SlotId, sound = true): void {
    const c = this.host.priv().cyber;
    const prevCat = SLOT_BY_ID[this.selSlot].cat;
    this.selSlot = slot;
    const cat = SLOT_BY_ID[slot].cat;
    const inSlot = c.equip[slot];
    if (inSlot) this.selId = inSlot;
    else if (!this.selId || IMPLANT_BY_ID[this.selId]?.cat !== cat || cat !== prevCat) {
      // emplacement libre : un implant possédé et disponible, sinon le premier du catalogue
      const items = IMPLANTS.filter((x) => x.cat === cat);
      this.selId = (items.find((x) => c.owned[x.id] && !slotOf(c.equip, x.id)) ?? items[0]).id;
    }
    this.compare = false;
    if (sound) uiSfx('cyber_ui_select', 'ui_click', 0.45);
  }

  private selectImplant(id: string): void {
    if (this.selId !== id) this.compare = false;
    this.selId = id;
    uiSfx('cyber_ui_select', 'ui_click', 0.45);
  }

  private hover(): void {
    const t = performance.now();
    if (t - this.lastHover < 70) return;
    this.lastHover = t;
    uiSfx('cyber_ui_hover', 'ui_hover', 0.22);
  }

  // ======================================================================= actions

  private act(op: Op, a: { id?: string; slot?: SlotId; n?: number }, done: Pending['done'], ok: Pending['ok']): void {
    this.host.act({ a: 'cyber', op, ...a });
    this.pending = { op, ...a, at: performance.now(), done, ok };
    uiSfx('cyber_ui_select', 'ui_click', 0.5);
    this.render(true);
  }

  private buy(def: ImplantDef): void {
    const c0 = this.host.priv().cyber;
    const free = SLOTS.find((s) => s.cat === def.cat && !c0.equip[s.id]);
    this.act(
      'buy',
      { id: def.id },
      (c) => (c.owned[def.id] ?? 0) > 0,
      (c) => {
        audio.play('purchase', { volume: 0.8 });
        const at = slotOf(c.equip, def.id);
        if (at) {
          uiSfx('implant_install', 'notify', 0.6);
          // l'implant s'est installé tout seul : on suit son emplacement
          if (free && at === free.id && this.selId === def.id) this.selSlot = at;
        }
        this.flash = { id: def.id, slot: at ?? undefined, at: performance.now() };
      },
    );
  }

  private upgrade(def: ImplantDef, lv: number): void {
    this.act(
      'upgrade',
      { id: def.id },
      (c) => (c.owned[def.id] ?? 0) > lv,
      () => {
        uiSfx('implant_upgrade', 'purchase', 0.8);
        this.flash = { id: def.id, at: performance.now() };
      },
    );
  }

  private equip(def: ImplantDef, slot: SlotId): void {
    this.act(
      'equip',
      { id: def.id, slot },
      (c) => c.equip[slot] === def.id,
      () => {
        uiSfx('implant_install', 'notify', 0.7);
        this.flash = { id: def.id, slot, at: performance.now() };
      },
    );
  }

  private unequip(slot: SlotId): void {
    this.act(
      'unequip',
      { slot },
      (c) => !c.equip[slot],
      () => {
        uiSfx('implant_remove', 'ui_close', 0.7);
        this.flash = { slot, at: performance.now() };
      },
    );
  }

  private save(n: number): void {
    const eq = { ...this.host.priv().cyber.equip };
    this.act(
      'save',
      { n },
      (c) => !!c.loadouts[n] && sameEquip(c.loadouts[n]!, eq),
      () => {
        audio.play('notify', { volume: 0.5 });
        this.flash = { n, at: performance.now() };
      },
    );
  }

  private load(n: number): void {
    const lo = this.host.priv().cyber.loadouts[n];
    if (!lo) return;
    this.act(
      'load',
      { n },
      (c) => sameEquip(c.equip, lo),
      () => {
        uiSfx('implant_install', 'notify', 0.7);
        this.flash = { n, at: performance.now() };
      },
    );
  }

  /** Bouton refusé : son d'erreur, secousse et raison affichée. */
  private deny(why: string, el: HTMLElement): void {
    audio.play('ui_error', { volume: 0.5 });
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    this.setFeedback(why, 'bad');
  }

  private setFeedback(text: string, kind: string): void {
    this.feedback = { text, kind, at: performance.now() };
    this.feedbackEl.className = `cy-feedback ${kind}`;
    this.feedbackEl.textContent = text;
  }

  private button(label: (Node | string)[] | string, cls: string, run: () => void, why: string | null): HTMLElement {
    const b: HTMLElement = h(
      'button',
      {
        class: `btn ${cls}${why ? ' off' : ''}`,
        'aria-disabled': why ? 'true' : null,
        title: why ?? null,
        on: { click: () => (why ? this.deny(why, b) : run()), pointerenter: () => this.hover() },
      },
      label,
    );
    return b;
  }

  // ======================================================================= itinéraire

  /** Lieu d'installation le plus proche du parrain. */
  nearestStation(clinicsOnly = false): { spot: StationSpot; dist: number } | null {
    const w = this.host.world;
    if (!w) return null;
    const p = this.host.playerPos();
    return nearestSpot(stationSpots(w, this.host.pub(), this.host.priv(), this.host.you), p.x, p.z, clinicsOnly);
  }

  /** Itinéraire en cours (lieu visé), ou null. */
  get routeTarget(): StationSpot | null {
    return this.route;
  }

  /** Balise lumineuse et repère de mini-carte vers un lieu (null : on efface). */
  setRoute(spot: StationSpot | null): void {
    this.route = spot;
    this.miniAcc = 1;
    if (spot) {
      this.beam?.show(spot.x, spot.y, spot.z);
      const p = this.host.playerPos();
      this.host.notify?.(`Itinéraire : ${spot.name} (${distText(Math.hypot(spot.x - p.x, spot.z - p.z))}) — suivez la balise cyan.`, 'info');
      this.updateRoute();
    } else {
      this.beam?.hide();
      this.drawMini();
    }
    if (this.opened) this.render(true);
  }

  private updateRoute(): void {
    const r = this.route;
    if (!r) return;
    const p = this.host.playerPos();
    if (Math.hypot(r.x - p.x, r.z - p.z) < 4 && Math.abs(r.y - p.y) < 3) {
      this.host.notify?.(`Vous êtes arrivé : ${r.name}.`, 'good');
      audio.play('notify', { volume: 0.5 });
      this.setRoute(null);
      return;
    }
    this.drawMini();
  }

  /** Repère sur la mini-carte (calque posé sur celle du HUD, nord en haut, 62 m de rayon). */
  private drawMini(): void {
    const mm = this.host.minimap;
    if (!mm) return;
    if (!this.mini) {
      this.mini = h('canvas', { class: 'cy-mini', width: mm.width, height: mm.height });
      mm.parentElement?.appendChild(this.mini);
    }
    const c = this.mini.getContext('2d');
    if (!c) return;
    const W = this.mini.width;
    c.clearRect(0, 0, W, W);
    const r = this.route;
    if (!r) return;
    const p = this.host.playerPos();
    const k = W / 2 / 62;
    let dx = (r.x - p.x) * k;
    let dz = (r.z - p.z) * k;
    const d = Math.hypot(dx, dz);
    const max = W / 2 - 22;
    const edge = d > max;
    if (edge) {
      dx *= max / d;
      dz *= max / d;
    }
    const x = W / 2 + dx;
    const y = W / 2 + dz;
    c.save();
    c.shadowColor = '#4fd8ff';
    c.shadowBlur = 14;
    c.fillStyle = '#4fd8ff';
    c.strokeStyle = '#e9fbff';
    c.lineWidth = 3;
    if (edge) {
      // flèche au bord, pointée vers la clinique
      const a = Math.atan2(dz, dx);
      c.translate(x, y);
      c.rotate(a);
      c.beginPath();
      c.moveTo(16, 0);
      c.lineTo(-8, -11);
      c.lineTo(-3, 0);
      c.lineTo(-8, 11);
      c.closePath();
      c.fill();
      c.stroke();
    } else {
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.fillRect(-9, -9, 18, 18);
      c.strokeRect(-9, -9, 18, 18);
    }
    c.restore();
  }

  // ======================================================================= aperçu

  /**
   * Aperçu 3D du parrain (characters/preview.ts) dans un canevas neuf ; silhouette en cas d'échec,
   * et en qualité « basse » (machines modestes : pas de second contexte WebGL).
   */
  private ensurePreview(): void {
    if (this.preview || this.previewFailed || this.host.noPreview || settings.quality === 'basse') return;
    const canvas = h('canvas', { class: 'cy-canvas' });
    // sous les légendes de la scène (indice, aperçu), au-dessus de la grille
    this.stage.insertBefore(canvas, this.figure.nextSibling);
    this.canvas = canvas;
    this.resizeCanvas();
    try {
      this.preview = createCharacterPreview(canvas, { interactive: true, rotate: true, background: null });
      this.figure.classList.add('hidden');
      this.lookSig = '';
      if (!this.resizeObs) {
        this.resizeObs = new ResizeObserver(() => this.resizeCanvas());
        this.resizeObs.observe(this.stage);
      }
    } catch (err) {
      console.warn('Aperçu 3D du parrain indisponible :', err);
      this.previewFailed = true;
      this.dropPreview();
    }
  }

  /** Libère l'aperçu 3D (contexte WebGL) et son canevas ; la silhouette reprend la place. */
  private dropPreview(): void {
    try {
      this.preview?.dispose();
    } catch {
      /* déjà libéré */
    }
    this.preview = null;
    this.canvas?.remove();
    this.canvas = null;
    this.figure.classList.remove('hidden');
  }

  private resizeCanvas(): void {
    const c = this.canvas;
    if (!c) return;
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr));
    const hh = Math.max(2, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== hh) {
      c.width = w;
      c.height = hh;
    }
  }

  private onStageDown = (e: PointerEvent): void => {
    if (this.preview) return; // l'aperçu 3D gère lui-même la rotation
    this.drag = { x: e.clientX, rot: this.figRot };
    this.figure.classList.add('dragging');
  };

  private onStageMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    this.figRot = Math.max(-50, Math.min(50, this.drag.rot + (e.clientX - this.drag.x) * 0.35));
    this.figure.style.setProperty('--rot', `${this.figRot}deg`);
  };

  private onPointerUp = (): void => {
    if (this.drag) {
      this.drag = null;
      this.figure.classList.remove('dragging');
      // la silhouette revient doucement de face
      this.figRot = 0;
      this.figure.style.setProperty('--rot', '0deg');
    }
    if (this.pointerDown) {
      this.pointerDown = false;
      if (this.dirty && this.opened) this.render(true);
    }
  };

  // ======================================================================= rendu

  private same(part: string, sig: unknown): boolean {
    const s = JSON.stringify(sig);
    if (this.sigs.get(part) === s) return true;
    this.sigs.set(part, s);
    return false;
  }

  private flashOn(): boolean {
    return !!this.flash && performance.now() - this.flash.at < 1200;
  }

  render(force = false): void {
    if (!this.opened) return;
    if (this.pointerDown && !force) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    if (this.selId && !IMPLANT_BY_ID[this.selId]) this.selId = null;
    if (!this.selId) this.selectSlot(this.selSlot, false);
    this.renderHead();
    this.renderSlots();
    this.renderList();
    this.renderDetail();
    this.renderActions();
    this.renderStage();
    this.renderLoadouts();
    if (this.flash && !this.flashOn()) this.flash = null;
  }

  private renderHead(): void {
    const p = this.host.priv();
    const c = p.cyber;
    const money = formatMoney(p.money);
    if (this.fundsEl.textContent !== money) this.fundsEl.textContent = money;
    const used = SLOTS.filter((s) => c.equip[s.id]).length;
    const owned = Object.keys(c.owned).length;
    const sub = `${BOSS_NAME[this.host.you]} · ${used}/${SLOTS.length} emplacements occupés · ${owned}/${IMPLANTS.length} implants possédés`;
    if (this.subEl.textContent !== sub) this.subEl.textContent = sub;
    this.slotCount.textContent = `${used}/${SLOTS.length}`;
    // bandeau de la station
    const near = c.station ? null : this.nearestStation();
    const dist10 = near ? Math.round(near.dist / 10) : -1;
    if (this.same('station', [c.station, near?.spot.key, dist10, this.route?.key])) return;
    const st = this.stationEl;
    clear(st);
    st.className = `cy-station ${c.station ? 'ok' : 'off'}`;
    if (c.station) {
      st.appendChild(h('span', { class: 'cy-st-dot' }));
      st.appendChild(
        h(
          'div',
          { class: 'cy-st-txt' },
          h('b', null, `Station : ${c.station === 'qg' ? 'QG' : stationName(c.station, this.host.world)} — installation possible`),
          h('small', null, 'Achats, améliorations, installations et configurations disponibles.'),
        ),
      );
    } else {
      st.appendChild(h('span', { class: 'cy-st-dot' }));
      st.appendChild(
        h(
          'div',
          { class: 'cy-st-txt' },
          h('b', null, 'Hors station : consultation seulement'),
          h('small', null, 'Rendez-vous dans une clinique ou à la station de votre QG.'),
        ),
      );
      if (near) {
        const on = this.route?.key === near.spot.key;
        st.appendChild(
          h(
            'button',
            {
              class: `cy-route${on ? ' on' : ''}`,
              title: on ? 'Effacer l’itinéraire' : `Itinéraire vers ${near.spot.name} : balise lumineuse et repère sur la mini-carte`,
              on: {
                click: () => {
                  uiSfx('cyber_ui_select', 'ui_click', 0.5);
                  this.setRoute(on ? null : near.spot);
                },
                pointerenter: () => this.hover(),
              },
            },
            h('span', null, on ? 'Itinéraire actif ✓' : 'Itinéraire'),
            h('small', null, `${near.spot.name} · ${distText(near.dist).replace(/^à /, '')}`),
          ),
        );
      }
    }
  }

  private renderSlots(): void {
    const c = this.host.priv().cyber;
    const sig = [c.equip, SLOTS.map((s) => (c.equip[s.id] ? c.owned[c.equip[s.id]!] : 0)), this.selSlot, this.focusCol, this.flashOn() ? this.flash : null];
    if (this.same('slots', sig)) return;
    clear(this.slotsEl);
    for (const g of SLOT_GROUPS) {
      const multi = g.slots.length > 1;
      const block = h('div', { class: `cy-group${g.slots.includes(this.selSlot) ? ' on' : ''}` });
      // les catégories à plusieurs emplacements ont un titre ; les autres portent leur nom sur la carte
      if (multi) {
        const n = g.slots.filter((s) => c.equip[s]).length;
        block.appendChild(
          h(
            'div',
            {
              class: 'cy-ghead',
              on: {
                click: () => {
                  this.selectSlot(g.slots.find((s) => !c.equip[s]) ?? g.slots[0]);
                  this.focusCol = 'slots';
                  this.render(true);
                },
                pointerenter: () => this.hover(),
              },
            },
            h('span', { class: 'cy-gico', html: iconSvg(CAT_ICON[g.cat]) }),
            h('span', { class: 'cy-glabel' }, g.label),
            h('span', { class: 'cy-gcount' }, `${n}/${g.slots.length}`),
          ),
        );
      }
      for (const s of g.slots) block.appendChild(this.slotCard(s, multi));
      this.slotsEl.appendChild(block);
    }
  }

  private slotCard(s: SlotId, multi: boolean): HTMLElement {
    const c = this.host.priv().cyber;
    const id = c.equip[s];
    const def = id ? IMPLANT_BY_ID[id] : null;
    const lv = def ? Math.max(1, c.owned[def.id] ?? 1) : 0;
    const sel = s === this.selSlot;
    const flash = this.flashOn() && this.flash?.slot === s;
    const where = multi ? slotShort(s) : s === 'colonne' ? 'Colonne' : SLOT_BY_ID[s].label;
    return h(
      'div',
      {
        class: `cy-slot${def ? '' : ' empty'}${sel ? ' sel' : ''}${sel && this.focusCol === 'slots' ? ' focus' : ''}${flash ? ' flash' : ''}`,
        style: def ? `--ic:${hex(def.color)};--qc:${qualityColor(def, lv)}` : '',
        'data-slot': s,
        title: def ? `${SLOT_BY_ID[s].label} — ${def.name} (${qualityOf(def, lv)}, niveau ${lv}/${def.levels.length})` : `${SLOT_BY_ID[s].label} — emplacement libre`,
        on: {
          click: () => {
            this.selectSlot(s);
            this.focusCol = 'slots';
            this.render(true);
          },
          pointerenter: () => this.hover(),
        },
      },
      h('span', { class: 'cy-ico', html: def ? implantIcon(def.id) : iconSvg(CAT_ICON[SLOT_BY_ID[s].cat]) }),
      h(
        'div',
        { class: 'cy-slot-txt' },
        h('b', null, def ? def.name : 'Emplacement libre'),
        h(
          'div',
          { class: 'cy-slot-sub' },
          h('span', { class: 'cy-where' }, where),
          def ? h('span', { class: 'cy-qtxt' }, qualityOf(def, lv)) : h('span', { class: 'cy-plus' }, '+ installer'),
          def ? this.pips(def, lv) : null,
        ),
      ),
    );
  }

  private pips(def: ImplantDef, lv: number): HTMLElement {
    return h('span', { class: 'cy-pips', title: `Niveau ${lv}/${def.levels.length}` }, ...def.levels.map((_, i) => h('i', { class: i < lv ? 'on' : '', style: `--pc:${qualityColor(def, i + 1)}` })));
  }

  private renderList(): void {
    const p = this.host.priv();
    const c = p.cyber;
    const cat = SLOT_BY_ID[this.selSlot].cat;
    const items = IMPLANTS.filter((x) => x.cat === cat);
    const sig = [
      cat,
      items.map((d) => [c.owned[d.id] ?? 0, slotOf(c.equip, d.id), p.money >= (d.levels[c.owned[d.id] ?? 0]?.price ?? Infinity)]),
      this.selId,
      this.focusCol,
      this.pending?.id,
      this.flashOn() ? this.flash : null,
    ];
    if (this.same('list', sig)) return;
    const owned = items.filter((d) => c.owned[d.id]).length;
    clear(this.listHead);
    this.listHead.appendChild(h('span', null, `${CAT_LABEL[cat]}`));
    this.listHead.appendChild(h('span', { class: 'cy-colcount' }, `${owned}/${items.length} possédés`));
    clear(this.listEl);
    for (const d of items) this.listEl.appendChild(this.row(d, p));
  }

  private row(d: ImplantDef, p: PrivateState): HTMLElement {
    const c = p.cyber;
    const lv = c.owned[d.id] ?? 0;
    const at = slotOf(c.equip, d.id);
    const maxed = lv >= d.levels.length;
    const price = maxed ? 0 : d.levels[lv].price;
    const sel = d.id === this.selId;
    const flash = this.flashOn() && this.flash?.id === d.id;
    const busy = this.pending?.id === d.id;
    const qLv = Math.max(1, lv);
    const badge = at ? h('span', { class: 'cy-badge inst' }, `Installé · ${slotAbbr(at)}`) : lv ? h('span', { class: 'cy-badge own' }, 'En réserve') : null;
    return h(
      'div',
      {
        class: `cy-item${lv ? ' owned' : ''}${at ? ' installed' : ''}${sel ? ' sel' : ''}${sel && this.focusCol === 'list' ? ' focus' : ''}${flash ? ' flash' : ''}${busy ? ' busy' : ''}`,
        style: `--ic:${hex(d.color)};--qc:${qualityColor(d, qLv)}`,
        'data-id': d.id,
        on: {
          click: () => {
            this.selectImplant(d.id);
            this.focusCol = 'list';
            this.render(true);
          },
          pointerenter: () => this.hover(),
        },
      },
      h('span', { class: 'cy-ico', html: implantIcon(d.id) }),
      h(
        'div',
        { class: 'cy-item-txt' },
        h('b', null, d.name),
        h('div', { class: 'cy-item-meta' }, h('span', { class: `cy-q${lv ? '' : ' dim'}` }, qualityOf(d, qLv)), badge, h('span', { class: 'cy-kind' }, KIND_LABEL[d.kind])),
      ),
      h(
        'div',
        { class: 'cy-item-side' },
        maxed
          ? h('span', { class: 'cy-price max' }, 'MAX')
          : h('span', { class: `cy-price${p.money >= price ? '' : ' short'}`, title: lv ? 'Prix du niveau suivant' : 'Prix d’achat' }, `${lv ? '↑ ' : ''}${formatMoney(price)}`),
        lv ? this.pips(d, lv) : h('span', { class: 'cy-new' }, 'Non possédé'),
      ),
    );
  }

  private renderDetail(): void {
    const p = this.host.priv();
    const c = p.cyber;
    const def = this.selId ? IMPLANT_BY_ID[this.selId] : null;
    if (!def) return;
    const lv = c.owned[def.id] ?? 0;
    const occupant = c.equip[this.selSlot];
    const sig = [def.id, lv, c.equip, this.selSlot, this.compare, occupant ? c.owned[occupant] : 0, settings.bindings, this.flashOn() && this.flash?.id === def.id];
    if (this.same('detail', sig)) return;
    const at = slotOf(c.equip, def.id);
    const maxed = lv >= def.levels.length;
    const qLv = Math.max(1, lv);
    const el = this.detailEl;
    const scroll = this.detailFor === def.id ? el.scrollTop : 0;
    this.detailFor = def.id;
    clear(el);
    el.style.setProperty('--ic', hex(def.color));
    el.style.setProperty('--qc', qualityColor(def, qLv));
    // en-tête
    el.appendChild(
      h(
        'div',
        { class: 'cy-card-head' },
        h('span', { class: 'cy-ico big', html: implantIcon(def.id) }),
        h(
          'div',
          { class: 'cy-card-title' },
          h('div', { class: 'cy-name' }, def.name),
          h(
            'div',
            { class: 'cy-tags' },
            h('span', { class: 'cy-q' }, lv ? `${qualityOf(def, lv)} · niv. ${lv}/${def.levels.length}` : `${qualityOf(def, 1)} · non possédé`),
            h('span', { class: 'cy-kind' }, KIND_LABEL[def.kind]),
            at ? h('span', { class: 'cy-badge inst', title: `Installé : ${SLOT_BY_ID[at].label}` }, `Installé · ${slotAbbr(at)}`) : lv ? h('span', { class: 'cy-badge own' }, 'En réserve') : null,
          ),
        ),
      ),
    );
    el.appendChild(h('p', { class: 'cy-summary' }, def.summary));
    // commande
    const ctl = controlFor(c.equip, def.id, at ?? this.selSlot);
    el.appendChild(
      h(
        'div',
        { class: 'cy-control' },
        h('span', { class: 'cy-lbl' }, 'Commande'),
        ctl.key ? h('span', { class: 'keycap' }, ctl.key) : h('span', { class: 'keycap auto' }, chipKey(null, def.id)),
        h('span', null, ctl.text.replace(/^Touche [^—]+— /, '')),
      ),
    );
    // paramètres
    const la = Math.max(1, lv);
    const lb = lv > 0 && !maxed ? lv + 1 : 0;
    el.appendChild(this.paramTable(lb ? `Niveau ${la}` : lv ? `Niveau ${la} (max)` : 'Niveau 1', lb ? `Niveau ${lb}` : null, paramRows(def.id, la, lb)));
    // piste des niveaux
    const track = h('div', { class: 'cy-track' });
    levelTrack(def).forEach((t, i) => {
      const n = i + 1;
      track.appendChild(
        h(
          'div',
          { class: `cy-step${n <= lv ? ' on' : ''}${n === lv ? ' cur' : ''}${n === lv + 1 ? ' next' : ''}`, style: `--pc:${t.color}`, title: `Niveau ${n} — ${t.q} — ${formatMoney(t.price)}\n${t.desc}` },
          h('i'),
          h('small', null, t.q),
          h('span', null, formatMoney(t.price)),
        ),
      );
    });
    el.appendChild(track);
    // niveaux : actuel et suivant
    const lvBox = h('div', { class: 'cy-levels' });
    if (lv === 0) lvBox.appendChild(this.levelLine('À l’achat', def, 1, null));
    else if (!maxed) lvBox.appendChild(this.levelLine('Suivant', def, lv + 1, lv));
    else
      lvBox.appendChild(
        h(
          'div',
          { class: 'cy-lv max' },
          h('div', { class: 'cy-lv-head' }, h('span', { class: 'cy-lbl' }, 'Niveau maximal'), h('b', null, `Niveau ${lv} · ${qualityOf(def, lv)}`)),
          h('div', { class: 'cy-lv-desc' }, def.levels[lv - 1].desc),
        ),
      );
    el.appendChild(lvBox);
    // comparaison avec l'implant de l'emplacement
    if (occupant && occupant !== def.id) {
      const od = IMPLANT_BY_ID[occupant];
      const olv = c.owned[occupant] ?? 1;
      const tgl = h(
        'button',
        {
          class: `cy-compare-btn${this.compare ? ' on' : ''}`,
          on: {
            click: () => {
              this.compare = !this.compare;
              uiSfx('cyber_ui_select', 'ui_click', 0.45);
              this.render(true);
              if (this.compare) this.detailEl.querySelector('.cy-compare-btn')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            },
            pointerenter: () => this.hover(),
          },
        },
        `⇄ ${this.compare ? 'Masquer la comparaison' : 'Comparer'} avec ${od.name} (installé · ${SLOT_BY_ID[this.selSlot].label})`,
      );
      el.appendChild(tgl);
      if (this.compare) {
        el.appendChild(
          h(
            'div',
            { class: 'cy-cmp-legend' },
            h('span', { style: `--ic:${hex(od.color)}` }, h('i'), `Installé : ${od.name} (niv. ${olv})`),
            h('span', { style: `--ic:${hex(def.color)}` }, h('i'), `Sélection : ${def.name} (niv. ${la})`),
          ),
        );
        el.appendChild(this.paramTable('Installé', 'Sélection', compareRows(occupant, olv, def.id, la), true));
      }
    }
    // signature lumineuse
    el.appendChild(
      h(
        'div',
        { class: 'cy-identity' },
        h('span', { class: 'cy-swatch' }),
        h('span', null, `Signature lumineuse : ${colorName(def.color)}`),
        h('code', null, hex(def.color).toUpperCase()),
        h('span', { class: 'cy-cat' }, `${CAT_LABEL[def.cat]}`),
      ),
    );
    el.scrollTop = scroll;
  }

  /** Niveau à venir (achat ou amélioration), avec ce qu'apporte le niveau actuel en rappel. */
  private levelLine(lbl: string, def: ImplantDef, n: number, cur: number | null): HTMLElement {
    const l = def.levels[n - 1];
    return h(
      'div',
      { class: 'cy-lv next', style: `--pc:${qualityColor(def, n)}` },
      h('div', { class: 'cy-lv-head' }, h('span', { class: 'cy-lbl' }, lbl), h('b', null, `Niveau ${n} · ${qualityOf(def, n)}`), h('span', { class: 'cy-lv-price' }, formatMoney(l.price))),
      h('div', { class: 'cy-lv-desc' }, l.desc),
      cur ? h('div', { class: 'cy-lv-cur' }, h('span', null, `Actuel (niv. ${cur}) : `), def.levels[cur - 1].desc) : null,
    );
  }

  private paramTable(ha: string, hb: string | null, rows: ParamRow[], cmp = false): HTMLElement {
    const t = h('div', { class: `cy-params${hb ? ' two' : ''}${cmp ? ' cmp' : ''}` });
    t.appendChild(h('span', { class: 'cy-ph' }, cmp ? 'Comparaison' : 'Caractéristiques'));
    t.appendChild(h('span', { class: 'cy-ph v' }, ha));
    if (hb) {
      t.appendChild(h('span', { class: 'cy-ph' }));
      t.appendChild(h('span', { class: 'cy-ph v' }, hb));
    }
    for (const r of rows) {
      const cls = r.delta === 1 ? 'up' : r.delta === -1 ? 'down' : r.delta === 0 ? 'same' : '';
      t.appendChild(h('span', { class: `cy-pl ${cls}` }, r.label));
      t.appendChild(h('span', { class: `cy-pv ${r.a === null ? 'none' : ''}` }, r.a ?? '—'));
      if (hb) {
        t.appendChild(h('span', { class: `cy-pa ${cls}` }, r.delta === 1 ? '▲' : r.delta === -1 ? '▼' : r.delta === 0 ? '=' : ''));
        t.appendChild(h('span', { class: `cy-pv b ${cls}${r.b === null ? ' none' : ''}` }, r.b ?? '—'));
      }
    }
    return t;
  }

  private renderActions(): void {
    const p = this.host.priv();
    const c = p.cyber;
    const def = this.selId ? IMPLANT_BY_ID[this.selId] : null;
    if (!def) return;
    const lv = c.owned[def.id] ?? 0;
    const maxed = lv >= def.levels.length;
    const price = maxed ? 0 : def.levels[lv].price;
    const at = slotOf(c.equip, def.id);
    const occupant = c.equip[this.selSlot];
    const station = !!c.station;
    const sig = [def.id, lv, at, occupant, this.selSlot, station, p.money >= price, this.pending ? [this.pending.op, this.pending.id, this.pending.slot] : null];
    if (this.same('actions', sig)) return;
    const box = this.actionsEl;
    clear(box);
    const pend = this.pending;
    const offWhy = 'Hors station : rendez-vous dans une clinique ou à la station de votre QG.';
    const busyWhy = 'Une action est en cours…';
    const short = (n: number) => `Fonds insuffisants : il manque ${formatMoney(n - p.money)}.`;
    /** Contenu d'un bouton sur deux lignes : l'action, puis son détail (prix, emplacement). */
    const two = (main: string, sub: string, op: Op | null): (Node | string)[] => (op && pend && pend.op === op && (pend.id === def.id || pend.slot === at) ? [h('span', null, PENDING_TEXT[op])] : [h('span', null, main), h('small', null, sub)]);
    const row = h('div', { class: 'cy-btnrow' });
    const notes: HTMLElement[] = [];
    // achat ou amélioration
    if (lv === 0) {
      const busy = pend?.op === 'buy' && pend.id === def.id;
      const why = busy ? null : pend ? busyWhy : !station ? offWhy : p.money < price ? short(price) : null;
      row.appendChild(this.button(two('Acheter', formatMoney(price), 'buy'), `cy-primary${busy ? ' pending' : ''}`, () => this.buy(def), why));
      const free = SLOTS.find((s) => s.cat === def.cat && !c.equip[s.id]);
      notes.push(h('div', { class: 'cy-note' }, free ? `Se pose tout seul dans un emplacement libre : ${free.label}.` : `Aucun emplacement libre (${CAT_LABEL[def.cat].toLowerCase()}) : il rejoindra votre réserve ; installez-le ensuite à la place d’un autre.`));
    } else if (!maxed) {
      const busy = pend?.op === 'upgrade' && pend.id === def.id;
      const why = busy ? null : pend ? busyWhy : !station ? offWhy : p.money < price ? short(price) : null;
      row.appendChild(this.button(two('Améliorer', `${formatMoney(price)} → ${qualityOf(def, lv + 1)}`, 'upgrade'), `cy-primary${busy ? ' pending' : ''}`, () => this.upgrade(def, lv), why));
    } else {
      row.appendChild(h('div', { class: 'cy-maxed' }, h('span', null, 'Niveau maximal'), h('small', null, qualityOf(def, lv))));
    }
    // installation (ou déplacement) dans l'emplacement choisi, retrait
    if (lv > 0) {
      if (at !== this.selSlot) {
        const busy = pend?.op === 'equip' && pend.id === def.id;
        const why = busy ? null : pend ? busyWhy : !station ? offWhy : null;
        row.appendChild(this.button(two(at ? 'Déplacer ici' : 'Installer', slotTag(this.selSlot), 'equip'), `ghost cy-install${busy ? ' pending' : ''}`, () => this.equip(def, this.selSlot), why));
        if (occupant) notes.push(h('div', { class: 'cy-note warn' }, `Remplace : ${IMPLANT_BY_ID[occupant].name} (niv. ${c.owned[occupant] ?? 1}), qui retourne dans votre réserve.`));
        if (at) notes.push(h('div', { class: 'cy-note' }, `Quitte l’emplacement : ${SLOT_BY_ID[at].label}.`));
      }
      if (at) {
        const busy = pend?.op === 'unequip' && pend.slot === at;
        const why = busy ? null : pend ? busyWhy : !station ? offWhy : null;
        row.appendChild(this.button(two('Retirer', slotTag(at), 'unequip'), `ghost cy-remove${busy ? ' pending' : ''}`, () => this.unequip(at), why));
      }
    }
    box.appendChild(row);
    if (!station) notes.unshift(h('div', { class: 'cy-note off' }, 'Hors station : achats, améliorations et installations se font dans une clinique ou à la station de votre QG.'));
    else if (lv > 0 && !maxed && p.money < price) notes.unshift(h('div', { class: 'cy-note warn' }, short(price)));
    else if (lv === 0 && p.money < price) notes.unshift(h('div', { class: 'cy-note warn' }, short(price)));
    for (const n of notes) box.appendChild(n);
  }

  private renderStage(): void {
    const c = this.host.priv().cyber;
    const def = this.selId ? IMPLANT_BY_ID[this.selId] : null;
    const occupant = c.equip[this.selSlot];
    // essayage : l'implant choisi s'affiche dans l'emplacement sélectionné
    const tryOn = def && occupant !== def.id ? def : null;
    const look: Equipment = { ...c.equip };
    if (tryOn) {
      for (const s of SLOTS) if (look[s.id] === tryOn.id) look[s.id] = null;
      look[this.selSlot] = tryOn.id;
    }
    // aperçu 3D
    if (this.preview) {
      const cyber = cyberLook(look, c.owned);
      const sig = JSON.stringify([cyber, settings.custom[this.host.you], this.selSlot]);
      if (sig !== this.lookSig) {
        this.lookSig = sig;
        try {
          this.preview.setLook(this.host.you === 'dadou' ? CharKind.BOSS_DADOU : CharKind.BOSS_EVEN, settings.custom[this.host.you], cyber);
          this.preview.highlightSlot(this.selSlot);
        } catch (err) {
          console.warn('Aperçu 3D : apparence refusée.', err);
          this.previewFailed = true;
          this.dropPreview();
        }
      }
    }
    // silhouette de repli et légende
    const sig = [look, c.equip, this.selSlot, tryOn?.id, c.owned];
    if (!this.same('stage', sig)) {
      for (const s of SLOTS) {
        const g = this.figure.querySelector<SVGGElement>(`.cy-node[data-slot="${s.id}"]`);
        if (!g) continue;
        const id = look[s.id];
        const d = id ? IMPLANT_BY_ID[id] : null;
        g.classList.toggle('on', !!d);
        g.classList.toggle('sel', s.id === this.selSlot);
        g.classList.toggle('try', !!tryOn && s.id === this.selSlot);
        g.style.setProperty('--ic', d ? hex(d.color) : '#7c8cff');
      }
      clear(this.stageLabel);
      const sl = SLOT_BY_ID[this.selSlot].label;
      if (tryOn) {
        this.stageLabel.className = 'cy-stage-label try';
        this.stageLabel.appendChild(h('span', { class: 'cy-lbl' }, 'Aperçu'));
        this.stageLabel.appendChild(h('span', null, `${tryOn.name} → ${sl}`));
        this.stageLabel.appendChild(h('small', null, c.owned[tryOn.id] ? (slotOf(c.equip, tryOn.id) ? 'installé ailleurs' : 'en réserve') : 'non possédé'));
      } else {
        this.stageLabel.className = 'cy-stage-label';
        this.stageLabel.appendChild(h('span', { class: 'cy-lbl' }, sl));
        this.stageLabel.appendChild(h('span', null, occupant ? IMPLANT_BY_ID[occupant].name : 'Emplacement libre'));
      }
    }
    // commandes des implants installés
    const ctl = implantControls(c.equip).filter((x) => x.action || IMPLANT_BY_ID[x.id]?.trigger === 'saut' || IMPLANT_BY_ID[x.id]?.trigger === 'accroupi');
    if (!this.same('controls', [ctl, settings.bindings])) {
      clear(this.controlsEl);
      this.controlsEl.appendChild(h('span', { class: 'cy-lbl' }, 'Commandes'));
      if (ctl.length === 0) this.controlsEl.appendChild(h('span', { class: 'cy-ctl-none' }, 'Aucune capacité à déclencher : installez un implant actif (grappin, lame, esquive, scanner…).'));
      for (const x of ctl) {
        const d = IMPLANT_BY_ID[x.id];
        this.controlsEl.appendChild(
          h('span', { class: 'cy-ctl', style: `--ic:${hex(d.color)}`, title: controlFor(c.equip, x.id, x.slot).text }, h('span', { class: 'keycap' }, chipKey(x.action, x.id)), h('span', null, d.name)),
        );
      }
    }
  }

  private renderLoadouts(): void {
    const c = this.host.priv().cyber;
    const station = !!c.station;
    const sig = [c.loadouts, c.equip, station, this.pending ? [this.pending.op, this.pending.n] : null, this.flashOn() ? this.flash?.n : null];
    if (this.same('loadouts', sig)) return;
    const box = this.loadoutsEl;
    clear(box);
    box.appendChild(
      h('div', { class: 'cy-lo-head' }, h('span', { class: 'cy-lbl' }, 'Configurations'), h('small', null, station ? 'Enregistrez votre équipement, appliquez-le en un geste.' : 'Enregistrer : partout · Appliquer : en station.')),
    );
    const row = h('div', { class: 'cy-lo-row' });
    for (let n = 0; n < LOADOUT_COUNT; n++) {
      const lo = c.loadouts[n] ?? null;
      const count = lo ? SLOTS.filter((s) => lo[s.id]).length : 0;
      const active = !!lo && sameEquip(lo, c.equip);
      const flash = this.flashOn() && this.flash?.n === n;
      const card = h('div', { class: `cy-lo${active ? ' active' : ''}${lo ? '' : ' empty'}${flash ? ' flash' : ''}` });
      card.appendChild(
        h('div', { class: 'cy-lo-name' }, h('b', null, LOADOUT_NAMES[n] ?? `Configuration ${n + 1}`), h('small', null, !lo ? 'Vide' : active ? 'Équipée' : `${count} implant${count > 1 ? 's' : ''}`)),
      );
      const dots = h('div', { class: 'cy-lo-dots' });
      for (const s of SLOTS) {
        const id = lo?.[s.id];
        const d = id ? IMPLANT_BY_ID[id] : null;
        dots.appendChild(h('i', { class: d ? 'on' : '', style: d ? `--ic:${hex(d.color)}` : '', title: `${s.label} : ${d ? d.name : 'libre'}` }));
      }
      card.appendChild(dots);
      const pend = this.pending;
      const busy = pend && pend.n === n ? PENDING_TEXT[pend.op] : '';
      const btns = h('div', { class: 'cy-lo-btns' });
      btns.appendChild(this.button(busy && pend?.op === 'save' ? busy : 'Enregistrer', 'small ghost', () => this.save(n), pend ? 'Une action est en cours…' : null));
      const whyLoad = pend ? 'Une action est en cours…' : !lo ? 'Configuration vide : enregistrez d’abord votre équipement.' : active ? 'Cette configuration est déjà installée.' : !station ? 'Hors station : appliquer une configuration se fait dans une clinique ou à la station de votre QG.' : null;
      btns.appendChild(this.button(busy && pend?.op === 'load' ? busy : 'Appliquer', 'small cy-apply', () => this.load(n), whyLoad));
      card.appendChild(btns);
      row.appendChild(card);
    }
    box.appendChild(row);
  }
}

// ------------------------------------------------------------------------------- partie

export function createCyberUi(gc: GameClient): CyberUi {
  return new CyberUi({
    you: gc.you,
    selfId: gc.selfId,
    priv: () => gc.priv,
    pub: () => gc.pub,
    world: gc.world,
    act: (a) => gc.app.net.act(a),
    setUiOpen: (open) => gc.setUiOpen(open),
    mount: gc.hud.el.parentElement ?? gc.app.root,
    playerPos: () => gc.player.pos,
    notify: (text, kind) => gc.hud.notify(text, kind, 6000),
    scene: gc.scene,
    minimap: gc.hud.minimapCanvas,
  });
}

/** Écran CYBERNÉTIQUE de la partie (module), s'il existe. */
export function cyberUiOf(gc: GameClient): CyberUi | null {
  return (gc.modules.find((m) => m instanceof CyberUi) as CyberUi | undefined) ?? null;
}

/**
 * Ouvre l'écran CYBERNÉTIQUE (téléphone, comptoir d'une clinique, station du QG).
 * focus : emplacement (« brasG »), catégorie (« jambes ») ou implant (« grappin »).
 */
export function openCyberScreen(gc: GameClient, focus?: string): void {
  cyberUiOf(gc)?.open(focus);
}
