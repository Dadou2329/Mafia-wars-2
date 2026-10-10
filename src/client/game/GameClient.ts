// Client de jeu : rendu de Londres, parrain local, entités réseau, combats, interface.

import * as THREE from 'three';
import { Anim, CharKind, FLAG, WEAPONS, Weapon } from '../../shared/characters';
import { BOSS_NAME, DE_BOSS, MAFIA_NAME } from '../../shared/constants';
import { BUILDINGS, DISTRICTS, Faction, HQ_BUILDING, districtAt } from '../../shared/city/plan';
import { MATERIALS, Pattern } from '../../shared/materials';
import {
  BOSS_ENTITY_ID,
  decodeSnapshot,
  type EntityInfo,
  type GameEvent,
  type MatchSettings,
  type PrivateState,
  type PublicState,
  type Slot,
} from '../../shared/protocol';
import { formatMoney, formatTime } from '../../shared/util';
import type { App } from '../app';
import type { WorldData } from '../world/worldLoader';
import { audio } from '../audio/AudioEngine';
import type { SfxName } from '../audio/types';
import { CharacterRenderer, type CharView } from '../characters/characterRenderer';
import { Atmosphere } from '../render/atmosphere';
import { createLightTexture, createMaterialTexture, envUniforms } from '../render/env';
import { createOuterGround } from '../render/outer';
import { PropRenderer } from '../render/propRenderer';
import { createWater } from '../render/water';
import { createWorldMaterial } from '../render/worldMaterial';
import { buildWorldGroup } from '../render/worldMesh';
import { PostFX } from '../render/post';
import { qualityProfile, settings, onSettingsChange } from '../settings';
import { actionKey } from '../input/bindings';
import { h } from '../ui/dom';
import { pauseMenu } from '../ui/screens/pause';
import { settingsPanel } from '../ui/screens/settings';
import { controlsPanel } from '../ui/screens/controls';
import { helpPanel } from '../ui/screens/help';
import { victoryScreen } from '../ui/screens/victory';
import { CityMap } from './cityMap';
import { Effects } from './effects';
import { EventMarker } from './eventMarker';
import { EntityStore, type ClientEnt } from './entities';
import { Hud } from './hud';
import { drawMinimap } from './minimap';
import { PlayerController } from './player';
import { StrategicMap } from './strategicMap';
import { CommandWheel } from './wheel';
import { Tutorial } from './tutorial';
import { DoorSystem } from './doors';
import { SignSystem } from './signs';
import { Civilians } from './civilians';
import { Carriages } from './carriages';
import { Viewmodel } from './viewmodel';
import { WeaponSystem, surfaceKind } from './weapons';
import { leNom } from '../../shared/french';

export interface GameInit {
  you: Slot;
  code: string;
  settings: MatchSettings;
  time: number;
  infos: EntityInfo[];
  pub: PublicState;
  priv: PrivateState;
  over: { winner: Slot | null; reason: string } | null;
}

const FACTION_CSS: Record<number, string> = { 0: '#c8b890', 1: '#e05a5a', 2: '#6f95e0', 3: '#9ab0d0' };

export class GameClient {
  readonly app: App;
  readonly world: WorldData;
  you: Slot;
  readonly selfId: number;
  readonly myFaction: number;
  onExit: (() => void) | null = null;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly atmo: Atmosphere;
  readonly props: PropRenderer;
  readonly chars: CharacterRenderer;
  readonly effects = new Effects();
  readonly store = new EntityStore();
  readonly player: PlayerController;
  readonly weapons: WeaponSystem;
  readonly hud: Hud;
  readonly map: CityMap;
  readonly strategic: StrategicMap;
  readonly wheel: CommandWheel;
  tutorial: Tutorial;
  readonly doors: DoorSystem;
  readonly signs: SignSystem;
  readonly civilians: Civilians;
  readonly carriages: Carriages;
  readonly viewmodel: Viewmodel;
  readonly post: PostFX;
  readonly marker = new EventMarker();
  /** Événement aléatoire en cours (annoncé par le serveur). */
  activeEvent: Extract<GameEvent, { t: 'event' }> | null = null;
  private fogBoost = 1;
  private regions: { mesh: THREE.Mesh; x: number; z: number; r: number }[] = [];
  private cullAcc = 1;
  private water: ReturnType<typeof createWater>;
  pub: PublicState;
  priv: PrivateState;
  settings: MatchSettings;
  private canvas: HTMLCanvasElement;
  private overlay: HTMLElement;
  private modal: HTMLElement | null = null;
  private offs: (() => void)[] = [];
  private raf = 0;
  private last = performance.now();
  private sendAcc = 0;
  private placed = false;
  private tp = 1;
  private chatting = false;
  private paused = false;
  private serverPause: string | null = null;
  private fpsAcc = { t: 0, n: 0, v: 0 };
  private fpsLast = performance.now();
  private hudAcc = 0;
  private mapAcc = 0;
  private myView: CharView;
  private lastHour = -1;
  private dayTimeSmooth = -1;
  private recentShots: { x: number; z: number; t: number }[] = [];
  private stepAcc = new Map<number, number>();
  private over: GameInit['over'] = null;
  private victory: { setVotes(v: (Slot | null)[]): void; el: HTMLElement } | null = null;
  private interact: { key: string; text: string; sub: string; run: () => void } | null = null;
  private deadSince = -1;
  readonly startedAt = performance.now();

  constructor(app: App, world: WorldData, init: GameInit) {
    this.app = app;
    this.world = world;
    this.you = init.you;
    this.selfId = BOSS_ENTITY_ID[init.you];
    this.myFaction = init.you === 'dadou' ? Faction.DADOU : Faction.EVEN;
    this.pub = init.pub;
    this.priv = init.priv;
    this.settings = init.settings;
    // ---------------------------------------------------------------- rendu
    const q = qualityProfile(settings.quality);
    this.canvas = h('canvas', { class: 'game-canvas' });
    app.root.insertBefore(this.canvas, app.root.firstChild);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(q.pixelRatio * settings.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = q.shadow > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.08, 520);
    createMaterialTexture();
    createLightTexture(world.light);
    const worldGroup = buildWorldGroup(world.regions, createWorldMaterial());
    this.scene.add(worldGroup);
    // centres des régions pour la distance d'affichage
    for (const m of worldGroup.children as THREE.Mesh[]) {
      const bs = m.geometry.boundingSphere;
      if (!bs) continue;
      const c = bs.center.clone().multiply(m.scale).add(m.position);
      this.regions.push({ mesh: m, x: c.x, z: c.z, r: bs.radius * m.scale.x });
    }
    this.water = createWater();
    this.scene.add(this.water.mesh);
    this.scene.add(createOuterGround());
    this.atmo = new Atmosphere(this.scene, q.shadow);
    this.props = new PropRenderer(world.props, world.buildings);
    this.props.setDistances(q.propDist, Math.min(150, q.drawDist));
    this.scene.add(this.props.group);
    this.chars = new CharacterRenderer();
    this.chars.maxDistance = q.charDist;
    this.scene.add(this.chars.group);
    this.scene.add(this.effects.group);
    this.scene.add(this.marker.group);
    this.effects.setEmitters(world.smokes);
    this.doors = new DoorSystem(world.props, world.buildings, world.world);
    this.scene.add(this.doors.group);
    this.signs = new SignSystem(world.buildings, this.you);
    this.scene.add(this.signs.group);
    this.civilians = new Civilians(world, this.store);
    this.carriages = new Carriages(world);
    this.scene.add(this.carriages.group);
    this.viewmodel = new Viewmodel();
    this.viewmodel.setLook(this.you, settings.custom[this.you]);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.post.setEnabled(settings.bloom && settings.quality !== 'basse');
    this.chars.warm([
      { kind: CharKind.GANGSTER, faction: 1, look: 1 },
      { kind: CharKind.GANGSTER, faction: 2, look: 2 },
      { kind: CharKind.THUG, faction: 0, look: 3 },
      { kind: CharKind.POLICE, faction: 3, look: 4 },
      { kind: CharKind.BOSS_DADOU, faction: 1, look: 1 },
      { kind: CharKind.BOSS_EVEN, faction: 2, look: 1 },
      { kind: CharKind.LIEUTENANT, faction: 1, look: 5 },
    ]);
    // ---------------------------------------------------------------- jeu
    this.player = new PlayerController(this.camera, world.world);
    this.weapons = new WeaponSystem(world.world);
    this.weapons.onReloadStart = () => {
      app.net.reload();
      audio.play('reload', { pos: this.player.pos });
    };
    this.player.onStep = (m) => {
      const d = MATERIALS[m];
      const name: SfxName = !d ? 'footstep_stone' : d.pattern === Pattern.CARPET ? 'footstep_carpet' : d.pattern === Pattern.PLANK || d.pattern === Pattern.PARQUET ? 'footstep_wood' : 'footstep_stone';
      audio.play(name, { pos: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }, volume: this.player.sprint ? 1 : 0.7 });
    };
    this.map = new CityMap(world);
    this.hud = new Hud(this.you);
    this.overlay = h('div', { class: `layer game-overlay mw-${this.you}` });
    app.root.appendChild(this.overlay);
    this.overlay.appendChild(this.hud.el);
    this.strategic = new StrategicMap(this);
    this.overlay.appendChild(this.strategic.el);
    this.wheel = new CommandWheel(this);
    this.overlay.appendChild(this.wheel.el);
    this.tutorial = new Tutorial(this);
    this.myView = {
      id: this.selfId,
      kind: this.you === 'dadou' ? CharKind.BOSS_DADOU : CharKind.BOSS_EVEN,
      faction: this.myFaction,
      look: 1,
      gang: 0,
      custom: settings.custom[this.you],
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      vx: 0,
      vz: 0,
      anim: Anim.IDLE,
      aiming: false,
      weapon: Weapon.REVOLVER,
      shotAt: -10,
      hitAt: -10,
      meleeAt: -10,
      interactAt: -10,
      deathAt: -10,
    };
    for (const i of init.infos) this.store.addInfo(i);
    this.applyPub(init.pub, true);
    this.applyPriv(init.priv);
    // ---------------------------------------------------------------- réseau
    const net = app.net;
    this.offs.push(
      net.on('s', (buf: ArrayBuffer) => this.onSnapshot(buf)),
      net.on('ev', (evs: GameEvent[]) => {
        for (const e of evs) this.onEvent(e);
      }),
      net.on('pub', (p: PublicState) => this.applyPub(p, false)),
      net.on('priv', (p: PrivateState) => this.applyPriv(p)),
      net.on('pause', (p: { waitingFor: string[]; since: number } | null) => {
        this.serverPause = p ? `Partie en pause — en attente de ${p.waitingFor.join(' et ')}…` : null;
        this.hud.showPause(this.serverPause);
      }),
      net.on('rematch', (v: { votes: (Slot | null)[] }) => this.victory?.setVotes(v.votes)),
      net.on('disconnected', () => this.hud.showPause('Connexion au serveur perdue… reconnexion en cours.')),
      net.on('connected', () => this.hud.showPause(this.serverPause)),
      onSettingsChange(() => this.applySettings()),
    );
    // personnalisation du parrain
    if (Object.keys(settings.custom[this.you] ?? {}).length) net.act({ a: 'customize', custom: settings.custom[this.you] });
    // ---------------------------------------------------------------- entrées
    const input = app.input;
    input.blocked = false;
    input.lockEnabled = true;
    input.onEscape = () => this.onEscape();
    input.onUnlock = () => {
      if (!this.modal && !this.strategic.open && !this.chatting && !this.wheel.open && !this.over) this.openPause();
    };
    input.onKey = (code, e) => this.onKey(code, e);
    this.hud.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const t = this.hud.chatInput.value.trim();
        if (t) net.chat(t);
        this.closeChat();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.closeChat();
        e.preventDefault();
      }
      e.stopPropagation();
    });
    window.addEventListener('resize', this.onResize);
    audio.playMusic('game');
    if (init.over) this.showVictory(init.over.winner, init.over.reason, null);
    this.raf = requestAnimationFrame(this.frame);
    this.hud.notify(`${MAFIA_NAME[this.you]} entre en guerre ! Bonne chance, ${BOSS_NAME[this.you]}.`, 'good', 6000);
    this.hud.setHint(`Cliquez pour prendre le contrôle de la souris — ${actionKey(settings.bindings, 'view')} : changer de vue`);
    setTimeout(() => this.hud.setHint(''), 9000);
  }

  // ======================================================================= réseau

  reinit(init: GameInit): void {
    // revanche ou reconnexion : on repart de l'état transmis
    if (this.victory) {
      this.victory.el.remove();
      this.victory = null;
      this.over = null;
      this.app.input.blocked = false;
    }
    for (const id of [...this.store.ents.keys()]) this.store.remove(id);
    for (const i of init.infos) this.store.addInfo(i);
    this.placed = false;
    // nouvelle partie : on repart d'un parrain vivant, sans événement en cours
    this.player.dead = false;
    this.deadSince = -1;
    this.myView.deathAt = -10;
    this.hud.showDeath(null);
    this.activeEvent = null;
    this.marker.hide();
    this.hud.setEvent(null);
    this.fogBoost = 1;
    this.strategic.close();
    this.settings = init.settings;
    this.applyPub(init.pub, true);
    this.applyPriv(init.priv);
    // revanche (nouvelle partie) : la mission d'introduction repart ; simple reconnexion : on garde
    if (init.time < 10) this.tutorial = new Tutorial(this);
    if (init.over) this.showVictory(init.over.winner, init.over.reason, null);
    audio.playMusic('game');
  }

  private onSnapshot(buf: ArrayBuffer): void {
    const snap = decodeSnapshot(buf);
    this.store.applySnapshot(snap.time, snap.ents);
    if (!this.placed) {
      const me = snap.ents.find((e) => e.id === this.selfId);
      if (me) {
        this.player.teleport(me.x, me.y, me.z, me.yaw);
        this.placed = true;
      }
    }
  }

  private onEvent(e: GameEvent): void {
    const now = performance.now() / 1000;
    switch (e.t) {
      case 'spawn': {
        const ent = this.store.addInfo(e.e);
        if (e.e.id === this.selfId) this.myView.custom = e.e.custom as CharView['custom'];
        void ent;
        break;
      }
      case 'despawn':
        this.store.remove(e.id);
        break;
      case 'shot': {
        const fromMe = e.id === this.selfId;
        const shooter = this.store.ents.get(e.id);
        if (shooter) shooter.view.shotAt = now;
        this.recentShots.push({ x: e.fx, z: e.fz, t: now });
        if (fromMe) break;
        const muzzle = this.chars.muzzleOf(e.id);
        const from = muzzle && shooter && Math.hypot(muzzle.x - e.fx, muzzle.z - e.fz) < 3 ? muzzle.clone() : new THREE.Vector3(e.fx, e.fy, e.fz);
        const to = new THREE.Vector3(e.tx, e.ty, e.tz);
        const dir = to.clone().sub(from).normalize();
        this.effects.muzzleFlash(from, dir, e.w === Weapon.SHOTGUN || e.w === Weapon.RIFLE, this.camera);
        this.effects.tracer(from, to);
        const name: SfxName = e.w === Weapon.SHOTGUN ? 'shotgun' : e.w === Weapon.RIFLE ? 'rifle' : 'revolver';
        audio.play(name, { pos: from });
        // impact sur le décor si raté
        if (e.hit < 0) {
          const hit = this.world.world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, from.distanceTo(to) + 3);
          if (hit >= 0) {
            const p = from.clone().addScaledVector(dir, hit);
            this.effects.impact(p, dir.clone().negate(), 'stone');
            if (Math.random() < 0.3) audio.play('ricochet', { pos: p, volume: 0.6 });
          }
        }
        break;
      }
      case 'melee': {
        const ent = this.store.ents.get(e.id);
        if (ent) ent.view.meleeAt = now;
        if (e.id !== this.selfId) {
          const p = ent ? { x: ent.x, y: ent.y + 1.4, z: ent.z } : undefined;
          audio.play('swing', { pos: p, volume: 0.8 });
        }
        break;
      }
      case 'hit': {
        const ent = this.store.ents.get(e.id);
        const p = new THREE.Vector3(e.x, e.y, e.z);
        if (ent) ent.view.hitAt = now;
        const attacker = this.store.ents.get(e.by);
        const dir = attacker ? p.clone().sub(new THREE.Vector3(attacker.x, e.y, attacker.z)).normalize() : new THREE.Vector3(0, 0, 1);
        this.effects.blood(p, dir, e.dmg > 30);
        audio.play('hit_flesh', { pos: p, volume: 0.9 });
        if (e.id === this.selfId) {
          this.myView.hitAt = now;
          const ang = attacker ? Math.atan2(attacker.x - this.player.pos.x, attacker.z - this.player.pos.z) - this.player.yaw : null;
          this.hud.damageFlash(e.dmg, ang === null ? null : -ang);
          this.player.shake = Math.min(3, this.player.shake + e.dmg / 15);
          if (Math.random() < 0.6) audio.play('pain', { volume: 0.8 });
        } else if (e.by === this.selfId) {
          this.hud.hitMarker(!!e.head);
          const w = this.weapons.current;
          audio.play(w === Weapon.FISTS ? 'punch' : w === Weapon.CLUB ? 'club' : w === Weapon.KNIFE ? 'knife' : 'hit_flesh', { volume: 0.5 });
        }
        break;
      }
      case 'death': {
        const ent = this.store.ents.get(e.id);
        if (ent) {
          ent.view.deathAt = now;
          ent.alive = false;
          audio.play('death', { pos: { x: ent.x, y: ent.y + 1, z: ent.z } });
        }
        if (e.id === this.selfId) {
          this.myView.deathAt = now;
          this.player.dead = true;
          this.deadSince = now;
          audio.play('defeat', { volume: 0.4 });
        }
        if (e.by === this.selfId && ent) this.tutorial.onKill(ent);
        break;
      }
      case 'reload': {
        const ent = this.store.ents.get(e.id);
        if (ent && e.id !== this.selfId) audio.play('reload', { pos: { x: ent.x, y: ent.y + 1.2, z: ent.z }, volume: 0.6 });
        break;
      }
      case 'notify':
        this.hud.notify(e.text, e.kind);
        if (e.kind === 'alert') audio.play('alert');
        else if (e.kind === 'money') audio.play('cash', { volume: 0.7 });
        else if (e.kind === 'good') audio.play('notify', { volume: 0.6 });
        else if (e.kind === 'bad') audio.play('ui_error', { volume: 0.5 });
        break;
      case 'order':
        this.hud.notify(e.text, e.ok ? 'info' : 'bad', 6500);
        this.strategic.onOrderReply(e.lt, e.ok);
        break;
      case 'capture': {
        const prev = e.prev;
        this.props.setOwner(e.b, e.owner);
        this.signs.setOwner(e.b, e.owner);
        if (this.pub.buildings[e.b]) {
          this.pub.buildings[e.b].owner = e.owner;
          this.pub.buildings[e.b].cap = 0;
        }
        const b = this.world.buildings[e.b];
        if (e.owner === this.myFaction) {
          audio.play('capture');
          this.effects.burst(new THREE.Vector3(b.center.x, b.floorY + 1.5, b.center.z), 0xffd060, 40);
          this.tutorial.onCapture(e.b);
        } else if (prev === this.myFaction) audio.play('territory_lost');
        this.strategic.dirty = true;
        break;
      }
      case 'district':
        this.strategic.dirty = true;
        break;
      case 'chat': {
        const from = e.from === 'system' ? 'Londres' : BOSS_NAME[e.from];
        this.hud.chat(from, e.from === 'dadou' ? '#e05a5a' : e.from === 'even' ? '#6f95e0' : '#d4a640', e.text);
        audio.play('paper', { volume: 0.5 });
        break;
      }
      case 'news':
        this.hud.newspaper(e.title, e.body);
        audio.play('paper');
        break;
      case 'tp':
        this.player.teleport(e.x, e.y, e.z, e.yaw);
        this.placed = true;
        break;
      case 'respawned':
        this.player.dead = false;
        this.myView.deathAt = -10;
        this.deadSince = -1;
        this.hud.showDeath(null);
        break;
      case 'killfeed':
        this.hud.killfeedAdd(e.killer, e.victim, e.kf, e.vf);
        break;
      case 'wanted':
        if (e.level > 0) audio.play('police_whistle', { volume: 0.7 });
        break;
      case 'over':
        this.showVictory(e.winner, e.reason, e.stats);
        break;
      case 'sound':
        audio.play(e.s as SfxName, { pos: { x: e.x, y: e.y, z: e.z } });
        break;
      case 'event':
        if (e.kind === 'end') {
          this.activeEvent = null;
          this.marker.hide();
          this.hud.setEvent(null);
        } else {
          this.activeEvent = e;
          this.hud.notify(e.text, 'alert', 10000);
          audio.play(e.kind === 'raid' ? 'police_whistle' : 'alert', { volume: 0.8 });
          if (e.kind === 'contraband') {
            const y = this.world.nav.heightAt(e.x, e.z);
            this.marker.show(e.x, Number.isFinite(y) ? y : 0, e.z);
          }
        }
        this.strategic.dirty = true;
        break;
      default:
        break;
    }
  }

  private applyPub(p: PublicState, initial: boolean): void {
    const prev = this.pub;
    this.pub = p;
    for (const b of p.buildings) {
      this.props.setOwner(b.id, b.owner);
      this.signs.setOwner(b.id, b.owner);
    }
    if (initial || !prev) this.dayTimeSmooth = p.dayTime;
    // événement en cours (utile après une reconnexion, l'annonce ayant été manquée)
    if (p.event && !this.activeEvent) {
      this.activeEvent = { t: 'event', kind: p.event.kind, text: '', x: p.event.x, z: p.event.z, until: p.event.until };
      if (p.event.kind === 'contraband') {
        const y = this.world.nav.heightAt(p.event.x, p.event.z);
        this.marker.show(p.event.x, Number.isFinite(y) ? y : 0, p.event.z);
      }
    } else if (p.event === null && this.activeEvent && this.activeEvent.kind !== 'informant') {
      this.activeEvent = null;
      this.marker.hide();
      this.hud.setEvent(null);
    }
    this.strategic.dirty = true;
  }

  private applyPriv(p: PrivateState): void {
    this.priv = p;
    this.weapons.setOwned(p.weapons, p.ammo);
    if (p.tp !== this.tp) this.tp = p.tp;
    if (p.dead && !this.player.dead) {
      this.player.dead = true;
      this.deadSince = performance.now() / 1000;
    }
    this.hud.setPriv(p, this.pub);
    this.strategic.onPriv(p);
    this.tutorial.onPriv(p);
  }

  // ======================================================================= entrées

  private onKey(code: string, e: KeyboardEvent): boolean | void {
    if (this.chatting || this.modal || this.over) return;
    const b = settings.bindings;
    if (b.chat.includes(code) && !this.strategic.open) {
      this.openChat();
      return true;
    }
    if (b.map.includes(code)) {
      if (this.strategic.open) this.strategic.close();
      else this.strategic.show(this.priv.upgrades.includes('telegraph') ? 'orders' : 'view');
      return true;
    }
    if (b.scores.includes(code) && !this.strategic.open) {
      this.hud.showScores(this.pub, this.priv, true);
      const up = (ev: KeyboardEvent) => {
        if (ev.code === code) {
          this.hud.showScores(null, null, false);
          window.removeEventListener('keyup', up);
        }
      };
      window.addEventListener('keyup', up);
      return true;
    }
    void e;
  }

  private onEscape(): void {
    if (this.chatting) return this.closeChat();
    if (this.wheel.open) return this.wheel.cancel();
    if (this.strategic.open) return this.strategic.close();
    if (this.modal) {
      // Échap ferme la pause (ou le panneau ouvert depuis la pause) et rend la main au jeu
      this.paused = false;
      this.closeModal();
      this.app.input.requestLock();
      return;
    }
    if (this.over) return;
    this.openPause();
  }

  private openChat(): void {
    this.chatting = true;
    this.app.input.blocked = true;
    this.app.input.exitLock();
    this.hud.openChat(true);
  }

  private closeChat(): void {
    this.chatting = false;
    this.hud.openChat(false);
    this.app.input.blocked = !!this.modal || this.strategic.open;
    if (!this.app.input.blocked) this.app.input.requestLock();
  }

  /** Ouvre un panneau modal (pause, paramètres…) par-dessus le jeu. */
  openModal(el: HTMLElement): void {
    this.closeModal();
    this.modal = h('div', { class: 'modal-layer' }, el);
    this.overlay.appendChild(this.modal);
    this.app.input.blocked = true;
    this.app.input.exitLock();
  }

  closeModal(): void {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
    this.app.input.blocked = this.strategic.open || this.chatting;
  }

  openPause(): void {
    if (this.paused) return;
    this.paused = true;
    audio.play('ui_open');
    this.openModal(
      pauseMenu(this.app, {
        onResume: () => {
          this.paused = false;
          this.closeModal();
          this.app.input.requestLock();
        },
        onQuit: () => {
          this.paused = false;
          this.closeModal();
          this.onExit?.();
        },
        onSettings: () => this.openModal(h('div', { class: 'screen dim-bg' }, settingsPanel(this.app, { inGame: true, onClose: () => ((this.paused = false), this.openPause()) }))),
        onControls: () => this.openModal(h('div', { class: 'screen dim-bg' }, controlsPanel(this.app, { onClose: () => ((this.paused = false), this.openPause()) }))),
        onHelp: () => this.openModal(h('div', { class: 'screen dim-bg' }, helpPanel(this.app, { onClose: () => ((this.paused = false), this.openPause()) }))),
      }),
    );
  }

  /** Le parrain a-t-il été placé dans le monde (premier instantané reçu) ? */
  get isPlaced(): boolean {
    return this.placed;
  }

  /** Petit geste du parrain (ordre donné, interaction). */
  gesture(): void {
    this.myView.interactAt = performance.now() / 1000;
  }

  /** Les panneaux d'interface prennent la main (souris libre). */
  setUiOpen(open: boolean): void {
    this.app.input.blocked = open || !!this.modal || this.chatting;
    if (open) this.app.input.exitLock();
    else if (!this.modal && !this.chatting) this.app.input.requestLock();
  }

  private applySettings(): void {
    const q = qualityProfile(settings.quality);
    this.renderer.setPixelRatio(q.pixelRatio * settings.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = q.shadow > 0;
    this.atmo.setShadowMapSize(q.shadow);
    this.chars.maxDistance = q.charDist;
    this.props.setDistances(q.propDist, Math.min(150, q.drawDist));
    this.cullAcc = 1;
    this.post.setEnabled(settings.bloom && settings.quality !== 'basse');
    this.post.setSize(window.innerWidth, window.innerHeight);
    this.myView.custom = settings.custom[this.you];
    this.hud.setCrosshairStyle(settings.crosshair);
    this.viewmodel.setLook(this.you, settings.custom[this.you]);
    this.app.net.act({ a: 'customize', custom: settings.custom[this.you] });
    // les matériaux dépendent du nombre de lumières d'ombre : on force la mise à jour
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  /** Distance d'affichage selon la qualité : régions lointaines masquées, plan lointain réduit. */
  private cullRegions(cam: THREE.Vector3): void {
    const q = qualityProfile(settings.quality);
    const d = q.drawDist;
    for (const r of this.regions) r.mesh.visible = Math.hypot(r.x - cam.x, r.z - cam.z) - r.r < d;
    const far = Math.min(520, d + 80);
    if (this.camera.far !== far) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
      this.atmo.sky.scale.setScalar(Math.min(1, (far * 0.92) / 380));
    }
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.post.setSize(window.innerWidth, window.innerHeight);
  };

  // ======================================================================= boucle

  private frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0.001, (t - this.last) / 1000));
    this.last = t;
    const now = t / 1000;
    const input = this.app.input;
    const me = this.store.ents.get(this.selfId);
    // ------------------------------------------------- contrôle du joueur
    const uiBlocked = this.strategic.open || !!this.modal || this.chatting || !!this.over;
    this.player.frozen = uiBlocked || !this.placed || !!this.serverPause;
    this.wheel.update(dt, input);
    if (this.wheel.open) this.player.frozen = true;
    this.player.weapon = this.weapons.current;
    this.player.update(dt, input);
    if (!uiBlocked && !this.wheel.open && !this.player.dead && this.placed) this.handleCombat(now, input);
    if (!uiBlocked && input.hit('interact') && this.interact) this.interact.run();
    this.player.updateCamera(dt, settings.fov);
    // ------------------------------------------------- envoi de l'état (20 Hz)
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05 && this.placed) {
      this.sendAcc = 0;
      const p = this.player;
      this.app.net.sendInput([p.pos.x, p.pos.y, p.pos.z, p.bodyYaw, p.pitch, p.vel.x, p.vel.z, p.dead ? Anim.DEAD : p.anim, p.flags(), this.weapons.current, this.priv.tp]);
    }
    // ------------------------------------------------- personnages
    const views = this.store.update(this.selfId);
    const mv = this.myView;
    mv.x = this.player.pos.x;
    mv.y = this.player.pos.y;
    mv.z = this.player.pos.z;
    mv.yaw = this.player.bodyYaw;
    mv.pitch = this.player.pitch;
    mv.vx = this.player.vel.x;
    mv.vz = this.player.vel.z;
    mv.anim = this.player.dead ? Anim.DEAD : this.player.anim;
    mv.aiming = this.player.aiming || now - mv.shotAt < 0.6;
    mv.weapon = this.weapons.current;
    mv.hidden = this.player.firstPerson && !this.player.dead;
    const list = views.filter((v) => v.id !== this.selfId);
    if (this.placed) list.push(mv);
    const civViews = this.civilians.update(dt, now, this.player.pos, this.recentShots);
    for (const c of civViews) list.push(c);
    const cabViews = this.carriages.update(dt, now, this.player.pos, list);
    for (const c of cabViews) list.push(c);
    this.chars.update(list, this.camera, now, dt);
    // ------------------------------------------------- monde
    const camPos = this.camera.position;
    this.cullAcc += dt;
    if (this.cullAcc > 0.25) {
      this.cullAcc = 0;
      this.cullRegions(camPos);
    }
    this.props.update(camPos);
    this.doors.update(dt, list, camPos);
    this.signs.update(camPos);
    this.effects.update(dt, camPos);
    // heure : on suit l'heure du serveur en douceur
    const target = this.pub.dayTime;
    if (this.dayTimeSmooth < 0) this.dayTimeSmooth = target;
    let diff = target - this.dayTimeSmooth;
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    this.dayTimeSmooth = (this.dayTimeSmooth + diff * Math.min(1, dt * 0.5) + 1) % 1;
    this.atmo.time = this.dayTimeSmooth;
    this.atmo.update(dt, now, this.player.pos, this.camera);
    const fq = qualityProfile(settings.quality).fogScale;
    const fogTarget = this.activeEvent?.kind === 'fog' ? 2.6 : 1;
    this.fogBoost += (fogTarget - this.fogBoost) * Math.min(1, dt * 0.25);
    envUniforms.uFogDensity.value *= fq * this.fogBoost;
    this.marker.update(now);
    const wu = this.water.mat.uniforms;
    wu.uSkyTop.value.copy(this.atmo.skyMat.uniforms.uZenith.value);
    wu.uSkyHorizon.value.copy(this.atmo.skyMat.uniforms.uHorizon.value);
    (wu.uMoonDirW.value as THREE.Vector3).copy(this.atmo.skyMat.uniforms.uMoonDir.value);
    // ------------------------------------------------- vue subjective : arme
    this.viewmodel.update(dt, this.player, this.weapons, now);
    // ------------------------------------------------- rendu
    if (this.post.enabled) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (this.player.firstPerson && !this.player.dead) this.viewmodel.render(this.renderer, this.camera);
    // ------------------------------------------------- son
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    audio.setListener(camPos, fwd, this.camera.up);
    audio.update(dt);
    this.updateFootsteps(dt, list);
    // ------------------------------------------------- interface (à 10 Hz)
    this.hudAcc += dt;
    if (this.hudAcc > 0.1) {
      this.hudAcc = 0;
      this.updateHud(now, me);
    }
    this.mapAcc += dt;
    if (this.mapAcc > 0.15) {
      this.mapAcc = 0;
      drawMinimap(this.hud.minimapCanvas, this.map, this.player.pos.x, this.player.pos.z, this.player.yaw, this.store, this.pub, this.priv, this.you, this.selfId, this.activeEvent);
      if (this.strategic.open) this.strategic.draw();
    }
    // images par seconde réelles (dt est plafonné pour la simulation)
    this.fpsAcc.t += Math.max(0.001, (t - this.fpsLast) / 1000);
    this.fpsLast = t;
    this.fpsAcc.n++;
    if (this.fpsAcc.t > 0.5) {
      this.fpsAcc.v = this.fpsAcc.n / this.fpsAcc.t;
      this.fpsAcc.t = 0;
      this.fpsAcc.n = 0;
      this.hud.setFps(settings.showFps ? this.fpsAcc.v : null);
    }
    this.tutorial.update(dt);
    input.endFrame();
  };

  private handleCombat(now: number, input: typeof this.app.input): void {
    const w = this.weapons;
    for (let i = 1; i <= 4; i++) {
      if (input.hit(`weapon${i}` as 'weapon1')) {
        if (w.selectSlot(i)) audio.play('weapon_switch', { volume: 0.6 });
      }
    }
    if (input.hit('weaponNext')) {
      w.next(1);
      audio.play('weapon_switch', { volume: 0.6 });
    }
    if (input.hit('reload')) w.startReload(now);
    const def = WEAPONS[w.current];
    const trigger = def.ranged ? input.hit('fire') || (w.current === Weapon.REVOLVER ? false : false) : input.hit('fire');
    if (!trigger) return;
    if (def.ranged) {
      if ((w.mag.get(w.current) ?? 0) <= 0) {
        audio.play('empty_click', { volume: 0.8 });
        w.startReload(now);
        return;
      }
      const { o, d } = this.player.aimRay();
      const moving = Math.hypot(this.player.vel.x, this.player.vel.z);
      const spreadMul = (this.player.aiming ? 0.45 : 1.15) * (1 + moving * 0.12) * (this.player.crouch ? 0.8 : 1) * (this.player.onGround ? 1 : 2.2);
      const res = w.fire(now, o, d, this.store, this.selfId, spreadMul);
      if (!res) return;
      this.myView.shotAt = now;
      // bouche du canon
      const muzzle = this.player.firstPerson ? this.viewmodel.muzzleWorld(this.camera) : this.chars.muzzleOf(this.selfId)?.clone() ?? o.clone();
      const big = w.current === Weapon.SHOTGUN || w.current === Weapon.RIFLE;
      this.effects.muzzleFlash(muzzle, d, big, this.camera);
      audio.play(w.current === Weapon.SHOTGUN ? 'shotgun' : w.current === Weapon.RIFLE ? 'rifle' : 'revolver', { pos: this.player.pos });
      this.player.recoil += big ? 3 : 1.6;
      this.player.pitch += big ? 0.035 : 0.018;
      this.player.shake += big ? 1.2 : 0.5;
      this.viewmodel.kick(big ? 1.4 : 1);
      const hits: number[][] = [];
      let civKilled = false;
      for (const end of res.ends) {
        // un passant sur la trajectoire ?
        const dir = end.p.clone().sub(o);
        const len = dir.length();
        if (len > 0.01) {
          dir.divideScalar(len);
          const civ = this.civilians.raycast(o, dir, len - 0.05);
          if (civ) {
            const p = o.clone().addScaledVector(dir, civ.t);
            this.effects.tracer(muzzle, p);
            this.effects.blood(p, dir, true);
            audio.play('hit_flesh', { pos: p, volume: 0.8 });
            this.civilians.kill(civ.civ.id, now);
            civKilled = true;
            continue;
          }
        }
        this.effects.tracer(muzzle, end.p);
        if (end.ent) {
          hits.push([end.ent.info.id, end.p.x, end.p.y, end.p.z, end.head ? 1 : 0]);
        } else if (end.n) {
          const kind = surfaceKind(end.mat);
          this.effects.impact(end.p, end.n, kind);
          audio.play(kind === 'wood' ? 'hit_wood' : kind === 'metal' ? 'hit_metal' : kind === 'glass' ? 'glass' : 'hit_wall', { pos: end.p, volume: 0.5 });
        }
      }
      this.app.net.fire({ w: w.current, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], hits });
      if (civKilled) this.app.net.act({ a: 'interact', what: 'civilian' });
      this.recentShots.push({ x: this.player.pos.x, z: this.player.pos.z, t: now });
      this.tutorial.onFire();
      if ((w.mag.get(w.current) ?? 0) === 0) setTimeout(() => w.startReload(performance.now() / 1000), 250);
    } else {
      const target = w.meleeTarget(now, this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.bodyYaw, this.store, this.selfId, this.myFaction);
      if (target === undefined) return;
      if (target === null && w.current !== Weapon.FISTS) {
        // coup porté à un passant
        const { o, d } = this.player.aimRay();
        const civ = this.civilians.raycast(o, d, def.range + 0.6);
        if (civ) {
          const p = o.clone().addScaledVector(d, civ.t);
          this.effects.blood(p, d, false);
          this.civilians.kill(civ.civ.id, now);
          this.app.net.act({ a: 'interact', what: 'civilian' });
        }
      }
      this.myView.meleeAt = now;
      audio.play('swing', { volume: 0.8 });
      this.viewmodel.swing();
      this.app.net.melee(w.current, target ? target.info.id : -1);
    }
  }

  private updateFootsteps(dt: number, views: CharView[]): void {
    // pas des personnages proches (les 5 plus proches en mouvement)
    const p = this.player.pos;
    const near = views
      .filter((v) => v.id !== this.selfId && v.anim !== Anim.DEAD && Math.hypot(v.vx, v.vz) > 0.6 && Math.abs(v.x - p.x) < 14 && Math.abs(v.z - p.z) < 14)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
      .slice(0, 5);
    for (const v of near) {
      const sp = Math.hypot(v.vx, v.vz);
      let acc = (this.stepAcc.get(v.id) ?? Math.random()) + dt * sp / 0.75;
      if (acc >= 1) {
        acc -= 1;
        audio.play('footstep_stone', { pos: { x: v.x, y: v.y, z: v.z }, volume: 0.45 });
      }
      this.stepAcc.set(v.id, acc);
    }
    if (this.stepAcc.size > 200) this.stepAcc.clear();
  }

  private updateHud(now: number, me: ClientEnt | undefined): void {
    const p = this.player.pos;
    const hud = this.hud;
    hud.setHealth(me ? me.hp : 1);
    const w = this.weapons;
    hud.setWeapon(w.current, w.mag.get(w.current) ?? 0, w.reserve(w.current), w.reloading(now), w.owned);
    // district
    const d = districtAt(p.x, p.z);
    const dOwner = this.pub.districts.find((x) => x.id === d.id)?.owner ?? 0;
    hud.setDistrict(d.name, dOwner === 1 ? 'Contrôlé par Dadou' : dOwner === 2 ? 'Contrôlé par Even' : 'Territoire disputé', FACTION_CSS[dOwner]);
    hud.setClock(this.dayTimeSmooth, this.pub.timeLeft);
    // capture du bâtiment où l'on se trouve
    const bid = this.buildingAt(p.x, p.z, p.y);
    if (bid >= 0 && BUILDINGS[bid].capturable) {
      const st = this.pub.buildings[bid];
      const def = BUILDINGS[bid];
      if (st.cap > 0 || st.contested) {
        const who = st.capBy === this.myFaction ? 'Capture' : 'Ennemis en train de capturer';
        hud.setCapture(`${def.name} — ${st.contested ? 'CONTESTÉ !' : `${who} : ${Math.round(st.cap * 100)} %`}`, st.cap, st.contested);
      } else if (st.owner === Faction.DADOU || st.owner === Faction.EVEN) {
        if (st.owner !== this.myFaction) hud.setCapture(`${def.name} — tenu par ${st.owner === Faction.DADOU ? 'Dadou' : 'Even'}. Éliminez ses hommes et restez à l’intérieur pour le prendre.`, 0, false);
        else hud.setCapture(null);
      } else if (st.guards > 0) {
        const gang = DISTRICTS.find((x) => x.id === def.district)?.gang ?? 'un gang local';
        hud.setCapture(`${def.name} — tenu par ${leNom(gang)}. Éliminez les défenseurs et restez à l’intérieur.`, 0, false);
      } else if (def.price > 0) {
        hud.setCapture(`${def.name} — à vendre : ${formatMoney(def.price)} (${actionKey(settings.bindings, 'interact')}), ou restez à l’intérieur pour le prendre.`, 0, false);
      } else {
        hud.setCapture(`${def.name} — sans protection : restez à l’intérieur pour le prendre.`, 0, false);
      }
    } else hud.setCapture(null);
    // événement aléatoire
    const ev = this.activeEvent;
    if (ev) {
      const left = Math.max(0, Math.round(ev.until - this.pub.elapsed));
      const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      if (ev.kind === 'contraband') hud.setEvent('CARGAISON DE CONTREBANDE', `À ${Math.round(Math.hypot(ev.x - p.x, ev.z - p.z))} m — encore ${time}`);
      else if (ev.kind === 'raid') hud.setEvent('DESCENTE DE POLICE', `${districtAt(ev.x, ev.z).name} — encore ${time}`);
      else if (ev.kind === 'fog') hud.setEvent('BROUILLARD', `Visibilité réduite — encore ${time}`);
      else if (ev.kind === 'informant') hud.setEvent('INFORMATEUR', `Positions ennemies révélées — encore ${time}`);
    } else hud.setEvent(null);
    // interaction contextuelle
    this.interact = this.findInteraction(bid);
    if (this.interact && !this.strategic.open) hud.setPrompt(this.interact.key, this.interact.text, this.interact.sub);
    else hud.setPrompt(null);
    // réticule : ennemi visé ?
    let enemy = false;
    if (!this.player.dead) {
      const { o, d: dir } = this.player.aimRay();
      for (const e of this.store.alive()) {
        if (e.info.id === this.selfId || e.info.faction === this.myFaction) continue;
        const dx = e.x - o.x;
        const dz = e.z - o.z;
        if (dx * dx + dz * dz > 60 * 60) continue;
        const t = dx * dir.x + (e.y + 1.2 - o.y) * dir.y + dz * dir.z;
        if (t < 0) continue;
        const cx = o.x + dir.x * t - e.x;
        const cz = o.z + dir.z * t - e.z;
        const cy = o.y + dir.y * t - (e.y + 0.9);
        if (cx * cx + cz * cz < 0.2 && Math.abs(cy) < 0.95) {
          enemy = true;
          break;
        }
      }
    }
    hud.setCrosshair(enemy, !this.player.dead && !this.strategic.open);
    // mort
    if (this.player.dead && this.priv.dead) {
      hud.showDeath(`Les médecins vous recousent au quartier général… réapparition dans ${Math.ceil(this.priv.respawnIn)} s.`);
    } else if (!this.player.dead) hud.showDeath(null);
    // ambiance sonore
    const shots = this.recentShots.filter((s) => now - s.t < 5);
    this.recentShots = shots;
    const combat = Math.min(1, shots.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < 45).length / 6);
    audio.setAmbience({
      night: this.atmo.night,
      indoor: bid >= 0,
      nearWater: Math.max(0, Math.min(1, (p.z - 118) / 20)),
      combat,
      crowd: Math.min(1, this.civilians.countNear(p.x, p.z, 20) / 8),
    });
    // cloches de Big Ben à chaque heure
    const hour = Math.floor(this.dayTimeSmooth * 24);
    if (this.lastHour >= 0 && hour !== this.lastHour) {
      const tower = this.world.buildings.find((b) => b.def.type === 'clocktower');
      audio.bellChime(hour % 12 || 12, tower ? { x: tower.center.x, y: 30, z: tower.center.z } : undefined);
    }
    this.lastHour = hour;
  }

  /** Bâtiment (zone intérieure) contenant le point. */
  buildingAt(x: number, z: number, y?: number): number {
    for (const b of this.world.buildings) {
      const f = b.footprint;
      if (x < f[0] || x > f[2] || z < f[1] || z > f[3]) continue;
      if (y !== undefined && Math.abs(y - b.floorY) > 2.5) continue;
      for (const r of b.zone) if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return b.id;
    }
    return -1;
  }

  private findInteraction(bid: number): { key: string; text: string; sub: string; run: () => void } | null {
    if (this.player.dead) return null;
    const p = this.player.pos;
    const key = actionKey(settings.bindings, 'interact');
    const hq = this.world.buildings[HQ_BUILDING[this.you].id];
    const near = (pt: { x: number; z: number } | undefined, r: number) => !!pt && Math.hypot(pt.x - p.x, pt.z - p.z) < r && Math.abs(p.y - hq.floorY) < 2;
    if (near(hq.desk, 2.3))
      return {
        key,
        text: 'Ouvrir la carte stratégique',
        sub: `Bureau ${DE_BOSS[this.you]}`,
        run: () => {
          this.myView.interactAt = performance.now() / 1000;
          this.strategic.show('orders');
          this.tutorial.onDesk();
        },
      };
    if (near(hq.recruit, 2.4))
      return {
        key,
        text: 'Recruter des hommes',
        sub: this.you === 'dadou' ? 'Bill le barman' : 'Molly la tenancière',
        run: () => this.strategic.show('recruit'),
      };
    if (near(hq.armory, 2.6))
      return { key, text: 'Armurerie', sub: this.priv.upgrades.includes('armory') ? 'Armes et munitions' : 'Amélioration requise', run: () => this.strategic.show('armory') };
    // bâtiment neutre à vendre
    if (bid >= 0) {
      const def = BUILDINGS[bid];
      const st = this.pub.buildings[bid];
      if (def.capturable && st.owner === Faction.NEUTRAL && def.price > 0 && st.guards === 0)
        return {
          key,
          text: `Acheter ${leNom(def.name)} — ${formatMoney(def.price)}`,
          sub: `+${def.income} £/min`,
          run: () => {
            this.app.net.act({ a: 'buyBuilding', b: bid });
            audio.play('purchase');
          },
        };
      // bureau ennemi : un petit plaisir
      const ehq = this.world.buildings[HQ_BUILDING[this.you === 'dadou' ? 'even' : 'dadou'].id];
      if (ehq.desk && Math.hypot(ehq.desk.x - p.x, ehq.desk.z - p.z) < 2.3) {
        const other = this.you === 'dadou' ? 'even' : 'dadou';
        return {
          key,
          text: `Fouiller le bureau ${DE_BOSS[other]}`,
          sub: '',
          run: () => this.hud.notify(`Vous fouillez le bureau ${DE_BOSS[other]}… un portrait de ${BOSS_NAME[other]} vous toise. Mieux vaut prendre ce QG pour de bon !`, 'info'),
        };
      }
    }
    return null;
  }

  private showVictory(winner: Slot | null, reason: string, stats: Parameters<typeof victoryScreen>[1]['stats'] | null): void {
    this.over = { winner, reason };
    this.strategic.close();
    this.closeModal();
    this.app.input.blocked = true;
    this.app.input.exitLock();
    audio.playMusic(winner === this.you ? 'victory' : 'defeat');
    audio.play(winner === this.you ? 'victory' : 'defeat');
    const st =
      stats ??
      ({
        dadou: { kills: 0, deaths: 0, captured: 0, lost: 0, territories: this.pub.territories.dadou, recruited: 0, earned: 0, buildings: 0 },
        even: { kills: 0, deaths: 0, captured: 0, lost: 0, territories: this.pub.territories.even, recruited: 0, earned: 0, buildings: 0 },
      } as Parameters<typeof victoryScreen>[1]['stats']);
    const v = victoryScreen(this.app, { winner, me: this.you, reason, stats: st }, {
      onRematch: () => this.app.net.act({ a: 'rematch' }),
      onMenu: () => this.onExit?.(),
    });
    this.victory = v;
    this.overlay.appendChild(v.el);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const o of this.offs) o();
    window.removeEventListener('resize', this.onResize);
    this.app.input.onEscape = null;
    this.app.input.onUnlock = null;
    this.app.input.onKey = null;
    this.app.input.exitLock();
    this.app.input.blocked = true;
    this.app.input.lockEnabled = false;
    this.strategic.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.overlay.remove();
    audio.playMusic('menu');
  }
}

export { formatTime };
