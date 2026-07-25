import { BUTTON, hasButton, type InputFrame } from "@nightcell7/multiplayer-protocol";
import {
  AIR_ACCELERATION,
  CROUCH_SPEED,
  GRAVITY,
  GROUND_ACCELERATION,
  GROUND_FRICTION,
  JUMP_VELOCITY,
  MAX_HORIZONTAL_SPEED,
  MAX_STEP_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT_CROUCHED,
  PLAYER_HEIGHT_STANDING,
  SPRINT_FORWARD_THRESHOLD,
  SPRINT_SPEED,
  TERMINAL_VELOCITY,
  WALK_SPEED,
} from "./constants";
import type { CollisionMap } from "./map";
import { aabbFromCenter, aabbOverlaps, horizontalLength, type Aabb, type Vec3 } from "./vec";

/**
 * Server-authoritative movement.
 *
 * The client runs this exact function for prediction and the server runs it for
 * truth (PRD §18.4). Because both sides execute the same code over the same
 * input, reconciliation is normally a no-op; when it is not, the server value
 * wins by definition.
 */

export interface MovementState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  grounded: boolean;
}

export function createMovementState(position: Vec3, yaw: number): MovementState {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    crouching: false,
    grounded: false,
  };
}

export function playerHeight(crouching: boolean): number {
  return crouching ? PLAYER_HEIGHT_CROUCHED : PLAYER_HEIGHT_STANDING;
}

export function playerAabb(position: Vec3, crouching: boolean): Aabb {
  return aabbFromCenter(position, PLAYER_HALF_WIDTH, playerHeight(crouching));
}

/**
 * Advance one player by a single input frame.
 *
 * Returns a NEW state; the caller decides whether to commit it. Keeping this
 * pure is what makes client-side rewind-and-replay reconciliation possible.
 */
export function stepMovement(
  state: Readonly<MovementState>,
  input: InputFrame,
  map: CollisionMap,
): MovementState {
  const dt = input.dtMs / 1000;
  if (dt <= 0) return cloneState(state);

  const next = cloneState(state);
  next.yaw = input.yaw;
  next.pitch = input.pitch;

  const wantsCrouch = hasButton(input.buttons, BUTTON.CROUCH);
  // Standing back up is refused when something is directly overhead, so a
  // player cannot clip into geometry by releasing crouch.
  if (!wantsCrouch && next.crouching) {
    const standing = playerAabb(next.position, false);
    next.crouching = collides(standing, map);
  } else {
    next.crouching = wantsCrouch;
  }

  // --- desired direction in world space ------------------------------------
  const sinYaw = Math.sin(next.yaw);
  const cosYaw = Math.cos(next.yaw);
  const wishX = input.moveX * cosYaw + input.moveZ * sinYaw;
  const wishZ = -input.moveX * sinYaw + input.moveZ * cosYaw;

  const sprinting =
    hasButton(input.buttons, BUTTON.SPRINT) &&
    !next.crouching &&
    input.moveZ > SPRINT_FORWARD_THRESHOLD;

  const targetSpeed = next.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;

  const wishMagnitude = Math.hypot(wishX, wishZ);
  const acceleration = next.grounded ? GROUND_ACCELERATION : AIR_ACCELERATION;

  if (wishMagnitude > 1e-4) {
    const dirX = wishX / wishMagnitude;
    const dirZ = wishZ / wishMagnitude;
    const desiredSpeed = targetSpeed * Math.min(1, wishMagnitude);
    const currentSpeed = next.velocity.x * dirX + next.velocity.z * dirZ;
    const addSpeed = desiredSpeed - currentSpeed;
    if (addSpeed > 0) {
      const accelSpeed = Math.min(addSpeed, acceleration * dt * Math.min(1, wishMagnitude));
      next.velocity.x += dirX * accelSpeed;
      next.velocity.z += dirZ * accelSpeed;
    }
  }

  if (next.grounded && wishMagnitude <= 1e-4) {
    const speed = horizontalLength(next.velocity);
    if (speed > 1e-4) {
      const drop = speed * GROUND_FRICTION * dt;
      const scaleFactor = Math.max(0, speed - drop) / speed;
      next.velocity.x *= scaleFactor;
      next.velocity.z *= scaleFactor;
    } else {
      next.velocity.x = 0;
      next.velocity.z = 0;
    }
  }

  if (hasButton(input.buttons, BUTTON.JUMP) && next.grounded) {
    next.velocity.y = JUMP_VELOCITY;
    next.grounded = false;
  }

  next.velocity.y = Math.max(TERMINAL_VELOCITY, next.velocity.y + GRAVITY * dt);

  // Safety assertion — the sim should never produce this, but a bug must not
  // become a speed exploit (PRD §33.3).
  clampHorizontalSpeed(next.velocity);

  moveAndCollide(next, map, dt);

  return next;
}

function clampHorizontalSpeed(velocity: Vec3): void {
  const speed = horizontalLength(velocity);
  if (speed > MAX_HORIZONTAL_SPEED) {
    const s = MAX_HORIZONTAL_SPEED / speed;
    velocity.x *= s;
    velocity.z *= s;
  }
}

/**
 * Axis-separated sweep. Resolving X, then Z, then Y keeps a player sliding
 * along a wall instead of sticking to it, which is the difference between
 * "moves well" and "snags on everything" (PRD §12.1).
 */
function moveAndCollide(state: MovementState, map: CollisionMap, dt: number): void {
  const crouching = state.crouching;

  // --- X --------------------------------------------------------------------
  if (state.velocity.x !== 0) {
    const candidate = { ...state.position, x: state.position.x + state.velocity.x * dt };
    if (collides(playerAabb(candidate, crouching), map)) {
      const stepped = tryStepUp(candidate, state, map, crouching);
      if (stepped) {
        state.position = stepped;
      } else {
        state.velocity.x = 0;
      }
    } else {
      state.position = candidate;
    }
  }

  // --- Z --------------------------------------------------------------------
  if (state.velocity.z !== 0) {
    const candidate = { ...state.position, z: state.position.z + state.velocity.z * dt };
    if (collides(playerAabb(candidate, crouching), map)) {
      const stepped = tryStepUp(candidate, state, map, crouching);
      if (stepped) {
        state.position = stepped;
      } else {
        state.velocity.z = 0;
      }
    } else {
      state.position = candidate;
    }
  }

  // --- Y --------------------------------------------------------------------
  const movingDown = state.velocity.y <= 0;
  state.grounded = false;
  if (state.velocity.y !== 0) {
    const candidate = { ...state.position, y: state.position.y + state.velocity.y * dt };
    if (collides(playerAabb(candidate, crouching), map)) {
      const resolvedY = resolveVertical(state.position, candidate, map, crouching, movingDown);
      state.position = { ...state.position, y: resolvedY };
      state.grounded = movingDown;
      state.velocity.y = 0;
    } else {
      state.position = candidate;
    }
  }

  // Ground probe: a player standing exactly on a surface has zero vertical
  // velocity after the resolution above, so grounded must be re-tested or
  // jumping would only work on the first frame of contact.
  if (!state.grounded) {
    const probe = { ...state.position, y: state.position.y - 0.02 };
    if (collides(playerAabb(probe, crouching), map)) state.grounded = true;
  }

  clampToBounds(state, map);
}

/** Walk up shallow steps (stairs, kerbs) without needing a jump. */
function tryStepUp(
  candidate: Vec3,
  state: Readonly<MovementState>,
  map: CollisionMap,
  crouching: boolean,
): Vec3 | null {
  if (!state.grounded) return null;
  for (let lift = 0.1; lift <= MAX_STEP_HEIGHT; lift += 0.1) {
    const raised = { ...candidate, y: candidate.y + lift };
    if (!collides(playerAabb(raised, crouching), map)) return raised;
  }
  return null;
}

/** Binary search the last non-colliding Y between the old and new position. */
function resolveVertical(
  from: Vec3,
  to: Vec3,
  map: CollisionMap,
  crouching: boolean,
  _movingDown: boolean,
): number {
  let safe = from.y;
  let blocked = to.y;
  for (let i = 0; i < 8; i += 1) {
    const mid = (safe + blocked) / 2;
    if (collides(playerAabb({ ...from, y: mid }, crouching), map)) {
      blocked = mid;
    } else {
      safe = mid;
    }
  }
  return safe;
}

function clampToBounds(state: MovementState, map: CollisionMap): void {
  const { bounds } = map;
  state.position.x = Math.min(Math.max(state.position.x, bounds.min.x), bounds.max.x);
  state.position.z = Math.min(Math.max(state.position.z, bounds.min.z), bounds.max.z);
  if (state.position.y > bounds.max.y) {
    state.position.y = bounds.max.y;
    state.velocity.y = Math.min(0, state.velocity.y);
  }
}

export function collides(box: Aabb, map: CollisionMap): boolean {
  for (const solid of map.boxes) {
    if (aabbOverlaps(box, solid)) return true;
  }
  return false;
}

/** True when the player has fallen out of the world and should be killed. */
export function isBelowKillPlane(position: Vec3, map: CollisionMap): boolean {
  return position.y < map.killPlaneY;
}

function cloneState(state: Readonly<MovementState>): MovementState {
  return {
    position: { ...state.position },
    velocity: { ...state.velocity },
    yaw: state.yaw,
    pitch: state.pitch,
    crouching: state.crouching,
    grounded: state.grounded,
  };
}
