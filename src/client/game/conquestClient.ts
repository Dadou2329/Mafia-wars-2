// Prise de contrôle des bâtiments (client) : repères holographiques des objectifs (visibles à
// travers les murs pour l'attaquant et le défenseur), panneau de l'opération à la place de
// l'ancienne barre de capture, invites aux objectifs (« Pirater le serveur central »,
// « Forcer la chambre forte »…), objet emporté, reprise d'une étape volée, et le court piratage
// interactif des serveurs (marché tech, centres de données, usines). Tout vient de l'état public
// du serveur (PublicState.ops) : une reconnexion retrouve exactement l'opération en cours.
// Braquage (argent seulement) et prise de contrôle (le bâtiment change de mains) restent
// distincts à l'écran.

import * as THREE from 'three';
import '../ui/conquest.css';
import { BOSS_NAME, DE_BOSS, HQ_CAPTURE_MIN_DISTRICTS } from '../../shared/constants';
import { BUILDINGS, DISTRICT_BY_ID, DISTRICTS, Faction } from '../../shared/city/plan';
import type { BuildingInfo } from '../../shared/city/gen/context';
import {
  NO_BOSS_PARAMS,
  OP_LEVEL_NAME,
  OP_MINIGAME_MAX,
  OP_MINIGAME_MIN,
  aPlace,
  bossWorkRange,
  opOverall,
  opPlan,
  opRadius,
  type OpBossParams,
  type OpPlan,
  type OpStep,
} from '../../shared/conquest';
import { SLOTS, implantParams } from '../../shared/implants';
import type { GameEvent, OpPub, PublicState } from '../../shared/protocol';
import { formatMoney } from '../../shared/util';
import { deNom, leNom } from '../../shared/french';
import { audio } from '../audio/AudioEngine';
import { actionKey } from '../input/bindings';
import { settings } from '../settings';
import { h, clear } from '../ui/dom';
import type { GameClient } from './GameClient';
import type { ClientModule, Interaction } from './modules';

const COLOR = { mine: 0x4fd8ff, threat: 0xff3b4d, undo: 0xffb340, preview: 0xb05cff, item: 0xffd23c };
const nowS = (): number => performance.now() / 1000;
const pct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)} %`;
const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------- repère 3D

/** Repère holographique d'un objectif : losange, anneau au sol, faisceau et étiquette (à travers les murs). */
class OpMarker {
  readonly group = new THREE.Group();
  private gem: THREE.Mesh;
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  private label: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private mats: THREE.MeshBasicMaterial[];
  private sig = '';
  private phase = Math.random() * 6;

  constructor(gem: THREE.BufferGeometry, ring: THREE.BufferGeometry, beam: THREE.BufferGeometry) {
    const mat = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide });
    this.mats = [mat(0.95), mat(0.55), mat(0.22)];
    this.gem = new THREE.Mesh(gem, this.mats[0]);
    this.ring = new THREE.Mesh(ring, this.mats[1]);
    this.ring.rotation.x = -Math.PI / 2;
    this.beam = new THREE.Mesh(beam, this.mats[2]);
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, toneMapped: false }));
    this.label.scale.set(0.26, 0.065, 1);
    this.label.center.set(0.5, 0);
    for (const o of [this.ring, this.beam, this.gem, this.label]) {
      o.renderOrder = 60;
      o.frustumCulled = false;
      this.group.add(o);
    }
    this.group.visible = false;
  }

  set(x: number, y: number, z: number, color: number, l1: string, l2: string): void {
    this.group.position.set(x, y, z);
    this.group.visible = true;
    for (const m of this.mats) m.color.setHex(color);
    const sig = `${color}|${l1}|${l2}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 128);
    const css = `#${color.toString(16).padStart(6, '0')}`;
    c.font = '700 40px Rajdhani, "Segoe UI", sans-serif';
    const w1 = c.measureText(l1).width;
    c.font = '600 32px Rajdhani, "Segoe UI", sans-serif';
    const w2 = l2 ? c.measureText(l2).width : 0;
    const bw = Math.min(508, Math.max(w1, w2) + 34);
    const bx = (512 - bw) / 2;
    c.fillStyle = 'rgba(4, 6, 14, 0.78)';
    c.fillRect(bx, l2 ? 4 : 40, bw, l2 ? 120 : 84);
    c.strokeStyle = css;
    c.lineWidth = 3;
    c.strokeRect(bx + 1.5, (l2 ? 4 : 40) + 1.5, bw - 3, (l2 ? 120 : 84) - 3);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.font = '700 40px Rajdhani, "Segoe UI", sans-serif';
    c.fillText(l1, 256, l2 ? 44 : 82, 490);
    if (l2) {
      c.fillStyle = css;
      c.font = '600 32px Rajdhani, "Segoe UI", sans-serif';
      c.fillText(l2, 256, 92, 490);
    }
    this.tex.needsUpdate = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  update(now: number): void {
    if (!this.group.visible) return;
    const t = now + this.phase;
    this.gem.position.y = 1.55 + Math.sin(t * 2.2) * 0.08;
    this.gem.rotation.y = t * 1.6;
    const s = 1 + 0.18 * Math.sin(t * 3);
    this.ring.scale.set(s, s, s);
    this.ring.position.y = 0.06;
    this.mats[1].opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * 3));
    this.label.position.y = 2.05;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    (this.label.material as THREE.SpriteMaterial).dispose();
    this.tex.dispose();
  }
}

// ---------------------------------------------------------------------------- piratage interactif

/**
 * Le court piratage des serveurs : une aiguille balaie la piste, il faut la verrouiller dans la
 * zone verte (clic, Espace ou touche d'interaction) quatre fois en moins de 10 s. Un raté
 * déclenche l'alarme (le serveur prévient le propriétaire), on peut recommencer.
 */
class HackGame {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private txt: HTMLElement;
  private locksEl: HTMLElement;
  private zone: HTMLElement;
  private needle: HTMLElement;
  private timerFill: HTMLElement;
  private hint: HTMLElement;
  open = false;
  b = -1;
  k = '';
  private step = 0;
  private phase: 'play' | 'ok' | 'fail' = 'play';
  private t = 0;
  private x = 0;
  private dir = 1;
  private speed = 0.85;
  private zc = 0.5;
  private zw = 0.16;
  private locks = 0;
  private need = 4;
  private endAt = 0;
  private sent = false;
  failAt = -100;

  constructor(
    mount: HTMLElement,
    private send: (b: number, k: string, ok?: boolean) => void,
    private onClose: () => void,
  ) {
    this.title = h('div', { class: 'ttl' });
    this.txt = h('div', { class: 'txt' });
    this.locksEl = h('div', { class: 'locks' });
    this.zone = h('div', { class: 'zone' });
    this.needle = h('div', { class: 'needle' });
    this.timerFill = h('i');
    this.hint = h('div', { class: 'hint' });
    this.el = h(
      'div',
      { class: 'mw-op-hack hidden' },
      h('div', { class: 'box' }, this.title, this.txt, this.locksEl, h('div', { class: 'track' }, this.zone, this.needle), h('div', { class: 'timer' }, this.timerFill), this.hint),
    );
    this.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) this.hit();
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    mount.appendChild(this.el);
  }

  start(b: number, k: string, step: number, title: string, hackMul: number): void {
    this.b = b;
    this.k = k;
    this.step = step;
    this.open = true;
    this.phase = 'play';
    this.t = 0;
    this.x = 0;
    this.dir = 1;
    this.speed = 0.85;
    this.locks = 0;
    this.need = 4;
    this.sent = false;
    // le bras tactique élargit la fenêtre (piratage plus facile)
    this.zw = Math.min(0.3, 0.15 * Math.max(1, Math.sqrt(hackMul)));
    this.newZone();
    this.title.textContent = `Piratage — ${title}`;
    this.txt.textContent = 'Verrouillez le signal quatre fois : cliquez (ou Espace) quand l’aiguille traverse la zone verte.';
    this.hint.textContent = 'Un raté déclenche l’alarme. Échap : abandonner.';
    clear(this.locksEl);
    for (let i = 0; i < this.need; i++) this.locksEl.appendChild(h('i'));
    this.el.classList.remove('hidden', 'ok', 'fail');
    window.addEventListener('keydown', this.onKey, true);
    this.render();
  }

  /** L'étape a changé de main (lieutenant plus rapide, reprise…) ou on s'est éloigné : on ferme. */
  stale(step: number): boolean {
    return this.open && this.phase === 'play' && step !== this.step;
  }

  private newZone(): void {
    let c = 0.15 + Math.random() * 0.7;
    if (Math.abs(c - this.x) < 0.2) c = c > 0.5 ? c - 0.3 : c + 0.3;
    this.zc = c;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.open) return;
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') this.cancel();
    else if (e.code === 'Space' || e.code === 'Enter' || settings.bindings.interact.includes(e.code)) this.hit();
  };

  private hit(): void {
    if (!this.open || this.phase !== 'play') return;
    if (Math.abs(this.x - this.zc) <= this.zw / 2) {
      this.locks++;
      audio.play('hack_beep', { volume: 0.7, pitch: 1 + this.locks * 0.12 });
      if (this.locks >= this.need) {
        this.phase = 'ok';
        this.endAt = Math.max(this.t + 0.5, OP_MINIGAME_MIN + 0.3);
        this.txt.textContent = 'Signal verrouillé : transfert des accès…';
        this.el.classList.add('ok');
      } else {
        this.speed *= 1.14;
        this.newZone();
      }
    } else this.fail('Signal perdu !');
    this.render();
  }

  private fail(why: string): void {
    this.phase = 'fail';
    this.endAt = this.t + 1.3;
    this.failAt = nowS();
    this.txt.textContent = `${why} L’alarme se déclenche — recommencez vite.`;
    this.el.classList.add('fail');
    audio.play('hack_fail', { volume: 0.9 });
    this.send(this.b, this.k, false);
    this.sent = true;
  }

  cancel(): void {
    if (!this.open) return;
    if (this.phase === 'play') this.send(this.b, '');
    this.close();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    window.removeEventListener('keydown', this.onKey, true);
    this.onClose();
  }

  update(dt: number): void {
    if (!this.open) return;
    this.t += dt;
    if (this.phase === 'play') {
      this.x += this.dir * this.speed * dt;
      if (this.x > 1) {
        this.x = 2 - this.x;
        this.dir = -1;
      } else if (this.x < 0) {
        this.x = -this.x;
        this.dir = 1;
      }
      if (this.t >= OP_MINIGAME_MAX) this.fail('Temps écoulé !');
    } else if (this.t >= this.endAt) {
      if (this.phase === 'ok' && !this.sent) {
        this.sent = true;
        audio.play('hack_success', { volume: 0.9 });
        this.send(this.b, this.k, true);
      }
      this.close();
      return;
    }
    this.render();
  }

  private render(): void {
    this.zone.style.left = `${(this.zc - this.zw / 2) * 100}%`;
    this.zone.style.width = `${this.zw * 100}%`;
    this.needle.style.left = `${this.x * 100}%`;
    this.timerFill.style.width = `${Math.max(0, 1 - this.t / OP_MINIGAME_MAX) * 100}%`;
    const locks = this.locksEl.children;
    for (let i = 0; i < locks.length; i++) locks[i].classList.toggle('on', i < this.locks);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
  }
}

// ---------------------------------------------------------------------------- module

interface OpView {
  o: OpPub;
  /** Instant de réception (s). */
  t: number;
}

type PanelMode = 'mine' | 'threat' | 'preview';

export class ConquestClient implements ClientModule {
  private gc: GameClient;
  private ops = new Map<number, OpView>();
  private panel: HTMLElement;
  private panelSig = '';
  /** Bâtiment décrit par le panneau (−1 : masqué) : la barre de capture s'efface alors. */
  panelFor = -1;
  private group = new THREE.Group();
  private markers: OpMarker[] = [];
  private geos: THREE.BufferGeometry[];
  private hack: HackGame;
  private acc = 1;

  constructor(gc: GameClient) {
    this.gc = gc;
    this.panel = h('div', { class: 'mw-op-panel hidden' });
    gc.hud.el.appendChild(this.panel);
    this.geos = [new THREE.OctahedronGeometry(0.26, 0), new THREE.RingGeometry(0.62, 0.78, 40), new THREE.CylinderGeometry(0.035, 0.035, 1.4, 6, 1, true).translate(0, 0.7, 0)];
    for (let i = 0; i < 5; i++) {
      const m = new OpMarker(this.geos[0], this.geos[1], this.geos[2]);
      this.markers.push(m);
      this.group.add(m.group);
    }
    this.group.name = 'objectifs';
    gc.scene.add(this.group);
    this.hack = new HackGame(
      gc.hud.el.parentElement ?? gc.app.root,
      (b, k, ok) => gc.app.net.act({ a: 'op', b, k, ok }),
      () => gc.setUiOpen(false),
    );
    // la barre de capture héritée : remplacée par le panneau de l'opération
    gc.hud.captureFilter = (text) => {
      if (text === null || /^(Braquage|Piratage)/.test(text)) return undefined;
      return this.panelFor >= 0 ? { text: null, progress: 0, contested: false } : undefined;
    };
  }

  // ------------------------------------------------------------------ données

  private isHq(bid: number): boolean {
    const hq = this.gc.pub.hq;
    return !!hq && (hq.dadou === bid || hq.even === bid);
  }

  private info(bid: number): BuildingInfo {
    return this.gc.world.buildings[bid];
  }

  private plan(bid: number): OpPlan | null {
    const info = this.info(bid);
    return info ? opPlan(info, this.isHq(bid)) : null;
  }

  private owner(bid: number): number {
    return this.gc.pub.buildings[bid]?.owner ?? 0;
  }

  private reserved(bid: number): boolean {
    return !!BUILDINGS[bid].residence && this.owner(bid) === Faction.NEUTRAL;
  }

  private locked(bid: number): boolean {
    const hq = this.gc.pub.hq;
    const of = hq.dadou === bid ? 'dadou' : hq.even === bid ? 'even' : null;
    return !!of && of !== this.gc.you && (this.gc.pub.territories?.[this.gc.you] ?? 0) < HQ_CAPTURE_MIN_DISTRICTS;
  }

  /** Progression interpolée de l'étape en cours (l'état public arrive deux fois par seconde). */
  private prog(v: OpView): number {
    const dt = Math.min(1.2, nowS() - v.t);
    return Math.max(0, Math.min(1, v.o.p + v.o.rate * dt));
  }

  /** Étape à mener maintenant (caméras déjà coupées : la première étape « terminal » est acquise). */
  private curIndex(bid: number, plan: OpPlan, op: OpPub | undefined): number {
    if (op) return op.step;
    return plan.steps[0].key === 'terminal' && plan.steps.length > 1 && this.gc.pub.hacked?.includes(bid) ? 1 : 0;
  }

  private bossParams(): OpBossParams {
    const c = this.gc.priv.cyber;
    if (!c) return NO_BOSS_PARAMS;
    const p = (id: string, key: string, d: number): number => {
      if (!SLOTS.some((s) => c.equip[s.id] === id)) return d;
      const v = implantParams(id, c.owned[id] ?? 1)[key];
      return v === undefined ? d : v;
    };
    return { hack: p('outils', 'hack', 1), doors: p('outils', 'doors', 0), remote: p('outils', 'remote', 0), breach: p('poing', 'breach', 0) };
  }

  /** Distance à l'objectif si le parrain peut le mener d'ici (même étage, en vue), sinon −1. */
  private reach(step: OpStep, params: OpBossParams): number {
    const p = this.gc.player.pos;
    const a = step.anchor;
    if (Math.abs(p.y - a.y) > 1.6) return -1;
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d > bossWorkRange(step.kind, params)) return -1;
    if (d > 0.9 && !this.gc.world.world.lineOfSight(a.x, a.y + 1, a.z, p.x, p.y + 1.3, p.z)) return -1;
    return d;
  }

  private act(b: number, k: string, ok?: boolean): void {
    this.gc.app.net.act({ a: 'op', b, k, ok });
    this.gc.gesture();
    audio.play('ui_click', { volume: 0.5 });
  }

  // ------------------------------------------------------------------ invites

  interaction(bid: number): Interaction | null {
    const gc = this.gc;
    if (gc.player.dead || gc.player.drive || this.hack.open) return null;
    const params = this.bossParams();
    const key = actionKey(settings.bindings, 'interact');
    const cands = new Set<number>();
    if (bid >= 0) cands.add(bid);
    // piratage à distance (bras tactique) : les objectifs de nos opérations proches
    for (const v of this.ops.values()) if (v.o.slot === gc.you || this.owner(v.o.b) === gc.myFaction) cands.add(v.o.b);
    let best: { d: number; it: Interaction } | null = null;
    for (const b of cands) {
      const r = this.promptFor(b, params, key);
      if (r && (!best || r.d < best.d)) best = r;
    }
    return best?.it ?? null;
  }

  private promptFor(b: number, params: OpBossParams, key: string): { d: number; it: Interaction } | null {
    const gc = this.gc;
    const def = BUILDINGS[b];
    if (!def?.capturable || this.reserved(b)) return null;
    const plan = this.plan(b);
    if (!plan) return null;
    const v = this.ops.get(b);
    const op = v?.o;
    // ------------------------------------------------ le propriétaire reprend l'étape volée
    if (this.owner(b) === gc.myFaction) {
      if (!op || op.step < 1) return null;
      const prev = plan.steps[op.step - 1];
      if (!prev.undo || prev.kind === 'secure' || op.carrier !== undefined || op.drop) return null;
      const d = this.reach(prev, NO_BOSS_PARAMS);
      if (d < 0) return null;
      const working = ((op.undoBy ?? 0) & 1) === 1;
      return {
        d,
        it: {
          key,
          text: working ? `${prev.undo} — ${pct(op.undo ?? 0)}` : prev.undo,
          sub: working ? 'Restez sur place : l’étape revient à zéro pour l’ennemi' : `Étape volée par ${BOSS_NAME[op.slot]} : reprenez-la`,
          run: () => this.act(b, prev.key),
        },
      };
    }
    // ------------------------------------------------ l'attaquant
    if (op && op.slot !== gc.you) return null; // l'autre parrain mène l'opération : il faut la contester
    const idx = this.curIndex(b, plan, op);
    const step = plan.steps[idx];
    if (!step || step.key === 'terminal') return null; // « Pirater la sécurité » : invite du terminal
    const n = plan.steps.length;
    if (step.kind === 'deliver') {
      if (!op || op.carrier !== gc.selfId) return null;
      const d = this.reach(step, NO_BOSS_PARAMS);
      if (d < 0) return null;
      return { d, it: { key, text: `${step.label} — ${pct(this.prog(v!))}`, sub: 'Restez au bureau le temps de l’enregistrement', run: () => undefined } };
    }
    const d = this.reach(step, params);
    if (d < 0) return null;
    const stage = n > 1 ? `Étape ${idx + 1}/${n}` : 'Objectif unique';
    if (this.locked(b)) {
      return {
        d,
        it: { key, text: step.label, sub: `QG imprenable : contrôlez ${HQ_CAPTURE_MIN_DISTRICTS} quartiers (vous en avez ${gc.pub.territories[gc.you]})`, run: () => this.act(b, step.key) },
      };
    }
    const working = !!op && (op.by & 1) === 1;
    const remote = d > opRadius(step.kind) + 0.05;
    let text = remote ? `Pirater à distance : ${step.place}` : step.label;
    let sub = `${stage} — prise de contrôle ${deNom(def.name)}`;
    if (working && step.kind !== 'minigame') {
      text = `${step.label} — ${pct(this.prog(v!))}`;
      sub = step.kind === 'hold' ? 'Restez dans la pièce' : 'Restez près de l’objectif';
    } else if (step.kind === 'minigame') sub = `${stage} — piratage interactif (moins de ${OP_MINIGAME_MAX} s)`;
    if (op?.contested) sub = 'CONTESTÉ : éliminez les ennemis autour de l’objectif';
    const guards = gc.pub.buildings[b]?.guards ?? 0;
    if (idx === n - 1 && guards > 0 && this.owner(b) === Faction.NEUTRAL) sub = `Éliminez d’abord les défenseurs du gang (${guards})`;
    return {
      d,
      it: {
        key,
        text,
        sub,
        run: () => {
          if (step.kind === 'minigame') this.openHack(b, step, idx);
          else this.act(b, step.key);
        },
      },
    };
  }

  private openHack(b: number, step: OpStep, idx: number): void {
    if (nowS() - this.hack.failAt < 3) {
      this.gc.hud.notify('L’alarme sonne encore : attendez un instant avant de recommencer.', 'info', 2500);
      return;
    }
    this.act(b, step.key);
    this.gc.setUiOpen(true);
    this.hack.start(b, step.key, idx, step.place, this.bossParams().hack);
  }

  // ------------------------------------------------------------------ boucle

  update(dt: number, now: number): void {
    this.hack.update(dt);
    for (const m of this.markers) m.update(now);
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    this.refresh();
  }

  private refresh(): void {
    const gc = this.gc;
    const p = gc.player.pos;
    // piratage interactif : fermé si l'étape a changé ou si l'on s'est éloigné
    if (this.hack.open) {
      const v = this.ops.get(this.hack.b);
      const plan = this.plan(this.hack.b);
      const step = plan?.steps.find((s) => s.key === this.hack.k);
      const idx = v ? v.o.step : 0;
      if (gc.player.dead || !step || (v && this.hack.stale(idx)) || (v && v.o.slot !== gc.you) || this.reach(step, this.bossParams()) < 0) this.hack.cancel();
    }
    // bâtiment décrit : celui où l'on se trouve, sinon une opération qui nous concerne, tout près
    const inside = gc.buildingAt(p.x, p.z, p.y);
    let bid = -1;
    if (inside >= 0 && BUILDINGS[inside].capturable && !this.reserved(inside) && (this.owner(inside) !== gc.myFaction || this.ops.has(inside))) bid = inside;
    if (bid < 0) {
      let bd = 30;
      for (const v of this.ops.values()) {
        if (v.o.slot !== gc.you && this.owner(v.o.b) !== gc.myFaction) continue;
        const c = this.info(v.o.b).center;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bd) {
          bd = d;
          bid = v.o.b;
        }
      }
    }
    this.renderPanel(bid);
    this.placeMarkers(bid);
  }

  // ------------------------------------------------------------------ panneau

  private renderPanel(bid: number): void {
    const gc = this.gc;
    const plan = bid >= 0 ? this.plan(bid) : null;
    if (!plan) {
      if (this.panelFor !== -1) {
        this.panelFor = -1;
        this.panel.classList.add('hidden');
        this.panelSig = '';
      }
      return;
    }
    this.panelFor = bid;
    const def = BUILDINGS[bid];
    const v = this.ops.get(bid);
    const op = v?.o;
    const mine = this.owner(bid) === gc.myFaction;
    const mode: PanelMode = op ? (op.slot === gc.you ? 'mine' : 'threat') : 'preview';
    const n = plan.steps.length;
    const idx = this.curIndex(bid, plan, op);
    const p = v ? this.prog(v) : 0;
    const sig = JSON.stringify([bid, mode, op && { ...op, p: Math.round(p * 50), rate: undefined }, idx, this.locked(bid), gc.pub.buildings[bid]?.guards, this.owner(bid), gc.pub.territories?.[gc.you]]);
    if (sig === this.panelSig) return;
    this.panelSig = sig;
    const el = this.panel;
    el.className = `mw-op-panel ${mode}`;
    clear(el);
    // en-tête : de quoi il s'agit (prise de contrôle ≠ braquage)
    const tag = mode === 'threat' ? (mine ? 'VOTRE BÂTIMENT EST ATTAQUÉ' : `OPÉRATION ${BOSS_NAME[op!.slot].toUpperCase()}`) : 'PRISE DE CONTRÔLE';
    el.appendChild(h('div', { class: 'mw-op-head' }, h('span', { class: 'mw-op-tag' }, tag), h('span', { class: 'mw-op-name' }, def.name)));
    const ownerTxt = this.owner(bid) === Faction.DADOU ? 'tenu par Dadou' : this.owner(bid) === Faction.EVEN ? 'tenu par Even' : (gc.pub.buildings[bid]?.guards ?? 0) > 0 ? `tenu par ${leNom(DISTRICT_BY_ID[def.district].gang)}` : 'sans défenseurs';
    el.appendChild(h('div', { class: 'mw-op-sub' }, `${cap1(OP_LEVEL_NAME[plan.level])} — ${n > 1 ? `${n} étapes` : 'un objectif'} — ${mine ? 'à vous' : ownerTxt}`));
    // étapes
    const list = h('div', { class: 'mw-op-steps' });
    plan.steps.forEach((s, i) => {
      const done = i < idx;
      const cur = i === idx;
      const row = h('div', { class: `mw-op-step${done ? ' done' : cur ? ' cur' : ''}` }, h('span', { class: 'ico' }, done ? '✔' : cur ? '▶' : String(i + 1)), h('span', null, s.label), h('span', { class: 'who' }, done && op?.who[i] ? op.who[i] : cur && op && op.step === i ? pct(p) : ''));
      list.appendChild(row);
      if (!cur) return;
      if (op && op.step === i) {
        const bar = h('div', { class: `mw-op-bar${op.contested ? ' contested' : ''}` }, h('i', { style: `width:${Math.round(p * 100)}%` }));
        row.appendChild(bar);
      }
      const st = this.stateLine(bid, plan, op, s, i, mode);
      if (st) row.appendChild(st);
    });
    // reprise en cours par le propriétaire
    if (op && (op.undo ?? 0) > 0 && op.step > 0) {
      const prev = plan.steps[op.step - 1];
      const row = h('div', { class: 'mw-op-step' }, h('span', { class: 'ico' }, '↺'), h('span', null, `${BOSS_NAME[op.slot === 'dadou' ? 'even' : 'dadou']} reprend ${prev.place}`), h('span', { class: 'who' }, pct(op.undo ?? 0)));
      row.appendChild(h('div', { class: 'mw-op-bar undo' }, h('i', { style: `width:${Math.round((op.undo ?? 0) * 100)}%` })));
      list.appendChild(row);
    }
    el.appendChild(list);
    // pied : ce que rapporte la prise, et ce qui la distingue d'un braquage
    const foot = h('div', { class: 'mw-op-foot' });
    if (mode === 'threat' && mine) foot.appendChild(document.createTextNode('Contestez l’objectif (présence sur place), abattez l’opérateur ou reprenez l’étape volée.'));
    else if (mode === 'threat') foot.appendChild(document.createTextNode(`Une seule opération à la fois : chassez les hommes ${DE_BOSS[op!.slot]} pour prendre la main.`));
    else {
      const hq = this.isHq(bid);
      foot.appendChild(document.createTextNode(hq ? 'Prendre ce QG donne la victoire.' : `Le bâtiment et ses revenus (+${def.income} $/min) seront à vous.`));
      if (def.heist) foot.appendChild(h('div', { class: 'heist' }, `Braquage du coffre (${formatMoney(def.heist.reward)}) : de l’argent seulement, le bâtiment ne change pas de mains.`));
    }
    el.appendChild(foot);
  }

  /** Ligne d'état de l'étape en cours : qui y travaille, contestation, objet emporté… */
  private stateLine(bid: number, plan: OpPlan, op: OpPub | undefined, s: OpStep, i: number, mode: PanelMode): HTMLElement | null {
    const gc = this.gc;
    const line = (cls: string, ...c: (string | HTMLElement)[]) => h('div', { class: `mw-op-state ${cls}` }, ...c);
    if (this.locked(bid)) return line('bad', `QG imprenable : contrôlez ${HQ_CAPTURE_MIN_DISTRICTS} quartiers sur ${DISTRICTS.length} (vous en avez ${gc.pub.territories[gc.you]}).`);
    if (!op) {
      if (s.key === 'terminal') return line('', `Piratez le terminal de sécurité près de l’entrée (${actionKey(settings.bindings, 'interact')}).`);
      return line('', 'Rendez-vous à l’objectif (repère) et appuyez sur ', h('b', null, actionKey(settings.bindings, 'interact')), ', ou envoyez un lieutenant.');
    }
    const item = plan.steps.find((x) => x.item)?.item ?? 'le document';
    if (op.drop) return line('warn', `${cap1(item)} est à terre : ${mode === 'mine' ? 'ramassez-le' : 'reprenez-le'} !`);
    if (op.carrier !== undefined && s.kind === 'deliver') {
      const who = op.carrier === gc.selfId ? 'Vous portez' : `${gc.store.ents.get(op.carrier)?.info.name ?? 'Votre lieutenant'} porte`;
      return mode === 'mine' ? line('', h('b', null, who), ` ${item} : direction ${s.place}.`) : line('bad', `${BOSS_NAME[op.slot]} emporte ${item} vers ${s.place} : abattez le porteur !`);
    }
    if (op.contested) return line('bad', mode === 'mine' ? 'CONTESTÉ : des ennemis tiennent l’objectif.' : 'Objectif contesté : tenez bon !');
    if (op.gang && i === plan.steps.length - 1 && this.prog(this.ops.get(bid)!) >= 0.94) return line('warn', `Il reste ${op.gang} défenseur${op.gang > 1 ? 's' : ''} du gang à éliminer.`);
    const by = op.by;
    const lt = op.lt ?? 'un lieutenant';
    const boss = mode === 'mine' ? 'Vous' : BOSS_NAME[op.slot];
    const who = by === 3 ? `${boss} et ${lt}` : by === 1 ? boss : by === 2 ? lt : '';
    if (!who) return line('warn', mode === 'mine' ? `Personne à l’œuvre : l’étape se perd. Rendez-vous ${aPlace(s.place)}.` : 'Personne à l’œuvre pour l’instant.');
    return line('', h('b', null, who), by === 3 ? ' — progression accélérée' : '');
  }

  // ------------------------------------------------------------------ repères

  private placeMarkers(ctxB: number): void {
    const gc = this.gc;
    const p = gc.player.pos;
    const want: { x: number; y: number; z: number; color: number; l1: string; l2: string; d: number }[] = [];
    const add = (a: { x: number; y: number; z: number }, color: number, l1: string, extra = '') => {
      const d = Math.hypot(a.x - p.x, a.z - p.z) + Math.abs(a.y - p.y);
      want.push({ x: a.x, y: a.y, z: a.z, color, l1, l2: [`${Math.round(d)} m`, extra].filter(Boolean).join(' · '), d });
    };
    for (const v of this.ops.values()) {
      const o = v.o;
      const info = this.info(o.b);
      const plan = this.plan(o.b);
      if (!plan) continue;
      const mineB = this.owner(o.b) === gc.myFaction;
      const near = Math.hypot(info.center.x - p.x, info.center.z - p.z) < 90 || o.b === ctxB;
      if (!near || (o.slot !== gc.you && !mineB && o.b !== ctxB)) continue;
      const s = plan.steps[o.step];
      const item = plan.steps.find((x) => x.item)?.item ?? 'le document';
      if (o.drop) add({ x: o.drop[0], y: o.drop[1], z: o.drop[2] }, COLOR.item, `${o.slot === gc.you ? 'Ramasser' : 'Reprendre'} ${item}`.toUpperCase());
      if (!s) continue;
      if (o.slot === gc.you) add(s.anchor, COLOR.mine, s.label.toUpperCase(), o.contested ? 'CONTESTÉ' : pct(this.prog(v)));
      else {
        add(s.anchor, COLOR.threat, `DÉFENDEZ ${s.place}`.toUpperCase(), o.contested ? 'CONTESTÉ' : pct(this.prog(v)));
        const prev = o.step > 0 ? plan.steps[o.step - 1] : null;
        if (mineB && prev && prev.undo && prev.kind !== 'secure' && o.carrier === undefined && !o.drop) add(prev.anchor, COLOR.undo, prev.undo.toUpperCase(), 'étape volée');
      }
    }
    // bâtiment à prendre, sans opération : le premier objectif
    if (ctxB >= 0 && !this.ops.has(ctxB) && this.owner(ctxB) !== gc.myFaction) {
      const plan = this.plan(ctxB);
      if (plan) {
        const i = this.curIndex(ctxB, plan, undefined);
        const s = plan.steps[i];
        add(s.anchor, COLOR.preview, s.label.toUpperCase(), plan.steps.length > 1 ? `étape ${i + 1}/${plan.steps.length}` : '');
      }
    }
    want.sort((a, b) => a.d - b.d);
    this.markers.forEach((m, i) => {
      const w = want[i];
      if (w) m.set(w.x, w.y, w.z, w.color, w.l1, w.l2);
      else m.hide();
    });
  }

  // ------------------------------------------------------------------ état et événements

  onPub(p: PublicState): void {
    const t = nowS();
    const seen = new Set<number>();
    for (const o of p.ops ?? []) {
      seen.add(o.b);
      this.ops.set(o.b, { o, t });
    }
    for (const b of [...this.ops.keys()]) if (!seen.has(b)) this.ops.delete(b);
  }

  onEvent(e: GameEvent): void {
    const gc = this.gc;
    if (e.t === 'over') {
      this.hack.cancel();
      return;
    }
    if (e.t !== 'op') return;
    const mineB = this.owner(e.b) === gc.myFaction;
    const pos = e.x !== undefined ? { pos: { x: e.x, y: (e.y ?? 0) + 1, z: e.z ?? 0 } } : {};
    switch (e.ev) {
      case 'start':
        if (mineB) {
          audio.play('alert', { volume: 0.8 });
          if (this.isHq(e.b)) gc.hud.banner('ASSAUT SUR VOTRE QG', `${BOSS_NAME[e.slot]} attaque ${leNom(BUILDINGS[e.b].name)} !`);
        }
        break;
      case 'step':
        if (e.slot === gc.you) audio.play('hack_success', { volume: 0.8, ...pos });
        else if (mineB) audio.play('alert', { volume: 0.7 });
        break;
      case 'undo':
        audio.play(e.slot === gc.you ? 'ui_error' : 'hack_success', { volume: 0.7 });
        break;
      case 'drop':
      case 'pickup':
      case 'return':
        audio.play('paper', { volume: 0.8, ...pos });
        break;
      case 'fail':
        if (this.hack.b === e.b) this.hack.cancel();
        break;
    }
  }

  onEscape(): boolean {
    if (!this.hack.open) return false;
    this.hack.cancel();
    return true;
  }

  blocking(): boolean {
    return this.hack.open;
  }

  reset(): void {
    this.ops.clear();
    this.hack.cancel();
    this.panelFor = -1;
    this.panelSig = '';
    this.panel.classList.add('hidden');
    for (const m of this.markers) m.hide();
  }

  dispose(): void {
    this.hack.dispose();
    this.panel.remove();
    this.gc.scene.remove(this.group);
    for (const m of this.markers) m.dispose();
    for (const g of this.geos) g.dispose();
    if (this.gc.hud.captureFilter) this.gc.hud.captureFilter = null;
  }

  /** Opération en cours sur un bâtiment (état public reçu). */
  opOf(bid: number): OpPub | undefined {
    return this.ops.get(bid)?.o;
  }
}

export function createConquestClient(gc: GameClient): ConquestClient {
  return new ConquestClient(gc);
}

// ---------------------------------------------------------------------------- carte stratégique

/** Fiche « Prise de contrôle » d'un bâtiment pour la carte stratégique (null : rien à dire). */
export function conquestCard(gc: GameClient, bid: number): HTMLElement | null {
  const def = BUILDINGS[bid];
  const info = gc.world.buildings[bid];
  if (!def?.capturable || !info) return null;
  const st = gc.pub.buildings[bid];
  if (def.residence && st?.owner === Faction.NEUTRAL) return null;
  const hq = gc.pub.hq.dadou === bid || gc.pub.hq.even === bid;
  const plan = opPlan(info, hq);
  if (!plan) return null;
  const op = gc.pub.ops?.find((o) => o.b === bid);
  const box = h('div', { class: 'sm-op' });
  const n = plan.steps.length;
  if (op) {
    const who = op.slot === gc.you ? 'Votre opération' : `Opération ${DE_BOSS[op.slot]}`;
    const state = op.contested ? ' — CONTESTÉE' : op.drop ? ' — objet à terre' : op.locked ? ' — QG imprenable' : '';
    box.appendChild(h('div', { class: op.slot === gc.you ? 'c-good' : 'c-bad' }, `${who} : étape ${Math.min(n, op.step + 1)}/${n} — ${Math.round(opOverall(op) * 100)} %${state}`));
  } else box.appendChild(h('div', { class: 'dim' }, `Prise de contrôle : ${n > 1 ? `${n} étapes` : 'un objectif'} (${OP_LEVEL_NAME[plan.level]}).`));
  box.appendChild(
    h(
      'ol',
      { class: 'sm-keys', style: 'margin:2px 0 4px 18px;padding:0' },
      ...plan.steps.map((s, i) => h('li', { style: op && i < op.step ? 'color:#8fe9c2' : op && i === op.step ? 'color:#ffffff;font-weight:700' : '' }, `${op && i < op.step ? '✔ ' : ''}${s.label}${op && i === op.step ? ` (${Math.round(op.p * 100)} %)` : ''}`)),
    ),
  );
  return box;
}

/** Étiquette de la carte : « 2/3 » pour une opération en cours, null sinon. */
export function conquestMapLabel(gc: GameClient, bid: number): string | null {
  const op = gc.pub.ops?.find((o) => o.b === bid);
  return op ? `${Math.min(op.n, op.step + 1)}/${op.n}` : null;
}
