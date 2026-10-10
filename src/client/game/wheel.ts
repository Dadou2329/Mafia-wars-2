// Roue des ordres rapides (touche Q maintenue) : « Suivez-moi », « Attaquez », « Défendez »,
// « Repliez-vous ». On choisit avec la souris (ou les touches 1 à 4) et on relâche Q.

import * as THREE from 'three';
import { CharKind } from '../../shared/characters';
import { BUILDINGS } from '../../shared/city/plan';
import type { ClientAction } from '../../shared/protocol';
import { audio } from '../audio/AudioEngine';
import { h, clear } from '../ui/dom';
import type { Input } from '../input/input';
import type { GameClient } from './GameClient';

type Cmd = 'follow' | 'attack' | 'defend' | 'retreat';

interface Option {
  cmd: Cmd;
  label: string;
  icon: string;
  /** Angle du centre du secteur (0 = haut, sens horaire). */
  angle: number;
}

const OPTIONS: Option[] = [
  { cmd: 'follow', label: 'Suivez-moi', icon: '➜', angle: 0 },
  { cmd: 'attack', label: 'Attaquez', icon: '⚔', angle: Math.PI / 2 },
  { cmd: 'defend', label: 'Défendez', icon: '⛨', angle: Math.PI },
  { cmd: 'retreat', label: 'Repliez-vous', icon: '⟲', angle: (Math.PI * 3) / 2 },
];

const R_OUT = 150;
const R_IN = 54;

function sectorPath(a0: number, a1: number, r0: number, r1: number): string {
  // angles mesurés depuis le haut, sens horaire ; repère SVG centré
  const p = (a: number, r: number) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(a0, r0)} L ${p(a0, r1)} A ${r1} ${r1} 0 ${large} 1 ${p(a1, r1)} L ${p(a1, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(a0, r0)} Z`;
}

export class CommandWheel {
  readonly el: HTMLElement;
  private gc: GameClient;
  private visible = false;
  private holdFrames = 0;
  private sel = new THREE.Vector2();
  private choice = -1;
  private sectors: SVGPathElement[] = [];
  private labels: HTMLElement[] = [];
  private subs: HTMLElement[] = [];
  private info: HTMLElement;
  private center: HTMLElement;
  private context: { attack: Partial<ClientAction & { a: 'quick' }>; attackLabel: string; defend: Partial<ClientAction & { a: 'quick' }>; defendLabel: string } | null = null;
  private openedAt = 0;

  constructor(gc: GameClient) {
    this.gc = gc;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${-R_OUT - 6} ${-R_OUT - 6} ${(R_OUT + 6) * 2} ${(R_OUT + 6) * 2}`);
    svg.setAttribute('class', 'wh-svg');
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('r', String(R_OUT + 3));
    ring.setAttribute('class', 'wh-ring');
    svg.appendChild(ring);
    for (const o of OPTIONS) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', sectorPath(o.angle - Math.PI / 4 + 0.03, o.angle + Math.PI / 4 - 0.03, R_IN, R_OUT));
      path.setAttribute('class', 'wh-sector');
      svg.appendChild(path);
      this.sectors.push(path);
    }
    this.info = h('div', { class: 'wh-info' });
    this.center = h('div', { class: 'wh-center' }, 'ORDRES');
    const labelBox = h('div', { class: 'wh-labels' });
    OPTIONS.forEach((o, i) => {
      const r = (R_IN + R_OUT) / 2;
      const x = Math.sin(o.angle) * r;
      const y = -Math.cos(o.angle) * r;
      const sub = h('small', null, '');
      const lab = h('div', { class: 'wh-label', style: `transform:translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }, h('span', { class: 'wh-icon' }, o.icon), h('b', null, o.label), h('i', { class: 'wh-key' }, String(i + 1)), sub);
      this.labels.push(lab);
      this.subs.push(sub);
      labelBox.appendChild(lab);
    });
    this.el = h('div', { class: 'wh-root hidden' }, h('div', { class: 'wh-wheel' }, svg as unknown as HTMLElement, labelBox, this.center), this.info);
  }

  get open(): boolean {
    return this.visible || this.holdFrames > 0;
  }

  private show(): void {
    this.visible = true;
    this.sel.set(0, 0);
    this.choice = -1;
    this.openedAt = performance.now();
    this.computeContext();
    this.el.classList.remove('hidden');
    this.highlight();
    audio.play('ui_open', { volume: 0.5 });
  }

  private hide(): void {
    this.visible = false;
    this.holdFrames = 1;
    this.el.classList.add('hidden');
  }

  cancel(): void {
    if (!this.visible) return;
    this.hide();
    audio.play('ui_close', { volume: 0.4 });
  }

  /** Cible de l'ordre « Attaquez » / « Défendez » selon ce que le parrain regarde. */
  private computeContext(): void {
    const gc = this.gc;
    const p = gc.player.pos;
    const { o, d } = gc.player.aimRay();
    // ennemi visé
    let target: { id: number; name: string } | null = null;
    let bestT = 70;
    for (const e of gc.store.alive()) {
      if (e.info.id === gc.selfId || e.info.faction === gc.myFaction || e.info.kind === CharKind.BARMAN || e.info.faction === 3) continue;
      const dx = e.x - o.x;
      const dz = e.z - o.z;
      const t = dx * d.x + (e.y + 1.0 - o.y) * d.y + dz * d.z;
      if (t < 0 || t > bestT) continue;
      const cx = o.x + d.x * t - e.x;
      const cz = o.z + d.z * t - e.z;
      const tol = 0.6 + t * 0.02;
      if (cx * cx + cz * cz < tol * tol) {
        bestT = t;
        target = { id: e.info.id, name: e.info.name ?? (e.info.kind === CharKind.THUG ? 'ce voyou' : e.info.kind === CharKind.LIEUTENANT ? 'ce lieutenant' : 'cet ennemi') };
      }
    }
    // point visé dans le décor
    const hitT = gc.world.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 90);
    const aim = hitT > 0 ? new THREE.Vector3().copy(o).addScaledVector(d, hitT) : null;
    const aimB = aim ? gc.buildingAt(aim.x - d.x * 0.3, aim.z - d.z * 0.3) : -1;
    const hereB = gc.buildingAt(p.x, p.z, p.y);
    let attack: Partial<ClientAction & { a: 'quick' }> = {};
    let attackLabel = 'Chargez droit devant';
    if (target) {
      attack = { target: target.id };
      attackLabel = `Cible : ${target.name}`;
    } else if (aimB >= 0 && BUILDINGS[aimB].capturable && gc.pub.buildings[aimB]?.owner !== gc.myFaction) {
      attack = { building: aimB };
      attackLabel = `Assaut : ${BUILDINGS[aimB].name}`;
    } else if (hereB >= 0 && BUILDINGS[hereB].capturable && gc.pub.buildings[hereB]?.owner !== gc.myFaction) {
      attack = { building: hereB };
      attackLabel = `Assaut : ${BUILDINGS[hereB].name}`;
    } else if (aim) {
      attack = { x: aim.x, z: aim.z };
      attackLabel = 'Vers le point visé';
    } else {
      attack = { x: p.x + d.x * 12, z: p.z + d.z * 12 };
    }
    let defend: Partial<ClientAction & { a: 'quick' }> = { x: p.x, z: p.z };
    let defendLabel = 'Autour de vous';
    if (hereB >= 0) {
      defend = { building: hereB };
      defendLabel = BUILDINGS[hereB].name;
    } else if (aimB >= 0 && gc.pub.buildings[aimB]?.owner === gc.myFaction) {
      defend = { building: aimB };
      defendLabel = BUILDINGS[aimB].name;
    }
    this.context = { attack, attackLabel, defend, defendLabel };
    // hommes à portée de voix
    let near = 0;
    for (const e of gc.store.alive()) {
      if (e.info.faction !== gc.myFaction || e.info.kind !== CharKind.GANGSTER) continue;
      if (Math.hypot(e.x - p.x, e.z - p.z) < 40) near++;
    }
    clear(this.info);
    this.info.appendChild(h('b', null, near === 0 ? 'Aucun homme à portée de voix' : `${near} homme${near > 1 ? 's' : ''} à portée de voix`));
    this.info.appendChild(h('span', { class: 'dim' }, ' — relâchez Q pour donner l’ordre'));
    this.subs[0].textContent = 'Escorte rapprochée';
    this.subs[1].textContent = attackLabel;
    this.subs[2].textContent = defendLabel;
    this.subs[3].textContent = 'Retour au QG';
  }

  private highlight(): void {
    this.sectors.forEach((s, i) => s.classList.toggle('on', i === this.choice));
    this.labels.forEach((l, i) => l.classList.toggle('on', i === this.choice));
    this.center.textContent = this.choice >= 0 ? OPTIONS[this.choice].label.toUpperCase() : 'ORDRES';
  }

  update(dt: number, input: Input): void {
    void dt;
    if (this.holdFrames > 0) this.holdFrames--;
    if (!this.visible) {
      if (!input.hit('wheel') || this.gc.player.dead || input.blocked) return;
      this.show();
      // on continue : le choix et le relâchement peuvent arriver dans la même image
    }
    // sélection à la souris
    this.sel.x += input.mouseDX;
    this.sel.y += input.mouseDY;
    if (this.sel.length() > 120) this.sel.setLength(120);
    let choice = this.choice;
    if (this.sel.length() > 26) {
      let a = Math.atan2(this.sel.x, -this.sel.y);
      if (a < 0) a += Math.PI * 2;
      choice = Math.round(a / (Math.PI / 2)) % 4;
    }
    for (let i = 0; i < 4; i++) if (input.hit(`weapon${i + 1}` as 'weapon1')) choice = i;
    if (choice !== this.choice) {
      this.choice = choice;
      this.highlight();
      audio.play('ui_hover', { volume: 0.35 });
    }
    const release = input.up('wheel') || input.hit('fire');
    if (release) {
      // un appui très bref sans choix : on laisse la roue ouverte pour cliquer
      if (this.choice < 0 && performance.now() - this.openedAt < 250 && !input.hit('fire')) return;
      if (this.choice >= 0) this.execute(OPTIONS[this.choice].cmd);
      this.hide();
    }
  }

  private execute(cmd: Cmd): void {
    const ctx = this.context;
    const act: ClientAction = { a: 'quick', cmd };
    if (cmd === 'attack' && ctx) Object.assign(act, ctx.attack);
    if (cmd === 'defend' && ctx) Object.assign(act, ctx.defend);
    this.gc.app.net.act(act);
    audio.play('ui_click', { volume: 0.7 });
    // le parrain fait un geste
    this.gc.gesture();
  }
}
