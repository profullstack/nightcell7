import { WEAPON, type WeaponId } from "./ids";
import { STATUS_KIND, type StatusEffect } from "./status";
import type { BlastProfile } from "./grenades";

/**
 * The hero weapons (PRD §13.1).
 *
 * "Four excellent weapons have more value than twenty weak weapons" — these
 * numbers are the shared tuning contract. The client uses them for prediction
 * and HUD; the authoritative server uses the same values to validate fire
 * cadence, ammunition and damage. They must never diverge, which is why they
 * live here rather than in either runtime.
 *
 * All names are fictional; no real trade dress (PRD §13.1).
 *
 * PRD §13.1 said four. The M9 HAMMERFALL is a fifth, and it is here because
 * it is a different *kind* of weapon rather than a fifth flavour of the same
 * one: every other entry is hitscan, and this one puts a projectile in the
 * air with a blast at the end of it. "Four excellent weapons have more value
 * than twenty weak weapons" is an argument against power creep, not against
 * a second verb. It is bought with earned credits and is not purchasable with
 * money, so the no-pay-to-win rule is untouched.
 */

export interface WeaponSpec {
  readonly id: WeaponId;
  readonly displayName: string;
  /** Rounds per minute. Drives the server-side minimum interval between shots. */
  readonly rpm: number;
  readonly magazineSize: number;
  readonly reserveAmmo: number;
  /** Reload with a round still chambered. */
  readonly reloadMs: number;
  /** Reload from empty — always slower, and validated separately. */
  readonly emptyReloadMs: number;
  readonly damage: number;
  readonly headshotMultiplier: number;
  /** Pellets per trigger pull. >1 marks a spread weapon. */
  readonly pellets: number;
  /** Half-angle of the pellet cone in radians (0 for single-projectile). */
  readonly spreadRadians: number;
  /** Beyond `falloffStartM`, damage decays linearly to `minDamageFraction`. */
  readonly falloffStartM: number;
  readonly falloffEndM: number;
  readonly minDamageFraction: number;
  /** Hard cap on range; the server will not trace beyond this. */
  readonly maxRangeM: number;
  readonly suppressed: boolean;
  /** Multiplayer availability. Campaign-only weapons never enter a match. */
  readonly multiplayer: boolean;
  /**
   * Muzzle speed of the projectile, m/s. Absent on every hitscan weapon, and
   * its presence is what makes a weapon a launcher: the simulation branches on
   * `isProjectileWeapon`, never on the weapon id, so a second launcher needs no
   * new branch.
   */
  readonly projectileSpeedMps?: number;
  /** Metres of drop per second squared. Flat-shooting, so far below gravity. */
  readonly projectileGravity?: number;
  /** Detonation, reusing the grenade blast model. */
  readonly blast?: BlastProfile;
  /**
   * What the weapon leaves on whoever it hits. Absent on every plain bullet.
   *
   * Like `projectileSpeedMps`, this is a capability rather than a name: the
   * simulation asks whether a spec has a status, never which weapon fired, so
   * a third burning thing needs no new branch.
   */
  readonly status?: StatusEffect;
  /**
   * Arc only: how many further targets the discharge jumps to, and how far it
   * will reach for each.
   */
  readonly chain?: { readonly targets: number; readonly radiusM: number };
}

export const WEAPON_SPECS: Readonly<Record<WeaponId, WeaponSpec>> = {
  [WEAPON.V3_TESLA]: {
    id: WEAPON.V3_TESLA,
    displayName: "V3 Tesla",
    // Slow, because the value is the discharge and not the rate. A fast arc
    // would be a stun-lock, which is the one outcome worth designing out.
    rpm: 48,
    magazineSize: 6,
    reserveAmmo: 24,
    reloadMs: 2100,
    emptyReloadMs: 2800,
    // Low on purpose: this does not kill, it takes someone's aim away and
    // lets a teammate finish them.
    damage: 14,
    headshotMultiplier: 1,
    pellets: 1,
    spreadRadians: 0,
    falloffStartM: 6,
    falloffEndM: 14,
    minDamageFraction: 0.3,
    // Very short. Electricity crossing a yard is a laser, not an arc.
    maxRangeM: 14,
    suppressed: false,
    multiplayer: true,
    status: {
      kind: STATUS_KIND.ARC,
      damagePerSecond: 0,
      durationMs: 1400,
      // Heavy damping, never a lock. Losing the stick outright for a second
      // and a half is punishing out of all proportion to 14 damage.
      disrupt: 0.7,
    },
    chain: { targets: 2, radiusM: 5 },
  },

  [WEAPON.K5_CINDER]: {
    id: WEAPON.K5_CINDER,
    displayName: "K5 Cinder",
    // No new "sustained" mode: 600 rpm through the existing fire path is ten
    // units of fuel a second, which is continuous fire by any measure and a
    // full tank in nine seconds. A capability flag was drafted for this and
    // removed once it turned out nothing had to read it.
    rpm: 600,
    magazineSize: 90,
    reserveAmmo: 180,
    reloadMs: 2600,
    emptyReloadMs: 3400,
    // Small per tick. The damage is in the burn that follows, which is what
    // makes holding the stream on one target worse than sweeping it.
    damage: 6,
    headshotMultiplier: 1,
    pellets: 1,
    spreadRadians: 0.06,
    falloffStartM: 5,
    falloffEndM: 9,
    minDamageFraction: 0.25,
    // Shorter than the shotgun. If it reaches across a lane it is a rifle.
    maxRangeM: 9,
    suppressed: false,
    multiplayer: true,
    status: {
      kind: STATUS_KIND.BURN,
      // Four seconds at 9/s is 36 if it runs out, which is why the weapon
      // denies ground rather than trading: you can walk out of it.
      damagePerSecond: 9,
      durationMs: 4000,
      disrupt: 0,
    },
  },
  [WEAPON.P11]: {
    id: WEAPON.P11,
    displayName: "P11",
    rpm: 400,
    magazineSize: 15,
    reserveAmmo: 60,
    reloadMs: 1500,
    emptyReloadMs: 2100,
    damage: 26,
    headshotMultiplier: 2.0,
    pellets: 1,
    spreadRadians: 0,
    falloffStartM: 18,
    falloffEndM: 40,
    minDamageFraction: 0.55,
    maxRangeM: 120,
    suppressed: true,
    multiplayer: true,
  },
  [WEAPON.C9_KESTREL]: {
    id: WEAPON.C9_KESTREL,
    displayName: "C9 Kestrel",
    rpm: 720,
    magazineSize: 30,
    reserveAmmo: 150,
    reloadMs: 2000,
    emptyReloadMs: 2700,
    damage: 24,
    headshotMultiplier: 1.9,
    pellets: 1,
    spreadRadians: 0,
    falloffStartM: 30,
    falloffEndM: 60,
    minDamageFraction: 0.6,
    maxRangeM: 200,
    suppressed: true,
    multiplayer: true,
  },
  [WEAPON.B4_BREACHER]: {
    id: WEAPON.B4_BREACHER,
    displayName: "B4 Breaching Shotgun",
    rpm: 90,
    magazineSize: 6,
    reserveAmmo: 30,
    reloadMs: 2600,
    emptyReloadMs: 3100,
    damage: 13,
    headshotMultiplier: 1.5,
    pellets: 9,
    spreadRadians: 0.06,
    falloffStartM: 6,
    falloffEndM: 16,
    minDamageFraction: 0.2,
    maxRangeM: 40,
    suppressed: false,
    multiplayer: true,
  },
  [WEAPON.M7_LANCE]: {
    id: WEAPON.M7_LANCE,
    displayName: "M7 Lance",
    rpm: 55,
    magazineSize: 5,
    reserveAmmo: 15,
    reloadMs: 3000,
    emptyReloadMs: 3600,
    damage: 92,
    headshotMultiplier: 1.6,
    pellets: 1,
    spreadRadians: 0,
    falloffStartM: 80,
    falloffEndM: 160,
    minDamageFraction: 0.8,
    maxRangeM: 300,
    suppressed: false,
    // Campaign finale weapon. Keeping it out of matches is the whole
    // "no pay-to-win, no power creep" rule in practice (PRD §5.4).
    multiplayer: false,
  },
  [WEAPON.M9_HAMMERFALL]: {
    id: WEAPON.M9_HAMMERFALL,
    displayName: "M9 Hammerfall",
    // One tube, one rocket, a long reload. The cadence is the balance: it is
    // the hardest-hitting thing in the yard and you get it back roughly once
    // every four seconds, so a miss costs more than a miss with anything else.
    rpm: 30,
    magazineSize: 1,
    reserveAmmo: 5,
    reloadMs: 3400,
    emptyReloadMs: 3400,
    // Direct hit. The blast under it is what usually does the killing, and a
    // direct hit adds this on top, so a contact shot is lethal and a near miss
    // is survivable with armour.
    damage: 65,
    // A rocket does not care where it lands on a body.
    headshotMultiplier: 1,
    pellets: 1,
    spreadRadians: 0,
    // No falloff: a rocket carries its warhead the whole way.
    falloffStartM: 400,
    falloffEndM: 400,
    minDamageFraction: 1,
    maxRangeM: 400,
    suppressed: false,
    multiplayer: true,
    projectileSpeedMps: 42,
    projectileGravity: -2.6,
    blast: {
      innerRadiusM: 2.6,
      outerRadiusM: 7.5,
      maxDamage: 130,
      // Firing it at a wall in your own face has to hurt, or the tube becomes
      // a panic button at close range instead of a commitment.
      selfDamageFraction: 0.75,
    },
  },
};

/** True when firing this puts a projectile in the air instead of a trace. */
export function isProjectileWeapon(spec: WeaponSpec): boolean {
  return (spec.projectileSpeedMps ?? 0) > 0 && spec.blast !== undefined;
}

export function getWeapon(id: WeaponId): WeaponSpec {
  const spec = WEAPON_SPECS[id];
  if (!spec) throw new Error(`unknown weapon: ${id}`);
  return spec;
}

/** Minimum milliseconds the server will allow between two shots. */
export function fireIntervalMs(spec: WeaponSpec): number {
  return 60_000 / spec.rpm;
}

/**
 * Distance falloff as a fraction of base damage.
 * Flat inside `falloffStartM`, linear to `minDamageFraction`, flat after.
 */
export function damageFalloff(spec: WeaponSpec, distanceM: number): number {
  if (distanceM <= spec.falloffStartM) return 1;
  if (distanceM >= spec.falloffEndM) return spec.minDamageFraction;
  const t = (distanceM - spec.falloffStartM) / (spec.falloffEndM - spec.falloffStartM);
  return 1 - t * (1 - spec.minDamageFraction);
}

/** Multiplayer loadouts are mechanically identical across factions (PRD §18.1). */
export const MULTIPLAYER_LOADOUT: readonly WeaponId[] = [WEAPON.C9_KESTREL, WEAPON.P11];

export function isMultiplayerLegal(id: WeaponId): boolean {
  return getWeapon(id).multiplayer;
}
