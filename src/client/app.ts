// Application : enchaînement des écrans (menu, salon, chargement, partie, victoire).

import '@fontsource/cinzel/latin-400.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cinzel/latin-900.css';
import '@fontsource/cinzel-decorative/latin-700.css';
import '@fontsource/cinzel-decorative/latin-900.css';
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/eb-garamond/latin-600.css';
import '@fontsource/unifrakturmaguntia/latin-400.css';
import './ui/theme.css';
import './ui/screens.css';
import './ui/hud.css';
import './ui/game.css';
import { audio } from './audio/AudioEngine';
import type { AppApi, Portraits } from './appApi';
import { Net } from './net/net';
import { Input } from './input/input';
import { loadKeyboardLayout } from './input/bindings';
import { onSettingsChange, saveSettings, settings } from './settings';
import { h, clear } from './ui/dom';
import { loadWorld, onWorldProgress, type WorldData } from './world/worldLoader';
import { mainMenu } from './ui/screens/menu';
import { lobbyScreen } from './ui/screens/lobby';
import { settingsPanel } from './ui/screens/settings';
import { controlsPanel } from './ui/screens/controls';
import { helpPanel, creditsPanel } from './ui/screens/help';
import { loadingScreen } from './ui/screens/loading';
import { renderPortraits } from './ui/portraits';
import { GameClient, type GameInit } from './game/GameClient';
import type { RoomState } from '../shared/protocol';

export class App implements AppApi {
  readonly root: HTMLElement;
  readonly net: Net;
  readonly audio = audio;
  readonly input: Input;
  readonly screens: HTMLElement;
  readonly portraits: Promise<Portraits>;
  readonly worldReady: Promise<void>;
  private world: WorldData | null = null;
  private screenDispose: (() => void) | null = null;
  game: GameClient | null = null;
  private current = '';

  constructor(root: HTMLElement) {
    this.root = root;
    this.screens = h('div', { class: 'layer screens' });
    root.appendChild(this.screens);
    this.input = new Input(root);
    this.net = new Net();
    void loadKeyboardLayout();
    this.applyVolumes();
    onSettingsChange(() => this.applyVolumes());
    // le monde se génère en arrière-plan pendant les menus
    const wp = loadWorld();
    this.worldReady = wp.then((w) => {
      this.world = w;
    });
    this.portraits = renderPortraits();
    // débloque l'audio au premier geste
    const unlock = () => {
      audio.unlock();
      if (this.current === 'menu' || this.current === 'lobby') audio.playMusic('menu');
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    // événements réseau globaux
    this.net.on('game:init', (init: GameInit) => void this.enterGame(init));
    this.net.on('room', (s: RoomState) => {
      if (s.phase === 'lobby' && this.current !== 'lobby' && !this.game && this.current !== 'settings' && this.current !== 'controls') {
        // rien : on reste sur l'écran actuel tant que le joueur n'a pas rejoint
      }
    });
    this.net.on('connected', (room: string | null) => {
      if (room && !this.game && this.current !== 'lobby') this.showLobby();
    });
    // invitation directe : ?code=ABCD
    const code = new URLSearchParams(location.search).get('code');
    this.showMenu();
    if (code) void this.joinRoom(code).then((err) => err && alert(err));
  }

  private applyVolumes(): void {
    audio.setVolumes({ master: settings.volMaster, music: settings.volMusic, sfx: settings.volSfx, ambience: settings.volAmbience });
  }

  click(): void {
    audio.play('ui_click');
  }

  private setScreen(name: string, el: HTMLElement, dispose?: () => void): void {
    this.screenDispose?.();
    this.screenDispose = dispose ?? null;
    clear(this.screens);
    this.screens.appendChild(el);
    this.current = name;
  }

  showMenu(): void {
    this.setScreen('menu', mainMenu(this));
    if (audio.ready) audio.playMusic('menu');
  }

  showLobby(): void {
    const l = lobbyScreen(this);
    this.setScreen('lobby', l.el, l.dispose);
  }

  showSettings(): void {
    this.setScreen('settings', h('div', { class: 'screen backdrop' }, settingsPanel(this, { inGame: false, onClose: () => this.back() })));
  }

  showControls(): void {
    this.setScreen('controls', h('div', { class: 'screen backdrop' }, controlsPanel(this, { onClose: () => this.back() })));
  }

  showHelp(): void {
    this.setScreen('help', h('div', { class: 'screen backdrop' }, helpPanel(this, { onClose: () => this.back() })));
  }

  showCredits(): void {
    this.setScreen('credits', h('div', { class: 'screen backdrop' }, creditsPanel(this, { onClose: () => this.back() })));
  }

  private back(): void {
    if (this.net.room) this.showLobby();
    else this.showMenu();
  }

  async createRoom(): Promise<string | null> {
    try {
      const r = await this.net.createRoom();
      if (!r.ok) return r.error ?? 'Impossible de créer la partie.';
      this.showLobby();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  async joinRoom(code: string): Promise<string | null> {
    try {
      const r = await this.net.joinRoom(code);
      if (!r.ok) return r.error ?? 'Impossible de rejoindre la partie.';
      this.showLobby();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  leaveRoom(): void {
    this.net.leaveRoom();
    this.showMenu();
  }

  /** Lancement (ou reprise) d'une partie. */
  private async enterGame(init: GameInit): Promise<void> {
    if (this.game) {
      // reprise après reconnexion ou revanche
      this.game.reinit(init);
      return;
    }
    if (!this.world) {
      const ls = loadingScreen();
      const off = onWorldProgress((step, f) => ls.set(step, f));
      this.setScreen('loading', ls.el, off);
      await this.worldReady;
    }
    const ls = loadingScreen();
    ls.set('Les réverbères s’allument…', 1);
    this.setScreen('loading', ls.el);
    await new Promise((r) => setTimeout(r, 30));
    this.game = new GameClient(this, this.world!, init);
    this.setScreen('game', h('div'));
    this.game.onExit = () => {
      this.game?.dispose();
      this.game = null;
      this.net.leaveRoom();
      this.showMenu();
    };
  }

  saveName(name: string): void {
    settings.name = name.trim().slice(0, 24) || 'Joueur';
    saveSettings();
    this.net.setName(settings.name);
  }
}
