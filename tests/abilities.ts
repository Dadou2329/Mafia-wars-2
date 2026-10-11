// Test des implants côté serveur (sans navigateur) : achat, amélioration, installation, retrait,
// configurations, puis chaque capacité : grappin (validation), esquive, bouclier, protections,
// cœur de secours, répulseur, arc électrique, micro-roquettes, camouflage, chutes, armes de bras,
// drone de combat, bits visibles et égalité des deux parrains.
// Usage : npx tsx tests/abilities.ts
import { Anim, CharKind, INPUT_AIR, Weapon } from '../src/shared/characters';
import { CFX, IMPLANTS, IMPLANT_COUNT, QUALITY, type SlotId } from '../src/shared/implants';
import type { PlayerInput, Slot } from '../src/shared/protocol';
import { getWorld } from '../src/server/world';
import { Game } from '../src/server/game/Game';
import { setStationPoints } from '../src/server/game/cyber';
import { concealed } from '../src/server/game/abilities';
import type { Ent } from '../src/server/game/types';

let failures = 0;
let passed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
  if (ok) passed++;
  else failures++;
}

const w = getWorld();
const g = new Game(w, { timeLimit: 0, daytime: 'night', weather: 'clear', tips: false });
g.takeOutbox();
const D = g.factions.dadou;
const E = g.factions.even;
const bossD = g.ents.get(D.bossId)!;
const bossE = g.ents.get(E.bossId)!;

// une rue dégagée devant le QG de Dadou
const hq = g.hq('dadou');
const door = hq.doors[0];
const out = door.out;
const cx = (hq.footprint[0] + hq.footprint[2]) / 2;
const cz = (hq.footprint[1] + hq.footprint[3]) / 2;
let ux = out.x - cx;
let uz = out.z - cz;
const ul = Math.hypot(ux, uz) || 1;
ux /= ul;
uz /= ul;
const street = { x: out.x + ux * 4, z: out.z + uz * 4 };
const groundY = (x: number, z: number) => {
  const y = w.nav.heightAt(x, z, 0);
  return Number.isFinite(y) ? y : 0;
};

function place(e: Ent, x: number, z: number, yaw: number): void {
  if (e.role === 'boss' && e.slot) g.teleport(e.slot, x, groundY(x, z), z, yaw);
  else {
    e.x = x;
    e.z = z;
    e.y = groundY(x, z);
  }
  e.yaw = yaw;
}

function steps(n: number): void {
  for (let i = 0; i < n; i++) {
    g.step();
    g.takeOutbox();
  }
}

function events(fn: () => void): { all: any[] } {
  g.takeOutbox();
  fn();
  const o = g.takeOutbox();
  return { all: [...o.all, ...o.dadou, ...o.even] };
}

/** Ennemi immobile (homme du camp adverse, sans IA), inscrit dans la grille spatiale. */
function dummy(x: number, z: number, hp = 400): Ent {
  const e = g.addEnt({ kind: CharKind.GANGSTER, role: 'gangster', faction: E.faction, slot: 'even', x, z, hp, weapon: Weapon.FISTS });
  e.ai = null;
  steps(1);
  return e;
}

// partout une station d'installation (le module des cliniques fournit les vraies)
setStationPoints((gg, slot) => {
  const b = gg.ents.get(gg.factions[slot].bossId)!;
  return [{ key: 'test', x: b.x, y: b.y, z: b.z }];
});

function cyber(slot: Slot, op: 'buy' | 'upgrade' | 'equip' | 'unequip' | 'save' | 'load', id?: string, s?: SlotId, n?: number): void {
  g.action(slot, { a: 'cyber', op, id, slot: s, n });
}

/** Achète l'implant au niveau voulu et l'installe (emplacement donné, sinon automatique). */
function give(slot: Slot, id: string, lv: number, s?: SlotId): void {
  g.factions[slot].money += 1e6;
  if (!g.factions[slot].cyber.owned.has(id)) cyber(slot, 'buy', id);
  while ((g.factions[slot].cyber.owned.get(id) ?? 0) < lv) cyber(slot, 'upgrade', id);
  if (s) cyber(slot, 'equip', id, s);
}

// ============================================================================ catalogue
console.log('\nCatalogue');
check(`au moins 35 implants (${IMPLANT_COUNT})`, IMPLANT_COUNT >= 35);
check('noms et descriptions en français pour chaque niveau', IMPLANTS.every((d) => d.name && d.summary && d.levels.every((l) => l.desc && l.price > 0)));
check('gammes Standard → Légendaire', QUALITY.length === 5 && QUALITY[0] === 'Standard' && QUALITY[4] === 'Légendaire');
check('prix croissants par niveau', IMPLANTS.every((d) => d.levels.every((l, i) => i === 0 || l.price > d.levels[i - 1].price)));

// ============================================================================ achat, installation
console.log('\nAchat, amélioration, installation');
place(bossD, street.x, street.z, Math.atan2(ux, uz));
D.money = 300;
cyber('dadou', 'buy', 'grappin');
check('achat refusé sans argent', !D.cyber.owned.has('grappin'));
D.money = 10000;
cyber('dadou', 'buy', 'grappin');
check('achat : niveau 1 et argent débité', D.cyber.owned.get('grappin') === 1 && D.money === 10000 - 650, `argent ${D.money}`);
check('installé d’office dans un bras libre', D.cyber.equip.brasG === 'grappin');
cyber('dadou', 'upgrade', 'grappin');
check('amélioration niveau 2', D.cyber.owned.get('grappin') === 2);
cyber('dadou', 'equip', 'grappin', 'brasD');
check('déplacé vers le bras droit', D.cyber.equip.brasD === 'grappin' && D.cyber.equip.brasG === null);
cyber('dadou', 'equip', 'grappin', 'jambes1');
check('emplacement de mauvaise catégorie refusé', D.cyber.equip.jambes1 === null);
give('dadou', 'pistoletBras', 1);
check('arme de bras installée → arme disponible', D.cyber.equip.brasG === 'pistoletBras' && D.weapons.has(Weapon.ARM_PISTOL));
cyber('dadou', 'save', undefined, undefined, 0);
cyber('dadou', 'unequip', undefined, 'brasG');
check('retrait : l’arme de bras disparaît', D.cyber.equip.brasG === null && !D.weapons.has(Weapon.ARM_PISTOL));
cyber('dadou', 'load', undefined, undefined, 0);
check('configuration « Combat » réappliquée', D.cyber.equip.brasG === 'pistoletBras' && D.cyber.equip.brasD === 'grappin');
const look = g.info(bossD).cyber ?? [];
check('apparence publique : implants visibles des autres', look.includes('brasD=grappin:2') && look.includes('brasG=pistoletBras:1'), look.join(' '));
setStationPoints(() => []);
cyber('dadou', 'unequip', undefined, 'brasG');
check('hors station : installation impossible', D.cyber.equip.brasG === 'pistoletBras');
setStationPoints((gg, slot) => {
  const b = gg.ents.get(gg.factions[slot].bossId)!;
  return [{ key: 'test', x: b.x, y: b.y, z: b.z }];
});

// ============================================================================ grappin
console.log('\nGrappin');
steps(2);
{
  const ev = events(() => g.action('dadou', { a: 'ab', id: 'grappin', o: [bossD.x, bossD.y + 1.6, bossD.z], p: [bossD.x + 200, bossD.y + 5, bossD.z] }));
  check('ancre hors de portée refusée', D.cyber.grapple === null && !ev.all.some((e) => e.t === 'ab' && e.ab === 'grappin'));
  // façade du QG : on vise la façade, en montant, depuis la rue
  place(bossD, door.out.x + ux * 6, door.out.z + uz * 6, Math.atan2(-ux, -uz));
  let anchor: number[] | null = null;
  const eye = { x: bossD.x, y: bossD.y + 1.6, z: bossD.z };
  for (const up of [0.6, 0.45, 0.3, 0.8]) {
    const l = Math.hypot(1, up);
    const d = { x: -ux / l, y: up / l, z: -uz / l };
    const t = w.city.world.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, 20, undefined, 'solid');
    if (t > 2) {
      anchor = [eye.x + d.x * (t - 0.05), eye.y + d.y * (t - 0.05), eye.z + d.z * (t - 0.05)];
      break;
    }
  }
  if (anchor) {
    const ev2 = events(() => g.action('dadou', { a: 'ab', id: 'grappin', o: [bossD.x, bossD.y + 1.6, bossD.z], p: anchor! }));
    check('ancre valide (façade) acceptée et diffusée', D.cyber.grapple !== null && ev2.all.some((e) => e.t === 'ab' && e.ab === 'grappin'), JSON.stringify(anchor));
    check('bit visible GRAPPIN', (g.snapshotFor('even', new Map()).find((s) => s.id === bossD.id)!.fx & CFX.GRAPPLE) !== 0);
    g.action('dadou', { a: 'ab', id: 'grappin-fin' });
    check('lâcher : fin du grappin, élan toléré', D.cyber.grapple === null && D.cyber.burst !== null);
    g.action('dadou', { a: 'ab', id: 'grappin', o: [bossD.x, bossD.y + 1.6, bossD.z], p: anchor });
    check('recharge respectée', D.cyber.grapple === null);
  } else check('façade du QG trouvée pour le grappin', false);
}

// ============================================================================ esquive et allure tolérée
console.log('\nEsquive et allure');
give('dadou', 'esquive', 1, 'jambes1');
steps(1);
place(bossD, street.x, street.z, 0);
// élan du grappin éteint, téléportation ancienne : la vérification d'allure s'applique
steps(20 * 3.5);
{
  const tp = D.tp;
  const inp = (x: number, z: number, flags = 0): PlayerInput => [x, groundY(x, z), z, 0, 0, 0, 0, Anim.RUN, flags, Weapon.PISTOL, tp];
  g.input('dadou', inp(bossD.x, bossD.z));
  steps(1);
  // saut de 2,4 m en un pas (50 ms) : trop rapide sans esquive
  g.input('dadou', inp(bossD.x + 2.4, bossD.z));
  check('déplacement trop rapide recalé', D.tp === tp + 1);
  const tp2 = D.tp;
  const inp2 = (x: number, z: number): PlayerInput => [x, groundY(x, z), z, 0, 0, 0, 0, Anim.DASH, 0, Weapon.PISTOL, tp2];
  g.input('dadou', inp2(bossD.x, bossD.z));
  steps(1);
  g.action('dadou', { a: 'ab', id: 'esquive', p: [bossD.x + 6, bossD.y, bossD.z] });
  check('esquive : une charge consommée', D.cyber.charges.get('esquive')!.n === 0);
  g.input('dadou', inp2(bossD.x + 2.0, bossD.z));
  check('esquive : le bond rapide est toléré', D.tp === tp2, `tp ${D.tp} / ${tp2}`);
  steps(20 * 4);
  check('charge rechargée (3,5 s)', D.cyber.charges.get('esquive')!.n === 1);
}

// ============================================================================ dégâts et protections
console.log('\nProtections');
{
  const shooter = dummy(bossD.x + Math.sin(bossD.yaw) * 6, bossD.z + Math.cos(bossD.yaw) * 6);
  shooter.weapon = Weapon.PISTOL;
  bossD.hp = bossD.maxHp;
  g.damage(bossD, 50, shooter);
  const base = bossD.maxHp - bossD.hp;
  bossD.hp = bossD.maxHp;
  give('dadou', 'blindage', 5, 'torse1');
  give('dadou', 'derme', 4, 'peau');
  g.damage(bossD, 50, shooter);
  const reduced = bossD.maxHp - bossD.hp;
  check('blindage + derme réduisent les balles', reduced < base && reduced === Math.round(50 * 0.76 * 0.75), `${base} → ${reduced}`);
  // surcharge défensive par-dessus : plafond de protection (jamais invincible)
  give('dadou', 'surcharge', 3, 'torse2');
  g.action('dadou', { a: 'ab', id: 'surcharge' });
  bossD.hp = bossD.maxHp;
  g.damage(bossD, 100, shooter);
  const capped = bossD.maxHp - bossD.hp;
  check('jamais invincible : au moins 15 % des dégâts passent', capped >= 15, `${capped} PV sur 100`);
  D.cyber.overUntil = 0;
  // bouclier frontal
  give('dadou', 'bouclier', 1, 'brasG');
  bossD.hp = bossD.maxHp;
  bossD.yaw = Math.atan2(shooter.x - bossD.x, shooter.z - bossD.z);
  g.action('dadou', { a: 'ab', id: 'bouclier', on: true });
  g.damage(bossD, 60, shooter);
  check('bouclier : les tirs de face sont absorbés', bossD.hp === bossD.maxHp && D.cyber.shield !== null && D.cyber.shield.hp === 80, `PV ${bossD.hp}, bouclier ${D.cyber.shield?.hp}`);
  const behind = dummy(bossD.x - Math.sin(bossD.yaw) * 5, bossD.z - Math.cos(bossD.yaw) * 5);
  behind.weapon = Weapon.PISTOL;
  g.damage(bossD, 40, behind);
  check('bouclier : les tirs dans le dos passent', bossD.hp < bossD.maxHp);
  g.damage(bossD, 200, shooter);
  check('bouclier saturé : brisé, recharge lancée', D.cyber.shield === null && (D.cyber.readyAt.get('bouclier') ?? 0) > g.time);
  shooter.alive = false;
  behind.alive = false;
  shooter.removeAt = behind.removeAt = g.time;
}

// ============================================================================ cœur de secours
console.log('\nCœur de secours');
{
  give('dadou', 'secondSouffle', 1, 'torse2');
  bossD.hp = 30;
  const killer = dummy(bossD.x + 4, bossD.z);
  g.damage(bossD, 500, killer, false, undefined, undefined, undefined, 'explosion');
  check('un coup mortel ne tue pas : relevé avec invulnérabilité', bossD.alive && bossD.hp > 1 && D.cyber.invUntil > g.time, `PV ${bossD.hp}`);
  g.damage(bossD, 500, killer);
  check('invulnérable pendant 2 s', bossD.alive);
  D.cyber.invUntil = 0;
  bossD.hp = 20;
  g.damage(bossD, 500, killer);
  check('recharge : le second coup mortel tue', !bossD.alive);
  killer.alive = false;
  killer.removeAt = g.time;
  g.respawnBoss('dadou', g.hq('dadou'), false);
  steps(2);
  check('réapparition : états temporaires remis à zéro', bossD.alive && D.cyber.shield === null && D.cyber.grapple === null);
}

// ============================================================================ capacités des bras
console.log('\nBras : répulseur, arc électrique, micro-roquettes');
{
  place(bossD, street.x, street.z, Math.atan2(ux, uz));
  steps(2);
  give('dadou', 'repulseur', 1, 'brasG');
  const fwd = { x: Math.sin(bossD.yaw), z: Math.cos(bossD.yaw) };
  const a = dummy(bossD.x + fwd.x * 3, bossD.z + fwd.z * 3);
  const b = dummy(bossD.x - fwd.x * 3, bossD.z - fwd.z * 3);
  // PV relevés juste avant : pendant la mise en place, un homme de Dadou a pu tirer sur les cibles
  const bHp = b.hp;
  const ev = events(() => g.action('dadou', { a: 'ab', id: 'repulseur', d: [fwd.x, 0, fwd.z] }));
  check('répulseur : la cible devant est touchée et projetée', a.hp < a.maxHp && !!a.knock, `PV ${a.hp}`);
  check('répulseur : rien derrière', b.hp === bHp && !ev.all.some((e) => e.t === 'ab' && e.ab === 'repulseur' && e.targets?.includes(b.id)), `PV ${bHp} → ${b.hp}`);
  check('répulseur : effet diffusé', ev.all.some((e) => e.t === 'ab' && e.ab === 'repulseur' && e.targets?.includes(a.id)));
  steps(10);
  give('dadou', 'choc', 2, 'brasG');
  const c1 = dummy(bossD.x + fwd.x * 4, bossD.z + fwd.z * 4);
  const c2 = dummy(bossD.x + fwd.x * 4 + fwd.z * 2.5, bossD.z + fwd.z * 4 - fwd.x * 2.5);
  const c3 = dummy(bossD.x + fwd.x * 4 - fwd.z * 2.5, bossD.z + fwd.z * 4 + fwd.x * 2.5);
  for (const t of [a, b]) {
    t.alive = false;
    t.removeAt = g.time;
  }
  const ev2 = events(() => g.action('dadou', { a: 'ab', id: 'choc', d: [fwd.x, 0, fwd.z], target: c1.id }));
  const hitN = [c1, c2, c3].filter((t) => t.hp < t.maxHp).length;
  check('arc électrique : 3 cibles au niveau 2', hitN === 3, `${hitN} touchées`);
  check('arc électrique : cibles étourdies', [c1, c2, c3].every((t) => (t.stunUntil ?? 0) > g.time));
  check('arc électrique : diffusé avec la chaîne', ev2.all.some((e) => e.t === 'ab' && e.ab === 'choc' && (e.targets?.length ?? 0) === 3));
  give('dadou', 'roquettes', 1, 'brasG');
  const r = dummy(bossD.x + fwd.x * 12, bossD.z + fwd.z * 12, 200);
  g.action('dadou', { a: 'ab', id: 'roquettes', d: [fwd.x, 0, fwd.z], target: r.id });
  check('micro-roquettes : pas d’impact avant la fin du vol', r.hp === r.maxHp);
  steps(20);
  check('micro-roquettes : la salve explose sur la cible', r.hp < r.maxHp - 40, `PV ${r.hp}`);
  for (const t of [c1, c2, c3, r]) {
    t.alive = false;
    t.removeAt = g.time;
  }
}

// ============================================================================ camouflage
console.log('\nCamouflage');
{
  give('dadou', 'camouflage', 1, 'peau');
  const watcher = dummy(bossD.x + 10, bossD.z);
  check('visible avant', !concealed(g, bossD, watcher));
  g.action('dadou', { a: 'ab', id: 'camouflage' });
  check('invisible à plus de 3 m', concealed(g, bossD, watcher) && !g.los(watcher, bossD));
  watcher.x = bossD.x + 2;
  check('repéré au contact', !concealed(g, bossD, watcher));
  check('bit visible CAMOUFLAGE', (g.snapshotFor('even', new Map()).find((s) => s.id === bossD.id)!.fx & CFX.CAMO) !== 0);
  g.playerFire('dadou', { w: Weapon.PISTOL, o: [bossD.x, bossD.y + 1.6, bossD.z], d: [1, 0, 0], hits: [] });
  check('tirer révèle', D.cyber.camoUntil === 0);
  watcher.alive = false;
  watcher.removeAt = g.time;
}

// ============================================================================ chutes
console.log('\nChutes');
{
  bossD.hp = bossD.maxHp;
  for (const s of ['jambes1', 'jambes2', 'jambes3', 'colonne'] as SlotId[]) cyber('dadou', 'unequip', undefined, s);
  place(bossD, street.x, street.z, 0);
  steps(2);
  const fall = (from: number) => {
    const tp = D.tp;
    const y0 = bossD.y;
    g.input('dadou', [bossD.x, y0, bossD.z, 0, 0, 0, 0, Anim.IDLE, 0, Weapon.PISTOL, tp]);
    for (let h = from; h > 0; h -= 2) {
      steps(1);
      g.input('dadou', [bossD.x, y0 + h, bossD.z, 0, 0, 0, 0, Anim.AIR, INPUT_AIR, Weapon.PISTOL, tp]);
    }
    steps(1);
    g.input('dadou', [bossD.x, y0, bossD.z, 0, 0, 0, 0, Anim.LAND, 0, Weapon.PISTOL, tp]);
  };
  fall(5);
  check('chute de 5 m : sans dégâts', bossD.hp === bossD.maxHp);
  fall(14);
  const lost = bossD.maxHp - bossD.hp;
  check('chute de 14 m : dégâts', lost > 30, `−${lost} PV`);
  bossD.hp = bossD.maxHp;
  give('dadou', 'amortisseurs', 2, 'jambes1');
  fall(14);
  check('amortisseurs : chute de 14 m sans dégâts', bossD.hp === bossD.maxHp);
  give('dadou', 'amortisseurs', 4, 'jambes1');
  const q = dummy(bossD.x + 2.5, bossD.z);
  fall(10);
  check('atterrissage sismique : l’ennemi proche est frappé', q.hp < q.maxHp, `PV ${q.hp}`);
  q.alive = false;
  q.removeAt = g.time;
}

// ============================================================================ armes de bras
console.log('\nArmes de bras');
{
  give('dadou', 'pistoletBras', 2, 'brasG');
  const t = dummy(bossD.x + 6, bossD.z, 500);
  g.action('dadou', { a: 'ab', id: 'bras', slot: 'brasG' });
  check('pistolet d’avant-bras sorti', D.cyber.armOut === 'brasG' && D.cyber.armAmmo === 10);
  let shots = 0;
  for (let i = 0; i < 12; i++) {
    bossD.nextFireAt = 0;
    const before = D.cyber.armAmmo;
    g.playerFire('dadou', { w: Weapon.ARM_PISTOL, o: [bossD.x, bossD.y + 1.5, bossD.z], d: [1, 0, 0], hits: [[t.id, t.x, t.y + 1.2, t.z, 0]] });
    if (D.cyber.armAmmo < before) shots++;
  }
  check('chargeur de 10 au niveau 2, munitions recyclées', shots === 10 && t.hp === 500 - 26 * 10, `${shots} tirs, PV ${t.hp}`);
  g.playerReload('dadou');
  bossD.weapon = Weapon.ARM_PISTOL;
  g.playerReload('dadou');
  check('rechargement de l’avant-bras', D.cyber.armAmmo === 10 && D.cyber.armReloadUntil > g.time);
  g.action('dadou', { a: 'ab', id: 'bras', slot: 'brasG' });
  check('rentré', D.cyber.armOut === null);
  // fouet : balayage de plusieurs cibles
  give('dadou', 'fouet', 1, 'brasD');
  const yaw = 0;
  bossD.yaw = yaw;
  const w1 = dummy(bossD.x + 1, bossD.z + 3);
  const w2 = dummy(bossD.x - 1, bossD.z + 3);
  g.action('dadou', { a: 'ab', id: 'bras', slot: 'brasD' });
  bossD.nextFireAt = 0;
  g.playerMelee('dadou', Weapon.ARM_WHIP, w1.id);
  check('fouet : deux ennemis dans l’arc', w1.hp < w1.maxHp && w2.hp < w2.maxHp);
  // poing hydraulique : coup chargé
  give('dadou', 'poing', 2, 'brasD');
  const p1 = dummy(bossD.x, bossD.z + 1.5, 500);
  g.action('dadou', { a: 'ab', id: 'bras', slot: 'brasD' });
  bossD.nextFireAt = 0;
  g.playerMelee('dadou', Weapon.ARM_FIST, p1.id);
  const plain = 500 - p1.hp;
  g.action('dadou', { a: 'ab', id: 'poing-charge', on: true });
  steps(20);
  bossD.nextFireAt = 0;
  const hp0 = p1.hp;
  g.playerMelee('dadou', Weapon.ARM_FIST, p1.id);
  const charged = hp0 - p1.hp;
  check('poing chargé : dégâts doublés', charged >= plain * 1.9, `${plain} → ${charged}`);
  check('poing : la cible est projetée', !!p1.knock);
  for (const e of [t, w1, w2, p1]) {
    e.alive = false;
    e.removeAt = g.time;
  }
}

// ============================================================================ drone de combat
console.log('\nDrone de combat');
{
  give('dadou', 'liaisonDrone', 1, 'neural1');
  const foe = dummy(bossD.x + 8, bossD.z + 2, 300);
  g.action('dadou', { a: 'ab', id: 'liaisonDrone' });
  const drone = g.ents.get(D.cyber.drone);
  check('drone lancé', !!drone && drone.alive);
  steps(20 * 3);
  check('le drone tire sur l’ennemi', foe.hp < foe.maxHp, `PV ${foe.hp}`);
  steps(20 * 20);
  check('le drone repart à la fin', D.cyber.drone === -1);
  foe.alive = false;
  foe.removeAt = g.time;
}

// ============================================================================ égalité des parrains
console.log('\nÉgalité');
{
  place(bossE, street.x + 20, street.z, 0);
  E.money = 1e6;
  for (const id of ['grappin', 'esquive', 'bouclier']) {
    g.action('even', { a: 'cyber', op: 'buy', id });
  }
  check('Even achète et installe comme Dadou', E.cyber.owned.get('grappin') === 1 && E.cyber.equip.brasG === 'grappin' && E.cyber.equip.brasD === 'bouclier');
  check('mêmes prix pour les deux parrains', 1e6 - E.money === 650 + 550 + 1300, `${1e6 - E.money}`);
}

console.log(`\n${passed} réussis, ${failures} échoués`);
if (failures > 0) process.exit(1);
