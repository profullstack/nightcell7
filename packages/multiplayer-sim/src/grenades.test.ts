import { describe, expect, it } from "vitest";
import { GRENADE_SPEC, grenadeDamageAt } from "@nightcell7/game-core";
import {
  MatchSimulation,
  TICK_MS,
  resolveBlast,
  stepGrenade,
  type BlastCandidate,
  type CollisionMap,
  type SimEvent,
  type SimGrenade,
} from "./index";

/**
 * Grenades are the only thing in the simulation that persists across ticks
 * without an owner driving it, and the only damage source that ignores where
 * the attacker is looking. Both make them easy to get subtly wrong in ways a
 * match would not surface: a grenade that tunnels through a floor lands under
 * the map, and a blast that ignores cover quietly deletes the value of the
 * three lanes.
 */

/** Flat ground plus one tall wall at x = 0, to test cover explicitly. */
const WALLED_MAP: CollisionMap = {
  id: "test-walled",
  displayName: "Walled",
  bounds: { min: { x: -100, y: -20, z: -100 }, max: { x: 100, y: 50, z: 100 } },
  killPlaneY: -10,
  boxes: [
    { min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 0, z: 100 } },
    { min: { x: -0.5, y: 0, z: -20 }, max: { x: 0.5, y: 8, z: 20 } },
  ],
  spawns: [
    { position: { x: -10, y: 0, z: 0 }, yaw: 0, team: 0, label: "A" },
    { position: { x: 10, y: 0, z: 0 }, yaw: Math.PI, team: 1, label: "B" },
  ],
};

const FLAT_MAP: CollisionMap = {
  ...WALLED_MAP,
  id: "test-flat",
  boxes: [{ min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 0, z: 100 } }],
};

function grenade(overrides: Partial<SimGrenade> = {}): SimGrenade {
  return {
    id: "g1",
    ownerId: "a",
    ownerTeam: 0,
    position: { x: 0, y: 5, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    fuseRemainingMs: GRENADE_SPEC.fuseMs,
    bounces: 0,
    resting: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<BlastCandidate> = {}): BlastCandidate {
  return { id: "b", team: 1, center: { x: 0, y: 1, z: 0 }, alive: true, ...overrides };
}

describe("grenade damage curve", () => {
  it("is full inside the inner radius and zero outside the outer", () => {
    expect(grenadeDamageAt(0)).toBe(GRENADE_SPEC.maxDamage);
    expect(grenadeDamageAt(GRENADE_SPEC.innerRadiusM)).toBe(GRENADE_SPEC.maxDamage);
    expect(grenadeDamageAt(GRENADE_SPEC.outerRadiusM)).toBe(0);
    expect(grenadeDamageAt(999)).toBe(0);
  });

  it("falls off monotonically between them", () => {
    let previous = Infinity;
    for (let d = GRENADE_SPEC.innerRadiusM; d <= GRENADE_SPEC.outerRadiusM; d += 0.25) {
      const damage = grenadeDamageAt(d);
      expect(damage).toBeLessThanOrEqual(previous);
      previous = damage;
    }
  });

  it("treats nonsense distances as out of range rather than throwing", () => {
    expect(grenadeDamageAt(Number.NaN)).toBe(0);
    expect(grenadeDamageAt(-1)).toBe(0);
  });
});

describe("grenade flight", () => {
  it("settles on the ground instead of falling through it", () => {
    const g = grenade({ position: { x: 0, y: 6, z: 0 } });
    for (let i = 0; i < 200; i += 1) stepGrenade(g, TICK_MS, FLAT_MAP);

    expect(g.position.y).toBeGreaterThan(-0.2);
    expect(g.resting).toBe(true);
  });

  it("does not tunnel through a floor at full throw speed", () => {
    // The reason the step is substepped: at 15 m/s a 33 ms tick moves half a
    // metre, which clears a thin plate in a single step.
    const g = grenade({
      position: { x: 0, y: 3, z: 0 },
      velocity: { x: 0, y: -40, z: 0 },
    });
    for (let i = 0; i < 60; i += 1) stepGrenade(g, TICK_MS, FLAT_MAP);

    expect(g.position.y).toBeGreaterThan(-0.2);
  });

  it("bounces off a wall rather than passing through it", () => {
    const g = grenade({
      position: { x: -3, y: 2, z: 0 },
      velocity: { x: 18, y: 0, z: 0 },
    });
    for (let i = 0; i < 30; i += 1) stepGrenade(g, TICK_MS, WALLED_MAP);

    // Never crossed to the far side of the wall at x = 0.
    expect(g.position.x).toBeLessThan(0);
    expect(g.bounces).toBeGreaterThan(0);
  });

  it("burns its fuse even after coming to rest", () => {
    const g = grenade({ position: { x: 0, y: 0.2, z: 0 } });
    for (let i = 0; i < 200; i += 1) stepGrenade(g, TICK_MS, FLAT_MAP);
    expect(g.fuseRemainingMs).toBeLessThan(0);
  });
});

describe("blast resolution", () => {
  it("damages an enemy in range", () => {
    const victims = resolveBlast({ x: 0, y: 1, z: 0 }, "a", 0, [candidate()], FLAT_MAP);
    expect(victims).toHaveLength(1);
    expect(victims[0]?.damage).toBeGreaterThan(0);
  });

  it("never damages a teammate", () => {
    const victims = resolveBlast(
      { x: 0, y: 1, z: 0 },
      "a",
      0,
      [candidate({ id: "mate", team: 0 })],
      FLAT_MAP,
    );
    expect(victims).toHaveLength(0);
  });

  it("damages the thrower, but less than an enemy at the same distance", () => {
    const centre = { x: 0, y: 1, z: 0 };
    const at = { x: 2, y: 1, z: 0 };

    const [enemy] = resolveBlast(centre, "a", 0, [candidate({ center: at })], FLAT_MAP);
    const [self] = resolveBlast(
      centre,
      "a",
      0,
      [candidate({ id: "a", team: 0, center: at })],
      FLAT_MAP,
    );

    expect(self?.damage).toBeGreaterThan(0);
    expect(self?.damage).toBeLessThan(enemy?.damage ?? 0);
  });

  it("is blocked by cover", () => {
    // Blast on one side of the wall, victim on the other, well inside range.
    const victims = resolveBlast(
      { x: -1.5, y: 1, z: 0 },
      "a",
      0,
      [candidate({ center: { x: 1.5, y: 1, z: 0 } })],
      WALLED_MAP,
    );
    expect(victims).toHaveLength(0);
  });

  it("still damages through the same gap when the wall is not there", () => {
    // The control for the cover test: identical geometry apart from the wall.
    const victims = resolveBlast(
      { x: -1.5, y: 1, z: 0 },
      "a",
      0,
      [candidate({ center: { x: 1.5, y: 1, z: 0 } })],
      FLAT_MAP,
    );
    expect(victims).toHaveLength(1);
  });

  it("ignores the dead", () => {
    const victims = resolveBlast(
      { x: 0, y: 1, z: 0 },
      "a",
      0,
      [candidate({ alive: false })],
      FLAT_MAP,
    );
    expect(victims).toHaveLength(0);
  });

  it("still resolves when the grenade is resting against a wall", () => {
    // The blast centre ends up a few centimetres inside the geometry, which a
    // naive line-of-sight trace reads as "everything is behind cover".
    const victims = resolveBlast(
      { x: -0.55, y: 1, z: 0 },
      "a",
      0,
      [candidate({ center: { x: -2.5, y: 1, z: 0 } })],
      WALLED_MAP,
    );
    expect(victims).toHaveLength(1);
  });
});

describe("throwing in a match", () => {
  function match(): MatchSimulation {
    const sim = new MatchSimulation({ matchId: "m", map: FLAT_MAP });
    sim.addPlayer({ id: "a", userId: "a", displayName: "A", preferredTeam: 0 });
    sim.addPlayer({ id: "b", userId: "b", displayName: "B", preferredTeam: 1 });
    sim.startNow();
    sim.step();
    return sim;
  }

  it("spends a grenade and puts one in flight", () => {
    const sim = match();
    const before = sim.players.get("a")?.grenades ?? 0;

    expect(sim.throwGrenade("a")).not.toBeNull();
    expect(sim.players.get("a")?.grenades).toBe(before - 1);
    expect(sim.grenades.size).toBe(1);
  });

  it("enforces the cooldown rather than trusting the client to wait", () => {
    const sim = match();
    expect(sim.throwGrenade("a")).not.toBeNull();
    // Same instant: a client spamming the message must not empty its pouch.
    expect(sim.throwGrenade("a")).toBeNull();
    expect(sim.grenades.size).toBe(1);
  });

  it("runs out after the carried count", () => {
    const sim = match();
    let thrown = 0;
    for (let i = 0; i < 200; i += 1) {
      if (sim.throwGrenade("a")) thrown += 1;
      sim.step();
    }
    expect(thrown).toBe(GRENADE_SPEC.carried);
    expect(sim.players.get("a")?.grenades).toBe(0);
  });

  it("refuses a throw from a dead player", () => {
    const sim = match();
    const player = sim.players.get("a");
    if (player) player.alive = false;
    expect(sim.throwGrenade("a")).toBeNull();
  });

  it("detonates on its fuse and reports the blast", () => {
    const sim = match();
    sim.throwGrenade("a");

    const events: SimEvent[] = [];
    const ticks = Math.ceil(GRENADE_SPEC.fuseMs / TICK_MS) + 5;
    for (let i = 0; i < ticks; i += 1) events.push(...sim.step());

    expect(events.some((e) => e.type === "grenade_exploded")).toBe(true);
    expect(sim.grenades.size).toBe(0);
  });

  it("throws forward and lands on the ground, not at the thrower's feet", () => {
    const sim = match();
    const attacker = sim.players.get("a");
    if (!attacker) throw new Error("roster");
    attacker.movement.position = { x: 0, y: 0, z: 0 };
    attacker.movement.yaw = 0;
    attacker.movement.pitch = 0;

    const thrown = sim.throwGrenade("a");
    if (!thrown) throw new Error("throw refused");

    // Most of the fuse, but stop short of detonation so it is still readable.
    for (let i = 0; i < Math.floor(GRENADE_SPEC.fuseMs / TICK_MS) - 2; i += 1) sim.step();

    const inFlight = sim.grenades.get(thrown.id);
    expect(inFlight, "grenade detonated earlier than its fuse").toBeDefined();
    // Well clear of the thrower, and resting on the floor rather than under it.
    expect(Math.hypot(inFlight?.position.x ?? 0, inFlight?.position.z ?? 0)).toBeGreaterThan(5);
    expect(inFlight?.position.y ?? -99).toBeGreaterThan(-0.2);
  });

  it("kills an enemy standing where it lands", () => {
    const sim = match();
    const attacker = sim.players.get("a");
    const victim = sim.players.get("b");
    if (!attacker || !victim) throw new Error("roster");
    attacker.spawnProtectedUntilMs = 0;
    victim.spawnProtectedUntilMs = 0;

    const thrown = sim.throwGrenade("a");
    if (!thrown) throw new Error("throw refused");

    const events: SimEvent[] = [];
    const total = Math.ceil(GRENADE_SPEC.fuseMs / TICK_MS) + 5;
    for (let i = 0; i < total; i += 1) {
      // Keep the victim on top of the grenade right up to detonation, so this
      // tests the blast-to-kill path rather than the ballistics above.
      const live = sim.grenades.get(thrown.id);
      if (live) {
        victim.movement.position = { x: live.position.x, y: 0, z: live.position.z };
        victim.spawnProtectedUntilMs = 0;
      }
      events.push(...sim.step());
    }

    expect(events.some((e) => e.type === "grenade_exploded")).toBe(true);
    expect(events.some((e) => e.type === "kill" && e.victimId === "b")).toBe(true);
  });

  it("gives grenades back on respawn, not during a life", () => {
    const sim = match();
    sim.throwGrenade("a");
    const spent = sim.players.get("a")?.grenades ?? 0;
    expect(spent).toBe(GRENADE_SPEC.carried - 1);

    // A long time passes; the pouch must not refill on its own.
    for (let i = 0; i < 300; i += 1) sim.step();
    expect(sim.players.get("a")?.grenades).toBe(spent);

    const player = sim.players.get("a");
    if (player) {
      player.alive = false;
      player.respawnAtMs = sim.elapsedMs;
    }
    for (let i = 0; i < 5; i += 1) sim.step();
    expect(sim.players.get("a")?.grenades).toBe(GRENADE_SPEC.carried);
  });
});
