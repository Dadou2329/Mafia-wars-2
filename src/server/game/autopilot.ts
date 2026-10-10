// Pilote automatique des véhicules du serveur (convois blindés, croiseurs du NYPD) : suit une
// suite de points sur la chaussée, ralentit dans les virages, ne s'arrête pas à chaque nœud.

import type { Game } from './Game';
import type { Ent, Vec2 } from './types';

export interface Route {
  pts: Vec2[];
  i: number;
}

/**
 * Fait avancer le véhicule d'un pas sur son itinéraire. Renvoie vrai quand il est arrivé au
 * dernier point (à moins de `arrive` mètres).
 */
export function drive(g: Game, e: Ent, r: Route, speedMax: number, dt: number, arrive = 1.5): boolean {
  // points trop proches (carrefours décalés sur la voie de droite) : on les saute
  while (r.pts[r.i] && r.pts[r.i + 1] && Math.hypot(r.pts[r.i].x - e.x, r.pts[r.i].z - e.z) < 1.5) r.i++;
  const target = r.pts[r.i];
  if (!target || (!r.pts[r.i + 1] && Math.hypot(target.x - e.x, target.z - e.z) < arrive)) {
    e.vx = e.vz = 0;
    return true;
  }
  // ralentir avant les virages serrés (seulement à l'approche du carrefour)
  const d0 = Math.hypot(target.x - e.x, target.z - e.z);
  const nxt = r.pts[r.i + 1];
  let speed = speedMax;
  if (nxt && d0 < 8) {
    const a1 = Math.atan2(target.x - e.x, target.z - e.z);
    const a2 = Math.atan2(nxt.x - target.x, nxt.z - target.z);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    speed *= 1 - Math.min(0.45, turn * 0.3);
  }
  // la distance restante du pas se reporte sur les points suivants
  let left = speed * dt;
  let hx = 0;
  let hz = 0;
  for (let guard = 0; left > 1e-3 && guard < 8; guard++) {
    const t = r.pts[r.i];
    if (!t) break;
    const dx = t.x - e.x;
    const dz = t.z - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      if (!r.pts[r.i + 1]) break;
      r.i++;
      continue;
    }
    const step = Math.min(d, left);
    e.x += (dx / d) * step;
    e.z += (dz / d) * step;
    hx = dx / d;
    hz = dz / d;
    left -= step;
    if (step >= d - 1e-6) {
      if (!r.pts[r.i + 1]) break;
      r.i++;
    }
  }
  if (hx !== 0 || hz !== 0) {
    const want = Math.atan2(hx, hz);
    let diff = want - e.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    e.yaw += diff * Math.min(1, dt * 4);
    e.vx = hx * speed;
    e.vz = hz * speed;
  }
  const y = g.w.nav.heightAt(e.x, e.z, e.y);
  if (Number.isFinite(y)) e.y += (y - e.y) * Math.min(1, dt * 5);
  return false;
}
