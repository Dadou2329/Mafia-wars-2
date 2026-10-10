/**
 * Ambiance générée de New York, 2085 : vent (violent sur les toits),
 * circulation et voitures volantes au loin, bourdonnement des néons, rumeur de
 * la foule, pluie sur la chaussée et gouttes dans les flaques, clapotis du
 * fleuve, métro (grondement, quai, crissements), ventilation des intérieurs ;
 * plus des évènements lointains au hasard : sirènes, drones, voitures
 * volantes, klaxons, ADAV, bouches à vapeur, métro sous la rue, chantier,
 * chiens, cornes de navires, mouettes ; sous terre : rames, crissements,
 * carillon et annonce du quai, gouttes ; à l'intérieur : basses du voisin,
 * tuyauterie, ascenseur.
 */
import { clamp } from './dsp';
import type { LoopKind, NoiseKind } from './resources';
import {
  ahrEnv, biquad, chain, expSweep, fmTone, gainNode, grains, noise, noiseBurst, osc, partials, pick, rnd,
  type SynthEnv, tone,
} from './synth';
import type { AmbienceParams } from './types';

type EventKind =
  | 'siren' | 'drone' | 'hover' | 'horn' | 'dog' | 'vtol' | 'steam' | 'subwayRumble' | 'construction'
  | 'boatHorn' | 'gulls'
  | 'trainPass' | 'trainScreech' | 'platformChime' | 'tunnelDrip'
  | 'neighbourBass' | 'pipes' | 'elevator';

const INTERVALS: Record<EventKind, readonly [number, number]> = {
  siren: [22, 55], drone: [14, 34], hover: [6, 15], horn: [9, 26], dog: [35, 80], vtol: [55, 130],
  steam: [25, 60], subwayRumble: [40, 90], construction: [30, 75],
  boatHorn: [45, 100], gulls: [8, 20],
  trainPass: [22, 45], trainScreech: [14, 32], platformChime: [30, 70], tunnelDrip: [3, 9],
  neighbourBass: [45, 110], pipes: [25, 60], elevator: [40, 90],
};

const clamp01 = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);

/**
 * Couche déconnectée du graphe tant qu'elle est muette : le navigateur cesse
 * alors de calculer ses sources et ses filtres.
 */
interface GatedLayer { g: GainNode; dest: AudioNode; on: boolean; offAt: number }

type Params = Required<AmbienceParams>;

/** Formants de syllabes pour les voix brouillées (annonces, radio). */
const BABBLE: ReadonlyArray<readonly [number, number]> = [[700, 1200], [500, 1800], [750, 1100], [550, 850], [350, 2100]];

export class Ambience {
  private readonly ctx: BaseAudioContext;
  private readonly outdoor: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly indoorBus: GainNode;
  private readonly underBus: GainNode;
  private readonly windG: GainNode;
  private readonly whistleG: GainNode;
  private readonly bustleG: GainNode;
  private readonly trafficG: GainNode;
  private readonly trafficLp: BiquadFilterNode;
  private readonly neonG: GainNode;
  private readonly neonFlick: GainNode;
  private readonly crowdG: GainNode;
  private readonly crowdLp: BiquadFilterNode;
  private readonly waterG: GainNode;
  private readonly rainG: GainNode;
  private readonly dripG: GainNode;
  private readonly rainRoofG: GainNode;
  private readonly rainRoofLp: BiquadFilterNode;
  private readonly roomG: GainNode;
  private readonly subwayG: GainNode;
  private p: Params = { night: 0, indoor: false, nearWater: 0, combat: 0, crowd: 0, rain: 0, underground: 0, altitude: 0 };
  private applied = false;
  private readonly next: Record<EventKind, number>;
  private nextFlicker = 0;
  private garbage: Array<{ at: number; nodes: AudioNode[] }> = [];
  private readonly gated: GatedLayer[] = [];

  constructor(private readonly e: SynthEnv, out: AudioNode, private readonly send: AudioNode, now: number) {
    const ctx = (this.ctx = e.ctx);
    this.outdoor = gainNode(ctx, 1);
    this.muffle = biquad(ctx, 'lowpass', 16000, 0.5);
    chain(this.outdoor, this.muffle, out);
    this.indoorBus = gainNode(ctx, 1);
    this.indoorBus.connect(out);
    this.underBus = gainNode(ctx, 1);
    this.underBus.connect(out);
    const sendU = gainNode(ctx, 0.5);
    chain(this.underBus, sendU, send);

    const mk = (dest: AudioNode): GainNode => { const g = gainNode(ctx, 0); g.connect(dest); return g; };
    const gated = (dest: AudioNode): GainNode => {
      const g = gainNode(ctx, 0);
      this.gated.push({ g, dest, on: false, offAt: Infinity });
      return g;
    };
    this.windG = mk(this.outdoor);
    this.whistleG = mk(this.outdoor);
    this.bustleG = mk(this.outdoor);
    this.trafficG = gated(this.outdoor);
    this.neonG = gated(this.outdoor);
    this.waterG = gated(this.outdoor);
    this.rainG = gated(this.outdoor);
    this.dripG = gated(this.outdoor);
    this.crowdG = gated(out);
    this.rainRoofG = gated(this.indoorBus);
    this.roomG = gated(this.indoorBus);
    this.subwayG = gated(this.underBus);
    this.trafficLp = biquad(ctx, 'lowpass', 3000, 0.6);
    this.trafficLp.connect(this.trafficG);
    this.crowdLp = biquad(ctx, 'lowpass', 2400, 0.6);
    this.crowdLp.connect(this.crowdG);
    this.rainRoofLp = biquad(ctx, 'lowpass', 800, 0.7);
    this.rainRoofLp.connect(this.rainRoofG);

    const t = now;
    // Vent : bruit brun à travers un passe-bas balayé par des LFO, avec des rafales lentes.
    const wlp = biquad(ctx, 'lowpass', 380, 0.6);
    this.lfo(0.071, 160, wlp.frequency, t);
    this.lfo(0.113, 90, wlp.frequency, t);
    const gust = gainNode(ctx, 0.7);
    this.lfo(0.047, 0.3, gust.gain, t);
    chain(this.loopNoise('brown', 1, t), wlp, gust, this.windG);
    // Sifflement du vent dans les antennes et les structures des toits.
    const wbp = biquad(ctx, 'bandpass', 850, 9);
    this.lfo(0.09, 260, wbp.frequency, t);
    const wamp = gainNode(ctx, 0.5);
    this.lfo(0.061, 0.5, wamp.gain, t);
    chain(this.loopNoise('pink', 0.9, t), wbp, wamp, this.whistleG);
    // Grondement sourd de la ville.
    chain(this.loopNoise('brown', 0.7, t), biquad(ctx, 'lowpass', 150, 0.7), this.bustleG);
    // Néons : bourdonnement à 120 Hz (secteur 60 Hz) avec quelques harmoniques.
    this.neonFlick = gainNode(ctx, 1);
    const neon = osc(ctx, 'sawtooth', 120, t, t + 1e7);
    const neon2 = osc(ctx, 'square', 240.4, t, t + 1e7);
    const nbp = biquad(ctx, 'bandpass', 1300, 0.6);
    neon.connect(nbp);
    chain(neon2, gainNode(ctx, 0.25), nbp);
    chain(nbp, biquad(ctx, 'highpass', 300, 0.7), this.neonFlick, this.neonG);

    this.next = {
      siren: t + rnd(6, 20), drone: t + rnd(4, 14), hover: t + rnd(1, 6), horn: t + rnd(3, 10), dog: t + rnd(10, 40),
      vtol: t + rnd(20, 60), steam: t + rnd(8, 25), subwayRumble: t + rnd(15, 40), construction: t + rnd(10, 30),
      boatHorn: t + rnd(15, 40), gulls: t + rnd(2, 8),
      trainPass: t + rnd(4, 12), trainScreech: t + rnd(3, 10), platformChime: t + rnd(6, 20), tunnelDrip: t + rnd(1, 4),
      neighbourBass: t + rnd(10, 30), pipes: t + rnd(8, 20), elevator: t + rnd(10, 30),
    };
    this.nextFlicker = t + rnd(3, 8);
    for (const k of ['traffic', 'crowd', 'water', 'rain', 'drip', 'hvac', 'subway'] as const) {
      if (e.res.loop(k)) this.onLoopReady(k);
    }
  }

  get indoor(): boolean { return this.p.indoor; }

  private get alt(): number { return clamp(this.p.altitude / 40, 0, 1); }

  /** Appelé quand un tampon de boucle précalculé devient disponible. */
  onLoopReady(kind: LoopKind): void {
    const buf = this.e.res.loop(kind);
    if (!buf) return;
    const t = this.ctx.currentTime;
    const start = (rate: number, dest: AudioNode): void => {
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.connect(dest);
      s.start(t, Math.random() * buf.duration);
    };
    switch (kind) {
      case 'traffic': start(1, this.trafficLp); start(0.94, this.trafficLp); break;
      case 'crowd': start(1, this.crowdLp); start(0.96, this.crowdLp); break;
      case 'water': start(1, this.waterG); start(0.93, this.waterG); break;
      case 'rain': start(1, this.rainG); start(0.97, this.rainRoofLp); break;
      case 'drip': start(1, this.dripG); break;
      case 'hvac': start(1, this.roomG); break;
      case 'subway': start(1, this.subwayG); start(0.91, this.subwayG); break;
    }
  }

  setParams(params: AmbienceParams, now: number): void {
    const p: Params = {
      night: clamp01(params.night), indoor: !!params.indoor, nearWater: clamp01(params.nearWater),
      combat: clamp01(params.combat), crowd: clamp01(params.crowd), rain: clamp01(params.rain ?? 0),
      underground: clamp01(params.underground ?? 0),
      altitude: Number.isFinite(params.altitude) ? Math.max(0, params.altitude as number) : 0,
    };
    const prev = this.p;
    const near = (a: number, b: number, eps = 0.005): boolean => Math.abs(a - b) <= eps;
    const changed = !this.applied || prev.indoor !== p.indoor ||
      !near(prev.night, p.night) || !near(prev.nearWater, p.nearWater) || !near(prev.crowd, p.crowd) ||
      !near(prev.rain, p.rain) || !near(prev.underground, p.underground) || !near(prev.altitude, p.altitude, 0.5);
    this.p = p;
    if (!changed) return;
    const first = !this.applied;
    this.applied = true;
    const n = p.night, d = 1 - n, w = p.nearWater, c = p.crowd, r = p.rain, i = p.indoor ? 1 : 0;
    const u = p.underground, a = this.alt;
    const tc = first ? 0.05 : 0.8;
    const ti = first ? 0.05 : 0.25;
    const set = (g: AudioParam, v: number, k = tc): void => {
      g.setTargetAtTime(v, now, k);
      const layer = this.gated.find((l) => l.g.gain === g);
      if (!layer) return;
      if (v > 1e-4) {
        if (!layer.on) { layer.g.connect(layer.dest); layer.on = true; }
        layer.offAt = Infinity;
      } else if (layer.on && layer.offAt === Infinity) {
        layer.offAt = now + k * 8 + 0.5;
      }
    };
    // Extérieur : le vent forcit en altitude, la circulation s'éloigne.
    set(this.windG.gain, Math.min(0.5, (0.07 + 0.07 * n + 0.06 * w + 0.05 * r) * (1 + 2.2 * a)));
    set(this.whistleG.gain, (0.01 + 0.03 * n) * (0.4 + 2.2 * a));
    set(this.bustleG.gain, (0.03 + 0.06 * d) * (1 - 0.5 * a));
    set(this.trafficG.gain, (0.16 + 0.12 * d) * (1 - 0.55 * a));
    set(this.trafficLp.frequency, 3200 - 2100 * a);
    set(this.neonG.gain, (0.004 + 0.012 * n) * (1 - 0.6 * a));
    set(this.waterG.gain, w * 0.35);
    // Pluie : averse sur la chaussée + gouttes dans les flaques (audibles même par pluie fine).
    set(this.rainG.gain, Math.pow(r, 1.4) * 0.42);
    set(this.dripG.gain, r > 0.001 ? Math.sqrt(r) * 0.22 : 0);
    // Foule : proche (même sur un quai de métro), étouffée par les murs à l'intérieur.
    set(this.crowdG.gain, c * (0.24 + 0.2 * d) * (i ? 0.45 : 1));
    set(this.crowdLp.frequency, i ? 600 : 1400 + 1400 * c);
    // Intérieur et métro.
    set(this.rainRoofG.gain, r * 0.35 * i * (1 - u), ti);
    set(this.roomG.gain, i * 0.32 * (1 - u), ti);
    set(this.subwayG.gain, u * 0.4, ti);
    set(this.outdoor.gain, (i ? 0.4 : 1) * (1 - 0.9 * u), ti);
    const cut = Math.min(i ? 650 : 16000, 16000 * (1 - u) + 300 * u);
    set(this.muffle.frequency, cut, ti);
  }

  /** Lance les évènements aléatoires qui commencent avant `until`. */
  schedule(now: number, until: number): void {
    this.collect(now);
    for (const l of this.gated) {
      if (l.on && now >= l.offAt) { l.g.disconnect(); l.on = false; l.offAt = Infinity; }
    }
    if (!this.applied) return;
    const p = this.p;
    const d = 1 - p.night, n = p.night, w = p.nearWater, i = p.indoor ? 1 : 0, u = p.underground, a = this.alt;
    const street = 1 - u;
    const prob: Record<EventKind, number> = {
      // Le jour : plus de circulation et moins de sirènes.
      siren: street * (0.2 + 0.55 * n),
      drone: street * (0.3 + 0.35 * a),
      hover: street * Math.min(1, (0.35 + 0.3 * d) * (1 + 0.8 * a)),
      horn: street * (0.2 + 0.5 * d) * (1 - 0.7 * a),
      dog: street * 0.35 * n * (1 - a),
      vtol: street * (0.3 + 0.25 * a),
      steam: street * 0.5 * (1 - a),
      subwayRumble: street * 0.4 * (1 - a),
      construction: street * 0.45 * d * (1 - 0.5 * a),
      boatHorn: w > 0.2 ? street * w * 0.7 : 0,
      gulls: w > 0.15 ? street * w * d * 0.8 : 0,
      trainPass: u,
      trainScreech: u * 0.7,
      platformChime: u * 0.6,
      tunnelDrip: u * 0.5,
      neighbourBass: i * (0.15 + 0.5 * n) * street,
      pipes: i * 0.5 * street,
      elevator: i * 0.4 * street,
    };
    for (const k of Object.keys(this.next) as EventKind[]) {
      let tt = this.next[k];
      if (tt < now - 2) tt = now + rnd(1, 5); // resynchronisation après un arrêt
      while (tt < until) {
        if (Math.random() < prob[k]) this.fire(k, Math.max(tt, now));
        const [lo, hi] = INTERVALS[k];
        tt += rnd(lo, hi);
      }
      this.next[k] = tt;
    }
    // Néons qui grésillent et clignotent.
    if (this.nextFlicker < now - 2) this.nextFlicker = now + rnd(1, 4);
    while (this.nextFlicker < until) {
      if (street > 0.5 && !i) this.flicker(Math.max(this.nextFlicker, now));
      this.nextFlicker += rnd(4, 12);
    }
  }

  /* ---------------------------------------------------------------- aides */

  private lfo(freq: number, depth: number, target: AudioParam, t: number): void {
    const o = osc(this.ctx, 'sine', freq * rnd(0.9, 1.1), t, t + 1e7);
    const g = gainNode(this.ctx, depth);
    chain(o, g);
    g.connect(target);
  }

  private loopNoise(kind: NoiseKind, rate: number, t: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    const buf = this.e.res.noise(kind);
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t, Math.random() * buf.duration);
    return s;
  }

  /** Bus d'évènement placé en stéréo et filtré par la distance, déconnecté après `life` secondes. */
  private place(
    t: number, life: number, pan: number, cutoff: number, gain: number, sendAmt: number, bus: AudioNode = this.outdoor,
  ): { input: GainNode; panner: StereoPannerNode; level: GainNode } {
    const ctx = this.ctx;
    const input = gainNode(ctx, 1);
    const lp = biquad(ctx, 'lowpass', cutoff, 0.6);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    const level = gainNode(ctx, gain);
    chain(input, lp, panner, level, bus);
    const nodes: AudioNode[] = [input, lp, panner, level];
    if (sendAmt > 0 && bus !== this.underBus) {
      const s = gainNode(ctx, sendAmt);
      chain(lp, s, this.send);
      nodes.push(s);
    }
    this.garbage.push({ at: t + life + 3, nodes });
    return { input, panner, level };
  }

  /** Passage de gauche à droite (ou l'inverse) : panoramique et enveloppe d'approche. */
  private pass(ev: { panner: StereoPannerNode; level: GainNode }, t: number, T: number, dir: number, width = 0.85): void {
    ev.panner.pan.setValueAtTime(-width * dir, t);
    ev.panner.pan.linearRampToValueAtTime(width * dir, t + T);
    const pk = Math.max(0.0002, ev.level.gain.value);
    ev.level.gain.setValueAtTime(0.0001, t);
    ev.level.gain.exponentialRampToValueAtTime(pk, t + T * 0.5);
    ev.level.gain.exponentialRampToValueAtTime(0.0001, t + T);
  }

  private collect(now: number): void {
    if (!this.garbage.length) return;
    this.garbage = this.garbage.filter((g) => {
      if (g.at > now) return true;
      for (const n of g.nodes) n.disconnect();
      return false;
    });
  }

  private fire(k: EventKind, t: number): void {
    switch (k) {
      case 'siren': this.siren(t); break;
      case 'drone': this.drone(t); break;
      case 'hover': this.hover(t); break;
      case 'horn': this.horn(t); break;
      case 'dog': this.dog(t); break;
      case 'vtol': this.vtol(t); break;
      case 'steam': this.steam(t); break;
      case 'subwayRumble': this.subwayRumble(t); break;
      case 'construction': this.construction(t); break;
      case 'boatHorn': this.boatHorn(t); break;
      case 'gulls': this.gulls(t); break;
      case 'trainPass': this.trainPass(t); break;
      case 'trainScreech': this.trainScreech(t); break;
      case 'platformChime': this.platformChime(t); break;
      case 'tunnelDrip': this.tunnelDrip(t); break;
      case 'neighbourBass': this.neighbourBass(t); break;
      case 'pipes': this.pipes(t); break;
      case 'elevator': this.elevator(t); break;
    }
  }

  /** Voix brouillée (annonce du quai) : syllabes à formants qui sautent. */
  private babble(t: number, dur: number, dest: AudioNode, level: number): void {
    const ctx = this.ctx;
    const f0 = rnd(100, 140);
    const v = osc(ctx, 'sawtooth', f0, t, t + dur + 0.05);
    const f1 = biquad(ctx, 'bandpass', 700, 4);
    const f2 = biquad(ctx, 'bandpass', 1500, 5);
    const env = gainNode(ctx, 0);
    env.gain.setValueAtTime(0, t);
    let tt = t;
    while (tt < t + dur - 0.06) {
      const sd = rnd(0.07, 0.16);
      const [a, b] = pick(BABBLE);
      const lvl = rnd(0.5, 1) * level;
      f1.frequency.setValueAtTime(a, tt);
      f2.frequency.setValueAtTime(b, tt);
      v.frequency.setValueAtTime(f0 * rnd(0.9, 1.2), tt);
      env.gain.setValueAtTime(0, tt);
      env.gain.linearRampToValueAtTime(lvl, tt + 0.015);
      env.gain.setValueAtTime(lvl, tt + sd - 0.02);
      env.gain.linearRampToValueAtTime(0, tt + sd);
      tt += sd + rnd(0.01, 0.06);
    }
    v.connect(f1);
    f1.connect(env);
    chain(v, f2, gainNode(ctx, 0.6), env);
    env.connect(dest);
  }

  private flicker(t: number): void {
    const g = this.neonFlick.gain;
    const n = 2 + Math.floor(Math.random() * 5);
    let tt = t;
    for (let k = 0; k < n; k++) {
      g.setValueAtTime(rnd(0, 0.35), tt);
      g.setValueAtTime(1, tt + rnd(0.012, 0.05));
      tt += rnd(0.04, 0.12);
    }
    const hits: Array<[number, number]> = [];
    for (let k = 0; k < n * 2; k++) hits.push([rnd(0, tt - t), rnd(0.05, 0.25)]);
    grains(this.e, this.neonG, t, hits, { type: 'highpass', freq: 3500, tau: 0.002 });
  }

  /* ---------------------------------------------------------------- rue */

  /** Sirène lointaine qui passe (« wail » ou « yelp »), avec effet Doppler. */
  private siren(t: number): void {
    const ctx = this.ctx;
    const T = rnd(7, 11);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const ev = this.place(t, T, -0.8 * dir, rnd(1800, 3200), rnd(0.05, 0.12), 0.6);
    this.pass(ev, t, T, dir, 0.8);
    const o = osc(ctx, 'sawtooth', 650, t, t + T + 0.1);
    const f = o.frequency;
    f.setValueAtTime(650, t);
    const yelp = Math.random() < 0.4;
    let tt = t;
    while (tt < t + T) {
      const u = (tt - t) / T;
      const dop = 1.04 - 0.08 * (0.5 + 0.5 * Math.tanh(6 * (u - 0.5)));
      if (yelp) {
        f.exponentialRampToValueAtTime(1450 * dop, tt + 0.16);
        f.exponentialRampToValueAtTime(720 * dop, tt + 0.33);
        tt += 0.33;
      } else {
        f.exponentialRampToValueAtTime(1420 * dop, tt + 1.5);
        f.exponentialRampToValueAtTime(640 * dop, tt + 3.6);
        tt += 3.6;
      }
    }
    chain(o, biquad(ctx, 'bandpass', 1200, 0.8), gainNode(ctx, 0.5), ev.input);
  }

  /** Drone qui survole : rotors en battement, sifflement de moteur. */
  private drone(t: number): void {
    const ctx = this.ctx;
    const T = rnd(3, 5.5);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const ev = this.place(t, T, -0.8 * dir, rnd(2500, 4500), rnd(0.03, 0.07) * (1 + this.alt), 0.25);
    this.pass(ev, t, T, dir, 0.8);
    const lp = biquad(ctx, 'lowpass', 2500, 0.7);
    lp.connect(ev.input);
    for (const f of [rnd(180, 200), rnd(205, 215)]) {
      const o = osc(ctx, 'sawtooth', f * 1.05, t, t + T + 0.05);
      o.frequency.setValueAtTime(f * 1.05, t);
      o.frequency.linearRampToValueAtTime(f * 0.95, t + T);
      chain(o, gainNode(ctx, 0.3), lp);
    }
    const wv = osc(ctx, 'sine', 1300, t, t + T + 0.05);
    wv.frequency.setValueAtTime(1360, t);
    wv.frequency.linearRampToValueAtTime(1240, t + T);
    chain(wv, gainNode(ctx, 0.05), ev.input);
  }

  /** Voiture volante : souffle et turbine (plus proches et plus fréquentes sur les toits, voies aériennes). */
  private hover(t: number): void {
    const ctx = this.ctx;
    const a = this.alt;
    const T = rnd(2.5, 4.5);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const ev = this.place(t, T, -0.85 * dir, rnd(1800, 3000) + 2500 * a, rnd(0.05, 0.12) * (1 + 1.5 * a), 0.3);
    this.pass(ev, t, T, dir);
    const nz = noise(this.e, 'pink', t, T + 0.05);
    const bp = biquad(ctx, 'bandpass', 2200, 0.8);
    expSweep(bp.frequency, t, 2200, 700, T);
    chain(nz, bp, gainNode(ctx, 0.8), ev.input);
    const fw = rnd(700, 1300);
    const o = osc(ctx, 'sine', fw, t, t + T + 0.05);
    o.frequency.setValueAtTime(fw * 1.1, t);
    o.frequency.setTargetAtTime(fw * 0.88, t + T * 0.4, T * 0.12);
    chain(o, gainNode(ctx, 0.12), ev.input);
  }

  /** Klaxons au loin (taxis pressés). */
  private horn(t: number): void {
    const ctx = this.ctx;
    const ev = this.place(t, 3, rnd(-0.9, 0.9), rnd(1500, 2600), rnd(0.04, 0.09), 0.5);
    const f = rnd(340, 480);
    const pattern = pick<ReadonlyArray<readonly [number, number]>>([
      [[0, 0.12], [0.18, 0.4]], [[0, 0.6]], [[0, 0.1], [0.15, 0.1], [0.3, 0.1]], [[0, 0.9]],
    ]);
    const [ls, ld] = pattern[pattern.length - 1];
    const stop = t + ls + ld + 0.1;
    const oA = osc(ctx, 'sawtooth', f, t, stop);
    const oB = osc(ctx, 'square', f * 1.26, t, stop);
    const env = gainNode(ctx, 0);
    env.gain.setValueAtTime(0, t);
    for (const [st, du] of pattern) {
      env.gain.setValueAtTime(0, t + st);
      env.gain.linearRampToValueAtTime(0.5, t + st + 0.015);
      env.gain.setValueAtTime(0.5, t + st + du - 0.02);
      env.gain.linearRampToValueAtTime(0, t + st + du);
    }
    const bp = biquad(ctx, 'bandpass', 900, 0.9);
    oA.connect(bp);
    chain(oB, gainNode(ctx, 0.7), bp);
    chain(bp, env, ev.input);
  }

  private dog(t: number): void {
    const ctx = this.ctx;
    const { input } = this.place(t, 3, rnd(-0.9, 0.9), rnd(1300, 2200), rnd(0.06, 0.14), 0.55);
    const bp = biquad(ctx, 'bandpass', rnd(850, 1100), 1.4);
    bp.connect(input);
    const n = 2 + Math.floor(Math.random() * 3);
    const f0 = rnd(380, 560);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const o = osc(ctx, 'sawtooth', f0, tt, tt + 0.25);
      expSweep(o.frequency, tt, f0 * 1.15, f0 * 0.6, 0.11);
      const g = gainNode(ctx, 0);
      ahrEnv(g.gain, tt, 0.9, 0.008, 0.035, 0.03);
      chain(o, g, bp);
      noiseBurst(this.e, bp, tt, { type: 'highpass', freq: 600, peak: 0.25, attack: 0.005, tau: 0.03 });
      tt += rnd(0.28, 0.45);
    }
  }

  /** ADAV qui traverse le ciel : rugissement, pulsation des soufflantes, turbine. */
  private vtol(t: number): void {
    const ctx = this.ctx;
    const T = rnd(8, 12);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const ev = this.place(t, T, -0.9 * dir, 2500, rnd(0.05, 0.1) * (1 + 0.6 * this.alt), 0.5);
    this.pass(ev, t, T, dir, 0.9);
    chain(noise(this.e, 'pink', t, T + 0.05), biquad(ctx, 'lowpass', 1500, 0.6), gainNode(ctx, 0.9), ev.input);
    const am = gainNode(ctx, 0.5);
    const lf = osc(ctx, 'sine', 17, t, t + T + 0.05);
    chain(lf, gainNode(ctx, 0.5), am.gain);
    chain(noise(this.e, 'brown', t, T + 0.05), biquad(ctx, 'bandpass', 160, 1), am, ev.input);
    for (const [f, g] of [[2100, 0.03], [3150, 0.018]] as const) {
      const o = osc(ctx, 'sine', f, t, t + T + 0.05);
      o.frequency.setValueAtTime(f * 1.06, t);
      o.frequency.setTargetAtTime(f * 0.94, t + T * 0.4, T * 0.12);
      chain(o, gainNode(ctx, g), ev.input);
    }
  }

  /** Bouche à vapeur : sifflement irrégulier et gargouillis. */
  private steam(t: number): void {
    const ctx = this.ctx;
    const T = rnd(2, 4);
    const ev = this.place(t, T, rnd(-0.7, 0.7), 7000, rnd(0.03, 0.06), 0.2);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.3);
    for (let tt = t + 0.4; tt < t + T - 0.3; tt += rnd(0.08, 0.2)) g.gain.linearRampToValueAtTime(rnd(0.55, 1), tt);
    g.gain.linearRampToValueAtTime(0, t + T);
    chain(noise(this.e, 'white', t, T + 0.05), biquad(ctx, 'highpass', 1500, 0.7), biquad(ctx, 'bandpass', 3500, 0.6), g, ev.input);
    const am = gainNode(ctx, 0.25);
    chain(osc(ctx, 'sine', rnd(5, 8), t, t + T), gainNode(ctx, 0.2), am.gain);
    chain(noise(this.e, 'brown', t, T + 0.05), biquad(ctx, 'lowpass', 220, 0.8), am, ev.input);
  }

  /** Une rame passe sous la rue : grondement à travers les grilles, joints de rail. */
  private subwayRumble(t: number): void {
    const ctx = this.ctx;
    const T = rnd(5, 7);
    const ev = this.place(t, T, rnd(-0.4, 0.4), 500, rnd(0.08, 0.14), 0.1);
    this.pass(ev, t, T, Math.random() < 0.5 ? -1 : 1, 0.3);
    chain(noise(this.e, 'brown', t, T + 0.05), biquad(ctx, 'lowpass', 90, 0.8), ev.input);
    const clacks: Array<[number, number]> = [];
    for (let tt = 0.3; tt < T - 0.3; tt += rnd(0.32, 0.4)) clacks.push([tt, 0.5], [tt + 0.07, 0.4]);
    grains(this.e, ev.input, t, clacks, { kind: 'pink', type: 'lowpass', freq: 400, tau: 0.02 });
  }

  /** Chantier lointain : marteau-piqueur et coups de métal. */
  private construction(t: number): void {
    const T = rnd(1.2, 3);
    const ev = this.place(t, T + 1, rnd(-0.9, 0.9), rnd(2000, 3500), rnd(0.03, 0.06), 0.5);
    const hits: Array<[number, number]> = [];
    for (let tt = 0; tt < T; tt += 1 / rnd(18, 22)) hits.push([tt, rnd(0.5, 1)]);
    grains(this.e, ev.input, t, hits, { type: 'bandpass', freq: 1800, q: 1, tau: 0.006 });
    grains(this.e, ev.input, t, hits.map(([o, a]) => [o, a * 0.8] as const), { kind: 'pink', type: 'lowpass', freq: 300, tau: 0.015 });
    if (Math.random() < 0.5) {
      let tt = t + T + rnd(0.2, 0.5);
      for (let k = 0; k < 2; k++) {
        partials(this.e, ev.input, tt, rnd(550, 700), 0.3, [[1, 1, 0.25], [2.76, 0.5, 0.15], [5.4, 0.25, 0.08]]);
        tt += rnd(0.4, 0.6);
      }
    }
  }

  /** Corne grave d'un cargo ou d'un ferry sur le fleuve. */
  private boatHorn(t: number): void {
    const ctx = this.ctx;
    const { input } = this.place(t, 9, rnd(-0.7, 0.7), 650, 0.22, 0.7);
    const lp = biquad(ctx, 'lowpass', 420, 1);
    lp.connect(input);
    const blasts = Math.random() < 0.5 ? 1 : 2;
    const f = rnd(68, 78);
    for (let b = 0; b < blasts; b++) {
      const tb = t + b * 4;
      const env = gainNode(ctx, 0);
      const hold = rnd(1.8, 2.4);
      const end = ahrEnv(env.gain, tb, 0.5, 0.35, hold, 0.35);
      for (const [mul, det, v] of [[1, -6, 0.5], [1, 7, 0.5], [0.5, 0, 0.6]] as const) {
        const o = osc(ctx, 'sawtooth', f * mul, tb, end, det);
        chain(o, gainNode(ctx, v), env);
      }
      env.connect(lp);
    }
  }

  private gulls(t: number): void {
    const ctx = this.ctx;
    const { input } = this.place(t, 3, rnd(-0.9, 0.9), 6000, rnd(0.05, 0.1), 0.4);
    const bp = biquad(ctx, 'bandpass', 2200, 1);
    bp.connect(input);
    const n = 2 + Math.floor(Math.random() * 3);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = rnd(1350, 1700);
      const dur = rnd(0.3, 0.45);
      const o = osc(ctx, 'triangle', f, tt, tt + dur + 0.5);
      o.frequency.setValueAtTime(f, tt);
      o.frequency.linearRampToValueAtTime(f * 1.5, tt + 0.06);
      o.frequency.exponentialRampToValueAtTime(f * 0.8, tt + dur);
      const vib = osc(ctx, 'sine', rnd(16, 22), tt, tt + dur + 0.5);
      chain(vib, gainNode(ctx, 45), o.frequency);
      const g = gainNode(ctx, 0);
      ahrEnv(g.gain, tt, 0.8, 0.02, dur * 0.5, dur * 0.15);
      chain(o, g, bp);
      tt += dur + rnd(0.12, 0.35);
    }
  }

  /* ---------------------------------------------------------------- métro */

  /** Rame qui traverse la station voisine : grondement, roues, joints, moteurs. */
  private trainPass(t: number): void {
    const ctx = this.ctx;
    const T = rnd(6, 9);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const ev = this.place(t, T, -0.9 * dir, rnd(1500, 2500), rnd(0.12, 0.22), 0, this.underBus);
    this.pass(ev, t, T, dir, 0.9);
    chain(noise(this.e, 'brown', t, T + 0.05), biquad(ctx, 'lowpass', 160, 0.8), gainNode(ctx, 1.2), ev.input);
    chain(noise(this.e, 'pink', t, T + 0.05), biquad(ctx, 'bandpass', 900, 0.7), gainNode(ctx, 0.25), ev.input);
    const clacks: Array<[number, number]> = [];
    for (let tt = 0.2; tt < T - 0.2; tt += rnd(0.17, 0.2)) clacks.push([tt, 0.4], [tt + 0.05, 0.3]);
    grains(this.e, ev.input, t, clacks, { type: 'bandpass', freq: 1200, q: 1.3, tau: 0.006 });
    grains(this.e, ev.input, t, clacks, { kind: 'pink', type: 'lowpass', freq: 300, tau: 0.015 });
    const m = osc(ctx, 'sawtooth', 600, t, t + T + 0.05);
    m.frequency.setValueAtTime(620, t);
    m.frequency.linearRampToValueAtTime(450, t + T);
    chain(m, biquad(ctx, 'bandpass', 900, 2), gainNode(ctx, 0.04), ev.input);
  }

  /** Crissement des roues dans une courbe du tunnel (frottement saccadé). */
  private trainScreech(t: number): void {
    const ctx = this.ctx;
    const T = rnd(1.8, 3.5);
    const { input } = this.place(t, T, rnd(-0.8, 0.8), 7000, rnd(0.025, 0.05), 0, this.underBus);
    for (let k = 0; k < 2; k++) {
      const f = rnd(2600, 3800);
      const o = osc(ctx, 'triangle', f, t, t + T + 0.05);
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * rnd(0.95, 1.05), t + T);
      chain(osc(ctx, 'sine', rnd(9, 12), t, t + T + 0.05), gainNode(ctx, 40), o.frequency);
      const am = gainNode(ctx, 0.5);
      chain(osc(ctx, 'sine', rnd(13, 17), t, t + T + 0.05), gainNode(ctx, 0.5), am.gain);
      const env = gainNode(ctx, 0);
      ahrEnv(env.gain, t + k * rnd(0.1, 0.4), k ? 0.6 : 1, 0.2, T * 0.6, 0.15);
      chain(o, am, env, input);
    }
  }

  /** Carillon du quai suivi d'une annonce inintelligible dans les haut-parleurs. */
  private platformChime(t: number): void {
    const ctx = this.ctx;
    const { input } = this.place(t, 4.5, rnd(-0.5, 0.5), 3500, rnd(0.05, 0.08), 0, this.underBus);
    fmTone(this.e, input, t, { freq: 659.3, ratio: 2, index: 0.8, peak: 0.5, tau: 0.35 });
    fmTone(this.e, input, t + 0.4, { freq: 523.3, ratio: 2, index: 0.8, peak: 0.5, tau: 0.5 });
    // Haut-parleur : bande étroite et saturée.
    const pa = gainNode(ctx, 1);
    const sh = ctx.createWaveShaper();
    sh.curve = this.e.res.shaperCurve(3);
    chain(pa, biquad(ctx, 'highpass', 450, 0.7), biquad(ctx, 'lowpass', 3000, 0.8), sh, gainNode(ctx, 0.5), input);
    this.babble(t + 1.1, rnd(1.4, 2.4), pa, 1);
  }

  private tunnelDrip(t: number): void {
    const { input } = this.place(t, 1, rnd(-0.9, 0.9), 6000, rnd(0.04, 0.08), 0, this.underBus);
    const f = rnd(900, 1600);
    tone(this.e, input, t, { freq: f, freqEnd: f * 1.6, sweep: 0.02, peak: 0.5, attack: 0.001, tau: 0.025 });
    noiseBurst(this.e, input, t, { type: 'highpass', freq: 2500, peak: 0.2, attack: 0.0003, tau: 0.002 });
  }

  /* ---------------------------------------------------------------- intérieur */

  /** Musique du voisin à travers le mur : grosse caisse et basse étouffées. */
  private neighbourBass(t: number): void {
    const ctx = this.ctx;
    const beat = 60 / 124;
    const bars = 2 + Math.floor(Math.random() * 3);
    const T = bars * 4 * beat;
    const lvl = gainNode(ctx, 0);
    const L = rnd(0.08, 0.13);
    lvl.gain.setValueAtTime(0, t);
    lvl.gain.linearRampToValueAtTime(L, t + 1.5);
    lvl.gain.setValueAtTime(L, t + T - 1.5);
    lvl.gain.linearRampToValueAtTime(0, t + T);
    const lp = biquad(ctx, 'lowpass', 160, 0.7);
    chain(lp, lvl, this.indoorBus);
    const roots = pick([[55, 55, 49, 43.65], [55, 41.2, 43.65, 49]]);
    for (let b = 0; b < bars * 4; b++) {
      const tb = t + b * beat;
      tone(this.e, lp, tb, { freq: 60, freqEnd: 42, sweep: 0.08, peak: 0.7, attack: 0.002, tau: 0.1 });
      tone(this.e, lp, tb + beat / 2, { type: 'triangle', freq: roots[Math.floor(b / 4) % 4], peak: 0.35, attack: 0.005, hold: beat * 0.3, tau: 0.04 });
    }
    this.garbage.push({ at: t + T + 3, nodes: [lp, lvl] });
  }

  /** Tuyauterie qui cogne dans les murs. */
  private pipes(t: number): void {
    const ctx = this.ctx;
    const lp = biquad(ctx, 'lowpass', 1500, 0.7);
    const g = gainNode(ctx, rnd(0.08, 0.15));
    chain(lp, g, this.indoorBus);
    const n = 2 + Math.floor(Math.random() * 4);
    const f0 = rnd(180, 300);
    let tt = t;
    for (let k = 0; k < n; k++) {
      partials(this.e, lp, tt, f0 * rnd(0.98, 1.02), 0.5, [[1, 1, 0.08], [2.4, 0.5, 0.05], [4.1, 0.25, 0.03]]);
      noiseBurst(this.e, lp, tt, { kind: 'pink', type: 'lowpass', freq: 300, peak: 0.6, attack: 0.001, tau: 0.02 });
      tt += rnd(0.12, 0.6);
    }
    this.garbage.push({ at: tt + 3, nodes: [lp, g] });
  }

  /** Ascenseur à un autre étage : « ding » lointain et portes. */
  private elevator(t: number): void {
    const ctx = this.ctx;
    const lp = biquad(ctx, 'lowpass', 2500, 0.7);
    const g = gainNode(ctx, rnd(0.04, 0.07));
    chain(lp, g, this.indoorBus);
    fmTone(this.e, lp, t, { freq: 1318.5, ratio: 3.5, index: 1.2, peak: 0.5, tau: 0.5 });
    noiseBurst(this.e, lp, t + 0.5, { kind: 'pink', type: 'bandpass', freq: 600, q: 0.7, peak: 0.4, attack: 0.15, tau: 0.15 });
    this.garbage.push({ at: t + 5, nodes: [lp, g] });
  }
}
