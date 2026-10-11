// Surimpressions cybernétiques à l'écran (au-dessus de la vue 3D, sous le HUD, sans souris) :
// marques des cibles à travers les murs (losange rouge + distance), révélations du scanner
// (crochets verts + type + distance) et onde de scan, alertes de visée (arcs rouges au bord de
// l'écran vers les ennemis qui vous visent), visée du grappin autour du réticule, lignes de
// vitesse, voiles des états (réflexes, surcharge, camouflage, cœur de secours), cadre et balayage
// des visions, éclairs plein écran (réception lourde, IEM…).
//
// Une seule toile 2D redessinée seulement quand quelque chose est affiché ; les voiles et éclairs
// sont des calques CSS (dégradés animés par le compositeur). Aucune interaction souris.
//
// Utilisation :
//   const ov = new CyberOverlay(parentDuHud);         // inséré en premier enfant (sous le HUD)
//   ov.update(dt, camera, largeur, hauteur);           // à chaque image
//   ov.setMarks([...]); ov.setThreats([...]); ov.setGrappleAim('ok'); ov.setSpeed(v);
//   ov.setTint('reflex'); ov.setVision('thermal'); ov.scan(origine, rayon, révélés, durée);
//   ov.flash('land', 0.8);

import * as THREE from 'three';

export type GrappleAim = 'none' | 'ok' | 'far';
export type OverlayTint = 'reflex' | 'overcharge' | 'camo' | 'secondWind';
export type OverlayVision = 'normal' | 'thermal' | 'night';

/** Cible marquée : (x, y, z) = point où dessiner le losange (au-dessus de la tête). */
export interface OverlayMark {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Texte facultatif au-dessus du losange (implants révélés…). */
  label?: string;
}

/** Élément révélé par le scanner : (x, y, z) = pieds / base de l'objet. */
export interface ScanReveal {
  x: number;
  y: number;
  z: number;
  kind?: 'enemy' | 'camera' | 'turret' | 'terminal' | 'door' | 'objective';
  label?: string;
}

const KIND_LABEL: Record<NonNullable<ScanReveal['kind']>, string> = {
  enemy: 'ENNEMI',
  camera: 'CAMÉRA',
  turret: 'TOURELLE',
  terminal: 'TERMINAL',
  door: 'PORTE',
  objective: 'OBJECTIF',
};

const STYLE_ID = 'cy-overlay-style';
const CSS = `
.cy-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.cy-overlay canvas{position:absolute;inset:0;width:100%;height:100%}
.cy-vig{position:absolute;inset:0;opacity:0;transition:opacity .25s ease}
.cy-vig.on{opacity:1}
.cy-reflex{background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(40,80,170,.16) 80%,rgba(10,22,70,.36) 100%);box-shadow:inset 0 0 90px rgba(255,205,90,.14)}
.cy-overcharge{background:radial-gradient(ellipse at center,rgba(0,0,0,0) 50%,rgba(255,50,20,.2) 80%,rgba(150,0,0,.5) 100%)}
.cy-overcharge.on{animation:cy-pulse 1.1s ease-in-out infinite}
.cy-camo{background:repeating-linear-gradient(0deg,rgba(150,255,255,.035) 0 2px,rgba(0,0,0,0) 2px 5px),radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(60,220,230,.16) 82%,rgba(0,90,110,.4) 100%)}
.cy-camo.on{animation:cy-shimmer 2.4s linear infinite}
.cy-secondWind{background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(60,255,140,.22) 78%,rgba(0,110,50,.5) 100%)}
.cy-secondWind.on{animation:cy-beat .85s linear infinite}
.cy-flash{position:absolute;inset:0;opacity:0}
@keyframes cy-pulse{0%,100%{opacity:.6}50%{opacity:1}}
@keyframes cy-shimmer{0%{background-position:0 0,0 0}100%{background-position:0 40px,0 0}}
@keyframes cy-beat{0%{opacity:.25}7%{opacity:1}20%{opacity:.35}27%{opacity:.85}45%{opacity:.25}100%{opacity:.25}}
`;

interface MarkState {
  m: OverlayMark;
  born: number;
  seen: number;
}

interface Reveal extends ScanReveal {
  until: number;
  dur: number;
}

interface SpeedLine {
  a: number;
  r: number;
  len: number;
  life: number;
  max: number;
  w: number;
}

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();

export class CyberOverlay {
  readonly el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private vig: Record<OverlayTint, HTMLElement>;
  private flashEl: HTMLElement;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private dirty = false;
  private time = 0;
  private marks = new Map<number, MarkState>();
  private markGen = 0;
  private threats: { a: number; k: number; live: boolean }[] = [];
  private aim: GrappleAim = 'none';
  private aimK = 0;
  private aimDist = -1;
  /** Télémètre (optique télescopique) : distance visée, valeur affichée (lissée), opacité. */
  private range = -1;
  private rangeShow = 0;
  private rangeK = 0;
  private speed = 0;
  private speedK = 0;
  private lines: SpeedLine[] = [];
  private reveals: Reveal[] = [];
  /** Étiquettes de scan posées dans cette image (x, y, largeur) : évite qu'elles se chevauchent. */
  private placed: number[] = [];
  private pulses: { t: number; dur: number }[] = [];
  private vision: OverlayVision = 'normal';
  private visionT = 0;
  private visionK = 0;
  private flashT = 0;

  constructor(parent: HTMLElement) {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'cy-overlay';
    const mk = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      this.el.appendChild(d);
      return d;
    };
    this.vig = {
      reflex: mk('cy-vig cy-reflex'),
      overcharge: mk('cy-vig cy-overcharge'),
      camo: mk('cy-vig cy-camo'),
      secondWind: mk('cy-vig cy-secondWind'),
    };
    this.flashEl = mk('cy-flash');
    this.cv = document.createElement('canvas');
    // masqué au repos : pas de calque plein écran à composer pour rien
    this.cv.style.display = 'none';
    this.el.appendChild(this.cv);
    this.g = this.cv.getContext('2d')!;
    parent.insertBefore(this.el, parent.firstChild);
  }

  // ===================================================================== API

  /** Cibles marquées (remplace la liste ; les nouvelles apparaissent avec un petit effet). */
  setMarks(list: OverlayMark[]): void {
    const gen = ++this.markGen;
    for (const m of list) {
      const s = this.marks.get(m.id);
      if (s) {
        s.m = m;
        s.seen = gen;
      } else this.marks.set(m.id, { m, born: this.time, seen: gen });
    }
    for (const [id, s] of this.marks) if (s.seen !== gen) this.marks.delete(id);
  }

  /**
   * Ennemis qui vous visent : angles (rad) relatifs à la direction du regard, convention
   * atan2(dx, dz) − lacet du joueur (0 = devant, positif = vers la gauche).
   */
  setThreats(dirs: number[]): void {
    for (const t of this.threats) t.live = false;
    for (const a of dirs) {
      let best: { a: number; k: number; live: boolean } | null = null;
      let bd = 0.35;
      for (const t of this.threats) {
        const d = Math.abs(Math.atan2(Math.sin(a - t.a), Math.cos(a - t.a)));
        if (!t.live && d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best) {
        best.a = a;
        best.live = true;
      } else this.threats.push({ a, k: 0, live: true });
    }
  }

  /** Visée du grappin autour du réticule : point accrochable ('ok'), trop loin ('far'), rien. */
  setGrappleAim(s: GrappleAim, dist = -1): void {
    this.aim = s;
    this.aimDist = dist;
  }

  /**
   * Télémètre de l'optique télescopique (niveau 2 et plus, en visant) : distance du point visé
   * (m), affichée à gauche sous le réticule ; négative : masqué.
   */
  setRange(dist: number): void {
    if (!Number.isFinite(dist) || dist < 0) {
      this.range = -1;
      return;
    }
    if (this.range < 0 && this.rangeK <= 0) this.rangeShow = dist;
    this.range = dist;
  }

  /** Vitesse du joueur (m/s) : lignes de vitesse au-delà de ~9 m/s. */
  setSpeed(mps: number): void {
    this.speed = Number.isFinite(mps) ? mps : 0;
  }

  /** Voile d'état exclusif (ou aucun). */
  setTint(kind: OverlayTint | null): void {
    this.setTints(kind ? [kind] : []);
  }

  /** Plusieurs voiles à la fois. */
  setTints(kinds: readonly OverlayTint[]): void {
    for (const k of Object.keys(this.vig) as OverlayTint[]) this.vig[k].classList.toggle('on', kinds.includes(k));
  }

  /** Vision active : balayage de transition, cadre et mention discrète. */
  setVision(mode: OverlayVision): void {
    if (mode === this.vision) return;
    this.vision = mode;
    this.visionT = 0.32;
  }

  /**
   * Impulsion du scanner : onde à l'écran, puis les éléments révélés restent signalés `dur`
   * secondes (positions figées au moment du scan ; les ennemis suivis passent par setMarks).
   */
  scan(origin: { x: number; y: number; z: number }, radius: number, revealed: ScanReveal[] = [], dur = 6): void {
    void origin;
    void radius;
    this.pulses.push({ t: 0, dur: 0.75 });
    const until = this.time + dur;
    for (const r of revealed) this.reveals.push({ ...r, until, dur });
    if (this.reveals.length > 80) this.reveals.splice(0, this.reveals.length - 80);
  }

  /** Éclair plein écran : réception lourde ('land'), IEM ('emp'), bouclier brisé ('break'), cœur de secours ('revive'). */
  flash(kind: 'land' | 'emp' | 'break' | 'revive', strength = 1): void {
    const k = Math.max(0, Math.min(1, strength));
    const bg: Record<string, string> = {
      land: `radial-gradient(ellipse at 50% 120%,rgba(220,210,190,${0.55 * k}) 0%,rgba(160,150,140,${0.2 * k}) 45%,rgba(0,0,0,0) 75%)`,
      emp: `radial-gradient(ellipse at center,rgba(200,240,255,${0.5 * k}) 0%,rgba(120,200,255,${0.25 * k}) 60%,rgba(60,120,255,${0.35 * k}) 100%)`,
      break: `radial-gradient(ellipse at center,rgba(0,0,0,0) 40%,rgba(120,230,255,${0.45 * k}) 100%)`,
      revive: `radial-gradient(ellipse at center,rgba(230,255,235,${0.6 * k}) 0%,rgba(80,255,150,${0.3 * k}) 60%,rgba(0,140,60,${0.4 * k}) 100%)`,
    };
    const f = this.flashEl;
    f.style.transition = 'none';
    f.style.background = bg[kind];
    f.style.opacity = '1';
    void f.offsetWidth;
    f.style.transition = `opacity ${kind === 'land' ? 0.35 : 0.5}s ease-out`;
    f.style.opacity = '0';
    this.flashT = 0;
  }

  /** Efface tout ce qui est affiché (nouvelle partie, mort). */
  clear(): void {
    this.marks.clear();
    this.threats = [];
    this.reveals = [];
    this.pulses = [];
    this.lines = [];
    this.aim = 'none';
    this.aimK = 0;
    this.range = -1;
    this.rangeK = 0;
    this.speed = 0;
    this.speedK = 0;
    this.setTints([]);
  }

  /** À chaque image. viewportW/H : taille CSS de la vue (px). */
  update(dt: number, camera: THREE.Camera, viewportW: number, viewportH: number): void {
    this.time += dt;
    this.flashT += dt;
    // animations des éléments
    for (const t of this.threats) t.k = t.live ? Math.min(1, t.k + dt * 6) : t.k - dt * 3;
    this.threats = this.threats.filter((t) => t.k > 0);
    this.aimK = this.aim === 'none' ? Math.max(0, this.aimK - dt * 6) : Math.min(1, this.aimK + dt * 8);
    this.rangeK = this.range < 0 ? Math.max(0, this.rangeK - dt * 6) : Math.min(1, this.rangeK + dt * 8);
    // la valeur suit la mesure (10 Hz) en douceur, comme un vrai télémètre qui « roule »
    if (this.range >= 0) this.rangeShow += (this.range - this.rangeShow) * Math.min(1, dt * 14);
    const sk = Math.max(0, Math.min(1, (this.speed - 9) / 12));
    this.speedK += (sk - this.speedK) * Math.min(1, dt * 6);
    this.visionT = Math.max(0, this.visionT - dt);
    this.visionK += ((this.vision === 'normal' ? 0 : 1) - this.visionK) * Math.min(1, dt * 5);
    for (const p of this.pulses) p.t += dt;
    this.pulses = this.pulses.filter((p) => p.t < p.dur);
    this.reveals = this.reveals.filter((r) => r.until > this.time);
    const busy =
      this.marks.size > 0 ||
      this.threats.length > 0 ||
      this.aimK > 0 ||
      this.rangeK > 0 ||
      this.speedK > 0.01 ||
      this.visionK > 0.01 ||
      this.visionT > 0 ||
      this.pulses.length > 0 ||
      this.reveals.length > 0;
    if (!busy) {
      if (this.dirty) {
        // effacé puis masqué (un canevas vidé mais affiché peut montrer un ancien tampon)
        this.g.setTransform(1, 0, 0, 1, 0, 0);
        this.g.clearRect(0, 0, this.cv.width, this.cv.height);
        this.cv.style.display = 'none';
        this.dirty = false;
      }
      return;
    }
    if (!this.dirty) this.cv.style.display = '';
    this.resize(viewportW, viewportH);
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.dirty = true;
    camera.updateMatrixWorld();
    camera.getWorldPosition(_c);
    if (this.speedK > 0.01) this.drawSpeed(dt);
    if (this.visionK > 0.01 || this.visionT > 0) this.drawVision();
    for (const p of this.pulses) this.drawPulse(p.t / p.dur);
    this.placed.length = 0;
    for (const r of this.reveals) this.drawReveal(r, camera);
    for (const s of this.marks.values()) this.drawMark(s, camera);
    for (const t of this.threats) this.drawThreat(t.a, t.k);
    if (this.aimK > 0) this.drawAim();
    if (this.rangeK > 0) this.drawRange();
  }

  dispose(): void {
    this.el.remove();
  }

  // ===================================================================== dessin

  private resize(w: number, h: number): void {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.cv.width = Math.max(1, Math.round(w * dpr));
    this.cv.height = Math.max(1, Math.round(h * dpr));
  }

  /**
   * Projette un point du monde à l'écran. Renvoie [x, y, devant] en pixels CSS ; un point
   * derrière la caméra est renvoyé dans la bonne direction (pour l'épingler au bord).
   */
  private project(x: number, y: number, z: number, camera: THREE.Camera): [number, number, boolean] {
    _v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    const front = _v.z < -0.05;
    if (!front) {
      // derrière : on garde le côté (droite / gauche, haut / bas) et on pousse loin hors champ
      _v.z = -0.05;
      _v.x *= 1e3;
      _v.y *= 1e3;
    }
    _v.applyMatrix4(camera.projectionMatrix);
    return [(_v.x * 0.5 + 0.5) * this.w, (-_v.y * 0.5 + 0.5) * this.h, front];
  }

  /** Ramène un point au bord de l'écran (marge m) ; renvoie l'angle de la flèche si épinglé. */
  private pin(x: number, y: number, front: boolean, m: number): [number, number, number | null] {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const inside = front && x > m && x < this.w - m && y > m && y < this.h - m;
    if (inside) return [x, y, null];
    let dx = x - cx;
    let dy = y - cy;
    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
    const sx = (cx - m) / Math.abs(dx || 1e-3);
    const sy = (cy - m) / Math.abs(dy || 1e-3);
    const s = Math.min(sx, sy);
    dx *= s;
    dy *= s;
    return [cx + dx, cy + dy, Math.atan2(dy, dx)];
  }

  private label(text: string, x: number, y: number, col: string, size = 12, align: CanvasTextAlign = 'center'): void {
    const g = this.g;
    g.font = `600 ${size}px Rajdhani, "Segoe UI", system-ui, sans-serif`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(4, 6, 14, 0.75)';
    g.strokeText(text, x, y);
    g.fillStyle = col;
    g.fillText(text, x, y);
  }

  private drawMark(s: MarkState, camera: THREE.Camera): void {
    const g = this.g;
    const m = s.m;
    const [px, py, front] = this.project(m.x, m.y, m.z, camera);
    const [x, y, arrow] = this.pin(px, py, front, 26);
    const dist = Math.hypot(m.x - _c.x, m.y - _c.y, m.z - _c.z);
    const age = this.time - s.born;
    const intro = Math.min(1, age / 0.22);
    const sc = (1.6 - 0.6 * intro) * (arrow === null ? Math.max(0.75, Math.min(1.15, 14 / Math.max(6, dist) + 0.55)) : 0.85);
    const a = intro * (0.85 + 0.15 * Math.sin(this.time * 6 + m.id));
    const r = 8 * sc;
    g.save();
    g.translate(x, y);
    g.globalAlpha = a;
    // losange : halo large et trait fin
    const dia = () => {
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(r, 0);
      g.lineTo(0, r);
      g.lineTo(-r, 0);
      g.closePath();
    };
    dia();
    g.fillStyle = 'rgba(255, 40, 70, 0.22)';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255, 50, 80, 0.3)';
    g.stroke();
    g.lineWidth = 1.6;
    g.strokeStyle = '#ff5a72';
    g.stroke();
    g.fillStyle = '#ffd6dc';
    g.fillRect(-1.5, -1.5, 3, 3);
    if (arrow !== null) {
      // flèche vers la cible hors champ
      g.rotate(arrow);
      g.beginPath();
      g.moveTo(r + 9, 0);
      g.lineTo(r + 3, -4.5);
      g.lineTo(r + 3, 4.5);
      g.closePath();
      g.fillStyle = '#ff5a72';
      g.fill();
      g.rotate(-arrow);
    }
    g.restore();
    g.globalAlpha = a;
    const d = `${Math.round(dist)} m`;
    this.label(d, x, this.free(x, y + r + 9, d.length * 7, 12), '#ffd0d6', 12);
    if (m.label) this.label(m.label, x, this.free(x, y - r - 9, m.label.length * 6.5, -12), '#ffb3bf', 11);
    g.globalAlpha = 1;
  }

  private drawReveal(rv: Reveal, camera: THREE.Camera): void {
    const g = this.g;
    const left = rv.until - this.time;
    const a = Math.min(1, left / 0.8) * Math.min(1, (rv.dur - left) / 0.15 + 0.2);
    const [x0, y0, f0] = this.project(rv.x, rv.y, rv.z, camera);
    if (!f0) return;
    const tall = rv.kind === 'enemy' || rv.kind === undefined ? 1.8 : rv.kind === 'door' ? 2.2 : 0.7;
    const [, y1] = this.project(rv.x, rv.y + tall, rv.z, camera);
    const hgt = Math.max(10, Math.abs(y0 - y1));
    const wid = hgt * (tall > 1 ? 0.5 : 1.1);
    const cy = (y0 + y1) / 2;
    const k = Math.min(hgt * 0.3, 10);
    g.globalAlpha = a;
    g.strokeStyle = rv.kind === 'enemy' || !rv.kind ? '#9cffaa' : '#c8ffd0';
    g.lineWidth = 1.5;
    g.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const px = x0 + (sx * wid) / 2;
      const py = cy + (sy * hgt) / 2;
      g.moveTo(px, py - sy * k);
      g.lineTo(px, py);
      g.lineTo(px - sx * k, py);
    }
    g.stroke();
    const dist = Math.hypot(rv.x - _c.x, rv.y - _c.y, rv.z - _c.z);
    const name = rv.label ?? KIND_LABEL[rv.kind ?? 'enemy'];
    const d = `${Math.round(dist)} m`;
    this.label(name, x0, this.free(x0, cy - hgt / 2 - 8, name.length * 6.5, -12), '#bfffc8', 11);
    this.label(d, x0, this.free(x0, cy + hgt / 2 + 8, d.length * 6.5, 12), '#9cffaa', 11);
    g.globalAlpha = 1;
  }

  /** Première hauteur libre pour une étiquette (décalée de `step` tant qu'elle en chevauche une autre). */
  private free(x: number, y: number, w: number, step: number): number {
    const P = this.placed;
    for (let n = 0; n < 4; n++) {
      let hit = false;
      for (let i = 0; i < P.length; i += 3) {
        if (Math.abs(P[i] - x) < (P[i + 2] + w) / 2 + 2 && Math.abs(P[i + 1] - y) < 11) {
          hit = true;
          break;
        }
      }
      if (!hit) break;
      y += step;
    }
    P.push(x, y, w);
    return y;
  }

  private drawPulse(k: number): void {
    // onde de scan qui part du centre vers les bords
    const g = this.g;
    const R = Math.hypot(this.w, this.h) * 0.55 * (1 - Math.pow(1 - k, 2));
    g.save();
    g.translate(this.w / 2, this.h / 2);
    g.scale(1, 0.62);
    g.globalAlpha = (1 - k) * 0.8;
    g.lineWidth = 2;
    g.strokeStyle = '#9cffaa';
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = (1 - k) * 0.25;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(0, 0, Math.max(1, R - 8), 0, Math.PI * 2);
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
  }

  private drawThreat(a: number, k: number): void {
    // angle écran (0 en haut, sens horaire) : la convention donne « positif = gauche »
    const g = this.g;
    const th = -a;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const rx = this.w * 0.43;
    const ry = this.h * 0.4;
    const ca = th - Math.PI / 2;
    const span = 0.2;
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 14);
    g.save();
    g.globalAlpha = k * pulse;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255, 40, 30, 0.35)';
    g.lineWidth = 12;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, ca - span, ca + span);
    g.stroke();
    g.strokeStyle = '#ff4a3a';
    g.lineWidth = 3.5;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, ca - span * 0.85, ca + span * 0.85);
    g.stroke();
    // chevron vers l'extérieur
    const ex = cx + Math.cos(ca) * (rx + 16);
    const ey = cy + Math.sin(ca) * (ry + 16);
    g.translate(ex, ey);
    g.rotate(ca);
    g.fillStyle = '#ff6a4a';
    g.beginPath();
    g.moveTo(7, 0);
    g.lineTo(-3, -6);
    g.lineTo(-3, 6);
    g.closePath();
    g.fill();
    g.restore();
  }

  private drawAim(): void {
    const g = this.g;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const ok = this.aim === 'ok';
    const k = this.aimK;
    g.save();
    g.translate(cx, cy);
    if (ok || this.aim === 'none') {
      // quatre arcs qui tournent, se resserrent à l'apparition
      const R = 22 + (1 - k) * 10;
      g.rotate(this.time * 1.4);
      g.globalAlpha = 0.9 * k;
      g.lineWidth = 2;
      g.strokeStyle = '#5fe0ff';
      for (let i = 0; i < 4; i++) {
        const a0 = (i * Math.PI) / 2 + 0.25;
        g.beginPath();
        g.arc(0, 0, R, a0, a0 + 0.9);
        g.stroke();
      }
      g.globalAlpha = 0.35 * k;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(0, 0, R, 0, Math.PI * 2);
      g.stroke();
      g.rotate(-this.time * 1.4);
      g.globalAlpha = k;
      g.fillStyle = '#bff4ff';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        g.fillRect(Math.cos(a) * (R - 6) - 1.5, Math.sin(a) * (R - 6) - 1.5, 3, 3);
      }
    } else {
      // hors de portée : cercle pointillé terne et croix
      g.globalAlpha = 0.55 * k;
      g.setLineDash([3, 5]);
      g.lineWidth = 1.5;
      g.strokeStyle = '#9aa8b8';
      g.beginPath();
      g.arc(0, 0, 24, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = '#ff7a6a';
      g.beginPath();
      g.moveTo(28, -4);
      g.lineTo(36, 4);
      g.moveTo(36, -4);
      g.lineTo(28, 4);
      g.stroke();
    }
    g.restore();
    if (this.aimDist >= 0 && k > 0.5) {
      g.globalAlpha = k;
      this.label(`${Math.round(this.aimDist)} m`, cx + 30, cy + 26, ok ? '#bff4ff' : '#c8d0dc', 11, 'left');
      g.globalAlpha = 1;
    }
  }

  private drawRange(): void {
    // petit cartouche ambré en bas à gauche du réticule : crochet fin, graduations, distance
    const g = this.g;
    const k = this.rangeK;
    const x = this.w / 2 - 30;
    const y = this.h / 2 + 30;
    const d = this.rangeShow;
    const text = d < 10 ? `${d.toFixed(1).replace('.', ',')}\u00a0m` : `${Math.round(d)}\u00a0m`;
    g.save();
    g.globalAlpha = 0.85 * k;
    g.strokeStyle = '#ffd98a';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x + 6, y - 9);
    g.lineTo(x + 10, y - 9);
    g.lineTo(x + 10, y + 9);
    g.lineTo(x + 6, y + 9);
    for (let i = 0; i < 4; i++) {
      g.moveTo(x + 10, y - 6 + i * 4);
      g.lineTo(x + 13, y - 6 + i * 4);
    }
    g.stroke();
    g.restore();
    g.globalAlpha = k;
    this.label(text, x + 2, y, '#ffe6b0', 12, 'right');
    g.globalAlpha = 0.6 * k;
    this.label('TÉLÉM.', x + 2, y - 13, '#ffd98a', 9, 'right');
    g.globalAlpha = 1;
  }

  private drawSpeed(dt: number): void {
    const g = this.g;
    const k = this.speedK;
    const want = Math.round(10 + 34 * k);
    const half = Math.hypot(this.w, this.h) / 2;
    while (this.lines.length < want) {
      const max = 0.12 + Math.random() * 0.2;
      this.lines.push({ a: Math.random() * Math.PI * 2, r: half * (0.62 + Math.random() * 0.3), len: half * (0.12 + Math.random() * 0.2), life: max, max, w: 1 + Math.random() * 1.6 });
    }
    if (this.lines.length > want) this.lines.length = want;
    g.save();
    g.translate(this.w / 2, this.h / 2);
    g.lineCap = 'round';
    for (const l of this.lines) {
      l.life -= dt;
      if (l.life <= 0) {
        l.a = Math.random() * Math.PI * 2;
        l.r = half * (0.62 + Math.random() * 0.3);
        l.life = l.max;
      }
      const f = Math.sin(Math.PI * (1 - l.life / l.max));
      const c = Math.cos(l.a);
      const s = Math.sin(l.a);
      // sur un ellipse (écran large), du bord vers l'intérieur
      const r0 = l.r;
      const r1 = l.r + l.len;
      g.globalAlpha = 0.22 * k * f;
      g.strokeStyle = '#e8f6ff';
      g.lineWidth = l.w;
      g.beginPath();
      g.moveTo(c * r0, s * r0 * 0.75);
      g.lineTo(c * r1, s * r1 * 0.75);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
  }

  private drawVision(): void {
    const g = this.g;
    const thermal = this.vision === 'thermal';
    const col = this.vision === 'normal' ? '#c8d8ff' : thermal ? '#ffb070' : '#9cff9a';
    // balayage de transition (ligne lumineuse de haut en bas)
    if (this.visionT > 0) {
      const k = 1 - this.visionT / 0.32;
      const y = k * this.h;
      const grd = g.createLinearGradient(0, y - 60, 0, y + 4);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(1, thermal ? 'rgba(255,170,90,0.35)' : this.vision === 'night' ? 'rgba(140,255,150,0.35)' : 'rgba(200,220,255,0.3)');
      g.fillStyle = grd;
      g.fillRect(0, y - 60, this.w, 64);
      g.fillStyle = col;
      g.globalAlpha = 0.9;
      g.fillRect(0, y, this.w, 2);
      g.globalAlpha = 1;
    }
    const k = this.visionK;
    if (k < 0.01 || this.vision === 'normal') return;
    // cadre : coins d'optique et mention
    const m = 18;
    const L = Math.min(this.w, this.h) * 0.07;
    g.globalAlpha = 0.55 * k;
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    for (const [x, y, sx, sy] of [
      [m, m, 1, 1],
      [this.w - m, m, -1, 1],
      [this.w - m, this.h - m, -1, -1],
      [m, this.h - m, 1, -1],
    ]) {
      g.moveTo(x, y + sy * L);
      g.lineTo(x, y);
      g.lineTo(x + sx * L, y);
    }
    g.stroke();
    g.globalAlpha = 0.75 * k;
    this.label(thermal ? 'VISION THERMIQUE' : 'VISION NOCTURNE', m + 8, m + 14, col, 12, 'left');
    g.globalAlpha = 1;
  }
}
