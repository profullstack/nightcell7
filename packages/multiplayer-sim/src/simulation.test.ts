import { describe, expect, it } from "vitest";
import { BUTTON, type InputFrame } from "@nightcell7/multiplayer-protocol";
import { TDM_RULES, WEAPON, getWeapon } from "@nightcell7/game-core";
import {
  ARDAVAN_YARD,
  BotController,
  DT_BUDGET_PER_TICK_MS,
  MAX_BUFFERED_INPUTS,
  MAX_HORIZONTAL_SPEED,
  MatchSimulation,
  PLAYER_HALF_WIDTH,
  SPRINT_SPEED,
  TICK_MS,
  createMovementState,
  horizontalLength,
  mapChecksum,
  rayAabb,
  resolveHitscan,
  rewindTicks,
  scoreSpawns,
  stepMovement,
  type SimEvent,
} from "./index";

function frame(overrides: Partial<InputFrame> = {}): InputFrame {
  return {
    seq: 1,
    dtMs: TICK_MS,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    clientTimeMs: 0,
    ...overrides,
  };
}

/** Flat test arena — isolates movement rules from Ardavan Yard's geometry. */
const FLAT_MAP = {
  id: "test-flat",
  displayName: "Flat",
  bounds: { min: { x: -100, y: -20, z: -100 }, max: { x: 100, y: 50, z: 100 } },
  killPlaneY: -10,
  boxes: [{ min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 0, z: 100 } }],
  spawns: [
    { position: { x: -10, y: 0, z: 0 }, yaw: 0, team: 0, label: "A" },
    { position: { x: 10, y: 0, z: 0 }, yaw: Math.PI, team: 1, label: "B" },
  ],
} as const;

describe("movement", () => {
  it("settles onto the ground instead of falling through it", () => {
    let state = createMovementState({ x: 0, y: 5, z: 0 }, 0);
    for (let i = 0; i < 120; i += 1) {
      state = stepMovement(state, frame({ seq: i + 1 }), FLAT_MAP);
    }
    expect(state.position.y).toBeCloseTo(0, 1);
    expect(state.grounded).toBe(true);
  });

  it("never exceeds the sprint speed cap however the input is shaped", () => {
    let state = createMovementState({ x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 200; i += 1) {
      state = stepMovement(
        state,
        frame({ seq: i + 1, moveX: 1, moveZ: 1, buttons: BUTTON.SPRINT }),
        FLAT_MAP,
      );
    }
    const speed = horizontalLength(state.velocity);
    expect(speed).toBeLessThanOrEqual(MAX_HORIZONTAL_SPEED + 1e-6);
    // Diagonal input is normalised, so it must not beat straight-line sprint.
    expect(speed).toBeLessThanOrEqual(SPRINT_SPEED + 1e-6);
  });

  it("does not let a diagonal beat a straight line", () => {
    let straight = createMovementState({ x: 0, y: 0, z: 0 }, 0);
    let diagonal = createMovementState({ x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 90; i += 1) {
      straight = stepMovement(straight, frame({ seq: i + 1, moveZ: 1 }), FLAT_MAP);
      diagonal = stepMovement(diagonal, frame({ seq: i + 1, moveX: 1, moveZ: 1 }), FLAT_MAP);
    }
    expect(horizontalLength(diagonal.velocity)).toBeLessThanOrEqual(
      horizontalLength(straight.velocity) + 1e-6,
    );
  });

  it("stops at a wall rather than passing through it", () => {
    const walled = {
      ...FLAT_MAP,
      boxes: [...FLAT_MAP.boxes, { min: { x: 4, y: 0, z: -10 }, max: { x: 5, y: 4, z: 10 } }],
    };
    let state = createMovementState({ x: 0, y: 0, z: 0 }, Math.PI / 2); // face +x
    for (let i = 0; i < 200; i += 1) {
      state = stepMovement(state, frame({ seq: i + 1, moveZ: 1, yaw: Math.PI / 2 }), walled);
    }
    expect(state.position.x).toBeLessThan(4 - PLAYER_HALF_WIDTH + 0.05);
  });

  it("only jumps from the ground", () => {
    let state = createMovementState({ x: 0, y: 0, z: 0 }, 0);
    state = stepMovement(state, frame({ seq: 1 }), FLAT_MAP);
    expect(state.grounded).toBe(true);

    state = stepMovement(state, frame({ seq: 2, buttons: BUTTON.JUMP }), FLAT_MAP);
    const airborneY = state.position.y;
    expect(airborneY).toBeGreaterThan(0);

    // Holding jump in the air must not add more height.
    let peak = airborneY;
    for (let i = 0; i < 40; i += 1) {
      state = stepMovement(state, frame({ seq: 3 + i, buttons: BUTTON.JUMP }), FLAT_MAP);
      peak = Math.max(peak, state.position.y);
    }
    expect(peak).toBeLessThan(3);
  });

  it("walks up onto a shallow step and back down off it", () => {
    const stepped = {
      ...FLAT_MAP,
      boxes: [...FLAT_MAP.boxes, { min: { x: -10, y: 0, z: 2 }, max: { x: 10, y: 0.4, z: 4 } }],
    };
    let state = createMovementState({ x: 0, y: 0, z: 0 }, 0);

    // Walk until the player is standing on top of the platform.
    let onPlatform = false;
    for (let i = 0; i < 40 && !onPlatform; i += 1) {
      state = stepMovement(state, frame({ seq: i + 1, moveZ: 1 }), stepped);
      onPlatform = state.position.z > 2 && state.position.z < 4;
      if (onPlatform) {
        expect(state.position.y).toBeCloseTo(0.4, 2);
        expect(state.grounded).toBe(true);
      }
    }
    expect(onPlatform).toBe(true);

    // Continuing past the far edge drops back to ground level, never through it.
    for (let i = 0; i < 60; i += 1) {
      state = stepMovement(state, frame({ seq: 100 + i, moveZ: 1 }), stepped);
    }
    expect(state.position.z).toBeGreaterThan(4);
    expect(state.position.y).toBeCloseTo(0, 2);
  });

  it("does not climb a wall taller than the step height", () => {
    const walled = {
      ...FLAT_MAP,
      boxes: [...FLAT_MAP.boxes, { min: { x: -10, y: 0, z: 2 }, max: { x: 10, y: 2.5, z: 4 } }],
    };
    let state = createMovementState({ x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 90; i += 1) {
      state = stepMovement(state, frame({ seq: i + 1, moveZ: 1 }), walled);
    }
    expect(state.position.z).toBeLessThan(2);
    expect(state.position.y).toBeCloseTo(0, 2);
  });

  it("refuses to stand up under a low ceiling", () => {
    const lowCeiling = {
      ...FLAT_MAP,
      boxes: [...FLAT_MAP.boxes, { min: { x: -2, y: 1.4, z: -2 }, max: { x: 2, y: 3, z: 2 } }],
    };
    let state = createMovementState({ x: 0, y: 0, z: 0 }, 0);
    state = stepMovement(state, frame({ seq: 1, buttons: BUTTON.CROUCH }), lowCeiling);
    expect(state.crouching).toBe(true);
    state = stepMovement(state, frame({ seq: 2, buttons: 0 }), lowCeiling);
    expect(state.crouching).toBe(true);
  });
});

describe("hitscan", () => {
  it("intersects a box in front of the ray and misses one behind it", () => {
    const box = { min: { x: -1, y: -1, z: 4 }, max: { x: 1, y: 1, z: 6 } };
    expect(rayAabb({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, box, 100)?.distance).toBeCloseTo(
      4,
      5,
    );
    expect(rayAabb({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, box, 100)).toBeNull();
  });

  it("respects the max distance", () => {
    const box = { min: { x: -1, y: -1, z: 40 }, max: { x: 1, y: 1, z: 42 } };
    expect(rayAabb({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, box, 10)).toBeNull();
  });

  it("cannot shoot an enemy through world geometry", () => {
    const map = {
      ...FLAT_MAP,
      boxes: [...FLAT_MAP.boxes, { min: { x: -5, y: 0, z: 4 }, max: { x: 5, y: 4, z: 5 } }],
    };
    const hit = resolveHitscan({
      origin: { x: 0, y: 1.6, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      maxDistance: 100,
      map,
      shooterId: "a",
      shooterTeam: 0,
      candidates: [
        {
          id: "b",
          team: 1,
          snapshot: { tick: 1, position: { x: 0, y: 0, z: 10 }, crouching: false, alive: true },
        },
      ],
    });
    expect(hit).toBeNull();
  });

  it("never registers a hit on a team-mate or on the shooter", () => {
    const base = {
      origin: { x: 0, y: 1.6, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      maxDistance: 100,
      map: FLAT_MAP,
      shooterId: "a",
      shooterTeam: 0,
    };
    expect(
      resolveHitscan({
        ...base,
        candidates: [
          {
            id: "friend",
            team: 0,
            snapshot: { tick: 1, position: { x: 0, y: 0, z: 10 }, crouching: false, alive: true },
          },
        ],
      }),
    ).toBeNull();

    expect(
      resolveHitscan({
        ...base,
        candidates: [
          {
            id: "a",
            team: 1,
            snapshot: { tick: 1, position: { x: 0, y: 0, z: 10 }, crouching: false, alive: true },
          },
        ],
      }),
    ).toBeNull();
  });

  it("flags a headshot only near the top of the capsule", () => {
    const shoot = (y: number) =>
      resolveHitscan({
        origin: { x: 0, y, z: 0 },
        direction: { x: 0, y: 0, z: 1 },
        maxDistance: 100,
        map: FLAT_MAP,
        shooterId: "a",
        shooterTeam: 0,
        candidates: [
          {
            id: "b",
            team: 1,
            snapshot: { tick: 1, position: { x: 0, y: 0, z: 10 }, crouching: false, alive: true },
          },
        ],
      });

    expect(shoot(1.75)?.headshot).toBe(true);
    expect(shoot(1.0)?.headshot).toBe(false);
  });

  it("clamps lag-compensation rewind so a fake ping buys nothing", () => {
    expect(rewindTicks(0)).toBe(0);
    expect(rewindTicks(100)).toBe(3);
    // Anything past the 200 ms cap collapses to the same rewind.
    expect(rewindTicks(200)).toBe(rewindTicks(99_999));
  });
});

describe("map data", () => {
  it("produces a stable checksum and changes it when geometry moves", () => {
    const a = mapChecksum(ARDAVAN_YARD);
    expect(a).toBe(mapChecksum(ARDAVAN_YARD));

    const tampered = {
      ...ARDAVAN_YARD,
      boxes: [
        ...ARDAVAN_YARD.boxes.slice(1),
        { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      ],
    };
    expect(mapChecksum(tampered)).not.toBe(a);
  });

  it("gives both teams six spawns for a full 6v6", () => {
    expect(ARDAVAN_YARD.spawns.filter((s) => s.team === 0)).toHaveLength(TDM_RULES.teamSize);
    expect(ARDAVAN_YARD.spawns.filter((s) => s.team === 1)).toHaveLength(TDM_RULES.teamSize);
  });

  it("penalises spawns near living enemies", () => {
    const enemyNear = ARDAVAN_YARD.spawns.find((s) => s.team === 0 && s.label === "West Dock")!;
    const scored = scoreSpawns({
      map: ARDAVAN_YARD,
      team: 0,
      occupants: [{ position: enemyNear.position, team: 1, alive: true }],
      recentDeaths: [],
      nowMs: 0,
    });
    const contested = scored.find((s) => s.spawn.label === "West Dock")!;
    expect(scored[0]!.spawn.label).not.toBe("West Dock");
    expect(contested.score).toBeLessThan(scored[0]!.score);
  });
});

describe("authoritative match simulation", () => {
  function newMatch(map: typeof ARDAVAN_YARD | typeof FLAT_MAP = ARDAVAN_YARD) {
    const sim = new MatchSimulation({ matchId: "m1", map });
    // Skip warmup so tests exercise live rules.
    sim.startNow();
    return sim;
  }

  /** Put two players in open sight of each other on the flat arena. */
  function faceOff(sim: MatchSimulation, attackerId: string, victimId: string) {
    const attacker = sim.players.get(attackerId)!;
    const victim = sim.players.get(victimId)!;
    attacker.movement = createMovementState({ x: 0, y: 0, z: 0 }, 0);
    victim.movement = createMovementState({ x: 0, y: 0, z: 12 }, Math.PI);
    attacker.spawnProtectedUntilMs = 0;
    victim.spawnProtectedUntilMs = 0;
    return { attacker, victim };
  }

  it("balances teams as players join", () => {
    const sim = newMatch();
    for (let i = 0; i < 6; i += 1) {
      sim.addPlayer({ id: `p${i}`, userId: `u${i}`, displayName: `P${i}` });
    }
    const counts = sim.teamCounts();
    expect(Math.abs((counts[0] ?? 0) - (counts[1] ?? 0))).toBeLessThanOrEqual(1);
  });

  it("refuses to admit more than the room capacity", () => {
    const sim = newMatch();
    for (let i = 0; i < TDM_RULES.maxPlayers; i += 1) {
      sim.addPlayer({ id: `p${i}`, userId: `u${i}`, displayName: `P${i}` });
    }
    expect(() => sim.addPlayer({ id: "extra", userId: "ux", displayName: "X" })).toThrow(
      /room_full/,
    );
  });

  it("drops replayed and out-of-order input sequences", () => {
    const sim = newMatch();
    sim.addPlayer({ id: "a", userId: "ua", displayName: "A" });

    expect(sim.queueInput("a", [frame({ seq: 5 })])).toBe(1);
    // Same sequence again, and an older one: both rejected.
    expect(sim.queueInput("a", [frame({ seq: 5 })])).toBe(0);
    expect(sim.queueInput("a", [frame({ seq: 3 })])).toBe(0);
    expect(sim.players.get("a")!.rejectedInputs).toBe(2);
  });

  it("caps how much movement time one player can consume per tick", () => {
    const sim = newMatch();
    const player = sim.addPlayer({ id: "a", userId: "ua", displayName: "A" });
    const startZ = player.movement.position.z;

    // A speedhacking client: eight maximum-length frames every tick.
    for (let t = 0; t < 30; t += 1) {
      const frames = Array.from({ length: 8 }, (_, i) =>
        frame({ seq: t * 8 + i + 1, dtMs: 50, moveZ: 1, buttons: BUTTON.SPRINT, yaw: 0 }),
      );
      sim.queueInput("a", frames);
      sim.step();
    }

    const cheatDistance = Math.abs(player.movement.position.z - startZ);
    const elapsedSeconds = (30 * TICK_MS) / 1000;
    // Budget allows a little overshoot but nothing like 8x.
    const ceiling = SPRINT_SPEED * elapsedSeconds * (DT_BUDGET_PER_TICK_MS / TICK_MS) + 2;
    expect(cheatDistance).toBeLessThanOrEqual(ceiling);
  });

  it("bounds the pending input buffer", () => {
    const sim = newMatch();
    sim.addPlayer({ id: "a", userId: "ua", displayName: "A" });
    for (let i = 0; i < 500; i += 1) {
      sim.queueInput("a", [frame({ seq: i + 1, dtMs: 1 })]);
    }
    expect(sim.players.get("a")!.pendingInputs.length).toBeLessThanOrEqual(MAX_BUFFERED_INPUTS);
  });

  it("consumes ammunition on the server and forces a reload when empty", () => {
    const sim = newMatch();
    const player = sim.addPlayer({ id: "a", userId: "ua", displayName: "A" });
    const spec = getWeapon(WEAPON.C9_KESTREL);

    let seq = 0;
    for (let t = 0; t < 120; t += 1) {
      sim.queueInput("a", [frame({ seq: ++seq, buttons: BUTTON.FIRE })]);
      sim.step();
    }

    const ammo = player.ammo[0]!;
    expect(ammo.magazine).toBeLessThanOrEqual(spec.magazineSize);
    // The client never sends an ammo count; the server has spent rounds.
    expect(ammo.magazine + ammo.reserve).toBeLessThan(spec.magazineSize + spec.reserveAmmo);
  });

  it("enforces fire cadence regardless of how fast a client sends fire input", () => {
    const sim = newMatch();
    const shooter = sim.addPlayer({ id: "a", userId: "ua", displayName: "A", preferredTeam: 0 });
    const spec = getWeapon(WEAPON.C9_KESTREL);
    const magazineBefore = shooter.ammo[0]!.magazine;

    // One tick, many fire inputs.
    const frames = Array.from({ length: 8 }, (_, i) =>
      frame({ seq: i + 1, dtMs: 1, buttons: BUTTON.FIRE }),
    );
    sim.queueInput("a", frames);
    sim.step();

    const spent = magazineBefore - shooter.ammo[0]!.magazine;
    const maxShotsInTick = Math.ceil(TICK_MS / (60_000 / spec.rpm)) + 1;
    expect(spent).toBeLessThanOrEqual(maxShotsInTick);
  });

  it("kills, scores, and respawns entirely on the server", () => {
    const sim = newMatch(FLAT_MAP);
    const attacker = sim.addPlayer({ id: "a", userId: "ua", displayName: "A", preferredTeam: 0 });
    const victim = sim.addPlayer({ id: "b", userId: "ub", displayName: "B", preferredTeam: 1 });
    expect(attacker.team).not.toBe(victim.team);

    faceOff(sim, "a", "b");

    const events: SimEvent[] = [];
    let seq = 0;
    for (let t = 0; t < 90 && victim.alive; t += 1) {
      attacker.movement.position = { x: 0, y: 0, z: 0 };
      victim.movement.position = { x: 0, y: 0, z: 12 };
      victim.spawnProtectedUntilMs = 0;
      sim.queueInput("a", [frame({ seq: ++seq, buttons: BUTTON.FIRE, yaw: 0, pitch: 0 })]);
      events.push(...sim.step());
    }

    expect(events.some((e) => e.type === "hit")).toBe(true);
    const kill = events.find((e) => e.type === "kill");
    expect(kill).toBeDefined();
    expect(attacker.kills).toBe(1);
    expect(victim.deaths).toBe(1);
    expect(sim.scores[attacker.team]).toBe(1);

    // Respawn happens on the server clock, not on client request.
    const before = sim.elapsedMs;
    while (!victim.alive && sim.elapsedMs - before < TDM_RULES.respawnDelayMs * 2) sim.step();
    expect(victim.alive).toBe(true);
    expect(victim.health).toBe(100);
  });

  it("ignores friendly fire entirely — a team-mate cannot be damaged or scored on", () => {
    const sim = newMatch(FLAT_MAP);
    const attacker = sim.addPlayer({ id: "a", userId: "ua", displayName: "A" });
    const mate = sim.addPlayer({ id: "b", userId: "ub", displayName: "B" });
    // Auto-balance splits them, so force the same team for this scenario.
    mate.team = attacker.team;

    faceOff(sim, "a", "b");
    const healthBefore = mate.health;
    const teamScoreBefore = sim.scores[attacker.team] ?? 0;

    const events: SimEvent[] = [];
    let seq = 0;
    for (let t = 0; t < 60; t += 1) {
      attacker.movement.position = { x: 0, y: 0, z: 0 };
      mate.movement.position = { x: 0, y: 0, z: 12 };
      mate.spawnProtectedUntilMs = 0;
      sim.queueInput("a", [frame({ seq: ++seq, buttons: BUTTON.FIRE, yaw: 0, pitch: 0 })]);
      events.push(...sim.step());
    }

    expect(events.some((e) => e.type === "hit")).toBe(false);
    expect(mate.health).toBe(healthBefore);
    expect(mate.alive).toBe(true);
    expect(attacker.kills).toBe(0);
    expect(sim.scores[attacker.team]).toBe(teamScoreBefore);
  });

  it("holds a disconnected player's seat for the grace window, then releases it", () => {
    const sim = newMatch();
    sim.addPlayer({ id: "a", userId: "ua", displayName: "A" });
    sim.markDisconnected("a");

    expect(sim.expiredSeats()).toEqual([]);
    const target = sim.elapsedMs + TDM_RULES.reconnectGraceMs + TICK_MS;
    while (sim.elapsedMs < target) sim.step();
    expect(sim.expiredSeats()).toEqual(["a"]);
  });

  it("ends the match on the score limit and reports a winner", () => {
    const sim = newMatch();
    sim.addPlayer({ id: "a", userId: "ua", displayName: "A", preferredTeam: 0 });
    sim.scores[0] = TDM_RULES.scoreLimit;
    const events = sim.step();
    const end = events.find((e) => e.type === "match_end");
    expect(end).toMatchObject({ type: "match_end", reason: "score_limit", winningTeam: 0 });
    expect(sim.phase).toBe("ended");
  });

  it("stops simulating once the match has ended", () => {
    const sim = newMatch();
    sim.addPlayer({ id: "a", userId: "ua", displayName: "A", preferredTeam: 0 });
    sim.scores[0] = TDM_RULES.scoreLimit;
    sim.step();
    const tickAfterEnd = sim.tick;
    sim.step();
    expect(sim.tick).toBe(tickAfterEnd);
  });

  it("keeps a full 12-player bot match stable for a long run without growing state", () => {
    const sim = new MatchSimulation({ matchId: "soak", map: ARDAVAN_YARD });
    sim.startNow();

    const bots: BotController[] = [];
    for (let i = 0; i < TDM_RULES.maxPlayers; i += 1) {
      sim.addPlayer({ id: `bot${i}`, userId: `bot${i}`, displayName: `Bot ${i}`, isBot: true });
      bots.push(new BotController(`bot${i}`, i + 1));
    }

    for (let t = 0; t < 1200 && sim.phase === "live"; t += 1) {
      for (const bot of bots) bot.update(sim);
      sim.step();
    }

    for (const player of sim.players.values()) {
      expect(Number.isFinite(player.movement.position.x)).toBe(true);
      expect(Number.isFinite(player.movement.position.y)).toBe(true);
      expect(player.health).toBeGreaterThanOrEqual(0);
      expect(player.health).toBeLessThanOrEqual(100);
      // Buffers stay bounded across a long match (PRD §30.4).
      expect(player.pendingInputs.length).toBeLessThanOrEqual(MAX_BUFFERED_INPUTS);
      expect(player.recentDamage.size).toBeLessThanOrEqual(TDM_RULES.maxPlayers);
      // Nobody has escaped the map.
      expect(Math.abs(player.movement.position.x)).toBeLessThanOrEqual(41);
      expect(player.movement.position.y).toBeGreaterThan(ARDAVAN_YARD.killPlaneY - 1);
    }
  });
});
