import { describe, expect, it } from "vitest";
import { BUTTON, type InputFrame } from "@nightcell7/multiplayer-protocol";
import { REGEN_CEILING, REGEN_DELAY_MS, WEAPON, getWeapon } from "@nightcell7/game-core";
import {
  DEFAULT_PICKUP_RULES,
  MatchSimulation,
  PICKUP_KIND,
  TICK_MS,
  applyPickup,
  isClearOfSolids,
  withinPickupReach,
  type SimEvent,
  type SimPickup,
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

const FLAT_MAP = {
  id: "test-flat",
  displayName: "Flat",
  bounds: { min: { x: -100, y: -20, z: -100 }, max: { x: 100, y: 50, z: 100 } },
  killPlaneY: -10,
  boxes: [
    { min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 0, z: 100 } },
    // A pillar, to test spawn filtering.
    { min: { x: 30, y: 0, z: 30 }, max: { x: 32, y: 3, z: 32 } },
  ],
  spawns: [
    { position: { x: -10, y: 0, z: 0 }, yaw: 0, team: 0, label: "A" },
    { position: { x: 10, y: 0, z: 0 }, yaw: Math.PI, team: 1, label: "B" },
  ],
} as const;

/** Yaw that aims from the team-0 spawn at the team-1 spawn (+X). */
const AIM_PLUS_X = Math.PI / 2;

function sandbox(pickups = true): MatchSimulation {
  const sim = new MatchSimulation({
    matchId: "t",
    map: FLAT_MAP,
    pickups: pickups
      ? {
          healthSpawns: [{ x: 0, y: 0, z: 20 }],
          healthFirstSpawnMs: 3_000,
          healthRespawnMs: 2_000,
          dropExpiresMs: 3_000,
        }
      : undefined,
  });
  sim.addPlayer({ id: "me", userId: "me", displayName: "Me", preferredTeam: 0 });
  sim.addPlayer({
    id: "bot",
    userId: "bot",
    displayName: "Bot",
    isBot: true,
    preferredTeam: 1,
    loadout: [WEAPON.B4_BREACHER, WEAPON.P11],
  });
  sim.startNow();
  // Past spawn protection, so the first shot counts.
  stepFor(sim, 1_600);
  return sim;
}

function stepFor(sim: MatchSimulation, ms: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ms; t += TICK_MS) events.push(...sim.step());
  return events;
}

/** Fire from the human at the bot until the bot is dead. */
function killBot(sim: MatchSimulation): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < 200 && sim.players.get("bot")?.alive; i += 1) {
    sim.applyWeaponIntent("me", frame({ seq: i + 1, yaw: AIM_PLUS_X, buttons: BUTTON.FIRE }));
    events.push(...sim.step());
  }
  return events;
}

describe("applyWeaponIntent", () => {
  it("fires a round through the magazine and reports it as a shot", () => {
    const sim = sandbox(false);
    const me = sim.players.get("me")!;
    const magazine = me.ammo[0]!.magazine;

    sim.applyWeaponIntent("me", frame({ yaw: AIM_PLUS_X, buttons: BUTTON.FIRE }));
    const events = sim.step();

    expect(me.ammo[0]!.magazine).toBe(magazine - 1);
    const shot = events.find((e) => e.type === "shot");
    expect(shot).toBeDefined();
    if (shot?.type !== "shot") throw new Error("no shot");
    expect(shot.playerId).toBe("me");
    expect(shot.weaponId).toBe(me.weapons[0]);
    expect(shot.origin.y).toBeGreaterThan(1);
  });

  it("holds the trigger to the weapon's cadence", () => {
    const sim = sandbox(false);
    const me = sim.players.get("me")!;
    const spec = getWeapon(me.weapons[0]!);
    const magazine = me.ammo[0]!.magazine;

    // One second of held trigger, applied once per tick.
    for (let i = 0; i < 30; i += 1) {
      sim.applyWeaponIntent("me", frame({ seq: i + 1, yaw: AIM_PLUS_X, buttons: BUTTON.FIRE }));
      sim.step();
    }
    const fired = magazine - me.ammo[0]!.magazine;
    const expected = 1000 / (60_000 / spec.rpm);
    expect(fired).toBeGreaterThan(expected * 0.7);
    expect(fired).toBeLessThanOrEqual(Math.ceil(expected) + 1);
  });

  it("keeps a held trigger firing across ticks until the next frame replaces it", () => {
    const sim = sandbox(false);
    const me = sim.players.get("me")!;
    const magazine = me.ammo[0]!.magazine;

    // One frame's intent, then a long stretch of ticks with no new frame —
    // a client rendering far slower than the simulation ticks.
    sim.applyWeaponIntent("me", frame({ yaw: AIM_PLUS_X, buttons: BUTTON.FIRE }));
    stepFor(sim, 1_000);
    const fired = magazine - me.ammo[0]!.magazine;
    expect(fired).toBeGreaterThan(5);

    // Releasing stops it on the very next tick.
    sim.applyWeaponIntent("me", frame({ yaw: AIM_PLUS_X, buttons: 0 }));
    const after = me.ammo[0]!.magazine;
    stepFor(sim, 1_000);
    expect(me.ammo[0]!.magazine).toBe(after);
  });

  it("does not let a released trigger echo back through the merge", () => {
    const sim = sandbox(false);
    const me = sim.players.get("me")!;
    sim.applyWeaponIntent("me", frame({ yaw: AIM_PLUS_X, buttons: BUTTON.FIRE }));
    sim.step();
    // Released. The consumed fire bit must not be carried into this frame.
    sim.applyWeaponIntent("me", frame({ seq: 2, yaw: AIM_PLUS_X, buttons: 0 }));
    const after = me.ammo[0]!.magazine;
    stepFor(sim, 500);
    expect(me.ammo[0]!.magazine).toBe(after);
  });

  it("lands on a fighter in the line of fire and says so", () => {
    const sim = sandbox(false);
    sim.applyWeaponIntent("me", frame({ yaw: AIM_PLUS_X, buttons: BUTTON.FIRE }));
    const events = sim.step();
    const shot = events.find((e) => e.type === "shot");
    if (shot?.type !== "shot") throw new Error("no shot");
    expect(shot.victimId).toBe("bot");
    expect(shot.distance).toBeCloseTo(20, 0);
    expect(events.some((e) => e.type === "hit" && e.victimId === "bot")).toBe(true);
  });

  it("does nothing for a dead fighter", () => {
    const sim = sandbox(false);
    const me = sim.players.get("me")!;
    me.alive = false;
    sim.applyWeaponIntent("me", frame({ yaw: AIM_PLUS_X, buttons: BUTTON.FIRE }));
    expect(sim.step().some((e) => e.type === "shot")).toBe(false);
  });
});

describe("regeneration", () => {
  it("climbs back to the ceiling after a pause, and no further", () => {
    const sim = sandbox(false);
    const me = sim.players.get("me")!;
    me.health = 10;
    me.lastDamagedAtMs = sim.elapsedMs;

    stepFor(sim, REGEN_DELAY_MS - TICK_MS * 2);
    expect(me.health).toBe(10);

    stepFor(sim, 10_000);
    expect(me.health).toBe(REGEN_CEILING);
  });

  it("does not touch a fighter already above the ceiling", () => {
    const sim = sandbox(false);
    const me = sim.players.get("me")!;
    me.health = 70;
    stepFor(sim, 10_000);
    expect(me.health).toBe(70);
  });
});

describe("health packs", () => {
  it("appear on schedule, heal the hurt, and come back after being taken", () => {
    const sim = sandbox();
    const me = sim.players.get("me")!;

    expect(sim.pickups.size).toBe(0);
    const spawned = stepFor(sim, 1_500);
    expect(spawned.some((e) => e.type === "pickup_spawned" && e.kind === "health")).toBe(true);
    expect(sim.pickups.size).toBe(1);

    // Standing on it at full health leaves it for someone who needs it.
    me.movement.position = { x: 0, y: 0, z: 20 };
    stepFor(sim, 100);
    expect(sim.pickups.size).toBe(1);

    me.health = 30;
    me.lastDamagedAtMs = sim.elapsedMs; // hold regeneration off so the numbers are exact
    const taken = stepFor(sim, 100);
    const event = taken.find((e) => e.type === "pickup_taken");
    if (event?.type !== "pickup_taken") throw new Error("not taken");
    expect(event.playerId).toBe("me");
    expect(event.healed).toBe(50);
    expect(me.health).toBe(80);
    expect(sim.pickups.size).toBe(0);

    // Not straight away, but it does come back — once the player who would
    // take it again has walked off.
    me.movement.position = { x: 0, y: 0, z: 0 };
    stepFor(sim, 1_000);
    expect(sim.pickups.size).toBe(0);
    stepFor(sim, 1_200);
    expect(sim.pickups.size).toBe(1);
  });

  it("never heals past full", () => {
    const rules = { ...DEFAULT_PICKUP_RULES, healAmount: 50 };
    const pack: SimPickup = {
      id: "p",
      kind: PICKUP_KIND.HEALTH,
      position: { x: 0, y: 0, z: 0 },
      heal: 50,
      weaponId: null,
      magazine: 0,
      reserve: 0,
      expiresAtMs: null,
      spawnIndex: null,
    };
    const taker = { health: 80, maxHealth: 100, weapons: [], ammo: [] };
    expect(applyPickup(taker, pack, rules)).toEqual({
      kind: "health",
      healed: 20,
      staminaGained: 0,
      stamina: 100,
    });
    expect(taker.health).toBe(100);
  });

  it("builds stamina with every pack, up to the cap, and heals into the new room", () => {
    const rules = { ...DEFAULT_PICKUP_RULES, healAmount: 50, staminaPerPack: 25, staminaCap: 175 };
    const pack: SimPickup = {
      id: "p",
      kind: PICKUP_KIND.HEALTH,
      position: { x: 0, y: 0, z: 0 },
      heal: 50,
      weaponId: null,
      magazine: 0,
      reserve: 0,
      expiresAtMs: null,
      spawnIndex: null,
    };
    // Full health is still worth a pack while there is stamina to gain.
    const taker = { health: 150, maxHealth: 150, weapons: [], ammo: [] };
    expect(applyPickup(taker, pack, rules)).toEqual({
      kind: "health",
      healed: 25,
      staminaGained: 25,
      stamina: 175,
    });
    expect(taker.health).toBe(175);
    // At the cap and full, the pack stays on the ground.
    expect(applyPickup(taker, pack, rules)).toBeNull();
    // At the cap but hurt, it heals.
    taker.health = 100;
    expect(applyPickup(taker, pack, rules)).toEqual({
      kind: "health",
      healed: 50,
      staminaGained: 0,
      stamina: 175,
    });
  });

  it("keeps stamina across a redeploy and scales damage for humans only", () => {
    const sim = new MatchSimulation({
      matchId: "t",
      map: FLAT_MAP,
      pickups: { healthSpawns: [], staminaPerPack: 25, staminaCap: 300 },
      humanIncomingDamage: 0.5,
    });
    const me = sim.addPlayer({
      id: "me",
      userId: "me",
      displayName: "Me",
      preferredTeam: 0,
      maxHealth: 150,
    });
    const bot = sim.addPlayer({
      id: "bot",
      userId: "bot",
      displayName: "Bot",
      isBot: true,
      preferredTeam: 1,
    });
    sim.startNow();
    stepFor(sim, 1_600);
    expect(me.health).toBe(150);
    expect(bot.health).toBe(100);

    // The bot shoots me: half damage. I shoot the bot: full damage.
    me.armor = 0;
    bot.armor = 0;
    sim.applyWeaponIntent("bot", frame({ yaw: -AIM_PLUS_X, buttons: BUTTON.FIRE }));
    sim.applyWeaponIntent("me", frame({ yaw: AIM_PLUS_X, buttons: BUTTON.FIRE }));
    const events = sim.step();
    const hits = events.filter((e) => e.type === "hit");
    const onMe = hits.find((e) => e.type === "hit" && e.victimId === "me");
    const onBot = hits.find((e) => e.type === "hit" && e.victimId === "bot");
    if (onMe?.type !== "hit" || onBot?.type !== "hit") throw new Error("both should hit");
    expect(onMe.damage).toBeCloseTo(onBot.damage * 0.5, 5);
    expect(150 - me.health).toBeCloseTo(onMe.damage, 5);

    // Build stamina, die, come back with it.
    me.maxHealth = 200;
    me.health = 1;
    me.alive = false;
    me.respawnAtMs = sim.elapsedMs + TICK_MS;
    stepFor(sim, 100);
    expect(me.alive).toBe(true);
    expect(me.maxHealth).toBe(200);
    expect(me.health).toBe(200);
  });
});

describe("weapon drops", () => {
  it("leaves the dead fighter's weapons on the ground, and a human collects them", () => {
    const sim = sandbox();
    const me = sim.players.get("me")!;
    const bot = sim.players.get("bot")!;
    const where = { ...bot.movement.position };

    const events = killBot(sim);
    expect(bot.alive).toBe(false);
    const drops = events.filter((e) => e.type === "pickup_spawned" && e.kind === "weapon");
    // The Breacher it was holding, and only that.
    expect(drops).toHaveLength(1);
    if (drops[0]?.type !== "pickup_spawned") throw new Error("no drop");
    expect(drops[0].weaponId).toBe(WEAPON.B4_BREACHER);

    me.movement.position = where;
    const taken = stepFor(sim, 100).filter(
      (e) => e.type === "pickup_taken" && e.kind === PICKUP_KIND.WEAPON,
    );
    expect(taken).toHaveLength(1);

    // The shotgun is new: a third slot, with the rounds it came with.
    expect(me.weapons).toContain(WEAPON.B4_BREACHER);
    expect(me.weapons).toHaveLength(3);
    expect(me.ammo[2]!.magazine + me.ammo[2]!.reserve).toBeGreaterThan(0);
    expect([...sim.pickups.values()].some((p) => p.kind === PICKUP_KIND.WEAPON)).toBe(false);
  });

  it("folds a weapon already carried into reserve ammunition", () => {
    const p11 = getWeapon(WEAPON.P11);
    const drop: SimPickup = {
      id: "d",
      kind: PICKUP_KIND.WEAPON,
      position: { x: 0, y: 0, z: 0 },
      heal: 0,
      weaponId: WEAPON.P11,
      magazine: 10,
      reserve: 20,
      expiresAtMs: null,
      spawnIndex: null,
    };
    const taker = {
      health: 100,
      maxHealth: 100,
      weapons: [WEAPON.C9_KESTREL, WEAPON.P11],
      ammo: [
        { magazine: 30, reserve: 150 },
        { magazine: 15, reserve: p11.reserveAmmo },
      ],
    };
    expect(applyPickup(taker, drop, DEFAULT_PICKUP_RULES)).toEqual({
      kind: "weapon",
      weaponId: WEAPON.P11,
      slot: 1,
      added: false,
      ammoAdded: 30,
    });
    expect(taker.weapons).toHaveLength(2);
    expect(taker.ammo[1]!.reserve).toBe(p11.reserveAmmo + 30);
  });

  it("refuses ammunition past the reserve cap and a fourth weapon", () => {
    const rules = { ...DEFAULT_PICKUP_RULES, maxWeapons: 2 };
    const p11 = getWeapon(WEAPON.P11);
    const drop: SimPickup = {
      id: "d",
      kind: PICKUP_KIND.WEAPON,
      position: { x: 0, y: 0, z: 0 },
      heal: 0,
      weaponId: WEAPON.P11,
      magazine: 15,
      reserve: 60,
      expiresAtMs: null,
      spawnIndex: null,
    };
    const full = {
      health: 100,
      maxHealth: 100,
      weapons: [WEAPON.P11],
      ammo: [{ magazine: 15, reserve: p11.reserveAmmo * rules.reserveCapMultiplier }],
    };
    expect(applyPickup(full, drop, rules)).toBeNull();

    const hands = {
      health: 100,
      maxHealth: 100,
      weapons: [WEAPON.C9_KESTREL, WEAPON.B4_BREACHER],
      ammo: [
        { magazine: 1, reserve: 1 },
        { magazine: 1, reserve: 1 },
      ],
    };
    expect(applyPickup(hands, drop, rules)).toBeNull();
    expect(hands.weapons).toHaveLength(2);
  });

  it("sweeps up a drop nobody took", () => {
    const sim = sandbox();
    killBot(sim);
    const weapons = () =>
      [...sim.pickups.values()].filter((p) => p.kind === PICKUP_KIND.WEAPON).length;
    expect(weapons()).toBe(1);
    const events = stepFor(sim, 3_100);
    expect(events.filter((e) => e.type === "pickup_removed")).toHaveLength(1);
    expect(weapons()).toBe(0);
  });

  it("bots take health but leave weapons alone", () => {
    const sim = sandbox();
    const bot = sim.players.get("bot")!;
    killBot(sim);
    const drop = [...sim.pickups.values()].find((p) => p.kind === PICKUP_KIND.WEAPON);
    if (!drop) throw new Error("no drop");
    // Bring the bot back early, before its drop is swept, and stand it there.
    bot.respawnAtMs = sim.elapsedMs + TICK_MS;
    stepFor(sim, 100);
    expect(bot.alive).toBe(true);
    bot.movement.position = { ...drop.position };
    stepFor(sim, 100);
    expect(sim.pickups.has(drop.id)).toBe(true);
  });
});

describe("placement", () => {
  it("is in reach on the same level only", () => {
    const at = { x: 0, y: 0, z: 0 };
    expect(withinPickupReach({ x: 0.8, y: 0, z: 0 }, false, at, 1.1)).toBe(true);
    expect(withinPickupReach({ x: 1.5, y: 0, z: 0 }, false, at, 1.1)).toBe(false);
    // A pack on a catwalk is not taken from the ground beneath it.
    expect(withinPickupReach({ x: 0, y: 0, z: 0 }, false, { x: 0, y: 6, z: 0 }, 1.1)).toBe(false);
  });

  it("drops a health spawn placed inside a solid", () => {
    expect(isClearOfSolids(FLAT_MAP, { x: 31, y: 0, z: 31 })).toBe(false);
    expect(isClearOfSolids(FLAT_MAP, { x: 0, y: 0, z: 0 })).toBe(true);

    const sim = new MatchSimulation({
      matchId: "t",
      map: FLAT_MAP,
      pickups: { healthSpawns: [{ x: 31, y: 0, z: 31 }], healthFirstSpawnMs: 0 },
    });
    sim.startNow();
    stepFor(sim, 200);
    expect(sim.pickups.size).toBe(0);
  });
});
