/**
 * Musique procédurale synthwave sombre / néo-noir. Chaque morceau programme
 * ses notes à l'avance sur l'horloge de l'AudioContext (`schedule(from,
 * until)` est appelé par l'ordonnanceur à anticipation du moteur, depuis une
 * minuterie et depuis update()).
 *
 *  - menu    : thème en la mineur, saxophone noir sur arpèges, basse pulsée,
 *              batterie à réverbération coupée, nappes « pompées » par la grosse caisse
 *  - game    : pulsation ambiante calme, accords qui dérivent, cloches de verre rares
 *  - tension : combat, basse en doubles croches et batterie, couches selon l'intensité
 *  - victory : fanfare de cuivres synthétiques en do majeur
 *  - defeat  : complainte de saxophone, glas, nappes sombres
 */
import { midiHz } from './dsp';
import { brass, cymbal, drum, fmBell, pad, pluck, riser, saxLead, synthBass, synthStab } from './instruments';
import { biquad, chain, gainNode, type SynthEnv } from './synth';
import type { MusicTrackName } from './types';

export interface Track {
  readonly name: Exclude<MusicTrackName, 'none'>;
  /** Instant absolu de fin pour les morceaux uniques, Infinity pour les boucles. */
  readonly endTime: number;
  /** Programme tous les évènements qui commencent avant `until`. */
  schedule(from: number, until: number): void;
  /** 0..1 intensité musicale (utilisée par 'tension'). */
  setIntensity(x: number): void;
  /** Libère les nœuds persistants du morceau (délais, pompe). */
  dispose(): void;
}

const hz = midiHz;
const humanize = (amt = 0.008): number => (Math.random() * 2 - 1) * amt;
const vary = (v: number, amt = 0.12): number => v * (1 + (Math.random() * 2 - 1) * amt);
const pickOf = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Écho stéréo-libre (croche pointée) avec réinjection filtrée : quelques nœuds persistants par morceau. */
class DelayFx {
  readonly input: GainNode;
  private readonly nodes: AudioNode[];
  constructor(ctx: BaseAudioContext, dest: AudioNode, time: number, feedback: number, wet: number, tone = 2600) {
    this.input = gainNode(ctx, 1);
    const d = ctx.createDelay(2);
    d.delayTime.value = Math.min(1.9, time);
    const lp = biquad(ctx, 'lowpass', tone, 0.6);
    const fb = gainNode(ctx, feedback);
    const w = gainNode(ctx, wet);
    chain(this.input, d, lp, fb, d);
    chain(lp, w, dest);
    this.nodes = [this.input, d, lp, fb, w];
  }
  dispose(): void { for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignorer */ } } }
}

/** « Pompe » de sidechain : la grosse caisse fait respirer les nappes. */
function duck(g: GainNode, t: number, depth = 0.5): void {
  g.gain.setValueAtTime(1 - depth, t);
  g.gain.setTargetAtTime(1, t + 0.01, 0.11);
}

interface Chord { root: number; pad: readonly number[]; arp: readonly number[] }

/** Accords (la mineur avec le mi majeur de la mineure harmonique, pour la couleur « mafia »). */
const CH: Record<'Am' | 'F' | 'C' | 'G' | 'E' | 'Dm' | 'Bb', Chord> = {
  Am: { root: 45, pad: [57, 60, 64, 67], arp: [64, 69, 72, 76] },
  F: { root: 41, pad: [53, 57, 60, 64], arp: [65, 69, 72, 77] },
  C: { root: 48, pad: [52, 55, 60, 64], arp: [64, 67, 72, 76] },
  G: { root: 43, pad: [55, 59, 62, 64], arp: [62, 67, 71, 74] },
  E: { root: 40, pad: [52, 56, 59, 62], arp: [64, 68, 71, 76] },
  Dm: { root: 38, pad: [53, 57, 62, 64], arp: [62, 65, 69, 74] },
  Bb: { root: 46, pad: [53, 58, 62, 65], arp: [62, 65, 70, 74] },
};

/* ================================================================== menu : « Néons & Plomb » */

const MENU_PROG: ReadonlyArray<keyof typeof CH> = [
  'Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'E',
  'Dm', 'Dm', 'Am', 'Am', 'F', 'G', 'Am', 'E',
];

/** [temps, durée en temps, midi] par mesure (4/4). */
type Note = readonly [number, number, number];
const MENU_MELODY: ReadonlyArray<ReadonlyArray<Note>> = [
  [[0, 1.5, 76], [1.5, 0.5, 77], [2, 1, 76], [3, 1, 72]],
  [[0, 2.5, 69], [2.5, 0.5, 71], [3, 1, 72]],
  [[0, 1.5, 74], [1.5, 0.5, 72], [2, 1, 69], [3, 1, 65]],
  [[0, 3.5, 69]],
  [[0, 1.5, 76], [1.5, 0.5, 77], [2, 1, 79], [3, 1, 76]],
  [[0, 2, 72], [2, 1, 74], [3, 1, 76]],
  [[0, 1.5, 74], [1.5, 0.5, 72], [2, 1, 71], [3, 1, 67]],
  [[0, 1, 68], [1, 1, 71], [2, 2, 76]],
  [[0, 1, 77], [1, 1, 76], [2, 1.5, 74], [3.5, 0.5, 72]],
  [[0, 3, 74], [3, 1, 69]],
  [[0, 1, 72], [1, 1, 71], [2, 1.5, 72], [3.5, 0.5, 74]],
  [[0, 3.5, 76]],
  [[0, 1.5, 81], [1.5, 0.5, 79], [2, 1, 77], [3, 1, 76]],
  [[0, 1.5, 74], [1.5, 0.5, 76], [2, 2, 79]],
  [[0, 1, 76], [1, 1, 72], [2, 2, 69]],
  [[0, 1, 71], [1, 1, 68], [2, 2, 64]],
];

/** Contre-chant de cloches de verre (variante 1). */
const MENU_COUNTER: ReadonlyArray<ReadonlyArray<Note>> = [
  [[0, 2, 84], [2, 2, 83]], [[0, 4, 81]], [[0, 2, 81], [2, 2, 84]], [[0, 4, 77]],
  [[0, 2, 79], [2, 2, 84]], [[0, 4, 88]], [[0, 2, 86], [2, 2, 83]], [[0, 2, 80], [2, 2, 83]],
  [[0, 2, 86], [2, 2, 89]], [[0, 4, 86]], [[0, 2, 84], [2, 2, 88]], [[0, 4, 81]],
  [[0, 2, 84], [2, 2, 81]], [[0, 2, 83], [2, 2, 86]], [[0, 2, 84], [2, 2, 81]], [[0, 2, 83], [2, 2, 80]],
];

/** Indices de l'arpège (doubles croches) dans les 4 notes de l'accord. */
const MENU_ARP = [0, 1, 2, 1, 3, 2, 1, 2, 0, 1, 2, 1, 3, 2, 3, 2];
/** Basse en croches : fondamentale et octave qui « pompent ». */
const MENU_BASS = [0, 0, 12, 0, 0, 12, 0, 12];

class MenuTheme implements Track {
  readonly name = 'menu' as const;
  readonly endTime = Infinity;
  private readonly beat = 60 / 92;
  private bar = 0;
  private nextBar: number;
  private cycle = 0;
  private variant = 0;
  private lastVariant = 0;
  private readonly pump: GainNode;
  private readonly fx: DelayFx;
  /** Arpège et soliste partagent l'écho : deux bus persistants. */
  private readonly arpBus: GainNode;
  private readonly leadBus: GainNode;

  constructor(private readonly e: SynthEnv, private readonly out: AudioNode, start: number) {
    this.nextBar = start;
    this.pump = gainNode(e.ctx, 1);
    this.pump.connect(out);
    this.fx = new DelayFx(e.ctx, out, this.beat * 0.75, 0.38, 0.32);
    this.arpBus = gainNode(e.ctx, 1);
    this.leadBus = gainNode(e.ctx, 1);
    for (const b of [this.arpBus, this.leadBus]) { b.connect(out); b.connect(this.fx.input); }
  }

  setIntensity(): void { /* inutilisé */ }

  dispose(): void {
    for (const n of [this.pump, this.arpBus, this.leadBus]) { try { n.disconnect(); } catch { /* ignorer */ } }
    this.fx.dispose();
  }

  schedule(from: number, until: number): void {
    if (this.nextBar < from - 0.25) this.nextBar = from + 0.05; // resynchronisation après un arrêt
    while (this.nextBar < until) {
      const idx = this.bar % 16;
      if (idx === 0) this.pickVariant();
      this.scheduleBar(this.nextBar, idx);
      this.nextBar += this.beat * 4;
      this.bar++;
    }
  }

  private pickVariant(): void {
    this.cycle = Math.floor(this.bar / 16);
    if (this.cycle <= 1) { this.variant = 0; this.lastVariant = 0; return; }
    let v = Math.floor(Math.random() * 4);
    if (v === this.lastVariant) v = (v + 1 + Math.floor(Math.random() * 3)) % 4;
    this.variant = v;
    this.lastVariant = v;
  }

  private scheduleBar(t: number, idx: number): void {
    const e = this.e;
    const out = this.out;
    const b = this.beat;
    const ch = CH[MENU_PROG[idx]];
    const intro = this.cycle === 0;
    const v = this.variant;
    const drums = intro ? idx >= 8 : v !== 2;
    const kickOnly = intro && idx >= 4 && idx < 8;
    const bassOn = !intro || idx >= 4;
    const second = idx >= 8;

    // Nappe : un accord par suite de mesures identiques, « pompée » par la grosse caisse.
    const prevSame = idx > 0 && MENU_PROG[idx - 1] === MENU_PROG[idx];
    const nextSame = idx < 15 && MENU_PROG[idx + 1] === MENU_PROG[idx];
    if (!prevSame) {
      pad(e, this.pump, t, ch.pad.map(hz), b * 4 * (nextSame ? 2 : 1) - 0.1, 0.22, {
        cutoff: second ? 1600 : 1200, attack: 0.5, release: 1.4, detune: 9, vibrato: 4,
      });
    }
    // Basse en croches.
    if (bassOn) {
      for (let i = 0; i < 8; i++) {
        const m = ch.root + MENU_BASS[i];
        const acc = i % 2 === 0 ? 1 : 0.8;
        synthBass(e, out, t + i * b * 0.5 + humanize(0.003), hz(m), b * 0.38, 0.16 * acc, { cutoff: 360, env: 4, q: 3, sub: 0.32 });
      }
    }
    // Arpège en doubles croches, filtre qui s'ouvre au fil du cycle, à travers l'écho.
    const arpCut = v === 2 ? 1400 : 1800 + idx * 110;
    const arpVel = intro && idx < 4 ? 0.035 + idx * 0.006 : 0.055;
    for (let i = 0; i < 16; i++) {
      let n = ch.arp[MENU_ARP[i]];
      if (v === 3 && i % 4 === 3) n += 12;
      pluck(e, this.arpBus, t + i * b * 0.25 + humanize(0.002), hz(n), vary(arpVel, 0.15) * (i % 4 === 0 ? 1.2 : 1), {
        decay: 0.13, cutoff: arpCut, q: 5, env: 9,
      });
    }
    // Batterie.
    if (drums || kickOnly) {
      const kicks = idx % 4 === 3 ? [0, 2, 2.75] : [0, 2];
      for (const k of kicks) {
        drum(e, out, t + k * b, 'kick', kickOnly ? 0.36 : 0.48);
        duck(this.pump, t + k * b, 0.45);
      }
    }
    if (drums) {
      for (const s of [1, 3]) drum(e, out, t + s * b + humanize(0.003), 'snare', 0.38);
      for (let i = 0; i < 8; i++) drum(e, out, t + i * b * 0.5 + humanize(0.004), 'hat', i % 2 ? 0.13 : 0.08);
      if (idx % 2 === 1) drum(e, out, t + 3.5 * b, 'openhat', 0.09);
      if (idx === 7 || idx === 15) {
        [1.5, 1.3, 1.1, 0.9].forEach((r, k) => drum(e, out, t + (3 + k * 0.25) * b, 'tom', 0.22 + k * 0.03, r));
      }
      if (idx === 0 || (idx === 8 && intro)) cymbal(e, out, t, 0.05, 1.4);
    }
    // Saxophone (le thème) ou cloches pendant la variante dépouillée.
    const leadOut = this.leadBus;
    const notes = MENU_MELODY[idx];
    if (v !== 2) {
      const oct = v === 1 && idx >= 8 && idx < 12 ? 12 : 0;
      for (const [bt, dur, m] of notes) {
        const nt = t + bt * b + humanize(0.012);
        if (v === 3 && dur >= 1.5 && Math.random() < 0.5) {
          // Ornement : petite note d'appui un ton au-dessus.
          saxLead(e, leadOut, nt - 0.08, hz(m + oct + 2), 0.07, 0.1, { vibrato: 0, scoop: 20 });
        }
        saxLead(e, leadOut, nt, hz(m + oct), dur * b * 0.95, vary(0.17, 0.08), {
          vibrato: dur >= 2 ? 16 : 10, bright: 0.55 + (oct ? 0.1 : 0), breath: 0.13,
        });
      }
    } else {
      for (const [bt, , m] of notes) fmBell(e, leadOut, t + bt * b + humanize(), hz(m + 12), vary(0.06, 0.1), { decay: 0.7 });
    }
    if (v === 1) {
      for (const [bt, , m] of MENU_COUNTER[idx]) fmBell(e, leadOut, t + bt * b, hz(m), 0.04, { ratio: 3.5, index: 1.2, decay: 0.9 });
    }
  }
}

/* ================================================================== game : pulsation ambiante */

interface AmbChord { root: number; pad: readonly number[]; tones: readonly number[] }

const GAME_CHORDS: ReadonlyArray<AmbChord> = [
  { root: 45, pad: [57, 60, 64, 71], tones: [64, 69, 71, 72, 76] }, // Am9
  { root: 41, pad: [53, 57, 60, 64], tones: [60, 64, 65, 69, 72] }, // Fmaj7
  { root: 48, pad: [55, 59, 60, 64], tones: [60, 64, 67, 71, 72] }, // Cmaj7
  { root: 43, pad: [55, 59, 62, 64], tones: [62, 64, 67, 71, 74] }, // G6
  { root: 38, pad: [53, 57, 60, 64], tones: [62, 64, 65, 69, 72] }, // Dm9
  { root: 40, pad: [52, 55, 59, 62], tones: [64, 67, 71, 74, 76] }, // Em7
];
const GAME_NEXT: ReadonlyArray<readonly number[]> = [[1, 4, 2], [3, 2, 0], [3, 1, 0], [0, 5], [3, 0, 1], [1, 0]];
const A_MINOR_PENTA = [69, 72, 74, 76, 79, 81, 84, 86, 88];

class GameAmbient implements Track {
  readonly name = 'game' as const;
  readonly endTime = Infinity;
  private readonly pulse = 60 / 76 / 2;
  private nextChord: number;
  private nextPhrase: number;
  private nextSax: number;
  private chord = 0;
  private pulseOn = true;
  private walk = 2;
  private readonly fx: DelayFx;
  private readonly bus: GainNode;

  constructor(private readonly e: SynthEnv, private readonly out: AudioNode, start: number) {
    this.nextChord = start;
    this.nextPhrase = start + 8 + Math.random() * 8;
    this.nextSax = start + 50 + Math.random() * 40;
    this.bus = gainNode(e.ctx, 1);
    this.bus.connect(out);
    this.fx = new DelayFx(e.ctx, out, this.pulse * 1.5, 0.42, 0.3, 2000);
    this.bus.connect(this.fx.input);
  }

  setIntensity(): void { /* inutilisé */ }

  dispose(): void {
    try { this.bus.disconnect(); } catch { /* ignorer */ }
    this.fx.dispose();
  }

  schedule(from: number, until: number): void {
    if (this.nextChord < from - 1) this.nextChord = from + 0.1;
    if (this.nextPhrase < from - 1) this.nextPhrase = from + 2;
    if (this.nextSax < from - 1) this.nextSax = from + 10;
    while (this.nextChord < until) {
      const steps = Math.random() < 0.5 ? 24 : 32;
      this.scheduleChord(this.nextChord, steps);
      this.nextChord += steps * this.pulse;
      const opts = GAME_NEXT[this.chord];
      this.chord = pickOf(opts);
    }
    while (this.nextPhrase < until) {
      this.bells(this.nextPhrase);
      this.nextPhrase += 16 + Math.random() * 14;
    }
    while (this.nextSax < until) {
      this.sax(this.nextSax);
      this.nextSax += 70 + Math.random() * 60;
    }
  }

  private scheduleChord(t: number, steps: number): void {
    const e = this.e;
    const c = GAME_CHORDS[this.chord];
    const dur = steps * this.pulse;
    pad(e, this.out, t, c.pad.map(hz), dur, 0.16, { cutoff: 750, attack: 3, release: 3.5, vibrato: 3 });
    pad(e, this.out, t, [hz(c.root - 12)], dur, 0.1, { cutoff: 220, attack: 3.5, release: 4, vibrato: 0 });
    // La pulsation se tait parfois pour un accord entier : rien qui ne lasse.
    this.pulseOn = Math.random() < 0.75;
    if (!this.pulseOn) return;
    for (let i = 0; i < steps; i++) {
      if (Math.random() < 0.12) continue;
      this.walk = Math.max(0, Math.min(c.tones.length - 1, this.walk + (Math.random() < 0.5 ? -1 : 1)));
      const u = i / steps;
      const swell = Math.sin(Math.PI * Math.min(1, u * 1.2)); // entrée et sortie en douceur
      const vel = (i % 4 === 0 ? 0.055 : 0.04) * (0.35 + 0.65 * swell);
      pluck(e, this.bus, t + i * this.pulse + humanize(0.004), hz(c.tones[this.walk]), vel, {
        type: 'triangle', decay: 0.16, cutoff: 1300, q: 2, env: 6,
      });
    }
  }

  private bells(t: number): void {
    const n = 3 + Math.floor(Math.random() * 3);
    let idx = 3 + Math.floor(Math.random() * 4);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const m = A_MINOR_PENTA[Math.max(0, Math.min(A_MINOR_PENTA.length - 1, idx))];
      fmBell(this.e, this.bus, tt, hz(m), vary(0.05, 0.2), { ratio: 3.5, index: 1.1, decay: 1.1 });
      tt += this.pulse * (2 + Math.floor(Math.random() * 3));
      idx += Math.random() < 0.6 ? -1 : Math.random() < 0.5 ? 1 : 2;
    }
  }

  /** Rare phrase de saxophone lointain : l'identité « film noir » en filigrane. */
  private sax(t: number): void {
    const c = GAME_CHORDS[this.chord];
    const n = 2 + Math.floor(Math.random() * 2);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const m = pickOf(c.tones);
      const d = this.pulse * (3 + Math.floor(Math.random() * 4));
      saxLead(this.e, this.bus, tt, hz(m), d, 0.055, { bright: 0.3, vibrato: 14, breath: 0.16, release: 0.3 });
      tt += d + this.pulse * Math.floor(Math.random() * 2);
    }
  }
}

/* ================================================================== tension : combat */

interface TensionBar { chord: keyof typeof CH; stab: readonly number[]; arp: readonly number[] }

const TENSION_BARS: ReadonlyArray<TensionBar> = [
  { chord: 'Am', stab: [57, 60, 64], arp: [69, 72, 76, 81] },
  { chord: 'Am', stab: [57, 60, 64], arp: [69, 72, 76, 81] },
  { chord: 'Bb', stab: [58, 62, 65], arp: [70, 74, 77, 82] },
  { chord: 'Bb', stab: [58, 62, 65], arp: [70, 74, 77, 82] },
  { chord: 'Dm', stab: [57, 62, 65], arp: [69, 74, 77, 81] },
  { chord: 'Dm', stab: [57, 62, 65], arp: [69, 74, 77, 81] },
  { chord: 'E', stab: [56, 59, 64], arp: [68, 71, 76, 80] },
  { chord: 'E', stab: [56, 59, 64], arp: [68, 71, 76, 80] },
];
const TENSION_BASS = [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 7, 12];
const TENSION_ARP = [0, 1, 2, 3, 2, 1, 0, 1, 0, 2, 1, 3, 2, 3, 1, 2];

class TensionDrive implements Track {
  readonly name = 'tension' as const;
  readonly endTime = Infinity;
  private readonly six = 60 / 124 / 4;
  private nextBar: number;
  private bar = 0;
  private intensity = 0.5;
  private readonly pump: GainNode;
  private readonly fx: DelayFx;
  private readonly arpBus: GainNode;

  constructor(private readonly e: SynthEnv, private readonly out: AudioNode, start: number) {
    this.nextBar = start;
    this.pump = gainNode(e.ctx, 1);
    this.pump.connect(out);
    this.fx = new DelayFx(e.ctx, out, this.six * 3, 0.3, 0.22, 3000);
    this.arpBus = gainNode(e.ctx, 1);
    this.arpBus.connect(out);
    this.arpBus.connect(this.fx.input);
  }

  setIntensity(x: number): void { this.intensity = Math.max(0, Math.min(1, x)); }

  dispose(): void {
    for (const n of [this.pump, this.arpBus]) { try { n.disconnect(); } catch { /* ignorer */ } }
    this.fx.dispose();
  }

  schedule(from: number, until: number): void {
    if (this.nextBar < from - 0.25) this.nextBar = from + 0.05;
    while (this.nextBar < until) {
      this.scheduleBar(this.nextBar, this.bar % TENSION_BARS.length);
      this.nextBar += this.six * 16;
      this.bar++;
    }
  }

  private scheduleBar(t: number, idx: number): void {
    const e = this.e;
    const out = this.out;
    const I = this.intensity;
    const s = this.six;
    const bar = TENSION_BARS[idx];
    const ch = CH[bar.chord];
    // Nappe sombre toutes les deux mesures.
    if (idx % 2 === 0) pad(e, this.pump, t, ch.pad.map(hz), s * 32 - 0.05, 0.12, { cutoff: 700 + 500 * I, attack: 0.3, release: 0.6, detune: 10 });
    // Basse qui roule en doubles croches.
    for (let i = 0; i < 16; i++) {
      const acc = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.8 : 0.65;
      synthBass(e, out, t + i * s + humanize(0.002), hz(ch.root + TENSION_BASS[i]), s * 0.7, 0.16 * acc * (0.8 + 0.3 * I), {
        cutoff: 300 + 500 * I, env: 3.5, q: 4, sub: 0.6,
      });
    }
    // Batterie.
    for (let k = 0; k < 4; k++) {
      drum(e, out, t + k * 4 * s, 'kick', 0.42 + 0.14 * I);
      duck(this.pump, t + k * 4 * s, 0.5);
    }
    if (I > 0.75) drum(e, out, t + 14 * s, 'kick', 0.4);
    if (I > 0.25) {
      for (const st of [4, 12]) drum(e, out, t + st * s, 'snare', 0.32 + 0.15 * I);
      if (I > 0.6) for (const st of [4, 12]) drum(e, out, t + st * s + 0.004, 'clap', 0.18);
    }
    const sixteen = I > 0.45;
    for (let i = 0; i < 16; i++) {
      if (!sixteen && i % 2) continue;
      const v = i % 4 === 2 ? 0.13 : i % 2 ? 0.06 : 0.09;
      drum(e, out, t + i * s + humanize(0.003), 'hat', v * (0.8 + 0.4 * I));
    }
    if (I > 0.6) for (const st of [2, 6, 10, 14]) drum(e, out, t + st * s, 'openhat', 0.07);
    if (idx === 7 && I > 0.55) {
      [1.5, 1.35, 1.2, 1.05].forEach((r, k) => drum(e, out, t + (12 + k) * s, 'tom', 0.22 + 0.04 * k, r));
    }
    if (idx === 0 && I > 0.5) cymbal(e, out, t, 0.045, 1.1);
    // Arpège tendu (le filtre s'ouvre avec l'intensité).
    if (I > 0.4) {
      for (let i = 0; i < 16; i++) {
        pluck(e, this.arpBus, t + i * s, hz(bar.arp[TENSION_ARP[i]]), vary(0.04, 0.15) * (i % 4 === 0 ? 1.25 : 1), {
          decay: 0.09, cutoff: 1500 + 3500 * I, q: 6, env: 10, type: 'square',
        });
      }
    }
    // Accords plaqués de cuivres synthétiques aux fortes intensités.
    if (I > 0.7 && idx % 2 === 0) {
      synthStab(e, out, t, bar.stab.map(hz), s * 3, 0.16 * I, { cutoff: 2800 });
      synthStab(e, out, t + 10 * s, bar.stab.map(hz), s * 2, 0.13 * I, { cutoff: 2800 });
    }
  }
}

/* ================================================================== morceaux uniques */

type Cue = Array<readonly [number, (t: number) => void]>;

abstract class OneShot implements Track {
  abstract readonly name: 'victory' | 'defeat';
  readonly endTime: number;
  private idx = 0;
  protected readonly cue: Cue;

  constructor(protected readonly e: SynthEnv, protected readonly out: AudioNode, protected readonly start: number, length: number) {
    this.cue = this.build();
    this.cue.sort((a, b) => a[0] - b[0]);
    this.endTime = start + length;
  }

  protected abstract build(): Cue;

  setIntensity(): void { /* inutilisé */ }

  dispose(): void { /* aucun nœud persistant */ }

  schedule(from: number, until: number): void {
    while (this.idx < this.cue.length) {
      const [dt, fn] = this.cue[this.idx];
      const t = this.start + dt;
      if (t >= until) break;
      fn(Math.max(t, from));
      this.idx++;
    }
  }
}

class VictoryCue extends OneShot {
  readonly name = 'victory' as const;
  constructor(e: SynthEnv, out: AudioNode, start: number) { super(e, out, start, 8.5); }

  protected build(): Cue {
    const e = this.e; const o = this.out;
    const c: Cue = [];
    const B = (dt: number, m: number, d: number, v = 0.16, bright = 0.9): void => {
      c.push([dt, (t) => { brass(e, o, t, hz(m), d, v, { bright, detune: 10, vibrato: d > 0.5 ? 8 : 0 }); }]);
    };
    const D = (dt: number, k: Parameters<typeof drum>[3], v: number, r = 1): void => {
      c.push([dt, (t) => { drum(e, o, t, k, v, r); }]);
    };
    // Montée et roulement de toms jusqu'à la fanfare.
    c.push([0, (t) => { riser(e, o, t, 0.9, 0.12); }]);
    for (let i = 0; i < 13; i++) D(i * 0.07, 'tom', 0.08 + i * 0.022, 1.3 - i * 0.02);
    c.push([0.9, (t) => { cymbal(e, o, t, 0.1, 1.3); }]);
    // Fanfare en do majeur.
    for (let i = 0; i < 3; i++) B(0.9 + i * 0.13, 55, 0.1, 0.15);
    B(1.29, 60, 0.5, 0.18); B(1.29, 55, 0.5, 0.1);
    B(1.82, 64, 0.25); B(2.1, 67, 0.25);
    B(2.4, 72, 0.9, 0.18); B(2.4, 64, 0.9, 0.1); B(2.4, 67, 0.9, 0.1);
    B(3.4, 69, 0.3); B(3.75, 67, 0.3); B(4.1, 65, 0.3); B(4.45, 64, 0.3); B(4.8, 62, 0.4); B(4.8, 59, 0.4, 0.09);
    c.push([5.25, (t) => { synthStab(e, o, t, [48, 55, 60, 64, 67, 72].map(hz), 2.1, 0.5, { cutoff: 4200, release: 0.6 }); }]);
    // Nappes en dessous.
    const P = (dt: number, ms: number[], d: number, v = 0.22): void => {
      c.push([dt, (t) => { pad(e, o, t, ms.map(hz), d, v, { cutoff: 1600, attack: 0.15, release: 0.8 }); }]);
    };
    P(1.29, [48, 55, 60, 64], 2.0); P(3.4, [41, 53, 57, 60], 1.4); P(4.8, [43, 53, 59, 62], 0.45); P(5.25, [36, 48, 55, 60, 64], 2.3, 0.28);
    // Batterie et crash.
    for (const dt of [1.29, 2.4, 3.4, 4.8]) { D(dt, 'kick', 0.55); D(dt, 'snare', 0.35); }
    D(5.25, 'kick', 0.8); D(5.25, 'snare', 0.55);
    c.push([5.25, (t) => { cymbal(e, o, t, 0.13, 1.6); }]);
    // Pluie d'étincelles d'arpège.
    [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => {
      c.push([5.35 + i * 0.07, (t) => { pluck(e, o, t, hz(m), 0.06, { decay: 0.3, cutoff: 6000 }); }]);
    });
    for (let i = 0; i < 10; i++) D(6.1 + i * 0.09, 'tom', 0.28 - i * 0.022, 1.2 - i * 0.03);
    return c;
  }
}

class DefeatCue extends OneShot {
  readonly name = 'defeat' as const;
  constructor(e: SynthEnv, out: AudioNode, start: number) { super(e, out, start, 7); }

  protected build(): Cue {
    const e = this.e; const o = this.out;
    const c: Cue = [];
    // Glas : cloche FM grave et inharmonique, grosse caisse ralentie.
    for (const [dt, v] of [[0, 0.16], [3.0, 0.13]] as const) {
      c.push([dt, (t) => { fmBell(e, o, t, hz(45), v, { ratio: 1.41, index: 2.2, decay: 2.2 }); }]);
      c.push([dt, (t) => { drum(e, o, t, 'kick', 0.6, 0.55); }]);
    }
    const P = (dt: number, ms: number[], d: number, v = 0.24): void => {
      c.push([dt, (t) => { pad(e, o, t, ms.map(hz), d, v, { cutoff: 650, attack: 0.6, release: 1.4 }); }]);
    };
    P(0.2, [45, 52, 57, 60], 2.8); P(3.0, [41, 48, 53, 57], 1.5); P(4.5, [45, 52, 57, 60, 64], 1.6, 0.2);
    c.push([0.2, (t) => { pad(e, o, t, [hz(33)], 6, 0.12, { cutoff: 200, attack: 1, release: 1.5, vibrato: 0 }); }]);
    const H = (dt: number, m: number, d: number, v = 0.15): void => {
      c.push([dt, (t) => { saxLead(e, o, t, hz(m), d, v, { bright: 0.3, vibrato: 16, release: 0.35, breath: 0.15 }); }]);
    };
    H(0.3, 76, 0.9); H(1.25, 74, 0.5); H(1.8, 72, 0.5); H(2.35, 71, 0.9); H(3.3, 69, 2.2, 0.14);
    return c;
  }
}

export function createTrack(name: Exclude<MusicTrackName, 'none'>, e: SynthEnv, out: AudioNode, start: number): Track {
  switch (name) {
    case 'menu': return new MenuTheme(e, out, start);
    case 'game': return new GameAmbient(e, out, start);
    case 'tension': return new TensionDrive(e, out, start);
    case 'victory': return new VictoryCue(e, out, start);
    case 'defeat': return new DefeatCue(e, out, start);
  }
}

/* ================================================================== directeur (fondus enchaînés) */

interface Playing { track: Track; out: GainNode; fadeEnd: number }

/** Niveau de sortie relatif par morceau (la tension est dense et percussive). */
const TRACK_LEVEL: Record<Exclude<MusicTrackName, 'none'>, number> = {
  menu: 0.8, game: 1, tension: 0.7, victory: 0.85, defeat: 0.75,
};

/** Possède le morceau en cours et fait les fondus enchaînés. */
export class MusicDirector {
  private current: Playing | null = null;
  private fading: Playing[] = [];
  private intensity = 0;

  constructor(private readonly e: SynthEnv, private readonly dry: AudioNode, private readonly wet: AudioNode) {}

  get currentName(): MusicTrackName { return this.current?.track.name ?? 'none'; }

  play(name: MusicTrackName, now: number, fadeIn = 2, fadeOut = 2): void {
    if (name === this.currentName) return;
    if (this.current) {
      const c = this.current;
      c.out.gain.cancelScheduledValues(now);
      c.out.gain.setTargetAtTime(0, now, fadeOut / 4);
      c.fadeEnd = now + fadeOut * 1.6;
      this.fading.push(c);
      this.current = null;
    }
    if (name === 'none') return;
    const out = gainNode(this.e.ctx, 0);
    out.connect(this.dry);
    out.connect(this.wet);
    const oneShot = name === 'victory' || name === 'defeat';
    const start = now + (oneShot ? 0.05 : 0.1);
    const level = TRACK_LEVEL[name];
    out.gain.setValueAtTime(oneShot ? level : 0, now);
    if (!oneShot) out.gain.setTargetAtTime(level, now, fadeIn / 4);
    const track = createTrack(name, this.e, out, start);
    track.setIntensity(this.intensity);
    this.current = { track, out, fadeEnd: Infinity };
  }

  setIntensity(x: number): void {
    this.intensity = x;
    this.current?.track.setIntensity(x);
  }

  schedule(now: number, until: number): void {
    const c = this.current;
    if (c) {
      c.track.schedule(now, until);
      if (c.track.endTime + 4 < now) {
        // Morceau unique terminé : on le libère (silence ensuite).
        c.track.dispose();
        c.out.disconnect();
        this.current = null;
      }
    }
    if (this.fading.length) {
      this.fading = this.fading.filter((f) => {
        if (now > f.fadeEnd) { f.track.dispose(); f.out.disconnect(); return false; }
        f.track.schedule(now, Math.min(until, f.fadeEnd));
        return true;
      });
    }
  }
}
