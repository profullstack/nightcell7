import { describe, expect, it } from "vitest";
import { WEAPON, getWeapon, isMultiplayerLegal } from "@nightcell7/game-core";
import { ARDAVAN_YARD, isClearOfSolids } from "@nightcell7/multiplayer-sim";
import {
  SANDBOX_HEALTH_SPAWNS,
  WEAPON_VIEWMODEL,
  WEAPON_WORLD_MODEL,
  botLoadout,
} from "./sandbox-rules";

describe("sandbox health pack spawns", () => {
  it("are all clear of Ardavan Yard's solids, so none is visible but unreachable", () => {
    const blocked = SANDBOX_HEALTH_SPAWNS.filter((point) => !isClearOfSolids(ARDAVAN_YARD, point));
    expect(blocked).toEqual([]);
  });

  it("are inside the map and on the ground", () => {
    for (const point of SANDBOX_HEALTH_SPAWNS) {
      expect(point.x).toBeGreaterThan(ARDAVAN_YARD.bounds.min.x);
      expect(point.x).toBeLessThan(ARDAVAN_YARD.bounds.max.x);
      expect(point.z).toBeGreaterThan(ARDAVAN_YARD.bounds.min.z);
      expect(point.z).toBeLessThan(ARDAVAN_YARD.bounds.max.z);
      expect(point.y).toBe(0);
    }
  });

  it("sit away from both teams' spawn pads, so a pack is never a free heal at home", () => {
    for (const point of SANDBOX_HEALTH_SPAWNS) {
      for (const spawn of ARDAVAN_YARD.spawns) {
        const d = Math.hypot(point.x - spawn.position.x, point.z - spawn.position.z);
        expect(d).toBeGreaterThan(12);
      }
    }
  });
});

describe("bot loadouts", () => {
  it("are multiplayer-legal and give the Directorate something worth dropping", () => {
    const enemies = [0, 1, 2, 3].map((i) => botLoadout(true, i));
    for (const loadout of [...enemies, botLoadout(false, 0)]) {
      expect(loadout.length).toBeGreaterThan(0);
      for (const id of loadout) expect(isMultiplayerLegal(id)).toBe(true);
    }
    expect(enemies.some((loadout) => loadout.includes(WEAPON.B4_BREACHER))).toBe(true);
  });

  it("have a mesh for every weapon a fighter can carry or drop", () => {
    for (const id of Object.values(WEAPON)) {
      expect(WEAPON_WORLD_MODEL[id]).toMatch(/^m3_/);
      const view = WEAPON_VIEWMODEL[id];
      expect(view.model.length).toBeGreaterThan(0);
      expect(view.scale !== undefined || view.fitLengthM !== undefined).toBe(true);
      expect(getWeapon(id).displayName.length).toBeGreaterThan(0);
    }
  });
});
