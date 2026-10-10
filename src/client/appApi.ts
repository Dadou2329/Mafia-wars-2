// Contrat entre l'application et les écrans d'interface (menus, salon, paramètres…).

import type { Net } from './net/net';
import type { AudioEngine } from './audio/AudioEngine';
import type { MatchStats, Slot } from '../shared/protocol';

export interface Portraits {
  dadou: string; // URL de données (PNG) du portrait 3D
  even: string;
}

export interface AppApi {
  readonly net: Net;
  readonly audio: AudioEngine;
  /** Portraits 3D des deux parrains (rendus une fois au démarrage). */
  readonly portraits: Promise<Portraits>;
  /** Résolue quand Londres est générée (le jeu peut démarrer). */
  readonly worldReady: Promise<void>;
  showMenu(): void;
  showLobby(): void;
  showSettings(): void;
  showControls(): void;
  showHelp(): void;
  showCredits(): void;
  /** Crée un salon ; renvoie un message d'erreur ou null. */
  createRoom(): Promise<string | null>;
  /** Rejoint un salon ; renvoie un message d'erreur ou null. */
  joinRoom(code: string): Promise<string | null>;
  /** Quitte le salon et revient au menu. */
  leaveRoom(): void;
  /** Son d'interface. */
  click(): void;
}

export interface VictoryData {
  winner: Slot | null;
  me: Slot;
  reason: string;
  stats: Record<Slot, MatchStats>;
}
