// Silhouettes et tenues des personnages (New York, 2085). La forme dépend du style (CharStyle :
// morphologie, coupe des vêtements, coiffure, chapeau, accessoires), les couleurs d'une ligne de
// palette (Outfit) propre à chaque personnage, complétée de nuances dérivées (ombres et reflets
// de la peau, des cheveux, des étoffes), et les liserés lumineux d'une couleur de néon par
// personnage (index dans NEON_COLORS).

import { CharKind } from '../../shared/characters';
import { Rng } from '../../shared/util';
import {
  headKey,
  pelvisOf,
  type FaceGear,
  type FaceShape,
  type FootStyle,
  type HairStyle,
  type HandPose,
  type HandWear,
  type HatStyle,
  type HeadDef,
  type LegStyle,
  type SkirtStyle,
  type SleeveStyle,
  type TailStyle,
  type TorsoStyle,
  type BeardStyle,
} from './parts';
import type { Build } from './rig';

export type { HatStyle } from './parts';

/** Attitude au repos. */
export type IdleKind = 'relaxed' | 'pockets' | 'crossed' | 'behind' | 'hip' | 'phone' | 'belt';

export interface CharStyle {
  build: Build;
  torso: TorsoStyle;
  sleeve: SleeveStyle;
  /** Brassard lumineux de faction (bras gauche). */
  armband: boolean;
  legs: LegStyle;
  feet: FootStyle;
  head: HeadDef;
  hair: HairStyle;
  hat: HatStyle;
  face: FaceGear;
  hands: HandWear;
  tail: TailStyle | 'none';
  skirt: SkirtStyle | 'none';
  /** Échelle (taille) : la hauteur reste entre 1,70 et 1,88 m. */
  scale: number;
  idle: IdleKind;
  /** Visée au pistolet à une main (style flamboyant). */
  oneHand: boolean;
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
  /** Robe ou jupe ; équipement (gants, sangles, masque) pour les tenues techniques. */
  dress: number;
  /** Couleurs métalliques (reflet marqué) : bitmask sur les emplacements. */
  metal?: number;
  /** Couleurs lustrées (cuir, soie) : bitmask sur les emplacements. */
  sheen?: number;
  /** Rouge à lèvres, fard à paupières (sinon dérivés de la peau). */
  lip?: number;
  makeup?: number;
}

/** Ordre des emplacements dans la ligne de palette (= SLOT_INDEX - 16). */
export const OUTFIT_ORDER: (keyof Outfit)[] = ['skin', 'hair', 'coat', 'coat2', 'vest', 'shirt', 'tie', 'pants', 'shoes', 'hat', 'hatband', 'accent', 'eyes', 'beard', 'armband', 'dress'];

/** Bits de `Outfit.metal` / `Outfit.sheen`. */
const MB = { coat: 1 << 2, coat2: 1 << 3, vest: 1 << 4, pants: 1 << 7, shoes: 1 << 8, hat: 1 << 9, hatband: 1 << 10, accent: 1 << 11, dress: 1 << 15 } as const;

/** Index des couleurs de néon (NEON_COLORS) : rose, cyan, rouge, bleu, vert, ambre, violet, orange. */
export const NEON = { PINK: 0, CYAN: 1, RED: 2, BLUE: 3, GREEN: 4, AMBER: 5, PURPLE: 6, ORANGE: 7 } as const;

export interface Appearance {
  style: CharStyle;
  outfit: Outfit;
  /** Couleur des liserés lumineux (index dans NEON_COLORS). */
  neon: number;
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

/** Chapeaux proposés aux parrains (les seuls acceptés par le serveur). */
export const BOSS_HATS: HatStyle[] = ['bowler', 'top', 'fedora', 'flatcap'];

// ------------------------------------------------------------------ couleurs

const SKINS = [0xf3d9c4, 0xf0cfae, 0xe8c2a0, 0xdcae88, 0xcf9e76, 0xb98058, 0x9a6644, 0x7c4f34, 0x5f3b26, 0x4a2d1e];
const HAIRS = [0x1c1410, 0x2a1d16, 0x14100e, 0x4a3020, 0x6b4a2e, 0x8a6a3e, 0x8e3a1e, 0xc8a868, 0x6a6460, 0xd8c08a];
const DARK_HAIRS = [0x1c1410, 0x2a1d16, 0x14100e, 0x14100e, 0x3a261a];
const EYES = [0x3a2416, 0x2a1a10, 0x4a3420, 0x34506e, 0x3a5a3a, 0x5a4a30, 0x283848];

/** Couleur de cheveux naturelle plausible pour une carnation. */
function hairFor(r: Rng, skin: number): number {
  const dark = SKINS.indexOf(skin) >= 5;
  return dark ? r.pick(DARK_HAIRS) : r.chance(0.7) ? r.pick(HAIRS.slice(0, 6)) : r.pick(HAIRS);
}
/** Teintures de 2085. */
const DYES = [0x3a7ad8, 0xd84a9a, 0x7ad8c0, 0xe4e4ea, 0x8a4ad8, 0xd83a3a, 0x40c8e8, 0xe8c040];
const LIPSTICK = [0xa02a3a, 0x8a2a4a, 0xc04050, 0x6a2a3a, 0xb05a5a, 0x7a3a8a, 0x2a2a3a];

export const DADOU_DEFAULT: Outfit = {
  skin: 0xd9ab84,
  hair: 0x15100d,
  coat: 0x161418,
  coat2: 0x9e1b26,
  vest: 0x5a1218,
  shirt: 0xece6da,
  tie: 0xa31e26,
  pants: 0x19171b,
  shoes: 0x0e0d0d,
  hat: 0x121114,
  hatband: 0x8e1b22,
  accent: 0xd9a640,
  eyes: 0x2a1a10,
  beard: 0x0e0b0a,
  armband: 0x9e1b22,
  dress: 0x1c1a1e,
  metal: MB.accent,
  sheen: MB.shoes | MB.hat | MB.coat2,
};

export const EVEN_DEFAULT: Outfit = {
  skin: 0xe2b592,
  hair: 0x8e8b87,
  coat: 0x1d3461,
  coat2: 0x2c4a80,
  vest: 0x8a8f98,
  shirt: 0xf2eee6,
  tie: 0xc9d1dc,
  pants: 0x2c2e36,
  shoes: 0x0e0e10,
  hat: 0x111216,
  hatband: 0x1d3461,
  accent: 0xc9d1dc,
  eyes: 0x34506e,
  beard: 0xa29e98,
  armband: 0x2a4a8a,
  dress: 0x1b1a1d,
  metal: MB.accent,
  sheen: MB.shoes | MB.hat | MB.dress,
};

const DADOU_STYLE: CharStyle = {
  build: 'm',
  torso: 'longcoat',
  sleeve: 'dadou',
  armband: false,
  legs: 'pants',
  feet: 'dress',
  head: { build: 'm', shape: 'b', beard: 'handlebar', age: 1, cyber: false },
  hair: 'slick',
  hat: 'bowler',
  face: 'none',
  hands: 'rings',
  tail: 'longcoat',
  skirt: 'none',
  scale: 1.03,
  idle: 'hip',
  oneHand: true,
};

const EVEN_STYLE: CharStyle = {
  build: 'm',
  torso: 'frock',
  sleeve: 'even',
  armband: false,
  legs: 'pants',
  feet: 'dress',
  head: { build: 'm', shape: 'a', beard: 'boxed', age: 2, cyber: false },
  hair: 'slick',
  hat: 'top',
  face: 'monocle',
  hands: 'glove',
  tail: 'frock',
  skirt: 'none',
  scale: 1.035,
  idle: 'behind',
  oneHand: false,
};

/** Style de base (à compléter). */
function base(build: Build, torso: TorsoStyle, extra: Partial<CharStyle> = {}): CharStyle {
  return {
    build,
    torso,
    sleeve: sleeveFor(torso),
    armband: false,
    legs: 'pants',
    feet: 'sneaker',
    head: { build, shape: 'a', beard: 'none', age: 0, cyber: false },
    hair: build === 'f' ? 'long' : 'short',
    hat: 'none',
    face: 'none',
    hands: 'bare',
    tail: torso === 'trench' ? 'trench' : 'none',
    skirt: 'none',
    scale: 1,
    idle: 'relaxed',
    oneHand: false,
    ...extra,
  };
}

/** Manches assorties à chaque haut. */
function sleeveFor(t: TorsoStyle): SleeveStyle {
  switch (t) {
    case 'bomber':
    case 'hoodie':
    case 'crop':
    case 'workvest':
    case 'puffer':
      return t === 'puffer' ? 'puffer' : 'rib';
    case 'leather':
    case 'crow':
      return 'leather';
    case 'track':
      return 'stripe';
    case 'tech':
      return 'tech';
    case 'armor':
      return 'pad';
    case 'tactical':
      return 'tac';
    case 'tee':
      return 'tee';
    case 'dress':
      return 'bare';
    case 'trench':
      return 'trench';
    default:
      return 'coat';
  }
}

function outfit(o: Partial<Outfit> & { skin: number; hair: number }): Outfit {
  return {
    coat: 0x2a2a2e,
    coat2: 0x3a3a40,
    vest: 0x3a3a40,
    shirt: 0xe8e4dc,
    tie: 0x2a2a2e,
    pants: 0x26262a,
    shoes: 0x161616,
    hat: 0x222226,
    hatband: 0x161616,
    accent: 0xa8acb2,
    eyes: 0x2a1a12,
    beard: o.hair,
    armband: 0x161616,
    dress: 0x1c1c20,
    metal: MB.accent,
    ...o,
  };
}

/** Tête avec une morphologie et une pilosité tirées au sort. */
function headFor(r: Rng, build: Build, beards: BeardStyle[] = ['none'], age = 0, cyber = 0): HeadDef {
  return {
    build,
    shape: r.pick<FaceShape>(['a', 'b', 'c']),
    beard: build === 'f' ? 'none' : r.pick(beards),
    age,
    cyber: r.chance(cyber),
  };
}

export function appearanceFor(kind: CharKind, faction: number, look: number, gang = 0, custom?: BossCustom): Appearance {
  const r = new Rng(look * 2654435761 + kind * 97 + 13);
  const skin = r.pick(SKINS);
  const hair = hairFor(r, skin);
  switch (kind) {
    case CharKind.BOSS_DADOU: {
      const o: Outfit = { ...DADOU_DEFAULT };
      if (custom) applyCustom(o, custom);
      return { style: { ...DADOU_STYLE, hat: bossHat(custom?.hat, 'bowler') }, outfit: o, neon: NEON.RED };
    }
    case CharKind.BOSS_EVEN: {
      const o: Outfit = { ...EVEN_DEFAULT };
      if (custom) applyCustom(o, custom);
      return { style: { ...EVEN_STYLE, hat: bossHat(custom?.hat, 'top') }, outfit: o, neon: NEON.CYAN };
    }
    case CharKind.GANGSTER:
      return gangster(r, faction === 2, skin, hair);
    case CharKind.LIEUTENANT:
      return lieutenant(r, faction === 2, skin, hair);
    case CharKind.THUG:
      return thug(r, ((gang % 7) + 7) % 7, skin, hair);
    case CharKind.POLICE:
      return police(r, skin, hair);
    case CharKind.BARMAN:
      return faction === 2 ? nina() : gino();
    case CharKind.TURRET:
      return turret(faction);
    case CharKind.CIVILIAN_F:
      return civilianF(r, skin);
    case CharKind.CIVILIAN:
    default:
      return civilian(r, skin);
  }
}

function bossHat(h: HatStyle | undefined, def: HatStyle): HatStyle {
  return h && BOSS_HATS.includes(h) ? h : def;
}

/** Coiffure compatible avec un couvre-chef. */
function hairUnder(hat: HatStyle, hair: HairStyle): HairStyle {
  if (hat === 'none' || hat === 'headset') return hair;
  if (hat === 'hood' || hat === 'helmet') return hair === 'long' || hair === 'locs' || hair === 'braids' ? hair : 'short';
  if (hair === 'afro' || hair === 'mohawk' || hair === 'pompadour' || hair === 'curly' || hair === 'undercut' || hair === 'fade') return 'short';
  if (hair === 'bun') return 'ponytail';
  return hair;
}

// ------------------------------------------------------------------ hommes des parrains

function gangster(r: Rng, even: boolean, skin: number, hair: number): Appearance {
  const fem = r.chance(0.18);
  const b: Build = fem ? 'f' : 'm';
  const torso = fem
    ? r.pick<TorsoStyle>(['leather', 'tech', 'suit', 'bomber', 'crop', 'turtle'])
    : r.pick<TorsoStyle>(['bomber', 'bomber', 'suit', 'suit', 'hoodie', 'tech', 'leather', 'tee', 'turtle', 'armor', 'track']);
  const o = even
    ? outfit({
        skin,
        hair,
        coat: r.pick([0x1d2f52, 0x22365e, 0x1a2a48, 0x3a3e48, 0x2c3240, 0x161a24]),
        coat2: r.pick([0x8a8f98, 0x3a5a9a, 0xb0b6c0, 0x2a4a8a]),
        vest: r.pick([0x8a8f98, 0x3a3e48, 0x5a606a]),
        shirt: r.pick([0xd8dce4, 0x8a8f98, 0x1d2f52, 0x2a3040, 0xe8eaee]),
        tie: r.pick([0xc9d1dc, 0x2a4a8a, 0x1a2238]),
        pants: r.pick([0x2a2e38, 0x34363e, 0x1e2230, 0x40444c, 0x22252e]),
        shoes: r.pick([0x111216, 0x22252c, 0xd8dce4, 0x1a1c22]),
        hat: r.pick([0x1d2f52, 0x2a2e38, 0x8a8f98]),
        hatband: 0x111622,
        accent: 0xc9d1dc,
        armband: 0x0c1426,
        dress: r.pick([0x1a1e26, 0x30343c]),
        eyes: r.pick(EYES),
      })
    : outfit({
        skin,
        hair,
        coat: r.pick([0x161418, 0x1e1a1c, 0x231d1f, 0x2a2426, 0x3a1418]),
        coat2: r.pick([0x8e1b22, 0x7a1820, 0xa02028, 0x161418]),
        vest: r.pick([0x5a1218, 0x2a2426, 0x3a1418]),
        shirt: r.pick([0x8e1b22, 0x161418, 0xe8e2d4, 0x2a2426, 0x5a1218]),
        tie: r.pick([0x161418, 0xa31e26, 0xd4a640]),
        pants: r.pick([0x18171a, 0x222024, 0x2a2628, 0x1e1a1c]),
        shoes: r.pick([0x0f0e0e, 0x1e1c1c, 0x8e1b22, 0xe8e2d4]),
        hat: r.pick([0x161418, 0x2a2426, 0x6e1820]),
        hatband: 0x8e1b22,
        accent: r.pick([0xd4a640, 0xd4a640, 0xa8acb2]),
        armband: 0x2a0a0d,
        dress: r.pick([0x1e1a1c, 0x3a1418]),
        eyes: r.pick(EYES),
      });
  if (torso === 'armor') {
    o.vest = even ? r.pick([0x3a4458, 0x2e3648]) : r.pick([0x3a2a2c, 0x2e2426]);
    o.metal = (o.metal ?? 0) | MB.vest;
  }
  if (torso === 'leather' || torso === 'crow') o.sheen = MB.coat;
  const style = base(b, torso, {
    armband: true,
    head: headFor(r, b, ['none', 'none', 'stubble', 'stubble', 'goatee', 'mustache', 'full', 'chinstrap'], r.chance(0.2) ? 1 : 0, 0.15),
    hair: fem ? r.pick<HairStyle>(['ponytail', 'bun', 'bob', 'undercut', 'long', 'braids']) : r.pick<HairStyle>(['short', 'fade', 'buzz', 'slick', 'sidepart', 'undercut', 'curly', 'none', 'braids', 'short']),
    face: r.chance(0.32) ? r.pick<FaceGear>(['shades', 'shades', 'visor', 'mask', 'cybereye', 'implant', 'ar']) : 'none',
    scale: fem ? r.range(0.955, 0.985) : r.range(0.975, 1.035),
    idle: r.pick<IdleKind>(['relaxed', 'crossed', 'pockets', 'relaxed', 'belt']),
    oneHand: r.chance(0.35),
    hands: r.chance(0.3) ? 'tac' : r.chance(0.3) ? 'rings' : 'bare',
  });
  if (torso === 'suit') {
    style.feet = 'dress';
    style.hat = r.chance(0.35) ? 'fedora' : 'none';
    if (fem) {
      style.skirt = r.chance(0.5) ? 'pencil' : 'none';
      style.feet = style.skirt !== 'none' ? 'heel' : 'boot';
      if (style.skirt !== 'none') {
        o.dress = o.pants;
        style.legs = 'tights';
        o.pants = 0x1a1618;
      }
    }
  } else if (torso === 'hoodie') {
    style.hat = r.chance(0.45) ? 'hood' : 'none';
  } else if (torso === 'armor') {
    style.legs = 'cargo';
    style.feet = 'kneepad';
    style.hat = r.chance(0.4) ? 'helmet' : 'none';
  } else {
    style.hat = r.pick<HatStyle>(['none', 'none', 'beanie', 'cap', 'none', 'headset']);
    style.feet = r.pick<FootStyle>(['sneaker', 'boot', 'sneaker']);
    style.legs = r.chance(0.35) ? 'cargo' : r.chance(0.3) ? 'jeans' : 'pants';
    if (torso === 'crop') {
      style.skirt = 'skirt';
      style.legs = 'tights';
      o.dress = o.coat2 === 0x161418 ? 0x2a2426 : o.coat;
      o.pants = 0x161416;
      style.feet = 'boot';
    }
  }
  style.hair = hairUnder(style.hat, style.hair);
  if (style.hair === 'none' && style.hat === 'none' && r.chance(0.5)) style.hair = 'buzz';
  if (fem) {
    o.lip = r.pick(LIPSTICK);
    o.makeup = even ? 0x3a4a6a : 0x4a2a2e;
  }
  return { style, outfit: o, neon: even ? NEON.CYAN : NEON.RED };
}

function lieutenant(r: Rng, even: boolean, skin: number, hair: number): Appearance {
  const long = r.chance(0.6);
  const o = even
    ? outfit({
        skin,
        hair,
        coat: r.pick([0x1a2440, 0x2a2e38, 0x22365e, 0x3a3e48]),
        coat2: r.pick([0x8a8f98, 0x2c4a80, 0x1a2440]),
        shirt: r.pick([0xd8dce4, 0x8a8f98, 0x1a1e26]),
        tie: r.pick([0x1d3461, 0xc9d1dc]),
        pants: 0x22252e,
        shoes: 0x0e0e10,
        hat: r.pick([0x1d2f52, 0x2a2e38]),
        hatband: 0x8a8f98,
        accent: 0xc9d1dc,
        armband: 0x0c1426,
        eyes: r.pick(EYES),
      })
    : outfit({
        skin,
        hair,
        coat: r.pick([0x141216, 0x1c1a1c, 0x2a1416]),
        coat2: r.pick([0x8e1b22, 0x161418]),
        shirt: r.pick([0x8e1b22, 0x6a1218, 0xece6da, 0x161418]),
        tie: r.pick([0x141216, 0xd4a640, 0x8e1b22]),
        pants: 0x18161a,
        shoes: 0x0e0d0d,
        hat: 0x141216,
        hatband: 0x8e1b22,
        accent: 0xd4a640,
        armband: 0x2a0a0d,
        eyes: r.pick(EYES),
      });
  o.metal = MB.accent;
  o.sheen = MB.shoes;
  if (long && !even) o.coat = r.pick([0x141216, 0x2a1416, 0x3a2a22]);
  if (long && even) o.coat = r.pick([0x1a2440, 0x2a2e38, 0x55606c]);
  const style = base('m', long ? 'trench' : 'suit', {
    tail: long ? 'trench' : 'none',
    armband: true,
    feet: 'dress',
    head: headFor(r, 'm', ['none', 'stubble', 'goatee', 'mustache', 'boxed', 'chinstrap'], r.chance(0.4) ? 1 : 0, 0.12),
    hair: r.pick<HairStyle>(['slick', 'slick', 'sidepart', 'short', 'fade']),
    hat: r.chance(0.5) ? 'fedora' : 'none',
    face: r.chance(0.55) ? 'shades' : r.chance(0.2) ? 'cybereye' : 'none',
    scale: r.range(1.0, 1.04),
    idle: r.pick<IdleKind>(['crossed', 'behind', 'pockets']),
    oneHand: r.chance(0.5),
    hands: r.chance(0.5) ? 'rings' : 'bare',
  });
  style.hair = hairUnder(style.hat, style.hair);
  return { style, outfit: o, neon: even ? NEON.CYAN : NEON.RED };
}

// ------------------------------------------------------------------ gangs locaux

function thug(r: Rng, gang: number, skin: number, hair: number): Appearance {
  const fem = (gang === 0 || gang === 2 || gang === 3 || gang === 6) && r.chance(gang === 2 ? 0.35 : 0.2);
  const b: Build = fem ? 'f' : 'm';
  const fScale = () => r.range(0.955, 0.985);
  switch (gang) {
    case 0: {
      // Les Lions de Lenox (Harlem) : survêtements or et noir, chaînes, casquettes
      const gold = r.chance(0.5);
      const sk = r.pick([0x9a6644, 0x7c4f34, 0x5f3b26, 0x4a2d1e, 0xb98058]);
      const o = outfit({
        skin: sk,
        hair: r.pick(DARK_HAIRS),
        coat: gold ? r.pick([0xc8901e, 0xb07a18]) : r.pick([0x1a1612, 0x5a1a14]),
        coat2: gold ? 0x1a1612 : 0xd8a028,
        tie: gold ? 0x1a1612 : 0xe8e2d4,
        shirt: r.pick([0xe8e2d4, 0x1a1612]),
        pants: r.pick([0x1a1612, 0x2a2622, 0xb07a18]),
        shoes: r.pick([0xe8e4dc, 0xd8a028, 0x1a1612]),
        hat: r.pick([0xd8a028, 0x1a1612]),
        hatband: r.pick([0x1a1612, 0xd8a028]),
        accent: 0xd4a640,
        eyes: r.pick(EYES),
      });
      const torso: TorsoStyle = r.chance(0.65) ? 'track' : r.chance(0.5) ? 'bomber' : 'tee';
      const style = base(b, torso, {
        legs: torso === 'track' ? 'track' : 'jeans',
        head: headFor(r, b, ['none', 'goatee', 'stubble', 'full', 'chinstrap'], 0, 0.1),
        hair: fem ? r.pick<HairStyle>(['braids', 'afro', 'bun', 'locs']) : r.pick<HairStyle>(['fade', 'buzz', 'braids', 'locs', 'curly', 'none']),
        hat: r.pick<HatStyle>(['cap', 'cap', 'none', 'beanie', 'none']),
        face: r.chance(0.3) ? 'shades' : 'none',
        hands: 'rings',
        scale: fem ? fScale() : r.range(0.98, 1.04),
        idle: r.pick<IdleKind>(['crossed', 'relaxed', 'pockets']),
        oneHand: r.chance(0.6),
      });
      style.hair = hairUnder(style.hat, style.hair);
      return { style, outfit: o, neon: NEON.AMBER };
    }
    case 1: {
      // La Garde Sterling (Central Park) : sécurité privée d'élite, blanc et sarcelle
      const armor = r.chance(0.55);
      const o = outfit({
        skin,
        hair,
        coat: armor ? 0x2a3a3c : r.pick([0xe4e6ea, 0xd8dce0]),
        coat2: armor ? 0x2a9a8e : 0xc8ccd2,
        vest: 0xe8eaee,
        shirt: armor ? 0xe8eaee : r.pick([0x2a9a8e, 0x1a2a2c]),
        tie: 0x2a9a8e,
        pants: armor ? 0x2a3a3c : 0xd8dce0,
        shoes: 0x1a1e20,
        hat: 0xe8eaee,
        hatband: 0x1e5a56,
        accent: 0x8ae0d8,
        dress: 0x1e2a2c,
        armband: 0x1e5a56,
        eyes: r.pick(EYES),
      });
      o.metal = MB.accent | MB.vest | MB.hat;
      const style = armor
        ? base('m', 'armor', { head: headFor(r, 'm', ['none', 'stubble']), hair: 'short', hat: r.chance(0.6) ? 'helmet' : 'none', feet: 'kneepad', legs: 'armor', hands: 'tac', scale: r.range(1.0, 1.045), idle: 'belt' })
        : base('m', 'suit', { head: headFor(r, 'm', ['none', 'none', 'stubble']), hair: r.pick<HairStyle>(['short', 'slick', 'sidepart']), face: 'shades', feet: 'dress', hat: 'headset', scale: r.range(0.99, 1.04), idle: 'behind' });
      return { style, outfit: o, neon: NEON.CYAN };
    }
    case 2: {
      // Les Néons de Broadway (Times Square) : punks fluo rose et violet
      const pink = r.chance(0.5);
      const o = outfit({
        skin,
        hair: r.pick([0xff4aa8, 0x9a4aff, 0x4ae8ff, 0xe8e8f0, 0xff4aa8, 0x1c1410, 0x40ff90]),
        coat: r.pick([0x1a1420, 0x3a1a4a, 0x2a1030, 0x161418]),
        coat2: pink ? 0xd02a8a : 0x8a2ad0,
        shirt: r.pick([0xd02a8a, 0x8a2ad0, 0x161418, 0xe8e8f0]),
        tie: 0xe8e8f0,
        pants: r.pick([0x161418, 0x2a1030, 0x3a1a4a]),
        shoes: r.pick([0x161418, 0xd02a8a, 0xe8e8f0]),
        hat: r.pick([0x161418, 0x3a1a4a]),
        hatband: pink ? 0xd02a8a : 0x8a2ad0,
        accent: 0xc0c4cc,
        dress: pink ? 0xd02a8a : 0x8a2ad0,
        eyes: r.pick(EYES),
        lip: r.pick([0x1a1a20, 0x8a2ad0, 0xd02a8a]),
        makeup: pink ? 0xd02a8a : 0x8a2ad0,
      });
      o.sheen = MB.coat;
      if (fem) {
        const torso = r.pick<TorsoStyle>(['crop', 'leather', 'tech', 'crop']);
        const style = base('f', torso, {
          head: headFor(r, 'f', ['none'], 0, 0.5),
          hair: r.pick<HairStyle>(['undercut', 'bob', 'mohawk', 'bun', 'ponytail']),
          face: r.pick<FaceGear>(['visor', 'none', 'ar', 'implant']),
          feet: r.pick<FootStyle>(['boot', 'heel']),
          skirt: torso === 'crop' ? 'skirt' : 'none',
          legs: torso === 'crop' ? 'tights' : 'pants',
          scale: fScale(),
          idle: r.pick<IdleKind>(['hip', 'crossed', 'phone']),
          oneHand: true,
        });
        if (style.skirt !== 'none') o.pants = 0x1a1420;
        return { style, outfit: o, neon: pink ? NEON.PINK : NEON.PURPLE };
      }
      const torso = r.pick<TorsoStyle>(['leather', 'tech', 'tee', 'leather']);
      const style = base('m', torso, {
        head: headFor(r, 'm', ['none', 'goatee', 'stubble'], 0, 0.5),
        hair: r.pick<HairStyle>(['mohawk', 'mohawk', 'undercut', 'buzz', 'fade']),
        face: r.pick<FaceGear>(['visor', 'none', 'cybereye', 'implant']),
        hat: r.chance(0.15) ? 'beanie' : 'none',
        feet: r.pick<FootStyle>(['boot', 'sneaker']),
        legs: r.chance(0.5) ? 'jeans' : 'pants',
        scale: r.range(0.97, 1.02),
        idle: r.pick<IdleKind>(['relaxed', 'crossed', 'pockets']),
        oneHand: true,
      });
      style.hair = hairUnder(style.hat, style.hair);
      return { style, outfit: o, neon: pink ? NEON.PINK : NEON.PURPLE };
    }
    case 3: {
      // La Triade du Jade (Chinatown) : noir et vert jade, masques
      const o = outfit({
        skin: r.pick([0xf0d2b4, 0xe8c8a4, 0xdcb890, 0xc8a07a]),
        hair: r.pick([0x14100e, 0x1c1410, 0x2a1d16]),
        coat: r.pick([0x121414, 0x1a1e1c, 0x161818]),
        coat2: r.pick([0x2e9a6a, 0x1f7a52]),
        shirt: r.pick([0x121414, 0xe8e4dc, 0x1f7a52]),
        tie: 0x2e9a6a,
        pants: 0x121414,
        shoes: 0x0e0e0e,
        hat: 0x121414,
        hatband: 0x2e9a6a,
        accent: 0xc8a050,
        dress: 0x1f7a52,
        armband: 0x1f7a52,
        eyes: 0x1a1210,
        lip: 0x8a1a2a,
        makeup: 0x2a3a30,
      });
      o.metal = MB.accent;
      if (fem) {
        const torso: TorsoStyle = r.chance(0.5) ? 'mandarin' : 'dress';
        const style = base('f', torso, {
          head: headFor(r, 'f'),
          hair: r.pick<HairStyle>(['bun', 'bob', 'ponytail', 'long']),
          feet: 'heel',
          skirt: torso === 'dress' ? 'pencil' : 'pencil',
          legs: 'tights',
          scale: fScale(),
          idle: r.pick<IdleKind>(['behind', 'crossed']),
          face: r.chance(0.3) ? 'shades' : 'none',
        });
        o.pants = 0x141414;
        if (torso === 'mandarin') o.dress = 0x121414;
        return { style, outfit: o, neon: NEON.GREEN };
      }
      const torso: TorsoStyle = r.chance(0.7) ? 'mandarin' : 'suit';
      const style = base('m', torso, {
        head: headFor(r, 'm', ['none', 'goatee', 'mustache', 'none']),
        hair: r.pick<HairStyle>(['slick', 'short', 'buzz', 'undercut', 'none']),
        face: r.pick<FaceGear>(['mask', 'mask', 'none', 'shades']),
        feet: 'dress',
        hat: r.chance(0.2) ? 'flatcap' : 'none',
        scale: r.range(0.97, 1.02),
        idle: r.pick<IdleKind>(['behind', 'crossed', 'relaxed']),
      });
      style.hair = hairUnder(style.hat, style.hair);
      return { style, outfit: o, neon: NEON.GREEN };
    }
    case 4: {
      // La Sécurité Axiom (Wall Street) : armure corporate gris sombre, visières bleues
      const o = outfit({
        skin,
        hair,
        coat: 0x1a1c20,
        coat2: 0x2a4a8a,
        vest: r.pick([0x3a3e46, 0x2e3238, 0x454a52]),
        shirt: 0x1a1c20,
        pants: 0x22252a,
        shoes: 0x121316,
        hat: r.pick([0x2a2e36, 0x3a3e46]),
        hatband: 0x15171b,
        accent: 0x8a9aae,
        dress: 0x15171b,
        armband: 0x15171b,
        eyes: r.pick(EYES),
      });
      o.metal = MB.accent | MB.vest | MB.hat;
      const helmet = r.chance(0.7);
      const style = base('m', 'armor', {
        head: headFor(r, 'm', ['none', 'stubble']),
        hair: 'buzz',
        hat: helmet ? 'helmet' : 'none',
        face: helmet ? 'none' : r.pick<FaceGear>(['visor', 'visor', 'shades']),
        feet: 'kneepad',
        legs: 'armor',
        hands: 'tac',
        scale: r.range(1.01, 1.045),
        idle: 'belt',
      });
      return { style, outfit: o, neon: NEON.BLUE };
    }
    case 5: {
      // Les Rouleurs de Flushing (Queens) : tenues de travail et de motard orange
      const kindR = r.next();
      const o = outfit({
        skin,
        hair,
        coat: kindR < 0.5 ? r.pick([0x2a2a2e, 0x3a3a3e, 0x1e2a3a]) : kindR < 0.8 ? 0x161616 : r.pick([0xe86a1a, 0xd85a10]),
        coat2: kindR < 0.8 ? 0xe86a1a : 0x2a2a2e,
        vest: r.pick([0xe86a1a, 0xf07a20]),
        shirt: r.pick([0xe8e4dc, 0x2a2a2e]),
        tie: 0xe86a1a,
        pants: r.pick([0x2e3440, 0x3a3428, 0x26262a]),
        shoes: r.pick([0x3a2a1a, 0x161616]),
        hat: r.pick([0xe86a1a, 0x161616, 0x2a2a2e]),
        hatband: r.pick([0x161616, 0xe86a1a]),
        accent: 0xb0b4ba,
        eyes: r.pick(EYES),
      });
      const torso: TorsoStyle = kindR < 0.5 ? 'workvest' : kindR < 0.8 ? 'leather' : 'puffer';
      if (torso === 'puffer') o.coat2 = shadeHex(o.coat, 0.72);
      if (torso === 'leather') o.sheen = MB.coat;
      const style = base('m', torso, {
        head: headFor(r, 'm', ['full', 'stubble', 'mustache', 'goatee', 'none', 'boxed'], r.chance(0.35) ? 2 : 1),
        hair: r.pick<HairStyle>(['short', 'buzz', 'none', 'old', 'curly']),
        hat: r.pick<HatStyle>(['cap', 'beanie', 'none', 'cap']),
        feet: 'boot',
        legs: r.chance(0.6) ? 'cargo' : 'jeans',
        hands: r.chance(0.4) ? 'tac' : 'bare',
        scale: r.range(1.0, 1.045),
        idle: r.pick<IdleKind>(['crossed', 'pockets', 'belt']),
      });
      style.hair = hairUnder(style.hat, style.hair);
      if (style.hair === 'old') o.hair = o.beard = r.pick([0x8a8680, 0xb8b4ac]);
      return { style, outfit: o, neon: NEON.ORANGE };
    }
    case 6:
    default: {
      // Les Corbeaux de Red Hook (Brooklyn) : cuir noir, rouge sang, corbeau dans le dos
      const o = outfit({
        skin,
        hair: r.pick([0x14100e, 0x1c1410, 0x14100e, 0xa01820]),
        coat: r.pick([0x141214, 0x1a1618]),
        coat2: r.pick([0xa01820, 0x8a1218]),
        shirt: r.pick([0x141214, 0xa01820, 0x2a2628]),
        tie: 0xa01820,
        pants: r.pick([0x141214, 0x26262a]),
        shoes: 0x0e0d0d,
        hat: 0x141214,
        hatband: 0xa01820,
        accent: 0xb8bcc4,
        eyes: r.pick(EYES),
        lip: 0x2a0a10,
        makeup: 0x1a0a0e,
      });
      o.sheen = MB.coat;
      const torso: TorsoStyle = r.chance(0.7) ? 'crow' : 'hoodie';
      const style = base(b, torso, {
        head: headFor(r, b, ['none', 'full', 'stubble', 'goatee'], 0, 0.3),
        hair: fem ? r.pick<HairStyle>(['undercut', 'long', 'ponytail']) : r.pick<HairStyle>(['buzz', 'none', 'mohawk', 'fade', 'slick']),
        hat: torso === 'hoodie' ? (r.chance(0.6) ? 'hood' : 'none') : r.pick<HatStyle>(['none', 'beanie', 'none', 'none']),
        face: r.chance(0.3) ? r.pick<FaceGear>(['cybereye', 'mask', 'implant']) : 'none',
        feet: 'boot',
        legs: r.chance(0.5) ? 'jeans' : 'pants',
        scale: fem ? fScale() : r.range(0.98, 1.035),
        idle: r.pick<IdleKind>(['crossed', 'pockets', 'relaxed']),
        oneHand: r.chance(0.5),
      });
      style.hair = hairUnder(style.hat, style.hair);
      return { style, outfit: o, neon: NEON.RED };
    }
  }
}

// ------------------------------------------------------------------ NYPD

function police(r: Rng, skin: number, hair: number): Appearance {
  const fem = r.chance(0.25);
  const b: Build = fem ? 'f' : 'm';
  const o = outfit({
    skin,
    hair,
    coat: 0x223050,
    coat2: 0x223050,
    vest: r.pick([0x121722, 0x171d2b]),
    shirt: 0xc8d0dc,
    tie: 0x10141f,
    pants: 0x1c2438,
    shoes: 0x0c0c0e,
    hat: 0x1a2236,
    hatband: 0x0c0e14,
    accent: r.chance(0.8) ? 0xd2b464 : 0xc0c6cc,
    dress: 0x0e1016,
    armband: 0x10141f,
    eyes: r.pick(EYES),
    lip: fem ? r.pick([0x8a3a40, 0x7a4a48]) : undefined,
  });
  o.metal = MB.accent;
  o.sheen = MB.shoes | MB.hatband;
  const helmet = r.chance(0.3);
  const style = base(b, 'tactical', {
    head: headFor(r, b, ['none', 'none', 'stubble', 'mustache'], r.chance(0.3) ? 1 : 0, 0.15),
    hair: fem ? r.pick<HairStyle>(['bun', 'ponytail', 'bob']) : r.pick<HairStyle>(['short', 'buzz', 'fade', 'sidepart']),
    hat: helmet ? 'helmet' : 'police',
    face: !helmet && r.chance(0.25) ? 'ar' : 'none',
    hands: 'tac',
    feet: 'boot',
    legs: 'cargo',
    scale: fem ? r.range(0.96, 0.99) : r.range(0.99, 1.04),
    idle: r.pick<IdleKind>(['belt', 'belt', 'crossed', 'behind']),
  });
  style.hair = hairUnder(style.hat, style.hair);
  return { style, outfit: o, neon: NEON.BLUE };
}

// ------------------------------------------------------------------ rabatteurs

/** Gino le Rabatteur (Dadou) : blazer de velours cramoisi, col roulé, chaîne d'or, banane gominée. */
function gino(): Appearance {
  const o = outfit({
    skin: 0xd6a47c,
    hair: 0x120e0c,
    coat: 0x7a1420,
    coat2: 0x5e0e18,
    shirt: 0x161418,
    pants: 0x161418,
    shoes: 0x0e0d0d,
    accent: 0xe0b048,
    beard: 0x120e0c,
    eyes: 0x2a1a10,
  });
  o.metal = MB.accent;
  o.sheen = MB.coat | MB.shoes;
  return {
    style: base('m', 'blazer', {
      head: { build: 'm', shape: 'a', beard: 'pencil', age: 1, cyber: false },
      hair: 'pompadour',
      face: 'tint',
      feet: 'dress',
      hands: 'signet',
      scale: 1.0,
      idle: 'crossed',
      oneHand: true,
    }),
    outfit: o,
    neon: NEON.RED,
  };
}

/** Nina la Recruteuse (Even) : tailleur bleu marine, carré argenté, lunettes de réalité augmentée. */
function nina(): Appearance {
  const o = outfit({
    skin: 0xe8c0a0,
    hair: 0xd8dce4,
    coat: 0x1d3461,
    coat2: 0x2c4a80,
    shirt: 0xeef0f4,
    pants: 0x2a2a32,
    shoes: 0x0e0e10,
    accent: 0xc9d1dc,
    dress: 0x1a2a4a,
    eyes: 0x34506e,
    lip: 0x9a3a4a,
    makeup: 0x5a6a8a,
  });
  o.metal = MB.accent;
  o.sheen = MB.shoes;
  return {
    style: base('f', 'suit', { head: { build: 'f', shape: 'a', beard: 'none', age: 0, cyber: true }, hair: 'bob', face: 'ar', feet: 'heel', skirt: 'pencil', legs: 'tights', scale: 0.975, idle: 'phone' }),
    outfit: o,
    neon: NEON.CYAN,
  };
}

// ------------------------------------------------------------------ tourelle

function turret(faction: number): Appearance {
  const o =
    faction === 1
      ? outfit({ skin: 0, hair: 0, coat: 0x1c1a1e, coat2: 0x8e1b22, pants: 0x2a282c, shoes: 0x141316, accent: 0xd4a640, dress: 0x3a2a26 })
      : faction === 2
        ? outfit({ skin: 0, hair: 0, coat: 0x1d2a44, coat2: 0x8a8f98, pants: 0x262a32, shoes: 0x121418, accent: 0xc9d1dc, dress: 0x2a3040 })
        : outfit({ skin: 0, hair: 0, coat: 0x3a3e46, coat2: 0xd8a020, pants: 0x2a2c30, shoes: 0x16171a, accent: 0x18181a, dress: 0x3a3a30 });
  o.metal = MB.accent;
  return { style: base('m', 'armor'), outfit: o, neon: faction === 1 ? NEON.RED : faction === 2 ? NEON.CYAN : NEON.AMBER };
}

// ------------------------------------------------------------------ New-Yorkais

const BRIGHT = [0xa82a2a, 0xd8b030, 0x2a8a8a, 0x5a3a8a, 0xd8641e, 0x9aa0a8, 0x2a5aa8, 0x3a7a3a, 0xc8384a, 0x2aa0b0];
const MUTED = [0x2a2a2e, 0x3a3e46, 0x5a5e66, 0x1e2a3a, 0x4a5236, 0x6a5a48, 0x2e3a2e, 0x5a2a2a, 0x8a7a62, 0x3a3428];

function civilian(r: Rng, skin: number): Appearance {
  const torso = r.pick<TorsoStyle>(['trench', 'trench', 'puffer', 'puffer', 'hoodie', 'hoodie', 'suit', 'suit', 'bomber', 'tee', 'tee', 'leather', 'tech', 'turtle', 'track']);
  const dyed = r.chance(0.12);
  const hair = dyed ? r.pick(DYES) : hairFor(r, skin);
  let coat: number;
  switch (torso) {
    case 'trench':
      coat = r.pick([0xb09a78, 0x8a7a5a, 0x5a5a3a, 0x1a1a1c, 0x22283a, 0x5a5e66, 0x6a4a32]);
      break;
    case 'puffer':
      coat = r.pick(r.chance(0.6) ? BRIGHT : MUTED);
      break;
    case 'suit':
      coat = r.pick([0x2e3036, 0x232a3a, 0x4a4e56, 0x8a7a62, 0x1a1a1e, 0x3a2e2a]);
      break;
    default:
      coat = r.chance(0.35) ? r.pick(BRIGHT) : r.pick(MUTED);
  }
  const o = outfit({
    skin,
    hair,
    coat,
    coat2: torso === 'trench' || torso === 'suit' ? coat : r.pick([0x1a1a1e, 0xe8e4dc, ...MUTED]),
    shirt: torso === 'suit' ? r.pick([0xe8e4dc, 0xc8d8e8, 0xd8d0c0, 0x2a2a2e]) : r.pick([0xe8e4dc, 0x1a1a1e, ...BRIGHT, ...MUTED]),
    tie: r.pick([0x5a2a2a, 0x2a3a5a, 0x3a3a2a, 0x1a1a1e, 0xa82a2a, 0xe8e4dc]),
    pants: r.pick([0x2a3448, 0x3e3a34, 0x26262a, 0x4a4a4a, 0x5a5040, 0x1a1a1e, 0x34405a]),
    shoes: r.pick([0x161616, 0xe8e4dc, 0x3a2a1a, 0x2a2a2e, ...BRIGHT]),
    hat: r.pick([0x1a1a1e, 0x3a3e46, ...BRIGHT]),
    hatband: r.pick([0x1a1a1e, 0xe8e4dc]),
    accent: r.pick([0xa8acb2, 0xd4a640]),
    dress: r.pick([0x1a1a1e, 0x2a2a2e]),
    eyes: r.pick(EYES),
  });
  if (torso === 'trench' || torso === 'suit') o.coat2 = shadeHex(coat, 0.82);
  if (torso === 'puffer' || torso === 'hoodie') o.coat2 = shadeHex(coat, 0.72);
  if (torso === 'leather') o.sheen = MB.coat;
  const age = r.chance(0.18) ? 2 : r.chance(0.3) ? 1 : 0;
  const head = headFor(r, 'm', ['none', 'none', 'stubble', 'stubble', 'full', 'goatee', 'mustache', 'boxed', 'chinstrap'], age, 0.1);
  let hairStyle = r.pick<HairStyle>(['short', 'short', 'slick', 'buzz', 'fade', 'sidepart', 'curly', 'undercut', 'none', 'afro', 'locs', 'braids']);
  if (age === 2 && r.chance(0.6)) {
    hairStyle = r.pick<HairStyle>(['old', 'short', 'none', 'sidepart']);
    o.hair = o.beard = r.pick([0x8a8680, 0xb8b4ac, 0xd8d4cc]);
  }
  const style = base('m', torso, {
    head,
    hair: hairStyle,
    feet: torso === 'suit' || torso === 'trench' ? r.pick<FootStyle>(['dress', 'dress', 'sneaker']) : r.pick<FootStyle>(['sneaker', 'sneaker', 'boot']),
    legs: torso === 'track' ? 'track' : r.chance(0.3) ? 'jeans' : r.chance(0.2) ? 'cargo' : 'pants',
    scale: r.range(0.965, 1.035),
    idle: r.pick<IdleKind>(['relaxed', 'relaxed', 'phone', 'pockets', 'crossed', 'phone']),
    face: r.chance(0.25) ? r.pick<FaceGear>(['shades', 'ar', 'visor', 'implant', 'shades']) : 'none',
  });
  const hr = r.next();
  style.hat =
    torso === 'hoodie' && hr < 0.35 ? 'hood' : hr < 0.55 ? 'none' : hr < 0.67 ? 'beanie' : hr < 0.79 ? 'cap' : hr < 0.9 ? 'headset' : torso === 'suit' || torso === 'trench' ? 'fedora' : 'none';
  style.hair = hairUnder(style.hat, style.hair);
  return { style, outfit: o, neon: r.int(0, 7) };
}

function civilianF(r: Rng, skin: number): Appearance {
  const torso = r.pick<TorsoStyle>(['trench', 'trench', 'puffer', 'puffer', 'suit', 'hoodie', 'crop', 'crop', 'dress', 'dress', 'leather', 'tee', 'turtle', 'tech']);
  const dyed = r.chance(0.18);
  const hair = dyed ? r.pick(DYES) : hairFor(r, skin);
  const bright = [0xb02a3a, 0xd8b030, 0x2a8a8a, 0x6a3a9a, 0xd8641e, 0xc8ccd4, 0x2a5aa8, 0xd84a8a, 0x3a8a5a, 0xe8e0d0];
  let coat: number;
  switch (torso) {
    case 'trench':
      coat = r.pick([0xb09a78, 0xc8b490, 0x1a1a1c, 0x5a2a3a, 0x22283a, 0x8a3a2a]);
      break;
    case 'suit':
      coat = r.pick([0x2e3036, 0x232a3a, 0xd8d4cc, 0x8a7a62, 0x5a2a3a, 0x1a1a1e, 0xc8384a]);
      break;
    default:
      coat = r.chance(0.45) ? r.pick(bright) : r.pick(MUTED);
  }
  const o = outfit({
    skin,
    hair,
    coat,
    coat2: r.pick([0x1a1a1e, 0xe8e4dc, ...MUTED]),
    shirt: r.pick([0xe8e4dc, 0x1a1a1e, 0xd8c8b8, ...bright]),
    tie: r.pick([0x1a1a1e, 0xe8e4dc]),
    pants: r.pick([0x1a1a1e, 0x2a3448, 0x3a3e46, 0x5a5040, 0x26262a, 0x34405a]),
    shoes: r.pick([0x161616, 0xe8e4dc, 0x3a2a1a, 0x5a2a3a, 0x8a1a2a]),
    hat: r.pick([0x1a1a1e, 0xe8e4dc, ...bright]),
    hatband: r.pick([0x1a1a1e, 0xe8e4dc, 0xd4a640]),
    accent: r.pick([0xd4a640, 0xc8ccd4]),
    dress: r.pick([...bright, ...MUTED]),
    eyes: r.pick(EYES),
    lip: r.pick(LIPSTICK),
    makeup: r.pick([0x6a4a5a, 0x4a3a4a, 0x8a6a5a, 0x3a4a6a, 0x5a3a2a]),
  });
  if (torso === 'trench' || torso === 'suit') o.coat2 = shadeHex(coat, 0.82);
  if (torso === 'puffer' || torso === 'hoodie') o.coat2 = shadeHex(coat, 0.72);
  if (torso === 'leather') o.sheen = MB.coat;
  const hairdo = r.pick<HairStyle>(['long', 'long', 'ponytail', 'bun', 'bob', 'afro', 'curly', 'braids', 'locs', 'long', 'undercut', 'short']);
  if (hairdo === 'afro' || hairdo === 'braids' || hairdo === 'locs') o.hair = dyed ? o.hair : r.pick([0x1c1410, 0x2a1d16, 0x4a3020]);
  const skirtR: SkirtStyle | 'none' =
    torso === 'dress' ? r.pick<SkirtStyle>(['pencil', 'skirt', 'midi']) : torso === 'crop' || torso === 'suit' ? (r.chance(0.55) ? r.pick<SkirtStyle>(['skirt', 'pencil', 'midi']) : 'none') : 'none';
  const style = base('f', torso, {
    head: { ...headFor(r, 'f', ['none'], r.chance(0.15) ? 1 : 0, 0.12) },
    hair: hairdo,
    skirt: skirtR,
    legs: skirtR !== 'none' ? (r.chance(0.6) ? 'tights' : 'bare') : r.chance(0.4) ? 'jeans' : 'pants',
    feet: skirtR !== 'none' ? r.pick<FootStyle>(['heel', 'heel', 'boot']) : r.pick<FootStyle>(['sneaker', 'heel', 'boot', 'sneaker']),
    scale: r.range(0.955, 0.99),
    idle: r.pick<IdleKind>(['relaxed', 'phone', 'phone', 'crossed', 'hip', 'pockets']),
    face: r.chance(0.2) ? r.pick<FaceGear>(['shades', 'ar', 'visor', 'implant']) : 'none',
  });
  const hr = r.next();
  style.hat = hr < 0.68 ? 'none' : hr < 0.8 ? 'beanie' : hr < 0.88 ? 'cap' : hr < 0.95 ? 'headset' : torso === 'hoodie' ? 'hood' : 'none';
  style.hair = hairUnder(style.hat, style.hair);
  if (skirtR !== 'none') {
    if (torso !== 'dress') o.dress = r.pick([0x1a1a1e, 0x2a3448, 0x5a2a3a, 0x3a3e46, ...bright]);
    o.pants = style.legs === 'tights' ? r.pick([0x1a1a1e, 0x2a2228, 0x3a3038]) : skin;
  }
  return { style, outfit: o, neon: r.int(0, 7) };
}

function shadeHex(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function mixHex(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

function applyCustom(o: Outfit, c: BossCustom): void {
  if (c.coat !== undefined) o.coat = c.coat;
  if (c.vest !== undefined) o.vest = c.vest;
  if (c.tie !== undefined) o.tie = c.tie;
  if (c.hatband !== undefined) o.hatband = c.hatband;
  if (c.accent !== undefined) o.accent = c.accent;
}

/**
 * Nuances dérivées de la tenue (emplacements étendus XS.*, colonnes 16 à 31 de la ligne de
 * palette) : ombres et reflets de la peau, des cheveux et des étoffes, lèvres, fard, iris.
 */
export function extendedColors(o: Outfit): number[] {
  const lum = (c: number) => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
  /** Reflet : éclaircit les couleurs sombres un peu plus (sinon invisible sur le noir). */
  const hi = (c: number, k: number) => mixHex(c, lum(c) < 0.15 ? 0x6a6e7a : 0xffffff, k);
  return [
    mixHex(shadeHex(o.skin, 0.8), 0x7a2a20, 0.06), // SKIN_D
    hi(o.skin, 0.16), // SKIN_L
    o.lip ?? mixHex(shadeHex(o.skin, 0.78), 0x9a3a40, 0.3), // LIP
    hi(o.hair, 0.28), // HAIR_L
    shadeHex(o.hair, 0.62), // HAIR_D
    shadeHex(o.coat, 0.68), // COAT_D
    hi(o.coat, 0.14), // COAT_L
    shadeHex(o.pants, 0.7), // PANTS_D
    shadeHex(o.shirt, 0.8), // SHIRT_D
    hi(o.shoes, 0.3), // SHOES_L
    shadeHex(o.vest, 0.72), // VEST_D
    hi(o.hat, 0.2), // HAT_L
    shadeHex(o.dress, 0.7), // DRESS_D
    shadeHex(o.coat2, 0.68), // COAT2_D
    o.makeup ?? shadeHex(o.skin, 0.84), // MAKEUP
    o.eyes, // IRIS
  ];
}

// ------------------------------------------------------------------ clés des membres

/** Clés des membres d'une silhouette (géométries partagées par toutes les instances). */
export interface PartKeys {
  torso: string;
  pelvis: string;
  head: string;
  hair: string | null;
  hat: string | null;
  face: string | null;
  uarmL: string;
  uarmR: string;
  farmL: string;
  farmR: string;
  thighL: string;
  thighR: string;
  shinL: string;
  shinR: string;
  foot: string;
  tailL: string | null;
  tailR: string | null;
  skirtL: string | null;
  skirtR: string | null;
  /** Préfixe des clés de main (la pose de la main change pendant l'animation). */
  hand: string;
}

export function partKeys(s: CharStyle): PartKeys {
  const b = s.build;
  const pel = s.skirt !== 'none' && s.torso !== 'crop' ? (s.torso === 'dress' || s.torso === 'suit' || s.torso === 'mandarin' ? 'skirt' : pelvisOf(s.torso)) : pelvisOf(s.torso);
  return {
    torso: `torso:${s.torso === 'hoodie' && s.hat === 'hood' ? 'hoodup' : s.torso}:${b}`,
    pelvis: `pelvis:${pel === 'jacket' && s.skirt !== 'none' ? 'skirt' : pel}:${b}`,
    head: `head:${headKey(s.head)}`,
    hair: s.hair !== 'none' ? `hair:${s.hair}:${b}` : null,
    hat: s.hat !== 'none' ? `hat:${s.hat}` : null,
    face: s.face !== 'none' ? `face:${s.face}` : null,
    uarmL: `uarm:${s.sleeve}:${b}:${s.armband ? 'band' : '-'}:L`,
    uarmR: `uarm:${s.sleeve}:${b}:-:R`,
    farmL: `farm:${s.sleeve}:${b}:L`,
    farmR: `farm:${s.sleeve}:${b}:R`,
    thighL: `thigh:${s.legs}:${b}:L`,
    thighR: `thigh:${s.legs}:${b}:R`,
    shinL: `shin:${s.legs}:${s.feet}:${b}:L`,
    shinR: `shin:${s.legs}:${s.feet}:${b}:R`,
    foot: `foot:${s.feet}:${b}`,
    tailL: s.tail !== 'none' ? `tail:${s.tail}:${b}:L` : null,
    tailR: s.tail !== 'none' ? `tail:${s.tail}:${b}:R` : null,
    skirtL: s.skirt !== 'none' ? `skirt:${s.skirt}:${b}:L` : null,
    skirtR: s.skirt !== 'none' ? `skirt:${s.skirt}:${b}:R` : null,
    hand: `hand:%:${b}:${s.hands}`,
  };
}

/** Clé de la main d'un côté dans une pose donnée. */
export function handKey(keys: PartKeys, pose: HandPose, side: 'L' | 'R'): string {
  return `${keys.hand.replace('%', pose)}:${side}`;
}

/** Toutes les clés de membres d'une silhouette (préchargement). */
export function styleParts(s: CharStyle): string[] {
  const k = partKeys(s);
  const out = [k.torso, k.pelvis, k.head, k.hair, k.hat, k.face, k.uarmL, k.uarmR, k.farmL, k.farmR, k.thighL, k.thighR, k.shinL, k.shinR, k.foot, k.tailL, k.tailR, k.skirtL, k.skirtR].filter((x): x is string => x !== null);
  for (const p of ['relax', 'grip'] as HandPose[]) for (const sd of ['L', 'R'] as const) out.push(handKey(k, p, sd));
  return out;
}

// ------------------------------------------------------------------ niveaux de détail

const lodCache: Map<string, string>[] = [new Map(), new Map(), new Map()];

/** Classe de torse au loin (silhouette et disposition des couleurs proches). */
function torsoClass(t: string): string {
  switch (t) {
    case 'longcoat':
    case 'frock':
    case 'trench':
      return 'trench';
    case 'suit':
    case 'blazer':
    case 'leather':
    case 'crow':
      return 'suit';
    case 'puffer':
    case 'armor':
    case 'tactical':
      return 'armor';
    case 'dress':
    case 'crop':
      return 'dress';
    default:
      return 'tee';
  }
}

function pelvisClass(p: string): string {
  switch (p) {
    case 'open':
    case 'frock':
    case 'trench':
      return 'trench';
    case 'jacket':
      return 'jacket';
    case 'duty':
    case 'armor':
    case 'tech':
      return 'duty';
    case 'skirt':
      return 'skirt';
    default:
      return 'belt';
  }
}

function hairClass(h: string): string {
  switch (h) {
    case 'long':
    case 'locs':
    case 'ponytail':
    case 'bob':
      return 'long';
    case 'afro':
    case 'mohawk':
    case 'bun':
      return h;
    default:
      return 'short';
  }
}

/**
 * Clé du membre à utiliser à un niveau de détail : au loin, les variantes invisibles sont
 * fusionnées (beaucoup moins de géométries, donc d'appels de dessin) ; la palette de chaque
 * personnage garde ses couleurs.
 */
export function lodKey(key: string, tier: number): string {
  if (tier <= 0) return key;
  const cache = lodCache[tier];
  let k = cache.get(key);
  if (k !== undefined) return k;
  const a = key.split(':');
  k = key;
  switch (a[0]) {
    case 'hand':
      // hand:pose:build:wear:side
      k = `hand:${a[1] === 'grip' || a[1] === 'fist' ? 'grip' : 'relax'}:${a[2]}:${a[3] === 'glove' || a[3] === 'tac' ? 'glove' : 'bare'}:${a[4]}`;
      break;
    case 'head': {
      const b = a[1][0];
      const beard = a[1].slice(2).replace(/[0-9c]+$/, '');
      const cls = tier >= 2 ? (beard === 'none' || beard === 'stubble' || beard === 'pencil' ? 'none' : 'full') : beard;
      k = `head:${b}a${cls}0`;
      break;
    }
    case 'torso':
      if (tier >= 2) k = `torso:${torsoClass(a[1])}:${a[2]}`;
      break;
    case 'pelvis':
      if (tier >= 2) k = `pelvis:${pelvisClass(a[1])}:${a[2]}`;
      break;
    case 'hair':
      if (tier >= 2) k = `hair:${hairClass(a[1])}:${a[2]}`;
      break;
    case 'uarm': {
      // uarm:sleeve:build:band:side ; manches à peu près identiques à cette distance
      const cls = a[1] === 'bare' || a[1] === 'tee' || a[1] === 'pad' || a[1] === 'puffer' ? a[1] : 'coat';
      k = tier >= 2 ? `uarm:${cls === 'tee' ? 'bare' : cls === 'puffer' ? 'coat' : cls}:${a[2]}:-:${a[4]}` : `uarm:${cls}:${a[2]}:${a[3]}:${a[4]}`;
      break;
    }
    case 'farm': {
      // farm:sleeve:build:side ; les revers des parrains restent visibles à moyenne distance
      const s1 = a[1];
      const cls = s1 === 'bare' || s1 === 'tee' || s1 === 'rolled' ? 'tee' : s1 === 'pad' || s1 === 'tac' || s1 === 'tech' ? 'tac' : s1 === 'rib' || s1 === 'stripe' || s1 === 'leather' ? 'rib' : s1 === 'dadou' || s1 === 'even' ? s1 : 'coat';
      k = tier >= 2 ? `farm:${cls === 'tee' ? 'bare' : 'coat'}:${a[2]}:${a[3]}` : `farm:${cls}:${a[2]}:${a[3]}`;
      break;
    }
    case 'thigh':
      k = `thigh:${a[1] === 'bare' || a[1] === 'tights' ? a[1] : 'pants'}:${a[2]}:${a[3]}`;
      break;
    case 'shin':
      // shin:legs:feet:build:side
      k = `shin:${a[1] === 'bare' || a[1] === 'tights' ? a[1] : 'pants'}:${a[2] === 'boot' || a[2] === 'kneepad' ? 'boot' : a[2] === 'heel' && tier < 2 ? 'heel' : 'dress'}:${a[3]}:${a[4]}`;
      break;
    case 'foot':
      k = `foot:${a[1] === 'heel' ? 'heel' : tier < 2 && (a[1] === 'boot' || a[1] === 'kneepad') ? 'boot' : 'dress'}:${a[2]}`;
      break;
  }
  cache.set(key, k);
  return k;
}
