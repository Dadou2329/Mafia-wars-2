// Mini-carte circulaire (nord en haut) centrée sur le joueur.

import { CharKind } from '../../shared/characters';
import { BUILDINGS, Faction } from '../../shared/city/plan';
import type { GameEvent, PrivateState, PublicState, Slot } from '../../shared/protocol';
import { MAP_SCALE, type CityMap } from './cityMap';
import type { EntityStore } from './entities';

export const OWNER_FILL: Record<number, string> = {
  [Faction.DADOU]: 'rgba(170,25,32,0.55)',
  [Faction.EVEN]: 'rgba(30,60,140,0.55)',
};

export function drawMinimap(
  canvas: HTMLCanvasElement,
  map: CityMap,
  px: number,
  pz: number,
  yaw: number,
  store: EntityStore,
  pub: PublicState | null,
  priv: PrivateState | null,
  me: Slot,
  selfId: number,
  event: Extract<GameEvent, { t: 'event' }> | null = null,
): void {
  const c = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const radiusM = 55; // mètres visibles du centre au bord
  const s = W / 2 / (radiusM * MAP_SCALE);
  c.save();
  c.fillStyle = '#2a2018';
  c.fillRect(0, 0, W, H);
  c.translate(W / 2, H / 2);
  c.scale(s, s);
  c.translate(-px * MAP_SCALE, -pz * MAP_SCALE);
  c.drawImage(map.base, 0, 0);
  // propriétaires des bâtiments
  if (pub) {
    for (const b of map.buildings) {
      const st = pub.buildings[b.id];
      if (!st) continue;
      const f = b.footprint;
      const fill = OWNER_FILL[st.owner];
      if (fill) {
        c.fillStyle = fill;
        c.fillRect(f[0] * MAP_SCALE, f[1] * MAP_SCALE, (f[2] - f[0]) * MAP_SCALE, (f[3] - f[1]) * MAP_SCALE);
      }
      if (st.cap > 0 && st.capBy) {
        c.strokeStyle = st.capBy === Faction.DADOU ? '#ff5050' : '#6fa0ff';
        c.lineWidth = 6 / s;
        c.setLineDash([12 / s, 8 / s]);
        c.strokeRect(f[0] * MAP_SCALE, f[1] * MAP_SCALE, (f[2] - f[0]) * MAP_SCALE, (f[3] - f[1]) * MAP_SCALE);
        c.setLineDash([]);
      }
      if (BUILDINGS[b.id].isKey) {
        c.fillStyle = '#f2c84a';
        c.font = `${28}px serif`;
        c.textAlign = 'center';
        c.fillText(BUILDINGS[b.id].hq ? '♛' : '★', ((f[0] + f[2]) / 2) * MAP_SCALE, ((f[1] + f[3]) / 2) * MAP_SCALE + 10);
      }
    }
    // combats en cours
    for (const bt of pub.battles) {
      c.strokeStyle = 'rgba(255,120,40,0.8)';
      c.lineWidth = 4 / s;
      c.beginPath();
      c.arc(bt.x * MAP_SCALE, bt.z * MAP_SCALE, (8 + (Date.now() / 120) % 10) * MAP_SCALE * 0.4, 0, Math.PI * 2);
      c.stroke();
    }
  }
  // unités visibles
  const myFaction = me === 'dadou' ? Faction.DADOU : Faction.EVEN;
  for (const e of store.alive()) {
    if (e.info.id === selfId) continue;
    if (Math.abs(e.x - px) > radiusM * 1.5 || Math.abs(e.z - pz) > radiusM * 1.5) continue;
    let col: string | null = null;
    let r = 1.0;
    if (e.info.faction === myFaction) {
      col = e.info.kind === CharKind.LIEUTENANT ? '#ffd24a' : '#e8d8b0';
      r = e.info.kind === CharKind.LIEUTENANT ? 1.6 : 1.1;
      if (e.info.kind === CharKind.BARMAN) continue;
    } else if (e.info.faction === Faction.POLICE) {
      col = '#7fa8ff';
    } else if (e.info.faction === Faction.NEUTRAL) {
      col = '#b08a5a';
    } else {
      col = '#ff4a3a';
      r = e.info.kind === CharKind.BOSS_DADOU || e.info.kind === CharKind.BOSS_EVEN ? 1.8 : 1.2;
    }
    c.fillStyle = col;
    c.beginPath();
    c.arc(e.x * MAP_SCALE, e.z * MAP_SCALE, r * MAP_SCALE, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 1.5 / s;
    c.stroke();
  }
  // ennemis repérés hors de vue
  if (priv) {
    for (const sp of priv.spotted) {
      c.fillStyle = 'rgba(255,60,40,0.5)';
      c.beginPath();
      c.arc(sp.x * MAP_SCALE, sp.z * MAP_SCALE, (1.5 + Math.min(4, sp.n * 0.4)) * MAP_SCALE, 0, Math.PI * 2);
      c.fill();
    }
  }
  // cargaison de contrebande / descente de police
  if (event && (event.kind === 'contraband' || event.kind === 'raid')) {
    const t = Date.now() / 1000;
    c.strokeStyle = event.kind === 'raid' ? '#7fa8ff' : '#ffc94a';
    c.lineWidth = 3 / s;
    c.beginPath();
    c.arc(event.x * MAP_SCALE, event.z * MAP_SCALE, (event.kind === 'raid' ? 14 : 3 + (t % 1) * 3) * MAP_SCALE, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = event.kind === 'raid' ? '#7fa8ff' : '#ffc94a';
    c.font = `${30}px serif`;
    c.textAlign = 'center';
    c.fillText(event.kind === 'raid' ? '⚑' : '£', event.x * MAP_SCALE, event.z * MAP_SCALE + 10);
  }
  c.restore();
  // repère de la cargaison hors de la mini-carte : flèche au bord
  if (event && event.kind === 'contraband') {
    const dx = event.x - px;
    const dz = event.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > radiusM * 0.9) {
      const r = W / 2 - 16;
      c.save();
      c.translate(W / 2 + (dx / d) * r, H / 2 + (dz / d) * r);
      c.fillStyle = '#ffc94a';
      c.strokeStyle = '#000';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, 11, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = '#2a1a0c';
      c.font = "700 15px 'Cinzel', serif";
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('£', 0, 1);
      c.restore();
    }
  }
  // flèche du joueur
  c.save();
  c.translate(W / 2, H / 2);
  c.rotate(-yaw + Math.PI);
  c.fillStyle = me === 'dadou' ? '#ff5a4a' : '#7aa8ff';
  c.strokeStyle = '#000';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, -16);
  c.lineTo(10, 12);
  c.lineTo(0, 6);
  c.lineTo(-10, 12);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
  // cerclage et nord
  c.fillStyle = '#f2e2b0';
  c.font = "700 22px 'Cinzel', serif";
  c.textAlign = 'center';
  c.fillText('N', W / 2, 26);
}
