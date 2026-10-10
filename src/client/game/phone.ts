// Téléphone du parrain (touche Tab) : alertes, garage et livraison de véhicules, taxi volant,
// lieutenants (ordres rapides), recrutement à distance, immobilier (emménager), drones, carte.
// Il complète le bureau du QG (la carte stratégique) sans le remplacer.

import '../ui/phone.css';
import { DISTRICTS, RESIDENCES } from '../../shared/city/plan';
import { DE_BOSS, RECRUIT_BUNDLES, TAXI_PRICE, UPGRADE_BY_ID, VEHICLES, tierDef } from '../../shared/constants';
import { formatMoney } from '../../shared/util';
import { audio } from '../audio/AudioEngine';
import { h, clear } from '../ui/dom';
import type { GameClient } from './GameClient';
import { aNom, deNom } from '../../shared/french';

type AppId = 'home' | 'alerts' | 'garage' | 'taxi' | 'crew' | 'recruit' | 'estate' | 'drones' | 'convoys' | 'map';

const ICONS: Record<Exclude<AppId, 'home'>, string> = {
  alerts: '<path d="M12 3a5 5 0 0 0-5 5v4l-2 3h14l-2-3V8a5 5 0 0 0-5-5z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  garage: '<path d="M4 15l2-5a2 2 0 0 1 2-1h8a2 2 0 0 1 2 1l2 5"/><rect x="3" y="15" width="18" height="4" rx="1"/><circle cx="7.5" cy="19.5" r="1"/><circle cx="16.5" cy="19.5" r="1"/>',
  taxi: '<path d="M3 13h18M6 13l2-4h8l2 4"/><path d="M5 13v3h14v-3"/><path d="M12 5v4M9 5h6"/>',
  crew: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M15 15c2 0 5 1 5 4"/>',
  recruit: '<circle cx="10" cy="8" r="3"/><path d="M4 19c0-3 3-5 6-5s6 2 6 5"/><path d="M18 8v6M15 11h6"/>',
  estate: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/><path d="M4 20h16"/>',
  drones: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/><path d="M8 8l1.5 1.5M16 8l-1.5 1.5M8 16l1.5-1.5M16 16l-1.5-1.5"/>',
  convoys: '<rect x="2" y="7" width="12" height="9" rx="1"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/><path d="M6 11.5h4"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
};

const LABEL: Record<Exclude<AppId, 'home'>, string> = {
  alerts: 'Alertes',
  garage: 'Garage',
  taxi: 'Taxi volant',
  crew: 'Lieutenants',
  recruit: 'Recruter',
  estate: 'Immobilier',
  drones: 'Drones',
  convoys: 'Convois',
  map: 'Carte',
};

export class Phone {
  readonly el: HTMLElement;
  open = false;
  private gc: GameClient;
  private app: AppId = 'home';
  private body: HTMLElement;
  private title: HTMLElement;
  private back: HTMLElement;
  private clock: HTMLElement;
  private seenAlerts = 0;
  private renderAcc = 0;

  constructor(gc: GameClient) {
    this.gc = gc;
    this.title = h('h2', null, 'Téléphone');
    this.back = h('button', { class: 'phone-back', on: { click: () => this.go('home') } }, '‹');
    this.body = h('div', { class: 'phone-body' });
    this.clock = h('span', null, '');
    this.el = h(
      'div',
      { class: `phone ${gc.you} hidden` },
      h('div', { class: 'phone-status' }, this.clock, h('span', null, 'NY-NET 9G ▮▮▮▮')),
      h('div', { class: 'phone-head' }, this.back, this.title),
      this.body,
      h('div', { class: 'phone-home-bar' }),
    );
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  /** Les ordres et le recrutement à distance : loft (palier 3) ou liaison cryptée. */
  private get remote(): boolean {
    const p = this.gc.priv;
    return p.tier >= 3 || p.upgrades.includes('crypto');
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show('home');
  }

  show(app: AppId = 'home'): void {
    this.open = true;
    this.el.classList.remove('hidden');
    this.gc.setUiOpen(true);
    audio.play('ui_open', { volume: 0.6 });
    this.go(app);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    this.gc.setUiOpen(false);
    audio.play('ui_close', { volume: 0.5 });
  }

  private go(app: AppId): void {
    if (app === 'map') {
      this.close();
      this.gc.strategic.show(this.remote ? 'orders' : 'view');
      return;
    }
    if (app === 'alerts') this.seenAlerts = this.gc.hud.log.length ? this.gc.hud.log[0].at : this.seenAlerts;
    this.app = app;
    this.render();
  }

  /** Appelé régulièrement : rafraîchit l'appli ouverte (argent, délais…). */
  update(dt: number): void {
    const d = new Date();
    this.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · 2085`;
    if (!this.open) return;
    this.renderAcc += dt;
    if (this.renderAcc > 0.5) {
      this.renderAcc = 0;
      this.render();
    }
  }

  private act(a: Parameters<GameClient['app']['net']['act']>[0], sfx: 'ui_click' | 'purchase' = 'ui_click'): void {
    this.gc.app.net.act(a);
    audio.play(sfx, { volume: 0.7 });
    this.gc.gesture();
  }

  private btn(label: string, fn: () => void, disabled = false): HTMLElement {
    return h('button', { class: 'phone-btn', disabled, on: { click: () => !disabled && fn() } }, label);
  }

  private render(): void {
    const gc = this.gc;
    const p = gc.priv;
    clear(this.body);
    this.back.style.visibility = this.app === 'home' ? 'hidden' : 'visible';
    this.title.textContent = this.app === 'home' ? (gc.you === 'dadou' ? 'Dadou — privé' : 'Even — privé') : LABEL[this.app];
    switch (this.app) {
      case 'home': {
        const grid = h('div', { class: 'phone-grid' });
        const unread = gc.hud.log.filter((l) => l.at > this.seenAlerts).length;
        for (const id of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
          const locked = (id === 'recruit' && !this.remote) || (id === 'drones' && !p.upgrades.includes('drones'));
          const ico = h('span', { class: 'ico', html: `<svg viewBox="0 0 24 24">${ICONS[id]}</svg>` });
          if (id === 'alerts' && unread > 0) ico.appendChild(h('span', { class: 'badge' }, String(Math.min(99, unread))));
          grid.appendChild(h('button', { class: `phone-app${locked ? ' locked' : ''}`, on: { click: () => this.go(id) } }, ico, LABEL[id]));
        }
        this.body.appendChild(grid);
        this.body.appendChild(h('div', { class: 'phone-card' }, h('h3', null, formatMoney(p.money)), h('p', null, `Revenus : +${formatMoney(p.income)}/min — ${p.men}/${p.maxMen} hommes — ${gc.pub.territories[gc.you]}/7 quartiers`)));
        break;
      }
      case 'alerts': {
        if (gc.hud.log.length === 0) this.body.appendChild(h('p', { class: 'phone-note' }, 'Aucune alerte pour l’instant.'));
        const now = performance.now();
        for (const l of gc.hud.log) {
          const ago = Math.round((now - l.at) / 1000);
          this.body.appendChild(h('div', { class: `phone-alert ${l.kind}` }, l.text, h('small', null, ago < 60 ? `il y a ${ago} s` : `il y a ${Math.round(ago / 60)} min`)));
        }
        break;
      }
      case 'garage': {
        if (p.vehicle >= 0) this.body.appendChild(h('p', { class: 'phone-note' }, 'Vous êtes au volant.'));
        else if (p.callIn > 0) this.body.appendChild(h('p', { class: 'phone-note' }, `Garage occupé : prochaine livraison dans ${p.callIn} s.`));
        for (const v of VEHICLES) {
          if (v.price < 0) continue;
          const owned = p.garage.includes(v.id);
          const card = h('div', { class: 'phone-card' }, h('h3', null, v.name), h('p', null, v.desc));
          const row = h('div', { class: 'row' });
          if (owned) row.appendChild(this.btn('Faire livrer', () => this.act({ a: 'vehicle', op: 'call', v: v.id }), p.vehicle >= 0 || p.callIn > 0));
          else if (v.tier > p.tier) row.appendChild(h('span', { class: 'phone-note' }, `Disponible dès le palier ${v.tier} (${tierDef(v.tier).name.toLowerCase()}) — ${formatMoney(v.price)}`));
          else row.appendChild(this.btn(`Acheter — ${formatMoney(v.price)}`, () => this.act({ a: 'vehicle', op: 'buy', v: v.id }, 'purchase'), p.money < v.price));
          row.appendChild(h('span', { class: 'phone-note' }, `${v.seats} place${v.seats > 1 ? 's' : ''} · ${Math.round(v.speed * 3.6)} km/h`));
          card.appendChild(row);
          this.body.appendChild(card);
        }
        break;
      }
      case 'taxi': {
        const hq = gc.world.buildings[gc.pub.hq[gc.you]];
        this.body.appendChild(
          h(
            'div',
            { class: 'phone-card' },
            h('h3', null, 'Retour au QG'),
            h('p', null, `Un taxi volant vous dépose ${aNom(hq.def.name)}. Impossible si la police vous recherche ou en plein combat.`),
            h('div', { class: 'row' }, this.btn(`Appeler — ${formatMoney(TAXI_PRICE)}`, () => (this.act({ a: 'goHome' }), this.close()), p.money < TAXI_PRICE || p.wanted > 0 || p.vehicle >= 0)),
          ),
        );
        if (p.wanted > 0) this.body.appendChild(h('p', { class: 'phone-note' }, 'La police vous recherche : semez-la d’abord.'));
        break;
      }
      case 'crew': {
        if (p.lieutenants.length === 0) this.body.appendChild(h('p', { class: 'phone-note' }, 'Aucun lieutenant.'));
        for (const lt of p.lieutenants) {
          const card = h('div', { class: 'phone-card' }, h('h3', null, lt.name), h('p', null, `${lt.state} — ${lt.men} homme${lt.men > 1 ? 's' : ''}`));
          card.appendChild(h('div', { class: 'phone-bar' }, h('i', { style: `width:${Math.round(lt.progress * 100)}%` })));
          const row = h('div', { class: 'row' });
          row.appendChild(this.btn('Me rejoindre', () => this.act({ a: 'order', lt: lt.id, order: 'follow' }), !lt.alive));
          row.appendChild(this.btn('Rappeler', () => this.act({ a: 'cancel', lt: lt.id }), !lt.alive || !lt.order));
          card.appendChild(row);
          this.body.appendChild(card);
        }
        this.body.appendChild(
          h(
            'div',
            { class: 'phone-card' },
            h('p', null, this.remote ? 'Vos ordres complets passent aussi par la carte (attaques, défense, métro, toits).' : 'Ordres complets à distance : dès le loft (palier 3), ou avec la liaison cryptée. En attendant, votre bureau au QG.'),
            h('div', { class: 'row' }, this.btn('Ouvrir la carte', () => this.go('map'))),
          ),
        );
        break;
      }
      case 'recruit': {
        if (!this.remote) {
          this.body.appendChild(h('p', { class: 'phone-note' }, `Recrutement à distance dès le loft (palier 3) ou avec la ${UPGRADE_BY_ID.crypto.name.toLowerCase()}. En attendant, parlez à votre rabatteur au QG.`));
          break;
        }
        this.body.appendChild(h('p', { class: 'phone-note' }, `${p.men}/${p.maxMen} hommes — les recrues vous attendent au QG.`));
        for (const b of RECRUIT_BUNDLES) {
          this.body.appendChild(
            h(
              'div',
              { class: 'phone-card' },
              h('h3', null, `Recruter ${b.n} gangster${b.n > 1 ? 's' : ''}`),
              h('div', { class: 'row' }, this.btn(formatMoney(b.price), () => this.act({ a: 'recruit', n: b.n }, 'purchase'), p.money < b.price || p.men >= p.maxMen)),
            ),
          );
        }
        break;
      }
      case 'estate': {
        const cur = gc.world.buildings[gc.pub.hq[gc.you]].def;
        const td = tierDef(p.tier);
        this.body.appendChild(h('div', { class: 'phone-card' }, h('h3', null, `QG actuel : ${cur.name}`), h('p', null, `${td.name} — ${td.perks.join(', ')}`)));
        const next = RESIDENCES[gc.you][p.tier];
        if (!next) {
          this.body.appendChild(h('p', { class: 'phone-note' }, 'Vous habitez déjà la plus prestigieuse tour de New York.'));
          break;
        }
        const nt = tierDef(p.tier + 1);
        const terr = gc.pub.territories[gc.you];
        const card = h('div', { class: 'phone-card' }, h('h3', null, `Prochain : ${next.name}`), h('p', null, next.blurb), h('p', null, `${nt.name} — ${nt.perks.join(', ')}`));
        const reasons: string[] = [];
        if (terr < nt.districts) reasons.push(`Contrôlez ${nt.districts} quartier${nt.districts > 1 ? 's' : ''} (vous : ${terr}).`);
        if (p.money < next.price) reasons.push(`Il vous faut ${formatMoney(next.price)}.`);
        for (const r of reasons) card.appendChild(h('p', null, `• ${r}`));
        card.appendChild(h('div', { class: 'row' }, this.btn(`Emménager — ${formatMoney(next.price)}`, () => this.act({ a: 'moveIn', b: next.id }, 'purchase'), reasons.length > 0)));
        this.body.appendChild(card);
        const later = RESIDENCES[gc.you].slice(p.tier + 1);
        if (later.length) this.body.appendChild(h('p', { class: 'phone-note' }, `Ensuite : ${later.map((r) => `${r.name} (${formatMoney(r.price)})`).join(' → ')}`));
        break;
      }
      case 'drones': {
        if (!p.upgrades.includes('drones')) {
          this.body.appendChild(h('p', { class: 'phone-note' }, `Amélioration requise : ${UPGRADE_BY_ID.drones.name} (bureau du QG, dès le loft).`));
          break;
        }
        this.body.appendChild(
          h('p', { class: 'phone-note' }, p.droneOver ? `Drone au-dessus ${deNom(DISTRICTS.find((d) => d.id === p.droneOver)!.name)} : ennemis visibles sur vos cartes.` : p.droneIn > 0 ? `Recharge : ${p.droneIn} s.` : 'Choisissez un quartier à survoler (60 s de reconnaissance).'),
        );
        for (const d of DISTRICTS) {
          this.body.appendChild(
            h('div', { class: 'phone-card' }, h('div', { class: 'row' }, h('h3', { style: 'flex:1' }, d.name), this.btn('Envoyer', () => this.act({ a: 'drone', d: d.id }), p.droneIn > 0))),
          );
        }
        break;
      }
      case 'convoys': {
        const convoys = gc.pub.convoys ?? [];
        const mine = convoys.find((c) => c.slot === gc.you);
        const send = h(
          'div',
          { class: 'phone-card' },
          h('h3', null, 'Envoyer un convoi'),
          h('p', null, 'Un camion blindé part de votre bâtiment logistique le plus éloigné (dépôt, usine, casse, brasserie, marché…) et rapporte l’argent à votre QG. L’adversaire est prévenu : escortez-le.'),
        );
        send.appendChild(h('div', { class: 'row' }, this.btn(mine ? 'Convoi en route' : p.convoyIn > 0 ? `Prêt dans ${p.convoyIn} s` : 'Envoyer', () => this.act({ a: 'convoy' }), !!mine || p.convoyIn > 0)));
        this.body.appendChild(send);
        if (convoys.length === 0) this.body.appendChild(h('p', { class: 'phone-note' }, 'Aucun convoi sur les routes pour l’instant.'));
        const lts = p.lieutenants.filter((l) => l.alive);
        for (const cv of convoys) {
          const own = cv.slot === gc.you;
          const name = !cv.slot ? 'Convoi de la Banque Fédérale' : own ? 'Votre convoi' : `Convoi ${DE_BOSS[cv.slot]}`;
          const me = gc.player.pos;
          const dist = Math.round(Math.hypot(cv.x - me.x, cv.z - me.z));
          const card = h('div', { class: 'phone-card' }, h('h3', null, name), h('p', null, `${formatMoney(cv.reward)} à bord · vers ${cv.dest} · à ${dist} m`));
          card.appendChild(h('div', { class: 'phone-bar' }, h('i', { style: `width:${Math.round(cv.p * 100)}%` })));
          if (!this.remote) card.appendChild(h('p', { class: 'phone-note' }, 'Ordres à distance dès le loft (palier 3) ou avec la liaison cryptée — sinon, depuis votre bureau.'));
          else if (lts.length === 0) card.appendChild(h('p', { class: 'phone-note' }, 'Aucun lieutenant disponible.'));
          else {
            const row = h('div', { class: 'row' });
            for (const lt of lts) row.appendChild(this.btn(`${own ? 'Escorte' : 'Interception'} : ${lt.name}`, () => this.act({ a: 'order', lt: lt.id, order: own ? 'escort' : 'intercept', target: cv.id })));
            card.appendChild(row);
          }
          this.body.appendChild(card);
        }
        for (const l of gc.pub.loot ?? []) {
          const me = gc.player.pos;
          this.body.appendChild(h('div', { class: 'phone-card' }, h('h3', null, `Butin : ${formatMoney(l.reward)}`), h('p', null, `Sur la chaussée, à ${Math.round(Math.hypot(l.x - me.x, l.z - me.z))} m (balise verte). Premier arrivé, premier servi !`)));
        }
        break;
      }
      default:
        break;
    }
  }
}
