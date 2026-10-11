// Implants cybernétiques côté interface : pictogrammes, paramètres en français (libellé, unité,
// sens du progrès), commandes, couleurs et lieux d'installation (cliniques, station du QG).
// Partagé par l'écran CYBERNÉTIQUE, le HUD des capacités, le téléphone et les conseils.

import { UPGRADES } from '../../shared/constants';
import { BUILDINGS, Faction } from '../../shared/city/plan';
import { clinicSeat } from '../../shared/city/gen/clinics';
import type { BuildingInfo } from '../../shared/city/gen/context';
import {
  CAT_LABEL,
  IMPLANT_BY_ID,
  QUALITY,
  QUALITY_COLOR,
  SLOT_BY_ID,
  SLOTS,
  implantParams,
  qualityIndex,
  type Equipment,
  type ImplantCat,
  type ImplantDef,
  type ImplantKind,
  type SlotId,
} from '../../shared/implants';
import type { PrivateState, PublicState, Slot } from '../../shared/protocol';
import { actionKey, type ActionId } from '../input/bindings';
import { settings } from '../settings';
import { implantControls } from './cyberState';

// ------------------------------------------------------------------------------------ nombres

/** Espace insécable (entre un nombre et son unité). */
export const NB = ' ';

/** Nombre à la française : virgule décimale, zéros inutiles retirés (1,5 · 0,25 · 12). */
export function num(v: number, digits = 2): string {
  const k = 10 ** digits;
  const r = Math.round(v * k) / k;
  let s = Math.abs(r).toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  const [i, d] = s.split('.');
  const ig = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${r < 0 ? '−' : ''}${ig}${d ? `,${d}` : ''}`;
}

/** Couleur numérique → « #4fd8ff ». */
export const hex = (c: number): string => `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

// ------------------------------------------------------------------------------- paramètres

type Fmt = (v: number) => string;

export interface ParamSpec {
  label: string;
  fmt: Fmt;
  /** 1 : plus la valeur est grande, mieux c'est ; −1 : plus elle est petite, mieux c'est. */
  better: 1 | -1;
}

const unit =
  (u: string, d = 1): Fmt =>
  (v) =>
    `${num(v, d)}${NB}${u}`;
const M = unit('m');
const MPS = unit('m/s');
const S = unit('s');
const X: Fmt = (v) => `×${num(v, 2)}`;
const PCT: Fmt = (v) => `${num(v * 100, 0)}${NB}%`;
const PLUS_PCT: Fmt = (v) => `+${num(v * 100, 0)}${NB}%`;
/** Réduction (0..1) : « −8 % ». */
const LESS: Fmt = (v) => (v <= 0 ? 'aucune' : `−${num(v * 100, 0)}${NB}%`);
/** Multiplicateur inférieur à 1 (recul ×0,8) : « −20 % ». */
const MUL_LESS: Fmt = (v) => (v >= 1 ? 'aucune' : `−${num((1 - v) * 100, 0)}${NB}%`);
const YES: Fmt = (v) => (v > 0 ? 'oui' : 'non');
const INT: Fmt = (v) => num(v, 0);
const DEG: Fmt = (v) => `${num(v, 0)}°`;
const RAD: Fmt = (v) => `${num((v * 180) / Math.PI, 2)}°`;
const HPS: Fmt = (v) => (v <= 0 ? 'non' : `${num(v, 1)}${NB}PV/s`);
const RATE =
  (what: string): Fmt =>
  (v) =>
    `${num(1 / Math.max(0.01, v), 1)}${NB}${what}/s`;
const or0 =
  (f: Fmt, zero: string): Fmt =>
  (v) =>
    v <= 0 ? zero : f(v);

const P = (label: string, fmt: Fmt, better: 1 | -1 = 1): ParamSpec => ({ label, fmt, better });

/** Paramètres de chaque implant, dans l'ordre d'affichage (voir les commentaires de implants.ts). */
export const PARAMS: Record<string, Record<string, ParamSpec>> = {
  // bras
  grappin: {
    range: P('Portée', M),
    pull: P('Vitesse de traction', MPS),
    cd: P('Recharge', S, -1),
    steer: P('Contrôle en vol', PCT),
    chain: P('Nouveau tir en l’air', YES),
    boost: P('Élan conservé au lâcher', X),
  },
  pistoletBras: {
    dmg: P('Dégâts par balle', INT),
    mag: P('Chargeur', (v) => `${num(v, 0)} balles`),
    cd: P('Cadence de tir', RATE('tirs'), -1),
    spread: P('Dispersion', RAD, -1),
    reload: P('Rechargement', S, -1),
    burn: P('Balles incendiaires', or0((v) => `${num(v, 0)} dégâts/s`, 'non')),
  },
  lame: {
    dmg: P('Dégâts', INT),
    cd: P('Cadence', RATE('coups'), -1),
    reach: P('Allonge', M),
    lunge: P('Fente (clic droit)', or0(M, 'aucune')),
    pierce: P('Perce les blindages', or0(PCT, 'non')),
  },
  poing: {
    dmg: P('Dégâts', INT),
    cd: P('Cadence', RATE('coups'), -1),
    knock: P('Projection', MPS),
    charge: P('Coup chargé', or0((v) => `dégâts ×${num(1 + v, 1)}`, 'non')),
    breach: P('Défonce les portes renforcées', YES),
    slam: P('Onde de choc (rayon)', or0(M, 'non')),
    stun: P('Étourdissement', or0(S, 'non')),
  },
  bouclier: {
    absorb: P('Dégâts absorbés', INT),
    dur: P('Durée maximale', S),
    cd: P('Recharge', S, -1),
    arc: P('Couverture', (v) => (v >= 360 ? 'bulle 360°' : DEG(v))),
  },
  repulseur: {
    range: P('Portée', M),
    arc: P('Ouverture du cône', DEG),
    dmg: P('Dégâts', INT),
    force: P('Projection', MPS),
    cd: P('Recharge', S, -1),
    stun: P('Étourdissement', or0(S, 'non')),
    glass: P('Brise les vitres', YES),
  },
  choc: {
    range: P('Portée', M),
    chain: P('Cibles en chaîne', INT),
    dmg: P('Dégâts', INT),
    cd: P('Recharge', S, -1),
    emp: P('Machines coupées', S),
  },
  outils: {
    hack: P('Vitesse de piratage', X),
    doors: P('Force les portes à badge', YES),
    remote: P('Piratage à distance', or0(M, 'au contact')),
    cams: P('Coupe une caméra d’un geste', YES),
  },
  grip: {
    mantle: P('Rebord franchissable', M),
    climb: P('Escalade murale', or0(M, 'non')),
    speed: P('Vitesse d’escalade', X),
  },
  roquettes: {
    n: P('Roquettes par salve', INT),
    dmg: P('Dégâts par roquette', INT),
    radius: P('Rayon d’explosion', M),
    cd: P('Recharge', S, -1),
    homing: P('Guidage', PCT),
  },
  fouet: {
    dmg: P('Dégâts', INT),
    cd: P('Cadence', RATE('coups'), -1),
    reach: P('Allonge', M),
    arc: P('Arc balayé', DEG),
    pull: P('Attire la cible', or0(MPS, 'non')),
  },
  // jambes
  saut: { jump: P('Impulsion de saut', X) },
  doubleSaut: {
    air: P('Sauts en l’air', INT),
    power: P('Puissance du saut en l’air', X),
    push: P('Poussée horizontale', or0(MPS, 'aucune')),
  },
  bond: {
    dist: P('Distance du bond', M),
    charge: P('Temps de charge', S, -1),
    cd: P('Recharge', S, -1),
  },
  sprint: {
    speed: P('Vitesse de sprint', MPS),
    energy: P('Durée du sprint renforcé', S),
    regen: P('Recharge complète', S, -1),
  },
  esquive: {
    dist: P('Distance', M),
    charges: P('Charges', INT),
    cd: P('Recharge d’une charge', S, -1),
    air: P('Utilisable en l’air', YES),
  },
  glissade: {
    boost: P('Vitesse de glissade', X),
    time: P('Durée de glissade', S),
    aim: P('Tir précis en glissant', YES),
    jump: P('Saut en sortie de glissade', (v) => (v <= 1 ? 'normal' : X(v))),
  },
  amortisseurs: {
    safe: P('Chute sans dégâts', (v) => (v >= 999 ? 'illimitée' : M(v))),
    quake: P('Atterrissage sismique', or0((v) => `${num(v, 1)}${NB}m de rayon`, 'non')),
    quakeDmg: P('Dégâts sismiques', or0(INT, '—')),
  },
  courseMurale: {
    time: P('Durée de la course', S),
    speed: P('Vitesse', MPS),
    grav: P('Gravité pendant la course', X, -1),
  },
  sautMural: {
    jumps: P('Rebonds muraux', INT),
    power: P('Puissance', X),
  },
  silence: {
    hear: P('Portée d’écoute des gardes', MUL_LESS, -1),
    cam: P('Temps de détection des caméras', X),
    steps: P('Volume des pas', (v) => (v <= 0 ? 'silence total' : PCT(v)), -1),
  },
  // torse
  blindage: { reduce: P('Dégâts subis', LESS) },
  secondSouffle: {
    hp: P('Déclenchement', (v) => `sous ${PCT(v)} de vie`),
    inv: P('Invulnérabilité', S),
    heal: P('Soin', (v) => `+${PCT(v)} de vie`),
    cd: P('Recharge', S, -1),
  },
  accumulateur: {
    cdr: P('Recharges des capacités', LESS),
    energy: P('Énergie de sprint', (v) => `+${num((v - 1) * 100, 0)}${NB}%`),
  },
  surcharge: {
    reduce: P('Dégâts subis (actif)', LESS),
    dur: P('Durée', S),
    cd: P('Recharge', S, -1),
  },
  antichoc: { reduce: P('Dégâts des explosions', LESS) },
  nanobots: {
    regen: P('Soin hors combat', HPS),
    combat: P('Soin en combat', HPS),
    delay: P('Délai après une blessure', S, -1),
  },
  // colonne
  gyro: {
    air: P('Contrôle en l’air', X),
    hover: P('Gravité en plané', (v) => (v >= 1 ? 'pas de plané' : X(v)), -1),
    hoverTime: P('Durée du plané', or0(S, 'non')),
  },
  reflexesMoteurs: {
    accel: P('Accélération', X),
    land: P('Ralentissement à la réception', (v) => (v <= 0 ? 'aucun' : X(v)), -1),
    swap: P('Changement d’arme', X),
  },
  vertebres: {
    crouch: P('Vitesse accroupi', X),
    mantle: P('Vitesse pour se hisser', X),
    roll: P('Roulade (chute ÷ 2)', YES),
  },
  treuil: {
    pull: P('Traction du grappin', X),
    range: P('Portée du grappin', X),
    yank: P('Attire l’ennemi visé', YES),
  },
  // yeux
  zoom: {
    zoom: P('Grossissement en visant', X),
    range: P('Télémètre', YES),
    steady: P('Dispersion en visant', MUL_LESS, -1),
  },
  thermique: { walls: P('À travers les murs', or0((v) => `jusqu’à ${M(v)}`, 'non')) },
  nocturne: {
    gain: P('Amplification', X),
    outline: P('Ennemis détourés', YES),
  },
  marqueur: {
    range: P('Portée', M),
    persist: P('Marque persistante', or0(S, 'non')),
    squad: P('Dégâts de vos hommes sur la cible', or0(PLUS_PCT, '—')),
  },
  analyseur: {
    head: P('Dégâts à la tête', PLUS_PCT),
    implants: P('Implants adverses révélés', YES),
  },
  scanner: {
    range: P('Rayon du scan', M),
    dur: P('Durée', S),
    cd: P('Recharge', S, -1),
  },
  // peau
  derme: { reduce: P('Dégâts des balles', LESS) },
  camouflage: {
    dur: P('Invisibilité', S),
    cd: P('Recharge', S, -1),
    keep: P('Premier tir sans se révéler', YES),
  },
  isolant: {
    shock: P('Immunité électrique', YES),
    burn: P('Brûlures subies', LESS),
    stun: P('Étourdissements subis', LESS),
  },
  gel: {
    melee: P('Corps à corps subi', LESS),
    pellets: P('Plombs de fusil à pompe', LESS),
  },
  // neural
  visee: {
    recoil: P('Recul', MUL_LESS, -1),
    spread: P('Dispersion', MUL_LESS, -1),
    magnet: P('Aimantage de visée', PCT),
  },
  reflexes: {
    dur: P('Durée du surrégime', S),
    cd: P('Recharge', S, -1),
    fire: P('Cadence de tir', X),
    speed: P('Vitesse de course', X),
    reduce: P('Dégâts subis', LESS),
  },
  conscience: {
    range: P('Portée de détection', M),
    period: P('Intervalle des impulsions', S, -1),
    warn: P('Alerte quand on vous vise', YES),
    projectiles: P('Grenades et roquettes signalées', YES),
  },
  coprocesseur: {
    cdr: P('Recharges des capacités', LESS),
    swap: P('Changement d’arme', X),
    deploy: P('Sortie des armes de bras', X),
  },
  liaisonDrone: {
    dmg: P('Dégâts par tir du drone', INT),
    dur: P('Durée du drone', S),
    cd: P('Recharge', S, -1),
    recon: P('Vol des drones de reconnaissance', X),
    mark: P('Le drone marque les ennemis', YES),
  },
  commandement: {
    range: P('Rayon d’influence', M),
    dmg: P('Dégâts de vos hommes', PLUS_PCT),
    armor: P('Dégâts subis par vos hommes', LESS),
    orders: P('Portée des ordres rapides', X),
  },
};

/** Libellé d'un paramètre (repli : la clé elle-même). */
export function paramSpec(id: string, key: string): ParamSpec {
  return PARAMS[id]?.[key] ?? { label: key, fmt: (v) => num(v), better: 1 };
}

export interface ParamRow {
  key: string;
  label: string;
  a: string | null;
  b: string | null;
  /** Évolution de a vers b : 1 mieux, −1 moins bien, 0 identique, null sans objet. */
  delta: 1 | -1 | 0 | null;
}

/**
 * Paramètres d'un implant à deux niveaux (b = 0 : une seule colonne). Les clés suivent l'ordre
 * de PARAMS, puis celles qui n'y figurent pas.
 */
export function paramRows(id: string, la: number, lb = 0): ParamRow[] {
  const pa = implantParams(id, la);
  const pb = lb > 0 ? implantParams(id, lb) : null;
  const keys = [...Object.keys(PARAMS[id] ?? {}), ...Object.keys(pa).filter((k) => !PARAMS[id]?.[k])];
  return keys
    .filter((k) => pa[k] !== undefined)
    .map((k) => {
      const sp = paramSpec(id, k);
      const va = pa[k];
      const vb = pb ? pb[k] : undefined;
      let delta: ParamRow['delta'] = null;
      if (vb !== undefined) delta = vb === va ? 0 : (vb > va ? 1 : -1) * sp.better > 0 ? 1 : -1;
      return { key: k, label: sp.label, a: sp.fmt(va), b: vb === undefined ? null : sp.fmt(vb), delta };
    });
}

/**
 * Comparaison de deux implants différents (installé ↔ sélection) : les paramètres de même nom et
 * de même sens sont mis en regard (flèche), les autres listés de part et d'autre.
 */
export function compareRows(idA: string, la: number, idB: string, lb: number): ParamRow[] {
  const pa = implantParams(idA, la);
  const pb = implantParams(idB, lb);
  const rows: ParamRow[] = [];
  const seen = new Set<string>();
  for (const k of Object.keys(pa)) {
    const sa = paramSpec(idA, k);
    const sb = pb[k] !== undefined ? paramSpec(idB, k) : null;
    const same = sb && sb.label === sa.label && sb.better === sa.better;
    let delta: ParamRow['delta'] = null;
    if (same) {
      delta = pb[k] === pa[k] ? 0 : (pb[k] > pa[k] ? 1 : -1) * sa.better > 0 ? 1 : -1;
      seen.add(k);
    }
    rows.push({ key: k, label: sa.label, a: sa.fmt(pa[k]), b: same ? sb.fmt(pb[k]) : null, delta });
  }
  for (const k of Object.keys(pb)) {
    if (seen.has(k)) continue;
    const sb = paramSpec(idB, k);
    rows.push({ key: `b:${k}`, label: sb.label, a: null, b: sb.fmt(pb[k]), delta: null });
  }
  return rows;
}

// ------------------------------------------------------------------------------ libellés divers

export const KIND_LABEL: Record<ImplantKind, string> = {
  passive: 'Passif',
  active: 'Actif',
  toggle: 'Mode',
  arme: 'Arme intégrée',
};

/** Les 8 groupes d'emplacements de l'écran (le bras gauche et le bras droit à part). */
export const SLOT_GROUPS: { label: string; cat: ImplantCat; slots: SlotId[] }[] = [
  { label: 'Bras gauche', cat: 'bras', slots: ['brasG'] },
  { label: 'Bras droit', cat: 'bras', slots: ['brasD'] },
  { label: 'Jambes', cat: 'jambes', slots: ['jambes1', 'jambes2', 'jambes3'] },
  { label: 'Torse', cat: 'torse', slots: ['torse1', 'torse2'] },
  { label: 'Colonne vertébrale', cat: 'colonne', slots: ['colonne'] },
  { label: 'Yeux', cat: 'yeux', slots: ['yeux1', 'yeux2'] },
  { label: 'Peau', cat: 'peau', slots: ['peau'] },
  { label: 'Système neuronal', cat: 'neural', slots: ['neural1', 'neural2'] },
];

/** « Module 2 » pour les catégories à plusieurs emplacements, sinon le nom de l'emplacement. */
export function slotShort(slot: SlotId): string {
  const l = SLOT_BY_ID[slot].label;
  const i = l.indexOf('— ');
  return i >= 0 ? l.slice(i + 2).replace(/^m/, 'M') : l;
}

/** Libellé compact d'un emplacement : « Jambes 2 », « Bras gauche ». */
export function slotTag(slot: SlotId): string {
  const l = SLOT_BY_ID[slot].label;
  const m = /^(.*) — module (\d)$/.exec(l);
  return m ? `${m[1]} ${m[2]}` : l;
}

/** Abréviation pour les badges : « Bras G », « Jambes 2 », « Neural 1 ». */
export function slotAbbr(slot: SlotId): string {
  if (slot === 'brasG') return 'Bras G';
  if (slot === 'brasD') return 'Bras D';
  return slotTag(slot).replace('Système neuronal', 'Neural').replace('Colonne vertébrale', 'Colonne');
}

export const catLabel = (c: ImplantCat): string => CAT_LABEL[c];

export function qualityColor(def: ImplantDef, level: number): string {
  return hex(QUALITY_COLOR[qualityIndex(def, level)]);
}

/** Gamme et couleur de chaque niveau d'un implant (piste d'évolution). */
export function levelTrack(def: ImplantDef): { q: string; color: string; price: number; desc: string }[] {
  return def.levels.map((l, i) => ({ q: QUALITY[qualityIndex(def, i + 1)], color: qualityColor(def, i + 1), price: l.price, desc: l.desc }));
}

/** Nom français approché d'une couleur d'accent (« cyan », « ambre »…). */
export function colorName(c: number): string {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  if (s < 0.3) return l > 0.7 ? 'argent' : 'acier';
  let h = 0;
  const d = mx - mn;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 12 || h >= 345) return 'rouge';
  if (h < 22) return 'rouge orangé';
  if (h < 38) return 'orange';
  if (h < 47) return 'ambre';
  if (h < 60) return 'or';
  if (h < 95) return 'vert acide';
  if (h < 145) return 'vert';
  if (h < 170) return 'menthe';
  if (h < 200) return 'cyan';
  if (h < 225) return 'bleu ciel';
  if (h < 262) return 'lavande';
  if (h < 292) return 'violet';
  return 'magenta';
}

// ----------------------------------------------------------------------------------- commandes

export interface ControlInfo {
  /** Action liée (touche), ou null. */
  action: ActionId | null;
  /** Libellé de la touche (« F »), ou null. */
  key: string | null;
  /** Phrase complète : « Touche F — Bras gauche · Sortir / rentrer l'arme, puis clic gauche ». */
  text: string;
  /** Indication courte (sans la touche). */
  hint: string;
}

/**
 * Commande d'un implant s'il est installé dans cet emplacement (on simule l'installation : les
 * touches de capacité dépendent de l'ordre des emplacements).
 */
export function controlFor(equip: Equipment, id: string, slot: SlotId): ControlInfo {
  const e: Equipment = { ...equip };
  for (const s of SLOTS) if (e[s.id] === id) e[s.id] = null;
  e[slot] = id;
  const c = implantControls(e).find((x) => x.id === id);
  const b = settings.bindings;
  if (!c) return { action: null, key: null, text: 'Automatique', hint: 'Automatique' };
  const key = c.action ? actionKey(b, c.action) : null;
  let what = '';
  switch (c.action) {
    case 'armLeft':
      what = 'Bras gauche';
      break;
    case 'armRight':
      what = 'Bras droit';
      break;
    case 'dash':
      what = 'Esquive';
      break;
    case 'vision':
      what = 'Mode de vision';
      break;
    case null:
      break;
    default:
      what = `Capacité ${Number(c.action.slice(-1))}`;
  }
  const def = IMPLANT_BY_ID[id];
  let hint = c.hint;
  if (!c.action) {
    if (def?.trigger === 'accroupi') hint = `Maintenir accroupi (${actionKey(b, 'crouch')}), puis sauter (${actionKey(b, 'jump')})`;
    else if (def?.trigger === 'saut') hint = `${c.hint} (${actionKey(b, 'jump')})`;
    else if (def?.kind === 'passive') hint = 'Automatique — effet permanent';
  } else if (c.action === 'dash') hint = 'Dans la direction de votre déplacement';
  const text = key ? `Touche ${key} — ${what}${hint ? ` · ${hint}` : ''}` : hint || 'Automatique';
  return { action: c.action, key, text, hint };
}

/** Libellé court de la touche d'une capacité pour le HUD (« F », « C+␣ », « AUTO »). */
export function chipKey(action: ActionId | null, id: string): string {
  const b = settings.bindings;
  const jump = actionKey(b, 'jump');
  const j = jump === 'Espace' ? '␣' : jump;
  if (action) return actionKey(b, action);
  const def = IMPLANT_BY_ID[id];
  if (def?.trigger === 'accroupi') return `${actionKey(b, 'crouch')}+${j}`;
  if (def?.trigger === 'saut') return j;
  return 'AUTO';
}

// ----------------------------------------------------------------------------------- stations

export interface StationSpot {
  /** Clé de l'état serveur : « qg » ou « clinique:<bâtiment> ». */
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  clinic: boolean;
}

type WorldLike = { buildings: BuildingInfo[] };

/** Amélioration du QG qui installe la station cybernétique (constants.ts). */
const HQ_STATION_UPGRADE = 'cyberstation';

/** Nom d'un lieu d'installation (« Station cybernétique du QG », « Clinique de Lenox Hill »). */
export function stationName(key: string | null, world: WorldLike | null): string {
  if (!key) return '';
  if (key === 'qg') return 'Station cybernétique du QG';
  const m = /^clinique:(\d+)$/.exec(key);
  if (m) {
    const bid = Number(m[1]);
    const name = world?.buildings[bid]?.clinic?.name || BUILDINGS[bid]?.name;
    if (!name) return 'Clinique cybernétique';
    return /clinique/i.test(name) ? name : `Clinique (${name})`;
  }
  return 'Station cybernétique';
}

/**
 * Lieux où installer des implants pour ce parrain, comme le serveur (server/game/hq.ts) :
 * fauteuils des cliniques que l'adversaire ne tient pas, et station du QG si elle est achetée.
 */
export function stationSpots(world: WorldLike, pub: PublicState, priv: PrivateState, you: Slot): StationSpot[] {
  const enemy = you === 'dadou' ? Faction.EVEN : Faction.DADOU;
  const out: StationSpot[] = [];
  for (const b of world.buildings) {
    const c = b.clinic;
    if (!c || pub.buildings[b.id]?.owner === enemy) continue;
    const s = clinicSeat(c);
    out.push({ key: `clinique:${b.id}`, name: stationName(`clinique:${b.id}`, world), x: s.x, y: s.y, z: s.z, clinic: true });
  }
  const hq = world.buildings[pub.hq[you]];
  if (hq && priv.upgrades.includes(HQ_STATION_UPGRADE)) {
    const a = hq.hqAnchors?.[HQ_STATION_UPGRADE];
    const d = hq.desk ?? hq.center;
    const s = a ? clinicSeat({ name: '', x: a.x, y: a.y, z: a.z, yaw: a.yaw }) : { x: d.x, y: d.y ?? hq.floorY, z: d.z };
    out.push({ key: 'qg', name: 'Station cybernétique du QG', x: s.x, y: s.y, z: s.z, clinic: false });
  }
  return out;
}

/** Station cybernétique du QG : amélioration (nom, prix) et possession, null si elle n'existe pas. */
export function hqStationUpgrade(priv: PrivateState): { name: string; price: number; owned: boolean } | null {
  const upg = UPGRADES.find((u) => u.id === HQ_STATION_UPGRADE);
  return upg ? { name: upg.name, price: upg.price, owned: priv.upgrades.includes(upg.id) } : null;
}

/** Lieu d'installation le plus proche (distance horizontale), en préférant une clinique à égalité. */
export function nearestSpot(spots: StationSpot[], x: number, z: number, clinicsOnly = false): { spot: StationSpot; dist: number } | null {
  let best: { spot: StationSpot; dist: number } | null = null;
  for (const s of spots) {
    if (clinicsOnly && !s.clinic) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (!best || d < best.dist) best = { spot: s, dist: d };
  }
  return best;
}

/** « à 230 m », « à 1,2 km ». */
export function distText(d: number): string {
  return d >= 1000 ? `à ${num(d / 1000, 1)}${NB}km` : `à ${Math.round(d)}${NB}m`;
}

// ---------------------------------------------------------------------------------- pictogrammes

/** Pictogrammes des implants (SVG 24 × 24, traits). */
export const IMPLANT_ICON: Record<string, string> = {
  grappin: '<path d="M3.5 20.5l7.5-7.5"/><path d="M11 13c-.6-3.2.6-6.4 3.2-8.6"/><path d="M11 13c3.2.6 6.4-.6 8.6-3.2"/><path d="M11 13l7.4-7.4"/><circle cx="3.6" cy="20.4" r="1.2"/>',
  pistoletBras: '<path d="M3 8h15.5l1.5 2.6h-8l-1.2 6.4H6.6l1.2-6.4H3z"/><path d="M17.5 8V6.4"/><path d="M12 10.6h-2"/>',
  lame: '<path d="M4 20l3.4-3.4"/><path d="M6 15.4l3 3"/><path d="M8.2 15.8L19.5 3.5l-1.2 6.6-8.6 8.2"/>',
  poing: '<rect x="6" y="5" width="12" height="9" rx="2"/><path d="M10 5v4M14 5v4M6 10h12"/><path d="M9 14v6M15 14v6M7.5 20h3M13.5 20h3"/>',
  bouclier: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M12 7.5l3.8 1.6v2.6c0 2.6-1.9 4.3-3.8 5.4-1.9-1.1-3.8-2.8-3.8-5.4V9.1z"/>',
  repulseur: '<path d="M3 12h3"/><path d="M9.5 7.5c1.8 3 1.8 6 0 9"/><path d="M13.5 5c3 4 3 10 0 14"/><path d="M17.5 3c4 5.2 4 12.8 0 18"/>',
  choc: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
  outils: '<circle cx="7.5" cy="12" r="4"/><circle cx="7.5" cy="12" r="1.2"/><path d="M11.5 12H21M17 12v3M20 12v2.4"/>',
  grip: '<path d="M5 3v9a7 7 0 0 0 14 0V3h-4v9a3 3 0 0 1-6 0V3z"/><path d="M5 7h4M15 7h4"/>',
  roquettes: '<path d="M12 2c3 3 4 7 4 11l-4 4-4-4c0-4 1-8 4-11z"/><path d="M8 13l-3 3 1 3 3-2M16 13l3 3-1 3-3-2"/><circle cx="12" cy="9" r="1.6"/><path d="M12 19v3"/>',
  fouet: '<path d="M4 20c4-1 5-5 3-8s0-7 5-8 8 2 8 6-3 6-6 5"/><circle cx="4" cy="20" r="1.2"/>',
  saut: '<path d="M12 3v8M8.5 6.5L12 3l3.5 3.5"/><path d="M7 13.5l10 1.8-10 1.8 10 1.8-10 1.8"/>',
  doubleSaut: '<path d="M6 12l6-6 6 6"/><path d="M6 18.5l6-6 6 6"/>',
  bond: '<path d="M3 19c2.5-9 13.5-12 17-3"/><path d="M16.5 15.4l3.5.9 1-3.6"/><path d="M2 21h20"/>',
  sprint: '<path d="M3 8h7M5 12h8M3 16h7"/><path d="M14 6l6 6-6 6"/>',
  esquive: '<path d="M4 6l6 6-6 6"/><path d="M11 6l6 6-6 6"/><path d="M20 6v12"/>',
  glissade: '<path d="M3 19.5h18"/><path d="M4 15.5c4.2 0 7.6-1.2 10.4-4.4"/><path d="M11.4 10.4l3.4-.6-.4 3.4"/><circle cx="17.5" cy="7" r="1.8"/>',
  amortisseurs: '<path d="M12 2v4M12 18v4"/><rect x="9" y="6" width="6" height="4" rx="1"/><path d="M8 11l8 1.4-8 1.4 8 1.4-8 1.4 8 1.4"/>',
  courseMurale: '<path d="M5 3v18M2.5 6H5M2.5 10H5M2.5 14H5M2.5 18H5"/><path d="M9 17c3-2 6-6 10-8.5"/><path d="M15.4 7.4l3.8 1-1 3.8"/>',
  sautMural: '<path d="M19 3v18M19 6h2.5M19 10h2.5M19 14h2.5M19 18h2.5"/><path d="M5 21l10-6.5-6-4 6-6"/>',
  silence: '<path d="M8.5 3.5c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5z"/><path d="M6.5 15.5h4V19a2 2 0 0 1-4 0z"/><path d="M15 9l6 6M21 9l-6 6"/>',
  blindage: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  secondSouffle: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/><path d="M5.5 11.5h3l1.5-2.5 2 5 1.5-2.5h5"/>',
  accumulateur: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10.5v3"/><path d="M11.5 9l-2.2 3.2h4l-2.2 3.3"/>',
  surcharge: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M13 7l-3 5h4l-3 5"/>',
  antichoc: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5M5.3 5.3l2.5 2.5M16.2 16.2l2.5 2.5M5.3 18.7l2.5-2.5M16.2 7.8l2.5-2.5"/>',
  nanobots: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><path d="M12 8.5v7M8.5 12h7"/>',
  gyro: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2"/><ellipse cx="12" cy="12" rx="3.2" ry="8.5"/>',
  reflexesMoteurs: '<path d="M14.5 3l-6 9h5l-2 9 7-11h-5z"/><path d="M2.5 9h3.5M1.5 13h3.5M2.5 17h3.5"/>',
  vertebres: '<rect x="9" y="2.5" width="6" height="3.2" rx="1"/><rect x="8.3" y="7.6" width="7.4" height="3.2" rx="1"/><rect x="8.6" y="12.7" width="6.8" height="3.2" rx="1"/><rect x="9.4" y="17.8" width="5.2" height="3.2" rx="1"/><path d="M12 5.7v1.9M12 10.8v1.9M12 15.9v1.9"/>',
  treuil: '<circle cx="9" cy="12" r="5.5"/><circle cx="9" cy="12" r="1.6"/><path d="M9 6.5h11.5"/><path d="M18.5 4.5l2 2-2 2"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="7"/><path d="M15.5 15.5L21 21"/><path d="M10.5 6.5v8M6.5 10.5h8"/>',
  thermique: '<path d="M12 21.5a6 6 0 0 1-6-6c0-4 4-6 4-11.5 3 2 8 6.5 8 11.5a6 6 0 0 1-6 6z"/><path d="M12 21.5a2.6 2.6 0 0 1-2.6-2.6c0-2 2.6-3.6 2.6-3.6s2.6 1.6 2.6 3.6a2.6 2.6 0 0 1-2.6 2.6z"/>',
  nocturne: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/><path d="M17 3.5l.6 1.6 1.6.6-1.6.6L17 8l-.6-1.7-1.6-.6 1.6-.6z"/>',
  marqueur: '<path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z"/><circle cx="12" cy="12" r="2.2"/>',
  analyseur: '<path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/><path d="M12 7.5v1.3M12 15.2v1.3M7.5 12h1.3M15.2 12h1.3"/>',
  scanner: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6.4-6.4"/><circle cx="15.5" cy="14.5" r="1"/>',
  derme: '<path d="M3 8c3-2 6 2 9 0s6-2 9 0"/><path d="M3 12.5c3-2 6 2 9 0s6-2 9 0"/><path d="M3 17c3-2 6 2 9 0s6-2 9 0"/>',
  camouflage: '<circle cx="12" cy="6.5" r="3.2" stroke-dasharray="2.2 1.8"/><path d="M5.5 21v-3.5a6.5 6.5 0 0 1 13 0V21" stroke-dasharray="2.6 2"/>',
  isolant: '<path d="M13 3L6 13h5l-1 8 7-10h-5z"/><path d="M4 4l16 16"/>',
  gel: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
  visee: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
  reflexes: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l3 2"/><path d="M9.5 2.5h5M12 2.5V6"/><path d="M18.5 6.5l1.5-1.5"/>',
  conscience: '<circle cx="12" cy="12" r="1.6"/><path d="M8.3 8.3a5.3 5.3 0 0 0 0 7.4M15.7 8.3a5.3 5.3 0 0 1 0 7.4M5.4 5.4a9.4 9.4 0 0 0 0 13.2M18.6 5.4a9.4 9.4 0 0 1 0 13.2"/>',
  coprocesseur: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="10" y="10" width="4" height="4"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  liaisonDrone: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/><path d="M8 8l1.5 1.5M16 8l-1.5 1.5M8 16l1.5-1.5M16 16l-1.5-1.5"/>',
  commandement: '<circle cx="12" cy="6.5" r="2.6"/><circle cx="5" cy="17.5" r="2.3"/><circle cx="12" cy="18.5" r="2.3"/><circle cx="19" cy="17.5" r="2.3"/><path d="M12 9.1v7.1M10.6 8.7l-4.4 6.9M13.4 8.7l4.4 6.9"/>',
};

/** Pictogrammes des catégories (emplacements libres). */
export const CAT_ICON: Record<ImplantCat, string> = {
  bras: '<path d="M5 21v-6.5l3.2-5.2 6.3-1.1"/><rect x="14.5" y="5.5" width="5.5" height="5.5" rx="1.2"/><path d="M8.6 14.5h4"/>',
  jambes: '<path d="M9 3l-1 9 1.2 8H6M15 3l1 9-1.2 8H18"/>',
  torse: '<path d="M7 4h10l2.2 6-2.2 10H7L4.8 10z"/><path d="M12 4v16M8 9.5h8"/>',
  colonne: IMPLANT_ICON.vertebres,
  yeux: '<path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  peau: IMPLANT_ICON.derme,
  neural: '<path d="M10.5 4A3 3 0 0 0 7 6.5a3 3 0 0 0-2.4 4.8A3 3 0 0 0 6 16.6 3 3 0 0 0 9 20h1.5z"/><path d="M13.5 4A3 3 0 0 1 17 6.5a3 3 0 0 1 2.4 4.8 3 3 0 0 1-1.4 5.3 3 3 0 0 1-3 3.4h-1.5z"/><path d="M10.5 9H9M10.5 13.5H8.5M13.5 9H15M13.5 13.5h2"/>',
};

/** Élément <svg> d'un pictogramme (les couleurs viennent du CSS : currentColor). */
export function iconSvg(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function implantIcon(id: string): string {
  const def = IMPLANT_BY_ID[id];
  return iconSvg(IMPLANT_ICON[id] ?? (def ? CAT_ICON[def.cat] : CAT_ICON.bras));
}
