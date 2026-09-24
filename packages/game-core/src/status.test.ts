import { describe, expect, it } from "vitest";

import {
  STATUS_KIND,
  applyStatus,
  getWeapon,
  hasStatus,
  tickStatuses,
  WEAPON,
  type ActiveStatus,
  type StatusEffect,
} from "./index";

const burn: StatusEffect = {
  kind: STATUS_KIND.BURN,
  damagePerSecond: 10,
  durationMs: 4000,
  disrupt: 0,
};

describe("status effects", () => {
  it("refreshes rather than stacks, so holding a stream cannot compound", () => {
    // The whole reason the model exists. A flame stream re-applies the burn
    // every tick; if those queued up, one second of contact would owe ten
    // seconds of damage and the weapon would kill long after you walked away.
    let active: ActiveStatus[] = [];
    for (let t = 0; t < 1000; t += 50) active = applyStatus(active, burn, t);

    expect(active).toHaveLength(1);
    expect(active[0]!.damagePerSecond).toBe(10);
    // Twenty applications, still one duration from the last one.
    expect(active[0]!.expiresAtMs).toBe(950 + burn.durationMs);
  });

  it("takes the stronger source, never the sum", () => {
    const weak = { ...burn, damagePerSecond: 4, durationMs: 9000 };
    let active = applyStatus([], burn, 0);
    active = applyStatus(active, weak, 0);

    expect(active).toHaveLength(1);
    // Rate from the stronger, duration from the longer — but not 14/s.
    expect(active[0]!.damagePerSecond).toBe(10);
    expect(active[0]!.expiresAtMs).toBe(9000);
  });

  it("bills by elapsed time and never past its own end", () => {
    const active = applyStatus([], { ...burn, durationMs: 1000 }, 0);

    // Half a second in: half a second of damage.
    const half = tickStatuses(active, 500, 500);
    expect(half.damage).toBeCloseTo(5);
    expect(half.active).toHaveLength(1);

    // A long tick that overshoots the end bills only the part that was alive.
    const over = tickStatuses(active, 5000, 5000);
    expect(over.damage).toBeCloseTo(10);
    expect(over.active).toHaveLength(0);
  });

  it("reports the strongest disruption, and clears when it lapses", () => {
    const arc: StatusEffect = {
      kind: STATUS_KIND.ARC,
      damagePerSecond: 0,
      durationMs: 1400,
      disrupt: 0.7,
    };
    const active = applyStatus([], arc, 0);
    expect(hasStatus(active, STATUS_KIND.ARC)).toBe(true);

    const during = tickStatuses(active, 700, 700);
    expect(during.disrupt).toBeCloseTo(0.7);
    expect(during.damage).toBe(0);

    const after = tickStatuses(active, 2000, 700);
    expect(after.active).toHaveLength(0);
    expect(after.disrupt).toBe(0);
  });

  it("gives the two new weapons the behaviour that defines them", () => {
    const tesla = getWeapon(WEAPON.V3_TESLA);
    const cinder = getWeapon(WEAPON.K5_CINDER);

    // The arc takes control, not health: it must not out-damage the rifle.
    expect(tesla.status?.kind).toBe(STATUS_KIND.ARC);
    expect(tesla.status?.damagePerSecond).toBe(0);
    expect(tesla.status?.disrupt).toBeGreaterThan(0);
    // Never a full lock — see the note on `disrupt`.
    expect(tesla.status?.disrupt).toBeLessThan(1);
    expect(tesla.chain?.targets).toBeGreaterThan(0);

    // Fire keeps working after the stream moves on.
    expect(cinder.status?.kind).toBe(STATUS_KIND.BURN);
    expect(cinder.status?.damagePerSecond).toBeGreaterThan(0);
    // Continuous fire comes from the cadence, not a special mode: ten rounds
    // a second out of a ninety-round tank.
    expect(cinder.rpm).toBeGreaterThanOrEqual(600);
    expect(cinder.magazineSize / (cinder.rpm / 60)).toBeCloseTo(9, 0);

    // Both are close-quarters. If either reaches across a lane it is a rifle.
    expect(tesla.maxRangeM).toBeLessThan(20);
    expect(cinder.maxRangeM).toBeLessThan(20);
  });
});
