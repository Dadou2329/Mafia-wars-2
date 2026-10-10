/**
 * AudioEngine — fully procedural Web Audio engine for
 * "MAFIA WARS : Dadou vs Even" (Victorian London, 1888).
 *
 * No audio files: every sound, ambience bed, reverb and music cue is
 * synthesised at runtime. Usage:
 *
 *   import { audio } from './audio/AudioEngine';
 *   window.addEventListener('pointerdown', () => audio.unlock());
 *   audio.playMusic('menu');
 *   audio.play('revolver', { pos: { x: 10, y: 1.5, z: -3 } });
 *   // each frame:
 *   audio.setListener(camera.position, cameraForward, camera.up);
 *   audio.update(dt);
 */
import { Ambience } from './ambience';
import { towerStrike, westminsterPlan } from './bells';
import { clamp } from './dsp';
import { MusicDirector } from './music';
import { AudioResources } from './resources';
import { SFX, type SfxDef, type SpatialProfile } from './sfx';
import { footstep, type SfxCtx } from './sfx_combat';
import { biquad, chain, gainNode, setSourceCollector, type SynthEnv } from './synth';
import type {
  AmbienceParams, MusicTrackName, PlayOptions, SfxName, Vec3Like, VolumeSettings,
} from './types';

export { SFX_NAMES } from './types';
export type {
  AmbienceParams, MusicTrackName, PlayOptions, SfxName, Vec3Like, VolumeSettings,
} from './types';

export interface AudioEngineOptions {
  /** Inject a context (e.g. an OfflineAudioContext for tests/rendering). */
  context?: BaseAudioContext;
  /** Maximum simultaneous SFX voices (default 32). */
  maxVoices?: number;
  /** Use HRTF panning for important positional sounds (default true). */
  hrtf?: boolean;
}

export interface AudioStats {
  state: string;
  time: number;
  voices: number;
  music: MusicTrackName;
  pendingEvents: number;
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

interface QueuedEvent { time: number; fn: (t: number) => void }

/** Bus trims (linear) applied on top of the user volumes. */
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

  // Graph
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private sfxStreetSend: GainNode | null = null;
  private sfxRoomSend: GainNode | null = null;
  private ambStreetSend: GainNode | null = null;
  private musicHallSend: GainNode | null = null;
  private convolvers: ConvolverNode[] = [];
  private outNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  // Sub-systems
  private music: MusicDirector | null = null;
  private ambience: Ambience | null = null;
  private voices: Voice[] = [];
  private dying: Voice[] = [];
  private events: QueuedEvent[] = [];
  private lastStep = { stone: { v: -1 }, wood: { v: -1 }, carpet: { v: -1 } };

  // Remembered state (applied on unlock)
  private volumes: VolumeSettings = { master: 1, music: 0.8, sfx: 1, ambience: 0.8 };
  private lisPos: Vec3Like = { x: 0, y: 0, z: 0 };
  private lisFwd: Vec3Like = { x: 0, y: 0, z: -1 };
  private lisUp: Vec3Like = { x: 0, y: 1, z: 0 };
  private listenerIndoor = false;
  private ambParams: AmbienceParams | null = null;
  private desiredTrack: MusicTrackName = 'none';
  private combat = 0;
  private combatSmooth = 0;
  private calmTime = 0;
  private userSuspended = false;
  /** Short window after unlock() during which a still-starting context accepts sounds. */
  private startingUntil = 0;
  private chimeToken = 0;

  // Scheduler
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickWall = 0;
  private gapEstimate = TIMER_MS / 1000;

  constructor(opts: AudioEngineOptions = {}) {
    this.injected = opts.context ?? null;
    this.maxVoices = Math.max(4, opts.maxVoices ?? 32);
    this.hrtf = opts.hrtf ?? true;
  }

  /* ================================================================ lifecycle */

  /** Must be called from a user gesture (click/keydown). Safe to call many times. */
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
        if (ctx.state === 'running') ctx.suspend().catch(() => { /* ignore */ });
      } else if (ctx.state === 'suspended') {
        // Some browsers (Firefox) switch to 'running' asynchronously: accept sounds briefly.
        this.startingUntil = nowMs() + 500;
        ctx.resume().catch(() => { /* will retry on next gesture */ });
      }
    } catch {
      /* never throw from audio */
    }
  }

  /** True once the context exists and is running (always true for offline contexts after unlock). */
  get ready(): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.res) return false;
    return isRealtime(ctx) ? ctx.state === 'running' : true;
  }

  /** Running, or just unlocked and about to run (sounds may be scheduled). */
  private get canPlay(): boolean {
    if (this.ready) return true;
    const ctx = this.ctx;
    return !!ctx && !!this.res && isRealtime(ctx) && ctx.state === 'suspended' &&
      !this.userSuspended && nowMs() < this.startingUntil;
  }

  /** The underlying context (null before unlock). */
  get context(): BaseAudioContext | null { return this.ctx; }

  suspend(): void {
    this.userSuspended = true;
    const ctx = this.ctx;
    if (ctx && isRealtime(ctx) && ctx.state === 'running') ctx.suspend().catch(() => { /* ignore */ });
  }

  resume(): void {
    this.userSuspended = false;
    const ctx = this.ctx;
    if (ctx && isRealtime(ctx) && ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
  }

  /** Stops timers and closes the realtime context. The engine can be unlocked again afterwards. */
  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    if (ctx && isRealtime(ctx)) ctx.close().catch(() => { /* ignore */ });
    this.ctx = null; this.res = null; this.env = null;
    this.outNode = null; this.analyser = null;
    this.music = null; this.ambience = null;
    this.voices = []; this.dying = []; this.events = [];
    this.convolvers = [];
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
    // Impulse responses arrive asynchronously (generated in time slices).
    const street = conv(0.8);
    const room = conv(0.7);
    const hall = conv(0.6);
    this.sfxStreetSend = gainNode(ctx, 1); this.sfxStreetSend.connect(street);
    this.sfxRoomSend = gainNode(ctx, 1); this.sfxRoomSend.connect(room);
    this.ambStreetSend = gainNode(ctx, 1); this.ambStreetSend.connect(street);
    this.musicHallSend = gainNode(ctx, 1); this.musicHallSend.connect(hall);
    const setIR = (c: ConvolverNode, b: AudioBuffer | null): void => {
      if (b && !c.buffer) { try { c.buffer = b; } catch { /* ignore */ } }
    };
    res.onReady = (kind) => {
      if (this.res !== res) return;
      if (kind === 'streetIR') setIR(street, res.streetIR);
      else if (kind === 'roomIR') setIR(room, res.roomIR);
      else if (kind === 'hallIR') setIR(hall, res.hallIR);
      else if (kind !== 'footsteps') this.ambience?.onLoopReady(kind);
    };
    if (!isRealtime(ctx)) res.finishAll();

    const musicWet = gainNode(ctx, 0.35);
    musicWet.connect(this.musicHallSend);
    this.music = new MusicDirector(env, this.musicBus, musicWet);
    this.ambience = new Ambience(env, this.ambBus, this.ambStreetSend, ctx.currentTime);

    this.applyVolumes(true);
    this.applyListener();
    if (this.ambParams) this.setAmbience(this.ambParams);
    if (this.desiredTrack !== 'none') this.music.play(this.desiredTrack, ctx.currentTime, 2.5, 1);

    if (isRealtime(ctx)) {
      // Footsteps, reverbs and ambience loops are generated in ~6 ms slices after
      // unlock, keeping the user-gesture handler and frames fast.
      const pump = (): void => {
        if (this.res !== res) return;
        if (res.work(6)) setTimeout(pump, 4);
      };
      setTimeout(pump, 0);
      this.timer = setInterval(() => this.tick(), TIMER_MS);
    }
  }

  /* ================================================================ volumes & listener */

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

  /** Current (remembered) volume settings. */
  getVolumes(): VolumeSettings { return { ...this.volumes }; }

  private applyVolumes(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    // Squared taper: perceptually smoother sliders.
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

  /** Camera/listener position and orientation (Three.js world: y up, metres). */
  setListener(pos: Vec3Like, forward: Vec3Like, up?: Vec3Like): void {
    this.lisPos = v3(pos);
    const f = v3(forward);
    const fl = Math.hypot(f.x, f.y, f.z);
    if (fl > 1e-6) this.lisFwd = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
    let u = up ? v3(up) : { x: 0, y: 1, z: 0 };
    // Orthogonalise up against forward (avoids a degenerate frame when looking straight down).
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
        // Firefox: AudioListener has no AudioParams, use the legacy setters.
        L.setPosition(p.x, p.y, p.z);
        L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
      }
    } catch { /* ignore */ }
  }

  /** Enable/disable HRTF panning for new positional voices. */
  setHrtf(enabled: boolean): void { this.hrtf = enabled; }

  /* ================================================================ SFX */

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.ctx, res = this.res, env = this.env;
    if (!ctx || !res || !env || !this.canPlay || !this.sfxBus) return;
    const def: SfxDef | undefined = SFX[name];
    if (!def) return;
    try {
      this.playDef(ctx, res, name, def, opts);
    } catch {
      /* never throw from audio */
    }
  }

  private playDef(ctx: BaseAudioContext, res: AudioResources, name: SfxName, def: SfxDef, opts: PlayOptions): void {
    if (def.surface && res.footsteps[def.surface].length === 0) return; // still generating (first ~50 ms)
    const now = ctx.currentTime;
    const t = Math.max(now, opts.when ?? now + 0.005);
    const spatial: SpatialProfile | null = opts.pos && def.spatial ? def.spatial : null;
    let synth = def.synth;
    let dist = 0;
    if (spatial && opts.pos) {
      dist = dist3(this.lisPos, opts.pos);
      if (!Number.isFinite(dist) || dist > spatial.cull) return;
      if (def.far && dist > def.far.dist) synth = def.far.synth;
    }
    const vol = clamp(Number.isFinite(opts.volume) ? (opts.volume as number) : 1, 0, 4) * def.gain;
    if (vol < 0.0005) return;
    const pitch = clamp(Number.isFinite(opts.pitch) ? (opts.pitch as number) : 1, 0.25, 4);
    const att = spatial ? spatial.ref / (spatial.ref + spatial.rolloff * Math.max(0, dist - spatial.ref)) : 1;
    const score = vol * att * (1 + def.priority);

    this.reap(now);
    // Per-name instance cap: cut the oldest instance.
    let same = 0;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (v.name !== name) continue;
      same++;
      if (!oldest || v.start < oldest.start) oldest = v;
    }
    if (same >= def.maxInst && oldest) this.kill(oldest, now);
    // Global voice limit: steal the weakest (quiet / almost finished / low priority).
    if (this.voices.length >= this.maxVoices) {
      let weakest: Voice | null = null;
      let ws = Infinity;
      for (const v of this.voices) {
        const span = Math.max(0.01, v.end - v.start);
        const rem = clamp((v.end - now) / span, 0, 1);
        const s = v.score * (0.2 + 0.8 * rem);
        if (s < ws) { ws = s; weakest = v; }
      }
      if (!weakest || ws > score) return; // the new sound is the least important: drop it
      this.kill(weakest, now);
    }

    // Voice graph: out -> [air lp] -> [indoor muffle] -> [panner] -> sfxBus, + reverb send.
    const out = gainNode(ctx, vol);
    const nodes: AudioNode[] = [out];
    let tail: AudioNode = out;
    const indoor = opts.indoor ?? this.listenerIndoor;
    if (spatial && opts.pos) {
      if (dist > 20 && !def.surface) {
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
    const s: SfxCtx = { ctx, res, out, t, p: pitch };
    let end: number;
    setSourceCollector(sources);
    try {
      end = def.surface ? footstep(s, res.footsteps[def.surface], this.lastStep[def.surface]) : synth(s);
    } catch {
      for (const n of nodes) n.disconnect();
      for (const src of sources) { try { src.stop(); } catch { /* ignore */ } }
      return;
    } finally {
      setSourceCollector(null);
    }
    if (!Number.isFinite(end) || end < t) end = t + 0.5;
    this.voices.push({ name, out, nodes, sources, start: t, end: end + 0.05, score });
  }

  private kill(v: Voice, now: number): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    try {
      const g = v.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.03);
    } catch { /* ignore */ }
    for (const s of v.sources) {
      try { s.stop(now + 0.04); } catch { /* already stopped */ }
    }
    v.end = now + 0.1;
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
      try { n.disconnect(); } catch { /* ignore */ }
    }
  }

  /* ================================================================ ambience & music */

  setAmbience(p: AmbienceParams): void {
    this.ambParams = { ...p };
    this.listenerIndoor = !!p.indoor;
    this.combat = clamp(Number.isFinite(p.combat) ? p.combat : 0, 0, 1);
    const ctx = this.ctx;
    if (!ctx || !this.ambience) return;
    try { this.ambience.setParams(p, ctx.currentTime); } catch { /* ignore */ }
  }

  playMusic(track: MusicTrackName): void {
    this.desiredTrack = track;
    const ctx = this.ctx;
    const m = this.music;
    if (!ctx || !m) return;
    const cur = m.currentName;
    // 'game' and 'tension' are auto-managed from the combat level.
    if (track === 'game' && cur === 'tension') return;
    const now = ctx.currentTime;
    try {
      if (track === 'victory' || track === 'defeat') m.play(track, now, 0.05, 1.2);
      else m.play(track, now, 2.5, 2.5);
    } catch { /* ignore */ }
    this.calmTime = 0;
  }

  /** Name of the track currently playing (after automatic game/tension switching). */
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

  /* ================================================================ Big Ben */

  /**
   * Westminster Quarters followed by `hourCount` strikes of the hour bell.
   * Optional extra `quarter` (1..3) rings only that quarter's chime.
   */
  bellChime(hourCount: number, pos?: Vec3Like, quarter: 1 | 2 | 3 | 4 = 4): void {
    const ctx = this.ctx, env = this.env;
    if (!ctx || !env || !this.canPlay || !this.sfxBus) return;
    try {
      const token = ++this.chimeToken;
      const start = ctx.currentTime + 0.1;
      const plan = westminsterPlan(start, Number.isFinite(hourCount) ? hourCount : 12, quarter);
      if (!plan.length) return;
      const out = gainNode(ctx, 0.35);
      const nodes: AudioNode[] = [out];
      let tail: AudioNode = out;
      let send = 0.55;
      if (this.listenerIndoor) {
        // Heard through walls and windows.
        const m = biquad(ctx, 'lowpass', 1000, 0.6);
        const g = gainNode(ctx, 0.5);
        chain(out, m, g);
        tail = g;
        nodes.push(m, g);
        send = 0.3;
      }
      const pre = tail;
      if (pos) {
        const d = dist3(this.lisPos, pos);
        const lp = biquad(ctx, 'lowpass', clamp(26000 * Math.exp(-d / 220), 1500, 20000), 0.6);
        const pn = ctx.createPanner();
        pn.panningModel = 'equalpower';
        pn.distanceModel = 'inverse';
        pn.refDistance = 60;
        pn.rolloffFactor = 0.5;
        pn.maxDistance = 100000;
        if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = pos.y; pn.positionZ.value = pos.z; }
        else pn.setPosition(pos.x, pos.y, pos.z);
        chain(pre, lp, pn);
        tail = pn;
        nodes.push(lp, pn);
        send *= 0.8 + 0.55 * clamp(d / 400, 0, 1);
      } else {
        const lp = biquad(ctx, 'lowpass', 4500, 0.6);
        pre.connect(lp);
        tail = lp;
        nodes.push(lp);
      }
      tail.connect(this.sfxBus);
      const sg = gainNode(ctx, send);
      pre.connect(sg);
      sg.connect((this.listenerIndoor ? this.sfxRoomSend : this.sfxStreetSend) as GainNode);
      nodes.push(sg);
      let last = start;
      for (const s of plan) {
        last = Math.max(last, s.time);
        this.queue(s.time - 0.05, () => {
          if (token !== this.chimeToken || !this.env) return;
          towerStrike(this.env, out, s);
        });
      }
      // Clean-up after the final strike has rung out.
      this.queue(last + 12, () => { for (const n of nodes) n.disconnect(); });
    } catch { /* ignore */ }
  }

  /** Cancels a Big Ben sequence in progress (already-sounding strikes ring out). */
  stopChime(): void { this.chimeToken++; }

  /* ================================================================ scheduler */

  private queue(time: number, fn: (t: number) => void): void {
    const ev = { time, fn };
    const q = this.events;
    let i = q.length;
    while (i > 0 && q[i - 1].time > time) i--;
    q.splice(i, 0, ev);
  }

  /** Per-frame housekeeping: music sequencing, ambience events, voice clean-up, music auto-switch. */
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
    // Adaptive lookahead: covers timer throttling in background tabs.
    this.gapEstimate = Math.max(Math.min(gap, 5), this.gapEstimate * 0.97);
    const lookahead = clamp(this.gapEstimate * 1.6 + 0.08, LOOKAHEAD_MIN, LOOKAHEAD_MAX);
    const now = ctx.currentTime;
    this.runSchedulers(now, now + lookahead);
    this.reap(now);
  }

  private runSchedulers(now: number, until: number): void {
    try {
      while (this.events.length && this.events[0].time <= until) {
        const ev = this.events.shift() as QueuedEvent;
        ev.fn(Math.max(ev.time, now));
      }
      this.music?.schedule(now, until);
      this.ambience?.schedule(now, until);
    } catch {
      /* never throw from audio */
    }
  }

  /**
   * Offline helper: schedules every music/ambience/bell event up to `until`
   * seconds (an OfflineAudioContext's clock does not advance before rendering).
   */
  pump(until: number): void {
    if (!this.ctx) return;
    const step = 0.25;
    for (let t = 0; t < until; t += step) {
      this.autoMusic(step);
      this.runSchedulers(t, Math.min(until, t + step * 2));
    }
  }

  /** Optional extra: an AnalyserNode tapping the final output (VU meters, debugging). Null before unlock. */
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
      music: this.currentMusic,
      pendingEvents: this.events.length,
      loopsPending: this.res?.hasPendingJobs ?? true,
    };
  }

  /**
   * Renders audio offline (tests, previews, baking): creates an engine bound to an
   * OfflineAudioContext, runs `setup`, schedules everything and renders `seconds`.
   */
  static async renderOffline(
    seconds: number,
    setup: (engine: AudioEngine) => void,
    opts: { sampleRate?: number; maxVoices?: number; hrtf?: boolean } = {},
  ): Promise<AudioBuffer> {
    const sr = opts.sampleRate ?? 44100;
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sr)), sr);
    const eng = new AudioEngine({ context: ctx, maxVoices: opts.maxVoices, hrtf: opts.hrtf ?? false });
    eng.unlock();
    setup(eng);
    eng.pump(seconds);
    return ctx.startRendering();
  }
}

/** Shared engine instance for the whole game. */
export const audio = new AudioEngine();
