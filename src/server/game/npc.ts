// Intelligence des PNJ : perception, choix de cible, tir, corps à corps, déplacement.

import { Anim, FLAG, WEAPONS, Weapon } from '../../shared/characters';
import { SPEED } from '../../shared/constants';
import { Faction } from '../../shared/city/plan';
import { angleDiff, clamp } from '../../shared/util';
import type { Game } from './Game';
import type { Ent, Vec2 } from './types';

const PERCEPTION = 28;

export function updateNpc(g: Game, e: Ent, dt: number): void {
  const ai = e.ai!;
  const t = g.time;
  if (e.role === 'barman') {
    e.anim = Anim.IDLE;
    // le barman regarde la salle
    return;
  }
  // ---------------------------------------------------------------- perception
  if (t >= ai.scanAt) {
    ai.scanAt = t + 0.3 + g.rng.next() * 0.2;
    ai.target = pickTarget(g, e);
    // nettoyage des agressions expirées
    if (ai.aggro.size > 0) for (const [k, v] of ai.aggro) if (v < t || !g.ents.get(k)?.alive) ai.aggro.delete(k);
  }
  let goal: Vec2 | null = null;
  let run = ai.run;
  let face: number | null = null;
  const target = ai.target >= 0 ? g.ents.get(ai.target) : undefined;
  e.flags &= ~FLAG.AIM;
  if (target && target.alive) {
    const w = WEAPONS[e.weapon];
    const dx = target.x - e.x;
    const dz = target.z - e.z;
    const d = Math.hypot(dx, dz);
    face = Math.atan2(dx, dz);
    if (w.ranged) {
      const inRange = d <= w.npcRange * 1.1;
      const canSee = inRange && (t - ai.lastSeen < 0.6 || g.los(e, target));
      if (canSee) ai.lastSeen = t;
      if (canSee) {
        e.flags |= FLAG.AIM;
        tryFire(g, e, target, d);
        // petit repositionnement de temps en temps (on reste à couvert sinon)
        if (d < w.npcRange * 0.35 && e.weapon !== Weapon.SHOTGUN) {
          goal = { x: e.x - (dx / d) * 2.5, z: e.z - (dz / d) * 2.5 };
        } else goal = null;
        run = false;
      } else {
        goal = { x: target.x, z: target.z };
        run = true;
      }
    } else {
      if (d <= w.range) {
        e.flags |= FLAG.AIM;
        tryMelee(g, e, target);
        goal = null;
      } else {
        goal = { x: target.x, z: target.z };
        run = true;
        if (d < 6) e.flags |= FLAG.AIM;
      }
    }
    // laisse : les gardes ne poursuivent pas trop loin
    if (ai.post && (ai.mode === 'guard' || ai.mode === 'pool') && Math.hypot(e.x - ai.post.x, e.z - ai.post.z) > ai.leash) {
      ai.target = -1;
      goal = ai.post;
      run = true;
    }
  } else {
    ai.target = -1;
    goal = modeGoal(g, e);
    if (ai.mode !== 'flee' && ai.mode !== 'squad' && ai.mode !== 'escort') run = ai.run && goal !== null && Math.hypot(goal.x - e.x, goal.z - e.z) > 6;
  }
  // rechargement
  if (e.ammo <= 0 && WEAPONS[e.weapon].ranged && t >= e.reloadUntil) {
    e.reloadUntil = t + WEAPONS[e.weapon].reload * 1.2;
    e.ammo = WEAPONS[e.weapon].magazine;
    g.emitAll({ t: 'reload', id: e.id });
  }
  moveTo(g, e, goal, run, dt);
  if (face !== null) {
    e.yaw += angleDiff(e.yaw, face) * Math.min(1, dt * 10);
    // regarde vers la tête de la cible
    if (target) e.pitch = clamp(Math.atan2(target.y + 1.3 - (e.y + 1.4), Math.hypot(target.x - e.x, target.z - e.z)), -0.8, 0.8);
  } else e.pitch *= 0.9;
}

/** Choisit la cible hostile la plus pertinente en vue. */
function pickTarget(g: Game, e: Ent): number {
  const ai = e.ai!;
  // cible imposée (« Attaquez ! »)
  if (ai.forcedTarget >= 0) {
    const ft = g.ents.get(ai.forcedTarget);
    if (ft && ft.alive) return ft.id;
    ai.forcedTarget = -1;
  }
  const range = e.weapon === Weapon.RIFLE ? 40 : PERCEPTION;
  // on garde la cible actuelle si elle reste valable
  const cur = ai.target >= 0 ? g.ents.get(ai.target) : undefined;
  if (cur && cur.alive && g.hostile(e, cur) && Math.hypot(cur.x - e.x, cur.z - e.z) < range * 1.2) {
    if (g.time - ai.lastSeen < 4 || g.los(e, cur)) return cur.id;
  }
  const cands: [Ent, number][] = [];
  g.near(e.x, e.z, range, (o, d2) => {
    if (o === e || !o.alive) return;
    if (!g.hostile(e, o)) return;
    // priorité légère aux ennemis qui nous menacent et aux parrains
    let score = d2;
    if (o.ai && o.ai.target === e.id) score *= 0.6;
    if (o.role === 'boss') score *= 0.8;
    cands.push([o, score]);
  });
  if (cands.length === 0) return -1;
  cands.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < Math.min(3, cands.length); i++) {
    const o = cands[i][0];
    if (g.los(e, o)) {
      ai.lastSeen = g.time;
      return o.id;
    }
  }
  // personne en vue : on se dirige vers le plus proche s'il est tout près
  const [o, s] = cands[0];
  if (s < 12 * 12) return o.id;
  return -1;
}

function tryFire(g: Game, e: Ent, target: Ent, d: number): void {
  const t = g.time;
  if (t < e.nextFireAt || t < e.reloadUntil) return;
  // il faut être à peu près tourné vers la cible
  const face = Math.atan2(target.x - e.x, target.z - e.z);
  if (Math.abs(angleDiff(e.yaw, face)) > 0.5) return;
  const w = WEAPONS[e.weapon];
  if (e.ammo <= 0) return;
  e.ammo--;
  e.nextFireAt = t + w.cooldown * (1.7 + g.rng.next() * 0.9);
  const ai = e.ai!;
  let acc = ai.accuracy * (1 - 0.62 * clamp(d / w.npcRange, 0, 1.2));
  const tspeed = Math.hypot(target.vx, target.vz);
  if (tspeed > 3) acc *= 0.72;
  if (Math.hypot(e.vx, e.vz) > 1) acc *= 0.8;
  if (target.role === 'boss') acc *= 0.72;
  if (target.flags & FLAG.CROUCH) acc *= 0.8;
  const fy = e.y + 1.42;
  const fx = e.x + Math.sin(e.yaw) * 0.5;
  const fz = e.z + Math.cos(e.yaw) * 0.5;
  let firstHit = -1;
  for (let p = 0; p < w.pellets; p++) {
    if (g.rng.chance(acc)) {
      let dmg = w.damage * (0.85 + g.rng.next() * 0.3);
      if (e.weapon === Weapon.SHOTGUN) dmg *= clamp(1.25 - d / 18, 0.25, 1);
      if (firstHit < 0) firstHit = target.id;
      g.damage(target, dmg, e, g.rng.chance(0.08));
      if (!target.alive) break;
    }
  }
  // traceur : vers la cible (ou légèrement à côté)
  const miss = firstHit < 0;
  const ox = miss ? g.rng.range(-1.2, 1.2) : 0;
  const oy = miss ? g.rng.range(-0.4, 0.9) : 0;
  g.emitAll({ t: 'shot', id: e.id, w: e.weapon, fx, fy, fz, tx: target.x + ox, ty: target.y + 1.25 + oy, tz: target.z + ox * 0.5, hit: firstHit });
  g.recordShot(e.x, e.z);
  // un coup de feu près de la police rend le tireur suspect
  if (e.faction === Faction.DADOU || e.faction === Faction.EVEN) {
    g.near(e.x, e.z, 22, (p) => {
      if (p.role === 'police' && p.alive) e.criminalUntil = g.time + 15;
    });
  }
}

function tryMelee(g: Game, e: Ent, target: Ent): void {
  const t = g.time;
  if (t < e.nextFireAt) return;
  const w = WEAPONS[e.weapon];
  e.nextFireAt = t + w.cooldown * (1.5 + g.rng.next() * 0.6);
  g.emitAll({ t: 'melee', id: e.id, w: e.weapon, target: target.id });
  if (g.rng.chance(0.7)) g.damage(target, w.damage * (0.85 + g.rng.next() * 0.3), e);
}

/** Objectif de déplacement hors combat selon le mode. */
function modeGoal(g: Game, e: Ent): Vec2 | null {
  const ai = e.ai!;
  // suivre une entité (escorte, colonne d'escouade)
  if (ai.follow >= 0) {
    const leader = g.ents.get(ai.follow);
    if (leader && leader.alive) {
      const d = Math.hypot(leader.x - e.x, leader.z - e.z);
      // formation : rangs de 3 derrière le chef
      const row = Math.floor(ai.rank / 3) + 1;
      const col = (ai.rank % 3) - 1;
      const back = row * 1.3;
      const side = col * 1.1;
      const sy = Math.sin(leader.yaw);
      const cy = Math.cos(leader.yaw);
      const gx = leader.x - sy * back + cy * side;
      const gz = leader.z - cy * back - sy * side;
      const tol = 1.6 + row * 0.3;
      if (Math.hypot(gx - e.x, gz - e.z) < tol && d < 6) return null;
      // si l'emplacement de formation est inaccessible (mur), on vise le chef
      if (!g.w.nav.walkable(gx, gz)) return d > 2.2 ? { x: leader.x, z: leader.z } : null;
      return { x: gx, z: gz };
    }
    ai.follow = -1;
  }
  if (ai.mode === 'patrol' && ai.patrol.length > 0) {
    const p = ai.patrol[ai.patrolI % ai.patrol.length];
    if (Math.hypot(p.x - e.x, p.z - e.z) < 1.5) {
      if (g.time > ai.waitUntil + 3) ai.waitUntil = g.time + g.rng.range(1, 4);
      if (g.time > ai.waitUntil) ai.patrolI++;
      return null;
    }
    return p;
  }
  if (ai.post) {
    if (Math.hypot(ai.post.x - e.x, ai.post.z - e.z) < 0.9) {
      if (ai.mode === 'flee') e.removeAt = Math.min(e.removeAt, g.time + 1);
      ai.run = false;
      return null;
    }
    return ai.post;
  }
  return null;
}

/** Déplacement le long d'un chemin de la grille de navigation. */
export function moveTo(g: Game, e: Ent, goal: Vec2 | null, run: boolean, dt: number): void {
  const ai = e.ai!;
  const nav = g.w.nav;
  const speed = run ? SPEED.run : SPEED.walk;
  let wantX = 0;
  let wantZ = 0;
  if (goal) {
    const gd = Math.hypot(goal.x - e.x, goal.z - e.z);
    if (gd > 0.35) {
      // (re)calcul du chemin si besoin
      const goalMoved = Math.hypot(goal.x - ai.pathGoalX, goal.z - ai.pathGoalZ) > Math.max(1.2, gd * 0.25);
      if (!ai.path || goalMoved || ai.pathI >= ai.path.length / 2 || (g.time > ai.repathAt && ai.stuck > 0.5)) {
        if (nav.lineWalkable(e.x, e.z, goal.x, goal.z, 1)) {
          ai.path = [goal.x, goal.z];
          ai.pathI = 0;
        } else if (g.pathBudget > 0) {
          const t0 = performance.now();
          const p = nav.findPath(e.x, e.z, goal.x, goal.z, 25000);
          g.pathBudget -= performance.now() - t0 + 0.05;
          ai.path = p ?? [goal.x, goal.z];
          ai.pathI = 0;
        }
        ai.pathGoalX = goal.x;
        ai.pathGoalZ = goal.z;
        ai.repathAt = g.time + 2 + g.rng.next();
      }
      if (ai.path) {
        let px = ai.path[ai.pathI * 2];
        let pz = ai.path[ai.pathI * 2 + 1];
        if (Math.hypot(px - e.x, pz - e.z) < 0.45 && ai.pathI < ai.path.length / 2 - 1) {
          ai.pathI++;
          px = ai.path[ai.pathI * 2];
          pz = ai.path[ai.pathI * 2 + 1];
        }
        const dx = px - e.x;
        const dz = pz - e.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01) {
          const s = Math.min(speed, d / dt);
          wantX = (dx / d) * s;
          wantZ = (dz / d) * s;
        }
      }
    } else {
      ai.path = null;
    }
  } else ai.path = null;
  // séparation entre voisins
  let sx = 0;
  let sz = 0;
  g.near(e.x, e.z, 0.9, (o, d2) => {
    if (o === e || !o.alive || d2 < 1e-6) return;
    const d = Math.sqrt(d2);
    const k = (0.9 - d) / 0.9;
    sx += ((e.x - o.x) / d) * k;
    sz += ((e.z - o.z) / d) * k;
  });
  wantX += sx * 1.6;
  wantZ += sz * 1.6;
  // lissage de la vitesse
  const a = 1 - Math.exp(-dt * 10);
  e.vx += (wantX - e.vx) * a;
  e.vz += (wantZ - e.vz) * a;
  const nx = e.x + e.vx * dt;
  const nz = e.z + e.vz * dt;
  const fromN = nav.idx(e.x, e.z);
  const ok = (x: number, z: number) => {
    const n = nav.idx(x, z);
    if (n < 0 || nav.floor[n] < 0) return false;
    if (fromN >= 0 && nav.floor[fromN] >= 0 && Math.abs(nav.floor[n] - nav.floor[fromN]) > 2) return false;
    return true;
  };
  if (ok(nx, nz)) {
    e.x = nx;
    e.z = nz;
  } else if (ok(nx, e.z)) {
    e.x = nx;
    e.vz *= 0.5;
  } else if (ok(e.x, nz)) {
    e.z = nz;
    e.vx *= 0.5;
  } else {
    e.vx = 0;
    e.vz = 0;
  }
  // altitude
  const h = nav.heightAt(e.x, e.z);
  if (Number.isFinite(h)) e.y += (h - e.y) * Math.min(1, dt * 14);
  // détection de blocage
  const moved = Math.hypot(e.x - ai.lastX, e.z - ai.lastZ);
  ai.lastX = e.x;
  ai.lastZ = e.z;
  const wanted = Math.hypot(wantX, wantZ);
  if (wanted > 0.5 && moved < wanted * dt * 0.25) ai.stuck += dt;
  else ai.stuck = Math.max(0, ai.stuck - dt * 2);
  if (ai.stuck > 3) {
    ai.path = null;
    ai.stuck = 0;
    // petit écart aléatoire pour se dégager
    const ang = g.rng.range(0, Math.PI * 2);
    const tx = e.x + Math.cos(ang) * 0.6;
    const tz = e.z + Math.sin(ang) * 0.6;
    if (ok(tx, tz)) {
      e.x = tx;
      e.z = tz;
    }
  }
  const sp = Math.hypot(e.vx, e.vz);
  if (!(e.flags & FLAG.AIM) && sp > 0.3) e.yaw += angleDiff(e.yaw, Math.atan2(e.vx, e.vz)) * Math.min(1, dt * 8);
  e.anim = sp > 3.2 ? Anim.RUN : sp > 0.25 ? Anim.WALK : Anim.IDLE;
}
