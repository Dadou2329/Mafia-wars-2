/**
 * Interface holographique (HUD), smartphone, piratage, argent et jingles :
 * sons synthétiques propres et brefs, accordés comme la musique (la mineur /
 * do majeur), timbres FM « verre » et cuivres synthwave.
 */
import { midiHz } from './dsp';
import { brass, cymbal, drum, fmBell, GLASS, pad, pluck, riser, saxLead, synthStab } from './instruments';
import { coins, type SfxCtx } from './sfx_combat';
import { biquad, fmTone, grains, jit, noiseBurst, partials, pick, rnd, tone } from './synth';

const max = Math.max;

/* ------------------------------------------------------------------ HUD */

export function uiClick(s: SfxCtx): number {
  const p = s.p * jit(0.03);
  let end = tone(s, s.out, s.t, { freq: 2200 * p, freqEnd: 1400 * p, sweep: 0.015, peak: 0.2, attack: 0.0008, tau: 0.012 });
  end = max(end, noiseBurst(s, s.out, s.t, { type: 'highpass', freq: 5000, peak: 0.1, attack: 0.0003, tau: 0.002 }));
  end = max(end, tone(s, s.out, s.t, { freq: 320 * p, peak: 0.05, attack: 0.001, tau: 0.008 }));
  return end;
}

export function uiHover(s: SfxCtx): number {
  const p = s.p * jit(0.02);
  let end = tone(s, s.out, s.t, { freq: 3200 * p, peak: 0.05, attack: 0.002, tau: 0.008 });
  end = max(end, tone(s, s.out, s.t, { type: 'triangle', freq: 6400 * p, peak: 0.015, attack: 0.001, tau: 0.004 }));
  return end;
}

/** Ouverture d'un panneau : balayage montant et deux notes de verre (quinte). */
export function uiOpen(s: SfxCtx): number {
  const p = s.p;
  let end = noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 600 * p, freqEnd: 3500 * p, sweep: 0.15, q: 1.2, peak: 0.12, attack: 0.08, tau: 0.04 });
  end = max(end, fmTone(s, s.out, s.t + 0.06, { freq: midiHz(88) * p, ratio: 2, index: 0.8, peak: 0.07, tau: 0.08 }));
  end = max(end, fmTone(s, s.out, s.t + 0.12, { freq: midiHz(95) * p, ratio: 2, index: 0.8, peak: 0.06, tau: 0.12 }));
  end = max(end, tone(s, s.out, s.t, { freq: 140 * p, freqEnd: 110 * p, sweep: 0.08, peak: 0.08, attack: 0.01, tau: 0.04 }));
  return end;
}

/** Fermeture : balayage descendant, deux notes qui redescendent. */
export function uiClose(s: SfxCtx): number {
  const p = s.p;
  let end = noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 3200 * p, freqEnd: 700 * p, sweep: 0.13, q: 1.2, peak: 0.1, attack: 0.04, tau: 0.04 });
  end = max(end, fmTone(s, s.out, s.t + 0.03, { freq: midiHz(95) * p, ratio: 2, index: 0.7, peak: 0.05, tau: 0.05 }));
  end = max(end, fmTone(s, s.out, s.t + 0.08, { freq: midiHz(88) * p, ratio: 2, index: 0.7, peak: 0.06, tau: 0.08 }));
  end = max(end, tone(s, s.out, s.t + 0.1, { freq: 300 * p, freqEnd: 180 * p, sweep: 0.04, peak: 0.1, attack: 0.001, tau: 0.025 }));
  return end;
}

/** Refus : double bourdonnement grave (« bzzt bzzt »). */
export function uiError(s: SfxCtx): number {
  const p = s.p;
  const lp = biquad(s.ctx, 'lowpass', 1400, 1.2);
  lp.connect(s.out);
  let end = tone(s, lp, s.t, { type: 'square', freq: 155 * p, peak: 0.13, attack: 0.003, hold: 0.07, tau: 0.02 });
  end = max(end, tone(s, lp, s.t, { type: 'sawtooth', freq: 160 * p, peak: 0.08, attack: 0.003, hold: 0.07, tau: 0.02 }));
  end = max(end, tone(s, lp, s.t + 0.12, { type: 'square', freq: 116 * p, peak: 0.13, attack: 0.003, hold: 0.11, tau: 0.03 }));
  end = max(end, tone(s, lp, s.t + 0.12, { type: 'sawtooth', freq: 120 * p, peak: 0.08, attack: 0.003, hold: 0.11, tau: 0.03 }));
  return end;
}

const SPARKLE = [88, 91, 93, 95, 98, 100]; // mi6 sol6 la6 si6 ré7 mi7

/** Balayage d'un panneau holographique (ancien « papier »). */
export function paper(s: SfxCtx): number {
  const p = s.p * jit(0.04);
  let end = noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 900 * p, freqEnd: 6500 * p, sweep: 0.22, q: 2, peak: 0.16, attack: 0.12, tau: 0.05 });
  end = max(end, noiseBurst(s, s.out, s.t, { type: 'highpass', freq: 6000, peak: 0.04, attack: 0.1, tau: 0.06 }));
  let tt = s.t + 0.06;
  for (let i = 0; i < 3; i++) {
    end = max(end, tone(s, s.out, tt, { freq: midiHz(pick(SPARKLE)) * p, peak: 0.03, attack: 0.002, tau: 0.04 }));
    tt += rnd(0.04, 0.06);
  }
  const hits: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) hits.push([rnd(0, 0.25), rnd(0.05, 0.15)]);
  end = max(end, grains(s, s.out, s.t, hits, { type: 'highpass', freq: 7000, tau: 0.002 }));
  return end;
}

/* ------------------------------------------------------------------ téléphone */

export function phoneOpen(s: SfxCtx): number {
  const p = s.p;
  let end = tone(s, s.out, s.t, { freq: 600 * p, freqEnd: 1250 * p, sweep: 0.08, peak: 0.06, attack: 0.01, tau: 0.03 });
  end = max(end, noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 1500 * p, freqEnd: 4000 * p, sweep: 0.1, q: 1.5, peak: 0.06, attack: 0.05, tau: 0.03 }));
  end = max(end, fmTone(s, s.out, s.t + 0.09, { freq: 2637 * p, ratio: 2.5, index: 0.6, peak: 0.07, tau: 0.04 }));
  return end;
}

export function phoneClose(s: SfxCtx): number {
  const p = s.p;
  let end = tone(s, s.out, s.t, { freq: 1200 * p, freqEnd: 520 * p, sweep: 0.08, peak: 0.06, attack: 0.005, tau: 0.03 });
  end = max(end, noiseBurst(s, s.out, s.t, { type: 'bandpass', freq: 3500 * p, freqEnd: 1200 * p, sweep: 0.08, q: 1.5, peak: 0.05, attack: 0.03, tau: 0.03 }));
  end = max(end, fmTone(s, s.out, s.t + 0.07, { freq: 1760 * p, ratio: 2.5, index: 0.5, peak: 0.05, tau: 0.03 }));
  return end;
}

/** Notification du téléphone : double « ping » de marimba de verre (ré – la). */
export function phoneNotify(s: SfxCtx): number {
  const p = s.p;
  let end = fmTone(s, s.out, s.t, { freq: midiHz(86) * p, ratio: 4, index: 1.5, indexTau: 0.02, peak: 0.12, tau: 0.12 });
  end = max(end, fmTone(s, s.out, s.t + 0.13, { freq: midiHz(93) * p, ratio: 4, index: 1.5, indexTau: 0.02, peak: 0.12, tau: 0.22 }));
  end = max(end, tone(s, s.out, s.t + 0.13, { freq: midiHz(81) * p, peak: 0.04, attack: 0.005, tau: 0.2 }));
  return end;
}

/* ------------------------------------------------------------------ piratage */

const HACK_NOTES = [84, 86, 88, 91, 93, 96]; // pentatonique de do

/** Bip de données bref, hauteur au hasard dans une gamme : supporte les répétitions rapides. */
export function hackBeep(s: SfxCtx): number {
  const f = midiHz(pick(HACK_NOTES)) * s.p;
  const lp = biquad(s.ctx, 'lowpass', 5000, 0.7);
  lp.connect(s.out);
  let end = tone(s, lp, s.t, { type: 'square', freq: f, peak: 0.05, attack: 0.001, hold: 0.025, tau: 0.008 });
  end = max(end, tone(s, s.out, s.t, { freq: f * 2, peak: 0.03, attack: 0.001, tau: 0.01 }));
  return end;
}

/** « Accès autorisé » : arpège montant de bips puis accord de verre. */
export function hackSuccess(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  let end = t;
  [72, 76, 79, 84, 88, 91].forEach((m, i) => {
    end = max(end, tone(s, s.out, t + i * 0.045, { type: 'square', freq: midiHz(m) * p, peak: 0.03, attack: 0.001, hold: 0.02, tau: 0.01 }));
  });
  const tc = t + 0.3;
  for (const m of [84, 91, 96]) end = max(end, fmBell(s, s.out, tc, midiHz(m) * p, 0.07, { ratio: 2, index: 1, decay: 0.5 }));
  end = max(end, noiseBurst(s, s.out, tc, { type: 'highpass', freq: 6500, peak: 0.05, attack: 0.02, tau: 0.15 }));
  return end;
}

/** « Accès refusé » : deux bourdonnements qui descendent et parasites numériques. */
export function hackFail(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  const lp = biquad(s.ctx, 'lowpass', 1800, 1);
  lp.connect(s.out);
  let end = tone(s, lp, t, { type: 'sawtooth', freq: 233 * p, freqEnd: 220 * p, sweep: 0.15, peak: 0.12, attack: 0.003, hold: 0.13, tau: 0.02 });
  end = max(end, tone(s, lp, t, { type: 'square', freq: 238 * p, peak: 0.07, attack: 0.003, hold: 0.13, tau: 0.02 }));
  end = max(end, tone(s, lp, t + 0.18, { type: 'sawtooth', freq: 175 * p, freqEnd: 150 * p, sweep: 0.3, peak: 0.12, attack: 0.003, hold: 0.25, tau: 0.04 }));
  end = max(end, tone(s, lp, t + 0.18, { type: 'square', freq: 179 * p, peak: 0.07, attack: 0.003, hold: 0.25, tau: 0.04 }));
  const glitch: Array<[number, number]> = [];
  for (let i = 0; i < 14; i++) glitch.push([rnd(0, 0.5), rnd(0.1, 0.4)]);
  end = max(end, grains(s, s.out, t, glitch, { type: 'bandpass', freq: 3000, q: 0.8, tau: 0.003 }));
  return end;
}

/* ------------------------------------------------------------------ argent */

/** Crédits reçus : arpège do – mi – sol, « ching » de verre, quelques pièces. */
export function cash(s: SfxCtx): number {
  const { t } = s;
  const p = s.p * jit(0.02);
  let end = t;
  [84, 88, 91].forEach((m, i) => {
    end = max(end, fmTone(s, s.out, t + i * 0.05, { freq: midiHz(m) * p, ratio: 2, index: 1, peak: 0.16, tau: 0.06 }));
  });
  end = max(end, fmBell(s, s.out, t + 0.15, midiHz(96) * p, 0.2, { ratio: 3.5, index: 1.4, decay: 0.45 }));
  end = max(end, partials(s, s.out, t + 0.15, midiHz(96) * p, 0.08, GLASS));
  end = max(end, coins(s, t + 0.2, [0, 0.05, 0.09, 0.16], 0.07));
  return end;
}

/** Transaction validée : trille de données puis confirmation sol – ré. */
export function purchase(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  let end = t;
  for (let i = 0; i < 6; i++) {
    end = max(end, tone(s, s.out, t + i * 0.032, { type: 'square', freq: (i % 2 ? 2093 : 2637) * p, peak: 0.025, attack: 0.001, hold: 0.012, tau: 0.004 }));
  }
  end = max(end, fmBell(s, s.out, t + 0.22, midiHz(79) * p, 0.16, { ratio: 2, index: 1.2, decay: 0.25 }));
  end = max(end, fmBell(s, s.out, t + 0.32, midiHz(86) * p, 0.18, { ratio: 2, index: 1.2, decay: 0.5 }));
  end = max(end, noiseBurst(s, s.out, t + 0.3, { type: 'highpass', freq: 7000, peak: 0.04, attack: 0.05, tau: 0.12 }));
  return end;
}

/** Recrue engagée : impact sourd et accord de la majeur pincé. */
export function recruit(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  let end = tone(s, s.out, t, { freq: 110 * p, freqEnd: 70 * p, sweep: 0.08, peak: 0.3, attack: 0.002, tau: 0.05 });
  end = max(end, noiseBurst(s, s.out, t, { kind: 'pink', type: 'lowpass', freq: 400, peak: 0.25, attack: 0.002, tau: 0.03 }));
  [69, 73, 76, 81].forEach((m, i) => {
    end = max(end, pluck(s, s.out, t + 0.06 + i * 0.07, midiHz(m) * p, 0.12, { decay: 0.22, cutoff: 5000, q: 3, detune: 8 }));
  });
  end = max(end, fmBell(s, s.out, t + 0.3, midiHz(88) * p, 0.07, { decay: 0.5 }));
  return end;
}

/** Emménagement dans un QG plus luxueux : arpège ascendant de cloches de verre sur une nappe chaude. */
export function moveIn(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  let end = pad(s, s.out, t, [m(48), m(55), m(59), m(64), m(67)], 1.6, 0.35, { cutoff: 1800, attack: 0.35, release: 1.2, vibrato: 3 });
  end = max(end, tone(s, s.out, t, { freq: m(36), peak: 0.2, attack: 0.02, tau: 0.5 }));
  [60, 64, 67, 71, 74, 79, 83].forEach((n, i) => {
    end = max(end, fmBell(s, s.out, t + i * 0.085, m(n), 0.09 + i * 0.006, { ratio: 3.5, index: 1.2, decay: 0.9 }));
  });
  end = max(end, partials(s, s.out, t + 0.62, m(88), 0.06, GLASS));
  const sparkle: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) sparkle.push([0.4 + rnd(0, 1.2), rnd(0.03, 0.1)]);
  end = max(end, grains(s, s.out, t, sparkle, { type: 'highpass', freq: 8000, tau: 0.004 }));
  return end;
}

/** Braquage réussi : montée, « ta-ta TAAA » de cuivres synthétiques, pluie de crédits. */
export function heistSuccess(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  let end = riser(s, s.out, t, 0.35, 0.1);
  const tc = t + 0.35;
  const G = [m(55), m(59), m(62), m(67)];
  end = max(end, synthStab(s, s.out, tc, G, 0.1, 0.45, { cutoff: 4000 }));
  end = max(end, synthStab(s, s.out, tc + 0.18, G, 0.1, 0.45, { cutoff: 4000 }));
  end = max(end, synthStab(s, s.out, tc + 0.36, [m(48), m(60), m(64), m(67), m(72)], 1.0, 0.6, { cutoff: 4500, release: 0.35 }));
  end = max(end, drum(s, s.out, tc, 'snare', 0.3));
  end = max(end, drum(s, s.out, tc + 0.18, 'snare', 0.3));
  end = max(end, drum(s, s.out, tc + 0.36, 'kick', 0.8));
  end = max(end, drum(s, s.out, tc + 0.36, 'snare', 0.55));
  end = max(end, cymbal(s, s.out, tc + 0.36, 0.08, 0.8));
  [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => {
    end = max(end, pluck(s, s.out, tc + 0.42 + i * 0.045, m(n), 0.07, { decay: 0.15, cutoff: 6000 }));
  });
  end = max(end, coins(s, tc + 0.5, [0, 0.04, 0.07, 0.1, 0.14, 0.17, 0.21, 0.26, 0.3], 0.06));
  end = max(end, fmBell(s, s.out, tc + 0.8, m(96), 0.1, { decay: 0.6 }));
  return end;
}

/* ------------------------------------------------------------------ signaux et jingles */

/** Quartier pris : appel de cuivres synthétiques sol – do – mi puis accord de do majeur. */
export function capture(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  const B = { bright: 0.85, detune: 10, vibrato: 0 };
  let end = brass(s, s.out, t, m(55), 0.1, 0.2, B);
  end = max(end, brass(s, s.out, t + 0.12, m(60), 0.1, 0.2, B));
  end = max(end, brass(s, s.out, t + 0.24, m(64), 0.1, 0.2, B));
  const tc = t + 0.36;
  end = max(end, synthStab(s, s.out, tc, [m(48), m(60), m(64), m(67), m(72)], 0.9, 0.5, { cutoff: 3500, release: 0.3 }));
  end = max(end, drum(s, s.out, tc, 'kick', 0.7));
  end = max(end, drum(s, s.out, tc, 'snare', 0.55));
  end = max(end, cymbal(s, s.out, tc, 0.07, 0.6));
  [72, 76, 79, 84].forEach((n, i) => {
    end = max(end, pluck(s, s.out, tc + 0.1 + i * 0.06, m(n), 0.08, { decay: 0.2 }));
  });
  return end;
}

/** Quartier perdu : sol – mi bémol, accord de do mineur sombre, impacts graves. */
export function territoryLost(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  let end = brass(s, s.out, t, m(67), 0.2, 0.18, { bright: 0.4, vibrato: 0 });
  end = max(end, brass(s, s.out, t + 0.22, m(63), 0.2, 0.18, { bright: 0.35, vibrato: 0 }));
  const tc = t + 0.45;
  end = max(end, synthStab(s, s.out, tc, [m(48), m(60), m(63), m(67)], 1.0, 0.45, { cutoff: 1400, release: 0.4 }));
  end = max(end, drum(s, s.out, t, 'tom', 0.4, 0.8));
  end = max(end, drum(s, s.out, t + 0.12, 'tom', 0.45, 0.75));
  end = max(end, drum(s, s.out, tc, 'kick', 0.8, 0.7));
  end = max(end, tone(s, s.out, tc, { type: 'triangle', freq: m(36), freqEnd: m(31), sweep: 1.2, peak: 0.12, attack: 0.05, tau: 0.35 }));
  return end;
}

/** Alerte du HUD : quatre « bi-bop » stridents sur des impulsions graves. */
export function alert(s: SfxCtx): number {
  const { t } = s;
  const p = s.p;
  const lp = biquad(s.ctx, 'lowpass', 4000, 0.8);
  lp.connect(s.out);
  let end = t;
  for (let i = 0; i < 4; i++) {
    const tt = t + i * 0.26;
    end = max(end, tone(s, lp, tt, { type: 'square', freq: 1318.5 * p, peak: 0.1, attack: 0.002, hold: 0.07, tau: 0.008 }));
    end = max(end, tone(s, lp, tt + 0.1, { type: 'square', freq: 987.8 * p, peak: 0.1, attack: 0.002, hold: 0.08, tau: 0.01 }));
    end = max(end, tone(s, s.out, tt, { type: 'triangle', freq: 110 * p, peak: 0.18, attack: 0.005, hold: 0.14, tau: 0.03 }));
  }
  return end;
}

/** Notification : deux notes de verre (mi – la). */
export function notify(s: SfxCtx): number {
  let end = fmBell(s, s.out, s.t, midiHz(88) * s.p, 0.1, { ratio: 2, index: 1.0, decay: 0.3 });
  end = max(end, fmBell(s, s.out, s.t + 0.1, midiHz(93) * s.p, 0.09, { ratio: 2, index: 1.0, decay: 0.45 }));
  return end;
}

/** Victoire : fanfare de cuivres synthétiques en do majeur. */
export function victorySting(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  const tr = 0.11;
  const B = { bright: 0.9, detune: 10, vibrato: 0 };
  let end = t;
  for (let i = 0; i < 3; i++) end = max(end, brass(s, s.out, t + i * tr, m(55), tr * 0.8, 0.2, B));
  end = max(end, brass(s, s.out, t + 3 * tr, m(60), 0.42, 0.22, { bright: 0.9, detune: 10 }));
  end = max(end, brass(s, s.out, t + 3 * tr + 0.45, m(64), 0.18, 0.2, B));
  end = max(end, brass(s, s.out, t + 3 * tr + 0.65, m(67), 0.18, 0.2, B));
  const tc = t + 3 * tr + 0.85;
  end = max(end, synthStab(s, s.out, tc, [m(48), m(60), m(64), m(67), m(72)], 1.2, 0.6, { cutoff: 4000, release: 0.35 }));
  end = max(end, drum(s, s.out, t + 3 * tr, 'kick', 0.6));
  end = max(end, drum(s, s.out, t + 3 * tr, 'snare', 0.4));
  end = max(end, drum(s, s.out, tc, 'kick', 0.8));
  end = max(end, drum(s, s.out, tc, 'snare', 0.6));
  end = max(end, cymbal(s, s.out, tc, 0.1, 0.9));
  return end;
}

/** Défaite : complainte de saxophone (mi – do – la) sur une nappe sombre. */
export function defeatSting(s: SfxCtx): number {
  const { t } = s;
  const m = (n: number): number => midiHz(n) * s.p;
  let end = saxLead(s, s.out, t, m(76), 0.38, 0.16, { bright: 0.35, vibrato: 10 });
  end = max(end, saxLead(s, s.out, t + 0.42, m(72), 0.38, 0.15, { bright: 0.3, vibrato: 10 }));
  end = max(end, saxLead(s, s.out, t + 0.84, m(69), 1.3, 0.16, { bright: 0.28, vibrato: 16, release: 0.35 }));
  end = max(end, pad(s, s.out, t + 0.8, [m(45), m(52), m(57), m(60)], 1.2, 0.35, { cutoff: 700, attack: 0.25, release: 0.9 }));
  end = max(end, drum(s, s.out, t + 0.84, 'kick', 0.7, 0.6));
  return end;
}
