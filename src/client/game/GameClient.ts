// Client de jeu : rendu de New York 2085, parrain local, entités réseau, combats, interface.

import * as THREE from 'three';
import { Anim, CharKind, FLAG, RECRUITER_NAME, WEAPONS, Weapon } from '../../shared/characters';
import { BOSS_NAME, DE_BOSS, MAFIA_NAME, VEHICLES, tierDef, type VehicleClass } from '../../shared/constants';
import { BUILDINGS, DISTRICTS, Faction, RIVER_X0, RIVER_X1, districtAt, isWater } from '../../shared/city/plan';
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
import type { LoopName, SfxName } from '../audio/types';
import { CharacterRenderer, type CharView } from '../characters/characterRenderer';
import { Atmosphere } from '../render/atmosphere';
import { Rain } from '../render/rain';
import { createSkyline, type Skyline } from '../render/skyline';
import { Holograms } from '../render/holograms';
import { BigScreens } from './bigScreens';
import { GlassBreaker } from './glassBreaker';
import { GrenadeFx } from './grenades';
import { EngineSounds, rpm, type LoopSource } from './engineSounds';
import { createMaterialTexture, createTintTexture, envUniforms } from '../render/env';
import { LightStream } from '../render/lightStream';
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
import { Tips } from './tips';
import { DoorSystem } from './doors';
import { SignSystem } from './signs';
import { Civilians } from './civilians';
import { Traffic } from './traffic';
import { Viewmodel } from './viewmodel';
import { WeaponSystem, surfaceKind } from './weapons';
import { VehicleRenderer } from './vehicleRenderer';
import { Phone } from './phone';
import { Drive } from './driving';
import { deNom as deNomFr, leNom } from '../../shared/french';

export interface GameInit {
  you: Slot;
  code: string;
  settings: MatchSettings;
  time: number;
  infos: EntityInfo[];
  pub: PublicState;
  priv: PrivateState;
  over: { winner: Slot | null; reason: string } | null;
  /** Verre déjà brisé dans la partie : [x, y, z, rayon]. */
  glass?: [number, number, number, number][];
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
  readonly rain: Rain;
  readonly skyline: Skyline;
  readonly glass: GlassBreaker;
  readonly grenades: GrenadeFx;
  private engines = new EngineSounds();
  private loopAcc = 0;
  readonly screens: BigScreens;
  readonly holos: Holograms;
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
  readonly phone: Phone;
  tips: Tips;
  readonly doors: DoorSystem;
  readonly signs: SignSystem;
  readonly civilians: Civilians;
  readonly traffic: Traffic;
  readonly viewmodel: Viewmodel;
  readonly vehicles = new VehicleRenderer();
  readonly post: PostFX;
  readonly marker = new EventMarker();
  /** Butin d'un convoi détruit (le plus proche du joueur). */
  readonly lootMarker = new EventMarker(new THREE.Color(0.3, 1.0, 0.62), 'butin');
  /** Événement aléatoire en cours (annoncé par le serveur). */
  activeEvent: Extract<GameEvent, { t: 'event' }> | null = null;
  private fogBoost = 1;
  private regions: { mesh: THREE.Mesh; x: number; z: number; r: number }[] = [];
  private lightStream: LightStream;
  /** Voile noir du début de partie : levé quand le parrain est placé et l'éclairage arrivé. */
  private curtain: HTMLElement | null = null;
  private curtainT = 0;
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
    this.lightStream = new LightStream(world.lightFeed, this.renderer);
    createTintTexture(world.tint);
    const worldGroup = buildWorldGroup(world.regions, createWorldMaterial());
    this.scene.add(worldGroup);
    // verre destructible : les régions du monde sont remaillées quand une vitre se brise
    const regionMeshes = new Map<string, THREE.Mesh>();
    for (const m of worldGroup.children as THREE.Mesh[]) regionMeshes.set(m.userData.region as string, m);
    this.glass = new GlassBreaker(world.world, regionMeshes);
    for (const g of init.glass ?? []) this.glass.apply(g[0], g[1], g[2], g[3]);
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
    this.skyline = createSkyline();
    this.scene.add(this.skyline.group);
    this.grenades = new GrenadeFx(world.world);
    this.scene.add(this.grenades.group);
    this.screens = new BigScreens(world.screens);
    this.scene.add(this.screens.group);
    this.holos = new Holograms(world.holos);
    this.scene.add(this.holos.group);
    this.atmo = new Atmosphere(this.scene, q.shadow);
    this.rain = new Rain(settings.quality === 'basse' ? 2200 : settings.quality === 'moyenne' ? 4000 : settings.quality === 'haute' ? 6500 : 9000);
    this.scene.add(this.rain.mesh);
    this.props = new PropRenderer(world.props, world.buildings);
    this.props.setDistances(q.propDist, Math.min(150, q.drawDist));
    this.scene.add(this.props.group);
    this.chars = new CharacterRenderer();
    this.chars.maxDistance = q.charDist;
    this.scene.add(this.chars.group);
    this.scene.add(this.effects.group);
    this.scene.add(this.marker.group);
    this.scene.add(this.lootMarker.group);
    this.effects.setEmitters(world.smokes);
    this.doors = new DoorSystem(world.props, world.buildings, world.world);
    this.scene.add(this.doors.group);
    this.signs = new SignSystem(world.buildings, this.you);
    this.scene.add(this.signs.group);
    this.civilians = new Civilians(world, this.store);
    this.traffic = new Traffic(world);
    this.scene.add(this.traffic.group);
    this.scene.add(this.vehicles.group);
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
      // passants et rabatteurs : préparés d'avance plutôt qu'apparus au fil des images
      { kind: CharKind.CIVILIAN, faction: 0, look: 1 },
      { kind: CharKind.CIVILIAN_F, faction: 0, look: 2 },
      { kind: CharKind.BARMAN, faction: 1, look: 1 },
      { kind: CharKind.BARMAN, faction: 2, look: 1 },
      { kind: CharKind.TURRET, faction: 0, look: 0 },
    ]);
    // ---------------------------------------------------------------- jeu
    this.player = new PlayerController(this.camera, world.world);
    this.weapons = new WeaponSystem(world.world);
    this.weapons.onReloadStart = () => {
      app.net.reload();
      audio.play('reload', { pos: this.player.pos });
    };
    this.player.onStep = (m) => {
      audio.play(stepSfx(m), { pos: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }, volume: this.player.sprint ? 1 : 0.7 });
    };
    this.map = new CityMap(world);
    this.hud = new Hud(this.you);
    this.overlay = h('div', { class: `layer game-overlay mw-${this.you}` });
    app.root.appendChild(this.overlay);
    this.showCurtain();
    this.overlay.appendChild(this.hud.el);
    this.strategic = new StrategicMap(this);
    this.overlay.appendChild(this.strategic.el);
    this.wheel = new CommandWheel(this);
    this.overlay.appendChild(this.wheel.el);
    this.phone = new Phone(this);
    this.overlay.appendChild(this.phone.el);
    this.tips = new Tips(this);
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
      weapon: Weapon.PISTOL,
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
      if (!this.modal && !this.strategic.open && !this.phone.open && !this.chatting && !this.wheel.open && !this.over) this.openPause();
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
    // verre : on remet tout en place puis on applique l'état de la partie
    this.grenades.clear();
    this.glass.restore();
    for (const g of init.glass ?? []) this.glass.apply(g[0], g[1], g[2], g[3]);
    this.placed = false;
    if (init.time < 10) this.showCurtain();
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
    // revanche (nouvelle partie) : les conseils repartent ; simple reconnexion : on garde
    if (init.time < 10) this.tips = new Tips(this);
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
        audio.play(shotSfx(e.w), { pos: from });
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
          audio.play(w === Weapon.FISTS ? 'punch' : w === Weapon.CLUB ? 'stun_baton' : w === Weapon.KNIFE ? 'thermal_knife' : 'hit_flesh', { volume: 0.5 });
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
        if (e.by === this.selfId && ent) this.tips.onKill(ent);
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
          this.tips.onCapture(e.b);
        } else if (prev === this.myFaction) audio.play('territory_lost');
        this.strategic.dirty = true;
        break;
      }
      case 'district':
        this.strategic.dirty = true;
        break;
      case 'chat': {
        const from = e.from === 'system' ? 'New York' : BOSS_NAME[e.from];
        this.hud.chat(from, e.from === 'dadou' ? '#e05a5a' : e.from === 'even' ? '#6f95e0' : '#d4a640', e.text);
        audio.play('paper', { volume: 0.5 });
        break;
      }
      case 'news':
        this.hud.newspaper(e.title, e.body);
        audio.play('paper');
        break;
      case 'tp':
        if (this.player.drive) {
          this.player.drive.pos.set(e.x, e.y, e.z);
          this.player.drive.yaw = e.yaw;
          this.player.drive.speed = 0;
          this.player.pos.set(e.x, e.y, e.z);
        } else this.player.teleport(e.x, e.y, e.z, e.yaw);
        this.placed = true;
        break;
      case 'ride': {
        if (e.driver === this.selfId) {
          const ve = this.store.ents.get(e.id);
          const def = ve ? ve.info.gang : 0;
          const x = ve ? ve.x : this.player.pos.x;
          const y = ve ? ve.y : this.player.pos.y;
          const z = ve ? ve.z : this.player.pos.z;
          const yaw = ve ? ve.view.yaw : this.player.yaw;
          this.player.drive = new Drive(e.id, def, this.world.world, x, y, z, yaw);
          this.player.yaw = yaw;
          this.player.pitch = -0.15;
          audio.play('ui_open', { volume: 0.5 });
          const vd = VEHICLES[def];
          this.hud.setHint(
            vd.cls === 'vtol'
              ? `${actionKey(settings.bindings, 'forward')}/${actionKey(settings.bindings, 'back')} : poussée — ${actionKey(settings.bindings, 'left')}/${actionKey(settings.bindings, 'right')} : virer — ${actionKey(settings.bindings, 'jump')} : prendre de l’altitude — ${actionKey(settings.bindings, 'crouch')} : en perdre — ${actionKey(settings.bindings, 'interact')} : quitter l’aéronef (posé)`
              : `${actionKey(settings.bindings, 'forward')} : accélérer — ${actionKey(settings.bindings, 'back')} : freiner — ${actionKey(settings.bindings, 'jump')} : frein à main — ${actionKey(settings.bindings, 'aim')} : tirer par la vitre — ${actionKey(settings.bindings, 'interact')} : descendre`,
          );
          setTimeout(() => this.hud.setHint(''), 7000);
        } else if (this.player.drive && this.player.drive.id === e.id && e.driver !== this.selfId) {
          this.player.drive = null;
        }
        break;
      }
      case 'grenade':
        this.grenades.spawn(e.id, e.x, e.y, e.z, e.vx, e.vy, e.vz);
        break;
      case 'glass': {
        const n = this.glass.apply(e.x, e.y, e.z, e.r);
        if (n > 0) {
          const p = new THREE.Vector3(e.x, e.y, e.z);
          this.effects.burst(p, 0xcfeeff, Math.min(60, 10 + n));
          if (p.distanceTo(this.player.pos) < 70) audio.play('glass_break', { pos: p, volume: Math.min(1, 0.5 + n / 60) });
        }
        break;
      }
      case 'boom': {
        const p = new THREE.Vector3(e.x, e.y, e.z);
        this.effects.burst(p, 0xff8a30, 70);
        this.effects.burst(p, 0x333333, 40);
        const d = p.distanceTo(this.player.pos);
        if (d < 30) this.player.shake = Math.min(4, this.player.shake + (30 - d) / 8);
        break;
      }
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
      case 'hq': {
        // un parrain emménage : le QG change d'adresse
        this.pub.hq[e.slot] = e.b;
        if (this.pub.tier) this.pub.tier[e.slot] = e.tier;
        if (e.slot === this.you) {
          const def = BUILDINGS[e.b];
          this.hud.banner(`NOUVEAU QG : ${def.name.toUpperCase()}`, `${tierDef(e.tier).name} — ${tierDef(e.tier).perks.join(' · ')}`);
          audio.play('purchase');
        }
        this.strategic.dirty = true;
        break;
      }
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
    this.screens.observe(p);
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
    // butin d'un convoi détruit : balise verte sur le plus proche
    const loot = p.loot ?? [];
    if (loot.length > 0) {
      const me = this.player.pos;
      let best = loot[0];
      for (const l of loot) if (Math.hypot(l.x - me.x, l.z - me.z) < Math.hypot(best.x - me.x, best.z - me.z)) best = l;
      const y = this.world.nav.heightAt(best.x, best.z);
      this.lootMarker.show(best.x, Number.isFinite(y) ? y : 0, best.z);
    } else this.lootMarker.hide();
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
    this.tips.onPriv(p);
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
      this.phone.close();
      if (this.strategic.open) this.strategic.close();
      else this.strategic.show(this.priv.upgrades.includes('crypto') || this.priv.tier >= 3 ? 'orders' : 'view');
      return true;
    }
    if (b.phone.includes(code) && !this.strategic.open && !this.wheel.open) {
      this.phone.toggle();
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
    if (this.phone.open) return this.phone.close();
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
  private showCurtain(): void {
    this.curtain?.remove();
    this.curtainT = 0;
    this.curtain = h('div', { class: 'game-curtain', style: 'position:absolute;inset:0;background:#000;pointer-events:none;transition:opacity 0.8s ease' });
    // sous le HUD : seule la vue 3D est voilée
    this.overlay.insertBefore(this.curtain, this.overlay.firstChild);
  }

  private liftCurtain(): void {
    const c = this.curtain;
    if (!c) return;
    this.curtain = null;
    c.style.opacity = '0';
    setTimeout(() => c.remove(), 900);
  }

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
    const uiBlocked = this.strategic.open || this.phone.open || !!this.modal || this.chatting || !!this.over;
    this.player.frozen = uiBlocked || !this.placed || !!this.serverPause;
    this.wheel.update(dt, input);
    if (this.wheel.open) this.player.frozen = true;
    this.player.weapon = this.weapons.current;
    this.player.update(dt, input);
    // au volant : on ne tire qu'en visant (par la vitre), au pistolet ou au pistolet-mitrailleur
    const canFight = !this.player.drive || (this.player.aiming && (this.weapons.current === Weapon.PISTOL || this.weapons.current === Weapon.SMG));
    if (!uiBlocked && !this.wheel.open && !this.player.dead && this.placed && canFight) this.handleCombat(now, input);
    if (!uiBlocked && input.hit('interact') && this.interact) this.interact.run();
    if (!uiBlocked && !this.wheel.open && !this.player.dead && this.placed && !this.player.drive && input.hit('grenade')) this.throwGrenade();
    this.player.updateCamera(dt, settings.fov);
    // ------------------------------------------------- envoi de l'état (20 Hz)
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05 && this.placed) {
      this.sendAcc = 0;
      const p = this.player;
      if (p.drive) {
        const d = p.drive;
        const v = d.velocity();
        this.app.net.sendInput([d.pos.x, d.pos.y, d.pos.z, d.yaw, p.pitch, v.x, v.z, Anim.DRIVE, p.flags(), this.weapons.current, this.priv.tp]);
      } else this.app.net.sendInput([p.pos.x, p.pos.y, p.pos.z, p.bodyYaw, p.pitch, p.vel.x, p.vel.z, p.dead ? Anim.DEAD : p.anim, p.flags(), this.weapons.current, this.priv.tp]);
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
    const drive = this.player.drive;
    if (drive) {
      // au volant : caché dans l'habitacle, ou en selle sur la moto
      if (drive.def.cls !== 'moto') mv.hidden = true;
      else {
        const seat = VehicleRenderer.seat(drive.def.id, drive.pos.x, drive.pos.y, drive.pos.z, drive.yaw);
        mv.x = seat.x;
        mv.y = seat.y;
        mv.z = seat.z;
        mv.yaw = drive.yaw;
        // en selle : poings sur le guidon, pieds en avant
        mv.anim = Anim.DRIVE;
        mv.hidden = this.player.firstPerson;
      }
    }
    const vehViews: CharView[] = [];
    const list: CharView[] = [];
    const vehById = new Map<number, CharView>();
    for (const v of views) {
      if (v.kind === CharKind.VEHICLE) {
        vehViews.push(v);
        vehById.set(v.id, v);
      } else if (v.id !== this.selfId) list.push(v);
    }
    // pilotes de moto des autres : assis sur la selle
    for (const [vid, did] of this.pub.rides ?? []) {
      if (did === this.selfId) continue;
      const vv = vehById.get(vid);
      const dv = list.find((x) => x.id === did);
      if (!vv || !dv) continue;
      if (VEHICLES[vv.gang]?.cls === 'moto') {
        const seat = VehicleRenderer.seat(vv.gang, vv.x, vv.y, vv.z, vv.yaw);
        dv.x = seat.x;
        dv.y = seat.y;
        dv.z = seat.z;
        dv.yaw = vv.yaw;
        dv.anim = Anim.DRIVE;
        dv.hidden = false;
      } else dv.hidden = true;
    }
    this.vehicles.update(vehViews, dt, drive ? { id: drive.id, x: drive.pos.x, y: drive.pos.y, z: drive.pos.z, yaw: drive.yaw, speed: drive.speed } : null);
    // sons continus (10 fois par seconde) : moteurs, sirènes de police, alarmes des braquages
    this.loopAcc += dt;
    if (this.loopAcc > 0.1) {
      this.loopAcc = 0;
      const lp = this.camera.position;
      const src: LoopSource[] = [];
      if (drive) src.push({ key: 'moi', loop: engineLoop(drive.def.cls), x: drive.pos.x, y: drive.pos.y + 0.6, z: drive.pos.z, pitch: rpm(drive.speed, drive.def.speed), volume: 0.75 });
      const riding = new Set((this.pub.rides ?? []).map((r) => r[0]));
      const trucks = new Set((this.pub.convoys ?? []).map((c) => c.id));
      for (const v of vehViews) {
        if (drive && v.id === drive.id) continue;
        const def = VEHICLES[v.gang];
        if (!def || v.anim === Anim.DEAD) continue;
        const sp = Math.hypot(v.vx, v.vz);
        if (!riding.has(v.id) && !trucks.has(v.id) && def.cls !== 'drone' && sp < 0.5) continue;
        if (Math.hypot(v.x - lp.x, v.z - lp.z) > 60) continue;
        // croiseur du NYPD en intervention : la sirène plutôt que le moteur
        const siren = def.key === 'police' && sp > 1 && !riding.has(v.id);
        src.push({ key: `v${v.id}`, loop: siren ? 'siren' : engineLoop(def.cls), x: v.x, y: v.y + (siren ? 1.6 : 0.6), z: v.z, pitch: siren ? 1 : rpm(sp, def.speed), volume: siren ? 0.75 : 0.7 });
      }
      this.traffic.loopSources(lp.x, lp.y, lp.z, src);
      if (this.priv.wanted > 0) {
        let cop: ClientEnt | null = null;
        let bd = 90;
        for (const e of this.store.alive()) {
          if (e.info.faction !== Faction.POLICE) continue;
          const d = Math.hypot(e.x - lp.x, e.z - lp.z);
          if (d < bd) {
            bd = d;
            cop = e;
          }
        }
        if (cop) src.push({ key: 'sirène', loop: 'siren', x: cop.x, y: cop.y + 2, z: cop.z, pitch: 1, volume: 0.55 });
      }
      for (const hz of this.pub.heists ?? []) {
        const b = this.world.buildings[hz.b];
        if (b && Math.hypot(b.center.x - lp.x, b.center.z - lp.z) < 90) src.push({ key: `alarme${hz.b}`, loop: 'alarm', x: b.center.x, y: b.floorY + 4, z: b.center.z, pitch: 1, volume: 0.7 });
      }
      this.engines.update(src, lp.x, lp.y, lp.z);
    }
    if (this.placed) list.push(mv);
    // passants renversés par le véhicule du joueur
    if (drive && Math.abs(drive.speed) > 7 && drive.def.cls !== 'vtol') {
      const hits = this.civilians.hitBox(drive.pos.x, drive.pos.y, drive.pos.z, drive.yaw, drive.def.size[2] / 2, drive.def.size[0] / 2);
      for (const id of hits) {
        this.civilians.kill(id, now);
        this.effects.blood(new THREE.Vector3(drive.pos.x, drive.pos.y + 1, drive.pos.z), new THREE.Vector3(Math.sin(drive.yaw), 0.3, Math.cos(drive.yaw)), true);
        audio.play('hit_flesh', { pos: drive.pos, volume: 0.9 });
        this.app.net.act({ a: 'interact', what: 'civilian' });
      }
    }
    const civViews = this.civilians.update(dt, now, this.player.pos, this.recentShots);
    for (const c of civViews) list.push(c);
    this.traffic.update(dt, now, this.player.pos, list, drive && drive.def.cls !== 'vtol' ? { x: drive.pos.x, z: drive.pos.z, yaw: drive.yaw, hl: drive.def.size[2] / 2, hw: drive.def.size[0] / 2 } : null);
    this.chars.update(list, this.camera, now, dt);
    // ------------------------------------------------- monde
    const camPos = this.camera.position;
    this.lightStream.update(camPos.x, camPos.z);
    if (this.curtain && this.placed) {
      this.curtainT += dt;
      // l'éclairage fin autour du parrain arrive en général en une fraction de seconde
      if (this.lightStream.ready || this.curtainT > 4) this.liftCurtain();
    }
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
    // pluie : traits de pluie, chaussée mouillée (qui sèche lentement), ciel bas et éclairs
    const rainTarget = this.pub.rain ?? 0;
    const sheltered = camPos.y < -1.2 || this.buildingAt(camPos.x, camPos.z, camPos.y) >= 0;
    this.rain.update(dt, this.camera, rainTarget, sheltered, this.renderer.domElement.height);
    const wetTarget = Math.min(1, rainTarget * 1.4);
    envUniforms.uWet.value += (wetTarget - envUniforms.uWet.value) * Math.min(1, dt * (wetTarget > envUniforms.uWet.value ? 0.12 : 0.012));
    this.atmo.rain = this.rain.intensity;
    this.atmo.storm = this.activeEvent?.kind === 'storm' ? 1 : 0;
    this.atmo.update(dt, now, this.player.pos, this.camera);
    if (this.atmo.thunderAt > 0 && now >= this.atmo.thunderAt) {
      this.atmo.thunderAt = 0;
      audio.play('explosion', { volume: sheltered ? 0.18 : 0.35, pitch: 0.45 });
    }
    const fq = qualityProfile(settings.quality).fogScale;
    const fogTarget = this.activeEvent?.kind === 'storm' ? 2.2 : 1;
    this.fogBoost += (fogTarget - this.fogBoost) * Math.min(1, dt * 0.25);
    envUniforms.uFogDensity.value *= fq * this.fogBoost;
    this.marker.update(now);
    this.lootMarker.update(now);
    this.grenades.update(dt);
    this.skyline.update(now);
    this.screens.update(now, camPos);
    this.holos.update(now, dt, camPos);
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
    this.tips.update(dt);
    this.phone.update(dt);
    input.endFrame();
  };

  private handleCombat(now: number, input: typeof this.app.input): void {
    const w = this.weapons;
    for (let i = 1; i <= 5; i++) {
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
    // tir automatique (pistolet-mitrailleur) : bouton maintenu
    const trigger = def.ranged && def.auto ? input.is('fire') : input.hit('fire');
    if (!trigger) return;
    if (def.ranged) {
      if ((w.mag.get(w.current) ?? 0) <= 0) {
        if (!input.hit('fire')) return;
        audio.play('empty_click', { volume: 0.8 });
        w.startReload(now);
        return;
      }
      const { o, d } = this.player.aimRay();
      const moving = Math.hypot(this.player.vel.x, this.player.vel.z);
      const spreadMul = (this.player.aiming ? 0.45 : 1.15) * (1 + moving * 0.12) * (this.player.crouch ? 0.8 : 1) * (this.player.onGround ? 1 : 2.2);
      const res = w.fire(now, o, d, this.store, this.selfId, spreadMul, this.player.drive?.id ?? -1);
      if (!res) return;
      this.myView.shotAt = now;
      // bouche du canon
      const muzzle = this.player.firstPerson ? this.viewmodel.muzzleWorld(this.camera) : this.chars.muzzleOf(this.selfId)?.clone() ?? o.clone();
      const big = w.current === Weapon.SHOTGUN || w.current === Weapon.RIFLE;
      this.effects.muzzleFlash(muzzle, d, big, this.camera);
      audio.play(shotSfx(w.current), { pos: this.player.pos });
      const smg = w.current === Weapon.SMG;
      this.player.recoil += big ? 3 : smg ? 0.7 : 1.6;
      this.player.pitch += big ? 0.035 : smg ? 0.006 : 0.018;
      this.player.shake += big ? 1.2 : smg ? 0.2 : 0.5;
      this.viewmodel.kick(big ? 1.4 : smg ? 0.5 : 1);
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
      this.tips.onFire();
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
        audio.play(this.buildingAt(v.x, v.z, v.y) >= 0 ? 'footstep_stone' : 'footstep_concrete', { pos: { x: v.x, y: v.y, z: v.z }, volume: 0.45 });
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
    hud.setGrenades(this.priv.grenades ?? 0, actionKey(settings.bindings, 'grenade'));
    // district
    const d = districtAt(p.x, p.z);
    const dOwner = this.pub.districts.find((x) => x.id === d.id)?.owner ?? 0;
    hud.setDistrict(d.name, dOwner === 1 ? 'Contrôlé par Dadou' : dOwner === 2 ? 'Contrôlé par Even' : 'Territoire disputé', FACTION_CSS[dOwner]);
    hud.setClock(this.dayTimeSmooth, this.pub.timeLeft);
    // capture du bâtiment où l'on se trouve
    const bid = this.buildingAt(p.x, p.z, p.y);
    const resv = bid >= 0 && BUILDINGS[bid].residence && this.pub.buildings[bid]?.owner === Faction.NEUTRAL ? BUILDINGS[bid] : null;
    if (resv) {
      const r = resv.residence!;
      hud.setCapture(
        r.boss === this.you
          ? `${resv.name} — votre futur ${tierDef(r.tier).name.toLowerCase()} : ${formatMoney(resv.price)} (carte stratégique ou ${actionKey(settings.bindings, 'interact')} au bureau).`
          : `${resv.name} — logement réservé à ${BOSS_NAME[r.boss]}. Il ne peut pas être pris tant qu’il est vide.`,
        0,
        false,
      );
    } else if (this.priv.hack) {
      hud.setCapture(`Piratage ${deNomFr(BUILDINGS[this.priv.hack.b].name)} — ${Math.round(this.priv.hack.p * 100)} %`, this.priv.hack.p, false);
    } else if (this.pub.heists?.some((h) => h.slot === this.you)) {
      const hz = this.pub.heists.find((h) => h.slot === this.you)!;
      hud.setCapture(`Braquage ${deNomFr(BUILDINGS[hz.b].name)} — ${Math.round(hz.p * 100)} % : restez près du coffre !`, hz.p, false);
    } else if (bid >= 0 && BUILDINGS[bid].capturable) {
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
      else if (ev.kind === 'storm') hud.setEvent('ORAGE MAGNÉTIQUE', `Pluie battante, visibilité réduite — encore ${time}`);
      else if (ev.kind === 'informant') hud.setEvent('HACKEUSE', `Positions ennemies révélées — encore ${time}`);
    } else hud.setEvent(null);
    // véhicule conduit
    const drv = this.player.drive;
    if (drv) {
      const ve = this.store.ents.get(drv.id);
      hud.setVehicle(drv.def.name, Math.abs(drv.speed) * 3.6, ve ? ve.hp : 1);
    } else hud.setVehicle(null);
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
      hud.showDeath(`Les médecins de la mafia vous recousent au quartier général… réapparition dans ${Math.ceil(this.priv.respawnIn)} s.`);
    } else if (!this.player.dead) hud.showDeath(null);
    // ambiance sonore
    const shots = this.recentShots.filter((s) => now - s.t < 5);
    this.recentShots = shots;
    const combat = Math.min(1, shots.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < 45).length / 6);
    const riverD = p.x < RIVER_X0 ? RIVER_X0 - p.x : p.x > RIVER_X1 ? p.x - RIVER_X1 : 0;
    audio.setAmbience({
      night: this.atmo.night,
      indoor: bid >= 0,
      nearWater: isWater(p.x, p.z) ? 1 : Math.max(0, Math.min(1, 1 - riverD / 25)),
      combat,
      crowd: Math.min(1, this.civilians.countNear(p.x, p.z, 20) / 8),
      rain: this.pub.rain ?? 0,
      underground: Math.max(0, Math.min(1, (-p.y - 1) / 3)),
      altitude: bid >= 0 ? 0 : Math.max(0, p.y),
    });
  }

  /** Lance une grenade dans la direction du regard (le serveur simule la trajectoire et l'explosion). */
  private throwGrenade(): void {
    if ((this.priv.grenades ?? 0) <= 0) {
      this.hud.notify('Plus de grenades : l’armurerie du QG en vend.', 'info', 2500);
      return;
    }
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const p = this.player.pos;
    this.myView.meleeAt = performance.now() / 1000;
    this.app.net.act({ a: 'grenade', o: [p.x + dir.x * 0.4, p.y + 1.5, p.z + dir.z * 0.4], d: [dir.x, dir.y, dir.z] });
    audio.play('swing', { volume: 0.7 });
  }

  /** Bâtiment (volume intérieur, tous étages) contenant le point. */
  buildingAt(x: number, z: number, y?: number): number {
    for (const b of this.world.buildings) {
      const f = b.footprint;
      if (x < f[0] || x > f[2] || z < f[1] || z > f[3]) continue;
      for (const zn of b.zone) {
        const r = zn.rect;
        if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3] && (y === undefined || (y >= zn.y0 - 0.6 && y <= zn.y1))) return b.id;
      }
    }
    return -1;
  }

  private findInteraction(bid: number): { key: string; text: string; sub: string; run: () => void } | null {
    if (this.player.dead) return null;
    const p = this.player.pos;
    const key = actionKey(settings.bindings, 'interact');
    // au volant : descendre
    if (this.player.drive) {
      const d = this.player.drive;
      return { key, text: d.def.cls === 'vtol' ? 'Descendre de l’aéronef' : 'Descendre', sub: d.def.name, run: () => this.app.net.act({ a: 'vehicle', op: 'exit' }) };
    }
    // véhicule libre à portée de main
    let bestVeh: ClientEnt | null = null;
    let bestD = 3.6;
    for (const e of this.store.alive()) {
      if (e.info.kind !== CharKind.VEHICLE || e.flags & FLAG.VEHICLE) continue;
      const def = VEHICLES[e.info.gang];
      if (!def || def.cls === 'drone') continue;
      const dd = Math.hypot(e.x - p.x, e.z - p.z) - Math.max(def.size[0], def.size[2]) * 0.35;
      if (dd < bestD && Math.abs(e.y - p.y) < 2) {
        bestD = dd;
        bestVeh = e;
      }
    }
    if (bestVeh) {
      const ve = bestVeh;
      const def = VEHICLES[ve.info.gang];
      const mine = ve.info.faction === this.myFaction;
      return {
        key,
        text: mine ? `Monter : ${def.name}` : `Voler : ${def.name}`,
        sub: def.seats > 1 ? `${def.seats - 1} place${def.seats > 2 ? 's' : ''} pour votre escorte` : 'Une seule place',
        run: () => this.app.net.act({ a: 'vehicle', op: 'enter', id: ve.info.id }),
      };
    }
    const hq = this.world.buildings[this.pub.hq[this.you]];
    const near = (pt: { x: number; z: number; y?: number } | undefined, r: number) => !!pt && Math.hypot(pt.x - p.x, pt.z - p.z) < r && Math.abs(p.y - (pt.y ?? hq.floorY)) < 1.6;
    if (near(hq.desk, 2.3))
      return {
        key,
        text: 'Ouvrir la carte stratégique',
        sub: `Bureau ${DE_BOSS[this.you]}`,
        run: () => {
          this.myView.interactAt = performance.now() / 1000;
          this.strategic.show('orders');
          this.tips.onDesk();
        },
      };
    if (near(hq.recruit, 2.4))
      return {
        key,
        text: 'Recruter des hommes',
        sub: RECRUITER_NAME[this.you],
        run: () => this.strategic.show('recruit'),
      };
    if (near(hq.armory, 2.6))
      return { key, text: 'Armurerie', sub: this.priv.upgrades.includes('armory') ? 'Armes et munitions' : 'Amélioration requise', run: () => this.strategic.show('armory') };
    // bâtiment neutre à vendre, ou logement suivant de l'ascension
    if (bid >= 0) {
      const def = BUILDINGS[bid];
      const st = this.pub.buildings[bid];
      const b = this.world.buildings[bid];
      const notMine = st.owner !== this.myFaction;
      // terminal de sécurité
      if (def.security && b.terminal && notMine && near(b.terminal, 2.2) && !this.pub.hacked?.includes(bid) && !this.priv.hack)
        return {
          key,
          text: 'Pirater la sécurité',
          sub: `${def.security >= 2 ? 'Caméras, tourelles et coffre' : 'Caméras'} — ${this.priv.upgrades.includes('hackers') ? '4 s' : '7 s'}`,
          run: () => this.app.net.act({ a: 'hack', b: bid }),
        };
      // coffre à braquer
      if (def.heist && b.vault && notMine && near(b.vault, 2.6) && !this.pub.heists?.some((h) => h.b === bid))
        return {
          key,
          text: def.heist.label,
          sub: `${formatMoney(def.heist.reward)} — ${def.heist.time} s près du coffre ; l’alarme préviendra la police`,
          run: () => this.app.net.act({ a: 'heist', b: bid }),
        };
      if (def.residence && st.owner === Faction.NEUTRAL && def.residence.boss === this.you && near(b.desk, 2.6)) {
        const tier = def.residence.tier;
        return {
          key,
          text: `Emménager ici — ${formatMoney(def.price)}`,
          sub: `${tierDef(tier).name} : ${tierDef(tier).perks.slice(0, 3).join(', ')}`,
          run: () => {
            this.app.net.act({ a: 'moveIn', b: bid });
          },
        };
      }
      if (def.capturable && !def.residence && st.owner === Faction.NEUTRAL && def.price > 0 && st.guards === 0)
        return {
          key,
          text: `Acheter ${leNom(def.name)} — ${formatMoney(def.price)}`,
          sub: `+${def.income} $/min`,
          run: () => {
            this.app.net.act({ a: 'buyBuilding', b: bid });
            audio.play('purchase');
          },
        };
      // bureau ennemi : un petit plaisir
      const ehq = this.world.buildings[this.pub.hq[this.you === 'dadou' ? 'even' : 'dadou']];
      if (ehq.desk && Math.hypot(ehq.desk.x - p.x, ehq.desk.z - p.z) < 2.3 && Math.abs(p.y - (ehq.desk.y ?? ehq.floorY)) < 1.6) {
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
    this.glass.restore();
    this.engines.stopAll();
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
    this.lightStream.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.overlay.remove();
    audio.playMusic('menu');
  }
}

export { formatTime };

/** Son du coup de feu selon l'arme. */
function shotSfx(w: Weapon): SfxName {
  switch (w) {
    case Weapon.SHOTGUN:
      return 'shotgun';
    case Weapon.RIFLE:
      return 'railgun';
    case Weapon.SMG:
      return 'smg';
    default:
      return 'pistol';
  }
}

/** Boucle moteur selon la catégorie de véhicule. */
function engineLoop(cls: VehicleClass): LoopName {
  switch (cls) {
    case 'moto':
      return 'engine_moto';
    case 'van':
    case 'truck':
      return 'engine_heavy';
    case 'vtol':
      return 'vtol';
    case 'drone':
      return 'drone';
    default:
      return 'engine_car';
  }
}

/** Bruit de pas selon le revêtement. */
function stepSfx(m: number): SfxName {
  const d = MATERIALS[m];
  if (!d) return 'footstep_concrete';
  switch (d.pattern) {
    case Pattern.CARPET:
    case Pattern.CLOTH:
      return 'footstep_carpet';
    case Pattern.PLANK:
    case Pattern.PARQUET:
    case Pattern.SLATS:
      return 'footstep_wood';
    case Pattern.METAL:
    case Pattern.METAL_PANEL:
    case Pattern.GRATE:
    case Pattern.HEX:
    case Pattern.CORRUGATED:
    case Pattern.SOLAR:
      return 'footstep_metal';
    case Pattern.MARBLE:
    case Pattern.ASHLAR:
    case Pattern.FLAGSTONE:
    case Pattern.COBBLE:
    case Pattern.CHECKER:
      return 'footstep_stone';
    default:
      return 'footstep_concrete';
  }
}
