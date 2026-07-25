import { describe, expect, it } from "vitest";
import {
  ARMOR_ABSORPTION,
  DIFFICULTY,
  MAX_HEALTH,
  MISSION,
  SIDE,
  TDM_RULES,
  WEAPON,
  applyDamage,
  assignTeam,
  canStartMission,
  completeMission,
  completedSides,
  computeShotDamage,
  damageFalloff,
  emptyEpisodeProgress,
  evaluateMatchOutcome,
  fireIntervalMs,
  getWeapon,
  isMultiplayerLegal,
  missionsForSide,
  regenerate,
  shouldUnlockCompleteTruth,
  visibleTimeline,
  EPISODE,
} from "./index";

describe("damage model", () => {
  it("routes half of incoming damage into armour while armour lasts", () => {
    const result = applyDamage({ health: 100, armor: 100 }, 40);
    expect(result.armorDamage).toBe(40 * ARMOR_ABSORPTION);
    expect(result.healthDamage).toBe(40 - 40 * ARMOR_ABSORPTION);
    expect(result.vitals.health).toBe(80);
    expect(result.vitals.armor).toBe(80);
    expect(result.armorAbsorbed).toBe(true);
    expect(result.killed).toBe(false);
  });

  it("spills the remainder into health when armour runs out mid-hit", () => {
    const result = applyDamage({ health: 100, armor: 5 }, 40);
    expect(result.armorDamage).toBe(5);
    expect(result.healthDamage).toBe(35);
    expect(result.vitals.armor).toBe(0);
    expect(result.vitals.health).toBe(65);
  });

  it("reports a kill exactly once, not on damage dealt to a corpse", () => {
    const lethal = applyDamage({ health: 10, armor: 0 }, 40);
    expect(lethal.killed).toBe(true);
    expect(lethal.vitals.health).toBe(0);

    const overkill = applyDamage(lethal.vitals, 40);
    expect(overkill.killed).toBe(false);
  });

  it("never returns negative health or armour", () => {
    const result = applyDamage({ health: 3, armor: 1 }, 9999);
    expect(result.vitals.health).toBe(0);
    expect(result.vitals.armor).toBe(0);
  });

  it("regenerates only up to the stabilisation ceiling", () => {
    const stabilised = regenerate({ health: 5, armor: 0 }, 60_000);
    expect(stabilised.health).toBe(40);

    const alreadyHealthy = regenerate({ health: 90, armor: 0 }, 60_000);
    expect(alreadyHealthy.health).toBe(90);
  });
});

describe("weapons", () => {
  it("derives fire interval from rpm", () => {
    expect(fireIntervalMs(getWeapon(WEAPON.C9_KESTREL))).toBeCloseTo(83.33, 1);
  });

  it("applies flat damage inside the falloff start distance", () => {
    const spec = getWeapon(WEAPON.C9_KESTREL);
    expect(damageFalloff(spec, 0)).toBe(1);
    expect(damageFalloff(spec, spec.falloffStartM)).toBe(1);
  });

  it("floors damage at the minimum fraction beyond falloff end", () => {
    const spec = getWeapon(WEAPON.C9_KESTREL);
    expect(damageFalloff(spec, 10_000)).toBe(spec.minDamageFraction);
  });

  it("decays monotonically between falloff start and end", () => {
    const spec = getWeapon(WEAPON.P11);
    let previous = damageFalloff(spec, spec.falloffStartM);
    for (let d = spec.falloffStartM; d <= spec.falloffEndM; d += 1) {
      const current = damageFalloff(spec, d);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
  });

  it("multiplies headshots and clamps pellets to the weapon's pellet count", () => {
    const spec = getWeapon(WEAPON.B4_BREACHER);
    const capped = computeShotDamage({ spec, distanceM: 0, headshot: false, pelletsHit: 999 });
    expect(capped).toBe(spec.damage * spec.pellets);

    const head = computeShotDamage({ spec, distanceM: 0, headshot: true, pelletsHit: 1 });
    expect(head).toBe(spec.damage * spec.headshotMultiplier);
  });

  it("keeps the campaign finale weapon out of multiplayer", () => {
    expect(isMultiplayerLegal(WEAPON.M7_LANCE)).toBe(false);
    expect(isMultiplayerLegal(WEAPON.C9_KESTREL)).toBe(true);
  });

  it("cannot two-shot a full-health full-armour player with the starter carbine", () => {
    // Guards the "no instant melt" feel target without pinning exact numbers.
    const spec = getWeapon(WEAPON.C9_KESTREL);
    let vitals = { health: MAX_HEALTH, armor: 100 };
    const shot = computeShotDamage({ spec, distanceM: 15, headshot: false });
    vitals = applyDamage(vitals, shot).vitals;
    vitals = applyDamage(vitals, shot).vitals;
    expect(vitals.health).toBeGreaterThan(0);
  });
});

describe("campaign progression", () => {
  it("starts with nothing completed and Complete Truth locked", () => {
    const progress = emptyEpisodeProgress(EPISODE.FALSE_DAWN);
    expect(completedSides(progress)).toEqual([]);
    expect(progress.completeTruthUnlocked).toBe(false);
  });

  it("lets either side be played first", () => {
    const progress = emptyEpisodeProgress(EPISODE.FALSE_DAWN);
    const paid = { hasEntitlement: true };
    expect(canStartMission(progress, MISSION.ROOK_DEAD_DROP, paid).allowed).toBe(true);
    expect(canStartMission(progress, MISSION.LEILA_COUNTER_SIGNAL, paid).allowed).toBe(true);
  });

  it("allows demo missions without an entitlement but not paid ones", () => {
    const progress = emptyEpisodeProgress(EPISODE.FALSE_DAWN);
    const free = { hasEntitlement: false };
    expect(canStartMission(progress, MISSION.ROOK_DEAD_DROP, free).allowed).toBe(true);
    expect(canStartMission(progress, MISSION.LEILA_COUNTER_SIGNAL, free).allowed).toBe(true);

    const paidMission = canStartMission(progress, MISSION.ROOK_BLACK_RELAY, free);
    expect(paidMission).toEqual({ allowed: false, reason: "entitlement_required" });
  });

  it("requires the previous mission on the same side", () => {
    const progress = emptyEpisodeProgress(EPISODE.FALSE_DAWN);
    expect(canStartMission(progress, MISSION.ROOK_FALSE_DAWN, { hasEntitlement: true })).toEqual({
      allowed: false,
      reason: "prerequisite",
    });
  });

  it("unlocks Complete Truth only after both campaigns finish", () => {
    let progress = emptyEpisodeProgress(EPISODE.FALSE_DAWN);
    const outcome = { difficulty: DIFFICULTY.OPERATIVE, timeMs: 60_000 };

    for (const mission of missionsForSide(SIDE.ROOK)) {
      progress = completeMission(progress, mission.id, outcome);
    }
    expect(completedSides(progress)).toEqual([SIDE.ROOK]);
    expect(shouldUnlockCompleteTruth(progress)).toBe(false);
    expect(progress.completeTruthUnlocked).toBe(false);

    for (const mission of missionsForSide(SIDE.LEILA)) {
      progress = completeMission(progress, mission.id, outcome);
    }
    expect(completedSides(progress).sort()).toEqual([SIDE.LEILA, SIDE.ROOK].sort());
    expect(progress.completeTruthUnlocked).toBe(true);
    expect(canStartMission(progress, MISSION.COMPLETE_TRUTH, { hasEntitlement: true })).toEqual({
      allowed: true,
    });
  });

  it("refuses to record a Complete Truth completion before it is unlocked", () => {
    const progress = emptyEpisodeProgress(EPISODE.FALSE_DAWN);
    expect(() =>
      completeMission(progress, MISSION.COMPLETE_TRUTH, {
        difficulty: DIFFICULTY.OPERATIVE,
        timeMs: 1,
      }),
    ).toThrow();
  });

  it("keeps the best difficulty and best time across replays", () => {
    let progress = emptyEpisodeProgress(EPISODE.FALSE_DAWN);
    progress = completeMission(progress, MISSION.ROOK_DEAD_DROP, {
      difficulty: DIFFICULTY.BLACK,
      timeMs: 500_000,
    });
    progress = completeMission(progress, MISSION.ROOK_DEAD_DROP, {
      difficulty: DIFFICULTY.FIELD_AGENT,
      timeMs: 200_000,
    });
    const mission = progress.sides
      .find((s) => s.side === SIDE.ROOK)
      ?.missions.find((m) => m.missionId === MISSION.ROOK_DEAD_DROP);
    expect(mission?.bestDifficulty).toBe(DIFFICULTY.BLACK);
    expect(mission?.bestTimeMs).toBe(200_000);
  });

  it("only reveals timeline events the player could have witnessed", () => {
    expect(visibleTimeline([])).toHaveLength(0);
    const rookOnly = visibleTimeline([SIDE.ROOK]);
    expect(rookOnly.every((e) => e.witness === "both" || e.witness === SIDE.ROOK)).toBe(true);
    expect(rookOnly.some((e) => e.witness === SIDE.LEILA)).toBe(false);
    expect(visibleTimeline([SIDE.ROOK, SIDE.LEILA]).length).toBeGreaterThan(rookOnly.length);
  });
});

describe("team deathmatch rules", () => {
  it("ends the match when a team reaches the score limit", () => {
    const outcome = evaluateMatchOutcome({ 0: TDM_RULES.scoreLimit, 1: 10 }, 1000);
    expect(outcome).toEqual({ ended: true, reason: "score_limit", winningTeam: 0 });
  });

  it("ends on the timer and reports a draw when scores are level", () => {
    const outcome = evaluateMatchOutcome({ 0: 30, 1: 30 }, TDM_RULES.durationMs);
    expect(outcome).toEqual({ ended: true, reason: "time_limit", winningTeam: null });
  });

  it("keeps running while under both limits", () => {
    expect(evaluateMatchOutcome({ 0: 10, 1: 12 }, 1000)).toEqual({ ended: false });
  });

  it("puts balance ahead of faction preference", () => {
    // Preferred side is already full relative to the other — balance wins.
    expect(assignTeam({ 0: 6, 1: 2 }, 0)).toBe(1);
    // Preference is honoured when it does not unbalance the match.
    expect(assignTeam({ 0: 2, 1: 3 }, 0)).toBe(0);
    expect(assignTeam({ 0: 3, 1: 2 }, 1)).toBe(1);
  });

  it("never scores a team kill positively", () => {
    expect(TDM_RULES.pointsPerTeamKill).toBeLessThan(0);
  });
});
