// Gestion des entrées : clavier, souris, molette, verrouillage du pointeur.

import { settings } from '../settings';
import { learnKey, type ActionId } from './bindings';

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  /** Les entrées de jeu sont ignorées (menus, chat…). */
  blocked = true;
  /** Le pointeur peut être capturé (uniquement pendant une partie). */
  lockEnabled = false;
  locked = false;
  private target: HTMLElement;
  /** Rappel quand le pointeur est relâché (ex. touche Échap). */
  onUnlock: (() => void) | null = null;
  onEscape: (() => void) | null = null;
  /** Rappel générique pour les touches pressées (menus rapides). */
  onKey: ((code: string, e: KeyboardEvent) => boolean | void) | null = null;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', (e) => {
      learnKey(e);
      if (e.code === 'Escape') {
        this.onEscape?.();
        return;
      }
      if (this.onKey && this.onKey(e.code, e) === true) {
        e.preventDefault();
        return;
      }
      if (this.blocked) return;
      if (isGameKey(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (this.down.has(e.code)) this.released.add(e.code);
      this.down.delete(e.code);
    });
    target.addEventListener('mousedown', (e) => {
      if (this.blocked) return;
      const c = `Mouse${e.button}`;
      if (!this.down.has(c)) this.pressed.add(c);
      this.down.add(c);
      if (!this.locked && this.lockEnabled) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => {
      const c = `Mouse${e.button}`;
      if (this.down.has(c)) this.released.add(c);
      this.down.delete(c);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || this.blocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    target.addEventListener(
      'wheel',
      (e) => {
        if (this.blocked) return;
        const c = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
        this.pressed.add(c);
        this.released.add(c);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.target;
      if (was && !this.locked) {
        this.down.clear();
        this.onUnlock?.();
      }
    });
    window.addEventListener('blur', () => this.down.clear());
  }

  requestLock(): void {
    if (!this.lockEnabled) return;
    const p = this.target.requestPointerLock?.() as unknown;
    if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => undefined);
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** L'action est-elle maintenue ? */
  is(a: ActionId): boolean {
    if (this.blocked) return false;
    for (const c of settings.bindings[a]) if (this.down.has(c)) return true;
    return false;
  }

  /** L'action vient-elle d'être déclenchée (front montant) ? */
  hit(a: ActionId): boolean {
    if (this.blocked) return false;
    for (const c of settings.bindings[a]) if (this.pressed.has(c)) return true;
    return false;
  }

  /** L'action vient-elle d'être relâchée ? */
  up(a: ActionId): boolean {
    for (const c of settings.bindings[a]) if (this.released.has(c)) return true;
    return false;
  }

  /** À appeler à la fin de chaque image. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  reset(): void {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
  }
}

function isGameKey(code: string): boolean {
  return code === 'Space' || code === 'Tab' || code.startsWith('Arrow') || code === 'Backquote';
}
