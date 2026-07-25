/**
 * Simulation constants shared by the authoritative server and the client's
 * prediction model. Any change here is a protocol change: bump
 * `PROTOCOL_VERSION` when a value alters where a player ends up.
 */

/** Authoritative match tick (PRD §30.4). */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

/** State snapshot cadence; tuned by measurement, not guessed in code. */
export const SNAPSHOT_RATE = 20;

/** Lag-compensation rewind cap (PRD §30.4). */
export const MAX_REWIND_MS = 200;

/** How many ticks of position history each player keeps for rewinding. */
export const HISTORY_TICKS = Math.ceil((MAX_REWIND_MS / TICK_MS) * 2);

// --------------------------------------------------------------------------
// Player capsule
// --------------------------------------------------------------------------

export const PLAYER_HALF_WIDTH = 0.35;
export const PLAYER_HEIGHT_STANDING = 1.8;
export const PLAYER_HEIGHT_CROUCHED = 1.2;
/** Camera / muzzle origin above the player's feet. */
export const EYE_HEIGHT_STANDING = 1.65;
export const EYE_HEIGHT_CROUCHED = 1.05;
/** Top fraction of the capsule that counts as a headshot. */
export const HEAD_FRACTION = 0.18;

// --------------------------------------------------------------------------
// Movement (PRD §12.1 — faster than a milsim, not superhuman)
// --------------------------------------------------------------------------

export const WALK_SPEED = 4.4;
export const SPRINT_SPEED = 6.6;
export const CROUCH_SPEED = 2.2;
export const GROUND_ACCELERATION = 60;
export const AIR_ACCELERATION = 12;
export const GROUND_FRICTION = 9;
export const GRAVITY = -22;
export const JUMP_VELOCITY = 7.2;
export const MAX_STEP_HEIGHT = 0.55;
export const TERMINAL_VELOCITY = -60;

/**
 * Hard ceiling used as a server-side sanity assertion. The server runs the sim
 * itself so a client cannot simply assert a position, but this catches a bug or
 * an unexpected input combination that would otherwise let someone fly.
 */
export const MAX_HORIZONTAL_SPEED = SPRINT_SPEED * 1.35;

/** Sprint only applies while moving meaningfully forward. */
export const SPRINT_FORWARD_THRESHOLD = 0.5;

// --------------------------------------------------------------------------
// Teams and spawning
// --------------------------------------------------------------------------

// Re-exported rather than redeclared: team ids are part of the wire state and
// map ids are content identifiers. Two copies would eventually disagree.
export { TEAM as TEAM_IDS } from "@nightcell7/multiplayer-protocol";
export { MULTIPLAYER_MAP } from "@nightcell7/game-core";

/** Spawn scoring weights (PRD §18.2: enemies, recent deaths, sightlines). */
export const SPAWN_ENEMY_RADIUS = 22;
export const SPAWN_RECENT_DEATH_RADIUS = 12;
export const SPAWN_RECENT_DEATH_MS = 12_000;
export const SPAWN_FRIENDLY_BONUS_RADIUS = 25;
