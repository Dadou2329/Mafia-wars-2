// Paramètres du joueur, enregistrés dans le navigateur (localStorage).

import { ACTIONS, defaultBindings, type Bindings } from './input/bindings';

export type Quality = 'basse' | 'moyenne' | 'haute' | 'ultra';

export interface Settings {
  name: string;
  sensitivity: number; // 0.2..3
  invertY: boolean;
  fov: number; // 60..100
  quality: Quality;
  renderScale: number; // 0.5..1
  bloom: boolean;
  showFps: boolean;
  thirdPerson: boolean;
  volMaster: number;
  volMusic: number;
  volSfx: number;
  volAmbience: number;
  bindings: Bindings;
  tutorialDone: boolean;
  crosshair: 'point' | 'croix' | 'cercle';
  subtitlesNews: boolean;
  /** Personnalisation des parrains (couleurs secondaires, chapeau). */
  custom: { dadou: Record<string, unknown>; even: Record<string, unknown> };
}

const KEY = 'mafiawars.settings.v1';

export function defaultSettings(): Settings {
  return {
    name: 'Joueur',
    sensitivity: 1,
    invertY: false,
    fov: 75,
    quality: 'haute',
    renderScale: 1,
    bloom: true,
    showFps: false,
    thirdPerson: true,
    volMaster: 0.8,
    volMusic: 0.55,
    volSfx: 0.85,
    volAmbience: 0.7,
    bindings: defaultBindings(),
    tutorialDone: false,
    crosshair: 'croix',
    subtitlesNews: true,
    custom: { dadou: {}, even: {} },
  };
}

function load(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...d, ...s, custom: { ...d.custom, ...(s.custom ?? {}) } };
    // nouvelles actions ajoutées depuis la sauvegarde
    const b = defaultBindings();
    for (const a of ACTIONS) if (Array.isArray(s.bindings?.[a.id])) b[a.id] = s.bindings![a.id];
    merged.bindings = b;
    return merged;
  } catch {
    return d;
  }
}

export const settings: Settings = load();

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* stockage indisponible */
  }
  for (const l of listeners) l(settings);
}

export function onSettingsChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetSettings(keepName = true): void {
  const name = settings.name;
  Object.assign(settings, defaultSettings());
  if (keepName) settings.name = name;
  saveSettings();
}

/** Paramètres graphiques dérivés de la qualité. */
export function qualityProfile(q: Quality): { shadow: number; pixelRatio: number; propDist: number; charDist: number; fogScale: number; antialias: boolean; drawDist: number } {
  switch (q) {
    case 'basse':
      return { shadow: 0, pixelRatio: 0.75, propDist: 45, charDist: 70, fogScale: 1.45, antialias: false, drawDist: 95 };
    case 'moyenne':
      return { shadow: 1024, pixelRatio: 1, propDist: 60, charDist: 90, fogScale: 1.2, antialias: false, drawDist: 135 };
    case 'haute':
      return { shadow: 2048, pixelRatio: 1, propDist: 75, charDist: 110, fogScale: 1, antialias: true, drawDist: 200 };
    case 'ultra':
      return { shadow: 4096, pixelRatio: Math.min(2, window.devicePixelRatio || 1), propDist: 100, charDist: 140, fogScale: 0.9, antialias: true, drawDist: 1000 };
  }
}
