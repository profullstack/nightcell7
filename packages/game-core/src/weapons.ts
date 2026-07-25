import { WEAPON, type WeaponId } from "./ids";

/**
 * The four hero weapons (PRD §13.1).
 *
 * "Four excellent weapons have more value than twenty weak weapons" — these
 * numbers are the shared tuning contract. The client uses them for prediction
 * and HUD; the authoritative server uses the same values to validate fire
 * cadence, ammunition and damage. They must never diverge, which is why they
 * live here rather than in either runtime.
 *
 * All names are fictional; no real trade dress (PRD §13.1).
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
}

export const WEAPON_SPECS: Readonly<Record<WeaponId, WeaponSpec>> = {
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
};

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
