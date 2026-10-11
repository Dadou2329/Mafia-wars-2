// Conseils contextuels (facultatifs, désactivables dans le salon) et rappel permanent du but
// de la partie. Ce n'est PAS une quête : aucune étape imposée, aucun objectif scripté —
// le joueur fait ce qu'il veut dans la ville ; on lui souffle seulement ce qui est possible.

import { BOSS_NAME, DE_BOSS, HQ_CAPTURE_MIN_DISTRICTS, tierDef } from '../../shared/constants';
import { BUILDINGS, DISTRICTS, RESIDENCES } from '../../shared/city/plan';
import { RECRUITER_NAME } from '../../shared/characters';
import { IMPLANTS, IMPLANT_BY_ID, SLOTS } from '../../shared/implants';
import type { PrivateState } from '../../shared/protocol';
import { actionKey, type ActionId } from '../input/bindings';
import { settings } from '../settings';
import { controlFor, nearestSpot, stationSpots } from './cyberFormat';
import type { ClientEnt } from './entities';
import type { GameClient } from './GameClient';
import { aNom, leNom } from '../../shared/french';
import { formatMoney } from '../../shared/util';

/**
 * Première installation d'un implant à commande : comment s'en servir (k = sa touche).
 * Les implants purement automatiques n'ont pas de conseil.
 */
const IMPLANT_TIP: Record<string, (k: string, a: (x: ActionId) => string) => string> = {
  grappin: (k) => `Appuyez sur ${k} pour lancer le grappin : visez une façade, il vous hisse jusqu’aux toits.`,
  pistoletBras: (k) => `${k} : sortir le pistolet d’avant-bras, clic gauche pour tirer — ${k} à nouveau pour le rentrer.`,
  lame: (k) => `${k} : sortir la lame Mantis, clic gauche pour frapper.`,
  poing: (k) => `${k} : sortir le poing hydraulique ; maintenez le clic pour charger un coup.`,
  fouet: (k) => `${k} : déployer le fouet monofilament, clic gauche pour balayer large.`,
  bouclier: (k) => `Maintenez ${k} pour lever le bouclier énergétique face aux balles.`,
  repulseur: (k) => `${k} : décharge du bras répulseur — les ennemis devant vous sont projetés.`,
  choc: (k) => `${k} : arc électrique du bras Tesla — ennemis, caméras et tourelles grillés.`,
  outils: (k) => `Bras tactique : piratages accélérés ; ${k} pour pirater un terminal visé (à distance dès le niveau 3).`,
  roquettes: (k) => `${k} : salve de micro-roquettes guidées sur la cible visée.`,
  grip: () => 'Grip magnétique : vous vous hissez sur des rebords bien plus hauts ; plus tard, sautez contre un mur pour l’escalader.',
  doubleSaut: (_k, a) => `Propulseurs de double saut : appuyez sur ${a('jump')} une seconde fois en plein vol.`,
  bond: (_k, a) => `Bond chargé : maintenez ${a('crouch')} pour comprimer les vérins, puis ${a('jump')} pour bondir loin devant.`,
  sprint: (_k, a) => `Sprint cybernétique : maintenez ${a('sprint')} — l’énergie des jambes s’affiche en bas de l’écran.`,
  esquive: (k) => `${k} : esquive éclair dans la direction de votre déplacement.`,
  glissade: (_k, a) => `Glissade améliorée : accroupissez-vous (${a('crouch')}) en sprintant.`,
  courseMurale: () => 'Course murale : sautez contre un mur en sprintant pour courir le long de la paroi.',
  sautMural: () => 'Saut mural : sautez contre une paroi pour rebondir plus haut.',
  surcharge: (k) => `${k} : surcharge défensive — dégâts subis fortement réduits quelques secondes.`,
  scanner: (k) => `${k} : impulsion de scan — caméras, terminaux et ennemis alentour révélés.`,
  thermique: (k) => `${k} : vision thermique (la même touche passe d’une vision à l’autre, puis revient à la normale).`,
  nocturne: (k) => `${k} : vision nocturne (la même touche passe d’une vision à l’autre, puis revient à la normale).`,
  camouflage: (k) => `${k} : camouflage optique — presque invisible ; tirer vous révèle.`,
  reflexes: (k) => `${k} : accélérateur de réflexes — pour vous, le temps semble ralentir.`,
  liaisonDrone: (k) => `${k} : appelez votre drone de combat, il vous escorte et tire sur vos ennemis.`,
};

export class Tips {
  private gc: GameClient;
  private t = 0;
  private shown = new Set<string>();
  private captures = 0;
  private lastGoal = '';
  private goalAcc = 0;
  private cyberAcc = 0;

  constructor(gc: GameClient) {
    this.gc = gc;
  }

  private get on(): boolean {
    return this.gc.settings.tips !== false;
  }

  private key(a: 'interact' | 'map' | 'wheel' | 'phone' | 'view' | 'reload' | 'grenade'): string {
    return actionKey(settings.bindings, a);
  }

  private tip(id: string, text: string, delay = 0): void {
    if (!this.on || this.shown.has(id)) return;
    this.shown.add(id);
    setTimeout(() => this.gc.hud.notify(text, 'info', 8000), delay);
  }

  /** Rappel du but de la partie (toujours affiché, comme un tableau de score). */
  private updateGoal(): void {
    const gc = this.gc;
    const other = gc.you === 'dadou' ? 'even' : 'dadou';
    const mine = gc.pub.territories[gc.you];
    const hq = BUILDINGS[gc.pub.hq[other]];
    const text =
      mine >= HQ_CAPTURE_MIN_DISTRICTS
        ? `Assaut final possible : prenez ${leNom(hq.name)}, le QG ${DE_BOSS[other]} !`
        : `Contrôlez ${HQ_CAPTURE_MIN_DISTRICTS} quartiers sur ${DISTRICTS.length} (vous : ${mine}), puis prenez le QG ${DE_BOSS[other]}.`;
    if (text !== this.lastGoal) {
      this.lastGoal = text;
      gc.hud.setObjective(text, false);
    }
  }

  update(dt: number): void {
    if (!this.gc.isPlaced) return;
    this.t += dt;
    this.goalAcc -= dt;
    if (this.goalAcc <= 0) {
      this.goalAcc = 1;
      this.updateGoal();
    }
    const gc = this.gc;
    if (this.t > 4) this.tip('recruit', `Votre planque est modeste, mais c’est un début. Parlez à ${RECRUITER_NAME[gc.you]} (${this.key('interact')}) pour recruter des gangsters.`);
    if (this.t > 22) this.tip('desk', `Votre bureau ouvre la carte stratégique (${this.key('interact')} devant la table de commandement) : lieutenants, attaques, ascension.`);
    if (this.t > 50) this.tip('wheel', `${this.key('wheel')} près de vos hommes : ordres rapides (« Suivez-moi », « Attaquez »…). ${this.key('view')} : vue à la première ou à la troisième personne.`);
    if (this.t > 80) this.tip('phone', `${this.key('phone')} : votre téléphone — alertes, taxi volant vers le QG, véhicules et ordres rapides.`);
    if (this.t > 140) this.tip('free', 'Aucune mission imposée : braquages, convois, conquête… New York est à vous, faites-en ce que vous voulez.');
    if (this.t > 200) this.tip('grenade', `${this.key('grenade')} : lancer une grenade. Son souffle disperse les défenseurs… et fait voler les vitrines en éclats.`);
    if (this.t > 270) this.tip('heist', `Banques, bourse, casino : piratez leur terminal de sécurité (${this.key('interact')}) pour couper caméras et tourelles, puis videz le coffre avant l’arrivée du NYPD.`);
    if (this.t > 340) this.tip('convoys', 'Téléphone → Convois : envoyez vos camions blindés, escortez-les, ou interceptez ceux de votre rival. Téléphone → Immobilier : emménagez plus haut, jusqu’à la tour.');
    this.cyberAcc -= dt;
    if (this.cyberAcc <= 0) {
      this.cyberAcc = 1;
      this.cyberTips();
    }
  }

  /** Implants : l'écran CYBERNÉTIQUE, puis la première clinique croisée. */
  private cyberTips(): void {
    const gc = this.gc;
    const b = settings.bindings;
    if (this.t > 110 && Object.keys(gc.priv.cyber?.owned ?? {}).length === 0)
      this.tip('cyber-key', `${actionKey(b, 'cyber')} : écran CYBERNÉTIQUE — ${IMPLANTS.length} implants (grappin, lames, esquive, visions…). On les achète et on les pose dans une clinique ou à la station de votre QG.`);
    if (!gc.priv.cyber) return;
    const p = gc.player.pos;
    const near = nearestSpot(
      stationSpots(gc.world, gc.pub, gc.priv, gc.you).filter((s) => s.clinic),
      p.x,
      p.z,
    );
    if (near && near.dist < 14 && Math.abs(near.spot.y - p.y) < 6)
      this.tip('cyber-clinic', `${near.spot.name} : une clinique cybernétique. Au comptoir, ${actionKey(b, 'interact')} (ou ${actionKey(b, 'cyber')}) ouvre l’écran CYBERNÉTIQUE : achats, améliorations et pose de vos implants.`);
  }

  onKill(ent: ClientEnt): void {
    void ent;
    this.tip('first-kill', 'Les défenseurs abattus ne reviennent pas : videz le bâtiment, puis menez ses objectifs (repères holographiques) pour en prendre le contrôle.', 800);
  }

  onCapture(bid: number): void {
    if (this.gc.pub.buildings[bid]?.owner !== this.gc.myFaction) return;
    this.captures++;
    if (this.captures === 1) this.tip('first-capture', 'Premier bâtiment ! Possédez tous les bâtiments clés ★ d’un quartier pour le contrôler et toucher un bonus de revenus.', 1500);
  }

  onPriv(p: PrivateState): void {
    const gc = this.gc;
    // logement suivant abordable : on le signale une fois
    const next = RESIDENCES[gc.you][p.tier];
    if (next && p.money >= next.price && gc.pub.territories[gc.you] >= tierDef(p.tier + 1).districts) {
      this.tip(`move-${p.tier}`, `Vous pouvez emménager ${aNom(next.name)} (${formatMoney(next.price)}) : ouvrez la carte stratégique et sélectionnez ⌂. Plus d’hommes, plus de lieutenants, plus de revenus !`);
    }
    if (p.men >= p.maxMen) this.tip(`full-${p.tier}`, `Votre ${tierDef(p.tier).name.toLowerCase()} est pleine (${p.maxMen} hommes) : un QG plus grand en accueillera davantage.`);
    void BOSS_NAME;
    this.cyberPriv(p);
  }

  /** Implants : station à portée, premier achat, première pose de chaque implant à commande. */
  private cyberPriv(p: PrivateState): void {
    const c = p.cyber;
    if (!c) return;
    const b = settings.bindings;
    if (c.station) this.tip('cyber-station', `Station cybernétique à portée : ${actionKey(b, 'cyber')} pour acheter, améliorer et poser vos implants ici.`);
    if (Object.keys(c.owned).length > 0)
      this.tip('cyber-first', `Premier implant ! Il se pose tout seul s’il reste un emplacement libre. ${actionKey(b, 'cyber')} : écran CYBERNÉTIQUE pour l’améliorer, l’échanger ou enregistrer une configuration.`, 1500);
    // un conseil par implant à commande, la première fois qu'il est posé (trois au plus à la fois)
    let n = 0;
    for (const s of SLOTS) {
      const id = c.equip[s.id];
      const make = id ? IMPLANT_TIP[id] : undefined;
      if (!id || !make || this.shown.has(`implant-${id}`) || !IMPLANT_BY_ID[id]) continue;
      if (n >= 3) {
        this.shown.add(`implant-${id}`);
        continue;
      }
      const ctl = controlFor(c.equip, id, s.id);
      this.tip(`implant-${id}`, make(ctl.key ?? '', (a) => actionKey(b, a)), 2500 + n * 3500);
      n++;
    }
  }

  onFire(): void {
    this.tip('aim', 'Clic droit pour viser : vos tirs sont bien plus précis.', 1200);
  }

  onDesk(): void {
    this.tip('map', 'Cliquez sur un bâtiment ou un quartier, puis choisissez un ordre et un lieutenant : vos hommes partent vraiment dans la ville.', 600);
  }
}
