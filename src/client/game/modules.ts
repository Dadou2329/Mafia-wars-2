// Systèmes greffés au client de jeu (implants, conquête, QG…) : chacun vit dans son fichier et
// GameClient l'appelle aux moments clés (image, événements, états, interactions, touches).

import type { GameEvent, PrivateState, PublicState } from '../../shared/protocol';
import type { GameClient } from './GameClient';
import { createCyberUi } from './cyberUi';
import { createAbilityHud } from './abilityHud';
import { createConquestClient } from './conquestClient';
import { createHqVisuals } from './hqVisuals';

/** Interaction contextuelle proposée au joueur (touche d'interaction). */
export interface Interaction {
  key: string;
  text: string;
  sub: string;
  run: () => void;
}

export interface ClientModule {
  /** À chaque image (dt en s, now en s), après la mise à jour du joueur et des personnages. */
  update?(dt: number, now: number): void;
  onEvent?(e: GameEvent): void;
  onPub?(p: PublicState, initial: boolean): void;
  onPriv?(p: PrivateState): void;
  /**
   * Interaction proposée à cet endroit (bid : bâtiment où se tient le joueur, −1 dehors), ou null.
   * Les modules sont consultés après les véhicules et avant les interactions du QG.
   */
  interaction?(bid: number): Interaction | null;
  /** Touche pressée en jeu (hors menus) : true si le module l'a consommée. */
  onKey?(code: string): boolean;
  /** Échap : true si le module a fermé quelque chose (panneau ouvert…). */
  onEscape?(): boolean;
  /** Un panneau du module est ouvert (le joueur ne bouge plus, la souris est libre). */
  blocking?(): boolean;
  /** Nouvelle partie ou reconnexion. */
  reset?(): void;
  dispose?(): void;
}

/**
 * Fabriques des modules, dans l'ordre d'appel : chaque système ajoute ici sa fabrique
 * (import en tête de fichier, une ligne dans la liste).
 */
const FACTORIES: ((gc: GameClient) => ClientModule)[] = [
  createCyberUi,
  createAbilityHud,
  createConquestClient,
  createHqVisuals,
];

export function createClientModules(gc: GameClient): ClientModule[] {
  return FACTORIES.map((make) => make(gc));
}
