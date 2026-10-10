// Mission d'introduction « PREMIÈRE MISSION — PRENEZ LE CONTRÔLE » : un petit parcours
// guidé (bureau, carte stratégique, ordre au lieutenant, prise du premier bâtiment), puis
// l'objectif permanent de la partie.

import { BOSS_NAME, DE_BOSS, HQ_CAPTURE_MIN_DISTRICTS } from '../../shared/constants';
import { BUILDING_BY_KEY, FIRST_MISSION_TARGET, HQ_BUILDING } from '../../shared/city/plan';
import type { PrivateState } from '../../shared/protocol';
import { audio } from '../audio/AudioEngine';
import { actionKey } from '../input/bindings';
import { settings } from '../settings';
import { h } from '../ui/dom';
import type { ClientEnt } from './entities';
import type { GameClient } from './GameClient';
import { cap, deNom, leNom } from '../../shared/french';

type Step = 'intro' | 'desk' | 'order' | 'capture' | 'done' | 'free';

export class Tutorial {
  private gc: GameClient;
  private step: Step = 'intro';
  private t = 0;
  private card: HTMLElement | null = null;
  private targetId: number;
  private targetName: string;
  private hintsShown = new Set<string>();
  private kills = 0;
  private fired = false;
  private lastText = '';
  private started = false;

  constructor(gc: GameClient) {
    this.gc = gc;
    const key = FIRST_MISSION_TARGET[gc.you];
    const def = BUILDING_BY_KEY[key];
    this.targetId = def.id;
    this.targetName = def.name;
    if (!gc.settings.tutorial || this.targetOwned()) this.step = 'free';
    // la carte de mission et les objectifs apparaissent quand le parrain est dans le monde
  }

  private start(): void {
    this.started = true;
    this.t = 0;
    if (this.step !== 'free') this.showCard();
    this.setGoal();
  }

  /** « Chat Noir » pour « Le Chat Noir » (l'article est contracté dans la phrase). */
  private bareName(): string {
    return this.targetName.replace(/^(Le |La |Les |L’)/, '');
  }

  /** « du  », « de l’ », « de la  »… devant le nom de la cible. */
  private dePrefix(): string {
    const de = deNom(this.targetName);
    return de.slice(0, de.length - this.bareName().length);
  }

  private targetOwned(): boolean {
    return this.gc.pub.buildings[this.targetId]?.owner === this.gc.myFaction;
  }

  private key(a: 'interact' | 'map' | 'wheel'): string {
    return actionKey(settings.bindings, a);
  }

  private showCard(): void {
    const gc = this.gc;
    const lt = gc.priv.lieutenants[0]?.name ?? (gc.you === 'dadou' ? 'Arthur Collins' : 'William Hayes');
    this.card = h(
      'div',
      { class: 'tu-card' },
      h('div', { class: 'tu-kicker' }, 'Londres, 1888'),
      h('h1', null, 'PREMIÈRE MISSION'),
      h('h2', null, 'PRENEZ LE CONTRÔLE'),
      h('div', { class: 'divider' }),
      h(
        'p',
        null,
        `${BOSS_NAME[gc.you]}, vous n’êtes encore qu’un petit parrain : un pub, cinq hommes, 500 £ et un lieutenant fidèle, ${lt}. `,
        `Pour bâtir votre empire, emparez-vous ${this.dePrefix()}`,
        h('b', null, this.bareName()),
        '.',
      ),
      h('p', { class: 'dim' }, 'Suivez les objectifs affichés en haut à gauche.'),
    );
    gc.hud.el.appendChild(this.card);
    audio.play('paper');
    setTimeout(() => this.card?.classList.add('out'), 7500);
    setTimeout(() => {
      this.card?.remove();
      this.card = null;
    }, 8600);
  }

  private setGoal(): void {
    const gc = this.gc;
    const other = gc.you === 'dadou' ? 'even' : 'dadou';
    let text = '';
    let done = false;
    switch (this.step) {
      case 'intro':
      case 'desk': {
        const desk = gc.world.buildings[HQ_BUILDING[gc.you].id].desk;
        const p = gc.player.pos;
        const near = !!desk && Math.hypot(desk.x - p.x, desk.z - p.z) < 6;
        text = near
          ? `Vous êtes dans votre bureau : approchez-vous de votre table de travail et appuyez sur ${this.key('interact')} pour ouvrir la carte stratégique.`
          : `Retournez dans votre bureau, ${gc.you === 'dadou' ? 'au fond du Lion Rouge' : 'au fond de l’Ancre Bleue'} (derrière la salle du bar), et appuyez sur ${this.key('interact')} devant votre table de travail.`;
        break;
      }
      case 'order':
        text = `Sur la carte, cliquez sur ${leNom(this.targetName)}, puis « Attaquer » : choisissez votre lieutenant et lancez l’attaque.`;
        break;
      case 'capture': {
        const st = gc.pub.buildings[this.targetId];
        const g = st ? st.guards : 0;
        text = `Prenez ${leNom(this.targetName)} : éliminez les défenseurs${g > 0 ? ` (${g} restant${g > 1 ? 's' : ''})` : ''} et restez à l’intérieur jusqu’à la capture.`;
        break;
      }
      case 'done':
        text = `Mission accomplie ! ${cap(leNom(this.targetName))} vous appartient.`;
        done = true;
        break;
      case 'free': {
        const terr = gc.pub.territories[gc.you];
        text =
          terr >= HQ_CAPTURE_MIN_DISTRICTS
            ? `Prenez d’assaut le QG ${DE_BOSS[other]} (${HQ_BUILDING[other].name}) pour régner sur Londres !`
            : `Contrôlez ${HQ_CAPTURE_MIN_DISTRICTS} quartiers (${terr}/${HQ_CAPTURE_MIN_DISTRICTS}) en prenant leurs bâtiments clés ★, puis attaquez le QG ${DE_BOSS[other]}.`;
        break;
      }
    }
    if (text !== this.lastText) {
      this.lastText = text;
      gc.hud.setObjective(text, done);
    }
  }

  private advance(to: Step): void {
    if (this.step === to) return;
    this.step = to;
    this.t = 0;
    if (to !== 'free' && to !== 'intro') audio.play('notify', { volume: 0.6 });
    this.setGoal();
  }

  private hint(id: string, text: string, delay = 0): void {
    if (this.hintsShown.has(id)) return;
    this.hintsShown.add(id);
    setTimeout(() => this.gc.hud.notify(text, 'info', 7000), delay);
  }

  update(dt: number): void {
    if (!this.started) {
      if (this.gc.isPlaced) this.start();
      return;
    }
    this.t += dt;
    switch (this.step) {
      case 'intro':
        if (this.t > 4) this.advance('desk');
        break;
      case 'desk':
        this.setGoal();
        if (this.t > 30) this.hint('desk-path', `Astuce : le bureau ${DE_BOSS[this.gc.you]} est la pièce tapissée au fond du pub, derrière le comptoir. Sa porte porte une plaque de laiton.`);
        break;
      case 'order':
        if (this.t > 40) this.hint('order-help', `Astuce : dans la carte, cliquez sur ${leNom(this.targetName)}, puis sur « Attaquer ». Vous pouvez aussi y aller vous-même avec vos hommes (${this.key('wheel')} : « Suivez-moi »).`);
        break;
      case 'capture':
        this.setGoal();
        if (this.t > 3) this.hint('wheel', `Appuyez sur ${this.key('wheel')} près de vos hommes pour leur donner un ordre rapide : « Suivez-moi », « Attaquez »…`);
        if (this.t > 25) this.hint('aim', 'Clic droit pour viser : vos tirs sont bien plus précis.');
        break;
      case 'done':
        if (this.t > 8) {
          this.advance('free');
          this.hint('next', `Prochaine étape : recrutez au bar du QG, engagez d’autres lieutenants et emparez-vous des bâtiments clés ★ pour contrôler des quartiers.`);
        }
        break;
      case 'free':
        this.setGoal();
        break;
    }
    if (this.step !== 'free' && this.step !== 'done' && this.targetOwned()) {
      this.onCapture(this.targetId);
    }
  }

  onKill(ent: ClientEnt): void {
    void ent;
    this.kills++;
    if (this.kills === 1) this.hint('first-kill', 'Bien visé ! Les défenseurs abattus ne reviennent pas : la place sera bientôt libre.');
  }

  onCapture(bid: number): void {
    if (bid !== this.targetId) return;
    if (this.step === 'free' || this.step === 'done') return;
    this.advance('done');
    this.gc.hud.notify(`Mission accomplie ! ${cap(leNom(this.targetName))} rapporte désormais +${BUILDING_BY_KEY[FIRST_MISSION_TARGET[this.gc.you]].income} £/min.`, 'good', 8000);
  }

  onPriv(p: PrivateState): void {
    if (this.step === 'order' || this.step === 'desk') {
      const sent = p.lieutenants.some((l) => l.order && l.targetName === this.targetName);
      if (sent) this.advance('capture');
    }
  }

  onFire(): void {
    if (this.fired) return;
    this.fired = true;
    if (this.step !== 'free') this.hint('reload', `Six balles dans le barillet : ${actionKey(settings.bindings, 'reload')} pour recharger.`, 1500);
  }

  onDesk(): void {
    if (this.step === 'intro' || this.step === 'desk') this.advance('order');
  }
}
