// Portes d'entrée animées : deux battants voxel par porte, qui s'ouvrent vers l'intérieur
// quand quelqu'un approche et se referment derrière lui.

import * as THREE from 'three';
import { PROP_KINDS } from '../../shared/city/props';
import type { BuildingInfo, PropPlacement } from '../../shared/city/gen/context';
import type { BuildingType } from '../../shared/city/plan';
import { GROUND_VY, INV_VOXEL, type VoxelWorld } from '../../shared/voxel';
import { hash32 } from '../../shared/util';
import { audio } from '../audio/AudioEngine';
import type { CharView } from '../characters/characterRenderer';
import { meshModel } from '../models/modelMesher';
import { SLOT, VoxelModel, shade } from '../models/voxelModel';
import { createObjectMaterial } from '../render/voxelObjectMaterial';

const RES = 1 / 16;
const BRASS = 0xc9a24a;
const SILVER = 0xb8c0cc;
const IRON = 0x2a2a2c;

type LeafKind = 'panel' | 'glazed' | 'plank' | 'church';

interface LeafStyle {
  kind: LeafKind;
  color: number;
  metal: number;
  kick: boolean;
}

const SHOP_TYPES = new Set<BuildingType>(['pub', 'shop', 'cafe', 'bakery', 'butcher', 'jeweller', 'pawn', 'gambling', 'post']);
const PLANK_TYPES = new Set<BuildingType>(['warehouse', 'foundry', 'brewery', 'mill', 'gasworks', 'shipyard', 'sweatshop']);
const GRAND_TYPES = new Set<BuildingType>(['bank', 'exchange', 'offices', 'customs', 'club', 'mansion', 'theatre', 'police', 'clocktower']);

function styleFor(def: BuildingInfo['def'] | undefined, variant: number, seed: number): LeafStyle {
  if (variant === 1 || def?.hq === 'dadou') return { kind: 'panel', color: 0x5e1015, metal: BRASS, kick: true };
  if (variant === 2 || def?.hq === 'even') return { kind: 'panel', color: 0x1a2c52, metal: SILVER, kick: true };
  const t = def?.type;
  const pick = <T,>(list: T[]) => list[seed % list.length];
  if (t === 'church') return { kind: 'church', color: 0x4a2f1c, metal: IRON, kick: false };
  if (t && PLANK_TYPES.has(t)) return { kind: 'plank', color: pick([0x5a4632, 0x4a3a2a, 0x3e4a3a, 0x5a3a2a]), metal: IRON, kick: false };
  if (t && SHOP_TYPES.has(t)) return { kind: 'glazed', color: pick([0x1f3a2a, 0x4a1a14, 0x161616, 0x1d2f55, 0x5a1a2a, 0x2a4a3a]), metal: BRASS, kick: t === 'pub' };
  if (t && GRAND_TYPES.has(t)) return { kind: 'panel', color: pick([0x3a2414, 0x141414, 0x4a2f1c]), metal: BRASS, kick: true };
  return { kind: 'panel', color: pick([0x3a4a3a, 0x4a3628, 0x2e2e34, 0x4a2a22, 0x2a3a4a]), metal: BRASS, kick: false };
}

/**
 * Battant de porte : x de la charnière (0) vers le bord libre, y vers le haut, z = 0 côté rue.
 * Le corps occupe z = 1..2 ; les poignées dépassent en z = 0 et z = 3.
 */
function leafModel(w: number, h: number, st: LeafStyle, seed: number): VoxelModel {
  const m = new VoxelModel(w, h, 4, RES);
  const C = st.color;
  const dark = shade(C, 0.78);
  const lite = shade(C, 1.18);
  m.box(0, 0, 1, w, h, 3, C);
  const stile = w >= 9 ? 2 : 1;
  const carve = (x0: number, y0: number, x1: number, y1: number, glass = false) => {
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    if (glass) {
      m.box(x0, y0, 1, x1, y1, 3, SLOT.GLASS);
      return;
    }
    // panneau en creux côté rue, moulure claire en haut et à gauche, ombre en bas
    m.box(x0, y0, 1, x1, y1, 2, -1);
    m.box(x0, y0, 2, x1, y1, 3, dark);
    m.box(x0, y1 - 1, 2, x1, y1, 3, shade(C, 0.66));
    m.box(x0 + 1, y0 + 1, 2, x1 - 1, y1 - 1, 3, C);
    // panneau en relief côté intérieur (simple changement de teinte)
    m.box(x0, y0, 2, x0 + 1, y1, 3, lite);
  };
  switch (st.kind) {
    case 'plank': {
      for (let x = 0; x < w; x++) {
        const f = 0.86 + ((hash32(seed * 31 + x * 7) % 100) / 100) * 0.28;
        m.box(x, 0, 1, x + 1, h, 3, shade(C, x % 3 === 2 ? f * 0.7 : f));
      }
      // ferrures
      for (const fy of [Math.round(h * 0.18), Math.round(h * 0.78)]) {
        m.box(0, fy, 0, Math.max(2, w - 2), fy + 2, 1, IRON);
        m.box(0, fy, 3, Math.max(2, w - 2), fy + 2, 4, IRON);
        for (let x = 1; x < w - 2; x += 3) m.set(x, fy + 1, 0, 0x4a4a4e);
      }
      // traverse diagonale
      for (let y = Math.round(h * 0.22); y < Math.round(h * 0.76); y++) {
        const x = Math.round(((y - h * 0.22) / (h * 0.54)) * (w - 2));
        m.box(x, y, 0, x + 2, y + 1, 1, shade(C, 0.8));
      }
      break;
    }
    case 'church': {
      for (let x = 0; x < w; x++) m.box(x, 0, 1, x + 1, h, 3, shade(C, x % 2 ? 0.9 : 1.04));
      for (const fy of [Math.round(h * 0.15), Math.round(h * 0.5), Math.round(h * 0.85)]) {
        m.box(0, fy, 0, w - 1, fy + 1, 1, IRON);
        for (let x = 1; x < w - 1; x += 2) m.set(x, fy + 1, 0, IRON);
      }
      break;
    }
    case 'glazed': {
      const lock = Math.round(h * 0.42);
      // bas : deux panneaux superposés
      carve(stile, 2 + (st.kick ? 2 : 0), w - stile, Math.round(lock * 0.55));
      carve(stile, Math.round(lock * 0.55) + 2, w - stile, lock - 1);
      // haut : vitre avec petits bois
      const top = h - stile - 1;
      carve(stile, lock + 2, w - stile, top, true);
      const midX = Math.round(w / 2);
      m.box(midX, lock + 2, 1, midX + 1, top, 3, C);
      for (const fy of [Math.round(lock + 2 + (top - lock - 2) / 3), Math.round(lock + 2 + ((top - lock - 2) * 2) / 3)]) m.box(stile, fy, 1, w - stile, fy + 1, 3, C);
      break;
    }
    case 'panel': {
      const lock = Math.round(h * 0.45);
      const midX = w >= 10 ? Math.round(w / 2) : -1;
      const cols: [number, number][] = midX > 0 ? [[stile, midX - 1], [midX + 1, w - stile]] : [[stile, w - stile]];
      for (const [x0, x1] of cols) {
        carve(x0, 2 + (st.kick ? 2 : 0), x1, lock - 1);
        carve(x0, lock + 2, x1, Math.round(h * 0.8));
        carve(x0, Math.round(h * 0.8) + 2, x1, h - stile);
      }
      // boîte aux lettres
      if (w >= 8) m.box(Math.round(w / 2) - 2, lock, 0, Math.round(w / 2) + 2, lock + 1, 1, st.metal);
      break;
    }
  }
  // plaque de propreté
  if (st.kick) m.box(0, 0, 0, w, 2, 1, shade(st.metal, 0.85));
  // poignées et plaques de serrure (côté libre)
  const ky = Math.round(h * 0.42);
  const kx = w - 2;
  m.box(kx - 1, ky - 2, 0, kx, ky + 3, 1, shade(st.metal, 0.8));
  m.box(kx - 1, ky, 0, kx + 1, ky + 1, 1, st.metal);
  m.box(kx - 1, ky, 3, kx + 1, ky + 1, 4, st.metal);
  // charnières
  for (const fy of [3, h - 5]) m.box(0, fy, 3, 1, fy + 2, 4, shade(st.metal, 0.6));
  return m;
}

/** Copie miroir gauche/droite d'un modèle. */
function flipX(src: VoxelModel): VoxelModel {
  const m = new VoxelModel(src.sx, src.sy, src.sz, src.res);
  for (let y = 0; y < src.sy; y++)
    for (let z = 0; z < src.sz; z++)
      for (let x = 0; x < src.sx; x++) {
        const v = src.data[src.idx(x, y, z)];
        if (v !== 0) m.data[m.idx(src.sx - 1 - x, y, z)] = v;
      }
  return m;
}

interface Door {
  x: number;
  y: number;
  z: number;
  /** Charnières : battant gauche et droit. */
  left: THREE.Mesh;
  right: THREE.Mesh;
  baseYaw: number;
  angle: number;
  target: number;
  openUntil: number;
  open: boolean;
}

export class DoorSystem {
  readonly group = new THREE.Group();
  private doors: Door[] = [];
  private material: THREE.MeshLambertMaterial;
  private time = 0;

  constructor(props: PropPlacement[], buildings: BuildingInfo[], world?: VoxelWorld) {
    this.group.name = 'portes';
    this.material = createObjectMaterial({ key: 'doors' });
    const byId = new Map(buildings.map((b) => [b.id, b]));
    const kind = PROP_KINDS.indexOf('DOOR_LEAF');
    for (const p of props) {
      if (p.kind !== kind) continue;
      const def = p.building >= 0 ? byId.get(p.building)?.def : undefined;
      const seed = hash32(Math.round(p.x * 8) * 73856093 + Math.round(p.z * 8) * 19349663);
      const st = styleFor(def, p.variant, seed);
      const s = p.scale ?? 1;
      const ax = Math.cos(p.yaw);
      const az = -Math.sin(p.yaw);
      const nx = Math.sin(p.yaw);
      const nz = Math.cos(p.yaw);
      // mesure de l'ouverture réelle dans le monde voxel
      let halfL = 0.75 * s;
      let halfR = 0.75 * s;
      let height = 2.5 * s;
      if (world) {
        const midY = p.y + 1.0;
        const probe = (dir: number): number => {
          for (let d = 0.1; d < 3.2; d += 0.0625) if (world.solidAt(p.x + ax * d * dir, midY, p.z + az * d * dir)) return d;
          return -1;
        };
        const l = probe(-1);
        const r = probe(1);
        if (l > 0.3 && r > 0.3) {
          halfL = l;
          halfR = r;
        }
        const vx = Math.floor(p.x * INV_VOXEL);
        const vz = Math.floor(p.z * INV_VOXEL);
        const vy0 = Math.round(p.y * INV_VOXEL) + GROUND_VY;
        let hv = 0;
        while (hv < 20 && !world.isSolid(vx, vy0 + hv, vz)) hv++;
        if (hv >= 7 && hv < 20) height = hv * 0.25;
      }
      const leafW = (halfL + halfR) / 2 - 0.01;
      const wv = Math.max(4, Math.round(leafW / RES));
      const hv = Math.max(16, Math.round((height - 0.02) / RES));
      const base = leafModel(wv, hv, st, seed);
      // origine : charnière, face intérieure du corps du battant
      base.setOrigin(0, 0, 3);
      const mirrored = flipX(base);
      mirrored.setOrigin(wv, 0, 3);
      const mkMesh = (m: VoxelModel) => {
        const mesh = new THREE.Mesh(meshModel(m), this.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = true;
        return mesh;
      };
      const left = mkMesh(base);
      const right = mkMesh(mirrored);
      const depth = 0.0625;
      left.position.set(p.x - ax * halfL + nx * depth, p.y, p.z - az * halfL + nz * depth);
      right.position.set(p.x + ax * halfR + nx * depth, p.y, p.z + az * halfR + nz * depth);
      left.rotation.y = p.yaw;
      right.rotation.y = p.yaw;
      this.group.add(left, right);
      this.doors.push({ x: p.x, y: p.y, z: p.z, left, right, baseYaw: p.yaw, angle: 0, target: 0, openUntil: 0, open: false });
    }
  }

  /** Ouvre les portes devant lesquelles quelqu'un se trouve. */
  update(dt: number, views: CharView[], listener?: THREE.Vector3): void {
    this.time += dt;
    for (const d of this.doors) {
      let near = false;
      for (const v of views) {
        if (v.anim === 3) continue;
        const dx = v.x - d.x;
        const dz = v.z - d.z;
        if (dx * dx + dz * dz < 2.6 && Math.abs(v.y - d.y) < 1.6) {
          near = true;
          break;
        }
      }
      if (near) d.openUntil = this.time + 0.6;
      const open = this.time < d.openUntil;
      if (open !== d.open) {
        d.open = open;
        if (listener && Math.hypot(listener.x - d.x, listener.z - d.z) < 22) audio.play(open ? 'door_open' : 'door_close', { pos: { x: d.x, y: d.y + 1.2, z: d.z }, volume: 0.55 });
      }
      d.target = open ? 1.42 : 0;
      if (d.angle === d.target) continue;
      const speed = open ? 4.2 : 2.6;
      const delta = d.target - d.angle;
      d.angle += Math.sign(delta) * Math.min(Math.abs(delta), speed * dt * (0.35 + Math.abs(delta)));
      if (Math.abs(d.target - d.angle) < 0.002) d.angle = d.target;
      d.left.rotation.y = d.baseYaw - d.angle;
      d.right.rotation.y = d.baseYaw + d.angle;
    }
  }

  dispose(): void {
    for (const d of this.doors) {
      d.left.geometry.dispose();
      d.right.geometry.dispose();
    }
    this.material.dispose();
  }
}
