import { GRENADE_SPEC, grenadeDamageAt, type GrenadeSpec } from "@nightcell7/game-core";
import { GRAVITY } from "./constants";
import { raycastWorld } from "./hitscan";
import type { CollisionMap } from "./map";
import { add, distance, length, normalize, scale, sub, type Aabb, type Vec3 } from "./vec";

/**
 * Grenade flight and detonation.
 *
 * Server-authoritative like everything else in this package (CLAUDE.md: the
 * client sends intent, never a position or a hit claim). A thrown grenade is
 * simulated here on the same fixed tick as movement, so two clients watching
 * the same throw see it land in the same place.
 *
 * No Babylon, no DOM — this runs in the Railway container, in the browser as
 * the prediction model, and in the tests.
 */

export interface SimGrenade {
  readonly id: string;
  readonly ownerId: string;
  /** Cached so a blast can be resolved after the thrower has left the match. */
  readonly ownerTeam: number;
  position: Vec3;
  velocity: Vec3;
  /** Counts down; detonates at or below zero. */
  fuseRemainingMs: number;
  /** Bounces so far, for the client's impact sounds. */
  bounces: number;
  /** True once it has come to rest, so it stops costing collision work. */
  resting: boolean;
}

export interface BlastVictim {
  readonly playerId: string;
  readonly damage: number;
  readonly distanceM: number;
}

/** A player as far as a blast is concerned. */
export interface BlastCandidate {
  readonly id: string;
  readonly team: number;
  /** Centre of mass, not the feet — a blast at head height should not miss. */
  readonly center: Vec3;
  readonly alive: boolean;
}

/**
 * Advance a grenade by `dtMs`.
 *
 * Substepped, because a grenade leaves the hand at 15 m/s and a 33 ms tick
 * would move it half a metre per step — enough to pass straight through the
 * 0.4 m catwalk plates and land under the map. The substep is sized so it
 * never travels more than its own radius.
 */
export function stepGrenade(
  grenade: SimGrenade,
  dtMs: number,
  map: CollisionMap,
  spec: GrenadeSpec = GRENADE_SPEC,
): void {
  grenade.fuseRemainingMs -= dtMs;
  if (grenade.resting) return;

  const dt = dtMs / 1000;
  const speed = length(grenade.velocity);
  const maxStep = spec.radiusM;
  const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / maxStep)));
  const h = dt / steps;

  for (let i = 0; i < steps; i += 1) {
    grenade.velocity = {
      x: grenade.velocity.x,
      y: grenade.velocity.y + GRAVITY * h,
      z: grenade.velocity.z,
    };

    const next = add(grenade.position, scale(grenade.velocity, h));
    const blocked = firstBlockingAxis(grenade.position, next, map, spec.radiusM);

    if (!blocked) {
      grenade.position = next;
      continue;
    }

    // Reflect along the blocked axis, damp the rest. Axis-aligned boxes make
    // this exact without a general contact normal.
    grenade.velocity = bounce(grenade.velocity, blocked, spec);
    grenade.bounces += 1;

    // Come to rest rather than jittering forever on a floor. Below this the
    // remaining motion is invisible and only costs collision work.
    if (length(grenade.velocity) < 0.55) {
      grenade.velocity = { x: 0, y: 0, z: 0 };
      grenade.resting = true;
      return;
    }
  }
}

/** True once the fuse has run out. */
export function grenadeShouldDetonate(grenade: SimGrenade): boolean {
  return grenade.fuseRemainingMs <= 0;
}

/**
 * Who a detonation hurts, and how much.
 *
 * Two rules that are not obvious from the numbers:
 *
 *  * **Teammates are immune, the thrower is not.** Hitscan already skips
 *    teammates entirely, so grenades hurting them would make the throwable the
 *    one griefing vector in a free alpha. The thrower still takes a share, or
 *    the arc stops being a decision and every wall in reach gets a grenade.
 *  * **Cover works.** Damage requires an unobstructed line from the blast
 *    centre to the victim, so a grenade on the far side of a container is a
 *    noise. Without it the yard's three lanes stop mattering the moment
 *    anything is thrown.
 */
export function resolveBlast(
  center: Vec3,
  ownerId: string,
  ownerTeam: number,
  candidates: readonly BlastCandidate[],
  map: CollisionMap,
  spec: GrenadeSpec = GRENADE_SPEC,
): BlastVictim[] {
  const victims: BlastVictim[] = [];

  for (const candidate of candidates) {
    if (!candidate.alive) continue;

    const isOwner = candidate.id === ownerId;
    if (!isOwner && candidate.team === ownerTeam) continue;

    const distanceM = distance(center, candidate.center);
    if (distanceM >= spec.outerRadiusM) continue;

    if (!hasLineOfSight(center, candidate.center, map)) continue;

    let damage = grenadeDamageAt(distanceM, spec);
    if (isOwner) damage *= spec.selfDamageFraction;
    if (damage <= 0) continue;

    victims.push({ playerId: candidate.id, damage, distanceM });
  }

  return victims;
}

/**
 * Is there an unobstructed line between two points?
 *
 * The blast centre can end up inside a wall — a grenade resting against one
 * detonates a few centimetres inside it — which would trace zero distance and
 * shadow everything. The trace is therefore started slightly *toward* the
 * target, and a hit is only blocking if it lands short of it.
 */
function hasLineOfSight(from: Vec3, to: Vec3, map: CollisionMap): boolean {
  const delta = sub(to, from);
  const span = length(delta);
  if (span < 1e-4) return true;

  const direction = normalize(delta);
  const origin = add(from, scale(direction, 0.12));
  const remaining = span - 0.12;
  if (remaining <= 0) return true;

  const hit = raycastWorld(origin, direction, map, remaining);
  // A hit exactly at the target is the target's own cover-free position.
  return hit === null || hit.distance >= remaining - 1e-3;
}

/**
 * Which axis, if any, a move is blocked along.
 *
 * Each axis is tested independently and applied in turn, the same approach
 * `stepMovement` uses for the player capsule, so a grenade sliding along a
 * wall keeps its tangential speed instead of stopping dead.
 */
function firstBlockingAxis(
  from: Vec3,
  to: Vec3,
  map: CollisionMap,
  radius: number,
): "x" | "y" | "z" | null {
  // Vertical first: the overwhelmingly common contact is a floor, and
  // resolving it first stops a grenade skidding into a wall it never reached.
  const axes: ("y" | "x" | "z")[] = ["y", "x", "z"];
  const at = { ...from };

  for (const axis of axes) {
    const candidate = { ...at, [axis]: to[axis] };
    if (overlapsWorld(candidate, radius, map)) return axis;
    at[axis] = to[axis];
  }
  return null;
}

function bounce(velocity: Vec3, axis: "x" | "y" | "z", spec: GrenadeSpec): Vec3 {
  const damped: Vec3 = {
    x: velocity.x * spec.friction,
    y: velocity.y * spec.friction,
    z: velocity.z * spec.friction,
  };
  damped[axis] = -velocity[axis] * spec.restitution;
  return damped;
}

function overlapsWorld(center: Vec3, radius: number, map: CollisionMap): boolean {
  const box: Aabb = {
    min: { x: center.x - radius, y: center.y - radius, z: center.z - radius },
    max: { x: center.x + radius, y: center.y + radius, z: center.z + radius },
  };
  for (const solid of map.boxes) {
    if (
      box.min.x < solid.max.x &&
      box.max.x > solid.min.x &&
      box.min.y < solid.max.y &&
      box.max.y > solid.min.y &&
      box.min.z < solid.max.z &&
      box.max.z > solid.min.z
    ) {
      return true;
    }
  }
  return false;
}
