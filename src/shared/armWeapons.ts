// Caractéristiques des armes de bras selon le niveau de l'implant (client et serveur).

import { ARM_WEAPON_IMPLANT, WEAPONS, Weapon, type WeaponDef } from './characters';
import { implantParams } from './implants';

/** Arme de bras au niveau donné (dégâts, cadence, chargeur, allonge…) ; autre arme : inchangée. */
export function armWeaponDef(w: Weapon, level: number): WeaponDef {
  const base = WEAPONS[w];
  const id = ARM_WEAPON_IMPLANT[w];
  if (!id || level <= 0) return base;
  const p = implantParams(id, level);
  switch (w) {
    case Weapon.ARM_PISTOL:
      return { ...base, damage: p.dmg, magazine: p.mag, cooldown: p.cd, spread: p.spread, reload: p.reload };
    case Weapon.ARM_BLADE:
      return { ...base, damage: p.dmg, cooldown: p.cd, range: p.reach };
    case Weapon.ARM_FIST:
      return { ...base, damage: p.dmg, cooldown: p.cd };
    case Weapon.ARM_WHIP:
      return { ...base, damage: p.dmg, cooldown: p.cd, range: p.reach };
    default:
      return base;
  }
}

/** Temps de charge complète du poing hydraulique (s). */
export const FIST_CHARGE_TIME = 1;
