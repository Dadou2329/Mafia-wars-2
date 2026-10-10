// Carte stratégique du bureau du parrain : Londres vue d'en haut, cibles cliquables
// (bâtiments et quartiers), ordres aux lieutenants (attaque, défense, patrouille, position),
// recrutement, lieutenants, améliorations et armurerie.

import { LIEUTENANT_NAMES, WEAPONS, type Weapon } from '../../shared/characters';
import {
  AMMO_PRICE,
  BOSS_NAME,
  BOSS_SHOP,
  DE_BOSS,
  HQ_CAPTURE_MIN_DISTRICTS,
  LIEUTENANT_PRICES,
  MAFIA_NAME,
  MAX_GANGSTERS,
  MAX_LIEUTENANTS,
  ORDER_LABEL,
  ORDER_STATUS,
  RECRUIT_BUNDLES,
  UPGRADES,
  UPGRADE_BY_ID,
  type OrderType,
} from '../../shared/constants';
import {
  BUILDINGS,
  DISTRICTS,
  DISTRICT_BY_ID,
  Faction,
  HQ_BUILDING,
  RIVER_Z,
  WORLD_D,
  WORLD_W,
  keyBuildings,
  buildingsInDistrict,
  type BuildingType,
  type DistrictId,
} from '../../shared/city/plan';
import type { LieutenantStatus, PrivateState } from '../../shared/protocol';
import { formatMoney } from '../../shared/util';
import { audio } from '../audio/AudioEngine';
import type { SfxName } from '../audio/types';
import { settings } from '../settings';
import { actionKey } from '../input/bindings';
import { h, clear } from '../ui/dom';
import { MAP_SCALE } from './cityMap';
import type { GameClient } from './GameClient';
import { leNom } from '../../shared/french';

export type Tab = 'orders' | 'recruit' | 'lieutenants' | 'upgrades' | 'armory' | 'view';

type Sel = { kind: 'building'; id: number } | { kind: 'district'; id: DistrictId } | null;

interface Pending {
  order: OrderType;
  target?: number | string;
  x?: number;
  z?: number;
  label: string;
  confirm: string;
}

export const TYPE_LABEL: Record<BuildingType, string> = {
  pub: 'Pub',
  hq: 'Quartier général',
  shop: 'Boutique',
  gambling: 'Tripot',
  theatre: 'Music-hall',
  cafe: 'Café',
  bank: 'Banque',
  exchange: 'Bourse',
  offices: 'Bureaux',
  jeweller: 'Joaillerie',
  post: 'Bureau de poste',
  church: 'Église',
  lodging: 'Garni',
  pawn: 'Prêteur sur gages',
  butcher: 'Boucherie',
  sweatshop: 'Atelier',
  tenement: 'Immeuble',
  police: 'Police',
  mansion: 'Hôtel particulier',
  club: 'Club',
  clocktower: 'Tour de l’horloge',
  foundry: 'Fonderie',
  brewery: 'Brasserie',
  mill: 'Filature',
  housing: 'Logements ouvriers',
  gasworks: 'Usine à gaz',
  warehouse: 'Entrepôt',
  customs: 'Douanes',
  shipyard: 'Chantier naval',
  bakery: 'Boulangerie',
};

const OWNER_RGB: Record<number, string> = { [Faction.DADOU]: '176,30,38', [Faction.EVEN]: '42,74,138' };
const OWNER_CSS: Record<number, string> = { [Faction.DADOU]: '#d0444c', [Faction.EVEN]: '#6f95e0', [Faction.NEUTRAL]: '#c8b890' };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export class StrategicMap {
  readonly el: HTMLElement;
  open = false;
  dirty = true;
  private gc: GameClient;
  private tab: Tab = 'orders';
  private remote = false;
  private canvas: HTMLCanvasElement;
  private mapBox: HTMLElement;
  private body: HTMLElement;
  private tabs: HTMLElement;
  private title: HTMLElement;
  private stats: HTMLElement;
  private tooltip: HTMLElement;
  private banner: HTMLElement;
  private sel: Sel = null;
  private hover: Sel = null;
  private pending: Pending | null = null;
  private ltChoice = -1;
  private menChoice = 0;
  private menTouched = false;
  private feedback: { text: string; ok: boolean; t: number } | null = null;
  private pickHold: number | null = null;
  private zoom = 1;
  private panX = 0;
  private panZ = 0;
  private drag: { x: number; y: number; px: number; pz: number; moved: boolean } | null = null;
  private interacting = false;
  private hovering = false;
  private bodySig = '';
  private resizeObs: ResizeObserver | null = null;
  private mouse = { x: -1, y: -1 };

  constructor(gc: GameClient) {
    this.gc = gc;
    this.canvas = h('canvas', { class: 'sm-canvas' });
    this.tooltip = h('div', { class: 'sm-tooltip hidden' });
    this.banner = h('div', { class: 'sm-banner hidden' });
    this.mapBox = h(
      'div',
      { class: 'sm-mapbox' },
      this.canvas,
      this.tooltip,
      this.banner,
      h(
        'div',
        { class: 'sm-legend' },
        h('span', null, h('b', { class: 'gold' }, '★'), ' Bâtiment clé'),
        h('span', null, h('b', { class: 'gold' }, '♛'), ' Quartier général'),
        h('span', null, h('b', { class: 'fire' }, '⚔'), ' Combat'),
        h('span', null, h('b', { class: 'lt' }, '●'), ' Lieutenant'),
        h('span', { class: 'dim' }, 'Molette : zoom — glisser : déplacer'),
      ),
    );
    this.title = h('div', { class: 'sm-title' });
    this.stats = h('div', { class: 'sm-stats' });
    this.tabs = h('div', { class: 'sm-tabs' });
    this.body = h('div', { class: 'sm-body scroll' });
    const close = h('button', { class: 'btn small ghost sm-close', on: { click: () => this.close() } }, 'Fermer ✕');
    this.el = h(
      'div',
      { class: 'sm-root hidden' },
      h('div', { class: 'sm-head' }, this.title, this.stats, close),
      h('div', { class: 'sm-main' }, this.mapBox, h('div', { class: 'sm-side panel' }, this.tabs, this.body)),
    );
    this.body.addEventListener('pointerdown', () => (this.interacting = true));
    window.addEventListener('pointerup', () => (this.interacting = false));
    // on ne reconstruit jamais le panneau sous le curseur (clics perdus, survols qui clignotent)
    this.body.addEventListener('pointerenter', () => (this.hovering = true));
    this.body.addEventListener('pointerleave', () => {
      this.hovering = false;
      if (this.open && this.signature() !== this.bodySig) this.renderBody();
    });
    this.setupCanvas();
  }

  // ======================================================================= ouverture

  show(tab: Tab): void {
    const wasOpen = this.open;
    this.remote = tab === 'view';
    this.tab = tab === 'view' ? 'orders' : tab;
    this.open = true;
    this.el.classList.remove('hidden');
    this.gc.setUiOpen(true);
    if (!wasOpen) {
      audio.play('paper', { volume: 0.7 });
      // on centre la carte sur le parrain
      this.zoom = 1;
      this.panX = 0;
      this.panZ = 0;
    }
    this.title.textContent = this.remote ? 'Carte de Londres' : `Bureau ${DE_BOSS[this.gc.you]} — Carte stratégique`;
    this.resize();
    this.renderAll();
    this.body.scrollTop = 0;
    this.draw();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.pending = null;
    this.pickHold = null;
    this.el.classList.add('hidden');
    this.tooltip.classList.add('hidden');
    this.gc.setUiOpen(false);
    audio.play('ui_close', { volume: 0.6 });
  }

  dispose(): void {
    this.resizeObs?.disconnect();
  }

  onPriv(p: PrivateState): void {
    void p;
    if (!this.open) return;
    this.renderStats();
    // le panneau n'est reconstruit que si ce qu'il affiche a changé, et jamais sous le curseur
    if (this.interacting || this.hovering) return;
    if (this.signature() !== this.bodySig) this.renderBody();
  }

  /** Résumé des données affichées dans le panneau (pour éviter les reconstructions inutiles). */
  private signature(): string {
    const gc = this.gc;
    const p = gc.priv;
    const money = p.money;
    const sel = this.sel;
    const selInfo =
      sel?.kind === 'building'
        ? (() => {
            const st = gc.pub.buildings[sel.id];
            return st ? [st.owner, Math.round(st.cap * 10), st.contested, st.guards, money >= BUILDINGS[sel.id].price] : null;
          })()
        : sel?.kind === 'district'
          ? [gc.pub.districts.find((d) => d.id === sel.id)?.owner, ...keyBuildings(sel.id).map((k) => gc.pub.buildings[k.id]?.owner)]
          : null;
    return JSON.stringify([
      this.tab,
      this.remote,
      sel,
      selInfo,
      this.pending,
      this.ltChoice,
      this.feedback?.text,
      gc.pub.territories[gc.you],
      p.men,
      p.pool,
      p.escort,
      p.upgrades,
      p.weapons,
      p.ammo,
      p.lieutenants.map((l) => [l.id, l.name, l.alive, l.men, l.menStart, l.order, l.targetName, l.state, Math.round(l.progress * 20), Math.ceil(l.recoverIn / 5)]),
      RECRUIT_BUNDLES.map((b) => money >= b.price),
      money >= (LIEUTENANT_PRICES[p.lieutenants.length] ?? Infinity),
      UPGRADES.map((u) => money >= u.price),
      BOSS_SHOP.map((b) => money >= b.price),
      money >= AMMO_PRICE,
    ]);
  }

  onOrderReply(lt: number, ok: boolean): void {
    const st = this.gc.priv.lieutenants.find((l) => l.id === lt);
    if (ok) {
      this.pending = null;
      this.ltChoice = -1;
      this.menTouched = false;
      this.feedback = { text: `${st?.name ?? 'Le lieutenant'} a reçu vos ordres.`, ok: true, t: performance.now() };
      audio.play('paper', { volume: 0.6 });
    } else this.feedback = { text: `${st?.name ?? 'Le lieutenant'} ne peut pas exécuter cet ordre.`, ok: false, t: performance.now() };
    if (this.open) this.renderBody();
  }

  // ======================================================================= carte

  private setupCanvas(): void {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toWorld(e.offsetX, e.offsetY);
      this.zoom = Math.min(3.2, Math.max(1, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = this.toWorld(e.offsetX, e.offsetY);
      this.panX += before.x - after.x;
      this.panZ += before.z - after.z;
      this.clampPan();
      this.draw();
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
      this.drag = { x: e.clientX, y: e.clientY, px: this.panX, pz: this.panZ, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.offsetX, y: e.offsetY };
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) this.drag.moved = true;
        if (this.drag.moved && this.zoom > 1.01) {
          const k = this.pxPerMeter();
          this.panX = this.drag.px - dx / k;
          this.panZ = this.drag.pz - dy / k;
          this.clampPan();
          this.draw();
        }
      }
      const hv = this.pick(e.offsetX, e.offsetY);
      if (JSON.stringify(hv) !== JSON.stringify(this.hover)) {
        this.hover = hv;
        this.draw();
      }
      this.updateTooltip(e.offsetX, e.offsetY);
    });
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.tooltip.classList.add('hidden');
      this.draw();
    });
    c.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved) return;
      if (e.button !== 0) return;
      this.onClick(e.offsetX, e.offsetY);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resizeObs = new ResizeObserver(() => {
      if (this.open) {
        this.resize();
        this.draw();
      }
    });
    this.resizeObs.observe(this.mapBox);
  }

  private resize(): void {
    const r = this.mapBox.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(200, Math.round(r.width));
    const hgt = Math.max(160, Math.round(r.height));
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hgt * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${hgt}px`;
  }

  /** Pixels CSS par mètre. */
  private pxPerMeter(): number {
    const w = this.canvas.clientWidth || 800;
    const hh = this.canvas.clientHeight || 600;
    return Math.min(w / WORLD_W, hh / WORLD_D) * 0.97 * this.zoom;
  }

  private clampPan(): void {
    const half = (1 - 1 / this.zoom) / 2;
    this.panX = Math.max(-WORLD_W * half, Math.min(WORLD_W * half, this.panX));
    this.panZ = Math.max(-WORLD_D * half, Math.min(WORLD_D * half, this.panZ));
  }

  /** Coin haut-gauche de la ville à l'écran (px CSS). */
  private origin(): { ox: number; oy: number; k: number } {
    const k = this.pxPerMeter();
    const w = this.canvas.clientWidth || 800;
    const hh = this.canvas.clientHeight || 600;
    const cx = WORLD_W / 2 + this.panX;
    const cz = WORLD_D / 2 + this.panZ;
    return { ox: w / 2 - cx * k, oy: hh / 2 - cz * k, k };
  }

  private toWorld(px: number, py: number): { x: number; z: number } {
    const { ox, oy, k } = this.origin();
    return { x: (px - ox) / k, z: (py - oy) / k };
  }

  private pick(px: number, py: number): Sel {
    const { x, z } = this.toWorld(px, py);
    if (x < 0 || z < 0 || x > WORLD_W || z > WORLD_D) return null;
    for (const b of this.gc.world.buildings) {
      const f = b.footprint;
      if (x >= f[0] && x <= f[2] && z >= f[1] && z <= f[3]) return { kind: 'building', id: b.id };
    }
    if (z > RIVER_Z) return null;
    for (const d of DISTRICTS) if (x >= d.rect[0] && x < d.rect[2] && z >= d.rect[1] && z < d.rect[3]) return { kind: 'district', id: d.id };
    return null;
  }

  private onClick(px: number, py: number): void {
    if (this.pickHold !== null) {
      const { x, z } = this.toWorld(px, py);
      const lt = this.pickHold;
      this.pickHold = null;
      this.banner.classList.add('hidden');
      if (x > 0 && z > 0 && x < WORLD_W && z < RIVER_Z + 8) {
        this.gc.app.net.act({ a: 'order', lt, order: 'hold', x, z });
        audio.play('ui_click');
      }
      this.renderBody();
      return;
    }
    const s = this.pick(px, py);
    this.sel = s;
    this.pending = null;
    this.feedback = null;
    if (s) audio.play('ui_click', { volume: 0.6 });
    if (this.tab !== 'orders') this.tab = 'orders';
    this.renderAll();
    this.draw();
  }

  private updateTooltip(px: number, py: number): void {
    const hv = this.hover;
    if (!hv || this.drag?.moved) {
      this.tooltip.classList.add('hidden');
      return;
    }
    clear(this.tooltip);
    if (hv.kind === 'building') {
      const def = BUILDINGS[hv.id];
      this.tooltip.appendChild(h('b', null, def.name));
      this.tooltip.appendChild(h('div', { class: 'dim' }, `${TYPE_LABEL[def.type]} — ${DISTRICT_BY_ID[def.district].name}`));
      this.tooltip.appendChild(h('div', null, this.ownerText(hv.id)));
      if (def.capturable && def.income) this.tooltip.appendChild(h('div', { class: 'c-good' }, `+${def.income} £/min`));
    } else {
      const d = DISTRICT_BY_ID[hv.id];
      const owner = this.gc.pub.districts.find((x) => x.id === hv.id)?.owner ?? 0;
      this.tooltip.appendChild(h('b', null, d.name));
      this.tooltip.appendChild(h('div', null, owner === Faction.DADOU ? 'Contrôlé par Dadou' : owner === Faction.EVEN ? 'Contrôlé par Even' : 'Territoire disputé'));
    }
    this.tooltip.classList.remove('hidden');
    const w = this.canvas.clientWidth;
    this.tooltip.style.left = `${Math.min(px + 16, w - 230)}px`;
    this.tooltip.style.top = `${py + 14}px`;
  }

  private ownerText(bid: number): string {
    const def = BUILDINGS[bid];
    const st = this.gc.pub.buildings[bid];
    if (!def.capturable) return 'Non capturable';
    if (!st) return '';
    if (st.owner === Faction.DADOU) return this.gc.you === 'dadou' ? 'À vous' : 'Tenu par Dadou';
    if (st.owner === Faction.EVEN) return this.gc.you === 'even' ? 'À vous' : 'Tenu par Even';
    if (st.guards > 0) return `Tenu par ${leNom(DISTRICT_BY_ID[def.district].gang)} (${st.guards} défenseur${st.guards > 1 ? 's' : ''})`;
    return def.price > 0 ? `À vendre : ${formatMoney(def.price)}` : 'Abandonné';
  }

  /** Dessine la carte (appelé régulièrement quand elle est ouverte). */
  draw(): void {
    if (!this.open) return;
    const c = this.canvas.getContext('2d')!;
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#c9b48a';
    c.fillRect(0, 0, W, H);
    const { ox, oy, k } = this.origin();
    const S = k / MAP_SCALE;
    const gc = this.gc;
    const pub = gc.pub;
    const priv = gc.priv;
    const now = performance.now() / 1000;
    c.save();
    c.translate(ox, oy);
    c.scale(S, S);
    c.imageSmoothingEnabled = true;
    c.drawImage(gc.map.base, 0, 0);
    const M = MAP_SCALE;
    // quartiers : teinte du propriétaire
    for (const d of DISTRICTS) {
      const owner = pub.districts.find((x) => x.id === d.id)?.owner ?? 0;
      const r = d.rect;
      const rz1 = Math.min(r[3], RIVER_Z);
      const rgb = OWNER_RGB[owner];
      if (rgb) {
        c.fillStyle = `rgba(${rgb},0.13)`;
        c.fillRect(r[0] * M, r[1] * M, (r[2] - r[0]) * M, (rz1 - r[1]) * M);
      }
      const selected = this.sel?.kind === 'district' && this.sel.id === d.id;
      const hovered = this.hover?.kind === 'district' && this.hover.id === d.id;
      if (selected || hovered || rgb) {
        c.strokeStyle = selected ? '#f2c84a' : rgb ? `rgba(${rgb},0.85)` : 'rgba(60,30,10,0.5)';
        c.lineWidth = (selected ? 5 : hovered ? 3 : 2.2) / S;
        c.setLineDash(selected ? [] : [14 / S, 8 / S]);
        c.strokeRect(r[0] * M + 3 / S, r[1] * M + 3 / S, (r[2] - r[0]) * M - 6 / S, (rz1 - r[1]) * M - 6 / S);
        c.setLineDash([]);
      }
    }
    // bâtiments
    for (const b of gc.world.buildings) {
      const f = b.footprint;
      const st = pub.buildings[b.id];
      const def = BUILDINGS[b.id];
      const x = f[0] * M;
      const y = f[1] * M;
      const w = (f[2] - f[0]) * M;
      const hh = (f[3] - f[1]) * M;
      if (st) {
        const rgb = OWNER_RGB[st.owner];
        if (rgb) {
          c.fillStyle = `rgba(${rgb},0.6)`;
          c.fillRect(x, y, w, hh);
        } else if (def.capturable && st.guards > 0) {
          c.fillStyle = 'rgba(70,55,40,0.28)';
          c.fillRect(x, y, w, hh);
        }
        if (st.cap > 0 && st.capBy) {
          c.strokeStyle = st.capBy === Faction.DADOU ? '#ff5050' : '#6fa0ff';
          c.lineWidth = 5 / S;
          c.setLineDash([10 / S, 6 / S]);
          c.lineDashOffset = -now * 30;
          c.strokeRect(x, y, w, hh);
          c.setLineDash([]);
          // jauge de capture
          c.fillStyle = 'rgba(0,0,0,0.55)';
          c.fillRect(x + 4 / S, y + hh - 12 / S, w - 8 / S, 8 / S);
          c.fillStyle = st.capBy === Faction.DADOU ? '#ff5050' : '#6fa0ff';
          c.fillRect(x + 4 / S, y + hh - 12 / S, (w - 8 / S) * st.cap, 8 / S);
        }
      }
      const isSel = this.sel?.kind === 'building' && this.sel.id === b.id;
      const isHov = this.hover?.kind === 'building' && this.hover.id === b.id;
      if (isSel || isHov) {
        c.strokeStyle = isSel ? '#f2c84a' : '#fff4d0';
        c.lineWidth = (isSel ? 4 + Math.sin(now * 5) * 1.5 : 2.5) / S;
        c.strokeRect(x - 2 / S, y - 2 / S, w + 4 / S, hh + 4 / S);
      }
      if (def.isKey || def.hq) {
        const fs = Math.max(26, 30 / S) ;
        c.font = `${fs}px serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#000';
        c.fillText(def.hq ? '♛' : '★', x + w / 2 + 2, y + hh / 2 + 2);
        c.fillStyle = def.hq ? (def.hq === 'dadou' ? '#ff6a5a' : '#8fb4ff') : '#f2c84a';
        c.fillText(def.hq ? '♛' : '★', x + w / 2, y + hh / 2);
      }
    }
    // combats
    for (const bt of pub.battles) {
      const r = (6 + (now * 6) % 6) * M;
      c.strokeStyle = `rgba(255,120,40,${0.9 - ((now * 6) % 6) / 8})`;
      c.lineWidth = 4 / S;
      c.beginPath();
      c.arc(bt.x * M, bt.z * M, r, 0, Math.PI * 2);
      c.stroke();
      c.font = `${Math.max(30, 34 / S)}px serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#ff7a2a';
      c.fillText('⚔', bt.x * M, bt.z * M);
    }
    // événement aléatoire
    const ev = gc.activeEvent;
    if (ev && (ev.kind === 'contraband' || ev.kind === 'raid')) {
      const raid = ev.kind === 'raid';
      c.strokeStyle = raid ? 'rgba(60,90,170,0.9)' : 'rgba(200,140,20,0.95)';
      c.lineWidth = 4 / S;
      c.setLineDash(raid ? [10 / S, 6 / S] : []);
      c.beginPath();
      c.arc(ev.x * M, ev.z * M, (raid ? 16 : 4 + (now % 1) * 4) * M, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.font = `700 ${Math.max(22, 26 / S)}px 'Cinzel', serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = raid ? '#2a4a9a' : '#a8740a';
      c.fillText(raid ? '⚑' : '£', ev.x * M, ev.z * M);
      c.font = `600 ${13 / S}px 'EB Garamond', serif`;
      c.fillStyle = '#2a1a0c';
      c.fillText(raid ? 'Descente de police' : 'Contrebande', ev.x * M, ev.z * M + 22 / S);
    }
    // ennemis repérés
    for (const sp of priv.spotted) {
      c.fillStyle = 'rgba(220,40,30,0.35)';
      c.beginPath();
      c.arc(sp.x * M, sp.z * M, (2 + Math.min(5, sp.n * 0.5)) * M, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#7a0c08';
      c.font = `700 ${Math.max(16, 18 / S)}px 'Cinzel', serif`;
      c.textAlign = 'center';
      c.fillText(`${sp.n}`, sp.x * M, sp.z * M + 6 / S);
    }
    // lieutenants et leurs ordres
    const myCol = gc.you === 'dadou' ? '#c8323a' : '#3a62a8';
    for (const lt of priv.lieutenants) {
      if (!lt.alive) continue;
      const tx = this.orderTarget(lt);
      if (tx && lt.order && lt.order !== 'follow') {
        c.strokeStyle = myCol;
        c.lineWidth = 3 / S;
        c.setLineDash([12 / S, 8 / S]);
        c.lineDashOffset = -now * 40;
        c.beginPath();
        c.moveTo(lt.x * M, lt.z * M);
        c.lineTo(tx.x * M, tx.z * M);
        c.stroke();
        c.setLineDash([]);
        // pointe de flèche
        const ang = Math.atan2(tx.z - lt.z, tx.x - lt.x);
        c.fillStyle = myCol;
        c.beginPath();
        c.moveTo(tx.x * M, tx.z * M);
        c.lineTo(tx.x * M - Math.cos(ang - 0.4) * 20 / S, tx.z * M - Math.sin(ang - 0.4) * 20 / S);
        c.lineTo(tx.x * M - Math.cos(ang + 0.4) * 20 / S, tx.z * M - Math.sin(ang + 0.4) * 20 / S);
        c.closePath();
        c.fill();
      }
    }
    for (const lt of priv.lieutenants) {
      if (!lt.alive) continue;
      const r = 11 / S;
      c.fillStyle = myCol;
      c.strokeStyle = '#f2d78a';
      c.lineWidth = 2.5 / S;
      c.beginPath();
      c.arc(lt.x * M, lt.z * M, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = '#fff6dc';
      c.font = `700 ${11 / S}px 'Cinzel', serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(initials(lt.name), lt.x * M, lt.z * M + 0.5 / S);
      c.font = `600 ${12 / S}px 'EB Garamond', serif`;
      c.fillStyle = '#2a1a0c';
      c.fillText(`${lt.name} (${lt.men})`, lt.x * M, lt.z * M + r + 10 / S);
    }
    // le parrain
    const p = gc.player.pos;
    c.save();
    c.translate(p.x * M, p.z * M);
    c.rotate(-gc.player.yaw + Math.PI);
    c.fillStyle = gc.you === 'dadou' ? '#ff5a4a' : '#7aa8ff';
    c.strokeStyle = '#000';
    c.lineWidth = 2 / S;
    c.beginPath();
    c.moveTo(0, -14 / S);
    c.lineTo(9 / S, 10 / S);
    c.lineTo(0, 5 / S);
    c.lineTo(-9 / S, 10 / S);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    c.font = `700 ${12 / S}px 'Cinzel', serif`;
    c.textAlign = 'center';
    c.fillStyle = '#1a0c06';
    c.fillText('VOUS', p.x * M, p.z * M - 18 / S);
    c.restore();
    // noms des quartiers
    gc.map.drawDistrictLabels(c, S, ox, oy, 0.8);
    // rose des vents
    this.drawCompass(c, W - 56, H - 70);
    this.dirty = false;
  }

  private drawCompass(c: CanvasRenderingContext2D, x: number, y: number): void {
    c.save();
    c.translate(x, y);
    c.fillStyle = 'rgba(239,226,191,0.75)';
    c.beginPath();
    c.arc(0, 0, 30, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#3a2410';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = '#3a2410';
    for (let i = 0; i < 4; i++) {
      c.rotate(Math.PI / 2);
      c.beginPath();
      c.moveTo(0, -26);
      c.lineTo(5, 0);
      c.lineTo(-5, 0);
      c.closePath();
      c.fill();
    }
    c.rotate(0);
    c.font = "700 13px 'Cinzel', serif";
    c.textAlign = 'center';
    c.fillStyle = '#7a1a10';
    c.fillText('N', 0, -32);
    c.restore();
  }

  private orderTarget(lt: LieutenantStatus): { x: number; z: number } | null {
    const t = this.findTarget(lt.targetName);
    return t;
  }

  /** Position d'une cible à partir de son nom (bâtiment ou quartier). */
  private findTarget(name: string): { x: number; z: number } | null {
    if (!name) return null;
    const b = BUILDINGS.find((x) => x.name === name);
    if (b) {
      const info = this.gc.world.buildings[b.id];
      return info ? info.center : null;
    }
    const d = DISTRICTS.find((x) => x.name === name);
    if (d) return { x: d.label[0], z: d.label[1] };
    if (name === 'le QG') return this.gc.world.buildings[HQ_BUILDING[this.gc.you].id].center;
    return null;
  }

  // ======================================================================= panneau latéral

  private renderAll(): void {
    this.renderStats();
    this.renderTabs();
    this.renderBody();
  }

  private renderStats(): void {
    const p = this.gc.priv;
    clear(this.stats);
    const item = (lbl: string, val: string, cls = '') => h('div', { class: 'sm-stat' }, h('span', null, lbl), h('b', { class: cls }, val));
    this.stats.appendChild(item('Argent', formatMoney(p.money)));
    this.stats.appendChild(item('Revenus', `+${formatMoney(p.income)}/min`, 'c-good'));
    this.stats.appendChild(item('Hommes', `${p.men}${p.pool ? ` (${p.pool} au QG)` : ''}`));
    this.stats.appendChild(item('Territoires', `${this.gc.pub.territories[this.gc.you]}/6`));
  }

  private renderTabs(): void {
    clear(this.tabs);
    const list: [Tab, string][] = this.remote
      ? [['orders', 'Carte']]
      : [
          ['orders', 'Ordres'],
          ['recruit', 'Recrutement'],
          ['lieutenants', 'Lieutenants'],
          ['upgrades', 'Améliorations'],
          ['armory', 'Armurerie'],
        ];
    for (const [id, label] of list) {
      this.tabs.appendChild(
        h(
          'button',
          {
            class: `sm-tab${this.tab === id ? ' on' : ''}`,
            on: {
              click: () => {
                const changed = this.tab !== id;
                this.tab = id;
                this.gc.app.click();
                this.renderAll();
                if (changed) this.body.scrollTop = 0;
              },
            },
          },
          label,
        ),
      );
    }
  }

  private renderBody(): void {
    this.bodySig = this.signature();
    const b = this.body;
    const scroll = b.scrollTop;
    clear(b);
    if (this.feedback && performance.now() - this.feedback.t < 9000) {
      b.appendChild(h('div', { class: `sm-feedback ${this.feedback.ok ? 'ok' : 'bad'}` }, this.feedback.text));
    }
    if (this.remote) {
      b.appendChild(
        h(
          'div',
          { class: 'sm-note' },
          h('b', null, 'Consultation seulement. '),
          `Pour donner des ordres, rendez-vous au bureau de votre QG (touche ${actionKey(settings.bindings, 'interact')}) ou achetez le Télégraphe.`,
        ),
      );
    }
    switch (this.tab) {
      case 'orders':
      case 'view':
        this.renderOrders(b);
        break;
      case 'recruit':
        this.renderRecruit(b);
        break;
      case 'lieutenants':
        this.renderLieutenants(b);
        break;
      case 'upgrades':
        this.renderUpgrades(b);
        break;
      case 'armory':
        this.renderArmory(b);
        break;
    }
    b.scrollTop = scroll;
  }

  private act(a: Parameters<GameClient['app']['net']['act']>[0], sound: SfxName = 'ui_click'): void {
    this.gc.app.net.act(a);
    audio.play(sound, { volume: 0.8 });
  }

  private section(title: string, ...children: (HTMLElement | string | null)[]): HTMLElement {
    return h('div', { class: 'sm-section' }, h('h3', { class: 'title-s' }, title), ...children);
  }

  // -------------------------------------------------------------- ordres

  private renderOrders(b: HTMLElement): void {
    const gc = this.gc;
    const mine = gc.myFaction;
    const sel = this.sel;
    if (!sel) {
      b.appendChild(
        this.section(
          'Choisir une cible',
          h('p', { class: 'dim' }, 'Cliquez sur un bâtiment ou un quartier de la carte pour le sélectionner.'),
          h(
            'p',
            { class: 'dim' },
            'Les ',
            h('b', { class: 'gold' }, 'bâtiments clés ★'),
            ' donnent le contrôle d’un quartier. Avec au moins ',
            `${HQ_CAPTURE_MIN_DISTRICTS} quartiers, vous pourrez prendre d’assaut le QG ${DE_BOSS[gc.you === 'dadou' ? 'even' : 'dadou']}.`,
          ),
        ),
      );
    } else if (sel.kind === 'building') {
      b.appendChild(this.buildingCard(sel.id));
    } else {
      b.appendChild(this.districtCard(sel.id));
    }
    if (this.pending && !this.remote) b.appendChild(this.orderForm(this.pending));
    // missions en cours
    const lts = gc.priv.lieutenants;
    const box = h('div', { class: 'sm-missions' });
    if (lts.length === 0) box.appendChild(h('p', { class: 'dim' }, 'Aucun lieutenant. Engagez-en un dans l’onglet « Lieutenants ».'));
    for (const lt of lts) box.appendChild(this.ltCard(lt, true));
    b.appendChild(this.section('Vos lieutenants', box));
    void mine;
  }

  private buildingCard(id: number): HTMLElement {
    const gc = this.gc;
    const def = BUILDINGS[id];
    const st = gc.pub.buildings[id];
    const mine = st && st.owner === gc.myFaction;
    const enemyHq = def.hq && def.hq !== gc.you;
    const card = h('div', { class: 'sm-card' });
    card.appendChild(
      h(
        'div',
        { class: 'sm-card-title' },
        def.hq ? h('span', { class: 'gold' }, '♛ ') : def.isKey ? h('span', { class: 'gold' }, '★ ') : null,
        def.name,
      ),
    );
    card.appendChild(h('div', { class: 'dim' }, `${TYPE_LABEL[def.type]} — ${DISTRICT_BY_ID[def.district].name}${def.isKey && !def.hq ? ' — bâtiment clé' : ''}`));
    card.appendChild(h('div', { class: 'sm-owner', style: `color:${OWNER_CSS[st?.owner ?? 0] ?? '#c8b890'}` }, this.ownerText(id)));
    if (def.capturable && def.income) card.appendChild(h('div', null, 'Revenus : ', h('b', { class: 'c-good' }, `+${def.income} £/min`)));
    card.appendChild(h('p', { class: 'sm-blurb' }, def.blurb));
    if (st && st.cap > 0) card.appendChild(h('div', { class: 'c-bad' }, `Capture en cours : ${Math.round(st.cap * 100)} %${st.contested ? ' (contesté)' : ''}`));
    if (enemyHq) {
      const terr = gc.pub.territories[gc.you];
      card.appendChild(
        h(
          'div',
          { class: terr >= HQ_CAPTURE_MIN_DISTRICTS ? 'sm-note ok' : 'sm-note' },
          terr >= HQ_CAPTURE_MIN_DISTRICTS
            ? `Vous contrôlez ${terr} quartiers : le QG ${DE_BOSS[def.hq!]} peut être pris. Sa capture vous donnera la victoire !`
            : `Imprenable pour l’instant : contrôlez au moins ${HQ_CAPTURE_MIN_DISTRICTS} quartiers (vous en avez ${terr}).`,
        ),
      );
    }
    if (!def.capturable) {
      card.appendChild(h('p', { class: 'dim' }, 'Ce bâtiment ne peut pas être conquis.'));
      return card;
    }
    if (this.remote) return card;
    const actions = h('div', { class: 'sm-actions' });
    if (!mine) {
      actions.appendChild(
        this.actionBtn(def.hq && def.hq !== gc.you ? 'Assaut sur le QG' : 'Attaquer', 'danger', () =>
          this.choose({ order: 'attack_building', target: id, label: `${ORDER_LABEL.attack_building} : ${def.name}`, confirm: 'Lancer l’attaque' }),
        ),
      );
      if (st && st.owner === Faction.NEUTRAL && def.price > 0 && st.guards === 0) {
        actions.appendChild(
          this.actionBtn(`Acheter — ${formatMoney(def.price)}`, '', () => this.act({ a: 'buyBuilding', b: id }, 'purchase'), gc.priv.money < def.price),
        );
      }
    } else {
      actions.appendChild(this.actionBtn('Défendre', '', () => this.choose({ order: 'defend_building', target: id, label: `${ORDER_LABEL.defend_building} : ${def.name}`, confirm: 'Envoyer en défense' })));
    }
    card.appendChild(actions);
    return card;
  }

  private districtCard(id: DistrictId): HTMLElement {
    const gc = this.gc;
    const d = DISTRICT_BY_ID[id];
    const owner = gc.pub.districts.find((x) => x.id === id)?.owner ?? 0;
    const card = h('div', { class: 'sm-card' });
    card.appendChild(h('div', { class: 'sm-card-title' }, d.name));
    card.appendChild(
      h(
        'div',
        { class: 'sm-owner', style: `color:${OWNER_CSS[owner] ?? '#c8b890'}` },
        owner === Faction.DADOU ? 'Contrôlé par Dadou' : owner === Faction.EVEN ? 'Contrôlé par Even' : 'Territoire disputé',
      ),
    );
    card.appendChild(h('p', { class: 'sm-blurb' }, d.description));
    card.appendChild(h('div', { class: 'dim' }, `Gang local : ${d.gang}`));
    const keys = keyBuildings(id);
    const list = h('ul', { class: 'sm-keys' });
    for (const k of keys) {
      const st = gc.pub.buildings[k.id];
      list.appendChild(
        h(
          'li',
          {
            on: {
              click: () => {
                this.sel = { kind: 'building', id: k.id };
                this.pending = null;
                this.renderBody();
                this.draw();
              },
            },
          },
          h('i', { style: `background:${OWNER_CSS[st?.owner ?? 0] ?? '#c8b890'}` }),
          `${k.hq ? '♛' : '★'} ${k.name}`,
          h('span', { class: 'dim' }, ` — ${this.ownerText(k.id)}`),
        ),
      );
    }
    card.appendChild(h('div', { class: 'sm-sub' }, 'Bâtiments clés (tous nécessaires pour contrôler le quartier) :'));
    card.appendChild(list);
    const others = buildingsInDistrict(id).filter((x) => !x.isKey && x.capturable);
    const ownedOthers = others.filter((x) => gc.pub.buildings[x.id]?.owner === gc.myFaction).length;
    card.appendChild(h('div', { class: 'dim' }, `Autres bâtiments : ${ownedOthers}/${others.length} à vous`));
    if (this.remote) return card;
    const actions = h('div', { class: 'sm-actions' });
    if (owner !== gc.myFaction)
      actions.appendChild(this.actionBtn('Attaquer le quartier', 'danger', () => this.choose({ order: 'attack_district', target: id, label: `${ORDER_LABEL.attack_district} : ${d.name}`, confirm: 'Lancer l’attaque' })));
    actions.appendChild(this.actionBtn('Défendre', '', () => this.choose({ order: 'defend_district', target: id, label: `${ORDER_LABEL.defend_district} : ${d.name}`, confirm: 'Envoyer en défense' })));
    actions.appendChild(this.actionBtn('Patrouiller', '', () => this.choose({ order: 'patrol', target: id, label: `${ORDER_LABEL.patrol} : ${d.name}`, confirm: 'Lancer la patrouille' })));
    card.appendChild(actions);
    return card;
  }

  private actionBtn(label: string, cls: string, fn: () => void, disabled = false): HTMLElement {
    return h(
      'button',
      {
        class: `btn small ${cls}${disabled ? ' disabled' : ''}`,
        disabled,
        on: {
          click: () => {
            if (disabled) return;
            fn();
          },
        },
      },
      label,
    );
  }

  private choose(p: Pending): void {
    this.pending = p;
    this.feedback = null;
    // lieutenant par défaut : le premier disponible
    const lts = this.gc.priv.lieutenants.filter((l) => l.alive);
    const idle = lts.find((l) => !l.order) ?? lts[0];
    if (!lts.some((l) => l.id === this.ltChoice)) this.ltChoice = idle ? idle.id : -1;
    this.menTouched = false;
    this.gc.app.click();
    this.renderBody();
    // on fait défiler jusqu'au formulaire
    requestAnimationFrame(() => this.body.querySelector('.sm-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  private maxMenFor(lt: LieutenantStatus | undefined): number {
    if (!lt) return 0;
    // hommes du lieutenant + ceux qui attendent au QG + l'escorte du parrain
    return lt.men + this.gc.priv.pool + this.gc.priv.escort;
  }

  private orderForm(p: Pending): HTMLElement {
    const gc = this.gc;
    const lts = gc.priv.lieutenants;
    const form = h('div', { class: 'sm-form' });
    form.appendChild(h('div', { class: 'sm-form-title' }, p.label));
    if (lts.length === 0) {
      form.appendChild(h('p', null, 'Vous n’avez aucun lieutenant pour mener cette opération.'));
      form.appendChild(this.actionBtn('Engager un lieutenant', '', () => ((this.tab = 'lieutenants'), this.renderAll())));
      return form;
    }
    form.appendChild(h('div', { class: 'sm-sub' }, 'Lieutenant :'));
    const list = h('div', { class: 'sm-ltpick' });
    for (const lt of lts) {
      const disabled = !lt.alive;
      list.appendChild(
        h(
          'label',
          { class: `sm-ltopt${this.ltChoice === lt.id ? ' on' : ''}${disabled ? ' off' : ''}` },
          h('input', {
            type: 'radio',
            name: 'sm-lt',
            checked: this.ltChoice === lt.id,
            disabled,
            on: {
              change: () => {
                this.ltChoice = lt.id;
                this.menTouched = false;
                this.renderBody();
              },
            },
          }),
          h('b', null, lt.name),
          h('span', { class: 'dim' }, lt.alive ? ` — ${lt.men} homme${lt.men > 1 ? 's' : ''} — ${lt.order ? ORDER_LABEL[lt.order].toLowerCase() : 'en attente'}` : ` — blessé (${Math.ceil(lt.recoverIn)} s)`),
        ),
      );
    }
    form.appendChild(list);
    const lt = lts.find((l) => l.id === this.ltChoice);
    const max = this.maxMenFor(lt);
    if (!this.menTouched) this.menChoice = Math.min(max, Math.max(lt ? lt.men : 0, Math.min(max, p.order.startsWith('attack') ? 8 : 4)));
    this.menChoice = Math.min(this.menChoice, max);
    const val = h('b', { class: 'sm-men' }, String(this.menChoice));
    const range = h('input', {
      type: 'range',
      min: 0,
      max: Math.max(0, max),
      step: 1,
      value: this.menChoice,
      on: {
        input: (e: Event) => {
          this.menChoice = Number((e.target as HTMLInputElement).value);
          this.menTouched = true;
          val.textContent = String(this.menChoice);
        },
      },
    }) as HTMLInputElement;
    const step = (d: number) => {
      this.menChoice = Math.max(0, Math.min(max, this.menChoice + d));
      this.menTouched = true;
      range.value = String(this.menChoice);
      val.textContent = String(this.menChoice);
    };
    form.appendChild(
      h(
        'div',
        { class: 'sm-menrow' },
        h('span', null, 'Hommes envoyés : '),
        h('button', { class: 'btn small ghost', on: { click: () => step(-1) } }, '−'),
        val,
        h('button', { class: 'btn small ghost', on: { click: () => step(1) } }, '+'),
        range,
      ),
    );
    form.appendChild(
      h(
        'div',
        { class: 'dim sm-small' },
        lt
          ? `${lt.men} déjà avec ${lt.name}, ${gc.priv.pool} disponible${gc.priv.pool > 1 ? 's' : ''} au QG${gc.priv.escort ? `, ${gc.priv.escort} dans votre escorte (pris en dernier)` : ''}.`
          : 'Choisissez un lieutenant.',
      ),
    );
    if (p.order === 'attack_building' && typeof p.target === 'number') {
      const st = gc.pub.buildings[p.target];
      if (st && st.guards > 0 && this.menChoice < st.guards)
        form.appendChild(h('div', { class: 'c-bad sm-small' }, `Attention : ${st.guards} défenseurs vous attendent. Envoyez plus d’hommes !`));
    }
    const ok = !!lt && lt.alive;
    form.appendChild(
      h(
        'div',
        { class: 'sm-actions' },
        h(
          'button',
          {
            class: `btn ${p.order.startsWith('attack') ? 'danger' : ''}${ok ? '' : ' disabled'}`,
            disabled: !ok,
            on: {
              click: () => {
                if (!lt || !lt.alive) return;
                this.act({ a: 'order', lt: lt.id, order: p.order, target: p.target, x: p.x, z: p.z, men: this.menChoice });
              },
            },
          },
          p.confirm,
        ),
        this.actionBtn('Annuler', 'ghost', () => {
          this.pending = null;
          this.renderBody();
        }),
      ),
    );
    return form;
  }

  private ltCard(lt: LieutenantStatus, withOrders: boolean): HTMLElement {
    const card = h('div', { class: `sm-lt${lt.alive ? '' : ' down'}` });
    card.appendChild(
      h(
        'div',
        { class: 'sm-lt-head' },
        h('span', { class: 'sm-token' }, initials(lt.name)),
        h('b', null, lt.name),
        h('span', { class: 'dim' }, ` — ${lt.men} homme${lt.men > 1 ? 's' : ''}`),
      ),
    );
    if (!lt.alive) {
      card.appendChild(h('div', { class: 'c-bad' }, `Blessé : de retour au QG dans ${Math.ceil(lt.recoverIn)} s.`));
      return card;
    }
    if (lt.order) {
      card.appendChild(h('div', { class: 'sm-lt-status' }, `${ORDER_STATUS[lt.order]}${lt.targetName ? ` — ${lt.targetName.toUpperCase()}` : ''}`));
      card.appendChild(h('div', { class: 'dim sm-small' }, `${lt.state} — hommes : ${lt.men}/${Math.max(lt.men, lt.menStart)}`));
      card.appendChild(h('div', { class: 'pbar' }, h('i', { style: `width:${Math.round(lt.progress * 100)}%` })));
    } else card.appendChild(h('div', { class: 'dim sm-small' }, lt.state || 'Attend vos ordres au QG.'));
    if (withOrders && !this.remote) {
      card.appendChild(
        h(
          'div',
          { class: 'sm-actions tight' },
          this.actionBtn('Suivre le patron', 'ghost', () => this.act({ a: 'order', lt: lt.id, order: 'follow' })),
          this.actionBtn('Tenir une position…', 'ghost', () => {
            this.pickHold = lt.id;
            this.banner.textContent = `Cliquez sur la carte : ${lt.name} y tiendra la position.`;
            this.banner.classList.remove('hidden');
          }),
          this.renderReinforce(lt),
          lt.order && lt.order !== 'retreat' ? this.actionBtn('Rappeler au QG', 'ghost', () => this.act({ a: 'cancel', lt: lt.id })) : null,
        ),
      );
    }
    return card;
  }

  private renderReinforce(lt: LieutenantStatus): HTMLElement | null {
    const others = this.gc.priv.lieutenants.filter((o) => o.id !== lt.id && o.alive && o.order && o.order !== 'retreat');
    if (others.length === 0) return null;
    const sel = h(
      'select',
      {
        class: 'sm-select',
        on: {
          change: (e: Event) => {
            const v = Number((e.target as HTMLSelectElement).value);
            if (v > 0) this.act({ a: 'order', lt: lt.id, order: 'reinforce', target: v });
          },
        },
      },
      h('option', { value: '0' }, 'Renforcer…'),
      ...others.map((o) => h('option', { value: String(o.id) }, o.name)),
    );
    return sel;
  }

  // -------------------------------------------------------------- recrutement

  private renderRecruit(b: HTMLElement): void {
    const p = this.gc.priv;
    const barman = this.gc.you === 'dadou' ? 'Bill le barman' : 'Molly la tenancière';
    b.appendChild(
      this.section(
        'Recruter des gangsters',
        h('p', { class: 'dim' }, `${barman} vous présente les gars du quartier, prêts à se battre pour ${MAFIA_NAME[this.gc.you].replace('La ', 'la ')}.`),
        h('div', { class: 'sm-big' }, `Hommes : ${p.men} / ${MAX_GANGSTERS}`, h('span', { class: 'dim' }, ` — ${p.pool} au QG, ${p.escort} avec vous`)),
        h(
          'div',
          { class: 'sm-recruit' },
          ...RECRUIT_BUNDLES.map((rb) =>
            h(
              'button',
              {
                class: `btn ${p.money < rb.price || p.men >= MAX_GANGSTERS ? 'disabled' : ''}`,
                disabled: p.money < rb.price || p.men >= MAX_GANGSTERS,
                on: { click: () => this.act({ a: 'recruit', n: rb.n }, 'recruit') },
              },
              h('div', null, `Recruter ${rb.n} gangster${rb.n > 1 ? 's' : ''}`),
              h('small', null, formatMoney(rb.price)),
            ),
          ),
        ),
        h('p', { class: 'dim sm-small' }, 'Les recrues attendent au QG. Affectez-les à un lieutenant ou emmenez-les avec vous (ordre rapide « Suivez-moi »).'),
      ),
    );
    this.renderHire(b);
    this.renderAssign(b);
  }

  private renderHire(b: HTMLElement): void {
    const p = this.gc.priv;
    const n = p.lieutenants.length;
    const next = LIEUTENANT_NAMES[this.gc.you][n];
    const price = LIEUTENANT_PRICES[n] ?? 0;
    const max = n >= MAX_LIEUTENANTS;
    b.appendChild(
      this.section(
        'Engager un lieutenant',
        max
          ? h('p', { class: 'dim' }, `Vous avez déjà ${MAX_LIEUTENANTS} lieutenants : le maximum.`)
          : h(
              'div',
              { class: 'sm-hire' },
              h('div', null, h('b', null, next ?? 'Lieutenant'), h('div', { class: 'dim sm-small' }, 'Commande une escouade d’hommes et exécute vos ordres sur le terrain.')),
              this.actionBtn(`Engager — ${formatMoney(price)}`, '', () => this.act({ a: 'hire' }, 'purchase'), p.money < price),
            ),
      ),
    );
  }

  private renderAssign(b: HTMLElement): void {
    const p = this.gc.priv;
    if (p.lieutenants.length === 0) return;
    const box = h('div', { class: 'sm-assign' });
    for (const lt of p.lieutenants) {
      const row = h(
        'div',
        { class: 'sm-assign-row' },
        h('b', null, lt.name),
        h('span', { class: 'dim' }, lt.alive ? `${lt.men} homme${lt.men > 1 ? 's' : ''}` : 'blessé'),
        this.actionBtn('−', 'ghost', () => this.act({ a: 'assign', lt: lt.id, men: Math.max(0, lt.men - 1) }), !lt.alive || lt.men <= 0),
        this.actionBtn('+1', 'ghost', () => this.act({ a: 'assign', lt: lt.id, men: lt.men + 1 }), !lt.alive || p.pool <= 0),
        this.actionBtn('+5', 'ghost', () => this.act({ a: 'assign', lt: lt.id, men: lt.men + Math.min(5, p.pool) }), !lt.alive || p.pool <= 0),
      );
      box.appendChild(row);
    }
    b.appendChild(this.section('Affecter les hommes du QG', h('p', { class: 'dim sm-small' }, `${p.pool} homme${p.pool > 1 ? 's' : ''} disponible${p.pool > 1 ? 's' : ''} au QG.`), box));
  }

  // -------------------------------------------------------------- lieutenants

  private renderLieutenants(b: HTMLElement): void {
    const p = this.gc.priv;
    const box = h('div', { class: 'sm-missions' });
    for (const lt of p.lieutenants) box.appendChild(this.ltCard(lt, true));
    if (p.lieutenants.length === 0) box.appendChild(h('p', { class: 'dim' }, 'Aucun lieutenant pour le moment.'));
    b.appendChild(this.section('Vos lieutenants', h('p', { class: 'dim sm-small' }, 'Pour lancer une opération, sélectionnez une cible sur la carte puis choisissez le lieutenant qui la mènera.'), box));
    this.renderHire(b);
    this.renderAssign(b);
  }

  // -------------------------------------------------------------- améliorations

  private renderUpgrades(b: HTMLElement): void {
    const p = this.gc.priv;
    const cats: [string, string][] = [
      ['gang', 'Équipement des hommes'],
      ['hq', 'Quartier général'],
    ];
    for (const [cat, title] of cats) {
      const box = h('div', { class: 'sm-upgrades' });
      for (const u of UPGRADES.filter((x) => x.category === cat)) {
        const owned = p.upgrades.includes(u.id);
        const missing = u.requires && !p.upgrades.includes(u.requires) ? UPGRADE_BY_ID[u.requires].name : null;
        box.appendChild(
          h(
            'div',
            { class: `sm-upg${owned ? ' owned' : ''}` },
            h('div', { class: 'sm-upg-name' }, u.name, owned ? h('span', { class: 'c-good' }, ' ✔') : null),
            h('div', { class: 'dim sm-small' }, u.desc),
            missing ? h('div', { class: 'c-bad sm-small' }, `Nécessite : ${missing}`) : null,
            owned
              ? h('div', { class: 'c-good sm-small' }, 'Acquis')
              : this.actionBtn(`Acheter — ${formatMoney(u.price)}`, '', () => this.act({ a: 'upgrade', id: u.id }, 'purchase'), p.money < u.price || !!missing),
          ),
        );
      }
      b.appendChild(this.section(title, box));
    }
  }

  // -------------------------------------------------------------- armurerie

  private renderArmory(b: HTMLElement): void {
    const p = this.gc.priv;
    if (!p.upgrades.includes('armory')) {
      const u = UPGRADE_BY_ID.armory;
      b.appendChild(
        this.section(
          'Armurerie',
          h('p', null, 'Votre QG n’a pas encore d’armurerie. Installez-en une pour acheter des armes et des munitions.'),
          this.actionBtn(`Installer l’armurerie — ${formatMoney(u.price)}`, '', () => this.act({ a: 'upgrade', id: 'armory' }, 'purchase'), p.money < u.price),
        ),
      );
      return;
    }
    const box = h('div', { class: 'sm-upgrades' });
    for (const item of BOSS_SHOP) {
      const def = WEAPONS[item.weapon];
      const owned = p.weapons.includes(item.weapon);
      box.appendChild(
        h(
          'div',
          { class: `sm-upg${owned ? ' owned' : ''}` },
          h('div', { class: 'sm-upg-name' }, def.name, owned ? h('span', { class: 'c-good' }, ' ✔') : null),
          h('div', { class: 'dim sm-small' }, this.weaponDesc(item.weapon)),
          owned ? h('div', { class: 'c-good sm-small' }, 'Dans votre arsenal') : this.actionBtn(`Acheter — ${formatMoney(item.price)}`, '', () => this.act({ a: 'buyWeapon', w: item.weapon }, 'purchase'), p.money < item.price),
        ),
      );
    }
    b.appendChild(this.section('Armes', box));
    const ammo = Object.entries(p.ammo)
      .filter(([w]) => WEAPONS[Number(w) as Weapon]?.ranged)
      .map(([w, n]) => `${WEAPONS[Number(w) as Weapon].name} : ${n}`)
      .join(' — ');
    b.appendChild(
      this.section(
        'Munitions',
        h('p', { class: 'dim' }, ammo || 'Aucune arme à feu.'),
        this.actionBtn(`Faire le plein — ${formatMoney(AMMO_PRICE)}`, '', () => this.act({ a: 'buyAmmo' }, 'purchase'), p.money < AMMO_PRICE),
      ),
    );
  }

  private weaponDesc(w: Weapon): string {
    const d = WEAPONS[w];
    if (!d.ranged) return `Arme de mêlée — dégâts ${d.damage}. Discrète et toujours prête.`;
    return `Dégâts ${d.damage}${d.pellets > 1 ? ` × ${d.pellets} plombs` : ''} — portée ${d.range} m — ${d.magazine} coup${d.magazine > 1 ? 's' : ''}.`;
  }
}

export { BOSS_NAME };
