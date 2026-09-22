import { MAX_HEALTH, getWeapon, type WeaponId } from "@nightcell7/game-core";
import type { CollisionMap } from "./map";
import { playerHeight } from "./movement";
import type { Vec3 } from "./vec";

/**
 * Pickups: health packs that reappear on a schedule, and the weapons a dead
 * fighter leaves behind.
 *
 * Pure data and pure functions, like movement and grenades. The simulation owns
 * the map of live pickups and decides when a player is standing on one; this
 * module only says what a pickup is, whether it is in reach, and what taking
 * it does to a player. Keeping it here rather than in the client means the
 * sandbox and an eventual server match agree on every number (PRD §18.3).
 */

export const PICKUP_KIND = {
  HEALTH: "health",
  WEAPON: "weapon",
} as const;

export type PickupKind = (typeof PICKUP_KIND)[keyof typeof PICKUP_KIND];

export interface SimPickup {
  readonly id: string;
  readonly kind: PickupKind;
  readonly position: Vec3;
  /** Health restored. Zero for a weapon. */
  readonly heal: number;
  /** The weapon in a drop. Null for a health pack. */
  readonly weaponId: WeaponId | null;
  /** Rounds that travel with a dropped weapon. */
  readonly magazine: number;
  readonly reserve: number;
  /** Match time after which a drop is swept up. Null for a fixed spawn. */
  readonly expiresAtMs: number | null;
  /** Which fixed health spawn this pack occupies, so it can come back there. */
  readonly spawnIndex: number | null;
}

export interface PickupRules {
  /** Where health packs appear. Empty disables them. */
  readonly healthSpawns: readonly Vec3[];
  /** Delay before the first pack appears at a spawn. */
  readonly healthFirstSpawnMs: number;
  /** Delay between a pack being taken and the next one appearing there. */
  readonly healthRespawnMs: number;
  readonly healAmount: number;
  /** Whether a killed fighter drops their weapons. */
  readonly dropWeapons: boolean;
  /** How long a dropped weapon stays on the ground. */
  readonly dropExpiresMs: number;
  /** Horizontal reach at which standing next to a pickup takes it. */
  readonly pickupRadiusM: number;
  /** Most weapons a fighter can carry; a drop is refused beyond this. */
  readonly maxWeapons: number;
  /** Reserve ammo ceiling as a multiple of the weapon's issued reserve. */
  readonly reserveCapMultiplier: number;
}

export const DEFAULT_PICKUP_RULES: PickupRules = {
  healthSpawns: [],
  healthFirstSpawnMs: 8_000,
  healthRespawnMs: 25_000,
  healAmount: 50,
  dropWeapons: true,
  dropExpiresMs: 30_000,
  pickupRadiusM: 1.1,
  maxWeapons: 3,
  reserveCapMultiplier: 2,
};

/** The subset of a player a pickup can read and change. */
export interface PickupTaker {
  health: number;
  weapons: WeaponId[];
  ammo: { magazine: number; reserve: number }[];
}

export type PickupOutcome =
  | { kind: "health"; healed: number }
  | { kind: "weapon"; weaponId: WeaponId; slot: number; added: boolean; ammoAdded: number };

/**
 * Is this fighter standing on the pickup?
 *
 * A horizontal disc around the pickup, and a vertical band from just below the
 * feet to the top of the head, so a pack on a catwalk cannot be taken from the
 * ground beneath it.
 */
export function withinPickupReach(
  feet: Vec3,
  crouching: boolean,
  pickup: Vec3,
  radiusM: number,
): boolean {
  const dx = feet.x - pickup.x;
  const dz = feet.z - pickup.z;
  if (dx * dx + dz * dz > radiusM * radiusM) return false;
  const dy = pickup.y - feet.y;
  return dy >= -0.5 && dy <= playerHeight(crouching);
}

/**
 * Apply a pickup to a fighter. Returns what changed, or null when there was
 * nothing to gain — full health, a full reserve, or no free hands — in which
 * case the pickup stays where it is for someone who can use it.
 */
export function applyPickup(
  taker: PickupTaker,
  pickup: SimPickup,
  rules: PickupRules,
): PickupOutcome | null {
  if (pickup.kind === PICKUP_KIND.HEALTH) {
    if (taker.health >= MAX_HEALTH) return null;
    const before = taker.health;
    taker.health = Math.min(MAX_HEALTH, taker.health + pickup.heal);
    return { kind: "health", healed: taker.health - before };
  }

  const weaponId = pickup.weaponId;
  if (!weaponId) return null;
  const spec = getWeapon(weaponId);
  const carried = pickup.magazine + pickup.reserve;

  const slot = taker.weapons.indexOf(weaponId);
  if (slot >= 0) {
    // Already carrying one: the drop is ammunition.
    const ammo = taker.ammo[slot];
    if (!ammo) return null;
    const cap = spec.reserveAmmo * rules.reserveCapMultiplier;
    const room = Math.max(0, cap - ammo.reserve);
    const added = Math.min(room, carried);
    if (added <= 0) return null;
    ammo.reserve += added;
    return { kind: "weapon", weaponId, slot, added: false, ammoAdded: added };
  }

  if (taker.weapons.length >= rules.maxWeapons) return null;
  taker.weapons.push(weaponId);
  taker.ammo.push({ magazine: pickup.magazine, reserve: pickup.reserve });
  return {
    kind: "weapon",
    weaponId,
    slot: taker.weapons.length - 1,
    added: true,
    ammoAdded: carried,
  };
}

/**
 * Is a point clear of the map's solids?
 *
 * A pickup placed inside a T-wall renders and is unreachable, which reads as a
 * bug the player cannot explain. Spawn lists are filtered through this once
 * at construction so a mistyped coordinate is dropped with a warning rather
 * than shipped.
 */
export function isClearOfSolids(map: CollisionMap, point: Vec3, margin = 0.3): boolean {
  for (const box of map.boxes) {
    if (
      point.x + margin > box.min.x &&
      point.x - margin < box.max.x &&
      point.z + margin > box.min.z &&
      point.z - margin < box.max.z &&
      point.y + 0.6 > box.min.y &&
      point.y < box.max.y
    ) {
      return false;
    }
  }
  return true;
}
