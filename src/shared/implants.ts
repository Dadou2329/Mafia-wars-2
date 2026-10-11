// Implants cybernétiques (partagé client/serveur) : catalogue, emplacements, niveaux.
//
// Principe : acheter un implant, l'installer (clinique ou station du QG), s'en servir,
// l'améliorer. Chaque implant occupe un emplacement de sa catégorie ; ses niveaux portent les
// noms des gammes (Standard, Avancé, Militaire, Prototype, Légendaire) à partir de sa gamme de
// départ. Les paramètres `p` de chaque niveau sont lus par la simulation (serveur) et par le
// client (déplacements, effets) : un seul endroit pour l'équilibrage.

export type ImplantCat = 'bras' | 'jambes' | 'torse' | 'colonne' | 'yeux' | 'peau' | 'neural';

export type SlotId = 'brasG' | 'brasD' | 'jambes1' | 'jambes2' | 'jambes3' | 'torse1' | 'torse2' | 'colonne' | 'yeux1' | 'yeux2' | 'peau' | 'neural1' | 'neural2';

export interface SlotDef {
  id: SlotId;
  cat: ImplantCat;
  label: string;
}

export const SLOTS: SlotDef[] = [
  { id: 'brasG', cat: 'bras', label: 'Bras gauche' },
  { id: 'brasD', cat: 'bras', label: 'Bras droit' },
  { id: 'jambes1', cat: 'jambes', label: 'Jambes — module 1' },
  { id: 'jambes2', cat: 'jambes', label: 'Jambes — module 2' },
  { id: 'jambes3', cat: 'jambes', label: 'Jambes — module 3' },
  { id: 'torse1', cat: 'torse', label: 'Torse — module 1' },
  { id: 'torse2', cat: 'torse', label: 'Torse — module 2' },
  { id: 'colonne', cat: 'colonne', label: 'Colonne vertébrale' },
  { id: 'yeux1', cat: 'yeux', label: 'Yeux — module 1' },
  { id: 'yeux2', cat: 'yeux', label: 'Yeux — module 2' },
  { id: 'peau', cat: 'peau', label: 'Peau' },
  { id: 'neural1', cat: 'neural', label: 'Système neuronal — module 1' },
  { id: 'neural2', cat: 'neural', label: 'Système neuronal — module 2' },
];

export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s])) as Record<SlotId, SlotDef>;

export const CAT_LABEL: Record<ImplantCat, string> = {
  bras: 'Bras',
  jambes: 'Jambes',
  torse: 'Torse',
  colonne: 'Colonne vertébrale',
  yeux: 'Yeux',
  peau: 'Peau',
  neural: 'Système neuronal',
};

/** Gammes d'équipement (un niveau d'implant porte le nom de sa gamme). */
export const QUALITY = ['Standard', 'Avancé', 'Militaire', 'Prototype', 'Légendaire'] as const;
/** Couleurs des gammes (interface). */
export const QUALITY_COLOR = [0x9aa4b2, 0x4fd8ff, 0x7dff6a, 0xc77dff, 0xffc23d];

/**
 * passive : effet permanent une fois installé ;
 * active  : une touche déclenche une capacité (délai de recharge) ;
 * toggle  : une touche active / coupe un mode (visions) ;
 * arme    : arme intégrée au bras, sortie par la touche du bras puis utilisée au clic.
 */
export type ImplantKind = 'passive' | 'active' | 'toggle' | 'arme';

/**
 * Commande : 'bras' (touche du bras où il est installé), 'esquive', 'capacite' (touches de
 * capacité 1 à 3, attribuées dans l'ordre des emplacements), 'vision' (touche de vision),
 * 'saut' (pendant le saut), 'accroupi' (accroupi + saut), 'auto' (automatique).
 */
export type ImplantTrigger = 'bras' | 'esquive' | 'capacite' | 'vision' | 'saut' | 'accroupi' | 'auto';

export interface ImplantLevel {
  price: number;
  /** Ce que le niveau apporte (français, une phrase). */
  desc: string;
  /** Paramètres de jeu (voir chaque implant). */
  p: Record<string, number>;
}

export interface ImplantDef {
  id: string;
  name: string;
  cat: ImplantCat;
  kind: ImplantKind;
  trigger: ImplantTrigger;
  /** Gamme du premier niveau (indice dans QUALITY). */
  q0: number;
  /** Description générale (français). */
  summary: string;
  levels: ImplantLevel[];
  /** Couleur d'accent (lueurs, interface). */
  color: number;
}

// Aide à la saisie : niveaux successifs.
function L(price: number, desc: string, p: Record<string, number>): ImplantLevel {
  return { price, desc, p };
}

export const IMPLANTS: ImplantDef[] = [
  // =================================================================================== BRAS
  {
    id: 'grappin',
    name: 'Grappin cybernétique',
    cat: 'bras',
    kind: 'active',
    trigger: 'bras',
    q0: 0,
    color: 0x4fd8ff,
    summary: 'Un grappin à câble monofilament jaillit de l’avant-bras, s’accroche aux façades et vous hisse jusqu’aux toits.',
    // range : portée (m) ; pull : vitesse de traction (m/s) ; cd : recharge (s) ; steer : contrôle en vol (0..1) ;
    // chain : nouveau tir possible en l'air (0/1) ; boost : élan conservé au lâcher (×)
    levels: [
      L(650, 'Grappin de base : 24 m de portée.', { range: 24, pull: 15, cd: 6, steer: 0.15, chain: 0, boost: 1 }),
      L(1400, 'Portée 30 m, traction plus rapide.', { range: 30, pull: 18, cd: 5, steer: 0.25, chain: 0, boost: 1 }),
      L(2600, 'Recharge réduite, meilleur contrôle en vol.', { range: 34, pull: 20, cd: 3.5, steer: 0.5, chain: 0, boost: 1.1 }),
      L(4800, 'Manœuvres aériennes : un nouveau tir est possible sans toucher le sol.', { range: 40, pull: 22, cd: 2.5, steer: 0.7, chain: 1, boost: 1.2 }),
      L(8500, 'Configuration haute performance : 46 m, traction fulgurante, élan conservé.', { range: 46, pull: 25, cd: 1.6, steer: 0.85, chain: 1, boost: 1.45 }),
    ],
  },
  {
    id: 'pistoletBras',
    name: 'Pistolet d’avant-bras Viper',
    cat: 'bras',
    kind: 'arme',
    trigger: 'bras',
    q0: 0,
    color: 0xff4d6d,
    summary: 'Un pistolet dissimulé dans l’avant-bras : le blindage s’ouvre, le canon sort, on tire sans arme en main. Munitions recyclées à l’infini.',
    // dmg : dégâts ; mag : chargeur ; cd : cadence (s) ; spread : dispersion ; reload : rechargement (s) ; burn : brûlure (dégâts/s pendant 3 s)
    levels: [
      L(500, 'Canon de base : 22 dégâts, chargeur de 8.', { dmg: 22, mag: 8, cd: 0.3, spread: 0.016, reload: 1.6, burn: 0 }),
      L(1200, 'Dégâts accrus, chargeur de 10.', { dmg: 26, mag: 10, cd: 0.27, spread: 0.013, reload: 1.4, burn: 0 }),
      L(2400, 'Canon rayé : plus précis, plus rapide.', { dmg: 30, mag: 12, cd: 0.22, spread: 0.009, reload: 1.2, burn: 0 }),
      L(4400, 'Chargeur de 16, rechargement éclair.', { dmg: 33, mag: 16, cd: 0.2, spread: 0.007, reload: 0.9, burn: 0 }),
      L(8000, 'Balles incendiaires : les cibles brûlent (8 dégâts/s pendant 3 s).', { dmg: 36, mag: 16, cd: 0.18, spread: 0.006, reload: 0.8, burn: 8 }),
    ],
  },
  {
    id: 'lame',
    name: 'Lame d’avant-bras Mantis',
    cat: 'bras',
    kind: 'arme',
    trigger: 'bras',
    q0: 0,
    color: 0xff6a3d,
    summary: 'Une lame rétractable jaillit du poignet. Clic : frappe ; clic droit (niveau 3) : fente foudroyante vers la cible.',
    // dmg ; cd ; reach : allonge (m) ; lunge : distance de fente (m, 0 = aucune) ; pierce : part des dégâts qui ignore les protections (0..1)
    levels: [
      L(450, 'Lame de base : 40 dégâts.', { dmg: 40, cd: 0.5, reach: 2.1, lunge: 0, pierce: 0 }),
      L(1100, 'Frappes plus rapides.', { dmg: 46, cd: 0.42, reach: 2.2, lunge: 0, pierce: 0 }),
      L(2300, 'Fente : clic droit pour bondir de 6 m sur la cible.', { dmg: 52, cd: 0.38, reach: 2.3, lunge: 6, pierce: 0 }),
      L(4300, 'Enchaînements plus rapides, fente de 8 m.', { dmg: 58, cd: 0.32, reach: 2.4, lunge: 8, pierce: 0.2 }),
      L(7800, 'Lame thermique : la moitié des dégâts traverse les blindages.', { dmg: 66, cd: 0.3, reach: 2.5, lunge: 9, pierce: 0.5 }),
    ],
  },
  {
    id: 'poing',
    name: 'Poing hydraulique',
    cat: 'bras',
    kind: 'arme',
    trigger: 'bras',
    q0: 0,
    color: 0xffb13d,
    summary: 'Un poing mécanique à vérins : coups dévastateurs, ennemis projetés. Maintenez le clic pour charger un coup. Défonce les portes renforcées (niveau 3).',
    // dmg ; cd ; knock : projection (m/s) ; charge : dégâts ×(1+charge) au coup chargé ; breach : défonce les portes renforcées (0/1) ;
    // slam : rayon de l'onde de choc à l'atterrissage (m, 0 = aucune) ; stun : étourdissement (s)
    levels: [
      L(500, 'Coup de poing hydraulique : 35 dégâts, projette l’ennemi.', { dmg: 35, cd: 0.6, knock: 7, charge: 0, breach: 0, slam: 0, stun: 0 }),
      L(1200, 'Coup chargé : maintenez le clic (dégâts ×2).', { dmg: 40, cd: 0.55, knock: 8, charge: 1, breach: 0, slam: 0, stun: 0 }),
      L(2500, 'Défonce les portes et barricades renforcées.', { dmg: 46, cd: 0.5, knock: 9, charge: 1.3, breach: 1, slam: 0, stun: 0 }),
      L(4600, 'Onde de choc : en retombant d’au moins 3 m, vous frappez le sol.', { dmg: 52, cd: 0.48, knock: 10, charge: 1.6, breach: 1, slam: 4.5, stun: 0 }),
      L(8200, 'Coups étourdissants (1,2 s), onde de choc élargie.', { dmg: 60, cd: 0.45, knock: 12, charge: 2, breach: 1, slam: 6, stun: 1.2 }),
    ],
  },
  {
    id: 'bouclier',
    name: 'Bouclier énergétique',
    cat: 'bras',
    kind: 'active',
    trigger: 'bras',
    q0: 1,
    color: 0x6ad8ff,
    summary: 'Un projecteur d’avant-bras déploie un bouclier d’énergie face à vous. Maintenez la touche du bras : il encaisse les balles jusqu’à saturation.',
    // absorb : dégâts absorbés ; dur : durée max (s) ; cd : recharge (s) ; arc : couverture (degrés, 360 = bulle)
    levels: [
      L(1300, 'Bouclier frontal : 140 dégâts absorbés, 3 s.', { absorb: 140, dur: 3, cd: 16, arc: 120 }),
      L(2700, 'Plus solide et plus durable.', { absorb: 200, dur: 4, cd: 14, arc: 130 }),
      L(4900, 'Recharge accélérée, couverture élargie.', { absorb: 270, dur: 5, cd: 11, arc: 160 }),
      L(8800, 'Bulle : le bouclier vous protège de tous côtés.', { absorb: 340, dur: 6, cd: 10, arc: 360 }),
    ],
  },
  {
    id: 'repulseur',
    name: 'Bras répulseur',
    cat: 'bras',
    kind: 'active',
    trigger: 'bras',
    q0: 1,
    color: 0xb3a1ff,
    summary: 'Une décharge cinétique à courte portée balaie un cône devant vous et projette les ennemis. Idéal dans les couloirs.',
    // range : portée (m) ; arc : ouverture (degrés) ; dmg ; force : projection (m/s) ; cd ; stun (s) ; glass : brise les vitres (0/1)
    levels: [
      L(1200, 'Cône de 6 m, projette les ennemis.', { range: 6, arc: 70, dmg: 12, force: 11, cd: 11, stun: 0, glass: 0 }),
      L(2600, 'Portée 7,5 m, recharge réduite.', { range: 7.5, arc: 75, dmg: 18, force: 13, cd: 9, stun: 0, glass: 1 }),
      L(4800, 'Les ennemis projetés restent étourdis 1,5 s.', { range: 9, arc: 80, dmg: 24, force: 15, cd: 8, stun: 1.5, glass: 1 }),
      L(8600, 'Déflagration : 11 m, recharge éclair.', { range: 11, arc: 90, dmg: 32, force: 18, cd: 6, stun: 2, glass: 1 }),
    ],
  },
  {
    id: 'choc',
    name: 'Bras électrique Tesla',
    cat: 'bras',
    kind: 'active',
    trigger: 'bras',
    q0: 1,
    color: 0x7df9ff,
    summary: 'Une décharge électrique saute d’ennemi en ennemi et grille les caméras, tourelles et drones à proximité.',
    // range : portée (m) ; chain : cibles ; dmg ; cd ; emp : coupure des machines (s)
    levels: [
      L(1300, 'Arc électrique : 2 cibles, 6 m.', { range: 6, chain: 2, dmg: 30, cd: 12, emp: 6 }),
      L(2700, '3 cibles, décharge plus forte.', { range: 7, chain: 3, dmg: 38, cd: 10, emp: 8 }),
      L(5000, '4 cibles, les machines restent coupées 12 s.', { range: 8, chain: 4, dmg: 46, cd: 8.5, emp: 12 }),
      L(9000, 'Tempête : 6 cibles, 10 m.', { range: 10, chain: 6, dmg: 56, cd: 7, emp: 15 }),
    ],
  },
  {
    id: 'outils',
    name: 'Bras tactique Passe-partout',
    cat: 'bras',
    kind: 'active',
    trigger: 'bras',
    q0: 0,
    color: 0x8cff9a,
    summary: 'Une interface électronique intégrée : piratage accéléré, portes de sécurité forcées, piratage à distance (touche du bras).',
    // hack : vitesse de piratage (×) ; doors : ouvre les portes à badge (0/1) ; remote : piratage à distance (m, 0 = contact) ; cams : coupe une caméra instantanément (0/1)
    levels: [
      L(400, 'Piratage deux fois plus rapide.', { hack: 2, doors: 0, remote: 0, cams: 0 }),
      L(1000, 'Force les portes à badge sans badge.', { hack: 2.5, doors: 1, remote: 0, cams: 0 }),
      L(2200, 'Piratage à distance (12 m) : visez un terminal.', { hack: 3, doors: 1, remote: 12, cams: 0 }),
      L(4200, 'Coupe une caméra d’un geste, piratage à 20 m.', { hack: 3.5, doors: 1, remote: 20, cams: 1 }),
      L(7400, 'Piratage quasi instantané, à 30 m.', { hack: 6, doors: 1, remote: 30, cams: 1 }),
    ],
  },
  {
    id: 'grip',
    name: 'Grip magnétique',
    cat: 'bras',
    kind: 'passive',
    trigger: 'auto',
    q0: 1,
    color: 0xc0c8d8,
    summary: 'Des paumes électro-aimantées : vous vous hissez sur des rebords bien plus hauts et escaladez les murs en sautant contre eux.',
    // mantle : hauteur de rebord franchissable (m) ; climb : hauteur d'escalade d'un mur (m, 0 = aucune) ; speed : vitesse d'escalade (×)
    levels: [
      L(900, 'Agrippe les rebords jusqu’à 2 m.', { mantle: 2, climb: 0, speed: 1 }),
      L(2000, 'Escalade : sautez contre un mur pour grimper de 3 m.', { mantle: 2.4, climb: 3, speed: 1.2 }),
      L(4200, 'Escalade de 5 m, plus rapide.', { mantle: 2.8, climb: 5, speed: 1.5 }),
    ],
  },
  {
    id: 'roquettes',
    name: 'Lance-micro-roquettes Hornet',
    cat: 'bras',
    kind: 'active',
    trigger: 'bras',
    q0: 2,
    color: 0xff8a3d,
    summary: 'Le bras se déploie en lanceur : une salve de micro-roquettes à tête chercheuse fond sur la cible visée.',
    // n : roquettes par salve ; dmg : dégâts par roquette ; radius : rayon d'explosion (m) ; cd ; homing : guidage (0..1)
    levels: [
      L(3000, 'Salve de 2 roquettes guidées.', { n: 2, dmg: 42, radius: 2.6, cd: 14, homing: 0.6 }),
      L(5600, 'Salve de 3, guidage affiné.', { n: 3, dmg: 46, radius: 2.8, cd: 12, homing: 0.75 }),
      L(9500, 'Salve de 4, recharge réduite.', { n: 4, dmg: 50, radius: 3, cd: 9, homing: 0.9 }),
    ],
  },
  {
    id: 'fouet',
    name: 'Fouet monofilament',
    cat: 'bras',
    kind: 'arme',
    trigger: 'bras',
    q0: 1,
    color: 0xff4dd2,
    summary: 'Un filament tranchant se déroule du doigt : il balaie un large arc et frappe plusieurs ennemis d’un coup.',
    // dmg ; cd ; reach (m) ; arc (degrés) ; pull : attire la cible vers vous (m/s, 0 = non)
    levels: [
      L(1100, 'Balayage de 4,5 m sur 100°.', { dmg: 28, cd: 0.7, reach: 4.5, arc: 100, pull: 0 }),
      L(2400, 'Plus tranchant et plus rapide.', { dmg: 34, cd: 0.6, reach: 5, arc: 110, pull: 0 }),
      L(4600, 'Le filament agrippe la cible et l’attire vers vous.', { dmg: 40, cd: 0.55, reach: 5.5, arc: 120, pull: 9 }),
      L(8400, 'Arc de 150°, 6 m d’allonge.', { dmg: 48, cd: 0.5, reach: 6, arc: 150, pull: 11 }),
    ],
  },
  // ================================================================================= JAMBES
  {
    id: 'saut',
    name: 'Pistons de saut',
    cat: 'jambes',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x7dff6a,
    summary: 'Des vérins dans les mollets : vous sautez bien plus haut.',
    // jump : vitesse de saut (×)
    levels: [
      L(400, 'Sauts 30 % plus hauts.', { jump: 1.3 }),
      L(1000, 'Sauts 55 % plus hauts.', { jump: 1.55 }),
      L(2200, 'Sauts 80 % plus hauts.', { jump: 1.8 }),
      L(4300, 'Sauts deux fois plus hauts.', { jump: 2.05 }),
    ],
  },
  {
    id: 'doubleSaut',
    name: 'Propulseurs de double saut',
    cat: 'jambes',
    kind: 'passive',
    trigger: 'saut',
    q0: 1,
    color: 0x6ad8ff,
    summary: 'Des micro-propulseurs aux talons : sautez une seconde fois en plein vol.',
    // air : sauts en l'air ; power : puissance du saut en l'air (×) ; push : poussée horizontale (m/s)
    levels: [
      L(1100, 'Un saut supplémentaire en l’air.', { air: 1, power: 0.85, push: 0 }),
      L(2500, 'Saut en l’air plus puissant, avec élan.', { air: 1, power: 1, push: 2.5 }),
      L(5200, 'Deux sauts en l’air.', { air: 2, power: 1, push: 3.5 }),
    ],
  },
  {
    id: 'bond',
    name: 'Bond chargé',
    cat: 'jambes',
    kind: 'active',
    trigger: 'accroupi',
    q0: 1,
    color: 0xb4ff3d,
    summary: 'Accroupissez-vous pour comprimer les vérins, puis sautez : vous êtes projeté loin devant vous.',
    // dist : distance du bond (m) ; charge : temps de charge complet (s) ; cd (s)
    levels: [
      L(1000, 'Bond de 12 m.', { dist: 12, charge: 0.8, cd: 8 }),
      L(2300, 'Bond de 16 m, charge plus rapide.', { dist: 16, charge: 0.65, cd: 7 }),
      L(4600, 'Bond de 20 m.', { dist: 20, charge: 0.5, cd: 5.5 }),
      L(8000, 'Bond de 25 m, presque sans recharge.', { dist: 25, charge: 0.4, cd: 3.5 }),
    ],
  },
  {
    id: 'sprint',
    name: 'Sprint cybernétique',
    cat: 'jambes',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xffe14d,
    summary: 'Des muscles synthétiques : en sprintant, vous filez bien plus vite tant que l’énergie des jambes le permet.',
    // speed : vitesse de sprint (m/s) ; energy : durée du sprint renforcé (s) ; regen : recharge (s pour plein)
    levels: [
      L(450, 'Sprint à 8 m/s pendant 4 s.', { speed: 8, energy: 4, regen: 6 }),
      L(1100, 'Sprint à 8,8 m/s pendant 5 s.', { speed: 8.8, energy: 5, regen: 5.5 }),
      L(2300, 'Sprint à 9,6 m/s pendant 6,5 s.', { speed: 9.6, energy: 6.5, regen: 5 }),
      L(4400, 'Sprint à 10,4 m/s pendant 8 s.', { speed: 10.4, energy: 8, regen: 4.5 }),
      L(7600, 'Sprint à 11,2 m/s pendant 11 s.', { speed: 11.2, energy: 11, regen: 4 }),
    ],
  },
  {
    id: 'esquive',
    name: 'Propulseurs d’esquive',
    cat: 'jambes',
    kind: 'active',
    trigger: 'esquive',
    q0: 0,
    color: 0x3dd8ff,
    summary: 'Une poussée foudroyante dans la direction de votre déplacement, au sol comme en l’air (touche d’esquive).',
    // dist : distance (m) ; charges ; cd : recharge d'une charge (s) ; air : utilisable en l'air (0/1)
    levels: [
      L(550, 'Esquive de 6 m au sol.', { dist: 6, charges: 1, cd: 3.5, air: 0 }),
      L(1300, 'Esquive aussi en plein vol.', { dist: 6.5, charges: 1, cd: 3, air: 1 }),
      L(2600, 'Deux charges d’esquive.', { dist: 7, charges: 2, cd: 2.8, air: 1 }),
      L(4800, 'Esquives plus longues, recharge rapide.', { dist: 8, charges: 2, cd: 2.2, air: 1 }),
      L(8200, 'Trois charges : vous êtes insaisissable.', { dist: 8.5, charges: 3, cd: 1.8, air: 1 }),
    ],
  },
  {
    id: 'glissade',
    name: 'Glissade améliorée',
    cat: 'jambes',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xff9a3d,
    summary: 'Des patins renforcés sur les tibias : glissades plus rapides et plus longues (accroupissez-vous en sprintant).',
    // boost : vitesse en début de glissade (×) ; time : durée (s) ; aim : précision de tir en glissant (0..1) ; jump : bonus de saut en sortie de glissade (×)
    levels: [
      L(350, 'Glissades 30 % plus rapides.', { boost: 1.3, time: 0.9, aim: 0, jump: 1 }),
      L(900, 'Tir précis en glissant.', { boost: 1.45, time: 1.1, aim: 1, jump: 1 }),
      L(2000, 'Saut en sortie de glissade : élan conservé et saut plus haut.', { boost: 1.6, time: 1.3, aim: 1, jump: 1.2 }),
    ],
  },
  {
    id: 'amortisseurs',
    name: 'Amortisseurs',
    cat: 'jambes',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x9ad0ff,
    summary: 'Des amortisseurs dans les genoux : les chutes ne vous blessent plus (dans une certaine limite).',
    // safe : hauteur de chute sans dégâts (m) ; quake : rayon de l'atterrissage sismique (m, 0 = non) ; quakeDmg
    levels: [
      L(350, 'Aucun dégât de chute jusqu’à 12 m.', { safe: 12, quake: 0, quakeDmg: 0 }),
      L(900, 'Aucun dégât jusqu’à 20 m.', { safe: 20, quake: 0, quakeDmg: 0 }),
      L(2000, 'Aucun dégât de chute.', { safe: 999, quake: 0, quakeDmg: 0 }),
      L(4400, 'Atterrissage sismique : retomber de plus de 6 m frappe les ennemis proches.', { safe: 999, quake: 4.5, quakeDmg: 35 }),
    ],
  },
  {
    id: 'courseMurale',
    name: 'Module de course murale',
    cat: 'jambes',
    kind: 'passive',
    trigger: 'auto',
    q0: 1,
    color: 0x3dffb4,
    summary: 'Sautez contre un mur en sprintant : vous courez le long de la paroi quelques instants.',
    // time : durée (s) ; speed : vitesse (m/s) ; grav : gravité pendant la course (×)
    levels: [
      L(1000, 'Course murale de 1,2 s.', { time: 1.2, speed: 7.5, grav: 0.25 }),
      L(2300, 'Course murale de 1,8 s, plus rapide.', { time: 1.8, speed: 8.5, grav: 0.15 }),
      L(4700, 'Course murale de 2,6 s.', { time: 2.6, speed: 9.5, grav: 0.08 }),
    ],
  },
  {
    id: 'sautMural',
    name: 'Module de saut mural',
    cat: 'jambes',
    kind: 'passive',
    trigger: 'saut',
    q0: 1,
    color: 0x3dff7d,
    summary: 'Prenez appui sur les murs : sautez contre une paroi pour rebondir plus haut.',
    // jumps : rebonds avant de toucher le sol ; power (×)
    levels: [
      L(900, 'Un rebond mural.', { jumps: 1, power: 1 }),
      L(2100, 'Deux rebonds muraux.', { jumps: 2, power: 1.1 }),
      L(4300, 'Trois rebonds, plus puissants.', { jumps: 3, power: 1.2 }),
    ],
  },
  {
    id: 'silence',
    name: 'Semelles silencieuses',
    cat: 'jambes',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x8a9bb0,
    summary: 'Amortisseurs acoustiques : vos pas ne s’entendent plus, gardes et caméras vous repèrent moins vite.',
    // hear : portée d'écoute des gardes (×) ; cam : temps de détection des caméras (×) ; steps : volume des pas (×)
    levels: [
      L(300, 'Pas presque inaudibles.', { hear: 0.6, cam: 1.3, steps: 0.25 }),
      L(800, 'Les gardes vous entendent à peine.', { hear: 0.35, cam: 1.7, steps: 0.1 }),
      L(1800, 'Silence total, caméras trois fois plus lentes.', { hear: 0.1, cam: 3, steps: 0 }),
    ],
  },
  // ================================================================================== TORSE
  {
    id: 'blindage',
    name: 'Plaques de blindage internes',
    cat: 'torse',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xa0a8b8,
    summary: 'Des plaques de céramique sous la cage thoracique : tous les dégâts sont réduits.',
    // reduce : réduction des dégâts (0..1)
    levels: [
      L(500, 'Dégâts −8 %.', { reduce: 0.08 }),
      L(1200, 'Dégâts −12 %.', { reduce: 0.12 }),
      L(2500, 'Dégâts −16 %.', { reduce: 0.16 }),
      L(4700, 'Dégâts −20 %.', { reduce: 0.2 }),
      L(8400, 'Dégâts −24 %.', { reduce: 0.24 }),
    ],
  },
  {
    id: 'secondSouffle',
    name: 'Cœur de secours',
    cat: 'torse',
    kind: 'passive',
    trigger: 'auto',
    q0: 1,
    color: 0xff3d5a,
    summary: 'Un cœur artificiel de réserve : au bord de la mort, il vous rend invulnérable quelques instants et vous soigne.',
    // hp : seuil de déclenchement (part de la vie) ; inv : invulnérabilité (s) ; heal : soin (part de la vie) ; cd (s)
    levels: [
      L(1400, 'Sous 25 % de vie : 2 s d’invulnérabilité, +20 % de vie.', { hp: 0.25, inv: 2, heal: 0.2, cd: 150 }),
      L(3000, 'Invulnérable 2,5 s, +30 % de vie.', { hp: 0.25, inv: 2.5, heal: 0.3, cd: 120 }),
      L(6000, 'Invulnérable 3 s, +40 % de vie, recharge 90 s.', { hp: 0.3, inv: 3, heal: 0.4, cd: 90 }),
    ],
  },
  {
    id: 'accumulateur',
    name: 'Accumulateur cardiaque',
    cat: 'torse',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xffe14d,
    summary: 'Une batterie biologique alimente tous vos implants : capacités rechargées plus vite, sprint plus long.',
    // cdr : réduction des recharges (0..1) ; energy : énergie de sprint (×)
    levels: [
      L(600, 'Recharges −8 %, sprint renforcé +30 %.', { cdr: 0.08, energy: 1.3 }),
      L(1500, 'Recharges −14 %, sprint +50 %.', { cdr: 0.14, energy: 1.5 }),
      L(3200, 'Recharges −20 %, sprint +70 %.', { cdr: 0.2, energy: 1.7 }),
    ],
  },
  {
    id: 'surcharge',
    name: 'Surcharge défensive',
    cat: 'torse',
    kind: 'active',
    trigger: 'capacite',
    q0: 1,
    color: 0xff9a3d,
    summary: 'Les plaques du torse se chargent d’énergie : pendant quelques secondes, vous encaissez bien moins de dégâts et rien ne vous fait reculer.',
    // reduce : réduction des dégâts (0..1) ; dur (s) ; cd (s)
    levels: [
      L(1300, '−50 % de dégâts pendant 4 s.', { reduce: 0.5, dur: 4, cd: 40 }),
      L(2800, '−60 % de dégâts pendant 5 s.', { reduce: 0.6, dur: 5, cd: 35 }),
      L(5600, '−70 % de dégâts pendant 6 s.', { reduce: 0.7, dur: 6, cd: 30 }),
    ],
  },
  {
    id: 'antichoc',
    name: 'Absorbeur d’explosions',
    cat: 'torse',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xffb13d,
    summary: 'Un châssis antichoc : grenades, roquettes et explosions vous font bien moins de mal.',
    // reduce : réduction des dégâts d'explosion (0..1)
    levels: [
      L(450, 'Explosions −35 %.', { reduce: 0.35 }),
      L(1100, 'Explosions −55 %.', { reduce: 0.55 }),
      L(2400, 'Explosions −75 %.', { reduce: 0.75 }),
    ],
  },
  {
    id: 'nanobots',
    name: 'Nanobots réparateurs',
    cat: 'torse',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x7dff6a,
    summary: 'Des nanomachines réparent vos tissus : vous récupérez votre vie hors des combats, et même pendant au niveau 3.',
    // regen : vie par seconde hors combat ; combat : vie par seconde en combat ; delay : délai après une blessure (s)
    levels: [
      L(500, '+2 PV/s hors combat.', { regen: 2, combat: 0, delay: 5 }),
      L(1200, '+3 PV/s hors combat, plus tôt.', { regen: 3, combat: 0, delay: 4 }),
      L(2600, '+4 PV/s hors combat, +1 PV/s en combat.', { regen: 4, combat: 1, delay: 3.5 }),
      L(5000, '+6 PV/s hors combat, +1,5 PV/s en combat.', { regen: 6, combat: 1.5, delay: 3 }),
    ],
  },
  // ================================================================================ COLONNE
  {
    id: 'gyro',
    name: 'Colonne gyroscopique',
    cat: 'colonne',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x6ad8ff,
    summary: 'Des gyroscopes le long de la colonne : vous dirigez vos sauts en l’air et pouvez planer un instant en visant.',
    // air : contrôle aérien (×) ; hover : gravité en visant en l'air (×, 1 = aucune) ; hoverTime (s)
    levels: [
      L(600, 'Contrôle en l’air ×1,6.', { air: 1.6, hover: 1, hoverTime: 0 }),
      L(1500, 'Visez en l’air pour planer 1,2 s.', { air: 2, hover: 0.35, hoverTime: 1.2 }),
      L(3200, 'Contrôle ×2,5, plané de 2 s.', { air: 2.5, hover: 0.25, hoverTime: 2 }),
    ],
  },
  {
    id: 'reflexesMoteurs',
    name: 'Réflexes moteurs',
    cat: 'colonne',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xffe14d,
    summary: 'Des fibres motrices accélérées : démarrages, virages et réceptions instantanés, changement d’arme plus rapide.',
    // accel : accélération (×) ; land : ralentissement à la réception (×, 0 = aucun) ; swap : changement d'arme (×)
    levels: [
      L(550, 'Accélération ×1,4.', { accel: 1.4, land: 0.6, swap: 1.2 }),
      L(1300, 'Accélération ×1,7, réceptions plus franches.', { accel: 1.7, land: 0.3, swap: 1.5 }),
      L(2900, 'Accélération ×2, aucune perte de vitesse à la réception.', { accel: 2, land: 0, swap: 2 }),
    ],
  },
  {
    id: 'vertebres',
    name: 'Vertèbres élastiques',
    cat: 'colonne',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xb4ff3d,
    summary: 'Une colonne souple : on se déplace vite accroupi, on se hisse plus vite et on roule à la réception des grandes chutes.',
    // crouch : vitesse accroupi (×) ; mantle : vitesse pour se hisser (×) ; roll : roulade (0/1) qui divise les dégâts de chute par deux
    levels: [
      L(450, 'Déplacement accroupi ×1,5.', { crouch: 1.5, mantle: 1.3, roll: 0 }),
      L(1100, 'Se hisse deux fois plus vite.', { crouch: 1.7, mantle: 2, roll: 0 }),
      L(2400, 'Roulade : dégâts de chute divisés par deux.', { crouch: 2, mantle: 2.3, roll: 1 }),
    ],
  },
  {
    id: 'treuil',
    name: 'Treuil spinal',
    cat: 'colonne',
    kind: 'passive',
    trigger: 'auto',
    q0: 1,
    color: 0x4fd8ff,
    summary: 'Un treuil ancré à la colonne renforce le grappin : traction plus rapide, portée accrue ; au niveau 3, le grappin attire les ennemis.',
    // pull : vitesse de traction (×) ; range : portée (×) ; yank : attire un ennemi visé (0/1)
    levels: [
      L(1000, 'Traction du grappin +20 %.', { pull: 1.2, range: 1.1, yank: 0 }),
      L(2300, 'Traction +35 %, portée +15 %.', { pull: 1.35, range: 1.15, yank: 0 }),
      L(4700, 'Grappin de traction : visez un ennemi pour l’attirer vers vous.', { pull: 1.5, range: 1.2, yank: 1 }),
    ],
  },
  // =================================================================================== YEUX
  {
    id: 'zoom',
    name: 'Optique télescopique',
    cat: 'yeux',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x4fd8ff,
    summary: 'Des lentilles à focale variable : en visant, vous zoomez avec n’importe quelle arme.',
    // zoom : grossissement en visant (×) ; range : télémètre (0/1) ; steady : dispersion en visant (×)
    levels: [
      L(350, 'Zoom ×1,6 en visant.', { zoom: 1.6, range: 0, steady: 1 }),
      L(900, 'Zoom ×2,2 et télémètre.', { zoom: 2.2, range: 1, steady: 0.9 }),
      L(2000, 'Zoom ×3, visée stabilisée.', { zoom: 3, range: 1, steady: 0.8 }),
      L(4000, 'Zoom ×4.', { zoom: 4, range: 1, steady: 0.7 }),
    ],
  },
  {
    id: 'thermique',
    name: 'Vision thermique',
    cat: 'yeux',
    kind: 'toggle',
    trigger: 'vision',
    q0: 1,
    color: 0xff6a3d,
    summary: 'Touche de vision : les corps chauds ressortent en couleurs vives, même dans le noir ; au niveau 3, à travers les murs proches.',
    // walls : vision à travers les murs (m, 0 = non)
    levels: [
      L(1100, 'Vision thermique.', { walls: 0 }),
      L(2400, 'Silhouettes chaudes à travers les murs jusqu’à 10 m.', { walls: 10 }),
      L(4800, 'À travers les murs jusqu’à 20 m.', { walls: 20 }),
    ],
  },
  {
    id: 'nocturne',
    name: 'Vision nocturne',
    cat: 'yeux',
    kind: 'toggle',
    trigger: 'vision',
    q0: 0,
    color: 0x7dff6a,
    summary: 'Touche de vision : amplification de lumière, on voit clair dans les pièces les plus sombres.',
    // gain : amplification ; outline : contours des ennemis (0/1)
    levels: [
      L(300, 'Amplification de lumière.', { gain: 3, outline: 0 }),
      L(800, 'Amplification plus nette, sans éblouissement.', { gain: 4, outline: 0 }),
      L(1800, 'Les ennemis sont détourés.', { gain: 4.5, outline: 1 }),
    ],
  },
  {
    id: 'marqueur',
    name: 'Marqueur de cibles',
    cat: 'yeux',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xff4d6d,
    summary: 'Les ennemis dans votre champ de vision sont soulignés et leur vie affichée ; plus tard, les marques persistent et guident vos hommes.',
    // range (m) ; persist : marque persistante derrière un obstacle (s) ; squad : bonus de dégâts de vos hommes sur les cibles marquées (0..1)
    levels: [
      L(450, 'Ennemis soulignés jusqu’à 40 m.', { range: 40, persist: 0, squad: 0 }),
      L(1100, 'Marques persistantes 4 s derrière les obstacles.', { range: 55, persist: 4, squad: 0 }),
      L(2500, 'Vos hommes concentrent le feu : +12 % de dégâts sur les cibles marquées.', { range: 70, persist: 6, squad: 0.12 }),
    ],
  },
  {
    id: 'analyseur',
    name: 'Analyseur tactique',
    cat: 'yeux',
    kind: 'passive',
    trigger: 'auto',
    q0: 1,
    color: 0xffe14d,
    summary: 'Un coprocesseur optique identifie la cible visée (type, arme, vie) et révèle ses points faibles : tirs à la tête plus meurtriers.',
    // head : bonus de dégâts à la tête (0..1) ; implants : révèle les implants du parrain adverse (0/1)
    levels: [
      L(900, 'Identification, tirs à la tête +15 %.', { head: 0.15, implants: 0 }),
      L(2000, 'Tirs à la tête +25 %.', { head: 0.25, implants: 0 }),
      L(4000, 'Tirs à la tête +35 %, implants du parrain adverse révélés.', { head: 0.35, implants: 1 }),
    ],
  },
  {
    id: 'scanner',
    name: 'Scanner de sécurité',
    cat: 'yeux',
    kind: 'active',
    trigger: 'capacite',
    q0: 0,
    color: 0x8cff9a,
    summary: 'Une impulsion de scan révèle caméras, tourelles, terminaux, portes de sécurité, objectifs de conquête et ennemis alentour.',
    // range (m) ; dur (s) ; cd (s)
    levels: [
      L(400, 'Impulsion de 25 m, 6 s.', { range: 25, dur: 6, cd: 20 }),
      L(1000, '35 m, 8 s.', { range: 35, dur: 8, cd: 16 }),
      L(2300, '50 m, 10 s, recharge 12 s.', { range: 50, dur: 10, cd: 12 }),
    ],
  },
  // =================================================================================== PEAU
  {
    id: 'derme',
    name: 'Derme renforcé',
    cat: 'peau',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xc0c8d8,
    summary: 'Une peau synthétique tissée de fibres balistiques : les balles vous blessent moins.',
    // reduce : réduction des dégâts des balles (0..1)
    levels: [
      L(400, 'Balles −10 %.', { reduce: 0.1 }),
      L(1000, 'Balles −15 %.', { reduce: 0.15 }),
      L(2200, 'Balles −20 %.', { reduce: 0.2 }),
      L(4400, 'Balles −25 %.', { reduce: 0.25 }),
    ],
  },
  {
    id: 'camouflage',
    name: 'Camouflage optique',
    cat: 'peau',
    kind: 'active',
    trigger: 'capacite',
    q0: 2,
    color: 0x9affff,
    summary: 'Des cellules réfractives courbent la lumière : vous devenez presque invisible. Les gardes vous perdent ; tirer vous révèle.',
    // dur (s) ; cd (s) ; keep : tir sans se révéler pendant ce délai (s)
    levels: [
      L(2600, 'Invisible 5 s.', { dur: 5, cd: 45, keep: 0 }),
      L(4800, 'Invisible 7 s, recharge 40 s.', { dur: 7, cd: 40, keep: 0 }),
      L(8000, 'Invisible 9 s : le premier tir ne vous révèle pas.', { dur: 9, cd: 32, keep: 1 }),
    ],
  },
  {
    id: 'isolant',
    name: 'Épiderme isolant',
    cat: 'peau',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x6ad8ff,
    summary: 'Une peau isolante et ignifugée : immunité aux décharges électriques, brûlures réduites puis supprimées.',
    // shock : immunité électrique (0/1) ; burn : réduction des brûlures (0..1) ; stun : réduction des étourdissements (0..1)
    levels: [
      L(350, 'Immunisé aux décharges électriques.', { shock: 1, burn: 0.5, stun: 0.3 }),
      L(900, 'Brûlures −75 %.', { shock: 1, burn: 0.75, stun: 0.6 }),
      L(2000, 'Aucune brûlure, aucun étourdissement.', { shock: 1, burn: 1, stun: 1 }),
    ],
  },
  {
    id: 'gel',
    name: 'Gel balistique',
    cat: 'peau',
    kind: 'passive',
    trigger: 'auto',
    q0: 1,
    color: 0xd28cff,
    summary: 'Un gel non newtonien sous la peau durcit aux impacts : coups de lame, de poing et plombs de fusil à pompe amortis.',
    // melee : réduction des dégâts au corps à corps (0..1) ; pellets : réduction des plombs (0..1)
    levels: [
      L(900, 'Corps à corps −30 %, plombs −20 %.', { melee: 0.3, pellets: 0.2 }),
      L(2000, 'Corps à corps −45 %, plombs −30 %.', { melee: 0.45, pellets: 0.3 }),
      L(4200, 'Corps à corps −60 %, plombs −40 %.', { melee: 0.6, pellets: 0.4 }),
    ],
  },
  // ================================================================================= NEURAL
  {
    id: 'visee',
    name: 'Assistance de visée',
    cat: 'neural',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0xff4d6d,
    summary: 'Une puce de visée stabilise vos mains : moins de recul, moins de dispersion, et un léger aimantage vers la cible.',
    // recoil : recul (×) ; spread : dispersion (×) ; magnet : aimantage de visée (0..1)
    levels: [
      L(500, 'Recul −20 %, dispersion −10 %.', { recoil: 0.8, spread: 0.9, magnet: 0.1 }),
      L(1200, 'Recul −35 %, dispersion −20 %.', { recoil: 0.65, spread: 0.8, magnet: 0.18 }),
      L(2700, 'Recul −50 %, dispersion −30 %.', { recoil: 0.5, spread: 0.7, magnet: 0.25 }),
    ],
  },
  {
    id: 'reflexes',
    name: 'Accélérateur de réflexes',
    cat: 'neural',
    kind: 'active',
    trigger: 'capacite',
    q0: 2,
    color: 0xffd23d,
    summary: 'Le cerveau passe en surrégime : pour vous, le temps semble ralentir. Cadence de tir, rechargement et vitesse augmentés, dégâts subis réduits.',
    // dur (s) ; cd (s) ; fire : cadence (×) ; speed : vitesse de course (×) ; reduce : réduction des dégâts (0..1)
    levels: [
      L(2400, 'Surrégime de 5 s.', { dur: 5, cd: 50, fire: 1.4, speed: 1.15, reduce: 0.15 }),
      L(4600, 'Surrégime de 6,5 s.', { dur: 6.5, cd: 45, fire: 1.5, speed: 1.2, reduce: 0.2 }),
      L(8200, 'Surrégime de 8 s, recharge 38 s.', { dur: 8, cd: 38, fire: 1.6, speed: 1.25, reduce: 0.25 }),
    ],
  },
  {
    id: 'conscience',
    name: 'Conscience tactique',
    cat: 'neural',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x8cff9a,
    summary: 'Un radar neuronal : les ennemis proches apparaissent sur la mini-carte et sur les bords de l’écran ; vous sentez quand on vous vise.',
    // range (m) ; period : intervalle entre deux impulsions (s) ; warn : alerte quand un ennemi vous vise (0/1) ; projectiles : grenades et roquettes signalées (0/1)
    levels: [
      L(500, 'Ennemis détectés à 30 m toutes les 4 s.', { range: 30, period: 4, warn: 0, projectiles: 0 }),
      L(1200, '40 m, alerte quand on vous vise.', { range: 40, period: 3, warn: 1, projectiles: 0 }),
      L(2600, '50 m, grenades et roquettes signalées.', { range: 50, period: 2, warn: 1, projectiles: 1 }),
    ],
  },
  {
    id: 'coprocesseur',
    name: 'Coprocesseur de combat',
    cat: 'neural',
    kind: 'passive',
    trigger: 'auto',
    q0: 0,
    color: 0x4fd8ff,
    summary: 'Commutation instantanée : capacités rechargées plus vite, armes et implants de bras sortis en un éclair.',
    // cdr : réduction des recharges (0..1) ; swap : changement d'arme (×) ; deploy : sortie des armes de bras (×)
    levels: [
      L(650, 'Recharges −10 %, armes sorties plus vite.', { cdr: 0.1, swap: 1.5, deploy: 1.5 }),
      L(1500, 'Recharges −15 %.', { cdr: 0.15, swap: 2, deploy: 2 }),
      L(3300, 'Recharges −20 %, commutation instantanée.', { cdr: 0.2, swap: 3, deploy: 4 }),
    ],
  },
  {
    id: 'liaisonDrone',
    name: 'Liaison drone neuronale',
    cat: 'neural',
    kind: 'active',
    trigger: 'capacite',
    q0: 1,
    color: 0xb3a1ff,
    summary: 'Appelez un drone de combat qui vous escorte et tire sur vos ennemis. Vos drones de reconnaissance restent aussi plus longtemps en vol.',
    // dmg : dégâts par tir ; dur : durée (s) ; cd (s) ; recon : durée des drones de reconnaissance (×) ; mark : le drone marque les ennemis (0/1)
    levels: [
      L(1600, 'Drone de combat pendant 20 s.', { dmg: 8, dur: 20, cd: 60, recon: 1.5, mark: 0 }),
      L(3400, 'Drone plus puissant, 25 s.', { dmg: 11, dur: 25, cd: 50, recon: 1.75, mark: 0 }),
      L(6600, 'Le drone marque les ennemis, 30 s.', { dmg: 14, dur: 30, cd: 42, recon: 2, mark: 1 }),
    ],
  },
  {
    id: 'commandement',
    name: 'Commandement neuronal',
    cat: 'neural',
    kind: 'passive',
    trigger: 'auto',
    q0: 1,
    color: 0xffc23d,
    summary: 'Une liaison neuronale avec vos hommes : près de vous, ils tirent mieux et tiennent mieux. Vos ordres rapides portent plus loin.',
    // range (m) ; dmg : bonus de dégâts des hommes proches (0..1) ; armor : réduction des dégâts subis (0..1) ; orders : portée des ordres rapides (×)
    levels: [
      L(1200, 'Hommes à 25 m : +10 % de dégâts.', { range: 25, dmg: 0.1, armor: 0.05, orders: 1.5 }),
      L(2600, 'Hommes à 35 m : +15 % de dégâts, −10 % de dégâts subis.', { range: 35, dmg: 0.15, armor: 0.1, orders: 2 }),
      L(5200, 'Hommes à 45 m : +20 % de dégâts, −15 % de dégâts subis.', { range: 45, dmg: 0.2, armor: 0.15, orders: 3 }),
    ],
  },
];

export const IMPLANT_BY_ID: Record<string, ImplantDef> = Object.fromEntries(IMPLANTS.map((d) => [d.id, d]));

/** Nombre total d'implants (catalogue). */
export const IMPLANT_COUNT = IMPLANTS.length;

/** Nom de la gamme d'un niveau (1 à n) d'un implant. */
export function qualityOf(def: ImplantDef, level: number): string {
  return QUALITY[Math.min(QUALITY.length - 1, def.q0 + Math.max(1, level) - 1)];
}

/** Indice de gamme (0..4) d'un niveau. */
export function qualityIndex(def: ImplantDef, level: number): number {
  return Math.min(QUALITY.length - 1, def.q0 + Math.max(1, level) - 1);
}

/** Paramètres d'un implant à un niveau (1 à n). */
export function implantParams(id: string, level: number): Record<string, number> {
  const d = IMPLANT_BY_ID[id];
  if (!d || level <= 0) return {};
  return d.levels[Math.min(d.levels.length, level) - 1].p;
}

/** Emplacements compatibles avec un implant. */
export function slotsFor(def: ImplantDef): SlotId[] {
  return SLOTS.filter((s) => s.cat === def.cat).map((s) => s.id);
}

// ------------------------------------------------------------------------------ état d'un parrain

/** Configuration : implant installé (ou null) dans chaque emplacement. */
export type Equipment = Record<SlotId, string | null>;

export function emptyEquipment(): Equipment {
  return Object.fromEntries(SLOTS.map((s) => [s.id, null])) as Equipment;
}

/** Configurations enregistrées (combat, mobilité, infiltration…). */
export const LOADOUT_COUNT = 3;
export const LOADOUT_NAMES = ['Combat', 'Mobilité', 'Infiltration'];

/**
 * Apparence publique des implants d'un personnage (pour les autres joueurs) :
 * « emplacement=identifiant:niveau » pour chaque implant installé.
 */
export function cyberLook(equip: Equipment, owned: Record<string, number>): string[] {
  const out: string[] = [];
  for (const s of SLOTS) {
    const id = equip[s.id];
    if (id) out.push(`${s.id}=${id}:${owned[id] ?? 1}`);
  }
  return out;
}

/** Lecture d'une apparence publique. */
export function parseCyberLook(look: string[] | undefined): { slot: SlotId; id: string; level: number }[] {
  if (!look) return [];
  const out: { slot: SlotId; id: string; level: number }[] = [];
  for (const s of look) {
    const m = /^([a-zA-Z0-9]+)=([a-zA-Z]+):(\d+)$/.exec(s);
    if (m && SLOT_BY_ID[m[1] as SlotId] && IMPLANT_BY_ID[m[2]]) out.push({ slot: m[1] as SlotId, id: m[2], level: Number(m[3]) });
  }
  return out;
}

// ------------------------------------------------------------------------- états visibles (bits)

/** Bits d'état cybernétique transmis dans les instantanés (SnapEntity.fx). */
export const CFX = {
  /** Grappin tiré / accroché (le câble est visible). */
  GRAPPLE: 1,
  /** Bouclier énergétique levé. */
  SHIELD: 2,
  /** Camouflage optique. */
  CAMO: 4,
  /** Arme de bras sortie (gauche). */
  ARM_L: 8,
  /** Arme de bras sortie (droit). */
  ARM_R: 16,
  /** Coup chargé (poing hydraulique). */
  CHARGE: 32,
  /** Accélérateur de réflexes actif. */
  REFLEX: 64,
  /** Surcharge défensive active. */
  OVERCHARGE: 128,
  /** Sprint cybernétique (jambes lumineuses, traînée). */
  SPRINT: 256,
  /** Cœur de secours (invulnérabilité). */
  SECOND_WIND: 512,
  /** Impulsion de scan en cours. */
  SCAN: 1024,
  /** Brûlure (balles incendiaires). */
  BURN: 2048,
  /** Étourdi. */
  STUN: 4096,
  /** Électrocuté (décharge). */
  SHOCK: 8192,
} as const;
