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
/**
 * Where God Mode can appear.
 *
 * Deliberately out at the edges and away from the health packs: thirty
 * seconds of invulnerability should cost a walk across open ground, not sit
 * on the route a player already runs for health.
 */
export const SANDBOX_GOD_SPAWNS: readonly Vec3[] = [
  { x: 30, y: 0, z: 34 },
  { x: -30, y: 0, z: -34 },
  { x: 0, y: 0, z: -40 },
];

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
  godSpawns: SANDBOX_GOD_SPAWNS,
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
 * Varied so that killing one is worth something: the simulation drops the
 * weapon a fighter was holding, with its magazine and reserve, so the roster
 * is the only thing deciding what a kill can hand you. Every entry is
 * multiplayer-legal — the simulation strips anything that is not, which is why
 * the M7 Lance is absent: it is campaign-only (PRD §5.4).
 *
 * Between them these four cover every weapon a match allows — now six, with the
 * Tesla and the Cinder — so a player who works through the Directorate can end
 * up carrying any of them. A test enforces that coverage, and it is what
 * caught the two new weapons being unobtainable the moment they were added.
 *
 * **Exactly one launcher.** The rotation is indexed, not rolled, so the cap is
 * structural rather than a probability that can go wrong: with four enemies,
 * index 2 is the only Hammerfall on the field. Four fighters with launchers is
 * a fireworks display, not a firefight, and a random draw eventually produces
 * one.
 */
const ENEMY_LOADOUTS: readonly (readonly WeaponId[])[] = [
  [WEAPON.C9_KESTREL, WEAPON.P11],
  [WEAPON.B4_BREACHER, WEAPON.V3_TESLA],
  [WEAPON.M9_HAMMERFALL, WEAPON.P11],
  [WEAPON.K5_CINDER, WEAPON.C9_KESTREL],
];

/**
 * Friendlies carry no launcher.
 *
 * Not a balance call — a squadmate firing rockets around the player in a
 * yard this size is mostly a way to be killed by your own side.
 */
const FRIENDLY_LOADOUTS: readonly (readonly WeaponId[])[] = [
  [WEAPON.C9_KESTREL, WEAPON.P11],
  [WEAPON.B4_BREACHER, WEAPON.P11],
];

export function botLoadout(enemy: boolean, index: number): readonly WeaponId[] {
  const table = enemy ? ENEMY_LOADOUTS : FRIENDLY_LOADOUTS;
  return table[index % table.length] ?? FRIENDLY_LOADOUTS[0]!;
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
  // The launcher has its own silhouette, and it is the whole point of it:
  // a fighter carrying one has to read as a threat from across the yard.
  [WEAPON.M9_HAMMERFALL]: "m3_launcher",
  // Borrowed silhouettes, the same trade the P11 and the B4 already make: the
  // wrong shape beats no shape. The Tesla takes the SMG's compact body and the
  // Cinder the launcher's bulk, which is at least the right weight class for a
  // fuel tank. Bespoke meshes are a follow-up, not a blocker.
  [WEAPON.V3_TESLA]: "m3_smg",
  [WEAPON.K5_CINDER]: "m3_launcher",
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
  // Fitted longer than the rifles, because the tube reading as oversized in
  // the hands is exactly the feedback a rocket launcher should give.
  [WEAPON.M9_HAMMERFALL]: { model: "m3_launcher", fitLengthM: 0.82 },
  [WEAPON.V3_TESLA]: { model: "m3_smg", fitLengthM: 0.52 },
  [WEAPON.K5_CINDER]: { model: "m3_launcher", fitLengthM: 0.74 },
};
