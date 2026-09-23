import { describe, expect, it } from "vitest";
import { FACTIONS } from "@nightcell7/game-core";
import { SIDE } from "./loadout";
import {
  COACH_STEPS,
  Coach,
  briefingFor,
  hasOnboarded,
  markOnboarded,
  type CoachSnapshot,
} from "./onboarding";

const IDLE: CoachSnapshot = {
  speed: 0,
  grounded: true,
  crouching: false,
  sprinting: false,
  firing: false,
  yaw: 0,
  reloading: false,
  slot: 0,
  grenades: 2,
  alive: true,
};

const at = (over: Partial<CoachSnapshot>): CoachSnapshot => ({ ...IDLE, ...over });

/** Drive a coach through a list of snapshots, returning the last state. */
function drive(coach: Coach, frames: CoachSnapshot[]) {
  let state = coach.observe(IDLE);
  for (const f of frames) state = coach.observe(f);
  return state;
}

describe("coach", () => {
  it("teaches in the PRD's order: move first, frag last", () => {
    expect(COACH_STEPS.map((s) => s.id)).toEqual([
      "move",
      "look",
      "sprint",
      "crouch",
      "jump",
      "fire",
      "reload",
      "switch",
      "frag",
    ]);
  });

  it("starts on the first step and does not advance on its own", () => {
    const coach = new Coach();
    for (let i = 0; i < 200; i += 1) {
      const state = coach.observe(IDLE);
      expect(state.step?.id).toBe("move");
    }
  });

  it("advances only when the player does the thing", () => {
    const coach = new Coach();
    expect(drive(coach, [at({ speed: 3 })]).step?.id).toBe("look");
  });

  it("counts a real turn, not a wrap past pi", () => {
    const coach = new Coach();
    // Start facing just under +pi and finish "move" there, so the turn count
    // begins from 3.1 rather than from a jump off yaw 0.
    coach.observe(at({ yaw: 3.1 }));
    expect(coach.observe(at({ yaw: 3.1, speed: 3 })).step?.id).toBe("look");
    // Crossing from just under +pi to just over -pi is a 0.08 rad turn, not 6.2.
    expect(coach.observe(at({ yaw: -3.1 })).step?.id).toBe("look");
    // A real 0.9 rad turn completes it.
    expect(coach.observe(at({ yaw: -2.2 })).step?.id).toBe("sprint");
  });

  it("needs a change of weapon, not merely being on a slot", () => {
    const coach = new Coach();
    drive(coach, [
      at({ speed: 3 }),
      at({ yaw: 1 }),
      at({ sprinting: true }),
      at({ crouching: true }),
      at({ grounded: false }),
      at({ firing: true }),
      at({ reloading: true }),
    ]);
    expect(coach.observe(at({ slot: 0 })).step?.id).toBe("switch");
    expect(coach.observe(at({ slot: 1 })).step?.id).toBe("frag");
  });

  it("finishes on spending a frag, and says so exactly once", () => {
    const coach = new Coach();
    drive(coach, [
      at({ speed: 3 }),
      at({ yaw: 1 }),
      at({ sprinting: true }),
      at({ crouching: true }),
      at({ grounded: false }),
      at({ firing: true }),
      at({ reloading: true }),
      at({ slot: 1 }),
    ]);
    const done = coach.observe(at({ slot: 1, grenades: 1 }));
    expect(done.finished).toBe(true);
    expect(done.step).toBeNull();
    const after = coach.observe(at({ slot: 1, grenades: 1 }));
    expect(after.finished).toBe(false);
    expect(coach.complete).toBe(true);
  });

  it("waits while the player is dead instead of scoring the respawn", () => {
    const coach = new Coach();
    drive(coach, [
      at({ speed: 3 }),
      at({ yaw: 1 }),
      at({ sprinting: true }),
      at({ crouching: true }),
      at({ grounded: false }),
      at({ firing: true }),
      at({ reloading: true }),
      at({ slot: 1 }),
    ]);
    // Died holding slot 1 with 2 frags; respawn resets to slot 0 with 2 frags.
    coach.observe(at({ alive: false, slot: 1 }));
    const back = coach.observe(at({ slot: 0, grenades: 2 }));
    expect(back.step?.id).toBe("frag");
  });

  it("stops when skipped", () => {
    const coach = new Coach();
    coach.skip();
    expect(coach.observe(at({ speed: 3 })).step).toBeNull();
    expect(coach.complete).toBe(true);
  });
});

describe("briefing", () => {
  it("names the chosen side's institution from the shared cast", () => {
    const nightcell = FACTIONS.find((f) => f.id === "nightcell")!;
    const directorate = FACTIONS.find((f) => f.id === "directorate")!;
    expect(briefingFor(SIDE.NIGHTCELL).lines[0]).toContain(nightcell.name);
    expect(briefingFor(SIDE.NIGHTCELL).lines[0]).toContain("Rook");
    expect(briefingFor(SIDE.DIRECTORATE).lines[0]).toContain(directorate.name);
    expect(briefingFor(SIDE.DIRECTORATE).lines[0]).toContain("Leila");
  });

  it("gives both sides the same number of lines", () => {
    expect(briefingFor(SIDE.NIGHTCELL).lines.length).toBe(
      briefingFor(SIDE.DIRECTORATE).lines.length,
    );
  });
});

describe("persistence", () => {
  function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (k) => data.get(k) ?? null,
      key: (i) => [...data.keys()][i] ?? null,
      removeItem: (k) => void data.delete(k),
      setItem: (k, v) => void data.set(k, String(v)),
    };
  }

  it("is not onboarded until marked", () => {
    const storage = memoryStorage();
    expect(hasOnboarded(storage)).toBe(false);
    markOnboarded(storage);
    expect(hasOnboarded(storage)).toBe(true);
  });

  it("treats blocked storage as onboarded rather than nagging forever", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(hasOnboarded(blocked)).toBe(true);
  });
});
