import { describe, expect, it } from "vitest";
import { WEAPON, getWeapon } from "@nightcell7/game-core";
import {
  DEFAULT_SANDBOX_DIFFICULTY,
  SANDBOX_DIFFICULTIES,
  SANDBOX_DIFFICULTY,
  difficultyInfo,
  preferredDifficulty,
  rememberDifficulty,
} from "./difficulty";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("sandbox difficulty tiers", () => {
  it("get harder in order, and never weaken the player's own rounds", () => {
    const [easy, medium, hard] = SANDBOX_DIFFICULTIES;
    expect(easy!.incomingDamage).toBeLessThan(medium!.incomingDamage);
    expect(medium!.incomingDamage).toBeLessThan(hard!.incomingDamage);
    expect(hard!.incomingDamage).toBe(1);
    for (const tier of SANDBOX_DIFFICULTIES) expect(tier.incomingDamage).toBeGreaterThan(0);
  });

  it("makes easy cost about four health per rifle round with enemies firing in bursts", () => {
    const easy = difficultyInfo(SANDBOX_DIFFICULTY.EASY);
    expect(getWeapon(WEAPON.C9_KESTREL).damage * easy.incomingDamage).toBeCloseTo(4, 5);
    expect(easy.enemyTuning.burstPauseMs).toBeGreaterThan(0);
    const hard = difficultyInfo(SANDBOX_DIFFICULTY.HARD);
    expect(hard.enemyTuning.burstPauseMs).toBe(0);
  });

  it("defaults to easy", () => {
    expect(DEFAULT_SANDBOX_DIFFICULTY).toBe(SANDBOX_DIFFICULTY.EASY);
    expect(preferredDifficulty("")).toBe(SANDBOX_DIFFICULTY.EASY);
  });

  it("honours the query string over the remembered choice", () => {
    const storage = memoryStorage({ "nc7.difficulty": "hard" });
    expect(preferredDifficulty("?difficulty=medium", storage)).toBe(SANDBOX_DIFFICULTY.MEDIUM);
    expect(preferredDifficulty("?mode=range", storage)).toBe(SANDBOX_DIFFICULTY.HARD);
  });

  it("ignores an unknown tier rather than booting into nothing", () => {
    expect(preferredDifficulty("?difficulty=nightmare")).toBe(SANDBOX_DIFFICULTY.EASY);
    expect(difficultyInfo("nightmare" as never).id).toBe(SANDBOX_DIFFICULTY.EASY);
  });

  it("round-trips a remembered tier and survives storage that throws", () => {
    const storage = memoryStorage();
    rememberDifficulty(SANDBOX_DIFFICULTY.HARD, storage);
    expect(preferredDifficulty("", storage)).toBe(SANDBOX_DIFFICULTY.HARD);

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => rememberDifficulty(SANDBOX_DIFFICULTY.MEDIUM, broken)).not.toThrow();
    expect(preferredDifficulty("", broken)).toBe(SANDBOX_DIFFICULTY.EASY);
  });
});
