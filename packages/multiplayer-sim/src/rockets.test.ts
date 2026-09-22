import { describe, expect, it } from "vitest";
import { WEAPON, getWeapon, isProjectileWeapon } from "@nightcell7/game-core";
import { ARDAVAN_YARD, type CollisionMap } from "./map";
import { rocketLaunchVelocity, stepRocket, type RocketTarget, type SimRocket } from "./rockets";
import { TICK_MS } from "./constants";
import type { Vec3 } from "./vec";

const SPEC = getWeapon(WEAPON.M9_HAMMERFALL);

/**
 * The yard with nothing solid in it, so a flight test is about the rocket
 * rather than about where the containers happen to stand.
 */
const VOID: CollisionMap = { ...ARDAVAN_YARD, boxes: [] };

function rocket(position: Vec3, velocity: Vec3): SimRocket {
  return {
    id: "r1",
    ownerId: "shooter",
    ownerTeam: 1,
    weaponId: WEAPON.M9_HAMMERFALL,
    position: { ...position },
    velocity: { ...velocity },
    travelledM: 0,
    detonated: false,
    impact: null,
  };
}

function target(id: string, center: Vec3, team = 2): RocketTarget {
  return { id, team, center, alive: true };
}

describe("the launcher is a projectile weapon", () => {
  it("is the only one", () => {
    expect(isProjectileWeapon(SPEC)).toBe(true);
    for (const id of [WEAPON.C9_KESTREL, WEAPON.P11, WEAPON.B4_BREACHER, WEAPON.M7_LANCE]) {
      expect(isProjectileWeapon(getWeapon(id))).toBe(false);
    }
  });

  it("launches along the aim at the muzzle speed", () => {
    const v = rocketLaunchVelocity(SPEC, { x: 0, y: 0, z: 1 });
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(SPEC.projectileSpeedMps ?? 0, 5);
  });

  it("refuses to launch a weapon that is not a launcher", () => {
    expect(() =>
      rocketLaunchVelocity(getWeapon(WEAPON.C9_KESTREL), { x: 0, y: 0, z: 1 }),
    ).toThrow();
  });
});

describe("rocket flight", () => {
  it("flies forward and does not detonate in open air", () => {
    const r = rocket({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 40 });
    stepRocket(r, TICK_MS, VOID, []);
    expect(r.detonated).toBe(false);
    expect(r.position.z).toBeGreaterThan(0.5);
    expect(r.travelledM).toBeGreaterThan(0.5);
  });

  it("drops, but far less than a grenade", () => {
    const r = rocket({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 40 });
    for (let i = 0; i < 15; i += 1) stepRocket(r, TICK_MS, VOID, []);
    expect(r.position.y).toBeLessThan(5);
    // Half a second of flight at -2.6 m/s^2 is a few tens of centimetres, not
    // the metre-plus a thrown grenade would have lost.
    expect(r.position.y).toBeGreaterThan(4);
  });

  it("detonates on a body and records the direct hit", () => {
    const r = rocket({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 40 });
    const enemy = target("enemy", { x: 0, y: 2, z: 1.1 });
    stepRocket(r, TICK_MS, VOID, [enemy]);
    expect(r.detonated).toBe(true);
    expect(r.impact?.directHitId).toBe("enemy");
  });

  it("passes through the firer instead of detonating in their face", () => {
    const r = rocket({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 40 });
    const self = target("shooter", { x: 0, y: 2, z: 0.4 }, 1);
    stepRocket(r, TICK_MS, VOID, [self]);
    expect(r.detonated).toBe(false);
  });

  it("ignores a body it has already flown past", () => {
    const r = rocket({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 40 });
    const behind = target("behind", { x: 0, y: 2, z: -3 });
    stepRocket(r, TICK_MS, VOID, [behind]);
    expect(r.detonated).toBe(false);
  });

  it("ignores a corpse", () => {
    const r = rocket({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 40 });
    const dead: RocketTarget = { ...target("dead", { x: 0, y: 2, z: 1.1 }), alive: false };
    stepRocket(r, TICK_MS, VOID, [dead]);
    expect(r.detonated).toBe(false);
  });

  it("detonates on the yard rather than tunnelling through it", () => {
    // Straight down into the ground from a height the yard definitely has floor
    // under. At 42 m/s a single unsubstepped tick would move 1.4 m and could
    // step clean past a thin collider.
    const r = rocket({ x: 0, y: 6, z: 0 }, { x: 0, y: -42, z: 0 });
    for (let i = 0; i < 12 && !r.detonated; i += 1) stepRocket(r, TICK_MS, ARDAVAN_YARD, []);
    expect(r.detonated).toBe(true);
    expect(r.impact?.directHitId).toBeNull();
    // Backed off the surface, so the blast centre is not buried inside it.
    expect(r.position.y).toBeGreaterThan(-0.2);
  });

  it("stops at its maximum range", () => {
    const r = rocket({ x: 0, y: 40, z: 0 }, { x: 0, y: 0, z: 42 });
    let ticks = 0;
    while (!r.detonated && ticks < 2000) {
      stepRocket(r, TICK_MS, VOID, []);
      ticks += 1;
    }
    expect(r.detonated).toBe(true);
    expect(r.travelledM).toBeGreaterThanOrEqual(SPEC.maxRangeM);
  });

  it("does nothing once it has detonated", () => {
    const r = rocket({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 40 });
    r.detonated = true;
    const before = { ...r.position };
    stepRocket(r, TICK_MS, VOID, []);
    expect(r.position).toEqual(before);
  });
});
