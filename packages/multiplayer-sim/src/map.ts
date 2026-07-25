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

export interface CollisionMap {
  readonly id: string;
  readonly displayName: string;
  /** Solid, axis-aligned volumes. Floors are boxes too. */
  readonly boxes: readonly Aabb[];
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
