/**
 * Procedural, period-flavoured music. Each track schedules notes ahead of time
 * on the AudioContext clock (`schedule(from, until)` is called by the engine's
 * lookahead scheduler, from a timer and from update()).
 */
import { midiHz } from './dsp';
import { bell, brass, celesta, cymbal, pad, pizz, stringStacc, timpani, TOWER_BELL } from './instruments';
import { gainNode, osc, type SynthEnv } from './synth';
import type { MusicTrackName } from './types';

export interface Track {
  readonly name: Exclude<MusicTrackName, 'none'>;
  /** Absolute end time for one-shot cues, Infinity for loops. */
  readonly endTime: number;
  /** Schedule every event that starts before `until`. */
  schedule(from: number, until: number): void;
  /** 0..1 musical intensity (used by 'tension'). */
  setIntensity(x: number): void;
}

const hz = midiHz;
/** D natural minor pitch classes (plus C# for the dominant). */
const D_MINOR_PC = [2, 4, 5, 7, 9, 10, 0];
/** Next scale tone above `m` (diatonic upper neighbour); C# is used over the dominant (A). */
const upperNeighbour = (m: number, dominant: boolean): number => {
  for (let k = 1; k <= 3; k++) {
    const pc = (m + k) % 12;
    if (dominant && pc === 1) return m + k;
    if (D_MINOR_PC.includes(pc) && !(dominant && pc === 0)) return m + k;
  }
  return m + 2;
};
const humanize = (amt = 0.008): number => (Math.random() * 2 - 1) * amt;
const vary = (v: number, amt = 0.12): number => v * (1 + (Math.random() * 2 - 1) * amt);

/* ================================================================== menu waltz */

interface WaltzChord { bass: number; alt: number; pah: readonly number[]; pad: readonly number[] }

const WCH: Record<'Dm' | 'Gm' | 'A7' | 'Bb' | 'Em7b5', WaltzChord> = {
  Dm: { bass: 38, alt: 45, pah: [57, 62, 65], pad: [50, 57, 62, 65] },
  Gm: { bass: 43, alt: 50, pah: [58, 62, 67], pad: [50, 55, 58, 62] },
  A7: { bass: 45, alt: 40, pah: [55, 61, 64], pad: [49, 55, 57, 64] },
  Bb: { bass: 46, alt: 41, pah: [58, 62, 65], pad: [50, 53, 58, 62] },
  Em7b5: { bass: 40, alt: 46, pah: [55, 58, 62], pad: [50, 55, 58, 64] },
};

const WALTZ_PROG: ReadonlyArray<keyof typeof WCH> = [
  'Dm', 'Dm', 'Gm', 'Gm', 'A7', 'A7', 'Dm', 'Dm',
  'Bb', 'Bb', 'Gm', 'Gm', 'Em7b5', 'A7', 'Dm', 'A7',
];

/** [beat, duration in beats, midi] per bar. */
type Note = readonly [number, number, number];
const WALTZ_MELODY: ReadonlyArray<ReadonlyArray<Note>> = [
  [[0, 2, 77], [2, 1, 76]],
  [[0, 1, 74], [1, 2, 69]],
  [[0, 1, 70], [1, 1, 74], [2, 1, 77]],
  [[0, 3, 76]],
  [[0, 1, 73], [1, 1, 76], [2, 1, 79]],
  [[0, 2, 81], [2, 1, 79]],
  [[0, 1, 77], [1, 1, 74], [2, 1, 69]],
  [[0, 3, 74]],
  [[0, 1, 74], [1, 1, 77], [2, 1, 82]],
  [[0, 2, 81], [2, 1, 79]],
  [[0, 1, 79], [1, 1, 74], [2, 1, 70]],
  [[0, 2, 77], [2, 1, 76]],
  [[0, 1, 76], [1, 1, 79], [2, 1, 82]],
  [[0, 2, 81], [2, 1, 73]],
  [[0, 1, 74], [1, 1, 77], [2, 1, 76]],
  [[0, 2, 73], [2, 1, 76]],
];

/** Slow counter-line used in the sparse variation. */
const WALTZ_COUNTER: ReadonlyArray<ReadonlyArray<Note>> = [
  [[0, 3, 69]], [], [[0, 3, 70]], [[1, 2, 67]], [[0, 3, 69]], [[1, 2, 67]], [[0, 3, 65]], [[0, 3, 62]],
  [[0, 3, 65]], [[1, 2, 69]], [[0, 3, 67]], [[1, 2, 65]], [[0, 3, 64]], [[1, 2, 61]], [[0, 3, 62]], [[0, 2, 61], [2, 1, 64]],
];

class MenuWaltz implements Track {
  readonly name = 'menu' as const;
  readonly endTime = Infinity;
  private readonly beat = 60 / 84;
  private bar = 0;
  private nextBar: number;
  private variant = 0;
  private lastVariant = -1;

  constructor(private readonly e: SynthEnv, private readonly out: AudioNode, start: number) {
    this.nextBar = start;
  }

  setIntensity(): void { /* not used */ }

  schedule(from: number, until: number): void {
    if (this.nextBar < from - 0.25) this.nextBar = from + 0.05; // resync after a stall
    while (this.nextBar < until) {
      const idx = this.bar % 16;
      if (idx === 0) this.pickVariant();
      const len = this.beat * 3 * (idx === 15 ? 1.14 : idx === 7 ? 1.05 : 1); // gentle ritardando
      this.scheduleBar(this.nextBar, idx, len);
      this.nextBar += len;
      this.bar++;
    }
  }

  private pickVariant(): void {
    if (this.bar === 0) { this.variant = 0; this.lastVariant = 0; return; }
    let v = Math.floor(Math.random() * 4);
    if (v === this.lastVariant) v = (v + 1 + Math.floor(Math.random() * 3)) % 4;
    this.variant = v;
    this.lastVariant = v;
  }

  private scheduleBar(t: number, idx: number, len: number): void {
    const e = this.e;
    const out = this.out;
    const b = len / 3;
    const ch = WCH[WALTZ_PROG[idx]];
    const prevSame = idx > 0 && WALTZ_PROG[idx - 1] === WALTZ_PROG[idx];
    const nextSame = idx < 15 && WALTZ_PROG[idx + 1] === WALTZ_PROG[idx];
    // String pad: one chord per run of identical bars.
    if (!prevSame) pad(e, out, t, ch.pad.map(hz), len * (nextSame ? 2 : 1) - 0.1, 0.2, { cutoff: 950, attack: 0.7, release: 1.4 });
    // Oom (bass pizz) - pah - pah (Viennese: beat two slightly early).
    const bassNote = prevSame && idx % 2 === 1 ? ch.alt : ch.bass;
    pizz(e, out, t + humanize(0.004), hz(bassNote), vary(0.34, 0.08), 0.22);
    const pahT = [t + b * 0.94, t + b * 2];
    for (const pt of pahT) {
      for (const n of ch.pah) pizz(e, out, pt + humanize(0.006), hz(n), vary(0.075, 0.15), 0.12);
    }
    // Lead.
    const v = this.variant;
    const notes = v === 2 ? WALTZ_COUNTER[idx] : WALTZ_MELODY[idx];
    const oct = v === 1 && idx >= 8 && idx < 12 ? 12 : 0;
    const vel = v === 2 ? 0.15 : 0.25;
    for (const [beat, dur, m] of notes) {
      const nt = t + beat * b + humanize();
      if (v === 3 && dur >= 2 && Math.random() < 0.6) {
        // Ornament: quick diatonic upper-neighbour grace note.
        const dominant = WALTZ_PROG[idx] === 'A7';
        celesta(e, out, nt - 0.07, hz(upperNeighbour(m, dominant) + oct), vel * 0.5);
      }
      celesta(e, out, nt, hz(m + oct), vary(vel, 0.1), dur >= 2 ? undefined : 0.5);
      if (v === 3 && dur >= 2) celesta(e, out, nt + 0.01, hz(m + oct - 12), vel * 0.35);
    }
    if (v === 1 && idx % 4 === 3) {
      // A little music-box arpeggio flourish at phrase ends.
      ch.pah.forEach((n, i) => celesta(e, out, t + b * (1 + i * 0.33), hz(n + 24), 0.07));
    }
  }
}

/* ================================================================== game (sparse ambient) */

const GAME_CHORDS: ReadonlyArray<readonly number[]> = [
  [38, 50, 57, 60, 65], // Dm7
  [34, 46, 53, 57, 62], // Bbmaj7
  [31, 43, 50, 58, 62], // Gm
  [33, 45, 52, 57, 61], // A
  [29, 41, 48, 57, 60], // F
  [36, 48, 55, 60, 64], // C
];
const GAME_NEXT: ReadonlyArray<readonly number[]> = [[1, 2, 4], [2, 0, 5], [3, 0, 1], [0, 0, 1], [5, 2, 0], [0, 3, 1]];
const D_MINOR = [62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79, 81];

class GameAmbient implements Track {
  readonly name = 'game' as const;
  readonly endTime = Infinity;
  private nextChord: number;
  private nextPhrase: number;
  private nextCello: number;
  private chord = 0;
  /** Recent [startTime, chordIndex] pairs, to know which chord sounds at a given time. */
  private history: Array<[number, number]> = [];

  constructor(private readonly e: SynthEnv, private readonly out: AudioNode, start: number) {
    this.nextChord = start;
    this.nextPhrase = start + 6 + Math.random() * 6;
    this.nextCello = start + 14 + Math.random() * 10;
  }

  setIntensity(): void { /* not used */ }

  schedule(from: number, until: number): void {
    const e = this.e;
    if (this.nextChord < from - 1) this.nextChord = from + 0.1;
    if (this.nextPhrase < from - 1) this.nextPhrase = from + 2;
    if (this.nextCello < from - 1) this.nextCello = from + 4;
    while (this.nextChord < until) {
      const dur = 9 + Math.random() * 4;
      const notes = GAME_CHORDS[this.chord];
      pad(e, this.out, this.nextChord, notes.slice(1).map(hz), dur, 0.16, { cutoff: 650, attack: 3, release: 3.5, vibrato: 3 });
      pad(e, this.out, this.nextChord, [hz(notes[0])], dur, 0.1, { cutoff: 260, attack: 3.5, release: 4, vibrato: 0 });
      this.history.push([this.nextChord, this.chord]);
      if (this.history.length > 8) this.history.shift();
      this.nextChord += dur;
      const opts = GAME_NEXT[this.chord];
      this.chord = opts[Math.floor(Math.random() * opts.length)];
    }
    while (this.nextPhrase < until) {
      this.phrase(this.nextPhrase);
      this.nextPhrase += 14 + Math.random() * 14;
    }
    while (this.nextCello < until) {
      const root = GAME_CHORDS[this.chordAt(this.nextCello)][0] + 12 + (Math.random() < 0.5 ? 7 : 0);
      pad(e, this.out, this.nextCello, [hz(root)], 4 + Math.random() * 2, 0.11, { cutoff: 700, attack: 1.4, release: 2, detune: 4, vibrato: 7 });
      this.nextCello += 22 + Math.random() * 18;
    }
  }

  private chordAt(t: number): number {
    let c = this.history.length ? this.history[0][1] : this.chord;
    for (const [st, idx] of this.history) if (st <= t) c = idx;
    return c;
  }

  private phrase(t: number): void {
    const n = 3 + Math.floor(Math.random() * 4);
    let idx = 4 + Math.floor(Math.random() * 5);
    let tt = t;
    for (let i = 0; i < n; i++) {
      let m = D_MINOR[Math.max(0, Math.min(D_MINOR.length - 1, idx))];
      if (m % 12 === 0 && this.chordAt(tt) === 3) m += 1; // C# over the A major chord
      celesta(this.e, this.out, tt, hz(m), vary(0.13, 0.2), 0.9);
      tt += 0.42 + Math.random() * 0.45;
      idx += Math.random() < 0.7 ? (Math.random() < 0.55 ? -1 : 1) : (Math.random() < 0.5 ? -2 : 2);
    }
  }
}

/* ================================================================== tension ostinato */

interface TensionBar { root: number; pattern: readonly number[]; upper: readonly number[] }

const TENSION_BARS: ReadonlyArray<TensionBar> = [
  { root: 38, pattern: [0, 0, 12, 0, 3, 0, 2, 0], upper: [62, 65, 69] },   // Dm
  { root: 38, pattern: [0, 0, 12, 0, 5, 3, 2, 0], upper: [62, 65, 69] },   // Dm
  { root: 34, pattern: [0, 0, 12, 0, 4, 0, 2, 0], upper: [62, 65, 70] },   // Bb
  { root: 33, pattern: [0, 0, 12, 0, 4, 0, 1, 0], upper: [61, 64, 69] },   // A (b9 colour)
  { root: 38, pattern: [0, 0, 12, 0, 3, 0, 2, 0], upper: [62, 65, 69] },   // Dm
  { root: 43, pattern: [0, 0, 12, 0, 3, 0, 2, 0], upper: [62, 67, 70] },   // Gm
  { root: 39, pattern: [0, 0, 12, 0, 4, 0, 2, 0], upper: [63, 67, 70] },   // Eb (Neapolitan)
  { root: 33, pattern: [0, 0, 12, 1, 4, 1, 0, 12], upper: [61, 64, 67] },  // A7
];

class TensionOstinato implements Track {
  readonly name = 'tension' as const;
  readonly endTime = Infinity;
  private readonly eighth = 60 / 110 / 2;
  private nextBar: number;
  private bar = 0;
  private intensity = 0.5;

  constructor(private readonly e: SynthEnv, private readonly out: AudioNode, start: number) {
    this.nextBar = start;
  }

  setIntensity(x: number): void { this.intensity = Math.max(0, Math.min(1, x)); }

  schedule(from: number, until: number): void {
    if (this.nextBar < from - 0.25) this.nextBar = from + 0.05;
    while (this.nextBar < until) {
      this.scheduleBar(this.nextBar, this.bar % TENSION_BARS.length);
      this.nextBar += this.eighth * 8;
      this.bar++;
    }
  }

  private scheduleBar(t: number, idx: number): void {
    const e = this.e;
    const out = this.out;
    const I = this.intensity;
    const bar = TENSION_BARS[idx];
    const q = this.eighth;
    for (let i = 0; i < 8; i++) {
      const nt = t + i * q + humanize(0.003);
      const accent = i === 0 || i === 4 ? 1 : i % 2 === 0 ? 0.75 : 0.6;
      const m = bar.root + bar.pattern[i];
      stringStacc(e, out, nt, hz(m), 0.14 * accent * (0.75 + 0.35 * I), q * 0.55);
      stringStacc(e, out, nt, hz(m + 12), 0.05 * accent * (0.6 + 0.6 * I), q * 0.5);
    }
    // Timpani: downbeat every bar, beat 3 on even bars, a fill at phrase end.
    timpani(e, out, t, hz(bar.root < 36 ? bar.root + 12 : bar.root), 0.25 + 0.15 * I);
    if (idx % 2 === 1) timpani(e, out, t + q * 4, hz(bar.root < 36 ? bar.root + 12 : bar.root), 0.18 + 0.12 * I);
    if (idx === 3 || idx === 7) {
      for (let k = 0; k < 4; k++) timpani(e, out, t + q * 6 + k * q * 0.5, hz(45), 0.13 + 0.045 * k + 0.1 * I);
    }
    // Tremolo high strings at medium intensity.
    if (I > 0.4) {
      const trem = gainNode(e.ctx, 0.55);
      const lfo = osc(e.ctx, 'sine', 11.5, t, t + q * 8 + 2);
      const depth = gainNode(e.ctx, 0.45);
      lfo.connect(depth);
      depth.connect(trem.gain);
      trem.connect(out);
      pad(e, trem, t, bar.upper.map(hz), q * 8 - 0.05, 0.09 * (I - 0.25) * 1.6, { cutoff: 2600, attack: 0.25, release: 0.3, detune: 5 });
    }
    // Brass stabs at high intensity.
    if (I > 0.72 && (idx % 4 === 0 || idx % 4 === 2)) {
      for (const n of bar.upper) brass(e, out, t, hz(n - 12), q * 1.2, 0.065 * I, { bright: 0.55, vibrato: 0 });
    }
  }
}

/* ================================================================== one-shot cues */

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

  setIntensity(): void { /* not used */ }

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
    const B = (dt: number, m: number, d: number, v = 0.16, bright = 0.85): void => {
      c.push([dt, (t) => { brass(e, o, t, hz(m), d, v, { bright }); }]);
    };
    // Timpani roll crescendo into the fanfare.
    for (let i = 0; i < 13; i++) c.push([i * 0.07, (t) => { timpani(e, o, t, hz(38), 0.08 + i * 0.03); }]);
    c.push([0.9, (t) => { cymbal(e, o, t, 0.12, 1.3); }]);
    // Fanfare in D major.
    for (let i = 0; i < 3; i++) B(0.9 + i * 0.13, 57, 0.1, 0.15);
    B(1.29, 62, 0.5, 0.18); B(1.29, 57, 0.5, 0.1);
    B(1.82, 66, 0.25); B(2.1, 69, 0.25);
    B(2.4, 74, 0.9, 0.18); B(2.4, 66, 0.9, 0.1); B(2.4, 69, 0.9, 0.1);
    B(3.4, 71, 0.3); B(3.75, 69, 0.3); B(4.1, 67, 0.3); B(4.45, 66, 0.3); B(4.8, 64, 0.4); B(4.8, 61, 0.4, 0.09);
    for (const m of [50, 57, 62, 66, 69, 74]) B(5.25, m, 2.1, 0.13, 0.9);
    // Strings underneath.
    const P = (dt: number, ms: number[], d: number, v = 0.22): void => {
      c.push([dt, (t) => { pad(e, o, t, ms.map(hz), d, v, { cutoff: 1500, attack: 0.15, release: 0.8 }); }]);
    };
    P(1.29, [50, 57, 62, 66], 2.0); P(3.4, [43, 55, 59, 62], 1.4); P(4.8, [45, 55, 61, 64], 0.45); P(5.25, [38, 50, 57, 62, 66], 2.3, 0.28);
    // Timpani & crash.
    for (const [dt, m, v] of [[1.29, 38, 0.5], [2.4, 33, 0.45], [3.4, 38, 0.45], [4.8, 33, 0.45], [5.25, 38, 0.7]] as const) {
      c.push([dt, (t) => { timpani(e, o, t, hz(m < 36 ? m + 12 : m), v); }]);
    }
    c.push([5.25, (t) => { cymbal(e, o, t, 0.16, 1.6); }]);
    for (let i = 0; i < 10; i++) c.push([6.1 + i * 0.09, (t) => { timpani(e, o, t, hz(38), 0.3 - i * 0.025); }]);
    return c;
  }
}

class DefeatCue extends OneShot {
  readonly name = 'defeat' as const;
  constructor(e: SynthEnv, out: AudioNode, start: number) { super(e, out, start, 7); }

  protected build(): Cue {
    const e = this.e; const o = this.out;
    const c: Cue = [];
    c.push([0, (t) => { bell(e, o, t, hz(50), 0.22, TOWER_BELL, 0.8); }]);
    c.push([3.0, (t) => { bell(e, o, t, hz(50), 0.18, TOWER_BELL, 0.8); }]);
    const P = (dt: number, ms: number[], d: number, v = 0.26): void => {
      c.push([dt, (t) => { pad(e, o, t, ms.map(hz), d, v, { cutoff: 650, attack: 0.6, release: 1.4 }); }]);
    };
    P(0.2, [38, 45, 50, 53], 2.8); P(3.0, [34, 41, 46, 50], 1.5); P(4.5, [38, 45, 50, 53, 57], 1.6, 0.22);
    const H = (dt: number, m: number, d: number, v = 0.16): void => {
      c.push([dt, (t) => { brass(e, o, t, hz(m), d, v, { bright: 0.22, attack: 0.08, vibrato: 6, release: 0.35 }); }]);
    };
    H(0.3, 57, 0.9); H(1.25, 55, 0.5); H(1.8, 53, 0.5); H(2.35, 52, 0.9); H(3.3, 50, 2.2, 0.15);
    for (const [dt, v] of [[0, 0.25], [3.0, 0.3], [4.5, 0.2]] as const) {
      c.push([dt, (t) => { timpani(e, o, t, hz(38), v); }]);
    }
    return c;
  }
}

export function createTrack(name: Exclude<MusicTrackName, 'none'>, e: SynthEnv, out: AudioNode, start: number): Track {
  switch (name) {
    case 'menu': return new MenuWaltz(e, out, start);
    case 'game': return new GameAmbient(e, out, start);
    case 'tension': return new TensionOstinato(e, out, start);
    case 'victory': return new VictoryCue(e, out, start);
    case 'defeat': return new DefeatCue(e, out, start);
  }
}

/* ================================================================== director (crossfades) */

interface Playing { track: Track; out: GainNode; fadeEnd: number }

/** Relative output level per track (tension is dense and percussive). */
const TRACK_LEVEL: Record<Exclude<MusicTrackName, 'none'>, number> = {
  menu: 1, game: 1, tension: 0.72, victory: 0.85, defeat: 0.9,
};

/** Owns the current track and crossfades between tracks. */
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
        // One-shot cue is over: release it (silence afterwards).
        c.out.disconnect();
        this.current = null;
      }
    }
    if (this.fading.length) {
      this.fading = this.fading.filter((f) => {
        if (now > f.fadeEnd) { f.out.disconnect(); return false; }
        f.track.schedule(now, Math.min(until, f.fadeEnd));
        return true;
      });
    }
  }
}
