// Ascenseurs pour le joueur : devant une porte d'ascenseur (tours, penthouses, sièges de
// société), « E : Ascenseur » ouvre le choix de l'étage ; le serveur vérifie et déplace le parrain.

import { actionKey } from '../input/bindings';
import { settings } from '../settings';
import { audio } from '../audio/AudioEngine';
import { h } from '../ui/dom';
import type { GameClient } from './GameClient';
import type { ClientModule, Interaction } from './modules';

/** Même portée que le serveur (server/game/elevator.ts), un peu plus courte pour la marge. */
const REACH = 2.3;
const FLOOR_TOL = 1.6;

export function createElevatorClient(gc: GameClient): ClientModule {
  let panel: HTMLElement | null = null;
  let choices: (() => void)[] = [];

  // le jeu ne transmet pas les touches pendant un panneau modal : écoute directe des chiffres
  const onKeyDown = (e: KeyboardEvent): void => {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (!panel || !m || !choices[Number(m[1]) - 1]) return;
    e.preventDefault();
    e.stopPropagation();
    choices[Number(m[1]) - 1]();
  };
  const close = (): void => {
    if (!panel) return;
    panel = null;
    choices = [];
    window.removeEventListener('keydown', onKeyDown, true);
    gc.closeModal();
    gc.app.input.requestLock();
  };

  /** Arrêt d'ascenseur devant lequel se tient le joueur : immeuble et index de l'arrêt. */
  const stopHere = (): { bid: number; i: number } | null => {
    const me = gc.player.pos;
    for (const b of gc.world.buildings) {
      const stops = b.elevator;
      if (!stops) continue;
      const i = stops.findIndex((s) => Math.hypot(s.x - me.x, s.z - me.z) < REACH && Math.abs(s.y - me.y) < FLOOR_TOL);
      if (i >= 0) return { bid: b.id, i };
    }
    return null;
  };

  const open = (bid: number, here: number): void => {
    const b = gc.world.buildings.find((x) => x.id === bid);
    const stops = b?.elevator;
    if (!stops) return;
    audio.play('ui_open', { volume: 0.5 });
    choices = [];
    const list = h('div', { class: 'mw-elev-list' });
    stops.forEach((s, i) => {
      const n = choices.length + 1;
      const go = (): void => {
        close();
        gc.app.net.act({ a: 'elevator', b: bid, to: i });
      };
      const btn = h('button', { class: `btn${i === here ? ' ghost' : ''}`, type: 'button' }, `${i === here ? '•' : n}  ${s.label}`);
      if (i === here) btn.disabled = true;
      else {
        choices.push(go);
        btn.addEventListener('click', go);
      }
      list.append(btn);
    });
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Annuler (Échap)');
    cancel.addEventListener('click', close);
    panel = h(
      'div',
      { class: 'panel mw-elev', role: 'dialog', 'aria-label': 'Ascenseur' },
      h('h2', { class: 'title-l' }, 'Ascenseur'),
      h('p', { class: 'dim' }, `${b!.def.name} — vous êtes : ${stops[here].label}. Choisissez l’étage (touches 1 à ${choices.length}).`),
      list,
      cancel,
    );
    gc.openModal(panel);
    window.addEventListener('keydown', onKeyDown, true);
  };

  return {
    interaction(): Interaction | null {
      if (gc.player.dead || gc.player.drive) return null;
      const s = stopHere();
      if (!s) return null;
      const b = gc.world.buildings.find((x) => x.id === s.bid)!;
      return { key: actionKey(settings.bindings, 'interact'), text: 'Ascenseur', sub: `${b.elevator![s.i].label} — choisir un étage`, run: () => open(s.bid, s.i) };
    },
    onEscape(): boolean {
      if (!panel) return false;
      close();
      return true;
    },
    blocking(): boolean {
      return !!panel;
    },
    reset(): void {
      if (panel) close();
    },
  };
}
