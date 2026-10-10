// Graphe des chaussées (axes des rues, carrefours, ponts) pour le pilote automatique des
// véhicules du serveur (convois blindés). On roule à droite, au milieu de sa voie.

import { ROADS } from './plan';

export interface RoadNode {
  x: number;
  z: number;
  /** Voisins : index du nœud et longueur. */
  next: { n: number; d: number }[];
}

let cache: RoadNode[] | null = null;

/** Construit (une fois) le graphe : un nœud à chaque carrefour et aux extrémités des rues. */
export function roadGraph(): RoadNode[] {
  if (cache) return cache;
  const nodes: RoadNode[] = [];
  const find = (x: number, z: number): number => {
    for (let i = 0; i < nodes.length; i++) if (Math.abs(nodes[i].x - x) < 1 && Math.abs(nodes[i].z - z) < 1) return i;
    nodes.push({ x, z, next: [] });
    return nodes.length - 1;
  };
  const axes = ROADS.map((r) => ({
    r,
    // ligne médiane
    c: r.axis === 'z' ? (r.rect[0] + r.rect[2]) / 2 : (r.rect[1] + r.rect[3]) / 2,
    a0: r.axis === 'z' ? r.rect[1] : r.rect[0],
    a1: r.axis === 'z' ? r.rect[3] : r.rect[2],
  }));
  const onRoad: number[][] = axes.map(() => []);
  axes.forEach((A, i) => {
    onRoad[i].push(find(A.r.axis === 'z' ? A.c : A.a0, A.r.axis === 'z' ? A.a0 : A.c));
    onRoad[i].push(find(A.r.axis === 'z' ? A.c : A.a1, A.r.axis === 'z' ? A.a1 : A.c));
  });
  // carrefours : une rue est-ouest croise une avenue nord-sud (avec un peu de tolérance aux bouts)
  axes.forEach((A, i) => {
    if (A.r.axis !== 'x') return;
    axes.forEach((B, j) => {
      if (B.r.axis !== 'z') return;
      const x = B.c;
      const z = A.c;
      if (x < A.a0 - 5 || x > A.a1 + 5 || z < B.a0 - 5 || z > B.a1 + 5) return;
      const n = find(x, z);
      onRoad[i].push(n);
      onRoad[j].push(n);
    });
  });
  // arêtes le long de chaque rue
  axes.forEach((A, i) => {
    const list = [...new Set(onRoad[i])].sort((p, q) => (A.r.axis === 'z' ? nodes[p].z - nodes[q].z : nodes[p].x - nodes[q].x));
    for (let k = 1; k < list.length; k++) {
      const a = nodes[list[k - 1]];
      const b = nodes[list[k]];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 0.5) continue;
      a.next.push({ n: list[k], d });
      b.next.push({ n: list[k - 1], d });
    }
  });
  cache = nodes;
  return nodes;
}

export function nearestRoadNode(x: number, z: number): number {
  const g = roadGraph();
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < g.length; i++) {
    const d = Math.hypot(g[i].x - x, g[i].z - z);
    if (d < bd && g[i].next.length > 0) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Itinéraire (points) d'un point à un autre par les rues (Dijkstra). */
export function roadRoute(ax: number, az: number, bx: number, bz: number): { x: number; z: number }[] {
  const g = roadGraph();
  const s = nearestRoadNode(ax, az);
  const t = nearestRoadNode(bx, bz);
  const dist = new Float64Array(g.length).fill(Infinity);
  const prev = new Int32Array(g.length).fill(-1);
  const done = new Uint8Array(g.length);
  dist[s] = 0;
  for (;;) {
    let u = -1;
    let ud = Infinity;
    for (let i = 0; i < g.length; i++) if (!done[i] && dist[i] < ud) {
      ud = dist[i];
      u = i;
    }
    if (u < 0 || u === t) break;
    done[u] = 1;
    for (const e of g[u].next) {
      const nd = dist[u] + e.d;
      if (nd < dist[e.n]) {
        dist[e.n] = nd;
        prev[e.n] = u;
      }
    }
  }
  const out: { x: number; z: number }[] = [];
  for (let n = t; n >= 0; n = prev[n]) out.unshift({ x: g[n].x, z: g[n].z });
  if (out.length === 0 || (out[0].x !== g[s].x && out[0].z !== g[s].z)) return [{ x: ax, z: az }, { x: bx, z: bz }];
  return [{ x: ax, z: az }, ...out, { x: bx, z: bz }];
}

/** Décale un itinéraire vers la droite (voie de droite), de `off` mètres. */
export function rightLane(pts: { x: number; z: number }[], off: number): { x: number; z: number }[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // droite du sens de marche : (−dz, dx) dans ce repère
    return { x: p.x + (-dz / l) * off, z: p.z + (dx / l) * off };
  });
}
