import { MULTIPLAYER_MAP, TEAM_IDS } from "./constants";
import type { Aabb, Vec3 } from "./vec";

/**
 * Headless map representation.
 *
 * PRD §18.2: "the server loads a headless simplified map representation, not
 * Babylon render assets", and "competitive collision mesh is simpler than
 * visual geometry". This file is that representation — axis-aligned boxes, spawn
 * points and a checksum that participates in the join handshake.
 *
 * The visual map in `apps/game` is authored separately and must agree with this
 * collision data; the checksum is what catches a drift between them.
 */

export interface SpawnPoint {
  readonly position: Vec3;
  readonly yaw: number;
  readonly team: number;
  /** Human-readable callout used by the spawn selector's logging. */
  readonly label: string;
}

/**
 * What a volume is, for the client's benefit.
 *
 * The visual map classifies most volumes by their dimensions, which keeps the
 * skinning stable when a box moves. That works while every volume is a wall, a
 * deck or a container — shapes the yard has only one of. It breaks for props:
 * an armoured car and a ramp step are both about 1.5 m tall, and telling them
 * apart by footprint alone is exactly the silent mis-skin that heuristic was
 * meant to avoid. So these say what they are.
 *
 * The tag is presentation metadata and is deliberately **not** part of
 * `mapChecksum` — two clients disagreeing about which model to draw is a
 * cosmetic difference, while disagreeing about where the solid is is not.
 */
export type VolumeTag =
  | "vehicle_armored_car"
  | "vehicle_technical"
  | "barrier"
  | "water_tank"
  | "barrel_stack"
  | "tent"
  | "guard_tower";

/** A collision volume, optionally naming what the client should draw for it. */
export interface MapVolume extends Aabb {
  readonly tag?: VolumeTag;
}

export interface CollisionMap {
  readonly id: string;
  readonly displayName: string;
  /** Solid, axis-aligned volumes. Floors are boxes too. */
  readonly boxes: readonly MapVolume[];
  readonly spawns: readonly SpawnPoint[];
  /** Playable volume; anything outside is out of bounds. */
  readonly bounds: Aabb;
  /** Falling below this kills, so a geometry hole cannot strand a player. */
  readonly killPlaneY: number;
}

function box(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Aabb {
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/**
 * A collision volume that also tells the client what to draw.
 *
 * Dimensions come from measuring the shipped GLB, not from taste: a volume that
 * does not match its model is either cover you cannot see or a model you walk
 * through, and both are worse than having neither.
 */
function prop(
  tag: VolumeTag,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): MapVolume {
  return { ...box(minX, minY, minZ, maxX, maxY, maxZ), tag };
}

/**
 * ARDAVAN YARD — the V1 6v6 map (PRD §18.2).
 *
 * Layout intent, held here so the collision data is reviewable against the
 * design requirements rather than being an opaque blob:
 *   - three primary lanes (west pipe rack, central yard, east tank row) with
 *     cross-links, not a rigid corridor grid;
 *   - two vertical routes (west catwalk, east gantry);
 *   - protected spawn zones at either end, each with multiple exits;
 *   - no one-way geometry: every raised route has a reachable way down.
 *
 * Scale: one unit is one metre (CLAUDE.md).
 */
export const ARDAVAN_YARD: CollisionMap = {
  id: MULTIPLAYER_MAP.ARDAVAN_YARD,
  displayName: "Ardavan Yard",
  bounds: box(-40, -5, -60, 40, 30, 60),
  killPlaneY: -4,
  boxes: [
    // Ground plane.
    box(-40, -1, -60, 40, 0, 60),

    // Perimeter walls.
    box(-40, 0, -60, -38, 12, 60),
    box(38, 0, -60, 40, 12, 60),
    box(-40, 0, -60, 40, 12, -58),
    box(-40, 0, 58, 40, 12, 60),

    // --- west lane: pipe rack with a catwalk over it ------------------------
    box(-30, 0, -30, -26, 4, 30), // pipe rack base
    box(-32, 6, -34, -24, 6.4, 34), // catwalk deck
    box(-26, 0, -6, -22, 3, 6), // cross-link block into centre

    // --- centre lane: container yard ---------------------------------------
    box(-8, 0, -20, -2, 3, -14),
    box(2, 0, -20, 8, 3, -14),
    box(-6, 0, -4, 6, 2.6, 4), // central hard point
    box(-8, 0, 14, -2, 3, 20),
    box(2, 0, 14, 8, 3, 20),

    // --- east lane: storage tanks and gantry --------------------------------
    box(22, 0, -34, 30, 8, -22),
    box(22, 0, 22, 30, 8, 34),
    box(24, 6, -20, 32, 6.4, 20), // gantry deck
    box(20, 0, -6, 24, 3, 6), // cross-link block into centre

    // --- prop cover: solid, and drawn as what it is -------------------------
    //
    // These are the licensed Synty vehicles and barriers. They were originally
    // placed as art only, tucked behind the spawns and outside the lanes so
    // they could not become cover a player trusts and then dies behind. The
    // result was assets nobody ever saw: players run *into* the map, and the
    // props were behind them in unlit corners.
    //
    // Making them real collision instead fixes both problems at once — they sit
    // in the lanes where they are useful, and the yard keeps its rule that what
    // you see is what you collide with. Heights are the model's body, not its
    // aerial or its gun barrel: being stopped by a thin antenna is worse than
    // clipping one.
    //
    // Every extent below is measured from the shipped GLB.

    // Armoured car, west-centre open ground. 2.5 x 4.65 body, 1.9 m of cover.
    prop("vehicle_armored_car", -17.3, 0, -12.4, -14.7, 1.9, -7.6),
    // Technical, east-centre. Longer at 5.87 m, so it breaks a longer sightline.
    prop("vehicle_technical", 12.7, 0, 9.0, 15.3, 1.9, 15.0),

    // T-walls flanking the centre lane on both approaches. Offset in pairs
    // rather than a continuous line: cover to fight from, not a wall that
    // closes the lane.
    prop("barrier", -4.86, 0, -26.35, -3.14, 3.2, -25.65),
    prop("barrier", 3.14, 0, -26.35, 4.86, 3.2, -25.65),
    prop("barrier", -4.86, 0, 25.65, -3.14, 3.2, 26.35),
    prop("barrier", 3.14, 0, 25.65, 4.86, 3.2, 26.35),

    // Full-height water tank on the east approach.
    prop("water_tank", 16.9, 0, -15.2, 19.1, 3.6, -12.8),

    // Barrel pallets: 1.3 m, so they are crouch cover only.
    prop("barrel_stack", -20.8, 0, 15.2, -19.2, 1.3, 16.8),
    prop("barrel_stack", 15.2, 0, -4.8, 16.8, 1.3, -3.2),
    prop("barrel_stack", -12.8, 0, -1.8, -11.2, 1.3, -0.2),
    prop("barrel_stack", 9.2, 0, -20.8, 10.8, 1.3, -19.2),
    prop("barrel_stack", -9.8, 0, 28.2, -8.2, 1.3, 29.8),
    // Under the east gantry, which starts at y=6 — no vertical overlap.
    prop("barrel_stack", 24.2, 0, 8.2, 25.8, 1.3, 9.8),

    prop("water_tank", -24.1, 0, -20.2, -21.9, 3.6, -17.8),
    prop("water_tank", 20.9, 0, 16.8, 23.1, 3.6, 19.2),

    // --- the walk out of spawn ----------------------------------------------
    //
    // The first version of this put nine props across an 80 x 120 m yard and
    // called it done. From a spawn point at night they were specks 40 m away,
    // and the map read as completely unchanged — which is what the operator
    // reported, and they were right.
    //
    // Density where players actually are matters more than total count. These
    // sit at the spawn exits, so they are the first thing in view when a round
    // starts, and at the map corners, where a tall silhouette gives the yard
    // depth against the dawn.

    // Tents flanking both spawn exits. 4.9 m across and 3 m tall — mass you
    // cannot miss on the way out.
    prop("tent", -20, 0, -36.9, -15.1, 3.0, -32.0),
    prop("tent", 15.1, 0, -36.9, 20, 3.0, -32.0),
    prop("tent", -20, 0, 32.0, -15.1, 3.0, 36.9),
    prop("tent", 15.1, 0, 32.0, 20, 3.0, 36.9),

    // Guard towers in the four corners: 8.9 m, read as silhouettes against the
    // false dawn from anywhere on the map.
    prop("guard_tower", -35.5, 0, -35.9, -32.6, 8.8, -32.0),
    prop("guard_tower", 32.6, 0, -35.9, 35.5, 8.8, -32.0),
    prop("guard_tower", -35.5, 0, 32.0, -32.6, 8.8, 35.9),
    prop("guard_tower", 32.6, 0, 32.0, 35.5, 8.8, 35.9),

    // T-walls at the centre-lane mouths, right where players funnel out.
    prop("barrier", -6.86, 0, -33.35, -5.14, 3.2, -32.65),
    prop("barrier", 5.14, 0, -33.35, 6.86, 3.2, -32.65),
    prop("barrier", -6.86, 0, 32.65, -5.14, 3.2, 33.35),
    prop("barrier", 5.14, 0, 32.65, 6.86, 3.2, 33.35),

    // --- stairs / ramps: the "no one-way geometry" guarantee ----------------
    // West catwalk access ramp (stepped boxes, climbable by step height).
    box(-24, 0, 30, -22, 1.5, 34),
    box(-24, 1.5, 26, -22, 3, 30),
    box(-24, 3, 22, -22, 4.5, 26),
    box(-24, 4.5, 18, -22, 6, 22),
    // East gantry access ramp.
    box(22, 0, -34, 24, 1.5, -30),
    box(22, 1.5, -30, 24, 3, -26),
    box(22, 3, -26, 24, 4.5, -22),
    box(22, 4.5, -22, 24, 6, -18),
  ],
  spawns: [
    // Nightcell side (south), multiple exits into all three lanes.
    {
      position: { x: -20, y: 0, z: 46 },
      yaw: Math.PI,
      team: TEAM_IDS.NIGHTCELL,
      label: "West Dock",
    },
    { position: { x: 0, y: 0, z: 50 }, yaw: Math.PI, team: TEAM_IDS.NIGHTCELL, label: "Yard Gate" },
    {
      position: { x: 20, y: 0, z: 46 },
      yaw: Math.PI,
      team: TEAM_IDS.NIGHTCELL,
      label: "East Pumps",
    },
    {
      position: { x: -8, y: 0, z: 44 },
      yaw: Math.PI,
      team: TEAM_IDS.NIGHTCELL,
      label: "Loading Bay",
    },
    { position: { x: 8, y: 0, z: 44 }, yaw: Math.PI, team: TEAM_IDS.NIGHTCELL, label: "Fuel Line" },
    {
      position: { x: 0, y: 0, z: 42 },
      yaw: Math.PI,
      team: TEAM_IDS.NIGHTCELL,
      label: "Muster Point",
    },

    // Directorate side (north).
    { position: { x: -20, y: 0, z: -46 }, yaw: 0, team: TEAM_IDS.DIRECTORATE, label: "Intake" },
    { position: { x: 0, y: 0, z: -50 }, yaw: 0, team: TEAM_IDS.DIRECTORATE, label: "North Gate" },
    { position: { x: 20, y: 0, z: -46 }, yaw: 0, team: TEAM_IDS.DIRECTORATE, label: "Tank Row" },
    { position: { x: -8, y: 0, z: -44 }, yaw: 0, team: TEAM_IDS.DIRECTORATE, label: "Checkpoint" },
    { position: { x: 8, y: 0, z: -44 }, yaw: 0, team: TEAM_IDS.DIRECTORATE, label: "Compressor" },
    { position: { x: 0, y: 0, z: -42 }, yaw: 0, team: TEAM_IDS.DIRECTORATE, label: "Staging" },
  ],
};

export const MAPS: Readonly<Record<string, CollisionMap>> = {
  [ARDAVAN_YARD.id]: ARDAVAN_YARD,
};

export function getMap(id: string): CollisionMap {
  const map = MAPS[id];
  if (!map) throw new Error(`unknown map: ${id}`);
  return map;
}

/**
 * Order-independent checksum of the gameplay-relevant map data.
 *
 * Participates in the join handshake (PRD §18.2) so a client running different
 * collision geometry than the server cannot enter a match. Implemented with
 * FNV-1a rather than `node:crypto` to keep this package browser-importable —
 * the client computes the same value over its own copy of the map.
 */
export function mapChecksum(map: CollisionMap): string {
  const parts: string[] = [map.id];
  for (const b of map.boxes) {
    parts.push(
      `${r(b.min.x)},${r(b.min.y)},${r(b.min.z)},${r(b.max.x)},${r(b.max.y)},${r(b.max.z)}`,
    );
  }
  for (const s of map.spawns) {
    parts.push(`${s.team}:${r(s.position.x)},${r(s.position.y)},${r(s.position.z)},${r(s.yaw)}`);
  }
  return fnv1a(parts.join("|"));
}

function r(value: number): string {
  // Quantise to millimetres so trivial float noise does not invalidate a build.
  return (Math.round(value * 1000) / 1000).toFixed(3);
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function spawnsForTeam(map: CollisionMap, team: number): readonly SpawnPoint[] {
  return map.spawns.filter((s) => s.team === team);
}
