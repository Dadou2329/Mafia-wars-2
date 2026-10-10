// Silhouettes et tenues des personnages (New York, 2085). La forme dépend du type (CharStyle),
// les couleurs d'une ligne de palette (Outfit) propre à chaque personnage, et les liserés
// lumineux d'une couleur de néon par personnage (index dans NEON_COLORS).

import { CharKind } from '../../shared/characters';
import { Rng } from '../../shared/util';
import { pelvisOf, type ArmStyle, type FootStyle, type HatStyle, type HeadStyle, type LegStyle, type SkirtStyle, type TailStyle, type TorsoStyle } from './parts';

export interface CharStyle {
  torso: TorsoStyle;
  /** Coupe féminine du torse. */
  fem: boolean;
  head: HeadStyle;
  hat: HatStyle;
  tail: TailStyle;
  arm: ArmStyle;
  /** Brassard lumineux de faction. */
  armband: boolean;
  legs: LegStyle;
  feet: FootStyle;
  skirt: SkirtStyle | 'none';
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
  /** Robe ou jupe ; équipement (gants, sangles, masque) pour les tenues techniques. */
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

/** Bits de `Outfit.metal`. */
const MB = { vest: 1 << 4, hat: 1 << 9, accent: 1 << 11 } as const;

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

const SKINS = [0xf2d5bd, 0xf0cfae, 0xe8c2a0, 0xdcae88, 0xc8946a, 0xa87250, 0x8a5a3c, 0x6e4630, 0x553524];
const HAIRS = [0x1c1410, 0x2a1d16, 0x14100e, 0x4a3020, 0x6b4a2e, 0x8a6a3e, 0x8e3a1e, 0xc8a868, 0x6a6460];
const DARK_HAIRS = [0x1c1410, 0x2a1d16, 0x14100e, 0x14100e, 0x4a3020];

/** Couleur de cheveux naturelle plausible pour une carnation. */
function hairFor(r: Rng, skin: number): number {
  const dark = SKINS.indexOf(skin) >= 5 || ((skin >> 16) & 255) < 0xb0;
  return dark ? r.pick(DARK_HAIRS) : r.chance(0.7) ? r.pick(HAIRS.slice(0, 6)) : r.pick(HAIRS);
}
/** Teintures de 2085. */
const DYES = [0x3a7ad8, 0xd84a9a, 0x7ad8c0, 0xe4e4ea, 0x8a4ad8, 0xd83a3a];

export const DADOU_DEFAULT: Outfit = {
  skin: 0xdcb08a,
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
  eyes: 0x24160e,
  beard: 0x110d0b,
  armband: 0x9e1b22,
  dress: 0x1c1a1e,
  metal: MB.accent,
};

export const EVEN_DEFAULT: Outfit = {
  skin: 0xecc6a4,
  hair: 0x8e8b88,
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
  beard: 0xa6a39f,
  armband: 0x2a4a8a,
  dress: 0x1a1c22,
  metal: MB.accent,
};

export const DADOU_STYLE: CharStyle = {
  torso: 'longcoat',
  fem: false,
  head: 'dadou',
  hat: 'bowler',
  tail: 'longcoat',
  arm: 'dadou',
  armband: false,
  legs: 'pants',
  feet: 'dress',
  skirt: 'none',
  scale: 1.0,
};
export const EVEN_STYLE: CharStyle = {
  torso: 'frock',
  fem: false,
  head: 'even',
  hat: 'top',
  tail: 'frock',
  arm: 'even',
  armband: false,
  legs: 'pants',
  feet: 'dress',
  skirt: 'none',
  scale: 1.02,
};

/** Style de base d'un homme ou d'une femme (à compléter). */
function base(torso: TorsoStyle, head: HeadStyle, extra: Partial<CharStyle> = {}): CharStyle {
  return { torso, fem: false, head, hat: 'none', tail: 'none', arm: 'coat', armband: false, legs: 'pants', feet: 'sneaker', skirt: 'none', scale: 1, ...extra };
}

/** Manches assorties à chaque haut. */
function armFor(t: TorsoStyle): ArmStyle {
  switch (t) {
    case 'bomber':
    case 'hoodie':
    case 'leather':
    case 'crow':
    case 'crop':
      return 'cuff';
    case 'track':
      return 'stripe';
    case 'tech':
      return 'glove';
    case 'armor':
      return 'pad';
    case 'tactical':
      return 'glove';
    case 'puffer':
      return 'puffer';
    case 'tee':
    case 'dress':
      return 'tee';
    case 'workvest':
      return 'cuff';
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

// ------------------------------------------------------------------ hommes des parrains

function gangster(r: Rng, even: boolean, skin: number, hair: number): Appearance {
  const torso = r.pick<TorsoStyle>(['bomber', 'bomber', 'suit', 'hoodie', 'tech', 'leather', 'tee']);
  const head = r.pick<HeadStyle>(['short', 'stubble', 'fade', 'goatee', 'beard', 'buzz', 'shades', 'mustache', 'visor', 'mask', 'slick', 'cyber']);
  const o = even
    ? outfit({
        skin,
        hair,
        coat: r.pick([0x1d2f52, 0x22365e, 0x1a2a48, 0x3a3e48, 0x2c3240]),
        coat2: r.pick([0x8a8f98, 0x3a5a9a, 0xb0b6c0]),
        vest: 0x8a8f98,
        shirt: r.pick([0xd8dce4, 0x8a8f98, 0x1d2f52, 0x2a3040]),
        tie: r.pick([0xc9d1dc, 0x2a4a8a, 0x1a2238]),
        pants: r.pick([0x2a2e38, 0x34363e, 0x1e2230, 0x40444c]),
        shoes: r.pick([0x111216, 0x22252c, 0xd8dce4]),
        hat: r.pick([0x1d2f52, 0x2a2e38, 0x8a8f98]),
        hatband: 0x111622,
        accent: 0xc9d1dc,
        armband: 0x0c1426,
        dress: r.pick([0x1a1e26, 0x30343c]),
      })
    : outfit({
        skin,
        hair,
        coat: r.pick([0x161418, 0x1e1a1c, 0x231d1f, 0x2a2426]),
        coat2: r.pick([0x8e1b22, 0x7a1820, 0xa02028]),
        vest: 0x5a1218,
        shirt: r.pick([0x8e1b22, 0x161418, 0xe8e2d4, 0x2a2426]),
        tie: r.pick([0x161418, 0xa31e26]),
        pants: r.pick([0x18171a, 0x222024, 0x2a2628]),
        shoes: r.pick([0x0f0e0e, 0x1e1c1c, 0x8e1b22]),
        hat: r.pick([0x161418, 0x2a2426, 0x6e1820]),
        hatband: 0x8e1b22,
        accent: r.pick([0xd4a640, 0xd4a640, 0xa8acb2]),
        armband: 0x2a0a0d,
        dress: r.pick([0x1e1a1c, 0x3a1418]),
      });
  if (head === 'mask') o.dress = even ? 0x2a3040 : 0x1e1a1c;
  const style = base(torso, head, { arm: armFor(torso), armband: true, scale: r.range(0.96, 1.05) });
  if (torso === 'suit') {
    style.feet = 'dress';
    style.hat = r.chance(0.35) ? 'fedora' : 'none';
  } else if (torso === 'hoodie') {
    style.hat = r.chance(0.45) ? 'hood' : 'none';
  } else {
    style.hat = r.pick<HatStyle>(['none', 'none', 'beanie', 'cap', 'none', 'headset']);
    style.feet = r.pick<FootStyle>(['sneaker', 'boot', 'sneaker']);
    style.legs = r.chance(0.4) ? 'cargo' : 'pants';
  }
  if (style.hat === 'hood' || style.hat === 'cap' || style.hat === 'beanie') {
    if (head === 'fade') style.head = 'short';
  }
  return { style, outfit: o, neon: even ? NEON.CYAN : NEON.RED };
}

function lieutenant(r: Rng, even: boolean, skin: number, hair: number): Appearance {
  const long = r.chance(0.6);
  const head = r.pick<HeadStyle>(['shades', 'shades', 'slick', 'beard', 'goatee', 'mustache', 'cyber']);
  const o = even
    ? outfit({
        skin,
        hair,
        coat: r.pick([0x1a2440, 0x2a2e38, 0x22365e]),
        coat2: r.pick([0x8a8f98, 0x2c4a80]),
        shirt: r.pick([0xd8dce4, 0x8a8f98, 0x1a1e26]),
        tie: r.pick([0x1d3461, 0xc9d1dc]),
        pants: 0x22252e,
        shoes: 0x0e0e10,
        hat: r.pick([0x1d2f52, 0x2a2e38]),
        hatband: 0x8a8f98,
        accent: 0xc9d1dc,
        armband: 0x0c1426,
        beard: hair,
      })
    : outfit({
        skin,
        hair,
        coat: r.pick([0x141216, 0x1c1a1c]),
        coat2: r.pick([0x8e1b22, 0x161418]),
        shirt: r.pick([0x8e1b22, 0x6a1218, 0xece6da]),
        tie: r.pick([0x141216, 0xd4a640]),
        pants: 0x18161a,
        shoes: 0x0e0d0d,
        hat: 0x141216,
        hatband: 0x8e1b22,
        accent: 0xd4a640,
        armband: 0x2a0a0d,
      });
  o.metal = MB.accent;
  const style = base(long ? 'trench' : 'suit', head, {
    tail: long ? 'trench' : 'none',
    armband: true,
    feet: 'dress',
    hat: r.chance(0.5) ? 'fedora' : 'none',
    scale: r.range(1.0, 1.05),
  });
  return { style, outfit: o, neon: even ? NEON.CYAN : NEON.RED };
}

// ------------------------------------------------------------------ gangs locaux

function thug(r: Rng, gang: number, skin: number, hair: number): Appearance {
  const fem = (gang === 2 || gang === 3) && r.chance(0.3);
  switch (gang) {
    case 0: {
      // Les Lions de Lenox (Harlem) : survêtements or et noir, chaînes, casquettes
      const gold = r.chance(0.5);
      const o = outfit({
        skin: r.pick([0x8a5a3c, 0x6e4630, 0x553524, 0xa87250, 0xc8946a]),
        hair,
        coat: gold ? r.pick([0xc8901e, 0xb07a18]) : r.pick([0x1a1612, 0x5a1a14]),
        coat2: gold ? 0x1a1612 : 0xd8a028,
        tie: gold ? 0x1a1612 : 0xe8e2d4,
        shirt: r.pick([0xe8e2d4, 0x1a1612]),
        pants: r.pick([0x1a1612, 0x2a2622, 0xb07a18]),
        shoes: r.pick([0xe8e4dc, 0xd8a028, 0x1a1612]),
        hat: r.pick([0xd8a028, 0x1a1612]),
        hatband: r.pick([0x1a1612, 0xd8a028]),
        accent: 0xd4a640,
      });
      const torso = r.chance(0.7) ? 'track' : 'bomber';
      const style = base(torso, r.pick<HeadStyle>(['fade', 'goatee', 'buzz', 'beard', 'stubble', 'shades']), {
        arm: armFor(torso),
        hat: r.pick<HatStyle>(['cap', 'cap', 'none', 'beanie', 'none']),
        scale: r.range(0.98, 1.07),
      });
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
      });
      o.metal = MB.accent | MB.vest | MB.hat;
      const style = armor
        ? base('armor', r.pick<HeadStyle>(['short', 'buzz', 'stubble']), { arm: 'pad', hat: r.chance(0.6) ? 'helmet' : 'none', feet: 'boot', legs: 'cargo', scale: r.range(1.0, 1.06) })
        : base('suit', r.pick<HeadStyle>(['shades', 'shades', 'slick', 'short']), { feet: 'dress', hat: 'headset', scale: r.range(0.99, 1.05) });
      return { style, outfit: o, neon: NEON.CYAN };
    }
    case 2: {
      // Les Néons de Broadway (Times Square) : punks fluo rose et violet
      const pink = r.chance(0.5);
      const o = outfit({
        skin,
        hair: r.pick([0xff4aa8, 0x9a4aff, 0x4ae8ff, 0xe8e8f0, 0xff4aa8, 0x1c1410]),
        coat: r.pick([0x1a1420, 0x3a1a4a, 0x2a1030, 0x161418]),
        coat2: pink ? 0xd02a8a : 0x8a2ad0,
        shirt: r.pick([0xd02a8a, 0x8a2ad0, 0x161418, 0xe8e8f0]),
        tie: 0xe8e8f0,
        pants: r.pick([0x161418, 0x2a1030, 0x3a1a4a]),
        shoes: r.pick([0x161418, 0xd02a8a, 0xe8e8f0]),
        hat: r.pick([0x161418, 0x3a1a4a]),
        hatband: pink ? 0xd02a8a : 0x8a2ad0,
        accent: 0xc0c4cc,
        dress: 0x2a1030,
      });
      if (fem) {
        const torso = r.pick<TorsoStyle>(['crop', 'leather', 'tech']);
        const style = base(torso, r.pick<HeadStyle>(['womanVisor', 'womanTied', 'womanShades']), {
          fem: true,
          arm: armFor(torso),
          hat: r.pick<HatStyle>(['ponytail', 'bob', 'mohawk', 'bun']),
          feet: r.pick<FootStyle>(['boot', 'heel']),
          skirt: torso === 'crop' ? 'skirt' : 'none',
          scale: r.range(0.92, 0.98),
        });
        if (style.skirt !== 'none') o.dress = o.coat2;
        return { style, outfit: o, neon: pink ? NEON.PINK : NEON.PURPLE };
      }
      const torso = r.pick<TorsoStyle>(['leather', 'tech', 'tee', 'leather']);
      const style = base(torso, r.pick<HeadStyle>(['visor', 'buzz', 'cyber', 'buzz', 'goatee']), {
        arm: armFor(torso),
        hat: r.pick<HatStyle>(['mohawk', 'mohawk', 'none', 'beanie']),
        feet: r.pick<FootStyle>(['boot', 'sneaker']),
        scale: r.range(0.95, 1.03),
      });
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
        dress: 0x2e8a5e,
        armband: 0x1f7a52,
      });
      if (fem) {
        const style = base(r.chance(0.5) ? 'mandarin' : 'dress', r.pick<HeadStyle>(['womanTied', 'womanShades']), {
          fem: true,
          hat: r.pick<HatStyle>(['bun', 'bob', 'ponytail']),
          feet: 'heel',
          scale: r.range(0.92, 0.97),
        });
        style.arm = armFor(style.torso);
        if (style.torso === 'dress') {
          style.skirt = 'pencil';
          o.dress = 0x1f7a52;
        }
        return { style, outfit: o, neon: NEON.GREEN };
      }
      const torso = r.chance(0.7) ? 'mandarin' : 'suit';
      const style = base(torso, r.pick<HeadStyle>(['mask', 'mask', 'slick', 'goatee', 'shades', 'fade']), {
        feet: 'dress',
        hat: r.chance(0.2) ? 'flatcap' : 'none',
        scale: r.range(0.95, 1.02),
      });
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
      });
      o.metal = MB.accent | MB.vest | MB.hat;
      const helmet = r.chance(0.7);
      const style = base('armor', helmet ? 'buzz' : r.pick<HeadStyle>(['visor', 'visor', 'shades']), {
        arm: 'pad',
        hat: helmet ? 'helmet' : 'none',
        feet: 'kneepad',
        legs: 'cargo',
        scale: r.range(1.02, 1.08),
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
      });
      const torso: TorsoStyle = kindR < 0.5 ? 'workvest' : kindR < 0.8 ? 'leather' : 'puffer';
      if (torso === 'puffer') o.coat2 = shadeHex(o.coat, 0.72);
      const style = base(torso, r.pick<HeadStyle>(['beard', 'stubble', 'mustache', 'goatee', 'short', 'old']), {
        arm: armFor(torso),
        hat: r.pick<HatStyle>(['cap', 'beanie', 'none', 'cap']),
        feet: 'boot',
        legs: 'cargo',
        scale: r.range(1.0, 1.1),
      });
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
      });
      const torso: TorsoStyle = r.chance(0.7) ? 'crow' : 'hoodie';
      const style = base(torso, r.pick<HeadStyle>(['buzz', 'beard', 'stubble', 'fade', 'cyber']), {
        arm: armFor(torso),
        hat: torso === 'hoodie' ? (r.chance(0.6) ? 'hood' : 'none') : r.pick<HatStyle>(['none', 'beanie', 'mohawk', 'none']),
        feet: 'boot',
        scale: r.range(0.98, 1.06),
      });
      return { style, outfit: o, neon: NEON.RED };
    }
  }
}

// ------------------------------------------------------------------ NYPD

function police(r: Rng, skin: number, hair: number): Appearance {
  const fem = r.chance(0.25);
  const o = outfit({
    skin,
    hair,
    coat: 0x1a2238,
    coat2: 0x1a2238,
    vest: 0x10141f,
    shirt: 0xc8d0dc,
    tie: 0x10141f,
    pants: 0x161c2c,
    shoes: 0x0c0c0e,
    hat: 0x141a2c,
    hatband: 0x0c0e14,
    accent: r.chance(0.8) ? 0xd2b464 : 0xc0c6cc,
    dress: 0x0e1016,
    armband: 0x10141f,
  });
  o.metal = MB.accent;
  const helmet = r.chance(0.35);
  const style = base('tactical', fem ? 'womanTied' : r.pick<HeadStyle>(['short', 'stubble', 'mustache', 'buzz', 'short']), {
    fem,
    arm: 'glove',
    hat: helmet ? 'helmet' : 'police',
    feet: 'boot',
    legs: 'cargo',
    scale: fem ? r.range(0.95, 0.99) : r.range(1.0, 1.06),
  });
  if (fem && !helmet && r.chance(0.5)) style.hat = 'police';
  return { style, outfit: o, neon: NEON.BLUE };
}

// ------------------------------------------------------------------ rabatteurs

/** Gino le Rabatteur (Dadou) : blazer de velours cramoisi, col roulé, chaîne d'or, banane gominée. */
function gino(): Appearance {
  const o = outfit({
    skin: 0xd8a882,
    hair: 0x120e0c,
    coat: 0x7a1420,
    coat2: 0x161418,
    shirt: 0x161418,
    pants: 0x161418,
    shoes: 0x0e0d0d,
    accent: 0xe0b048,
    beard: 0x120e0c,
  });
  o.metal = MB.accent;
  return { style: base('blazer', 'gino', { arm: 'dadou', hat: 'pompadour', feet: 'dress', scale: 1.02 }), outfit: o, neon: NEON.RED };
}

/** Nina la Recruteuse (Even) : tailleur bleu marine, carré argenté, lunettes de réalité augmentée. */
function nina(): Appearance {
  const o = outfit({
    skin: 0xe8c0a0,
    hair: 0xd8dce4,
    coat: 0x1d3461,
    coat2: 0x8a8f98,
    shirt: 0xeef0f4,
    pants: 0x1a1c24,
    shoes: 0x0e0e10,
    accent: 0xc9d1dc,
    dress: 0x1a2a4a,
  });
  o.metal = MB.accent;
  return {
    style: base('blazer', 'nina', { fem: true, hat: 'bob', feet: 'heel', skirt: 'pencil', scale: 0.97 }),
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
  return { style: base('armor', 'buzz'), outfit: o, neon: faction === 1 ? NEON.RED : faction === 2 ? NEON.CYAN : NEON.AMBER };
}

// ------------------------------------------------------------------ New-Yorkais

function civilian(r: Rng, skin: number): Appearance {
  const torso = r.pick<TorsoStyle>(['trench', 'trench', 'puffer', 'puffer', 'hoodie', 'hoodie', 'suit', 'suit', 'bomber', 'tee', 'leather', 'tech']);
  const dyed = r.chance(0.12);
  const hair = dyed ? r.pick(DYES) : hairFor(r, skin);
  const bright = [0xa82a2a, 0xd8b030, 0x2a8a8a, 0x5a3a8a, 0xd8641e, 0x9aa0a8, 0x2a5aa8, 0x3a7a3a];
  const muted = [0x2a2a2e, 0x3a3e46, 0x5a5e66, 0x1e2a3a, 0x4a5236, 0x6a5a48, 0x2e3a2e, 0x5a2a2a];
  let coat: number;
  switch (torso) {
    case 'trench':
      coat = r.pick([0xb09a78, 0x8a7a5a, 0x5a5a3a, 0x1a1a1c, 0x22283a, 0x5a5e66]);
      break;
    case 'puffer':
      coat = r.pick(r.chance(0.6) ? bright : muted);
      break;
    case 'suit':
      coat = r.pick([0x2e3036, 0x232a3a, 0x4a4e56, 0x8a7a62, 0x1a1a1e]);
      break;
    default:
      coat = r.chance(0.3) ? r.pick(bright) : r.pick(muted);
  }
  const o = outfit({
    skin,
    hair,
    coat,
    coat2: torso === 'trench' || torso === 'suit' ? coat : r.pick([0x1a1a1e, 0xe8e4dc, ...muted]),
    shirt: torso === 'suit' ? r.pick([0xe8e4dc, 0xc8d8e8, 0xd8d0c0]) : r.pick([0xe8e4dc, 0x1a1a1e, ...bright, ...muted]),
    tie: r.pick([0x5a2a2a, 0x2a3a5a, 0x3a3a2a, 0x1a1a1e, 0xa82a2a, 0xe8e4dc]),
    pants: r.pick([0x2a3448, 0x3e3a34, 0x26262a, 0x4a4a4a, 0x5a5040, 0x1a1a1e]),
    shoes: r.pick([0x161616, 0xe8e4dc, 0x3a2a1a, 0x2a2a2e, ...bright]),
    hat: r.pick([0x1a1a1e, 0x3a3e46, ...bright]),
    hatband: r.pick([0x1a1a1e, 0xe8e4dc]),
    accent: r.pick([0xa8acb2, 0xd4a640]),
    dress: r.pick([0x1a1a1e, 0x2a2a2e]),
  });
  if (torso === 'trench' || torso === 'suit') o.coat2 = shadeHex(coat, 0.8);
  if (torso === 'puffer' || torso === 'hoodie') o.coat2 = shadeHex(coat, 0.72);
  const head = r.pick<HeadStyle>(['short', 'slick', 'buzz', 'fade', 'stubble', 'beard', 'goatee', 'mustache', 'old', 'shades', 'cyber', 'short', 'stubble', 'fade']);
  if (head === 'old') o.hair = o.beard = r.pick([0x8a8680, 0xb8b4ac, 0xd8d4cc]);
  const style = base(torso, head, {
    arm: armFor(torso),
    tail: torso === 'trench' ? 'trench' : 'none',
    feet: torso === 'suit' || torso === 'trench' ? r.pick<FootStyle>(['dress', 'dress', 'sneaker']) : r.pick<FootStyle>(['sneaker', 'sneaker', 'boot']),
    legs: r.chance(0.25) ? 'cargo' : 'pants',
    scale: r.range(0.94, 1.05),
  });
  const hr = r.next();
  style.hat = torso === 'hoodie' && hr < 0.35 ? 'hood' : hr < 0.55 ? 'none' : hr < 0.67 ? 'beanie' : hr < 0.79 ? 'cap' : hr < 0.9 ? 'headset' : torso === 'suit' || torso === 'trench' ? 'fedora' : 'none';
  if ((style.hat === 'cap' || style.hat === 'beanie' || style.hat === 'hood') && style.head === 'fade') style.head = 'short';
  return { style, outfit: o, neon: r.int(0, 7) };
}

function civilianF(r: Rng, skin: number): Appearance {
  const torso = r.pick<TorsoStyle>(['trench', 'trench', 'puffer', 'puffer', 'suit', 'hoodie', 'crop', 'crop', 'dress', 'leather', 'tee']);
  const dyed = r.chance(0.18);
  const hair = dyed ? r.pick(DYES) : hairFor(r, skin);
  const bright = [0xb02a3a, 0xd8b030, 0x2a8a8a, 0x6a3a9a, 0xd8641e, 0xc8ccd4, 0x2a5aa8, 0xd84a8a, 0x3a8a5a];
  const muted = [0x2a2a2e, 0x3a3e46, 0x5a5e66, 0x1e2a3a, 0x6a5a48, 0x5a2a3a, 0xb09a78, 0x8a7a6a];
  let coat: number;
  switch (torso) {
    case 'trench':
      coat = r.pick([0xb09a78, 0xc8b490, 0x1a1a1c, 0x5a2a3a, 0x22283a, 0x8a3a2a]);
      break;
    case 'suit':
      coat = r.pick([0x2e3036, 0x232a3a, 0xd8d4cc, 0x8a7a62, 0x5a2a3a, 0x1a1a1e]);
      break;
    default:
      coat = r.chance(0.45) ? r.pick(bright) : r.pick(muted);
  }
  const o = outfit({
    skin,
    hair,
    coat,
    coat2: r.pick([0x1a1a1e, 0xe8e4dc, ...muted]),
    shirt: r.pick([0xe8e4dc, 0x1a1a1e, 0xd8c8b8, ...bright]),
    tie: r.pick([0x1a1a1e, 0xe8e4dc]),
    pants: r.pick([0x1a1a1e, 0x2a3448, 0x3a3e46, 0x5a5040, 0x26262a]),
    shoes: r.pick([0x161616, 0xe8e4dc, 0x3a2a1a, 0x5a2a3a]),
    hat: r.pick([0x1a1a1e, 0xe8e4dc, ...bright]),
    hatband: r.pick([0x1a1a1e, 0xe8e4dc, 0xd4a640]),
    accent: r.pick([0xd4a640, 0xc8ccd4]),
    dress: r.pick([...bright, ...muted]),
    eyes: r.pick([0x2a1a12, 0x34506e, 0x3a4a2a]),
  });
  if (torso === 'trench' || torso === 'suit') o.coat2 = shadeHex(coat, 0.8);
  if (torso === 'puffer' || torso === 'hoodie') o.coat2 = shadeHex(coat, 0.72);
  const hairdo = r.pick<HatStyle>(['long', 'long', 'ponytail', 'bun', 'bob', 'afro', 'none', 'beanie', 'cap', 'headset', 'long']);
  const tied = hairdo === 'ponytail' || hairdo === 'bun' || hairdo === 'bob' || hairdo === 'afro';
  let head: HeadStyle = tied ? 'womanTied' : 'woman';
  const fx = r.next();
  if (fx < 0.12) head = 'womanShades';
  else if (fx < 0.18) head = 'womanVisor';
  if (hairdo === 'afro') o.hair = r.pick([0x1c1410, 0x2a1d16, 0x4a3020]);
  const skirtR = torso === 'dress' ? (r.chance(0.5) ? 'pencil' : 'skirt') : torso === 'crop' || torso === 'suit' ? (r.chance(0.5) ? r.pick<SkirtStyle>(['skirt', 'pencil']) : 'none') : 'none';
  const style = base(torso, head, {
    fem: true,
    arm: armFor(torso),
    tail: torso === 'trench' ? 'trench' : 'none',
    hat: hairdo,
    skirt: skirtR,
    feet: skirtR !== 'none' ? r.pick<FootStyle>(['heel', 'heel', 'boot']) : r.pick<FootStyle>(['sneaker', 'heel', 'boot', 'sneaker']),
    scale: r.range(0.9, 0.98),
  });
  if (skirtR !== 'none') {
    if (torso !== 'dress') o.dress = r.pick([0x1a1a1e, 0x2a3448, 0x5a2a3a, 0x3a3e46, ...bright]);
    o.pants = r.pick([0x1a1a1e, 0x2a2228, skin]);
  }
  return { style, outfit: o, neon: r.int(0, 7) };
}

function shadeHex(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function applyCustom(o: Outfit, c: BossCustom): void {
  if (c.coat !== undefined) o.coat = c.coat;
  if (c.vest !== undefined) o.vest = c.vest;
  if (c.tie !== undefined) o.tie = c.tie;
  if (c.hatband !== undefined) o.hatband = c.hatband;
  if (c.accent !== undefined) o.accent = c.accent;
}

/** Clés des membres d'une silhouette (géométries partagées par toutes les instances). */
export interface PartKeys {
  torso: string;
  pelvis: string;
  head: string;
  hat: string | null;
  upperArm: string;
  forearm: string;
  thigh: string;
  shin: string;
  tailL: string | null;
  tailR: string | null;
  skirt: string | null;
}

export function partKeys(s: CharStyle): PartKeys {
  return {
    torso: `torso:${s.torso}${s.fem ? ':f' : ''}`,
    pelvis: `pelvis:${s.skirt !== 'none' ? 'skirt' : pelvisOf(s.torso)}`,
    head: `head:${s.head}`,
    hat: s.hat !== 'none' ? `hat:${s.hat}` : null,
    upperArm: `upperArm:${s.arm}${s.armband ? ':band' : ''}`,
    forearm: `forearm:${s.arm}`,
    thigh: `thigh:${s.legs}`,
    shin: `shin:${s.feet}`,
    tailL: s.tail !== 'none' ? `tailL:${s.tail}` : null,
    tailR: s.tail !== 'none' ? `tailR:${s.tail}` : null,
    skirt: s.skirt !== 'none' ? `skirt:${s.skirt}` : null,
  };
}

/** Clé unique de silhouette (pour regrouper les instances par géométrie). */
export function styleParts(s: CharStyle): string[] {
  return Object.values(partKeys(s)).filter((k): k is string => k !== null);
}
