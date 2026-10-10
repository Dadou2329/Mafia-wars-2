// Vérifications géométriques du plan de New York (chevauchements, portes, équilibre).
import { AREAS, BUILDINGS, DISTRICTS, FILLERS, ROADS, keyBuildings, isWater, type BuildingDef } from '../src/shared/city/plan';

type R = [number, number, number, number];
const overlap = (a: R, b: R, m = 0) => a[0] < b[2] - m && a[2] > b[0] + m && a[1] < b[3] - m && a[3] > b[1] + m;
export function planProblems(): string[] {
  const out: string[] = [];
  const solids: { name: string; rect: R }[] = [
    ...BUILDINGS.map((b) => ({ name: b.name, rect: b.rect })),
    ...FILLERS.map((f, i) => ({ name: `décor #${i}`, rect: f.rect })),
  ];
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++)
      if (overlap(solids[i].rect, solids[j].rect)) out.push(`chevauchement : ${solids[i].name} / ${solids[j].name}`);
  for (const s of solids) {
    for (const r of ROADS) if (overlap(s.rect, r.rect)) out.push(`${s.name} empiète sur ${r.name}`);
    for (const a of AREAS) if (a.kind !== 'park' && overlap(s.rect, a.rect)) out.push(`${s.name} empiète sur ${a.name}`);
    const cx = (s.rect[0] + s.rect[2]) / 2;
    const cz = (s.rect[1] + s.rect[3]) / 2;
    if (isWater(cx, cz)) out.push(`${s.name} est dans l’eau`);
  }
  // les bâtiments du parc doivent être dans le parc ; les autres hors du parc
  // porte : 1,5 m devant la porte, ni bâtiment ni eau
  for (const b of BUILDINGS) {
    const [x0, z0, x1, z1] = b.rect;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const p = b.door === 'N' ? [cx, z0 - 1.5] : b.door === 'S' ? [cx, z1 + 1.5] : b.door === 'W' ? [x0 - 1.5, cz] : [x1 + 1.5, cz];
    for (const s of solids) if (s.name !== b.name && p[0] > s.rect[0] && p[0] < s.rect[2] && p[1] > s.rect[1] && p[1] < s.rect[3]) out.push(`la porte de ${b.name} donne sur ${s.name}`);
    if (isWater(p[0], p[1])) out.push(`la porte de ${b.name} donne sur l’eau`);
  }
  // équilibre nord / sud (Midtown exclu)
  const side = (b: BuildingDef) => (b.district === 'midtown' ? null : (b.rect[1] + b.rect[3]) / 2 < 120 ? 'nord' : 'sud');
  const sum = { nord: 0, sud: 0 };
  const keys = { nord: 0, sud: 0 };
  for (const b of BUILDINGS) {
    const s = side(b);
    if (!s) continue;
    sum[s] += b.income;
    if (b.isKey) keys[s]++;
  }
  if (sum.nord !== sum.sud) out.push(`revenus déséquilibrés : nord ${sum.nord} $/min, sud ${sum.sud} $/min`);
  if (keys.nord !== keys.sud) out.push(`bâtiments clés déséquilibrés : nord ${keys.nord}, sud ${keys.sud}`);
  for (const d of DISTRICTS) if (keyBuildings(d.id).length === 0) out.push(`${d.name} n’a aucun bâtiment clé`);
  return out;
}

if (process.argv[1]?.endsWith('plan-check.ts')) {
  const p = planProblems();
  console.log(p.length ? p.join('\n') : 'plan OK');
  let mt = 0;
  for (const b of BUILDINGS) if (b.district === 'midtown') mt += b.income;
  console.log(`Midtown : ${mt} $/min, ${keyBuildings('midtown').length} bâtiments clés ; ${BUILDINGS.length} bâtiments`);
}
