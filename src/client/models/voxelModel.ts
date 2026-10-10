// Petit langage de modélisation voxel pour les accessoires et les personnages.
// Un modèle est une grille dense de cases colorées. Les couleurs sont des index dans une
// palette sRGB propre au modèle, ou des « emplacements » spéciaux (teinte de faction,
// émission, vitre) que le shader interprète.

/** Emplacements spéciaux (valeurs de couleur ≥ 0xF00000 interprétées par le shader). */
export const SLOT = {
  TINT1: 0xf00001, // couleur principale de la faction propriétaire
  TINT2: 0xf00002, // couleur secondaire (or / argent)
  TINT3: 0xf00003, // couleur sombre de la faction
  GLOW: 0xf00004, // flamme / verre de lampe (émissif chaud)
  FIRE: 0xf00005, // feu vif
  GLASS: 0xf00006, // vitre sombre réfléchissante
  SKIN: 0xf00010, // personnages : peau
  HAIR: 0xf00011,
  COAT: 0xf00012,
  COAT2: 0xf00013, // revers, doublure
  VEST: 0xf00014, // gilet
  SHIRT: 0xf00015,
  TIE: 0xf00016,
  PANTS: 0xf00017,
  SHOES: 0xf00018,
  HAT: 0xf00019,
  HATBAND: 0xf0001a,
  ACCENT: 0xf0001b, // boutons, chaîne de montre…
  EYES: 0xf0001c,
  BEARD: 0xf0001d,
  ARMBAND: 0xf0001e, // brassard de faction
  DRESS: 0xf0001f,
} as const;

export const SLOT_INDEX: Record<number, number> = {
  [SLOT.TINT1]: 1,
  [SLOT.TINT2]: 2,
  [SLOT.TINT3]: 3,
  [SLOT.GLOW]: 4,
  [SLOT.FIRE]: 5,
  [SLOT.GLASS]: 6,
  [SLOT.SKIN]: 16,
  [SLOT.HAIR]: 17,
  [SLOT.COAT]: 18,
  [SLOT.COAT2]: 19,
  [SLOT.VEST]: 20,
  [SLOT.SHIRT]: 21,
  [SLOT.TIE]: 22,
  [SLOT.PANTS]: 23,
  [SLOT.SHOES]: 24,
  [SLOT.HAT]: 25,
  [SLOT.HATBAND]: 26,
  [SLOT.ACCENT]: 27,
  [SLOT.EYES]: 28,
  [SLOT.BEARD]: 29,
  [SLOT.ARMBAND]: 30,
  [SLOT.DRESS]: 31,
};

export class VoxelModel {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  /** Taille d'un voxel en mètres. */
  readonly res: number;
  /** Couleur sRGB par case (0 = vide). On stocke couleur+1 pour distinguer le noir. */
  readonly data: Uint32Array;
  /** Origine du modèle en voxels (le point (0,0,0) local du modèle). */
  ox: number;
  oy: number;
  oz: number;

  constructor(sx: number, sy: number, sz: number, res = 1 / 16) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.res = res;
    this.data = new Uint32Array(sx * sy * sz);
    // par défaut : origine au centre de la base
    this.ox = sx / 2;
    this.oy = 0;
    this.oz = sz / 2;
  }

  /** Modèle dimensionné en mètres (arrondi aux voxels). */
  static meters(w: number, h: number, d: number, res = 1 / 16): VoxelModel {
    return new VoxelModel(Math.max(1, Math.round(w / res)), Math.max(1, Math.round(h / res)), Math.max(1, Math.round(d / res)), res);
  }

  idx(x: number, y: number, z: number): number {
    return (y * this.sz + z) * this.sx + x;
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  set(x: number, y: number, z: number, color: number): this {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (this.inside(x, y, z)) this.data[this.idx(x, y, z)] = color < 0 ? 0 : color + 1;
    return this;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return -1;
    return this.data[this.idx(x, y, z)] - 1;
  }

  clear(x: number, y: number, z: number): this {
    if (this.inside(x, y, z)) this.data[this.idx(x, y, z)] = 0;
    return this;
  }

  /** Boîte [x0,x1)×[y0,y1)×[z0,z1). Couleur -1 = creuser. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): this {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.sy, Math.ceil(y1)); y++)
      for (let z = Math.max(0, Math.floor(z0)); z < Math.min(this.sz, Math.ceil(z1)); z++)
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.sx, Math.ceil(x1)); x++)
          this.data[this.idx(x, y, z)] = color < 0 ? 0 : color + 1;
    return this;
  }

  /** Boîte creuse (parois d'épaisseur t). */
  shell(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, t = 1): this {
    this.box(x0, y0, z0, x1, y1, z1, color);
    this.box(x0 + t, y0 + t, z0 + t, x1 - t, y1 - t, z1 - t, -1);
    return this;
  }

  /** Cylindre d'axe Y centré en (cx, cz), rayon r, de y0 à y1. */
  cylY(cx: number, cz: number, r: number, y0: number, y1: number, color: number): this {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++)
      for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r); z++)
        if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 <= r * r) this.box(x, y0, z, x + 1, y1, z + 1, color);
    return this;
  }

  /** Cylindre d'axe X. */
  cylX(cy: number, cz: number, r: number, x0: number, x1: number, color: number): this {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++)
      for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r); z++)
        if ((y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2 <= r * r) this.box(x0, y, z, x1, y + 1, z + 1, color);
    return this;
  }

  /** Cylindre d'axe Z. */
  cylZ(cx: number, cy: number, r: number, z0: number, z1: number, color: number): this {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++)
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.box(x, y, z0, x + 1, y + 1, z1, color);
    return this;
  }

  /** Cône/tronc de cône d'axe Y (rayon r0 en y0, r1 en y1). */
  coneY(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, color: number): this {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const t = (y + 0.5 - y0) / Math.max(1e-6, y1 - y0);
      const r = r0 + (r1 - r0) * t;
      this.cylY(cx, cz, r, y, y + 1, color);
    }
    return this;
  }

  /** Ellipsoïde. */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: number): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          const dz = (z + 0.5 - cz) / rz;
          if (dx * dx + dy * dy + dz * dz <= 1) this.set(x, y, z, color);
        }
    return this;
  }

  sphere(cx: number, cy: number, cz: number, r: number, color: number): this {
    return this.ellipsoid(cx, cy, cz, r, r, r, color);
  }

  /** Ligne de voxels (Bresenham 3D approché) avec épaisseur optionnelle. */
  line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, thick = 0): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const z = z0 + (z1 - z0) * t;
      if (thick <= 0) this.set(x, y, z, color);
      else this.box(x - thick, y - thick, z - thick, x + thick + 1, y + thick + 1, z + thick + 1, color);
    }
    return this;
  }

  /** Remplace une couleur par une autre. */
  recolor(from: number, to: number): this {
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === from + 1) this.data[i] = to + 1;
    return this;
  }

  /** Symétrie gauche/droite : copie la moitié x < sx/2 sur l'autre moitié. */
  mirrorX(): this {
    for (let y = 0; y < this.sy; y++)
      for (let z = 0; z < this.sz; z++)
        for (let x = 0; x < Math.floor(this.sx / 2); x++) {
          const v = this.data[this.idx(x, y, z)];
          this.data[this.idx(this.sx - 1 - x, y, z)] = v;
        }
    return this;
  }

  /** Applique une fonction à chaque case pleine (bruit de couleur, etc.). */
  forEach(fn: (x: number, y: number, z: number, color: number) => number | void): this {
    for (let y = 0; y < this.sy; y++)
      for (let z = 0; z < this.sz; z++)
        for (let x = 0; x < this.sx; x++) {
          const i = this.idx(x, y, z);
          if (this.data[i] === 0) continue;
          const r = fn(x, y, z, this.data[i] - 1);
          if (typeof r === 'number') this.data[i] = r < 0 ? 0 : r + 1;
        }
    return this;
  }

  setOrigin(ox: number, oy: number, oz: number): this {
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    return this;
  }

  /** Colle un autre modèle (même résolution) à la position donnée. */
  paste(m: VoxelModel, px: number, py: number, pz: number): this {
    for (let y = 0; y < m.sy; y++)
      for (let z = 0; z < m.sz; z++)
        for (let x = 0; x < m.sx; x++) {
          const v = m.data[m.idx(x, y, z)];
          if (v !== 0) {
            const tx = px + x;
            const ty = py + y;
            const tz = pz + z;
            if (this.inside(tx, ty, tz)) this.data[this.idx(tx, ty, tz)] = v;
          }
        }
    return this;
  }
}

/** Variante de couleur : assombrit/éclaircit une couleur sRGB. */
export function shade(color: number, f: number): number {
  if (color >= 0xf00000) return color;
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/** Mélange deux couleurs sRGB. */
export function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Bruit de couleur déterministe par voxel (donne un aspect « peint à la main »). */
export function jitter(m: VoxelModel, amount = 0.08, seed = 1): VoxelModel {
  return m.forEach((x, y, z, c) => {
    if (c >= 0xf00000) return;
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1013904223) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const f = 1 + (((h & 1023) / 1023) * 2 - 1) * amount;
    return shade(c, f);
  });
}
