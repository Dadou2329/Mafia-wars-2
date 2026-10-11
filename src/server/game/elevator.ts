// Ascenseurs des immeubles à étages (tours, penthouses…) pour les parrains : debout devant une
// porte d'ascenseur, le joueur choisit un étage ; le serveur vérifie qu'il est bien devant une
// porte de cet immeuble puis le dépose devant la porte de l'étage demandé. (Les PNJ, eux,
// empruntent les ascenseurs par la navigation : liens « elevator » du graphe.)

import type { ClientAction, Slot } from '../../shared/protocol';
import type { Game } from './Game';
import type { GameModule } from './modules';

/** Distance maximale à la porte (m, à plat) et écart d'étage toléré (m). */
export const ELEVATOR_REACH = 2.6;
const FLOOR_TOL = 1.8;

export function createElevators(g: Game): GameModule {
  const lastRide = new Map<Slot, number>();
  return {
    action(slot: Slot, act: ClientAction): boolean {
      if (act.a !== 'elevator') return false;
      const f = g.factions[slot];
      const boss = g.ents.get(f.bossId);
      if (!boss || !boss.alive || f.vehicle >= 0) return true;
      if (g.time - (lastRide.get(slot) ?? -10) < 1) return true;
      const b = g.w.byId.get(act.b);
      const stops = b?.elevator;
      if (!b || !stops || !stops[act.to]) return true;
      const here = stops.findIndex((s) => Math.hypot(s.x - boss.x, s.z - boss.z) < ELEVATOR_REACH && Math.abs(s.y - boss.y) < FLOOR_TOL);
      if (here < 0 || here === act.to) return true;
      const to = stops[act.to];
      lastRide.set(slot, g.time);
      const from = stops[here];
      g.emitAll({ t: 'sound', s: 'elevator_ding', x: from.x, y: from.y + 1.5, z: from.z });
      // l'orientation de l'arrêt tourne le dos à la porte : face à l'étage
      g.teleport(slot, to.x, to.y, to.z, to.yaw);
      g.emitAll({ t: 'sound', s: 'elevator_ding', x: to.x, y: to.y + 1.5, z: to.z });
      g.notify(slot, `Ascenseur : ${to.label}.`, 'info');
      return true;
    },
  };
}
