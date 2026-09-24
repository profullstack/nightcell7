import { describe, expect, it } from "vitest";

import { BITE, createInsectBiteState, stepInsectBite } from "./insects";
import { MAX_HEALTH } from "./damage";

/**
 * The bite is ambience, so the tests are mostly about restraint: that it stays
 * quiet when it should, that it cannot run away with the player's health, and
 * that the one rule multiplayer depends on — never subtract health unless the
 * caller says it owns the vitals — actually holds.
 */

/** A fixed sequence, so an interval is never a coin flip in a test. */
function fixed(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

const vitals = { health: MAX_HEALTH, armor: 0 };
const on = { enabled: true, damage: true, vitals } as const;

describe("insect bite", () => {
  it("stays quiet through the opening grace period", () => {
    const state = createInsectBiteState(fixed(0));
    expect(state.nextBiteAt).toBeGreaterThanOrEqual(BITE.GRACE_MS);

    const step = stepInsectBite(state, BITE.GRACE_MS - 1, fixed(0), on);
    expect(step.bit).toBe(false);
    expect(step.vitals.health).toBe(MAX_HEALTH);
  });

  it("bites once the clock passes, and costs a few points", () => {
    const state = createInsectBiteState(fixed(0));
    const step = stepInsectBite(state, state.nextBiteAt, fixed(0.5), on);

    expect(step.bit).toBe(true);
    expect(step.scratching).toBe(true);
    expect(step.state.bites).toBe(1);
    expect(MAX_HEALTH - step.vitals.health).toBeCloseTo(BITE.DAMAGE);
  });

  it("swats first, then bites — never the other way round", () => {
    const state = createInsectBiteState(fixed(0));
    const bite = state.nextBiteAt;

    // Too early: no swat yet.
    const early = stepInsectBite(state, bite - BITE.SWAT_LEAD_MS - 50, fixed(0), on);
    expect(early.swatting).toBe(false);
    expect(early.startedSwat).toBe(false);
    expect(early.bit).toBe(false);

    // Inside the lead: swatting, and the edge fires exactly once.
    const first = stepInsectBite(state, bite - 400, fixed(0), on);
    expect(first.swatting).toBe(true);
    expect(first.startedSwat).toBe(true);
    expect(first.bit).toBe(false);
    expect(first.damageDealt).toBe(0);

    const second = stepInsectBite(first.state, bite - 200, fixed(0), on);
    expect(second.swatting).toBe(true);
    expect(second.startedSwat).toBe(false);

    // Then it lands, and the swat is over.
    const landed = stepInsectBite(second.state, bite, fixed(0.5), on);
    expect(landed.bit).toBe(true);
    expect(landed.swatting).toBe(false);
    expect(landed.scratching).toBe(true);
    // Re-armed for the next cycle.
    expect(landed.state.swatAnnounced).toBe(false);
  });

  it("never bites twice inside one scratch", () => {
    const first = stepInsectBite(
      createInsectBiteState(fixed(0)),
      BITE.GRACE_MS + BITE.MIN_INTERVAL_MS,
      fixed(0),
      on,
    );
    expect(first.bit).toBe(true);

    // Mid-scratch: the clock has moved on but the player is still swatting.
    const during = stepInsectBite(first.state, first.state.scratchUntil - 1, fixed(0), on);
    expect(during.bit).toBe(false);
    expect(during.scratching).toBe(true);
    expect(during.state.bites).toBe(1);
  });

  it("schedules the next bite inside the advertised window", () => {
    const state = createInsectBiteState(fixed(0));
    for (const roll of [0, 0.5, 0.999]) {
      const step = stepInsectBite(state, state.nextBiteAt, fixed(roll), on);
      const gap = step.state.nextBiteAt - state.nextBiteAt;
      expect(gap).toBeGreaterThanOrEqual(BITE.MIN_INTERVAL_MS);
      expect(gap).toBeLessThanOrEqual(BITE.MAX_INTERVAL_MS);
    }
  });

  it("does not touch health when the caller does not own the vitals", () => {
    // This is the multiplayer path: the mosquito and the scratch still happen,
    // but the client must not invent a health change the server never sent.
    const state = createInsectBiteState(fixed(0));
    const step = stepInsectBite(state, state.nextBiteAt, fixed(0), {
      enabled: true,
      damage: false,
      vitals,
    });

    expect(step.bit).toBe(true);
    expect(step.scratching).toBe(true);
    expect(step.vitals.health).toBe(MAX_HEALTH);
  });

  it("does nothing at all when disabled", () => {
    const state = createInsectBiteState(fixed(0));
    const step = stepInsectBite(state, state.nextBiteAt + BITE.MAX_INTERVAL_MS, fixed(0), {
      enabled: false,
      damage: true,
      vitals,
    });

    expect(step.bit).toBe(false);
    expect(step.state.bites).toBe(0);
    expect(step.vitals.health).toBe(MAX_HEALTH);
  });

  it("floors proportionally, so a tougher fighter is not punished harder", () => {
    // The floor was a flat 70, which cost a 150-stamina fighter 80 points and a
    // 100-stamina one only 30. As a fraction both lose at most a fifth.
    for (const maxHealth of [100, 150, 200]) {
      let state = createInsectBiteState(fixed(0));
      let current = { health: maxHealth, armor: 0 };
      for (let now = 0; now <= 30 * 60_000; now += 500) {
        const step = stepInsectBite(state, now, fixed(0), {
          enabled: true,
          damage: true,
          vitals: current,
          maxHealth,
        });
        state = step.state;
        current = step.vitals;
      }
      expect(state.bites).toBeGreaterThan(0);
      expect(current.health).toBeGreaterThanOrEqual(maxHealth * BITE.FLOOR_FRACTION - 0.001);
    }
  });

  it("cannot whittle a player down over a long match", () => {
    // Worst case: the shortest possible interval, for twenty minutes.
    let state = createInsectBiteState(fixed(0));
    let current = { ...vitals };
    for (let now = 0; now <= 20 * 60_000; now += 250) {
      const step = stepInsectBite(state, now, fixed(0), {
        enabled: true,
        damage: true,
        vitals: current,
      });
      state = step.state;
      current = step.vitals;
    }
    // A handful of points, not a death sentence.
    expect(current.health).toBeGreaterThan(MAX_HEALTH * 0.6);
    expect(state.bites).toBeGreaterThan(0);
  });
});
