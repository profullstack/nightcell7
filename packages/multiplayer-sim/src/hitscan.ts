import { HEAD_FRACTION, HISTORY_TICKS, MAX_REWIND_MS, TICK_MS } from "./constants";
import { playerAabb, playerHeight } from "./movement";
import type { CollisionMap } from "./map";
import type { Aabb, Vec3 } from "./vec";

/**
 * Hitscan resolution with bounded lag compensation.
 *
 * PRD §18.4: "hitscan may use capped server rewind based on validated latency
 * and historical player capsules". The client never says what it hit — it says
 * where it was looking, and the server decides.
 */

export interface PlayerSnapshot {
  tick: number;
  position: Vec3;
  crouching: boolean;
  alive: boolean;
}

/**
 * Fixed-size ring of recent player positions. Bounded by construction so a long
 * match cannot grow memory without limit (PRD §30.4).
 */
export class PositionHistory {
  private readonly entries: (PlayerSnapshot | undefined)[] = new Array(HISTORY_TICKS);
  private cursor = 0;

  record(snapshot: PlayerSnapshot): void {
    this.entries[this.cursor] = { ...snapshot, position: { ...snapshot.position } };
    this.cursor = (this.cursor + 1) % HISTORY_TICKS;
  }

  /** Closest recorded snapshot at or before `tick`, or the oldest available. */
  at(tick: number): PlayerSnapshot | undefined {
    let best: PlayerSnapshot | undefined;
    for (const entry of this.entries) {
      if (!entry) continue;
      if (entry.tick <= tick && (!best || entry.tick > best.tick)) best = entry;
    }
    if (best) return best;
    // Everything recorded is newer than the requested tick (very early match):
    // fall back to the oldest snapshot rather than failing the shot.
    for (const entry of this.entries) {
      if (!entry) continue;
      if (!best || entry.tick < best.tick) best = entry;
    }
    return best;
  }

  clear(): void {
    this.entries.fill(undefined);
    this.cursor = 0;
  }
}

/**
 * How many ticks to rewind for a shooter with the given measured latency.
 * Clamped hard: an inflated ping must not buy a longer rewind (PRD §33.3).
 */
export function rewindTicks(latencyMs: number): number {
  const clamped = Math.min(Math.max(latencyMs, 0), MAX_REWIND_MS);
  return Math.round(clamped / TICK_MS);
}

export interface RayHit {
  /** Distance along the ray. */
  distance: number;
  point: Vec3;
}

/** Slab-method ray/AABB intersection. Returns the nearest positive hit. */
export function rayAabb(
  origin: Vec3,
  direction: Vec3,
  box: Aabb,
  maxDistance: number,
): RayHit | null {
  let tMin = 0;
  let tMax = maxDistance;

  for (const axis of ["x", "y", "z"] as const) {
    const d = direction[axis];
    const o = origin[axis];
    const min = box.min[axis];
    const max = box.max[axis];

    if (Math.abs(d) < 1e-9) {
      if (o < min || o > max) return null;
      continue;
    }

    const inv = 1 / d;
    let t1 = (min - o) * inv;
    let t2 = (max - o) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return {
    distance: tMin,
    point: {
      x: origin.x + direction.x * tMin,
      y: origin.y + direction.y * tMin,
      z: origin.z + direction.z * tMin,
    },
  };
}

/** Nearest world-geometry hit, used to decide whether a shot is blocked. */
export function raycastWorld(
  origin: Vec3,
  direction: Vec3,
  map: CollisionMap,
  maxDistance: number,
): RayHit | null {
  let nearest: RayHit | null = null;
  for (const box of map.boxes) {
    const hit = rayAabb(origin, direction, box, maxDistance);
    if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
  }
  return nearest;
}

export interface HitCandidate {
  id: string;
  team: number;
  snapshot: PlayerSnapshot;
}

export interface HitscanResult {
  victimId: string;
  distance: number;
  headshot: boolean;
  point: Vec3;
}

export interface HitscanOptions {
  origin: Vec3;
  direction: Vec3;
  maxDistance: number;
  map: CollisionMap;
  candidates: readonly HitCandidate[];
  /** Team of the shooter; friendly fire never registers as a hit in V1 TDM. */
  shooterTeam: number;
  /** Excluded so a player cannot shoot themselves through a rewind edge case. */
  shooterId: string;
}

/**
 * Resolve one traced projectile.
 *
 * Order matters: candidates are tested first, then the world hit is compared,
 * so a player standing behind a container cannot be hit through it.
 */
export function resolveHitscan(options: HitscanOptions): HitscanResult | null {
  const { origin, direction, maxDistance, map, candidates, shooterTeam, shooterId } = options;

  let best: HitscanResult | null = null;

  for (const candidate of candidates) {
    if (candidate.id === shooterId) continue;
    if (candidate.team === shooterTeam) continue;
    if (!candidate.snapshot.alive) continue;

    const box = playerAabb(candidate.snapshot.position, candidate.snapshot.crouching);
    const hit = rayAabb(origin, direction, box, maxDistance);
    if (!hit) continue;
    if (best && hit.distance >= best.distance) continue;

    const height = playerHeight(candidate.snapshot.crouching);
    const headThreshold = candidate.snapshot.position.y + height * (1 - HEAD_FRACTION);

    best = {
      victimId: candidate.id,
      distance: hit.distance,
      headshot: hit.point.y >= headThreshold,
      point: hit.point,
    };
  }

  if (!best) return null;

  const worldHit = raycastWorld(origin, direction, map, maxDistance);
  if (worldHit && worldHit.distance < best.distance) return null;

  return best;
}
