// Petites fonctions utilitaires partagées entre client et serveur.

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Différence angulaire signée la plus courte de a vers b (radians). */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    // entier dans [a, b]
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  fork(salt: number): Rng {
    return new Rng(hash32(Math.floor(this.next() * 4294967296) ^ salt));
  }
}

export function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function hash3(x: number, y: number, z: number): number {
  return hash32(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791));
}

/** Formate un montant en livres à la française : « 1 250 £ ». */
export function formatMoney(n: number): string {
  const v = Math.round(n);
  const s = Math.abs(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 ? '−' : ''}${s} £`;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
