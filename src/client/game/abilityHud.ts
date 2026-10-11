// Barre des capacités cybernétiques (HUD, bas de l'écran) : une pastille par implant à
// déclencher — pictogramme à sa couleur, touche, recharge en balayage radial, charges
// (esquive), état actif (bouclier, camouflage, réflexes, vision…), arme de bras sortie et
// munitions ; jauges du sprint renforcé et du bouclier. Les données viennent de cyberState
// (contrôleur des capacités) ou, à défaut, de l'état privé du serveur. Mise à jour à 10 Hz au
// plus, en ne touchant qu'aux valeurs qui changent. Masquée sans implant installé.

import { IMPLANT_BY_ID, SLOTS, implantParams } from '../../shared/implants';
import type { CyberState, PrivateState } from '../../shared/protocol';
import { h, clear } from '../ui/dom';
import { chipKey, hex, implantIcon, num } from './cyberFormat';
import { cyberState, implantControls, type AbilityView, type VisionMode } from './cyberState';
import type { GameClient } from './GameClient';
import type { Hud } from './hud';
import type { ClientModule } from './modules';

export interface AbilityHost {
  priv(): PrivateState;
  /** Élément du HUD où poser la barre. */
  readonly mount: HTMLElement;
  /** HUD de la partie (affichage de l'arme de bras sortie), absent du laboratoire. */
  readonly hud?: Hud | null;
}

/** Texte de l'étiquette d'une capacité en cours. */
const ACTIVE_TAG: Record<string, string> = {
  grappin: 'ACCROCHÉ',
  bouclier: 'BOUCLIER',
  camouflage: 'INVISIBLE',
  reflexes: 'SURRÉGIME',
  surcharge: 'SURCHARGE',
  scanner: 'SCAN',
  thermique: 'THERMIQUE',
  nocturne: 'NOCTURNE',
  liaisonDrone: 'DRONE',
  secondSouffle: 'INVULNÉRABLE',
  bond: 'CHARGE',
};

interface Chip {
  id: string;
  el: HTMLElement;
  cdTxt: HTMLElement;
  pips: HTMLElement[];
  tag: HTMLElement;
  ammo: HTMLElement;
  cd: number;
  text: string;
  blocked: boolean;
  charges: number;
  on: boolean;
  out: boolean;
  tagText: string;
  ammoText: string;
  readyTimer: number;
}

/** Vue des capacités tirée de l'état privé (2 Hz), quand le contrôleur ne remplit pas cyberState. */
function fromPriv(c: CyberState): AbilityView[] {
  const lvl = (id: string) => (SLOTS.some((s) => c.equip[s.id] === id) ? (c.owned[id] ?? 1) : 0);
  const cdr = (id: string) => (lvl(id) ? (implantParams(id, lvl(id)).cdr ?? 0) : 0);
  const mul = 1 - Math.min(0.35, cdr('accumulateur') + cdr('coprocesseur'));
  return implantControls(c.equip).map((ctl) => {
    const def = IMPLANT_BY_ID[ctl.id];
    const p = implantParams(ctl.id, c.owned[ctl.id] ?? 1);
    // armes de bras : « cd » est la cadence de tir, pas une recharge
    const cdMax = def?.kind === 'arme' ? 0 : (p.cd ?? 0) * mul;
    return {
      id: ctl.id,
      action: ctl.action,
      hint: ctl.hint,
      cd: c.cd[ctl.id] ?? 0,
      cdMax,
      charges: c.charges[ctl.id] ?? -1,
      chargesMax: p.charges ?? -1,
      active: false,
    };
  });
}

/** Ce qui mérite une pastille : une touche, un geste (saut, accroupi), une recharge ou un état. */
function shown(a: AbilityView): boolean {
  const def = IMPLANT_BY_ID[a.id];
  if (!def) return false;
  return !!a.action || def.trigger === 'saut' || def.trigger === 'accroupi' || a.cdMax > 0 || a.active;
}

export class AbilityHud implements ClientModule {
  readonly el: HTMLElement;
  private host: AbilityHost;
  private chipsEl: HTMLElement;
  private energyEl: HTMLElement;
  private energyFill: HTMLElement;
  private shieldEl: HTMLElement;
  private shieldFill: HTMLElement;
  private shieldVal: HTMLElement;
  private chips: Chip[] = [];
  private structSig = '';
  private acc = 1;
  private visible = false;
  private energy = -2;
  private shield = -1;
  private armSig = '';

  constructor(host: AbilityHost) {
    this.host = host;
    this.chipsEl = h('div', { class: 'ab-chips' });
    this.energyFill = h('i');
    this.energyEl = h('div', { class: 'ab-meter hidden' }, h('span', null, 'Sprint'), h('div', { class: 'bar' }, this.energyFill));
    this.shieldFill = h('i');
    this.shieldVal = h('b');
    this.shieldEl = h('div', { class: 'ab-meter shield hidden' }, h('span', null, 'Bouclier ', this.shieldVal), h('div', { class: 'bar' }, this.shieldFill));
    this.el = h('div', { class: 'ab-bar hidden', 'aria-hidden': 'true' }, this.energyEl, this.chipsEl, this.shieldEl);
    host.mount.appendChild(this.el);
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    this.refresh();
  }

  onPriv(): void {
    // nouvel équipement : la barre suit sans attendre le prochain dixième de seconde
    if (cyberState.at <= 0) this.acc = 1;
  }

  reset(): void {
    this.structSig = '';
    this.setArm(null);
    clear(this.chipsEl);
    this.chips = [];
    this.show(false);
  }

  dispose(): void {
    this.setArm(null);
    for (const c of this.chips) clearTimeout(c.readyTimer);
    this.el.remove();
  }

  /** Données du contrôleur si elles sont fraîches, sinon l'état privé du serveur. */
  private source(): { list: AbilityView[]; vision: VisionMode; energy: number; shield: number; shieldMax: number } {
    const fresh = cyberState.at > 0 && performance.now() / 1000 - cyberState.at < 1.5;
    if (fresh) return { list: cyberState.abilities, vision: cyberState.vision, energy: cyberState.energy, shield: cyberState.shield, shieldMax: cyberState.shieldMax };
    return { list: fromPriv(this.host.priv().cyber), vision: 'normal', energy: -1, shield: 0, shieldMax: 0 };
  }

  refresh(): void {
    const priv = this.host.priv();
    const any = SLOTS.some((s) => priv.cyber.equip[s.id]);
    const src = this.source();
    const list = any ? src.list.filter(shown) : [];
    const energy = any ? src.energy : -1;
    const shield = any && src.shieldMax > 0 && src.shield > 0 ? src.shield / src.shieldMax : -1;
    this.show(list.length > 0 || energy >= 0 || shield >= 0);
    // structure (pastilles) : seulement si l'équipement ou les touches changent
    const sig = list.map((a) => `${a.id}:${chipKey(a.action, a.id)}:${a.chargesMax}`).join('|');
    if (sig !== this.structSig) {
      this.structSig = sig;
      this.build(list);
    }
    for (let i = 0; i < list.length; i++) this.updateChip(this.chips[i], list[i], src.vision);
    // jauges
    if (energy !== this.energy) {
      const was = this.energy;
      this.energy = energy;
      this.energyEl.classList.toggle('hidden', energy < 0);
      if (energy >= 0) {
        if (Math.abs(energy - was) > 0.004) this.energyFill.style.width = `${Math.round(energy * 1000) / 10}%`;
        this.energyEl.classList.toggle('full', energy >= 0.995);
      }
    }
    if (shield !== this.shield) {
      this.shield = shield;
      this.shieldEl.classList.toggle('hidden', shield < 0);
      if (shield >= 0) {
        this.shieldFill.style.width = `${Math.round(shield * 1000) / 10}%`;
        this.shieldVal.textContent = String(Math.round(src.shield));
      }
    }
    // arme de bras sortie : le HUD de l'arme affiche son chargeur
    const arm = list.find((a) => a.out);
    this.setArm(arm ?? null);
  }

  private show(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
  }

  private build(list: AbilityView[]): void {
    for (const c of this.chips) clearTimeout(c.readyTimer);
    clear(this.chipsEl);
    this.chips = list.map((a) => {
      const def = IMPLANT_BY_ID[a.id];
      const key = chipKey(a.action, a.id);
      const el = h('div', { class: 'ab-chip', style: `--c:${hex(def.color)}`, html: implantIcon(a.id) });
      const cdTxt = h('div', { class: 'ab-cdtxt' });
      const tag = h('span', { class: 'ab-tag hidden' });
      const ammo = h('div', { class: 'ab-ammo' });
      const pips: HTMLElement[] = [];
      // recharge : voile radial par-dessus le pictogramme, puis le décompte
      el.appendChild(h('div', { class: 'ab-sweep' }));
      el.appendChild(cdTxt);
      el.appendChild(h('span', { class: `ab-key${key === 'AUTO' ? ' auto' : ''}` }, key));
      if (a.chargesMax > 1) {
        const row = h('div', { class: 'ab-pips' });
        for (let i = 0; i < a.chargesMax; i++) pips.push(row.appendChild(h('i', { class: 'on' })));
        el.appendChild(row);
      }
      el.appendChild(tag);
      el.appendChild(ammo);
      this.chipsEl.appendChild(el);
      return { id: a.id, el, cdTxt, pips, tag, ammo, cd: -1, text: '', blocked: false, charges: -2, on: false, out: false, tagText: '', ammoText: '', readyTimer: 0 };
    });
  }

  private updateChip(c: Chip, a: AbilityView, vision: VisionMode): void {
    const def = IMPLANT_BY_ID[a.id];
    const frac = a.cdMax > 0 ? Math.max(0, Math.min(1, a.cd / a.cdMax)) : 0;
    const cd = Math.round(frac * 200) / 200;
    if (cd !== c.cd) {
      c.cd = cd;
      c.el.style.setProperty('--cd', String(cd));
    }
    const text = a.cd > 0.05 && a.cdMax > 0 ? (a.cd < 10 ? num(a.cd, 1) : String(Math.ceil(a.cd))) : '';
    if (text !== c.text) {
      c.text = text;
      c.cdTxt.textContent = text;
    }
    // indisponible : en recharge et sans charge restante
    const blocked = a.cd > 0.05 && a.cdMax > 0 && a.charges <= 0;
    if (blocked !== c.blocked) {
      if (c.blocked && !blocked) {
        // de nouveau prête : petit éclat
        c.el.classList.remove('ready');
        void c.el.offsetWidth;
        c.el.classList.add('ready');
        clearTimeout(c.readyTimer);
        c.readyTimer = window.setTimeout(() => c.el.classList.remove('ready'), 600);
      }
      c.blocked = blocked;
      c.el.classList.toggle('cd', blocked);
    }
    if (c.pips.length && a.charges !== c.charges) {
      c.charges = a.charges;
      c.pips.forEach((p, i) => p.classList.toggle('on', i < a.charges));
    }
    const visionOn = def?.trigger === 'vision' && ((vision === 'thermal' && a.id === 'thermique') || (vision === 'night' && a.id === 'nocturne'));
    const on = a.active || visionOn;
    if (on !== c.on) {
      c.on = on;
      c.el.classList.toggle('on', on);
    }
    const out = !!a.out;
    if (out !== c.out) {
      c.out = out;
      c.el.classList.toggle('out', out);
    }
    const tag = out ? 'SORTI' : on ? (ACTIVE_TAG[a.id] ?? 'ACTIF') : '';
    if (tag !== c.tagText) {
      c.tagText = tag;
      c.tag.textContent = tag;
      c.tag.classList.toggle('hidden', !tag);
    }
    const ammo = out && a.ammo !== undefined ? `${a.ammo}/${a.ammoMax ?? '∞'}` : '';
    if (ammo !== c.ammoText) {
      c.ammoText = ammo;
      c.ammo.textContent = ammo;
    }
  }

  /** Arme de bras sortie (pistolet d'avant-bras : chargeur) affichée par le HUD de l'arme. */
  private setArm(a: AbilityView | null): void {
    const hud = this.host.hud;
    if (!hud) return;
    const ammo = a && a.ammo !== undefined ? a : null;
    const sig = ammo ? `${ammo.id}:${ammo.ammo}:${ammo.ammoMax}:${ammo.action}` : '';
    if (sig === this.armSig) return;
    this.armSig = sig;
    if (!ammo) {
      hud.armWeapon = null;
      return;
    }
    hud.armWeapon = { name: IMPLANT_BY_ID[ammo.id]?.name ?? 'Arme de bras', ammo: ammo.ammo ?? 0, ammoMax: ammo.ammoMax };
  }
}

export function createAbilityHud(gc: GameClient): AbilityHud {
  return new AbilityHud({ priv: () => gc.priv, mount: gc.hud.el, hud: gc.hud });
}
