/**
 * Westminster Quarters + hour strikes (Big Ben), additive bell partials.
 * The quarter bells sound G#4, F#4, E4 and B3; the hour bell an E3.
 */
import { midiHz } from './dsp';
import { TOWER_BELL } from './instruments';
import { chain, gainNode, noiseBurst, osc, type SynthEnv } from './synth';

const G4S = 68, F4S = 66, E4 = 64, B3 = 59;

/** The five "changes" of the Westminster Quarters. */
const CHANGES: ReadonlyArray<readonly number[]> = [
  [G4S, F4S, E4, B3],
  [E4, G4S, F4S, B3],
  [E4, F4S, G4S, E4],
  [G4S, E4, F4S, B3],
  [B3, F4S, G4S, E4],
];

/** Changes rung at each quarter (index 4 = full hour). */
const QUARTERS: Record<1 | 2 | 3 | 4, readonly number[]> = {
  1: [0],
  2: [1, 2],
  3: [3, 4, 0],
  4: [1, 2, 3, 4],
};

export interface Strike { time: number; freq: number; vel: number; hour: boolean }

const NOTE_GAP = 0.72;
const CHANGE_LEN = 3.6;
const HOUR_GAP = 3.2;

/**
 * Builds the strike schedule. `hourCount` 1..12 (values are wrapped, 0 => 12);
 * `quarter` 1..3 rings only the quarter chimes, 4 (default) the full hour.
 */
export function westminsterPlan(start: number, hourCount: number, quarter: 1 | 2 | 3 | 4 = 4): Strike[] {
  const out: Strike[] = [];
  let t = start;
  for (const ci of QUARTERS[quarter]) {
    CHANGES[ci].forEach((m, i) => {
      out.push({ time: t + i * NOTE_GAP + (Math.random() - 0.5) * 0.03, freq: midiHz(m), vel: i === 3 ? 0.34 : 0.3, hour: false });
    });
    t += CHANGE_LEN;
  }
  if (quarter === 4) {
    const n = ((Math.round(hourCount) % 12) + 12) % 12 || 12;
    t += HOUR_GAP - (CHANGE_LEN - 3 * NOTE_GAP);
    for (let i = 0; i < n; i++) out.push({ time: t + i * HOUR_GAP, freq: midiHz(52), vel: 0.5, hour: true });
  }
  return out;
}

/**
 * One tower-bell strike. Partials are capped to `maxRing` seconds with a
 * fade so long hums never pile up oscillators.
 */
export function towerStrike(e: SynthEnv, dest: AudioNode, s: Strike): number {
  const ctx = e.ctx;
  const t = s.time;
  const decay = s.hour ? 1.5 : 0.9;
  const maxRing = s.hour ? 11 : 7;
  const end = t + maxRing;
  const fade = gainNode(ctx, 1);
  fade.gain.setValueAtTime(1, t);
  fade.gain.setValueAtTime(1, end - maxRing * 0.4);
  fade.gain.linearRampToValueAtTime(0, end);
  fade.connect(dest);
  const ny = ctx.sampleRate * 0.45;
  for (const [ratio, amp, tau] of TOWER_BELL) {
    const f = s.freq * ratio;
    if (f >= ny) continue;
    const td = tau * decay;
    const stop = Math.min(end, t + td * 6);
    const o = osc(ctx, 'sine', f, t, stop + 0.01);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(s.vel * amp, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, td);
    chain(o, g, fade);
  }
  // Clapper / hammer transient.
  noiseBurst(e, fade, t, { type: 'bandpass', freq: Math.min(s.freq * 3.2, 5000), q: 1.4, peak: s.vel * 0.45, attack: 0.0005, tau: 0.01 });
  if (s.hour) noiseBurst(e, fade, t, { kind: 'pink', type: 'lowpass', freq: 300, peak: s.vel * 0.4, attack: 0.002, tau: 0.05 });
  return end;
}
