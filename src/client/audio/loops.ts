/**
 * Sons continus (`audio.loop()`) : moteurs de véhicules, ADAV, drones,
 * alarmes, sirènes. Chaque boucle coûte quelques nœuds seulement :
 *   source tampon en boucle → passe-bas → gain → [panoramique 3D] → bus des effets
 *                                          └→ envoi de réverbération
 * Le régime (`pitch`) agit sur la vitesse de lecture (hauteur ET cadence du
 * moteur), ouvre le filtre et monte un peu le niveau. Le gestionnaire applique
 * à chaque image l'absorption de l'air, l'étouffement quand l'auditeur est à
 * l'intérieur ou sous terre, un effet Doppler tiré de la vitesse radiale, et
 * déconnecte les boucles hors de portée. Les nœuds d'une boucle arrêtée sont
 * libérés à la fin de son fondu.
 *
 * Une poignée créée avant le déverrouillage (ou avant que son tampon soit
 * généré) reste « en attente » et démarre d'elle-même dès que possible.
 */
import { clamp } from './dsp';
import type { AudioResources } from './resources';
import { biquad, chain, gainNode } from './synth';
import type { LoopHandle, LoopName, LoopOptions, Vec3Like } from './types';

interface LoopDef {
  /** Gain linéaire de base. */
  gain: number;
  /** Profil de distance du panoramique (modèle inverse). */
  ref: number; rolloff: number;
  /** Au-delà (m), la boucle est déconnectée (ne coûte plus rien). */
  cull: number;
  /** Envoi de réverbération. */
  send: number;
  /** Source extérieure : étouffée quand l'auditeur est à l'intérieur ou dans le métro. */
  outdoor: boolean;
  /** Effet Doppler d'après la vitesse radiale. */
  doppler: boolean;
  /** Coupure du passe-bas au régime 1 et exposant (le son s'éclaircit avec le régime). */
  cutoff: number; cutoffSlope: number;
  /** Gain relatif ajouté par unité de régime au-dessus de 1. */
  gainSlope: number;
  pitchMin: number; pitchMax: number;
}

const DEFS: Record<LoopName, LoopDef> = {
  engine_car: { gain: 0.36, ref: 4, rolloff: 1, cull: 140, send: 0.12, outdoor: true, doppler: true, cutoff: 1800, cutoffSlope: 1.2, gainSlope: 0.35, pitchMin: 0.5, pitchMax: 3 },
  engine_moto: { gain: 0.36, ref: 4, rolloff: 1, cull: 150, send: 0.12, outdoor: true, doppler: true, cutoff: 2200, cutoffSlope: 1.1, gainSlope: 0.4, pitchMin: 0.5, pitchMax: 3 },
  engine_heavy: { gain: 0.45, ref: 6, rolloff: 0.9, cull: 180, send: 0.15, outdoor: true, doppler: true, cutoff: 1400, cutoffSlope: 1.0, gainSlope: 0.3, pitchMin: 0.5, pitchMax: 3 },
  vtol: { gain: 0.5, ref: 10, rolloff: 0.8, cull: 350, send: 0.2, outdoor: true, doppler: true, cutoff: 5000, cutoffSlope: 0.6, gainSlope: 0.3, pitchMin: 0.5, pitchMax: 2.5 },
  drone: { gain: 0.32, ref: 2.5, rolloff: 1.1, cull: 80, send: 0.08, outdoor: true, doppler: true, cutoff: 3500, cutoffSlope: 0.8, gainSlope: 0.25, pitchMin: 0.5, pitchMax: 2.5 },
  alarm: { gain: 0.3, ref: 6, rolloff: 0.8, cull: 220, send: 0.35, outdoor: false, doppler: false, cutoff: 9000, cutoffSlope: 0, gainSlope: 0, pitchMin: 0.5, pitchMax: 2 },
  siren: { gain: 0.4, ref: 10, rolloff: 0.7, cull: 400, send: 0.35, outdoor: true, doppler: true, cutoff: 9000, cutoffSlope: 0, gainSlope: 0, pitchMin: 0.5, pitchMax: 2 },
};

/** Ce que le moteur fournit au gestionnaire (bus et réverbérations). */
export interface LoopWiring {
  ctx: BaseAudioContext;
  res: AudioResources;
  bus: AudioNode;
  streetSend: AudioNode;
  roomSend: AudioNode;
}

/** État de l'auditeur utile aux boucles. */
export interface LoopListener {
  pos: Vec3Like;
  indoor: boolean;
  /** 0..1 */
  underground: number;
}

const SPEED_OF_SOUND = 343;
const finite = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const v3 = (v: Vec3Like): Vec3Like => ({ x: finite(v.x, 0), y: finite(v.y, 0), z: finite(v.z, 0) });

class Loop implements LoopHandle {
  readonly name: LoopName;
  readonly def: LoopDef;
  pos: Vec3Like | null;
  volume: number;
  pitch: number;
  alive = true;
  // Nœuds (null tant que la boucle n'a pas démarré).
  src: AudioBufferSourceNode | null = null;
  lp: BiquadFilterNode | null = null;
  out: GainNode | null = null;
  pan: PannerNode | null = null;
  send: GainNode | null = null;
  sendTarget: AudioNode | null = null;
  /** Reliée au bus (faux : hors de portée, déconnectée). */
  connected = false;
  // Dernières valeurs envoyées aux paramètres (évite d'empiler des automatisations).
  lastRate = -1; lastCut = -1; lastGain = -1; lastSend = -1;
  lastPos: Vec3Like | null = null;
  // Effet Doppler.
  prevDist = -1;
  radial = 0;
  doppler = 1;
  lastT = -1;

  constructor(private readonly mgr: LoopManager, name: LoopName, o: LoopOptions) {
    this.name = name;
    this.def = DEFS[name];
    this.pos = o.pos ? v3(o.pos) : null;
    this.volume = clamp(finite(o.volume, 1), 0, 4);
    this.pitch = clamp(finite(o.pitch, 1), 0.1, 4);
  }

  get active(): boolean { return this.alive; }

  update(p: LoopOptions): void {
    if (!this.alive || !p) return;
    try {
      if (p.pos) this.pos = v3(p.pos);
      if (p.volume !== undefined) this.volume = clamp(finite(p.volume, this.volume), 0, 4);
      if (p.pitch !== undefined) this.pitch = clamp(finite(p.pitch, this.pitch), 0.1, 4);
      this.mgr.touch(this);
    } catch { /* jamais d'exception depuis l'audio */ }
  }

  stop(fadeSeconds = 0.25): void {
    if (!this.alive) return;
    this.alive = false;
    try { this.mgr.release(this, finite(fadeSeconds, 0.25)); } catch { /* ignorer */ }
  }
}

export class LoopManager {
  private wiring: LoopWiring | null = null;
  private loops: Loop[] = [];
  private dying: Array<{ at: number; nodes: AudioNode[] }> = [];
  private lis: LoopListener = { pos: { x: 0, y: 0, z: 0 }, indoor: false, underground: 0 };

  constructor(private readonly max: number) {}

  /** Nombre de boucles actives (y compris en attente). */
  get count(): number { return this.loops.length; }

  /** Boucles arrêtées dont le fondu de sortie n'est pas terminé. */
  get releasing(): number { return this.dying.length; }

  attach(w: LoopWiring): void {
    this.wiring = w;
    this.update(w.ctx.currentTime);
  }

  /** Moteur détruit : toutes les boucles s'arrêtent net, leurs poignées deviennent inertes. */
  detach(): void {
    for (const l of this.loops) {
      l.alive = false;
      this.disconnect(this.nodesOf(l));
    }
    for (const d of this.dying) this.disconnect(d.nodes);
    this.loops = [];
    this.dying = [];
    this.wiring = null;
  }

  setListener(l: LoopListener): void { this.lis = l; }

  create(name: LoopName, o: LoopOptions): LoopHandle | null {
    if (!Object.prototype.hasOwnProperty.call(DEFS, name)) return null;
    if (this.loops.length >= this.max) return null;
    const l = new Loop(this, name, o ?? {});
    this.loops.push(l);
    this.touch(l);
    return l;
  }

  /** Paramètres d'une boucle modifiés : démarre-la si besoin et applique tout de suite. */
  touch(l: Loop): void {
    const w = this.wiring;
    if (!w || !l.alive) return;
    const now = w.ctx.currentTime;
    if (!l.src && !this.start(l, now)) return;
    this.refresh(l, now);
  }

  /** Appelé à chaque image / tic : démarrages en attente, distance, Doppler, libérations. */
  update(now: number): void {
    if (this.dying.length) {
      this.dying = this.dying.filter((d) => {
        if (d.at > now) return true;
        this.disconnect(d.nodes);
        return false;
      });
    }
    if (!this.wiring) return;
    for (const l of this.loops) {
      if (!l.src && !this.start(l, now)) continue;
      this.refresh(l, now);
    }
  }

  release(l: Loop, fade: number): void {
    const i = this.loops.indexOf(l);
    if (i >= 0) this.loops.splice(i, 1);
    const w = this.wiring;
    if (!w || !l.src || !l.out) return; // jamais démarrée : rien à libérer
    const ctx = w.ctx;
    if (typeof AudioContext !== 'undefined' && ctx instanceof AudioContext && ctx.state !== 'running') {
      // Contexte en pause : l'horloge est arrêtée, on libère tout de suite (rien ne sonne).
      try { l.src.stop(); } catch { /* ignorer */ }
      this.disconnect(this.nodesOf(l));
      return;
    }
    const now = ctx.currentTime;
    const f = clamp(fade, 0.005, 10);
    const g = l.out.gain;
    try {
      const anyG = g as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      if (anyG.cancelAndHoldAtTime) anyG.cancelAndHoldAtTime(now);
      else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
      g.linearRampToValueAtTime(0, now + f);
      l.src.stop(now + f + 0.03);
    } catch { /* ignorer */ }
    this.dying.push({ at: now + f + 0.1, nodes: this.nodesOf(l) });
  }

  /* ---------------------------------------------------------------- interne */

  private nodesOf(l: Loop): AudioNode[] {
    const n: AudioNode[] = [];
    if (l.src) n.push(l.src);
    if (l.lp) n.push(l.lp);
    if (l.out) n.push(l.out);
    if (l.pan) n.push(l.pan);
    if (l.send) n.push(l.send);
    return n;
  }

  private disconnect(nodes: AudioNode[]): void {
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* ignorer */ }
    }
  }

  private start(l: Loop, now: number): boolean {
    const w = this.wiring;
    if (!w) return false;
    const buf = w.res.loopBuffer(l.name);
    if (!buf) return false;
    const ctx = w.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = biquad(ctx, 'lowpass', l.def.cutoff, 0.7);
    const out = gainNode(ctx, 0);
    const send = gainNode(ctx, 0);
    chain(src, lp, out, send);
    l.src = src; l.lp = lp; l.out = out; l.send = send;
    if (l.pos) this.makePanner(l);
    // Départ à un endroit aléatoire du tampon : deux véhicules identiques ne sont pas en phase.
    src.start(now, Math.random() * buf.duration);
    return true;
  }

  private makePanner(l: Loop): void {
    const w = this.wiring;
    if (!w || !l.out || l.pan) return;
    const pn = w.ctx.createPanner();
    pn.panningModel = 'equalpower';
    pn.distanceModel = 'inverse';
    pn.refDistance = l.def.ref;
    pn.rolloffFactor = l.def.rolloff;
    pn.maxDistance = 10000;
    if (l.connected) { l.out.disconnect(w.bus); pn.connect(w.bus); }
    l.out.connect(pn);
    l.pan = pn;
    l.lastPos = null;
  }

  private setConnected(l: Loop, on: boolean): void {
    const w = this.wiring;
    if (!w || !l.out || !l.send || on === l.connected) return;
    const tail: AudioNode = l.pan ?? l.out;
    if (on) {
      tail.connect(w.bus);
    } else {
      try { tail.disconnect(w.bus); } catch { /* ignorer */ }
    }
    l.connected = on;
  }

  private refresh(l: Loop, now: number): void {
    const w = this.wiring;
    if (!w || !l.src || !l.lp || !l.out || !l.send) return;
    const def = l.def;
    const lis = this.lis;
    let dist = 0;
    if (l.pos) {
      if (!l.pan) this.makePanner(l);
      const p = l.pos;
      dist = Math.hypot(p.x - lis.pos.x, p.y - lis.pos.y, p.z - lis.pos.z);
      if (!Number.isFinite(dist) || dist > def.cull) {
        this.setConnected(l, false);
        l.prevDist = -1;
        return;
      }
      // Doppler : vitesse radiale lissée (positive quand la source s'éloigne).
      if (def.doppler) {
        const dt = l.lastT >= 0 ? now - l.lastT : 0;
        if (dt > 0.004) {
          if (l.prevDist >= 0) {
            const v = (dist - l.prevDist) / dt;
            if (Math.abs(v) < 120) l.radial += (v - l.radial) * (1 - Math.exp(-dt / 0.25));
            else l.radial *= 0.5; // téléportation : on ignore
          }
          l.prevDist = dist;
          l.lastT = now;
          l.doppler = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + l.radial), 0.8, 1.25);
        } else if (l.lastT < 0) {
          l.lastT = now;
          l.prevDist = dist;
        }
      }
      const pn = l.pan as PannerNode;
      const lp0 = l.lastPos;
      if (!lp0 || Math.abs(lp0.x - p.x) + Math.abs(lp0.y - p.y) + Math.abs(lp0.z - p.z) > 0.01) {
        if (pn.positionX) {
          if (!lp0) {
            pn.positionX.setValueAtTime(p.x, now); pn.positionY.setValueAtTime(p.y, now); pn.positionZ.setValueAtTime(p.z, now);
          } else {
            pn.positionX.setTargetAtTime(p.x, now, 0.03); pn.positionY.setTargetAtTime(p.y, now, 0.03); pn.positionZ.setTargetAtTime(p.z, now, 0.03);
          }
        } else {
          pn.setPosition(p.x, p.y, p.z);
        }
        l.lastPos = { x: p.x, y: p.y, z: p.z };
      }
    }
    this.setConnected(l, true);

    const pitch = clamp(l.pitch, def.pitchMin, def.pitchMax);
    const rate = pitch * l.doppler;
    let cutoff = def.cutoff * Math.pow(pitch, def.cutoffSlope);
    if (dist > 20) cutoff = Math.min(cutoff, clamp(22000 * Math.exp(-dist / 55), 1000, 20000));
    let g = l.volume * def.gain * (1 + def.gainSlope * (pitch - 1));
    if (def.outdoor) {
      if (lis.indoor) { cutoff = Math.min(cutoff, 900); g *= 0.55; }
      const u = lis.underground;
      if (u > 0) { cutoff = Math.min(cutoff, 16000 * (1 - u) + 350 * u); g *= 1 - 0.85 * u; }
    }
    cutoff = clamp(cutoff, 60, w.ctx.sampleRate * 0.45);
    const first = l.lastGain < 0;
    if (Math.abs(rate - l.lastRate) > 0.002) {
      if (first) l.src.playbackRate.setValueAtTime(rate, now);
      else l.src.playbackRate.setTargetAtTime(rate, now, 0.06);
      l.lastRate = rate;
    }
    if (Math.abs(cutoff - l.lastCut) > l.lastCut * 0.02) {
      if (first) l.lp.frequency.setValueAtTime(cutoff, now);
      else l.lp.frequency.setTargetAtTime(cutoff, now, 0.06);
      l.lastCut = cutoff;
    }
    if (Math.abs(g - l.lastGain) > Math.max(1e-4, l.lastGain * 0.01)) {
      if (first) { l.out.gain.setValueAtTime(0, now); l.out.gain.setTargetAtTime(g, now, 0.04); }
      else l.out.gain.setTargetAtTime(g, now, 0.05);
      l.lastGain = g;
    }
    // Réverbération : pièce si l'auditeur est dedans et la source aussi (alarme), sinon rue / tunnel.
    const target = lis.indoor && !def.outdoor ? w.roomSend : w.streetSend;
    if (target !== l.sendTarget) {
      if (l.sendTarget) { try { l.send.disconnect(l.sendTarget); } catch { /* ignorer */ } }
      l.send.connect(target);
      l.sendTarget = target;
    }
    const sendAmt = def.send * Math.sqrt(def.ref / Math.max(def.ref, dist)) * (def.outdoor && lis.indoor ? 0.4 : 1);
    if (Math.abs(sendAmt - l.lastSend) > 0.01) {
      l.send.gain.setTargetAtTime(sendAmt, now, 0.08);
      l.lastSend = sendAmt;
    }
  }
}
