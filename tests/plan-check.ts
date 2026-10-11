// Vérifications géométriques du plan de New York (chevauchements, portes, métro, équilibre).
import {
  AREAS,
  BRIDGES,
  BUILDINGS,
  DISTRICTS,
  DISTRICT_BY_ID,
  FILLERS,
  MID_Z,
  ONE_TIMES_SQUARE,
  RESIDENCES,
  ROADS,
  SUBWAY_LINES,
  SUBWAY_STATIONS,
  SUBWAY_TUNNELS,
  TKTS_STEPS,
  WORLD_D,
  WORLD_W,
  keyBuildings,
  isWater,
  mirrorRect,
  mirrorSide,
  type BuildingDef,
} from '../src/shared/city/plan';
import { stairRect } from '../src/shared/city/gen/infra';

type R = [number, number, number, number];
const overlap = (a: R, b: R, m = 0) => a[0] < b[2] - m && a[2] > b[0] + m && a[1] < b[3] - m && a[3] > b[1] + m;
const same = (a: R, b: R) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

export function planProblems(): string[] {
  const out: string[] = [];
  const solids: { name: string; rect: R }[] = [
    ...BUILDINGS.map((b) => ({ name: b.name, rect: b.rect })),
    ...FILLERS.map((f, i) => ({ name: `décor #${i}`, rect: f.rect })),
    { name: 'One Times Square', rect: ONE_TIMES_SQUARE },
    { name: 'gradins de Times Square', rect: TKTS_STEPS },
  ];
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++)
      if (overlap(solids[i].rect, solids[j].rect)) out.push(`chevauchement : ${solids[i].name} / ${solids[j].name}`);
  for (const s of solids) {
    for (const r of ROADS) if (overlap(s.rect, r.rect)) out.push(`${s.name} empiète sur ${r.name}`);
    const inPlaza = s.name === 'One Times Square' || s.name.startsWith('gradins');
    for (const a of AREAS) if (a.kind !== 'park' && !(inPlaza && a.kind === 'plaza') && overlap(s.rect, a.rect)) out.push(`${s.name} empiète sur ${a.name}`);
    const [x0, z0, x1, z1] = s.rect;
    for (const [x, z] of [
      [(x0 + x1) / 2, (z0 + z1) / 2],
      [x0 + 0.3, z0 + 0.3],
      [x1 - 0.3, z1 - 0.3],
      [x0 + 0.3, z1 - 0.3],
      [x1 - 0.3, z0 + 0.3],
    ])
      if (isWater(x, z)) out.push(`${s.name} est dans l’eau`);
    if (x0 < 0 || z0 < 6 || x1 > WORLD_W - 8 || z1 > WORLD_D - 6) out.push(`${s.name} sort de la ville`);
  }
  // les parcs, lacs et places ne mordent pas sur les chaussées
  for (const a of AREAS) {
    // (Times Square : la place est traversée par la 42e Rue, seuls les trottoirs sont pavés)
    if (a.kind === 'promenade' || a.kind === 'plaza') continue;
    for (const r of ROADS) if (overlap(a.rect, r.rect)) out.push(`${a.name} empiète sur ${r.name}`);
  }
  // porte : 1,5 m devant la porte, ni bâtiment ni eau
  for (const b of BUILDINGS) {
    const [x0, z0, x1, z1] = b.rect;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const p = b.door === 'N' ? [cx, z0 - 1.5] : b.door === 'S' ? [cx, z1 + 1.5] : b.door === 'W' ? [x0 - 1.5, cz] : [x1 + 1.5, cz];
    for (const s of solids) if (s.name !== b.name && p[0] > s.rect[0] && p[0] < s.rect[2] && p[1] > s.rect[1] && p[1] < s.rect[3]) out.push(`la porte de ${b.name} donne sur ${s.name}`);
    if (isWater(p[0], p[1])) out.push(`la porte de ${b.name} donne sur l’eau`);
    // chaque bâtiment est dans son quartier
    const d = DISTRICT_BY_ID[b.district];
    if (!(cx >= d.rect[0] && cx < d.rect[2] && cz >= d.rect[1] && cz < d.rect[3])) out.push(`${b.name} n’est pas dans le quartier ${d.name}`);
  }
  // métro : escaliers dans la rue (ni bâtiment, ni chaussée, ni eau) et qui débouchent dans leur station
  for (const st of SUBWAY_STATIONS) {
    for (const e of st.entrances) {
      const r = stairRect(e.x, e.z, e.dir);
      for (const s of solids) if (overlap(r, s.rect)) out.push(`l’escalier de la station ${st.name} empiète sur ${s.name}`);
      for (const rd of ROADS) if (overlap(r, rd.rect)) out.push(`l’escalier de la station ${st.name} empiète sur ${rd.name}`);
      for (const a of AREAS) if (a.kind !== 'plaza' && a.kind !== 'promenade' && overlap(r, a.rect)) out.push(`l’escalier de la station ${st.name} empiète sur ${a.name}`);
      const end = e.dir === 'S' ? [e.x, r[3] - 0.5] : e.dir === 'N' ? [e.x, r[1] + 0.5] : e.dir === 'E' ? [r[2] - 0.5, e.z] : [r[0] + 0.5, e.z];
      if (!(end[0] > st.rect[0] && end[0] < st.rect[2] && end[1] > st.rect[1] && end[1] < st.rect[3])) out.push(`l’escalier de la station ${st.name} n’arrive pas sur le quai`);
    }
    for (const other of SUBWAY_STATIONS) if (other !== st && overlap(st.rect, other.rect)) out.push(`stations superposées : ${st.name} / ${other.name}`);
    for (const id of st.lines) {
      const line = SUBWAY_LINES.find((l) => l.id === id);
      if (!line || !line.stations.includes(st.key)) out.push(`la station ${st.name} n’est pas sur la ligne ${id}`);
      const t = SUBWAY_TUNNELS.find((k) => k.line === id);
      const through = t?.pts.some((p, i) => {
        const q = t.pts[i + 1];
        if (!q) return false;
        const seg: R = [Math.min(p[0], q[0]) - 2, Math.min(p[1], q[1]) - 2, Math.max(p[0], q[0]) + 2, Math.max(p[1], q[1]) + 2];
        return overlap(seg, st.rect);
      });
      if (!through) out.push(`le tunnel de la ligne ${id} ne passe pas par la station ${st.name}`);
    }
  }
  for (const l of SUBWAY_LINES) for (const k of l.stations) if (!SUBWAY_STATIONS.some((s) => s.key === k)) out.push(`station inconnue : ${k}`);
  // ponts : chaque pont porte une chaussée
  for (const br of BRIDGES) if (!ROADS.some((r) => r.name === br.name && overlap(r.rect, br.rect))) out.push(`le ${br.name} n’a pas de chaussée`);
  // équilibre nord / sud (Midtown exclu)
  const side = (b: BuildingDef) => (b.district === 'midtown' ? null : (b.rect[1] + b.rect[3]) / 2 < MID_Z ? 'nord' : 'sud');
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
  // symétrie stricte : chaque bâtiment a son jumeau en miroir, avec les mêmes règles
  for (const b of BUILDINGS) {
    const m = mirrorRect(b.rect);
    const twin = BUILDINGS.find((o) => same(o.rect as R, m));
    if (!twin) {
      if (b.type !== 'landmark') out.push(`${b.name} n’a pas de jumeau en miroir`);
      continue;
    }
    if (twin === b) continue;
    if (twin.door !== mirrorSide(b.door)) out.push(`${b.name} / ${twin.name} : portes non symétriques`);
    for (const k of ['income', 'guards', 'price', 'capturable'] as const) if (b[k] !== twin[k]) out.push(`${b.name} / ${twin.name} : ${k} différent`);
    if (!b.residence && b.startOwner !== twin.startOwner) out.push(`${b.name} / ${twin.name} : propriétaire de départ différent`);
    if (b.residence?.tier !== twin.residence?.tier || (b.residence && b.residence.boss === twin.residence!.boss)) out.push(`${b.name} / ${twin.name} : logements non jumeaux`);
    if (!!b.isKey !== !!twin.isKey) out.push(`${b.name} / ${twin.name} : bâtiment clé d’un seul côté`);
    if ((b.security ?? 0) !== (twin.security ?? 0)) out.push(`${b.name} / ${twin.name} : sécurité différente`);
    if ((b.heist?.reward ?? 0) !== (twin.heist?.reward ?? 0) || (b.heist?.time ?? 0) !== (twin.heist?.time ?? 0)) out.push(`${b.name} / ${twin.name} : braquage différent`);
  }
  // l'échelle des logements : les deux parrains ont des logements en miroir
  for (let i = 0; i < 5; i++) {
    const d = RESIDENCES.dadou[i];
    const e = RESIDENCES.even[i];
    if (!d || !e) out.push(`palier ${i + 1} manquant`);
    else if (!same(d.rect, mirrorRect(e.rect))) out.push(`palier ${i + 1} : ${d.name} et ${e.name} ne sont pas en miroir`);
    else if (d.price !== e.price || d.income !== e.income) out.push(`palier ${i + 1} : prix ou revenus différents`);
  }
  for (const d of DISTRICTS) {
    const k = keyBuildings(d.id).length;
    if (k < 2 || k > 3) out.push(`${d.name} a ${k} bâtiment(s) clé(s) (2 ou 3 attendus)`);
  }
  for (const a of DISTRICTS)
    for (const b of DISTRICTS) if (a !== b && overlap(a.rect, b.rect)) out.push(`quartiers superposés : ${a.name} / ${b.name}`);
  return out;
}

if (process.argv[1]?.endsWith('plan-check.ts')) {
  const p = planProblems();
  console.log(p.length ? p.join('\n') : 'plan OK');
  let mt = 0;
  for (const b of BUILDINGS) if (b.district === 'midtown') mt += b.income;
  const cap = BUILDINGS.filter((b) => b.capturable && !b.residence);
  const guards = BUILDINGS.reduce((s, b) => s + (b.startOwner === 0 ? b.guards : 0), 0);
  console.log(`Midtown : ${mt} $/min, ${keyBuildings('midtown').length} bâtiments clés`);
  console.log(
    `${BUILDINGS.length} bâtiments (${cap.length} capturables hors logements, ${BUILDINGS.filter((b) => b.isKey).length} clés, ${guards} voyous au départ) + ${FILLERS.length} immeubles de décor = ${BUILDINGS.length + FILLERS.length}`,
  );
  for (const d of DISTRICTS) {
    const list = BUILDINGS.filter((b) => b.district === d.id);
    console.log(`  ${d.name.padEnd(18)} ${String(list.length).padStart(2)} bâtiments, ${keyBuildings(d.id).length} clés, ${list.reduce((s, b) => s + b.income, 0)} $/min`);
  }
}
