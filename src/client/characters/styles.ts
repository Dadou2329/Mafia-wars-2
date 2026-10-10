// Silhouettes et tenues des personnages. La forme dépend du type (CharStyle), les
// couleurs d'une ligne de palette (Outfit) propre à chaque personnage.

import { CharKind } from '../../shared/characters';
import { Rng } from '../../shared/util';
import type { ArmStyle, HatStyle, HeadStyle, TailStyle, TorsoStyle } from './parts';

export interface CharStyle {
  torso: TorsoStyle;
  head: HeadStyle;
  hat: HatStyle;
  tail: TailStyle;
  arm: ArmStyle;
  armband: boolean;
  skirt: boolean;
  /** Échelle (corpulence/taille). */
  scale: number;
}

export interface Outfit {
  skin: number;
  hair: number;
  coat: number;
  coat2: number;
  vest: number;
  shirt: number;
  tie: number;
  pants: number;
  shoes: number;
  hat: number;
  hatband: number;
  accent: number;
  eyes: number;
  beard: number;
  armband: number;
  dress: number;
  /** Couleurs métalliques (reflet) : bitmask sur les emplacements. */
  metal?: number;
}

/** Ordre des emplacements dans la ligne de palette (= SLOT_INDEX - 16). */
export const OUTFIT_ORDER: (keyof Outfit)[] = [
  'skin',
  'hair',
  'coat',
  'coat2',
  'vest',
  'shirt',
  'tie',
  'pants',
  'shoes',
  'hat',
  'hatband',
  'accent',
  'eyes',
  'beard',
  'armband',
  'dress',
];

export interface Appearance {
  style: CharStyle;
  outfit: Outfit;
}

/** Personnalisation des parrains (couleurs secondaires et chapeau). */
export interface BossCustom {
  coat?: number;
  vest?: number;
  tie?: number;
  hat?: HatStyle;
  hatband?: number;
  accent?: number;
}

const SKINS = [0xf0cfae, 0xe8c2a0, 0xdcae88, 0xc8946a, 0xa87250, 0x8a5a3c, 0xf2d5bd];
const HAIRS = [0x1c1410, 0x2a1d16, 0x4a3020, 0x6b4a2e, 0x8a6a3e, 0xa83e1e, 0x6a6460, 0xb8b0a4];

export const DADOU_DEFAULT: Outfit = {
  skin: 0xe0b896,
  hair: 0x221812,
  coat: 0x161418,
  coat2: 0x8e1b22,
  vest: 0x5a1218,
  shirt: 0xece6da,
  tie: 0xa31e26,
  pants: 0x1c1a1e,
  shoes: 0x0f0e0e,
  hat: 0x141316,
  hatband: 0x8e1b22,
  accent: 0xd4a640,
  eyes: 0x24160e,
  beard: 0x221812,
  armband: 0x9e1b22,
  dress: 0x000000,
  metal: 1 << 11,
};

export const EVEN_DEFAULT: Outfit = {
  skin: 0xecc6a4,
  hair: 0x6b4a2e,
  coat: 0x1d3461,
  coat2: 0x2c4a80,
  vest: 0x8a8f98,
  shirt: 0xf2eee6,
  tie: 0xc9d1dc,
  pants: 0x34363e,
  shoes: 0x0f0e0e,
  hat: 0x111216,
  hatband: 0x1d3461,
  accent: 0xc9d1dc,
  eyes: 0x34506e,
  beard: 0x6b4a2e,
  armband: 0x2a4a8a,
  dress: 0x000000,
  metal: 1 << 11,
};

export const DADOU_STYLE: CharStyle = { torso: 'longcoat', head: 'dadou', hat: 'bowler', tail: 'longcoat', arm: 'coat', armband: false, skirt: false, scale: 1.0 };
export const EVEN_STYLE: CharStyle = { torso: 'frock', head: 'even', hat: 'top', tail: 'frock', arm: 'coat', armband: false, skirt: false, scale: 1.02 };

const GANG_COLORS = [0x3a2a4a, 0xd8d4c8, 0x5a4630, 0x2a4030, 0x4a4a48, 0x2a5552];

export function appearanceFor(kind: CharKind, faction: number, look: number, gang = 0, custom?: BossCustom): Appearance {
  const r = new Rng(look * 2654435761 + kind * 97 + 13);
  const skin = r.pick(SKINS);
  const hair = r.pick(HAIRS.slice(0, 6));
  switch (kind) {
    case CharKind.BOSS_DADOU: {
      const o: Outfit = { ...DADOU_DEFAULT };
      if (custom) applyCustom(o, custom);
      return { style: { ...DADOU_STYLE, hat: custom?.hat ?? 'bowler' }, outfit: o };
    }
    case CharKind.BOSS_EVEN: {
      const o: Outfit = { ...EVEN_DEFAULT };
      if (custom) applyCustom(o, custom);
      return { style: { ...EVEN_STYLE, hat: custom?.hat ?? 'top' }, outfit: o };
    }
    case CharKind.GANGSTER:
    case CharKind.LIEUTENANT: {
      const dadou = faction === 1;
      const lt = kind === CharKind.LIEUTENANT;
      const heads: HeadStyle[] = ['mustache', 'stubble', 'clean', 'beard', 'sideburns'];
      const o: Outfit = {
        skin,
        hair,
        coat: dadou ? r.pick([0x1c1a1c, 0x262022, 0x2e2624]) : r.pick([0x1d2f52, 0x22365e, 0x1a2a48]),
        coat2: dadou ? 0x6e1820 : 0x34508a,
        vest: dadou ? r.pick([0x6e1820, 0x5a1218, 0x7a2028]) : r.pick([0x6c7380, 0x7a808a, 0x5a6270]),
        shirt: r.pick([0xe8e2d4, 0xd8ccb0, 0xc8c0b0]),
        tie: dadou ? 0xa31e26 : r.pick([0xc9d1dc, 0x2a4a8a]),
        pants: r.pick([0x2a2826, 0x3a342e, 0x24242a]),
        shoes: 0x14110f,
        hat: dadou ? r.pick([0x1e1c1c, 0x2a2420, 0x3a2e28]) : r.pick([0x1d2f52, 0x34363e, 0x2a2e38]),
        hatband: dadou ? 0x8e1b22 : 0x1d3461,
        accent: dadou ? 0xd4a640 : 0xc9d1dc,
        eyes: 0x2a1a12,
        beard: hair,
        armband: dadou ? 0xb3202a : 0x3a64b8,
        dress: 0,
        metal: 1 << 11,
      };
      const style: CharStyle = lt
        ? { torso: 'longcoat', head: r.pick(heads), hat: 'bowler', tail: 'longcoat', arm: 'coat', armband: true, skirt: false, scale: 1.0 }
        : {
            torso: r.chance(0.6) ? 'jacket' : 'vest',
            head: r.pick(heads),
            hat: r.chance(0.55) ? 'flatcap' : 'bowler',
            tail: 'none',
            arm: 'coat',
            armband: true,
            skirt: false,
            scale: r.range(0.95, 1.04),
          };
      if (style.torso === 'vest') style.arm = 'shirt';
      return { style, outfit: o };
    }
    case CharKind.THUG: {
      const gc = GANG_COLORS[gang % GANG_COLORS.length];
      const o: Outfit = {
        skin,
        hair,
        coat: r.pick([0x4a3e30, 0x3a3a34, 0x4a4036]),
        coat2: gc,
        vest: r.pick([0x5a4a38, 0x4a4a40, 0x3e3428, gc]),
        shirt: r.pick([0xc8bca4, 0xb8b0a0, 0xd8ccb0]),
        tie: gc,
        pants: r.pick([0x3e362e, 0x4a4238, 0x2e2a26]),
        shoes: 0x1a1612,
        hat: r.pick([0x4a4036, 0x3a342e, 0x2a2622]),
        hatband: gc,
        accent: 0x8a7a5a,
        eyes: 0x2a1a12,
        beard: hair,
        armband: gc,
        dress: 0,
      };
      return {
        style: { torso: 'vest', head: r.pick(['stubble', 'beard', 'mustache', 'clean'] as HeadStyle[]), hat: 'flatcap', tail: 'none', arm: 'shirt', armband: false, skirt: false, scale: r.range(0.97, 1.06) },
        outfit: o,
      };
    }
    case CharKind.POLICE: {
      const o: Outfit = {
        skin,
        hair,
        coat: 0x161c30,
        coat2: 0x161c30,
        vest: 0x161c30,
        shirt: 0xe8e2d4,
        tie: 0x161c30,
        pants: 0x161c30,
        shoes: 0x0c0b0b,
        hat: 0x141a2c,
        hatband: 0x141a2c,
        accent: 0xc0c6cc,
        eyes: 0x2a1a12,
        beard: hair,
        armband: 0x161c30,
        dress: 0,
        metal: 1 << 11,
      };
      return { style: { torso: 'tunic', head: r.chance(0.6) ? 'mustache' : 'sideburns', hat: 'police', tail: 'tunic', arm: 'coat', armband: false, skirt: false, scale: 1.03 }, outfit: o };
    }
    case CharKind.BARMAN: {
      const o: Outfit = {
        skin,
        hair,
        coat: 0x3a2a20,
        coat2: 0xe8e2d4,
        vest: 0x2a2420,
        shirt: 0xece6da,
        tie: 0x1a1a1a,
        pants: 0x2a2826,
        shoes: 0x14110f,
        hat: 0x2a2622,
        hatband: 0x2a2622,
        accent: 0xb08d3c,
        eyes: 0x2a1a12,
        beard: hair,
        armband: 0,
        dress: 0,
      };
      return { style: { torso: 'apron', head: 'mustache', hat: 'none', tail: 'none', arm: 'shirt', armband: false, skirt: false, scale: 1.05 }, outfit: o };
    }
    case CharKind.CIVILIAN_F: {
      const dresses = [0x5a1e2a, 0x2a4a3a, 0x3a2a4a, 0x22305a, 0x4a3a2a, 0x6a5a4a, 0x7a3a30];
      const dress = r.pick(dresses);
      const o: Outfit = {
        skin,
        hair: r.pick(HAIRS),
        coat: dress,
        coat2: r.pick([0x8a7a6a, 0xd8ccb0, 0x3a3030, 0x6a5a5a]),
        vest: dress,
        shirt: 0xe8e2d4,
        tie: dress,
        pants: dress,
        shoes: 0x1a1612,
        hat: r.pick([0x3a2a24, 0xd8ccb0, 0x2a2a30, dress]),
        hatband: r.pick([0x8a2a2a, 0x2a4a6a, 0xd4a640, 0xe8e2d4]),
        accent: r.pick([0xd8ccb0, 0x8a6a4a, 0x2a2420]),
        eyes: 0x2a2a30,
        beard: 0,
        armband: 0,
        dress,
      };
      return {
        style: { torso: 'bodice', head: 'woman', hat: r.chance(0.7) ? 'bonnet' : 'hairbun', tail: 'none', arm: 'coat', armband: false, skirt: true, scale: r.range(0.92, 0.98) },
        outfit: o,
      };
    }
    case CharKind.CIVILIAN:
    default: {
      const gentleman = r.chance(0.35);
      const o: Outfit = {
        skin,
        hair: r.pick(HAIRS),
        coat: gentleman ? r.pick([0x2a2622, 0x3a3430, 0x2a3040, 0x403028]) : r.pick([0x5a4a3a, 0x4a4a42, 0x3e3a34, 0x5e5040]),
        coat2: r.pick([0x3a3430, 0x5a4a3a]),
        vest: r.pick([0x5a4a38, 0x4a4040, 0x6a5a40, 0x3a3a40]),
        shirt: r.pick([0xe8e2d4, 0xd8ccb0, 0xc8c0b0]),
        tie: r.pick([0x5a2a2a, 0x2a3a5a, 0x3a3a2a, 0x2a2a2a]),
        pants: r.pick([0x3e362e, 0x4a4238, 0x2e2a26, 0x4a4a4a]),
        shoes: 0x1a1612,
        hat: r.pick([0x2a2622, 0x4a4036, 0x3a342e]),
        hatband: 0x1a1a1a,
        accent: 0x8a7a5a,
        eyes: 0x2a1a12,
        beard: 0,
        armband: 0,
        dress: 0,
      };
      o.beard = o.hair;
      const style: CharStyle = gentleman
        ? { torso: 'frock', head: r.pick(['mustache', 'sideburns', 'old', 'beard'] as HeadStyle[]), hat: r.chance(0.5) ? 'top' : 'bowler', tail: 'frock', arm: 'coat', armband: false, skirt: false, scale: r.range(0.96, 1.03) }
        : { torso: r.chance(0.5) ? 'vest' : 'jacket', head: r.pick(['stubble', 'clean', 'mustache', 'beard', 'old'] as HeadStyle[]), hat: 'flatcap', tail: 'none', arm: 'shirt', armband: false, skirt: false, scale: r.range(0.94, 1.03) };
      if (style.torso === 'jacket') style.arm = 'coat';
      return { style, outfit: o };
    }
  }
}

function applyCustom(o: Outfit, c: BossCustom): void {
  if (c.coat !== undefined) o.coat = c.coat;
  if (c.vest !== undefined) o.vest = c.vest;
  if (c.tie !== undefined) o.tie = c.tie;
  if (c.hatband !== undefined) o.hatband = c.hatband;
  if (c.accent !== undefined) o.accent = c.accent;
}

/** Clé unique de silhouette (pour regrouper les instances par géométrie). */
export function styleParts(s: CharStyle): string[] {
  const parts = [
    `torso:${s.torso}`,
    `pelvis:${s.torso}`,
    `head:${s.head}`,
    `upperArm:${s.armband ? 'band' : s.arm}`,
    `forearm:${s.arm}`,
    'thigh',
    'shin',
  ];
  if (s.hat !== 'none') parts.push(`hat:${s.hat}`);
  if (s.tail !== 'none') parts.push(`tailL:${s.tail}`, `tailR:${s.tail}`);
  if (s.skirt) parts.push('skirt');
  return parts;
}
