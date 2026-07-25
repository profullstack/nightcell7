/**
 * Minimal vector math.
 *
 * Deliberately not Babylon's `Vector3`: this package must run on a Railway
 * container with no GPU, no DOM and no renderer (CLAUDE.md), and the server
 * simulation is the one place where an accidental engine import would be
 * expensive to unwind later.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function horizontalLength(a: Vec3): number {
  return Math.hypot(a.x, a.z);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 1e-9 ? scale(a, 1 / len) : vec3();
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Unit forward vector for a yaw/pitch pair, matching the client's convention. */
export function directionFromAngles(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosPitch,
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  };
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export function aabbFromCenter(center: Vec3, halfWidth: number, height: number): Aabb {
  return {
    min: { x: center.x - halfWidth, y: center.y, z: center.z - halfWidth },
    max: { x: center.x + halfWidth, y: center.y + height, z: center.z + halfWidth },
  };
}

export function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}
