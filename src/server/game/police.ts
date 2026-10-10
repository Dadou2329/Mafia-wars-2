// Police métropolitaine : patrouilles, poursuites des parrains recherchés.

import { CharKind, Weapon } from '../../shared/characters';
import { HP } from '../../shared/constants';
import { BUILDINGS, Faction } from '../../shared/city/plan';
import type { Game } from './Game';
import { SLOTS } from './Game';
import type { Vec2 } from './types';

const POLICE_COUNT = 6;
/** Prochaine relève de police, par partie (plusieurs salons peuvent tourner en même temps). */
const respawnAt = new WeakMap<Game, number>();

function patrolRoute(g: Game, i: number): Vec2[] {
  // circuits dans les beaux quartiers, avec un détour par les autres
  const districts = i % 3 === 0 ? ['westminster', 'city'] : i % 3 === 1 ? ['city', 'soho', 'westminster'] : ['westminster', 'industrial', 'city'];
  const pts: Vec2[] = [];
  for (const b of BUILDINGS) if (districts.includes(b.district)) pts.push(g.building(b.id).doors[0].out);
  // ordre aléatoire mais stable
  return pts.sort(() => g.rng.next() - 0.5).slice(0, 7);
}

export function spawnPolice(g: Game, n: number): void {
  const yard = g.w.buildings.find((b) => b.def.type === 'police')!;
  for (let i = 0; i < n; i++) {
    const p = yard.doors[0].out;
    const e = g.addEnt({
      kind: CharKind.POLICE,
      role: 'police',
      faction: Faction.POLICE,
      x: p.x + g.rng.range(-2, 2),
      z: p.z + g.rng.range(-2, 2),
      hp: HP.police,
      weapon: Weapon.CLUB,
      mode: 'patrol',
    });
    e.ai!.patrol = patrolRoute(g, i + g.rng.int(0, 2));
    e.ai!.patrolI = g.rng.int(0, 5);
    e.ai!.leash = 60;
  }
}

export function updatePolice(g: Game, dt: number): void {
  if (g.tick % 10 !== 3) return;
  let alive = 0;
  for (const e of g.ents.values()) if (e.role === 'police' && e.alive) alive++;
  if (alive < POLICE_COUNT && g.time > (respawnAt.get(g) ?? 0)) {
    respawnAt.set(g, g.time + 50);
    spawnPolice(g, 1);
  }
  // armes selon le niveau de recherche des parrains poursuivis
  for (const e of g.ents.values()) {
    if (e.role !== 'police' || !e.alive) continue;
    const ai = e.ai!;
    const tgt = ai.target >= 0 ? g.ents.get(ai.target) : undefined;
    let heat = 0;
    if (tgt?.role === 'boss' && tgt.slot) heat = g.factions[tgt.slot].heat;
    const want = heat >= 2 || (tgt && tgt.role !== 'boss') ? Weapon.REVOLVER : Weapon.CLUB;
    if (e.weapon !== want) {
      e.weapon = want;
      e.ammo = 6;
    }
    // poursuite : un policier qui voit un parrain recherché l'indique aux collègues
    if (tgt && tgt.role === 'boss' && tgt.slot) {
      g.factions[tgt.slot].heatSeenAt = g.time;
      ai.run = true;
    }
    if (!tgt && ai.mode === 'patrol') ai.run = false;
  }
  // les parrains très recherchés attirent les patrouilles proches
  for (const s of SLOTS) {
    const f = g.factions[s];
    if (f.heat < 3) continue;
    const boss = g.ents.get(f.bossId)!;
    if (!boss.alive) continue;
    g.near(boss.x, boss.z, 70, (p) => {
      if (p.role === 'police' && p.alive && p.ai!.target < 0) {
        p.ai!.aggro.set(boss.id, g.time + 20);
      }
    });
  }
  void dt;
}
