/**
 * AudioEngine — moteur Web Audio entièrement procédural de
 * « MAFIA WARS II : Dadou vs Even » (New York, 2085).
 *
 * Aucun fichier audio : chaque bruitage, lit d'ambiance, réverbération, son de
 * moteur et morceau de musique est synthétisé à l'exécution. Utilisation :
 *
 *   import { audio } from './audio/AudioEngine';
 *   window.addEventListener('pointerdown', () => audio.unlock());
 *   audio.playMusic('menu');
 *   audio.play('pistol', { pos: { x: 10, y: 1.5, z: -3 } });
 *   const moteur = audio.loop('engine_car', { pos: voiture.position });
 *   // à chaque image :
 *   moteur?.update({ pos: voiture.position, pitch: 1 + 1.5 * vitesse / vitesseMax });
 *   audio.setListener(camera.position, cameraForward, camera.up);
 *   audio.update(dt);
 *   // à la destruction du véhicule :
 *   moteur?.stop();
 */
import { Ambience } from './ambience';
import { clamp } from './dsp';
import { LoopManager, type LoopListener } from './loops';
import { MusicDirector } from './music';
import { AudioResources, type BankName } from './resources';
import { SFX, type SfxDef, type SpatialProfile } from './sfx';
import { playBank, type SfxCtx } from './sfx_combat';
import { biquad, chain, gainNode, setSourceCollector, type SynthEnv } from './synth';
import type {
  AmbienceParams, LoopHandle, LoopName, LoopOptions, MusicTrackName, PlayOptions, SfxName, Vec3Like, VolumeSettings,
} from './types';

export { LOOP_NAMES, SFX_NAMES } from './types';
export type {
  AmbienceParams, LoopHandle, LoopName, LoopOptions, MusicTrackName, PlayOptions, SfxName, Vec3Like, VolumeSettings,
} from './types';

export interface AudioEngineOptions {
  /** Contexte injecté (ex. OfflineAudioContext pour les tests / le rendu). */
  context?: BaseAudioContext;
  /** Nombre maximal de voix de bruitage simultanées (32 par défaut). */
  maxVoices?: number;
  /** Nombre maximal de sons continus simultanés (`loop()`, 12 par défaut). */
  maxLoops?: number;
  /** Panoramique HRTF pour les sons positionnels importants (vrai par défaut). */
  hrtf?: boolean;
}

export interface AudioStats {
  state: string;
  time: number;
  /** Voix de bruitage actives. */
  voices: number;
  /** Sons continus actifs (y compris en attente de démarrage). */
  loops: number;
  music: MusicTrackName;
  /** Voix et boucles en cours d'extinction (fondu de sortie avant libération). */
  pendingEvents: number;
  /** Vrai tant que des ressources différées (banques, réverbérations, boucles) sont en génération. */
  loopsPending: boolean;
}

interface Voice {
  name: SfxName;
  out: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  start: number;
  end: number;
  score: number;
}

/** Ajustements des bus (linéaires) appliqués en plus des volumes de l'utilisateur. */
const TRIM = { sfx: 0.9, music: 0.5, ambience: 0.5 };
const LOOKAHEAD_MIN = 0.15;
const LOOKAHEAD_MAX = 2.5;
const TIMER_MS = 50;

const v3 = (v: Vec3Like): Vec3Like => ({ x: +v.x || 0, y: +v.y || 0, z: +v.z || 0 });
const dist3 = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function createRealtimeContext(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    try { return new Ctor(); } catch { return null; }
  }
}

function isRealtime(ctx: BaseAudioContext): ctx is AudioContext {
  return typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
}

type IdleScheduler = (cb: (deadline: IdleDeadline) => void, opts?: { timeout: number }) => number;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  private res: AudioResources | null = null;
  private env: SynthEnv | null = null;
  private readonly injected: BaseAudioContext | null;
  private readonly maxVoices: number;
  private hrtf: boolean;

  // Graphe
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private sfxStreetSend: GainNode | null = null;
  private sfxRoomSend: GainNode | null = null;
  private ambStreetSend: GainNode | null = null;
  private musicHallSend: GainNode | null = null;
  /** Les envois « extérieurs » se partagent entre la rue et le tunnel du métro selon `underground`. */
  private outdoorVerb: GainNode | null = null;
  private tunnelVerb: GainNode | null = null;
  private tunnelConv: ConvolverNode | null = null;
  private tunnelOn = false;
  private tunnelOffAt = Infinity;
  /** Faux tant que le partage rue / tunnel n'a jamais été appliqué (première fois : immédiat). */
  private undergroundApplied = false;
  private convolvers: ConvolverNode[] = [];
  private outNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  // Sous-systèmes
  private music: MusicDirector | null = null;
  private ambience: Ambience | null = null;
  private readonly loops: LoopManager;
  private voices: Voice[] = [];
  private dying: Voice[] = [];
  private readonly bankLast = new Map<BankName, { v: number }>();

  // État mémorisé (appliqué au déverrouillage)
  private volumes: VolumeSettings = { master: 1, music: 0.8, sfx: 1, ambience: 0.8 };
  private lisPos: Vec3Like = { x: 0, y: 0, z: 0 };
  private lisFwd: Vec3Like = { x: 0, y: 0, z: -1 };
  private lisUp: Vec3Like = { x: 0, y: 1, z: 0 };
  private listenerIndoor = false;
  private underground = 0;
  private readonly loopListener: LoopListener = { pos: this.lisPos, indoor: false, underground: 0 };
  private ambParams: AmbienceParams | null = null;
  private desiredTrack: MusicTrackName = 'none';
  private combat = 0;
  private combatSmooth = 0;
  private calmTime = 0;
  private userSuspended = false;
  /** Courte fenêtre après unlock() pendant laquelle un contexte qui démarre accepte des sons. */
  private startingUntil = 0;

  // Ordonnanceur
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickWall = 0;
  private gapEstimate = TIMER_MS / 1000;

  constructor(opts: AudioEngineOptions = {}) {
    this.injected = opts.context ?? null;
    this.maxVoices = Math.max(4, opts.maxVoices ?? 32);
    this.loops = new LoopManager(Math.max(1, opts.maxLoops ?? 12));
    this.loops.setListener(this.loopListener);
    this.hrtf = opts.hrtf ?? true;
  }

  /* ================================================================ cycle de vie */

  /** À appeler depuis un geste de l'utilisateur (clic/touche). Sans risque si appelé plusieurs fois. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const ctx = this.injected ?? createRealtimeContext();
        if (!ctx) return;
        this.ctx = ctx;
        this.build(ctx);
      }
      const ctx = this.ctx;
      if (!isRealtime(ctx)) return;
      if (this.userSuspended) {
        if (ctx.state === 'running') ctx.suspend().catch(() => { /* ignorer */ });
      } else if (ctx.state === 'suspended') {
        // Certains navigateurs (Firefox) passent à 'running' de façon asynchrone : on accepte des sons brièvement.
        this.startingUntil = nowMs() + 500;
        ctx.resume().catch(() => { /* nouvel essai au prochain geste */ });
      }
    } catch {
      /* jamais d'exception depuis l'audio */
    }
  }

  /** Vrai dès que le contexte existe et tourne (toujours vrai pour un contexte hors ligne après unlock). */
  get ready(): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.res) return false;
    return isRealtime(ctx) ? ctx.state === 'running' : true;
  }

  /** En marche, ou tout juste déverrouillé et sur le point de tourner (on peut programmer des sons). */
  private get canPlay(): boolean {
    if (this.ready) return true;
    const ctx = this.ctx;
    return !!ctx && !!this.res && isRealtime(ctx) && ctx.state === 'suspended' &&
      !this.userSuspended && nowMs() < this.startingUntil;
  }

  /** Le contexte sous-jacent (null avant unlock). */
  get context(): BaseAudioContext | null { return this.ctx; }

  suspend(): void {
    this.userSuspended = true;
    const ctx = this.ctx;
    if (ctx && isRealtime(ctx) && ctx.state === 'running') ctx.suspend().catch(() => { /* ignorer */ });
  }

  resume(): void {
    this.userSuspended = false;
    const ctx = this.ctx;
    if (ctx && isRealtime(ctx) && ctx.state === 'suspended') ctx.resume().catch(() => { /* ignorer */ });
  }

  /**
   * Arrête les minuteries et ferme le contexte temps réel. Les boucles en cours
   * sont arrêtées (leurs poignées deviennent inertes). Le moteur peut être
   * déverrouillé de nouveau ensuite.
   */
  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.loops.detach();
    const ctx = this.ctx;
    if (ctx && isRealtime(ctx)) ctx.close().catch(() => { /* ignorer */ });
    this.ctx = null; this.res = null; this.env = null;
    this.outNode = null; this.analyser = null;
    this.music = null; this.ambience = null;
    this.voices = []; this.dying = [];
    this.convolvers = [];
    this.tunnelConv = null; this.tunnelVerb = null; this.outdoorVerb = null; this.tunnelOn = false;
    this.undergroundApplied = false;
  }

  private build(ctx: BaseAudioContext): void {
    const res = new AudioResources(ctx);
    this.res = res;
    const env: SynthEnv = { ctx, res };
    this.env = env;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 6;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.22;
    const outTrim = gainNode(ctx, 0.9);
    this.outNode = outTrim;
    this.master = gainNode(ctx, 1);
    chain(this.master, limiter, outTrim, ctx.destination);

    this.sfxBus = gainNode(ctx, 1);
    this.musicBus = gainNode(ctx, 1);
    this.ambBus = gainNode(ctx, 1);
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.ambBus.connect(this.master);

    const conv = (ret: number): ConvolverNode => {
      const c = ctx.createConvolver();
      c.normalize = true;
      const g = gainNode(ctx, ret);
      chain(c, g, this.master as GainNode);
      this.convolvers.push(c);
      return c;
    };
    // Les réponses impulsionnelles arrivent de façon asynchrone (générées par tranches).
    const street = conv(0.8);
    const room = conv(0.7);
    const hall = conv(0.6);
    const tunnel = conv(0.75);
    this.tunnelConv = tunnel;
    this.outdoorVerb = gainNode(ctx, 1); this.outdoorVerb.connect(street);
    // Le tunnel n'est relié que lorsqu'on est sous terre (une convolution de moins le reste du temps).
    this.tunnelVerb = gainNode(ctx, 0);
    this.tunnelOn = false;
    this.sfxStreetSend = gainNode(ctx, 1);
    this.ambStreetSend = gainNode(ctx, 1);
    for (const s of [this.sfxStreetSend, this.ambStreetSend]) { s.connect(this.outdoorVerb); s.connect(this.tunnelVerb); }
    this.sfxRoomSend = gainNode(ctx, 1); this.sfxRoomSend.connect(room);
    this.musicHallSend = gainNode(ctx, 1); this.musicHallSend.connect(hall);
    const setIR = (c: ConvolverNode, b: AudioBuffer | null): void => {
      if (b && !c.buffer) { try { c.buffer = b; } catch { /* ignorer */ } }
    };
    res.onReady = (kind) => {
      if (this.res !== res) return;
      if (kind === 'streetIR') setIR(street, res.streetIR);
      else if (kind === 'roomIR') setIR(room, res.roomIR);
      else if (kind === 'hallIR') setIR(hall, res.hallIR);
      else if (kind === 'tunnelIR') setIR(tunnel, res.tunnelIR);
      else if (kind !== 'bank' && kind !== 'drums' && kind !== 'loopBuffer') this.ambience?.onLoopReady(kind);
    };
    // Réponses déjà générées pour cette fréquence d'échantillonnage (cache partagé).
    setIR(street, res.streetIR); setIR(room, res.roomIR); setIR(hall, res.hallIR); setIR(tunnel, res.tunnelIR);
    if (!isRealtime(ctx)) res.finishAll();

    const musicWet = gainNode(ctx, 0.35);
    musicWet.connect(this.musicHallSend);
    this.music = new MusicDirector(env, this.musicBus, musicWet);
    this.ambience = new Ambience(env, this.ambBus, this.ambStreetSend, ctx.currentTime);
    this.loops.attach({ ctx, res, bus: this.sfxBus, streetSend: this.sfxStreetSend, roomSend: this.sfxRoomSend });

    this.applyVolumes(true);
    this.applyListener();
    if (this.ambParams) this.setAmbience(this.ambParams);
    if (this.desiredTrack !== 'none') this.music.play(this.desiredTrack, ctx.currentTime, 2.5, 1);

    if (isRealtime(ctx)) {
      // Banques, réverbérations et boucles sont générées par petites tranches après le
      // déverrouillage, de préférence pendant les temps morts du navigateur entre deux
      // images (requestIdleCallback) : le gestionnaire du geste et les images restent fluides.
      const ric = (globalThis as unknown as { requestIdleCallback?: IdleScheduler }).requestIdleCallback;
      const pump = (deadline?: IdleDeadline): void => {
        if (this.res !== res) return;
        const idle = deadline && !deadline.didTimeout ? deadline.timeRemaining() - 1 : 6;
        if (res.work(clamp(idle, 3, 12))) next();
      };
      const next = (): void => {
        if (ric) ric.call(globalThis, pump, { timeout: 80 });
        else setTimeout(pump, 4);
      };
      setTimeout(pump, 0);
      this.timer = setInterval(() => this.tick(), TIMER_MS);
    }
  }

  /* ================================================================ volumes et auditeur */

  setVolumes(v: { master: number; music: number; sfx: number; ambience: number }): void {
    const c = (x: number, d: number): number => (Number.isFinite(x) ? clamp(x, 0, 1) : d);
    this.volumes = {
      master: c(v.master, this.volumes.master),
      music: c(v.music, this.volumes.music),
      sfx: c(v.sfx, this.volumes.sfx),
      ambience: c(v.ambience, this.volumes.ambience),
    };
    this.applyVolumes(false);
  }

  /** Volumes mémorisés. */
  getVolumes(): VolumeSettings { return { ...this.volumes }; }

  private applyVolumes(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    // Courbe quadratique : curseurs perceptivement plus réguliers.
    const curve = (x: number): number => x * x;
    const set = (g: GainNode | null, val: number): void => {
      if (!g) return;
      if (immediate) { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(val, now); }
      else g.gain.setTargetAtTime(val, now, 0.04);
    };
    const v = this.volumes;
    set(this.master, curve(v.master));
    set(this.sfxBus, curve(v.sfx) * TRIM.sfx);
    set(this.sfxStreetSend, curve(v.sfx) * TRIM.sfx);
    set(this.sfxRoomSend, curve(v.sfx) * TRIM.sfx);
    set(this.musicBus, curve(v.music) * TRIM.music);
    set(this.musicHallSend, curve(v.music) * TRIM.music);
    set(this.ambBus, curve(v.ambience) * TRIM.ambience);
    set(this.ambStreetSend, curve(v.ambience) * TRIM.ambience);
  }

  /** Position et orientation de la caméra / de l'auditeur (monde Three.js : y vers le haut, mètres). */
  setListener(pos: Vec3Like, forward: Vec3Like, up?: Vec3Like): void {
    this.lisPos = v3(pos);
    this.loopListener.pos = this.lisPos;
    const f = v3(forward);
    const fl = Math.hypot(f.x, f.y, f.z);
    if (fl > 1e-6) this.lisFwd = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
    let u = up ? v3(up) : { x: 0, y: 1, z: 0 };
    // Orthogonalise « haut » par rapport à « avant » (évite un repère dégénéré en regardant vers le bas).
    const F = this.lisFwd;
    const d = u.x * F.x + u.y * F.y + u.z * F.z;
    u = { x: u.x - F.x * d, y: u.y - F.y * d, z: u.z - F.z * d };
    let ul = Math.hypot(u.x, u.y, u.z);
    if (ul < 1e-4) { u = Math.abs(F.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: -Math.sign(F.y) }; ul = 1; }
    this.lisUp = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
    this.applyListener();
  }

  private applyListener(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const p = this.lisPos, f = this.lisFwd, u = this.lisUp;
    try {
      if (L.positionX) {
        L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
        L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
        L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
      } else {
        // Firefox : l'AudioListener n'a pas d'AudioParam, on utilise les anciens réglages.
        L.setPosition(p.x, p.y, p.z);
        L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
      }
    } catch { /* ignorer */ }
  }

  /** Active/désactive le panoramique HRTF pour les nouvelles voix positionnelles. */
  setHrtf(enabled: boolean): void { this.hrtf = enabled; }

  /* ================================================================ bruitages */

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.ctx, res = this.res, env = this.env;
    if (!ctx || !res || !env || !this.canPlay || !this.sfxBus) return;
    const def: SfxDef | undefined = SFX[name];
    if (!def) return;
    try {
      this.playDef(ctx, res, name, def, opts ?? {});
    } catch {
      /* jamais d'exception depuis l'audio */
    }
  }

  private playDef(ctx: BaseAudioContext, res: AudioResources, name: SfxName, def: SfxDef, opts: PlayOptions): void {
    const now = ctx.currentTime;
    const t = Math.max(now, opts.when ?? now + 0.005);
    const spatial: SpatialProfile | null = opts.pos && def.spatial ? def.spatial : null;
    let synth = def.synth;
    let bank = def.bank;
    let gainMul = 1;
    let dist = 0;
    if (spatial && opts.pos) {
      dist = dist3(this.lisPos, opts.pos);
      if (!Number.isFinite(dist) || dist > spatial.cull) return;
      if (def.far && dist > def.far.dist) {
        if (def.far.bank) bank = def.far.bank;
        else if (def.far.synth) { synth = def.far.synth; bank = undefined; }
        gainMul = def.far.gain ?? 1;
      }
    }
    const variants = bank ? res.banks[bank] : null;
    if (bank && (!variants || variants.length === 0)) return; // encore en génération (première seconde)
    const vol = clamp(Number.isFinite(opts.volume) ? (opts.volume as number) : 1, 0, 4) * def.gain * gainMul;
    if (vol < 0.0005) return;
    const pitch = clamp(Number.isFinite(opts.pitch) ? (opts.pitch as number) : 1, 0.25, 4);
    const att = spatial ? spatial.ref / (spatial.ref + spatial.rolloff * Math.max(0, dist - spatial.ref)) : 1;
    const score = vol * att * (1 + def.priority);

    this.reap(now);
    // Fraction restante d'une voix à l'instant de départ `t` du nouveau son (les sons
    // programmés à l'avance avec `when` sont ainsi traités comme en temps réel).
    const remAt = (v: Voice): number => clamp((v.end - t) / Math.max(0.01, v.end - v.start), 0, 1);
    // Plafond par nom : on coupe l'instance la plus avancée (la plus ancienne en temps réel).
    let same = 0;
    let victim: Voice | null = null;
    let vr = Infinity;
    for (const v of this.voices) {
      if (v.name !== name || v.end <= t) continue;
      same++;
      const r = remAt(v);
      if (r < vr || (r === vr && victim && v.start < victim.start)) { vr = r; victim = v; }
    }
    if (same >= def.maxInst && victim) {
      if (victim.start > t) return; // toutes les instances sont programmées plus tard : on abandonne celui-ci
      this.kill(victim, now, t);
    }
    // Limite globale : on vole la plus faible (discrète / presque finie / peu prioritaire).
    if (this.voices.length >= this.maxVoices) {
      let weakest: Voice | null = null;
      let ws = Infinity;
      for (const v of this.voices) {
        const sc = v.score * (0.2 + 0.8 * remAt(v));
        if (sc < ws) { ws = sc; weakest = v; }
      }
      if (!weakest || ws > score) return; // le nouveau son est le moins important : on l'abandonne
      this.kill(weakest, now, t);
    }

    // Graphe de la voix : out -> [air] -> [étouffement intérieur] -> [panoramique] -> bus, + envoi de réverbération.
    const out = gainNode(ctx, vol);
    const nodes: AudioNode[] = [out];
    let tail: AudioNode = out;
    const indoor = opts.indoor ?? this.listenerIndoor;
    if (spatial && opts.pos) {
      if (dist > 20 && !def.step) {
        const lp = biquad(ctx, 'lowpass', clamp(22000 * Math.exp(-dist / 55), 1000, 20000), 0.6);
        tail.connect(lp); tail = lp; nodes.push(lp);
      }
      if (indoor !== this.listenerIndoor) {
        const lp = biquad(ctx, 'lowpass', 900, 0.6);
        const g = gainNode(ctx, 0.55);
        chain(tail, lp, g); tail = g; nodes.push(lp, g);
      }
      const pn = ctx.createPanner();
      pn.panningModel = this.hrtf && spatial.hrtf ? 'HRTF' : 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = spatial.ref;
      pn.rolloffFactor = spatial.rolloff;
      pn.maxDistance = 10000;
      const p = opts.pos;
      if (pn.positionX) {
        pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z;
      } else {
        pn.setPosition(p.x, p.y, p.z);
      }
      tail.connect(pn); tail = pn; nodes.push(pn);
    }
    tail.connect(this.sfxBus as GainNode);
    const sendScale = spatial ? Math.sqrt(spatial.ref / Math.max(spatial.ref, dist)) : 1;
    const sendAmt = def.send * sendScale * (indoor ? 0.9 : 1);
    if (sendAmt > 0.01) {
      const sg = gainNode(ctx, sendAmt);
      out.connect(sg);
      sg.connect((indoor ? this.sfxRoomSend : this.sfxStreetSend) as GainNode);
      nodes.push(sg);
    }

    const sources: AudioScheduledSourceNode[] = [];
    const s: SfxCtx = { ctx, res, out, t, p: pitch, spatial: !!spatial };
    let end: number;
    setSourceCollector(sources);
    try {
      if (bank && variants) {
        let last = this.bankLast.get(bank);
        if (!last) { last = { v: -1 }; this.bankLast.set(bank, last); }
        end = playBank(s, variants, last);
      } else {
        end = synth(s);
      }
    } catch {
      for (const n of nodes) n.disconnect();
      for (const src of sources) { try { src.stop(); } catch { /* ignorer */ } }
      return;
    } finally {
      setSourceCollector(null);
    }
    if (!Number.isFinite(end) || end < t) end = t + 0.5;
    this.voices.push({ name, out, nodes, sources, start: t, end: end + 0.05, score });
  }

  /** Coupe une voix (fondu très bref) à l'instant `at` (au plus tôt maintenant). */
  private kill(v: Voice, now: number, at = now): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    const when = Math.max(now, at);
    try {
      const g = v.out.gain;
      g.cancelScheduledValues(when);
      g.setTargetAtTime(0, when, 0.008);
    } catch { /* ignorer */ }
    for (const s of v.sources) {
      try { s.stop(when + 0.06); } catch { /* déjà arrêtée */ }
    }
    v.end = when + 0.1;
    this.dying.push(v);
  }

  private reap(now: number): void {
    if (this.voices.length) {
      let w = 0;
      for (const v of this.voices) {
        if (v.end < now) this.disconnect(v);
        else this.voices[w++] = v;
      }
      this.voices.length = w;
    }
    if (this.dying.length) {
      this.dying = this.dying.filter((v) => {
        if (v.end >= now) return true;
        this.disconnect(v);
        return false;
      });
    }
  }

  private disconnect(v: Voice): void {
    for (const n of v.nodes) {
      try { n.disconnect(); } catch { /* ignorer */ }
    }
  }

  /* ================================================================ sons continus */

  /**
   * Démarre un son continu (moteur, ADAV, drone, alarme, sirène), positionnel
   * si `pos` est donné. Renvoie une poignée à mettre à jour à chaque image
   * (`update({ pos, pitch, volume })`) et à arrêter (`stop()`), ou null si le
   * plafond de boucles simultanées est atteint (ou le nom inconnu). Avant le
   * déverrouillage, la poignée reste en attente et démarre d'elle-même.
   */
  loop(name: LoopName, opts: LoopOptions = {}): LoopHandle | null {
    try {
      return this.loops.create(name, opts ?? {});
    } catch {
      return null;
    }
  }

  /* ================================================================ ambiance et musique */

  setAmbience(p: AmbienceParams): void {
    if (!p) return;
    this.ambParams = { ...p };
    const u = clamp(Number.isFinite(p.underground) ? (p.underground as number) : 0, 0, 1);
    this.underground = u;
    // Dans le métro, les bruitages prennent la réverbération du quai (envoi « extérieur »).
    this.listenerIndoor = !!p.indoor && u < 0.5;
    this.loopListener.indoor = this.listenerIndoor;
    this.loopListener.underground = u;
    this.combat = clamp(Number.isFinite(p.combat) ? p.combat : 0, 0, 1);
    const ctx = this.ctx;
    if (!ctx || !this.ambience) return;
    try {
      this.ambience.setParams(p, ctx.currentTime);
      this.applyUnderground(ctx.currentTime);
    } catch { /* ignorer */ }
  }

  /** Partage des envois extérieurs entre la rue et le tunnel du métro. */
  private applyUnderground(now: number): void {
    const o = this.outdoorVerb, tv = this.tunnelVerb, tc = this.tunnelConv;
    if (!o || !tv || !tc) return;
    const u = this.underground;
    const tau = this.undergroundApplied ? 0.3 : 0.01;
    this.undergroundApplied = true;
    o.gain.setTargetAtTime(1 - u, now, tau);
    tv.gain.setTargetAtTime(u, now, tau);
    if (u > 0.001) {
      if (!this.tunnelOn) { tv.connect(tc); this.tunnelOn = true; }
      this.tunnelOffAt = Infinity;
    } else if (this.tunnelOn && this.tunnelOffAt === Infinity) {
      this.tunnelOffAt = now + 3;
    }
  }

  playMusic(track: MusicTrackName): void {
    this.desiredTrack = track;
    const ctx = this.ctx;
    const m = this.music;
    if (!ctx || !m) return;
    const cur = m.currentName;
    // 'game' et 'tension' sont gérés automatiquement d'après l'intensité des combats.
    if (track === 'game' && cur === 'tension') return;
    const now = ctx.currentTime;
    try {
      if (track === 'victory' || track === 'defeat') m.play(track, now, 0.05, 1.2);
      else m.play(track, now, 2.5, 2.5);
    } catch { /* ignorer */ }
    this.calmTime = 0;
  }

  /** Nom du morceau en cours (après la bascule automatique jeu / tension). */
  get currentMusic(): MusicTrackName { return this.music?.currentName ?? 'none'; }

  private autoMusic(dt: number): void {
    const ctx = this.ctx;
    const m = this.music;
    if (!ctx || !m) return;
    const k = 1 - Math.exp(-dt / 1.5);
    this.combatSmooth += (this.combat - this.combatSmooth) * k;
    const cur = m.currentName;
    if (cur !== 'game' && cur !== 'tension') return;
    m.setIntensity(Math.max(this.combat, this.combatSmooth));
    const now = ctx.currentTime;
    if (cur === 'game' && this.combat >= 0.35) {
      m.play('tension', now, 1.5, 3);
      this.calmTime = 0;
    } else if (cur === 'tension') {
      this.calmTime = this.combat < 0.12 ? this.calmTime + dt : 0;
      if (this.calmTime > 8) {
        m.play('game', now, 5, 5);
        this.calmTime = 0;
      }
    }
  }

  /* ================================================================ ordonnanceur */

  /** Entretien par image : séquences musicales, évènements d'ambiance, sons continus, nettoyage des voix. */
  update(dt: number): void {
    if (!this.ctx) return;
    const d = Number.isFinite(dt) ? clamp(dt, 0, 0.5) : 0;
    this.tick();
    this.autoMusic(d);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.res) return;
    const wall = nowMs();
    const gap = this.lastTickWall ? (wall - this.lastTickWall) / 1000 : TIMER_MS / 1000;
    this.lastTickWall = wall;
    // Avance adaptative : couvre le ralentissement des minuteries dans un onglet en arrière-plan.
    this.gapEstimate = Math.max(Math.min(gap, 5), this.gapEstimate * 0.97);
    const lookahead = clamp(this.gapEstimate * 1.6 + 0.08, LOOKAHEAD_MIN, LOOKAHEAD_MAX);
    const now = ctx.currentTime;
    this.runSchedulers(now, now + lookahead);
    this.reap(now);
    try { this.loops.update(now); } catch { /* ignorer */ }
    if (this.tunnelOn && now >= this.tunnelOffAt && this.tunnelVerb && this.tunnelConv) {
      try { this.tunnelVerb.disconnect(this.tunnelConv); } catch { /* ignorer */ }
      this.tunnelOn = false;
      this.tunnelOffAt = Infinity;
    }
  }

  private runSchedulers(now: number, until: number): void {
    try {
      this.music?.schedule(now, until);
      this.ambience?.schedule(now, until);
    } catch {
      /* jamais d'exception depuis l'audio */
    }
  }

  /**
   * Aide hors ligne : programme tous les évènements de musique et d'ambiance
   * jusqu'à `until` secondes (l'horloge d'un OfflineAudioContext n'avance pas
   * avant le rendu).
   */
  pump(until: number): void {
    if (!this.ctx) return;
    const step = 0.25;
    for (let t = 0; t < until; t += step) {
      this.autoMusic(step);
      this.runSchedulers(t, Math.min(until, t + step * 2));
    }
  }

  /** Optionnel : un AnalyserNode sur la sortie finale (vumètres, débogage). Null avant unlock. */
  meter(): AnalyserNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.outNode) return null;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.outNode.connect(this.analyser);
    }
    return this.analyser;
  }

  stats(): AudioStats {
    return {
      state: this.ctx ? (isRealtime(this.ctx) ? this.ctx.state : 'offline') : 'locked',
      time: this.ctx?.currentTime ?? 0,
      voices: this.voices.length,
      loops: this.loops.count,
      music: this.currentMusic,
      pendingEvents: this.dying.length + this.loops.releasing,
      loopsPending: this.res?.hasPendingJobs ?? true,
    };
  }

  /**
   * Rendu hors ligne (tests, aperçus, pré-calcul) : crée un moteur lié à un
   * OfflineAudioContext, exécute `setup`, programme tout et rend `seconds`.
   */
  static async renderOffline(
    seconds: number,
    setup: (engine: AudioEngine) => void,
    opts: { sampleRate?: number; maxVoices?: number; maxLoops?: number; hrtf?: boolean } = {},
  ): Promise<AudioBuffer> {
    const sr = opts.sampleRate ?? 44100;
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sr)), sr);
    const eng = new AudioEngine({ context: ctx, maxVoices: opts.maxVoices, maxLoops: opts.maxLoops, hrtf: opts.hrtf ?? false });
    eng.unlock();
    setup(eng);
    eng.pump(seconds);
    return ctx.startRendering();
  }
}

/** Instance partagée pour tout le jeu. */
export const audio = new AudioEngine();
