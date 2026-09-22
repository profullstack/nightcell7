import { describe, expect, it } from "vitest";
import { MAX_HEALTH, WEAPON, getWeapon, isMultiplayerLegal } from "@nightcell7/game-core";
import { ARDAVAN_YARD, isClearOfSolids } from "@nightcell7/multiplayer-sim";
import {
  SANDBOX_HEALTH_SPAWNS,
  SANDBOX_HUMAN_INCOMING_DAMAGE,
  SANDBOX_PICKUPS,
  SANDBOX_STAMINA_CAP,
  SANDBOX_STAMINA_PER_PACK,
  SANDBOX_STARTING_STAMINA,
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

describe("sandbox stamina", () => {
  it("starts the player above a bot, grows per pack, and caps", () => {
    expect(SANDBOX_STARTING_STAMINA).toBeGreaterThan(MAX_HEALTH);
    expect(SANDBOX_STAMINA_PER_PACK).toBeGreaterThan(0);
    expect(SANDBOX_STAMINA_CAP).toBeGreaterThan(SANDBOX_STARTING_STAMINA);
    expect(SANDBOX_PICKUPS.staminaPerPack).toBe(SANDBOX_STAMINA_PER_PACK);
    expect(SANDBOX_PICKUPS.staminaCap).toBe(SANDBOX_STAMINA_CAP);
  });

  it("softens incoming damage without switching it off", () => {
    expect(SANDBOX_HUMAN_INCOMING_DAMAGE).toBeGreaterThan(0);
    expect(SANDBOX_HUMAN_INCOMING_DAMAGE).toBeLessThan(1);
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
