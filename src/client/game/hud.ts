// Interface en jeu (DOM) : panneau de faction, santé, arme, réticule, notifications,
// missions des lieutenants, fil des morts, capture, discussion, journal, mort, pause.

import { WEAPONS, Weapon } from '../../shared/characters';
import { BOSS_NAME, MAFIA_NAME, NEWSPAPER, ORDER_STATUS } from '../../shared/constants';
import type { LieutenantStatus, PrivateState, PublicState, Slot } from '../../shared/protocol';
import { formatMoney, formatTime } from '../../shared/util';
import { h, clear } from '../ui/dom';
import { settings } from '../settings';

const FACTION_COLOR: Record<Slot, string> = { dadou: '#c8323a', even: '#3a62a8' };

export class Hud {
  readonly el: HTMLElement;
  private money!: HTMLElement;
  private income!: HTMLElement;
  private men!: HTMLElement;
  private terr!: HTMLElement;
  private objective!: HTMLElement;
  private eventLine!: HTMLElement;
  private notices!: HTMLElement;
  private capture!: HTMLElement;
  private captureLbl!: HTMLElement;
  private captureFill!: HTMLElement;
  readonly minimapCanvas: HTMLCanvasElement;
  private district!: HTMLElement;
  private clock!: HTMLElement;
  private missions!: HTMLElement;
  private killfeed!: HTMLElement;
  private hpFill!: HTMLElement;
  private stars!: HTMLElement;
  private wname!: HTMLElement;
  private ammo!: HTMLElement;
  private slots!: HTMLElement;
  private reload!: HTMLElement;
  private cross!: HTMLElement;
  private hitmark!: HTMLElement;
  private prompt!: HTMLElement;
  private damage!: HTMLElement;
  private lowhp!: HTMLElement;
  private dmgdir!: HTMLElement;
  private death!: HTMLElement;
  private deathText!: HTMLElement;
  private pause!: HTMLElement;
  readonly chatBox: HTMLElement;
  private chatMsgs!: HTMLElement;
  readonly chatInput: HTMLInputElement;
  private news!: HTMLElement;
  private fps!: HTMLElement;
  private timer!: HTMLElement;
  private hint!: HTMLElement;
  private scores!: HTMLElement;
  private newsTimer = 0;
  private lastWanted = 0;

  constructor(readonly slot: Slot) {
    const fc = FACTION_COLOR[slot];
    this.el = h('div', { class: 'hud' });
    // panneau de faction
    this.money = h('b');
    this.income = h('b', { class: 'pos' });
    this.men = h('b');
    this.terr = h('b');
    this.objective = h('div', { class: 'hud-objective' });
    this.eventLine = h('div', { class: 'hud-event hidden' });
    this.el.appendChild(
      h(
        'div',
        { class: 'hud-faction', style: `--fc:${fc}` },
        h('div', { class: 'fname' }, h('img', { src: `/brand/emblem-${slot}.svg`, alt: '' }), MAFIA_NAME[slot].toUpperCase()),
        h('div', { class: 'row' }, h('span', null, 'Argent'), this.money),
        h('div', { class: 'row' }, h('span', null, 'Revenus'), this.income),
        h('div', { class: 'row' }, h('span', null, 'Hommes'), this.men),
        h('div', { class: 'row' }, h('span', null, 'Territoires'), this.terr),
        this.objective,
        this.eventLine,
      ),
    );
    this.notices = h('div', { class: 'hud-notices' });
    this.el.appendChild(this.notices);
    this.captureLbl = h('div');
    this.captureFill = h('div', { class: 'fill' });
    this.capture = h('div', { class: 'hud-capture hidden' }, this.captureLbl, h('div', { class: 'bar' }, this.captureFill));
    this.el.appendChild(this.capture);
    this.minimapCanvas = h('canvas', { width: 420, height: 420 });
    this.el.appendChild(h('div', { class: 'hud-minimap' }, this.minimapCanvas));
    this.district = h('div', { class: 'hud-district' });
    this.clock = h('div', { class: 'hud-clock' });
    this.el.appendChild(this.district);
    this.el.appendChild(this.clock);
    this.missions = h('div', { class: 'hud-missions' });
    this.el.appendChild(this.missions);
    this.killfeed = h('div', { class: 'hud-killfeed' });
    this.el.appendChild(this.killfeed);
    // santé
    this.hpFill = h('div', { class: 'fill', style: 'width:100%' });
    this.stars = h('div', { class: 'stars' });
    this.el.appendChild(h('div', { class: 'hud-health' }, h('div', { class: 'lbl' }, `${BOSS_NAME[slot].toUpperCase()} — SANTÉ`), h('div', { class: 'bar' }, this.hpFill), this.stars));
    // arme
    this.wname = h('div', { class: 'wname' });
    this.ammo = h('div', { class: 'ammo' });
    this.reload = h('div', { class: 'reload' });
    this.slots = h('div', { class: 'slots' });
    this.el.appendChild(h('div', { class: 'hud-weapon' }, this.wname, this.ammo, this.reload, this.slots));
    // réticule, marqueur de touche, invite
    this.cross = h('div', { class: `hud-cross ${settings.crosshair}` }, h('i'), h('i'), h('i'), h('i'));
    this.hitmark = h('div', { class: 'hud-hitmark' });
    this.prompt = h('div', { class: 'hud-prompt hidden' });
    this.el.appendChild(this.cross);
    this.el.appendChild(this.hitmark);
    this.el.appendChild(this.prompt);
    // dégâts
    this.damage = h('div', { class: 'hud-damage' });
    this.lowhp = h('div', { class: 'hud-lowhp' });
    this.dmgdir = h('div', { class: 'hud-dmgdir' }, h('i'));
    this.el.appendChild(this.damage);
    this.el.appendChild(this.lowhp);
    this.el.appendChild(this.dmgdir);
    // discussion
    this.chatMsgs = h('div', { class: 'msgs' });
    this.chatInput = h('input', { type: 'text', maxLength: 200, placeholder: 'Message (Entrée pour envoyer, Échap pour annuler)', class: 'hidden' });
    this.chatBox = h('div', { class: 'hud-chat' }, this.chatMsgs, this.chatInput);
    this.el.appendChild(this.chatBox);
    // journal
    this.news = h('div', { class: 'newspaper' });
    this.el.appendChild(this.news);
    // mort, pause
    this.deathText = h('p');
    this.death = h('div', { class: 'hud-death hidden' }, h('h1', null, 'VOUS AVEZ ÉTÉ ABATTU'), this.deathText);
    this.el.appendChild(this.death);
    this.pause = h('div', { class: 'hud-pause hidden' });
    this.el.appendChild(this.pause);
    this.fps = h('div', { class: 'hud-fps' });
    this.timer = h('div', { class: 'hud-timer' });
    this.hint = h('div', { class: 'hud-hint' });
    this.scores = h('div', { class: 'hud-scores panel hidden' });
    this.el.appendChild(this.fps);
    this.el.appendChild(this.timer);
    this.el.appendChild(this.hint);
    this.el.appendChild(this.scores);
  }

  setPriv(p: PrivateState, pub: PublicState | null): void {
    this.money.textContent = formatMoney(p.money);
    this.income.textContent = `+${formatMoney(p.income)}/min`;
    this.men.textContent = `${p.men}${p.pool ? ` (${p.pool} au QG)` : ''}`;
    if (pub) this.terr.textContent = `${pub.territories[this.slot]}/6`;
    // étoiles de recherche
    if (p.wanted !== this.lastWanted || this.stars.childElementCount === 0) {
      clear(this.stars);
      for (let i = 0; i < 5; i++) this.stars.appendChild(h('span', { class: i < p.wanted ? 'on' : '' }, '★'));
      this.stars.classList.toggle('flash', p.wanted > 0);
      this.lastWanted = p.wanted;
    }
    this.stars.style.opacity = p.wanted > 0 ? '1' : '0';
    // missions
    this.renderMissions(p.lieutenants);
  }

  private renderMissions(lts: LieutenantStatus[]): void {
    clear(this.missions);
    for (const lt of lts) {
      const active = lt.order !== null || !lt.alive;
      if (!active) continue;
      const card = h(
        'div',
        { class: `mission${lt.alive ? '' : ' down'}`, style: `--fc:${FACTION_COLOR[this.slot]}` },
        h('div', { class: 'st' }, lt.alive && lt.order ? `${ORDER_STATUS[lt.order]}${lt.targetName ? ' — ' + lt.targetName.toUpperCase() : ''}` : 'LIEUTENANT BLESSÉ'),
        h('div', null, `Lieutenant : ${lt.name}`),
        lt.alive ? h('div', null, `Hommes restants : ${lt.men}/${Math.max(lt.men, lt.menStart)}`) : null,
        h('div', { class: 'dim' }, lt.state),
        lt.alive && lt.order ? h('div', null, `Progression : ${Math.round(lt.progress * 100)} %`) : null,
        lt.alive && lt.order ? h('div', { class: 'pbar' }, h('i', { style: `width:${Math.round(lt.progress * 100)}%` })) : null,
      );
      this.missions.appendChild(card);
    }
  }

  setObjective(text: string, done = false): void {
    clear(this.objective);
    if (!text) {
      this.objective.classList.add('hidden');
      return;
    }
    this.objective.classList.remove('hidden');
    this.objective.classList.toggle('done', done);
    this.objective.appendChild(h('span', { class: 'lbl' }, done ? 'OBJECTIF ACCOMPLI' : 'OBJECTIF'));
    this.objective.appendChild(document.createTextNode(text));
  }

  /** Événement aléatoire en cours (cargaison de contrebande, descente de police…). */
  setEvent(title: string | null, detail = ''): void {
    if (!title) {
      this.eventLine.classList.add('hidden');
      return;
    }
    this.eventLine.classList.remove('hidden');
    const key = title + detail;
    if (this.eventLine.dataset.k === key) return;
    this.eventLine.dataset.k = key;
    clear(this.eventLine);
    this.eventLine.appendChild(h('span', { class: 'lbl' }, title));
    this.eventLine.appendChild(document.createTextNode(detail));
  }

  setHealth(f: number): void {
    this.hpFill.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`;
    this.lowhp.style.opacity = f < 0.3 && f > 0 ? '1' : '0';
  }

  setWeapon(w: Weapon, mag: number, reserve: number, reloading: boolean, owned: Weapon[]): void {
    const def = WEAPONS[w];
    this.wname.textContent = def.name.toUpperCase();
    if (def.ranged) {
      this.ammo.innerHTML = `${mag} <small>/ ${reserve}</small>`;
    } else this.ammo.textContent = '—';
    this.reload.textContent = reloading ? 'Rechargement…' : def.ranged && mag === 0 ? (reserve > 0 ? 'Appuyez sur R pour recharger' : 'Plus de munitions !') : '';
    const key = owned.join(',') + ':' + w;
    if (this.slots.dataset.key !== key) {
      this.slots.dataset.key = key;
      clear(this.slots);
      for (const ow of owned) this.slots.appendChild(h('span', { class: `slot${ow === w ? ' on' : ''}` }, WEAPONS[ow].name.split(' ')[0]));
    }
  }

  /** Style du réticule (point, croix, cercle) choisi dans les paramètres. */
  setCrosshairStyle(style: string): void {
    this.cross.className = `hud-cross ${style}`;
  }

  setCrosshair(enemy: boolean, visible: boolean): void {
    this.cross.className = `hud-cross ${settings.crosshair}${enemy ? ' enemy' : ''}`;
    this.cross.style.display = visible ? '' : 'none';
  }

  hitMarker(head: boolean): void {
    this.hitmark.classList.remove('show', 'head');
    void this.hitmark.offsetWidth;
    this.hitmark.classList.add('show');
    if (head) this.hitmark.classList.add('head');
  }

  setPrompt(key: string | null, text = '', sub = ''): void {
    if (!key) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.classList.remove('hidden');
    const sig = key + text + sub;
    if (this.prompt.dataset.sig === sig) return;
    this.prompt.dataset.sig = sig;
    clear(this.prompt);
    this.prompt.appendChild(h('span', { class: 'keycap' }, key));
    this.prompt.appendChild(h('span', null, text));
    if (sub) this.prompt.appendChild(h('span', { class: 'sub' }, sub));
  }

  damageFlash(amount: number, angle: number | null): void {
    this.damage.style.transition = 'none';
    this.damage.style.opacity = String(Math.min(0.9, 0.25 + amount / 60));
    void this.damage.offsetWidth;
    this.damage.style.transition = 'opacity 0.6s';
    this.damage.style.opacity = '0';
    if (angle !== null) {
      const i = this.dmgdir.firstChild as HTMLElement;
      i.style.transition = 'none';
      i.style.transform = `rotate(${angle}rad)`;
      i.style.opacity = '1';
      void i.offsetWidth;
      i.style.transition = 'opacity 1.2s';
      i.style.opacity = '0';
    }
  }

  notify(text: string, kind: string, duration = 5200): void {
    const n = h('div', { class: `notice ${kind}` }, text);
    this.notices.appendChild(n);
    while (this.notices.childElementCount > 5) this.notices.firstChild!.remove();
    setTimeout(() => {
      n.classList.add('out');
      setTimeout(() => n.remove(), 500);
    }, kind === 'alert' ? duration + 2500 : duration);
  }

  killfeedAdd(killer: string, victim: string, kf: number, vf: number): void {
    const col = (f: number) => (f === 1 ? '#e05a5a' : f === 2 ? '#6f95e0' : f === 3 ? '#9ab0d0' : '#c8b890');
    const k = h('div', { class: 'kill' }, h('span', { style: `color:${col(kf)}` }, killer), ' a abattu ', h('span', { style: `color:${col(vf)}` }, victim));
    this.killfeed.appendChild(k);
    while (this.killfeed.childElementCount > 5) this.killfeed.firstChild!.remove();
    setTimeout(() => k.remove(), 8000);
  }

  setCapture(text: string | null, progress = 0, contested = false): void {
    if (!text) {
      this.capture.classList.add('hidden');
      return;
    }
    this.capture.classList.remove('hidden');
    this.capture.classList.toggle('contested', contested);
    this.captureLbl.textContent = text;
    this.captureFill.style.width = `${Math.round(progress * 100)}%`;
  }

  setDistrict(name: string, owner: string, ownerColor: string): void {
    const sig = name + owner;
    if (this.district.dataset.sig === sig) return;
    this.district.dataset.sig = sig;
    clear(this.district);
    this.district.appendChild(document.createTextNode(name.toUpperCase()));
    this.district.appendChild(h('span', { class: 'owner', style: `color:${ownerColor}` }, owner));
  }

  setClock(dayTime: number, timeLeft: number): void {
    const mins = Math.floor(dayTime * 24 * 60);
    const hh = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    this.clock.textContent = `${hh} h ${mm.toString().padStart(2, '0')}`;
    this.timer.textContent = timeLeft >= 0 ? `⏳ ${formatTime(timeLeft)}` : '';
  }

  setFps(v: number | null): void {
    this.fps.textContent = v === null ? '' : `${Math.round(v)} i/s`;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  showDeath(text: string | null): void {
    if (text === null) {
      this.death.classList.add('hidden');
      return;
    }
    this.death.classList.remove('hidden');
    this.deathText.textContent = text;
  }

  showPause(text: string | null): void {
    if (!text) this.pause.classList.add('hidden');
    else {
      this.pause.classList.remove('hidden');
      this.pause.textContent = text;
    }
  }

  chat(from: string, color: string, text: string): void {
    const m = h('div', null, h('b', { style: `color:${color}` }, from), ' : ', text);
    this.chatMsgs.appendChild(m);
    while (this.chatMsgs.childElementCount > 8) this.chatMsgs.firstChild!.remove();
    setTimeout(() => m.classList.add('old'), 12000);
  }

  openChat(open: boolean): void {
    this.chatInput.classList.toggle('hidden', !open);
    if (open) {
      this.chatInput.value = '';
      setTimeout(() => this.chatInput.focus(), 0);
      for (const c of Array.from(this.chatMsgs.children)) c.classList.remove('old');
    } else this.chatInput.blur();
  }

  newspaper(title: string, body: string): void {
    const d = new Date(1888, 9, 1 + Math.floor(Math.random() * 28));
    clear(this.news);
    this.news.appendChild(h('div', { class: 'mast' }, NEWSPAPER.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ')));
    this.news.appendChild(
      h('div', { class: 'date' }, h('span', null, `Londres, ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`), h('span', null, 'Un penny')),
    );
    this.news.appendChild(h('h2', null, title));
    this.news.appendChild(h('p', null, body));
    this.news.classList.add('show');
    clearTimeout(this.newsTimer);
    this.newsTimer = window.setTimeout(() => this.news.classList.remove('show'), 9000);
  }

  showScores(pub: PublicState | null, priv: PrivateState | null, show: boolean): void {
    this.scores.classList.toggle('hidden', !show);
    if (!show || !pub || !priv) return;
    clear(this.scores);
    this.scores.appendChild(h('div', { class: 'title-m', style: 'text-align:center' }, 'BILAN DE LA GUERRE'));
    this.scores.appendChild(h('div', { class: 'divider' }));
    const bd = pub.buildings.filter((b) => b.owner === 1).length;
    const be = pub.buildings.filter((b) => b.owner === 2).length;
    this.scores.appendChild(
      h(
        'table',
        null,
        h('tr', null, h('th', null, ''), h('th', { class: 'c-dadou' }, 'Dadou'), h('th', { class: 'c-even' }, 'Even')),
        h('tr', null, h('td', null, 'Quartiers contrôlés'), h('td', null, String(pub.territories.dadou)), h('td', null, String(pub.territories.even))),
        h('tr', null, h('td', null, 'Bâtiments'), h('td', null, String(bd)), h('td', null, String(be))),
        h('tr', null, h('td', null, 'Temps de jeu'), h('td', { colspan: 2 }, formatTime(pub.elapsed))),
        h('tr', null, h('td', null, 'Vos ennemis abattus'), h('td', { colspan: 2 }, String(priv.kills))),
        h('tr', null, h('td', null, 'Vos morts'), h('td', { colspan: 2 }, String(priv.deaths))),
      ),
    );
  }
}
