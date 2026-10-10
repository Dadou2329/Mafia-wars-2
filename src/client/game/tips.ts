// Conseils contextuels (facultatifs, désactivables dans le salon) et rappel permanent du but
// de la partie. Ce n'est PAS une quête : aucune étape imposée, aucun objectif scripté —
// le joueur fait ce qu'il veut dans la ville ; on lui souffle seulement ce qui est possible.

import { BOSS_NAME, DE_BOSS, HQ_CAPTURE_MIN_DISTRICTS, tierDef } from '../../shared/constants';
import { BUILDINGS, RESIDENCES } from '../../shared/city/plan';
import { RECRUITER_NAME } from '../../shared/characters';
import type { PrivateState } from '../../shared/protocol';
import { actionKey } from '../input/bindings';
import { settings } from '../settings';
import type { ClientEnt } from './entities';
import type { GameClient } from './GameClient';
import { aNom, leNom } from '../../shared/french';
import { formatMoney } from '../../shared/util';

export class Tips {
  private gc: GameClient;
  private t = 0;
  private shown = new Set<string>();
  private captures = 0;
  private lastGoal = '';
  private goalAcc = 0;

  constructor(gc: GameClient) {
    this.gc = gc;
  }

  private get on(): boolean {
    return this.gc.settings.tips !== false;
  }

  private key(a: 'interact' | 'map' | 'wheel' | 'phone' | 'view' | 'reload'): string {
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
        : `Contrôlez ${HQ_CAPTURE_MIN_DISTRICTS} quartiers sur 7 (vous : ${mine}), puis prenez le QG ${DE_BOSS[other]}.`;
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
  }

  onKill(ent: ClientEnt): void {
    void ent;
    this.tip('first-kill', 'Les défenseurs abattus ne reviennent pas : videz le bâtiment, puis restez à l’intérieur pour le capturer.', 800);
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
  }

  onFire(): void {
    this.tip('aim', 'Clic droit pour viser : vos tirs sont bien plus précis.', 1200);
  }

  onDesk(): void {
    this.tip('map', 'Cliquez sur un bâtiment ou un quartier, puis choisissez un ordre et un lieutenant : vos hommes partent vraiment dans la ville.', 600);
  }
}
