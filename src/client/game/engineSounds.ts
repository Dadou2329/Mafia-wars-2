// Sons continus de la ville : moteurs des véhicules proches (le régime suit la vitesse), sirènes
// de la police quand on est recherché, alarmes des braquages. Les boucles du moteur audio sont
// limitées : on ne garde que les sources les plus proches et on coupe les autres en fondu.

import { audio } from '../audio/AudioEngine';
import type { LoopHandle, LoopName } from '../audio/types';

export interface LoopSource {
  /** Identifiant stable (véhicule, voiture de la circulation, bâtiment…). */
  key: string;
  loop: LoopName;
  x: number;
  y: number;
  z: number;
  /** Régime 1 (ralenti) à 2,5 (pleine vitesse). */
  pitch: number;
  volume: number;
}

export class EngineSounds {
  private loops = new Map<string, { h: LoopHandle; loop: LoopName }>();

  update(sources: LoopSource[], px: number, py: number, pz: number, max = 10): void {
    const d = (s: LoopSource): number => Math.hypot(s.x - px, s.y - py, s.z - pz);
    sources.sort((a, b) => d(a) - d(b));
    const keep = new Set<string>();
    for (const s of sources.slice(0, max)) {
      keep.add(s.key);
      const pos = { x: s.x, y: s.y, z: s.z };
      const cur = this.loops.get(s.key);
      if (cur && cur.h.active && cur.loop === s.loop) {
        cur.h.update({ pos, pitch: s.pitch, volume: s.volume });
        continue;
      }
      cur?.h.stop(0.2);
      const h = audio.loop(s.loop, { pos, pitch: s.pitch, volume: s.volume });
      if (h) this.loops.set(s.key, { h, loop: s.loop });
      else this.loops.delete(s.key);
    }
    for (const [k, v] of this.loops)
      if (!keep.has(k)) {
        v.h.stop(0.5);
        this.loops.delete(k);
      }
  }

  stopAll(): void {
    for (const v of this.loops.values()) v.h.stop(0.3);
    this.loops.clear();
  }
}

/** Régime moteur selon la vitesse. */
export function rpm(speed: number, max: number): number {
  return 1 + 1.5 * Math.min(1, Math.abs(speed) / Math.max(1, max));
}
