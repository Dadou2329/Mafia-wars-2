// Implants du parrain local, côté client : touches (bras, capacités, vision), armes de bras,
// événements de déplacement (grappin, esquive, bond…) transmis au serveur, effets passifs
// (optique, assistance de visée, marqueur, conscience tactique, scanner, vision thermique),
// effets et sons des capacités de tous les personnages, état affiché par le HUD (cyberState).

import * as THREE from 'three';
import { ARM_WEAPON_IMPLANT, CharKind, FLAG, IMPLANT_ARM_WEAPON, Weapon, isArmWeapon } from '../../shared/characters';
import { armWeaponDef, FIST_CHARGE_TIME } from '../../shared/armWeapons';
import { CFX, cyberLook, emptyEquipment, IMPLANT_BY_ID, implantParams, parseCyberLook, SLOTS, type Equipment, type SlotId } from '../../shared/implants';
import { moveMods } from '../../shared/moveMods';
import type { GameEvent, PrivateState } from '../../shared/protocol';
import { angleDiff } from '../../shared/util';
import { audio } from '../audio/AudioEngine';
import { SFX_NAMES, type SfxName } from '../audio/types';
import type { Input } from '../input/input';
import { cyberState, implantControls, type AbilityView, type VisionMode } from './cyberState';
import type { ClientEnt } from './entities';
import type { GameClient } from './GameClient';
import type { MoveEvent } from './player';
import { rayCharacter } from './weapons';

type V3 = { x: number; y: number; z: number };

/** Effets visuels des capacités (moteur d'effets, branché par GameClient). */
export interface CyberFxApi {
  /** Effet visuel ET sonore d'une capacité (une seule fois par action). */
  play(ab: string, p: V3, p2?: V3 | null, opt?: { v?: number; targets?: V3[]; color?: number; local?: boolean; id?: number }): void;
  setGrapple(id: number, s: { from: THREE.Vector3; to: THREE.Vector3; phase: 'fire' | 'attached' | 'retract'; t: number } | null): void;
}

/** Surimpressions à l'écran (marques, menaces, visée du grappin…). */
export interface CyberOverlayApi {
  setMarks?(list: { id: number; x: number; y: number; z: number; label?: string }[]): void;
  setThreats?(dirs: number[]): void;
  setGrappleAim?(s: 'none' | 'ok' | 'far', dist?: number): void;
  setRange?(dist: number): void;
  setSpeed?(mps: number): void;
  setTints?(kinds: readonly Tint[]): void;
  setVision?(mode: VisionMode): void;
  scan?(origin: V3, radius: number, revealed?: { id: number; x: number; y: number; z: number; kind?: 'enemy' | 'turret' | 'camera' | 'terminal' | 'door' | 'objective' }[], dur?: number): void;
  flash?(kind: 'land' | 'emp' | 'break' | 'revive', strength?: number): void;
  clear?(): void;
}

type Tint = 'reflex' | 'overcharge' | 'camo' | 'secondWind';

/** Vue subjective : bras cybernétiques (branchée si le module de vue la propose). */
interface VmCyberApi {
  setCyber(look: string[]): void;
  setArmOut(side: 'L' | 'R' | null): void;
  armAction(side: 'L' | 'R', action: string): void;
  setMoveState(state: string, t?: number): void;
  launcherTip(side: 'L' | 'R'): THREE.Vector3;
}

/** Son de chaque capacité, et un son existant de repli tant qu'il manque. */
const SOUNDS: Record<string, [string, SfxName, number]> = {
  grappin: ['grapple_fire', 'swing', 0.9],
  'grappin-accroche': ['grapple_hit', 'hit_metal', 0.7],
  'grappin-fin': ['grapple_release', 'weapon_switch', 0.6],
  treuil: ['winch_yank', 'swing', 0.9],
  esquive: ['dash_whoosh', 'swing', 0.9],
  doubleSaut: ['jump_thrust', 'swing', 0.7],
  bond: ['leap_launch', 'swing', 1],
  'bond-charge': ['leap_charge', 'weapon_switch', 0.5],
  glissade: ['slide_start', 'footstep_concrete', 0.8],
  sautMural: ['jump_thrust', 'footstep_concrete', 0.7],
  escalade: ['mantle_grab', 'footstep_concrete', 0.6],
  atterrissage: ['land_heavy', 'footstep_concrete', 1],
  onde: ['ground_quake', 'explosion', 0.5],
  'bras-sortie': ['arm_deploy', 'weapon_switch', 0.8],
  'bras-rentre': ['arm_retract', 'weapon_switch', 0.6],
  lame: ['blade_slash', 'thermal_knife', 0.9],
  poing: ['fist_heavy', 'punch', 1],
  'poing-charge': ['fist_charge', 'weapon_switch', 0.6],
  fouet: ['whip_crack', 'swing', 0.9],
  bouclier: ['shield_up', 'hack_success', 0.7],
  'bouclier-impact': ['shield_hit', 'hit_metal', 0.6],
  'bouclier-brise': ['shield_break', 'glass_break', 0.8],
  'bouclier-fin': ['shield_down', 'ui_close', 0.5],
  repulseur: ['repulsor', 'explosion', 0.5],
  choc: ['shock_zap', 'stun_baton', 1],
  roquette: ['rocket_launch', 'swing', 0.8],
  scanner: ['scan_ping', 'hack_beep', 0.8],
  camouflage: ['camo_on', 'hack_success', 0.6],
  'camouflage-fin': ['camo_off', 'ui_close', 0.5],
  reflexes: ['reflex_on', 'hack_success', 0.7],
  surcharge: ['overcharge_on', 'hack_success', 0.7],
  secondSouffle: ['second_wind', 'heist_success', 0.7],
  nanobots: ['nano_heal', 'notify', 0.4],
  drone: ['drone_deploy', 'drone_pass', 0.7],
  piratage: ['tool_hack', 'hack_beep', 0.7],
  marque: ['mark_ping', 'ui_click', 0.5],
  vision: ['vision_on', 'ui_open', 0.5],
  'vision-fin': ['vision_off', 'ui_close', 0.5],
  menace: ['threat_warn', 'alert', 0.35],
};

const SFX_SET = new Set<string>(SFX_NAMES);

function sfx(kind: string, pos?: V3, vol = 1): void {
  const s = SOUNDS[kind];
  if (!s) return;
  const name = (SFX_SET.has(s[0]) ? s[0] : s[1]) as SfxName;
  audio.play(name, { pos, volume: s[2] * vol });
}

/** Implants dont la commande est une capacité affichée au HUD. */
function shownInHud(id: string): boolean {
  const def = IMPLANT_BY_ID[id];
  return !!def && (def.kind !== 'passive' || def.trigger === 'saut' || def.trigger === 'accroupi');
}

export class CyberClient {
  /** Apparence publique de mon parrain (vue à la 3e personne). */
  look: string[] = [];
  /** Bits d'effets visibles chez moi (prévus localement, confirmés par le serveur). */
  fx = 0;
  /** Dernière capacité déclenchée chez moi (gestes du personnage). */
  myAb: { kind: string; at: number; side?: 'L' | 'R'; x?: number; y?: number; z?: number } | undefined;
  fxApi: CyberFxApi | null = null;
  overlay: CyberOverlayApi | null = null;
  /** Multiplicateur du recul (assistance de visée). */
  recoilMul = 1;
  private equip: Equipment = emptyEquipment();
  private owned: Record<string, number> = {};
  private key = '';
  private controls: ReturnType<typeof implantControls> = [];
  /** Recharges : prévues localement, et annoncées par le serveur (instants de fin, s). */
  private localCd = new Map<string, number>();
  private serverCd = new Map<string, number>();
  private armOut: SlotId | null = null;
  private prevWeapon: Weapon = Weapon.PISTOL;
  private shieldHeld = false;
  private shieldUntil = 0;
  private camoUntil = 0;
  private reflexUntil = 0;
  private overUntil = 0;
  private scanUntil = 0;
  private scanRange = 0;
  private vision: VisionMode = 'normal';
  private marks = new Map<number, number>();
  private markSentAt = new Map<number, number>();
  private pingUntil = new Map<number, number>();
  private consciousAt = 0;
  private threatAt = 0;
  private passAcc = 0;
  private hudAcc = 0;
  private fistChargeAt = 0;
  /** Câbles de grappin des autres personnages : ancre et instant du tir. */
  private anchors = new Map<number, { x: number; y: number; z: number; at: number; travel: number }>();
  private myHook: { to: THREE.Vector3; at: number; travel: number; miss: boolean } | null = null;
  private slideLoop = false;
  private tintKey = '';
  private reviveUntil = 0;

  constructor(private gc: GameClient) {
    gc.player.onMove = (e) => this.onMove(e);
  }

  private get vm(): Partial<VmCyberApi> {
    return this.gc.viewmodel as unknown as Partial<VmCyberApi>;
  }

  private now(): number {
    return performance.now() / 1000;
  }

  /** Effet et son d'une capacité : par le moteur d'effets s'il est branché, sinon le son seul. */
  private play(kind: string, p: V3, p2?: V3 | null, opt?: { v?: number; targets?: V3[]; local?: boolean; id?: number }, vol = 1): void {
    if (this.fxApi) this.fxApi.play(kind, p, p2 ?? null, opt);
    else sfx(kind, p, vol);
  }

  private lv(id: string): number {
    for (const s of SLOTS) if (this.equip[s.id] === id) return this.owned[id] ?? 0;
    return 0;
  }

  /** Paramètre d'un implant installé (ou valeur par défaut). */
  param(id: string, key: string, dflt = 0): number {
    const l = this.lv(id);
    if (l <= 0) return dflt;
    return implantParams(id, l)[key] ?? dflt;
  }

  private cdMul(): number {
    return 1 - Math.min(0.35, this.param('accumulateur', 'cdr') + this.param('coprocesseur', 'cdr'));
  }

  reset(): void {
    this.key = '';
    this.localCd.clear();
    this.serverCd.clear();
    this.armOut = null;
    this.shieldHeld = false;
    this.shieldUntil = this.camoUntil = this.reflexUntil = this.overUntil = this.scanUntil = 0;
    this.marks.clear();
    this.anchors.clear();
    this.myHook = null;
    this.fistChargeAt = 0;
    this.tintKey = '';
    this.setVision('normal');
    this.overlay?.clear?.();
    cyberState.reset();
  }

  // ======================================================================= état du serveur

  onPriv(p: PrivateState): void {
    const cy = p.cyber;
    if (!cy) return;
    const key = JSON.stringify([cy.equip, cy.owned]);
    if (key !== this.key) {
      this.key = key;
      this.applyEquip(cy.equip, cy.owned);
    }
    const now = this.now();
    this.serverCd.clear();
    for (const [id, s] of Object.entries(cy.cd)) this.serverCd.set(id, now + s);
    cyberState.station = cy.station;
  }

  private applyEquip(equip: Equipment, owned: Record<string, number>): void {
    const gc = this.gc;
    this.equip = { ...equip };
    this.owned = { ...owned };
    this.look = cyberLook(this.equip, this.owned);
    gc.player.setMods(moveMods(this.equip, this.owned));
    this.controls = implantControls(this.equip);
    // armes de bras au niveau de l'implant
    for (const w of [Weapon.ARM_PISTOL, Weapon.ARM_BLADE, Weapon.ARM_FIST, Weapon.ARM_WHIP]) {
      const id = ARM_WEAPON_IMPLANT[w]!;
      const l = this.lv(id);
      if (l > 0) gc.weapons.stats.set(w, armWeaponDef(w, l));
      else gc.weapons.stats.delete(w);
    }
    if (this.armOut && IMPLANT_ARM_WEAPON[this.equip[this.armOut] ?? ''] === undefined) this.retract(false);
    // vision : l'implant correspondant a pu être retiré
    if (this.vision === 'thermal' && this.lv('thermique') <= 0) this.setVision('normal');
    if (this.vision === 'night' && this.lv('nocturne') <= 0) this.setVision('normal');
    // assistance de visée : recul et dispersion
    this.recoilMul = this.param('visee', 'recoil', 1);
    this.vm.setCyber?.(this.look);
  }

  // ======================================================================= commandes

  /** Touches des implants (appelé chaque image après la mise à jour du joueur). */
  update(dt: number, now: number, input: Input, blocked: boolean): void {
    const gc = this.gc;
    const p = gc.player;
    const can = !blocked && !p.dead && !p.drive;
    if (can) {
      for (const [action, slot] of [
        ['armLeft', 'brasG'],
        ['armRight', 'brasD'],
      ] as const) {
        const id = this.equip[slot];
        if (!id) continue;
        if (id === 'bouclier') {
          const held = input.is(action);
          if (held && !this.shieldHeld) this.shield(true, slot);
          else if (!held && this.shieldHeld) this.shield(false, slot);
        } else if (input.hit(action)) this.armPress(slot, id);
      }
      for (const c of this.controls) {
        if (!c.action || !c.action.startsWith('ability')) continue;
        if (input.hit(c.action)) this.activate(c.id);
      }
      if (input.hit('vision')) this.cycleVision();
    } else if (this.shieldHeld) this.shield(false, this.equip.brasG === 'bouclier' ? 'brasG' : 'brasD');
    // effets passifs et confirmations
    const t = now;
    p.speedMul = t < this.reflexUntil ? this.param('reflexes', 'speed', 1) : 1;
    gc.weapons.cooldownMul = t < this.reflexUntil ? 1 / this.param('reflexes', 'fire', 1) : 1;
    gc.weapons.spreadMul = this.param('visee', 'spread', 1) * (p.aiming ? this.param('zoom', 'steady', 1) : 1);
    p.aimZoom = this.param('zoom', 'zoom', 1);
    this.passAcc += dt;
    if (this.passAcc > 0.1) {
      this.passive(this.passAcc, t);
      this.passAcc = 0;
    }
    // bits visibles chez moi (vue à la 3e personne et bras)
    let fx = 0;
    if (p.grapple || p.hook) fx |= CFX.GRAPPLE;
    if (this.shieldHeld && t < this.shieldUntil) fx |= CFX.SHIELD;
    if (t < this.camoUntil) fx |= CFX.CAMO;
    if (this.armOut === 'brasG') fx |= CFX.ARM_L;
    if (this.armOut === 'brasD') fx |= CFX.ARM_R;
    if (this.fistChargeAt > 0) fx |= CFX.CHARGE;
    if (t < this.reflexUntil) fx |= CFX.REFLEX;
    if (t < this.overUntil) fx |= CFX.OVERCHARGE;
    if (t < this.scanUntil) fx |= CFX.SCAN;
    if (p.sprint && p.mods.sprint && p.energy > 0 && p.hspeed() > 7) fx |= CFX.SPRINT;
    this.fx = fx;
    // voiles d'écran des états actifs (étalonnage et surimpression)
    const tints: Tint[] = [];
    if (t < this.reflexUntil) tints.push('reflex');
    if (t < this.overUntil) tints.push('overcharge');
    if (t < this.camoUntil) tints.push('camo');
    if (t < this.reviveUntil) tints.push('secondWind');
    const tk = tints.join(',');
    if (tk !== this.tintKey) {
      this.tintKey = tk;
      (gc.post as unknown as { setTints?: (k: readonly Tint[]) => void }).setTints?.(tints);
      this.overlay?.setTints?.(tints);
    }
    // vue subjective : posture de déplacement
    this.vm.setMoveState?.(p.moveState());
    // mon câble de grappin
    this.updateMyCable(t);
    // bruit de glissade
    const sliding = p.mode === 'slide';
    if (sliding !== this.slideLoop) this.slideLoop = sliding;
    this.hudAcc += dt;
    if (this.hudAcc > 0.1) {
      this.hudAcc = 0;
      this.updateHudState(t);
    }
  }

  /** Touche d'un bras : grappin, arme de bras, capacité du bras. */
  private armPress(slot: SlotId, id: string): void {
    const gc = this.gc;
    const side: 'L' | 'R' = slot === 'brasG' ? 'L' : 'R';
    const def = IMPLANT_BY_ID[id];
    if (!def) return;
    if (id === 'grappin') {
      // treuil spinal : un ennemi dans la visée est attiré plutôt que le décor
      if (this.param('treuil', 'yank') > 0 && !gc.player.grapple && !gc.player.hook && this.ready('grappin')) {
        const tg = this.aimedEnemy(gc.player.mods.grapple?.range ?? 20);
        if (tg) {
          const { o, d } = gc.player.aimRay();
          gc.app.net.act({ a: 'ab', id: 'grappin', slot, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], target: tg.info.id });
          this.startLocalCd('grappin', this.param('grappin', 'cd', 5) * this.cdMul());
          gc.player.grappleReadyAt = gc.player.t + this.param('grappin', 'cd', 5) * this.cdMul();
          this.vm.armAction?.(side, 'grapple-fire');
          this.play('treuil', { x: tg.x, y: tg.y, z: tg.z }, gc.player.pos, { local: true });
          return;
        }
      }
      const r = gc.player.fireGrapple();
      if (r === 'cooldown') audio.play('ui_error', { volume: 0.25 });
      return;
    }
    if (def.kind === 'arme') {
      if (this.armOut === slot) this.retract(true);
      else this.deploy(slot, id);
      return;
    }
    if (id === 'grip') return;
    // capacités actives du bras : répulseur, arc électrique, micro-roquettes, bras tactique
    if (!this.ready(id)) {
      audio.play('ui_error', { volume: 0.25 });
      return;
    }
    const { o, d } = gc.player.aimRay();
    const w = gc.world.world;
    let dist = w.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 90);
    if (dist < 0) dist = 90;
    const pt = o.clone().addScaledVector(d, dist);
    const tg = this.aimedEnemy(id === 'roquettes' ? 90 : id === 'choc' ? this.param('choc', 'range', 8) + 1 : 40);
    gc.app.net.act({ a: 'ab', id, slot, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], p: [pt.x, pt.y, pt.z], target: tg?.info.id });
    const cd = id === 'outils' ? 3 : this.param(id, 'cd', 8) * this.cdMul();
    this.startLocalCd(id, cd);
    const action = id === 'repulseur' ? 'repulse' : id === 'choc' ? 'shock' : id === 'roquettes' ? 'rockets' : 'hack';
    this.vm.armAction?.(side, action);
    this.myAb = { kind: id, at: this.now(), side, x: pt.x, y: pt.y, z: pt.z };
  }

  /** Sortir une arme de bras (l'arme tenue est rangée). */
  private deploy(slot: SlotId, id: string): void {
    const gc = this.gc;
    const w = IMPLANT_ARM_WEAPON[id];
    if (w === undefined) return;
    if (this.armOut) this.retract(false);
    if (!isArmWeapon(gc.weapons.current)) this.prevWeapon = gc.weapons.current;
    this.armOut = slot;
    gc.weapons.current = w;
    gc.weapons.reloadUntil = 0;
    // sortie de l'arme : plus rapide avec le coprocesseur
    const t = this.now();
    gc.weapons.nextFireAt = Math.max(gc.weapons.nextFireAt, t + 0.3 / this.param('coprocesseur', 'deploy', 1));
    if (w === Weapon.ARM_PISTOL && (gc.weapons.mag.get(w) ?? 0) <= 0) gc.weapons.mag.set(w, gc.weapons.def(w).magazine);
    gc.app.net.act({ a: 'ab', id: 'bras', slot });
    const side = slot === 'brasG' ? 'L' : 'R';
    this.vm.setArmOut?.(side);
    this.play('bras-sortie', this.forearm(side), null, { v: side === 'L' ? 0 : 1, local: true });
    this.myAb = { kind: 'bras-sortie', at: t, side };
  }

  /** Rentrer l'arme de bras (on reprend l'arme d'avant). */
  retract(send: boolean): void {
    const gc = this.gc;
    const slot = this.armOut;
    if (!slot) return;
    this.armOut = null;
    this.fistChargeAt = 0;
    if (isArmWeapon(gc.weapons.current)) gc.weapons.current = gc.weapons.owned.includes(this.prevWeapon) ? this.prevWeapon : Weapon.FISTS;
    if (send) {
      gc.app.net.act({ a: 'ab', id: 'bras', slot });
      const side = slot === 'brasG' ? 'L' : 'R';
      this.play('bras-rentre', this.forearm(side), null, { v: side === 'L' ? 0 : 1, local: true });
    }
    this.vm.setArmOut?.(null);
  }

  /** Le joueur a choisi une arme ordinaire : l'arme de bras rentre. */
  onWeaponSelected(): void {
    if (this.armOut && !isArmWeapon(this.gc.weapons.current)) {
      const w = this.gc.weapons.current;
      this.retract(true);
      this.gc.weapons.current = w;
    }
  }

  private shield(on: boolean, slot: SlotId): void {
    const gc = this.gc;
    const side: 'L' | 'R' = slot === 'brasG' ? 'L' : 'R';
    if (on) {
      if (!this.ready('bouclier')) {
        audio.play('ui_error', { volume: 0.25 });
        this.shieldHeld = true; // attend le relâchement
        this.shieldUntil = 0;
        return;
      }
      this.shieldHeld = true;
      this.shieldUntil = this.now() + this.param('bouclier', 'dur', 3);
      gc.app.net.act({ a: 'ab', id: 'bouclier', slot, on: true });
      this.vm.armAction?.(side, 'shield-on');
    } else {
      this.shieldHeld = false;
      if (this.shieldUntil > 0) {
        gc.app.net.act({ a: 'ab', id: 'bouclier', slot, on: false });
        this.vm.armAction?.(side, 'shield-off');
        this.startLocalCd('bouclier', this.param('bouclier', 'cd', 10) * this.cdMul());
      }
      this.shieldUntil = 0;
    }
  }

  /** Touche de capacité : surcharge, scanner, camouflage, réflexes, drone de combat. */
  private activate(id: string): void {
    if (!this.ready(id)) {
      audio.play('ui_error', { volume: 0.25 });
      return;
    }
    this.gc.app.net.act({ a: 'ab', id });
    this.startLocalCd(id, this.param(id, 'cd', 20) * this.cdMul());
  }

  private cycleVision(): void {
    const modes: VisionMode[] = ['normal'];
    if (this.lv('thermique') > 0) modes.push('thermal');
    if (this.lv('nocturne') > 0) modes.push('night');
    if (modes.length === 1) return;
    const next = modes[(modes.indexOf(this.vision) + 1) % modes.length];
    this.setVision(next);
    sfx(next === 'normal' ? 'vision-fin' : 'vision', undefined, 1);
  }

  private setVision(mode: VisionMode): void {
    this.vision = mode;
    cyberState.vision = mode;
    const post = this.gc.post as unknown as { setVision?: (m: VisionMode, a?: number) => void; setNightGain?: (g: number) => void };
    post.setVision?.(mode, 1);
    if (mode === 'night') post.setNightGain?.(this.param('nocturne', 'gain', 3));
    this.overlay?.setVision?.(mode);
    const chars = this.gc.chars as unknown as { setVision?: (m: VisionMode) => void };
    chars.setVision?.(mode);
  }

  get visionMode(): VisionMode {
    return this.vision;
  }

  /** Coup de poing hydraulique : début de charge (clic maintenu). */
  fistPress(): void {
    if (this.param('poing', 'charge') <= 0) return;
    this.fistChargeAt = this.now();
    this.gc.app.net.act({ a: 'ab', id: 'poing-charge', on: true });
    this.vm.armAction?.(this.armOut === 'brasG' ? 'L' : 'R', 'charge-start');
    this.play('poing-charge', this.forearm(this.armOut === 'brasG' ? 'L' : 'R'), null, { local: true });
  }

  /** Fin de charge : renvoie la charge (0..1) ; le coup part par la voie normale. */
  fistRelease(): number {
    if (this.fistChargeAt <= 0) return 0;
    const frac = Math.min(1, (this.now() - this.fistChargeAt) / FIST_CHARGE_TIME);
    this.fistChargeAt = 0;
    this.vm.armAction?.(this.armOut === 'brasG' ? 'L' : 'R', 'charge-release');
    return frac;
  }

  get fistCharging(): boolean {
    return this.fistChargeAt > 0;
  }

  /** Fente de la lame (clic droit) : bond sur l'ennemi visé. Renvoie la cible, ou null. */
  bladeLunge(): ClientEnt | null {
    const lunge = this.param('lame', 'lunge');
    if (lunge <= 0 || !this.ready('lame')) return null;
    const tg = this.aimedEnemy(lunge + 1);
    if (!tg) return null;
    const p = this.gc.player;
    const dx = tg.x - p.pos.x;
    const dz = tg.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2) return tg;
    this.gc.app.net.act({ a: 'ab', id: 'lame', target: tg.info.id });
    this.startLocalCd('lame', 2.5);
    // élan vers la cible : comme une esquive, au plus près
    p.impulse(((dx / d) * Math.min(26, (d - 1) * 5)) - p.vel.x, 1.5, ((dz / d) * Math.min(26, (d - 1) * 5)) - p.vel.z);
    this.play('esquive', p.pos, { x: tg.x, y: tg.y, z: tg.z }, { local: true });
    return tg;
  }

  /** Assistance de visée : la direction du tir s'aimante vers l'ennemi le plus proche du réticule. */
  aimAssist(o: THREE.Vector3, d: THREE.Vector3, range: number): THREE.Vector3 {
    const mag = this.param('visee', 'magnet');
    if (mag <= 0) return d;
    let best: THREE.Vector3 | null = null;
    let bestA = mag * 0.06;
    for (const e of this.gc.store.alive()) {
      if (!this.isEnemy(e)) continue;
      const tgt = new THREE.Vector3(e.x, e.y + 1.3, e.z).sub(o);
      const dist = tgt.length();
      if (dist > range || dist < 1) continue;
      tgt.divideScalar(dist);
      const a = Math.acos(Math.min(1, Math.max(-1, tgt.dot(d))));
      if (a < bestA && this.gc.world.world.lineOfSight(o.x, o.y, o.z, e.x, e.y + 1.3, e.z)) {
        bestA = a;
        best = tgt;
      }
    }
    return best ? d.clone().lerp(best, 0.7).normalize() : d;
  }

  // ======================================================================= recharges

  private startLocalCd(id: string, cd: number): void {
    this.localCd.set(id, this.now() + cd);
  }

  /** Recharge restante (s) : la prévision locale juste après l'appui, sinon le serveur. */
  private cdLeft(id: string): number {
    const t = this.now();
    const local = this.localCd.get(id) ?? 0;
    const server = this.serverCd.get(id) ?? 0;
    // juste après un appui, le serveur n'a pas encore répondu : on garde la prévision
    const v = local > t && local - t > (this.param(id, 'cd', 0) * this.cdMul()) - 0.8 ? local : Math.max(server, local - 0.3 > t ? local : 0);
    return Math.max(0, v - t);
  }

  private ready(id: string): boolean {
    return this.cdLeft(id) <= 0.05;
  }

  // ======================================================================= effets passifs

  private isEnemy(e: ClientEnt): boolean {
    const gc = this.gc;
    if (!e.alive || e.info.id === gc.selfId || e.flags & FLAG.HIDDEN) return false;
    const k = e.info.kind;
    if (k === CharKind.VEHICLE || k === CharKind.BARMAN || k === CharKind.CIVILIAN || k === CharKind.CIVILIAN_F) return false;
    if (e.info.faction === gc.myFaction) return false;
    if (k === CharKind.POLICE) return gc.priv.wanted > 0;
    return true;
  }

  /** Ennemi sous le réticule, à portée. */
  private aimedEnemy(range: number): ClientEnt | null {
    const { o, d } = this.gc.player.aimRay();
    let best: ClientEnt | null = null;
    let bt = range;
    for (const e of this.gc.store.alive()) {
      if (!this.isEnemy(e)) continue;
      if (Math.abs(e.x - o.x) > range + 3 || Math.abs(e.z - o.z) > range + 3) continue;
      const r = rayCharacter(o, d, e, bt);
      if (r) {
        best = e;
        bt = r.t;
      }
    }
    if (best && this.gc.world.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, bt) >= 0) return null;
    // tolérance : un ennemi tout près du réticule
    if (!best) {
      let ba = 0.05;
      for (const e of this.gc.store.alive()) {
        if (!this.isEnemy(e)) continue;
        const v = new THREE.Vector3(e.x, e.y + 1.2, e.z).sub(o);
        const dist = v.length();
        if (dist > range) continue;
        const a = Math.acos(Math.min(1, v.dot(d) / dist));
        if (a < ba && this.gc.world.world.lineOfSight(o.x, o.y, o.z, e.x, e.y + 1.2, e.z)) {
          ba = a;
          best = e;
        }
      }
    }
    return best;
  }

  /** Marqueur, conscience tactique, scanner, vision thermique à travers les murs (10 fois par s). */
  private passive(dt: number, t: number): void {
    const gc = this.gc;
    const me = gc.player.pos;
    const marks: { id: number; x: number; y: number; z: number; label?: string }[] = [];
    // marqueur de cibles : l'ennemi visé est marqué (et signalé à vos hommes)
    const mr = this.param('marqueur', 'range');
    if (mr > 0) {
      const tg = this.aimedEnemy(mr);
      if (tg) {
        const persist = this.param('marqueur', 'persist');
        this.marks.set(tg.info.id, t + 1.2 + persist);
        if (t - (this.markSentAt.get(tg.info.id) ?? -10) > 1.5) {
          this.markSentAt.set(tg.info.id, t);
          gc.app.net.act({ a: 'ab', id: 'marque', target: tg.info.id });
          if (!this.pingUntil.has(tg.info.id)) sfx('marque', undefined, 0.6);
          this.pingUntil.set(tg.info.id, t + 2);
        }
      }
    }
    // conscience tactique : impulsions régulières, alerte quand on vous vise
    const cr = this.param('conscience', 'range');
    const threats: number[] = [];
    if (cr > 0) {
      const period = this.param('conscience', 'period', 4);
      const pulse = t - this.consciousAt >= period;
      if (pulse) this.consciousAt = t;
      const warn = this.param('conscience', 'warn') > 0;
      for (const e of gc.store.alive()) {
        if (!this.isEnemy(e)) continue;
        const dx = me.x - e.x;
        const dz = me.z - e.z;
        const d = Math.hypot(dx, dz);
        if (d > cr) continue;
        if (pulse) this.pingUntil.set(e.info.id, t + 1.6);
        if (warn && e.flags & FLAG.AIM && Math.abs(angleDiff(e.view.yaw, Math.atan2(dx, dz))) < 0.14) threats.push(Math.atan2(e.x - me.x, e.z - me.z) - gc.player.yaw);
      }
      if (threats.length > 0 && t - this.threatAt > 2.5) {
        this.threatAt = t;
        sfx('menace');
      }
    }
    this.overlay?.setThreats?.(threats);
    // scanner : tous les ennemis à portée sont révélés pendant l'impulsion
    const xray = new Set<number>();
    if (t < this.scanUntil) {
      for (const e of gc.store.alive()) if (this.isEnemy(e) && Math.hypot(e.x - me.x, e.z - me.z) < this.scanRange) {
        xray.add(e.info.id);
        this.pingUntil.set(e.info.id, Math.max(this.pingUntil.get(e.info.id) ?? 0, t + 0.3));
      }
    }
    // vision thermique : silhouettes chaudes à travers les murs ; nocturne : ennemis détourés
    const walls = this.vision === 'thermal' ? this.param('thermique', 'walls') : this.vision === 'night' && this.param('nocturne', 'outline') > 0 ? 25 : 0;
    if (walls > 0) for (const e of gc.store.alive()) if (this.isEnemy(e) && Math.hypot(e.x - me.x, e.z - me.z) < walls) xray.add(e.info.id);
    const chars = gc.chars as unknown as { setXray?: (ids: Set<number> | null) => void };
    chars.setXray?.(xray.size > 0 ? xray : null);
    // marques affichées : marqueur, impulsions, scanner ; analyseur : implants du parrain adverse
    const reveal = this.param('analyseur', 'implants') > 0;
    for (const [id, until] of this.marks) if (until < t) this.marks.delete(id);
    for (const [id, until] of this.pingUntil) if (until < t) this.pingUntil.delete(id);
    const shown = new Set<number>([...this.marks.keys(), ...this.pingUntil.keys()]);
    for (const id of shown) {
      const e = gc.store.ents.get(id);
      if (!e || !e.alive) continue;
      let label: string | undefined;
      if (reveal && (e.info.kind === CharKind.BOSS_DADOU || e.info.kind === CharKind.BOSS_EVEN)) {
        label = parseCyberLook(e.info.cyber)
          .map((x) => `${IMPLANT_BY_ID[x.id]?.name ?? x.id} ${x.level}`)
          .join(' · ');
      }
      marks.push({ id, x: e.x, y: e.y + 2.1, z: e.z, label });
    }
    this.overlay?.setMarks?.(marks);
    this.overlay?.setSpeed?.(gc.player.hspeed());
    // visée du grappin : point accrochable à portée ?
    const g = gc.player.mods.grapple;
    if (g && !gc.player.grapple && !gc.player.hook && !gc.player.drive) {
      const { o, d } = gc.player.aimRay();
      const dist = gc.world.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, g.range * 1.6, undefined, 'solid');
      this.overlay?.setGrappleAim?.(dist < 0 ? 'none' : dist <= g.range ? 'ok' : 'far', dist);
    } else this.overlay?.setGrappleAim?.('none');
    // télémètre de l'optique télescopique : distance du point visé, en visant
    if (gc.player.aiming && this.param('zoom', 'range') > 0) {
      const { o, d } = gc.player.aimRay();
      this.overlay?.setRange?.(gc.world.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 300));
    } else this.overlay?.setRange?.(-1);
    void dt;
  }

  // ======================================================================= déplacements

  /** Événements de déplacement du joueur : transmis au serveur, effets et sons immédiats. */
  private onMove(e: MoveEvent): void {
    const gc = this.gc;
    const net = gc.app.net;
    const p = { x: e.x, y: e.y, z: e.z };
    const p2 = e.x2 !== undefined ? { x: e.x2, y: e.y2 ?? e.y, z: e.z2 ?? e.z } : null;
    const now = this.now();
    const side: 'L' | 'R' = gc.player.mods.grapple?.side ?? 'L';
    switch (e.k) {
      case 'airJump':
        net.act({ a: 'ab', id: 'doubleSaut' });
        this.local('doubleSaut', p, null);
        break;
      case 'wallJump':
        net.act({ a: 'ab', id: 'sautMural', p: p2 ? [p2.x, p2.y, p2.z] : undefined });
        this.local('sautMural', { x: p.x, y: p.y + 1, z: p.z }, p2);
        break;
      case 'leapCharge':
        this.play('bond-charge', p, null, { local: true });
        break;
      case 'leap':
        net.act({ a: 'ab', id: 'bond', v: e.v, p: p2 ? [p2.x, p2.y, p2.z] : undefined });
        this.local('bond', p, p2, e.v);
        this.startLocalCd('bond', gc.player.mods.leap?.cd ?? 5);
        break;
      case 'dash':
        net.act({ a: 'ab', id: 'esquive', p: p2 ? [p2.x, p2.y, p2.z] : undefined });
        this.local('esquive', { x: p.x, y: p.y + 0.9, z: p.z }, p2 ? { x: p2.x, y: p2.y + 0.9, z: p2.z } : null);
        break;
      case 'slide':
        net.act({ a: 'ab', id: 'glissade', p: p2 ? [p2.x, p2.y, p2.z] : undefined });
        this.local('glissade', p, p2);
        break;
      case 'mantle':
      case 'climb':
        this.play('escalade', p, null, { local: true });
        break;
      case 'land':
        if ((e.v ?? 0) > 13) {
          const k = Math.min(1, ((e.v ?? 0) - 10) / 16);
          this.play('atterrissage', p, null, { v: k, local: true }, Math.min(1, ((e.v ?? 0) - 10) / 14));
          this.overlay?.flash?.('land', k);
        }
        break;
      case 'grappleFire':
      case 'grappleMiss': {
        const to = new THREE.Vector3(e.x2 ?? e.x, e.y2 ?? e.y, e.z2 ?? e.z);
        this.myHook = { to, at: now, travel: e.v ?? 0.3, miss: e.k === 'grappleMiss' };
        if (e.k === 'grappleFire') {
          const { o, d } = gc.player.aimRay();
          net.act({ a: 'ab', id: 'grappin', slot: side === 'L' ? 'brasG' : 'brasD', o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], p: [to.x, to.y, to.z] });
          this.startLocalCd('grappin', gc.player.mods.grapple?.cd ?? 5);
        }
        this.play('grappin', p, to, { local: true });
        this.vm.armAction?.(side, 'grapple-fire');
        this.myAb = { kind: 'grappin', at: now, side, x: to.x, y: to.y, z: to.z };
        break;
      }
      case 'grappleAttach':
        // le moteur d'effets joue l'accroche quand le câble passe en « accroché »
        if (!this.fxApi) sfx('grappin-accroche', p2 ?? p);
        break;
      case 'grappleRelease':
        net.act({ a: 'ab', id: 'grappin-fin' });
        this.play('grappin-fin', p, null, { local: true }, 0.8);
        this.vm.armAction?.(side, 'grapple-release');
        if (this.myHook) this.myHook = { ...this.myHook, miss: true, at: now - this.myHook.travel };
        this.myAb = { kind: 'grappin-fin', at: now, side };
        break;
      default:
        break;
    }
  }

  /** Effet et son d'une action locale (les autres les verront par le serveur). */
  private local(kind: string, p: V3, p2: V3 | null, v?: number): void {
    this.play(kind, p, p2, { v, local: true });
    this.myAb = { kind, at: this.now(), x: p2?.x, y: p2?.y, z: p2?.z };
  }

  /** Avant-bras du parrain local (vue subjective ou personnage), pour les effets des bras. */
  private forearm(side: 'L' | 'R'): V3 {
    const gc = this.gc;
    const h = (gc.chars as unknown as { handOf?: (id: number, s: 'L' | 'R') => THREE.Vector3 | null }).handOf?.call(gc.chars, gc.selfId, side);
    if (h && !gc.player.firstPerson) return h;
    if (gc.player.firstPerson && this.vm.launcherTip) return this.vm.launcherTip(side);
    return gc.player.handPos();
  }

  /** Câble de mon grappin : de la main (vue subjective ou personnage) à l'ancre. */
  private updateMyCable(t: number): void {
    const fx = this.fxApi;
    if (!fx) return;
    const gc = this.gc;
    const p = gc.player;
    const side: 'L' | 'R' = p.mods.grapple?.side ?? 'L';
    const from = p.firstPerson && this.vm.launcherTip ? this.vm.launcherTip(side) : (gc.chars as unknown as { handOf?: (id: number, s: 'L' | 'R') => THREE.Vector3 | null }).handOf?.(gc.selfId, side) ?? p.handPos();
    if (p.grapple) {
      fx.setGrapple(gc.selfId, { from, to: p.grapple.anchor, phase: 'attached', t: p.grapple.t });
      return;
    }
    const h = this.myHook;
    if (!h) return fx.setGrapple(gc.selfId, null);
    const el = t - h.at;
    if (!h.miss && el < h.travel) fx.setGrapple(gc.selfId, { from, to: h.to, phase: 'fire', t: el / Math.max(0.01, h.travel) });
    else if (el < h.travel + 0.35) fx.setGrapple(gc.selfId, { from, to: h.to, phase: 'retract', t: Math.min(1, (el - h.travel) / 0.35) });
    else {
      this.myHook = null;
      fx.setGrapple(gc.selfId, null);
    }
  }

  // ======================================================================= événements

  onEvent(e: GameEvent): void {
    const gc = this.gc;
    if (e.t === 'cyber') {
      gc.store.setCyber(e.id, e.cyber);
      return;
    }
    if (e.t !== 'ab') return;
    const now = this.now();
    const mine = e.id === gc.selfId;
    const p = { x: e.x, y: e.y, z: e.z };
    const p2 = e.x2 !== undefined ? { x: e.x2, y: e.y2 ?? e.y, z: e.z2 ?? e.z } : null;
    // effet subi : projection et étourdissement (répulseur, poing, treuil…)
    if (e.ab === 'pousse') {
      if (mine) {
        gc.player.impulse(e.x2 ?? 0, e.y2 ?? 0, e.z2 ?? 0);
        if ((e.v ?? 0) > 0) gc.player.stunUntil = gc.player.t + (e.v ?? 0);
        gc.player.shake = Math.min(3, gc.player.shake + 1.2);
      }
      return;
    }
    // confirmations des capacités du parrain local
    if (mine) {
      switch (e.ab) {
        case 'reflexes':
          this.reflexUntil = now + (e.v ?? 5);
          break;
        case 'surcharge':
          this.overUntil = now + (e.v ?? 4);
          break;
        case 'camouflage':
          this.camoUntil = now + (e.v ?? 5);
          break;
        case 'camouflage-fin':
          this.camoUntil = 0;
          break;
        case 'scanner': {
          this.scanUntil = now + this.param('scanner', 'dur', 6);
          this.scanRange = e.v ?? 25;
          const me = gc.player.pos;
          const revealed = [...gc.store.alive()]
            .filter((x) => this.isEnemy(x) && Math.hypot(x.x - me.x, x.z - me.z) < this.scanRange)
            .map((x) => ({ id: x.info.id, x: x.x, y: x.y + 1, z: x.z, kind: x.info.kind === CharKind.TURRET ? ('turret' as const) : ('enemy' as const) }));
          this.overlay?.scan?.(p, this.scanRange, revealed, this.param('scanner', 'dur', 6));
          break;
        }
        case 'bouclier-brise':
          this.shieldUntil = 0;
          this.overlay?.flash?.('break', 0.8);
          break;
        case 'bouclier-fin':
          this.shieldUntil = 0;
          break;
        case 'secondSouffle':
          gc.player.shake = Math.min(3, gc.player.shake + 1);
          this.reviveUntil = now + (e.v ?? 2);
          this.overlay?.flash?.('revive', 1);
          break;

      }
      // déjà joués à l'appui (prévision locale)
      if (['doubleSaut', 'sautMural', 'bond', 'esquive', 'glissade', 'grappin', 'grappin-fin', 'escalade', 'atterrissage', 'bras-sortie', 'bras-rentre'].includes(e.ab)) return;
    }
    // frappé par une impulsion électromagnétique
    if (e.ab === 'choc' && (e.v ?? 0) >= 1 && (e.targets ?? []).includes(gc.selfId)) this.overlay?.flash?.('emp', 1);
    // positions des cibles (arc électrique, fouet…)
    const targets: V3[] = [];
    for (const id of e.targets ?? []) {
      const t = gc.store.ents.get(id);
      if (t) targets.push({ x: t.x, y: t.y + 1.2, z: t.z });
    }
    this.play(e.ab, p, p2, { v: e.v, targets, id: e.id }, mine ? 1 : 0.9);
    // geste du personnage (bras utilisé, cible)
    const ent = gc.store.ents.get(e.id);
    const side: 'L' | 'R' | undefined = e.ab === 'bras-sortie' || e.ab === 'bras-rentre' ? ((e.v ?? 1) === 0 ? 'L' : 'R') : undefined;
    const ab = { kind: e.ab, at: now, side, x: p2?.x, y: p2?.y, z: p2?.z };
    if (mine) this.myAb = ab;
    else if (ent) ent.view.ab = ab;
    // câbles de grappin des autres
    if (!mine && e.ab === 'grappin' && p2) this.anchors.set(e.id, { ...p2, at: now, travel: e.v ?? 0.3 });
    if (!mine && e.ab === 'grappin-fin') {
      const a = this.anchors.get(e.id);
      if (a) a.at = -Math.abs(now);
    }
  }

  /** Câbles des autres parrains (à chaque image). */
  updateRemoteCables(): void {
    const fx = this.fxApi;
    if (!fx) return;
    const gc = this.gc;
    const now = this.now();
    const handOf = (gc.chars as unknown as { handOf?: (id: number, s: 'L' | 'R') => THREE.Vector3 | null }).handOf;
    for (const [id, a] of this.anchors) {
      const ent = gc.store.ents.get(id);
      const attached = !!ent && ent.alive && ((ent.view.fx ?? 0) & CFX.GRAPPLE) !== 0 && a.at > 0;
      const side: 'L' | 'R' = parseCyberLook(ent?.info.cyber).some((x) => x.slot === 'brasD' && x.id === 'grappin') ? 'R' : 'L';
      const from = (ent && handOf?.call(gc.chars, id, side)) ?? (ent ? new THREE.Vector3(ent.x, ent.y + 1.35, ent.z) : null);
      const to = new THREE.Vector3(a.x, a.y, a.z);
      if (!from) {
        this.anchors.delete(id);
        fx.setGrapple(id, null);
        continue;
      }
      const el = now - a.at;
      if (attached && el < a.travel) fx.setGrapple(id, { from, to, phase: 'fire', t: el / Math.max(0.01, a.travel) });
      else if (attached) fx.setGrapple(id, { from, to, phase: 'attached', t: el });
      else {
        // relâché : le câble revient en un instant
        if (a.at > 0) a.at = -now;
        const rel = now + a.at;
        if (rel < 0.35) fx.setGrapple(id, { from, to, phase: 'retract', t: rel / 0.35 });
        else {
          this.anchors.delete(id);
          fx.setGrapple(id, null);
        }
      }
    }
  }

  // ======================================================================= HUD

  private updateHudState(t: number): void {
    const gc = this.gc;
    const p = gc.player;
    const out: AbilityView[] = [];
    for (const c of this.controls) {
      if (!shownInHud(c.id)) continue;
      const def = IMPLANT_BY_ID[c.id];
      let cd = this.cdLeft(c.id);
      let cdMax = this.param(c.id, 'cd', 0) * this.cdMul();
      let charges = -1;
      let chargesMax = -1;
      let active = false;
      if (c.id === 'esquive') {
        charges = p.dashCharges;
        chargesMax = p.mods.dash?.charges ?? 0;
        cd = charges < chargesMax ? Math.max(0, p.dashNextAt - p.t) : 0;
        cdMax = p.mods.dash?.cd ?? 3;
      } else if (c.id === 'bond') {
        cd = Math.max(0, p.leapReadyAt - p.t);
        active = p.leapCharge > 0;
      } else if (c.id === 'grappin') {
        cd = Math.max(0, p.grappleReadyAt - p.t);
        active = !!p.grapple;
      } else if (c.id === 'bouclier') active = this.shieldHeld && t < this.shieldUntil;
      else if (c.id === 'camouflage') active = t < this.camoUntil;
      else if (c.id === 'reflexes') active = t < this.reflexUntil;
      else if (c.id === 'surcharge') active = t < this.overUntil;
      else if (c.id === 'scanner') active = t < this.scanUntil;
      else if (c.id === 'thermique') active = this.vision === 'thermal';
      else if (c.id === 'nocturne') active = this.vision === 'night';
      const v: AbilityView = { id: c.id, action: c.action, hint: c.hint || undefined, cd, cdMax, charges, chargesMax, active };
      if (def?.kind === 'arme') {
        v.out = this.armOut === c.slot;
        v.active = v.out;
        if (c.id === 'pistoletBras') {
          v.ammo = gc.weapons.mag.get(Weapon.ARM_PISTOL) ?? 0;
          v.ammoMax = gc.weapons.def(Weapon.ARM_PISTOL).magazine;
        }
      }
      out.push(v);
    }
    cyberState.abilities = out;
    cyberState.energy = p.mods.sprint ? p.energy : -1;
    const absorb = this.param('bouclier', 'absorb');
    cyberState.shieldMax = absorb;
    cyberState.shield = this.shieldHeld && t < this.shieldUntil ? absorb : 0;
    cyberState.at = t;
  }
}
