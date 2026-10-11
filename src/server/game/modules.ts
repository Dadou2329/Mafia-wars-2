// Systèmes greffés à la simulation (conquête des bâtiments, améliorations du QG, capacités…) :
// chacun vit dans son fichier et Game l'appelle aux moments clés, sans que Game.ts ait à
// connaître ses détails.

import type { ClientAction, PrivateState, PublicState, Slot } from '../../shared/protocol';
import type { Game } from './Game';
import { createHq } from './hq';
import { conquestModule } from './conquest';
import { createElevators } from './elevator';

export interface GameModule {
  /** À chaque pas de simulation (20 Hz), après les PNJ. */
  step?(dt: number): void;
  /** Action d'un joueur : true si le module l'a traitée (Game n'y touche plus). */
  action?(slot: Slot, act: ClientAction): boolean;
  /** Complète l'état public (envoyé à tous) et l'état privé d'un joueur. */
  pub?(out: PublicState): void;
  priv?(slot: Slot, out: PrivateState): void;
  /** Un bâtiment change de propriétaire. */
  onOwner?(bid: number, owner: number, prev: number): void;
  /** Un parrain emménage dans un nouveau QG. */
  onMoveHq?(slot: Slot, bid: number): void;
}

/**
 * Fabriques des modules, dans l'ordre d'appel : chaque système ajoute ici sa fabrique
 * (import en tête de fichier, une ligne dans la liste).
 */
const FACTORIES: ((g: Game) => GameModule)[] = [createHq, conquestModule, createElevators];

export function createModules(g: Game): GameModule[] {
  return FACTORIES.map((make) => make(g));
}
