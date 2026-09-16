import { describe, expect, it } from "vitest";
import { GroundNavigator } from "./navigation";
import { ARDAVAN_YARD, type CollisionMap } from "./map";
import { MatchSimulation } from "./simulation";
import { BotController } from "./bots";
import { TICK_MS } from "./constants";

const map: CollisionMap = {
  id: "route-test",
  displayName: "Route test",
  killPlaneY: -5,
  bounds: { min: { x: -20, y: -5, z: -20 }, max: { x: 20, y: 10, z: 20 } },
  boxes: [
    { min: { x: -20, y: -1, z: -20 }, max: { x: 20, y: 0, z: 20 } },
    { min: { x: -2, y: 0, z: -1 }, max: { x: 2, y: 3, z: 1 } },
  ],
  spawns: [
    { position: { x: 0, y: 0, z: -9 }, yaw: 0, team: 0, label: "south" },
    { position: { x: 0, y: 0, z: 9 }, yaw: Math.PI, team: 1, label: "north" },
  ],
};

describe("bot cover navigation", () => {
  it("routes around a solid wall with clearance on every segment", () => {
    const nav = new GroundNavigator(map);
    const start = { x: 0, y: 0, z: -9 },
      goal = { x: 0, y: 0, z: 9 };
    expect(nav.clear(start, goal)).toBe(false);
    const route = nav.path(start, goal);
    expect(route.length).toBeGreaterThan(1);
    let previous = start;
    for (const next of route) {
      expect(nav.clear(previous, next)).toBe(true);
      previous = next;
    }
    expect(route.at(-1)).toEqual(goal);
  });

  it("moves into a firing lane without spending ammunition on the wall", () => {
    const sim = new MatchSimulation({ matchId: "route", map });
    const bot = sim.addPlayer({
      id: "bot",
      userId: "bot",
      displayName: "Bot",
      isBot: true,
      preferredTeam: 0,
    });
    sim.addPlayer({ id: "human", userId: "human", displayName: "Human", preferredTeam: 1 });
    sim.startNow();
    const controller = new BotController("bot", 7);
    for (let i = 0; i < 15; i++) {
      controller.update(sim);
      sim.step();
    }
    expect(bot.ammo[0]!.magazine).toBe(30);
    let hits = 0,
      widest = 0;
    for (let i = 0; i < 900; i++) {
      controller.update(sim);
      hits += sim.step().filter((e) => e.type === "hit").length;
      widest = Math.max(widest, Math.abs(bot.movement.position.x));
    }
    expect(widest).toBeGreaterThan(2);
    expect(hits).toBeGreaterThan(0);
    expect(sim.elapsedMs).toBeCloseTo(915 * TICK_MS, 4);
  });

  it("finds traversable approaches from both real spawn zones", () => {
    const nav = new GroundNavigator(ARDAVAN_YARD);
    for (const spawn of ARDAVAN_YARD.spawns) {
      const path = nav.path(spawn.position, { x: 0, y: 0, z: spawn.team === 0 ? -10 : 10 });
      expect(path.length, spawn.label).toBeGreaterThan(0);
    }
  });
});
