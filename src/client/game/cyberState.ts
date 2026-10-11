// État cybernétique local du joueur, côté client : tenu à jour par le contrôleur des capacités
// (prédiction immédiate des recharges, armes de bras, visions) et par l'état privé du serveur ;
// lu par l'interface (écran CYBERNÉTIQUE, HUD des capacités, téléphone).

import { IMPLANT_BY_ID, SLOTS, type Equipment, type SlotId } from '../../shared/implants';
import type { ActionId } from '../input/bindings';

export type VisionMode = 'normal' | 'thermal' | 'night';

/** Une capacité installée, telle que l'affiche le HUD. */
export interface AbilityView {
  /** Implant (voir IMPLANT_BY_ID). */
  id: string;
  /** Touche qui la déclenche, ou null (passif, automatique ou lié au saut / à l'accroupi). */
  action: ActionId | null;
  /** Texte court de la commande quand il n'y a pas de touche dédiée (« Saut en l'air », « Accroupi + saut »…). */
  hint?: string;
  /** Recharge restante et totale (s). */
  cd: number;
  cdMax: number;
  /** Charges disponibles et maximum (esquive), −1 si sans charges. */
  charges: number;
  chargesMax: number;
  /** En cours (bouclier levé, camouflage, réflexes, vision active, grappin accroché…). */
  active: boolean;
  /** Arme de bras sortie. */
  out?: boolean;
  /** Munitions (pistolet d'avant-bras). */
  ammo?: number;
  ammoMax?: number;
}

export class CyberClientState {
  /** Capacités installées (ordre des emplacements). */
  abilities: AbilityView[] = [];
  vision: VisionMode = 'normal';
  /** Énergie du sprint renforcé (0..1), −1 sans implant de sprint. */
  energy = -1;
  /** Bouclier : points restants et maximum (0 : baissé). */
  shield = 0;
  shieldMax = 0;
  /** Clinique ou station cybernétique à portée (installation possible), copie de l'état serveur. */
  station: string | null = null;
  /** Instant (performance.now()/1000) de la dernière mise à jour. */
  at = 0;

  reset(): void {
    this.abilities = [];
    this.vision = 'normal';
    this.energy = -1;
    this.shield = 0;
    this.shieldMax = 0;
    this.station = null;
    this.at = 0;
  }
}

/** Instance unique (une partie à la fois). */
export const cyberState = new CyberClientState();

// ------------------------------------------------------------------------- commandes des implants

/** Touches de capacité, attribuées dans l'ordre des emplacements aux implants « capacite ». */
export const ABILITY_KEYS: ActionId[] = ['ability1', 'ability2', 'ability3', 'ability4', 'ability5'];

/**
 * Commande de chaque implant installé : touche dédiée (bras, esquive, capacités, vision) ou
 * indication (« Saut en l'air », « Accroupi + saut », « Automatique »). Ordre des emplacements.
 */
export function implantControls(equip: Equipment): { id: string; slot: SlotId; action: ActionId | null; hint: string }[] {
  const out: { id: string; slot: SlotId; action: ActionId | null; hint: string }[] = [];
  let ability = 0;
  let vision = false;
  for (const s of SLOTS) {
    const id = equip[s.id];
    const def = id ? IMPLANT_BY_ID[id] : undefined;
    if (!def) continue;
    let action: ActionId | null = null;
    let hint = '';
    switch (def.trigger) {
      case 'bras':
        action = s.id === 'brasG' ? 'armLeft' : 'armRight';
        hint = def.kind === 'arme' ? 'Sortir / rentrer l’arme, puis clic gauche' : def.id === 'bouclier' ? 'Maintenir la touche' : '';
        break;
      case 'esquive':
        action = 'dash';
        hint = 'Direction de déplacement';
        break;
      case 'capacite':
        action = ABILITY_KEYS[ability++] ?? null;
        break;
      case 'vision':
        // une seule touche : elle passe d'une vision à l'autre (thermique, nocturne, normale)
        action = 'vision';
        hint = vision ? 'Même touche que l’autre vision' : '';
        vision = true;
        break;
      case 'saut':
        hint = def.id === 'sautMural' ? 'Sauter contre un mur' : 'Sauter en l’air';
        break;
      case 'accroupi':
        hint = 'Maintenir accroupi, puis sauter';
        break;
      default:
        hint = 'Automatique';
    }
    out.push({ id: def.id, slot: s.id, action, hint });
  }
  return out;
}
