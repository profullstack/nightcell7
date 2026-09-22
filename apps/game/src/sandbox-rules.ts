import { WEAPON, getWeapon, type WeaponId } from "@nightcell7/game-core";
import {
  DEFAULT_BOT_TUNING,
  type BotTuning,
  type PickupRules,
  type Vec3,
} from "@nightcell7/multiplayer-sim";
import type { ModelName } from "./assets";

/**
 * Rules for the single-player sandbox that the simulation does not decide on
 * its own: where health packs appear, and what the bots carry.
 *
 * Kept free of Babylon so a test can check the numbers without a renderer.
 */

/**
 * Health pack spawns in Ardavan Yard.
 *
 * Mid-map on purpose. A pack at your own spawn is a free heal between fights;
 * one in the lanes is a reason to leave cover. Every point is checked against
 * the collision volumes at boot (`isClearOfSolids`) and again in the test
 * suite, so a coordinate inside a wall cannot ship.
 */
export const SANDBOX_HEALTH_SPAWNS: readonly Vec3[] = [
  // Just south of the central hard point, which itself is solid.
  { x: 0, y: 0, z: 6 },
  { x: -22, y: 0, z: 14 },
  { x: 26, y: 0, z: -14 },
  { x: -14, y: 0, z: -28 },
  { x: 14, y: 0, z: 28 },
];

/**
 * Stamina: the player's maximum health.
 *
 * Starts above the bots' 100 and grows with every health pack collected, so
 * holding the lanes is rewarded with a player who can take more. Kept across
 * redeploys within a session.
 */
export const SANDBOX_STARTING_STAMINA = 150;
export const SANDBOX_STAMINA_PER_PACK = 25;
export const SANDBOX_STAMINA_CAP = 300;

/**
 * Health a rifle round costs the player, before armour.
 *
 * The demo is for exploring the yard, not for being good at it yet. Four
 * bots landing full-damage rounds emptied a player in about a second; at
 * the Field Agent multiplier, in ten. This is the number the player asked
 * for: a hit stings, a fight is survivable, and a few minutes in the open
 * is possible. Bots take full damage from each other and from the player.
 */
export const SANDBOX_HEALTH_PER_RIFLE_ROUND = 4;

/** Damage the player takes, as a fraction of what a bot would. */
export const SANDBOX_HUMAN_INCOMING_DAMAGE =
  SANDBOX_HEALTH_PER_RIFLE_ROUND / getWeapon(WEAPON.C9_KESTREL).damage;

/**
 * How the Directorate bots fight the player.
 *
 * Match bots hold the trigger down with a 3.4° aim error, which is the
 * right opponent for a match and the wrong one for a first visit. Sandbox
 * enemies fire in short bursts with a pause between, take longer to react,
 * and wobble more; friendlies keep the match tuning so they still win their
 * fights and the yard stays alive around the player.
 */
export const SANDBOX_ENEMY_TUNING: BotTuning = {
  ...DEFAULT_BOT_TUNING,
  aimError: 0.14,
  reactionMs: 900,
  burstMs: 300,
  burstPauseMs: 1_700,
};

export const SANDBOX_PICKUPS: Partial<PickupRules> = {
  healthSpawns: SANDBOX_HEALTH_SPAWNS,
  healthFirstSpawnMs: 10_000,
  healthRespawnMs: 30_000,
  healAmount: 50,
  dropWeapons: true,
  // Short enough that seven bots dying on a loop do not carpet the lanes.
  dropExpiresMs: 20_000,
  staminaPerPack: SANDBOX_STAMINA_PER_PACK,
  staminaCap: SANDBOX_STAMINA_CAP,
};

/**
 * What each bot carries, by roster index within its team.
 *
 * Varied so that killing one is worth something: a Directorate fighter with
 * a Breacher drops a weapon the player did not spawn with. Every entry is
 * multiplayer-legal — the simulation strips anything that is not.
 */
const ENEMY_LOADOUTS: readonly (readonly WeaponId[])[] = [
  [WEAPON.C9_KESTREL, WEAPON.P11],
  [WEAPON.B4_BREACHER, WEAPON.P11],
  [WEAPON.C9_KESTREL, WEAPON.P11],
  [WEAPON.C9_KESTREL],
];
const FRIENDLY_LOADOUT: readonly WeaponId[] = [WEAPON.C9_KESTREL, WEAPON.P11];

export function botLoadout(enemy: boolean, index: number): readonly WeaponId[] {
  if (!enemy) return FRIENDLY_LOADOUT;
  return ENEMY_LOADOUTS[index % ENEMY_LOADOUTS.length] ?? FRIENDLY_LOADOUT;
}

/**
 * Which shipped mesh stands in for each weapon.
 *
 * Only the C9 and the SMG have a model of their own. The P11 borrows the SMG
 * and the B4 the marksman rifle: the wrong silhouette, but a silhouette, and
 * a fighter with the wrong gun in hand beats one with nothing.
 */
export const WEAPON_WORLD_MODEL: Readonly<Record<WeaponId, ModelName>> = {
  [WEAPON.C9_KESTREL]: "m3_rifle",
  [WEAPON.P11]: "m3_smg",
  [WEAPON.B4_BREACHER]: "m3_marksman",
  [WEAPON.M7_LANCE]: "m3_marksman",
};

export interface ViewmodelSpec {
  readonly model: ModelName;
  /**
   * Fixed scale, or an apparent length in metres to fit the model to.
   * The first-person carbine keeps the scale it was tuned with; the world
   * meshes standing in for the others are fitted by their bounding box.
   */
  readonly scale?: number;
  readonly fitLengthM?: number;
}

export const WEAPON_VIEWMODEL: Readonly<Record<WeaponId, ViewmodelSpec>> = {
  [WEAPON.C9_KESTREL]: { model: "m2_carbine_fp", scale: 0.525 },
  [WEAPON.P11]: { model: "m3_smg", fitLengthM: 0.36 },
  [WEAPON.B4_BREACHER]: { model: "m3_marksman", fitLengthM: 0.6 },
  [WEAPON.M7_LANCE]: { model: "m3_marksman", fitLengthM: 0.62 },
};
