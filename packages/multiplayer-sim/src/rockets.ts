import {
  getWeapon,
  isProjectileWeapon,
  type WeaponId,
  type WeaponSpec,
} from "@nightcell7/game-core";
import { raycastWorld } from "./hitscan";
import type { CollisionMap } from "./map";
import { add, length, scale, sub, type Vec3 } from "./vec";

/**
 * Rocket flight.
 *
 * Server-authoritative like the grenade beside it: the client asks to fire and
 * the simulation decides where the rocket goes and what it hits. Same fixed
 * tick, so two clients watching the same shot see it land in the same place.
 *
 * A rocket is not a slow grenade. It does not bounce, it does not wait for a
 * fuse, and it detonates on the first thing it touches: geometry, a body, or
 * the end of its range. What it borrows from the grenade is only the blast,
 * through `resolveBlast`, which takes a `BlastProfile` that both satisfy.
 *
 * No Babylon, no DOM.
 */

export interface SimRocket {
  readonly id: string;
  readonly ownerId: string;
  /** Cached so the blast still resolves if the firer leaves mid-flight. */
  readonly ownerTeam: number;
  readonly weaponId: WeaponId;
  position: Vec3;
  velocity: Vec3;
  /** Metres travelled, against the weapon's `maxRangeM`. */
  travelledM: number;
  /** Set on the tick it hits something; the simulation detonates and drops it. */
  detonated: boolean;
  /** What it hit, for the client's impact effect. Null when it ran out of range. */
  impact: RocketImpact | null;
}

export interface RocketImpact {
  readonly point: Vec3;
  /** The player struck directly, if any. A direct hit adds the weapon's damage. */
  readonly directHitId: string | null;
}

/** A body a rocket can strike in flight. */
export interface RocketTarget {
  readonly id: string;
  readonly team: number;
  /** Centre of mass. */
  readonly center: Vec3;
  readonly alive: boolean;
}

/**
 * Collision radius of a rocket against a body, metres.
 *
 * Generous on purpose. The capsule is 0.3 m wide and a rocket crosses 1.4 m in
 * a tick; testing an exact intersection at that speed makes a visually
 * dead-centre shot pass through a torso between substeps. This is the same
 * reasoning the grenade's own radius is built on, and being slightly forgiving
 * is the right failure direction for a weapon you get once every four seconds.
 */
const BODY_RADIUS_M = 0.55;

/**
 * Advance a rocket by `dtMs`, stopping at whatever it hits first.
 *
 * Substepped against its own body radius for the same reason the grenade is:
 * at 42 m/s a 33 ms tick moves it 1.4 m, which is wider than the catwalk
 * plates and most of the cover in the yard, so a single step would tunnel
 * straight through them.
 */
export function stepRocket(
  rocket: SimRocket,
  dtMs: number,
  map: CollisionMap,
  targets: readonly RocketTarget[],
): void {
  if (rocket.detonated) return;

  const spec = getWeapon(rocket.weaponId);
  const gravity = spec.projectileGravity ?? 0;
  const dt = dtMs / 1000;

  const speed = length(rocket.velocity);
  const steps = Math.max(1, Math.ceil((speed * dt) / BODY_RADIUS_M));
  const h = dt / steps;

  for (let i = 0; i < steps; i += 1) {
    rocket.velocity = {
      x: rocket.velocity.x,
      y: rocket.velocity.y + gravity * h,
      z: rocket.velocity.z,
    };
    const next = add(rocket.position, scale(rocket.velocity, h));
    const segment = sub(next, rocket.position);
    const segmentLength = length(segment);
    if (segmentLength <= 0) continue;
    const direction = scale(segment, 1 / segmentLength);

    // A body first: a rocket that clips an operator standing against a wall
    // should detonate on the operator, not behind them.
    const body = firstBodyAlong(rocket, direction, segmentLength, targets);
    if (body) {
      rocket.position = add(rocket.position, scale(direction, body.distanceM));
      rocket.travelledM += body.distanceM;
      rocket.detonated = true;
      rocket.impact = { point: { ...rocket.position }, directHitId: body.id };
      return;
    }

    const world = raycastWorld(rocket.position, direction, map, segmentLength);
    if (world) {
      // Back off a hair from the surface. Detonating exactly on the plane puts
      // the blast centre inside the geometry, and `resolveBlast` traces line of
      // sight from that centre: inside a wall it would shadow everything and
      // the rocket would do nothing at all.
      const backedOff = Math.max(0, world.distance - 0.05);
      rocket.position = add(rocket.position, scale(direction, backedOff));
      rocket.travelledM += backedOff;
      rocket.detonated = true;
      rocket.impact = { point: { ...rocket.position }, directHitId: null };
      return;
    }

    rocket.position = next;
    rocket.travelledM += segmentLength;

    if (rocket.travelledM >= spec.maxRangeM) {
      rocket.detonated = true;
      rocket.impact = { point: { ...rocket.position }, directHitId: null };
      return;
    }
  }
}

/** The nearest body the segment passes within `BODY_RADIUS_M` of. */
function firstBodyAlong(
  rocket: SimRocket,
  direction: Vec3,
  maxDistance: number,
  targets: readonly RocketTarget[],
): { id: string; distanceM: number } | null {
  let best: { id: string; distanceM: number } | null = null;

  for (const target of targets) {
    if (!target.alive) continue;
    // The firer cannot be hit by their own rocket on the way out, or firing
    // while moving forward detonates it in your face on the first substep.
    if (target.id === rocket.ownerId) continue;

    const toTarget = sub(target.center, rocket.position);
    const along = dot(toTarget, direction);
    if (along < 0 || along > maxDistance) continue;

    const closest = add(rocket.position, scale(direction, along));
    const miss = length(sub(target.center, closest));
    if (miss > BODY_RADIUS_M) continue;

    if (!best || along < best.distanceM) best = { id: target.id, distanceM: along };
  }

  return best;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** The launch velocity for a weapon fired along `aim`. */
export function rocketLaunchVelocity(spec: WeaponSpec, aim: Vec3): Vec3 {
  if (!isProjectileWeapon(spec)) throw new Error(`${spec.id} is not a launcher`);
  return scale(aim, spec.projectileSpeedMps ?? 0);
}
