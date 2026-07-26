import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE,
  GAME_MODE,
  GAME_MODES,
  modeInfo,
  preferredMode,
  rememberMode,
} from "./modes";

/** A Storage stand-in, plus one that throws the way a blocked store does. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function hostileStorage(): Storage {
  const fail = () => {
    throw new Error("SecurityError: storage is blocked");
  };
  return {
    get length(): number {
      return fail();
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  } as unknown as Storage;
}

describe("game mode selection", () => {
  it("defaults to deathmatch with no hint at all", () => {
    expect(preferredMode("", memoryStorage())).toBe(DEFAULT_GAME_MODE);
    expect(DEFAULT_GAME_MODE).toBe(GAME_MODE.DEATHMATCH);
  });

  it("honours an explicit mode in the query string", () => {
    expect(preferredMode("?mode=range", memoryStorage())).toBe(GAME_MODE.RANGE);
    expect(preferredMode("?mode=roam", memoryStorage())).toBe(GAME_MODE.ROAM);
  });

  it("falls back to the remembered choice", () => {
    const storage = memoryStorage({ "nc7.mode": GAME_MODE.ROAM });
    expect(preferredMode("", storage)).toBe(GAME_MODE.ROAM);
  });

  it("lets the query string beat the remembered choice", () => {
    // A shared link has to open what it says, whatever this browser last chose.
    const storage = memoryStorage({ "nc7.mode": GAME_MODE.ROAM });
    expect(preferredMode("?mode=range", storage)).toBe(GAME_MODE.RANGE);
  });

  it("ignores an unknown mode rather than booting into nothing", () => {
    expect(preferredMode("?mode=battle-royale", memoryStorage())).toBe(DEFAULT_GAME_MODE);
    expect(preferredMode("", memoryStorage({ "nc7.mode": "nonsense" }))).toBe(DEFAULT_GAME_MODE);
  });

  it("ignores the access-mode values, which share the parameter name", () => {
    // `access.ts` reads `?mode=` too, for demo/campaign/multiplayer. Those are
    // never scene ids, so they must fall through here rather than matching.
    for (const access of ["demo", "campaign", "multiplayer", "sandbox"]) {
      expect(preferredMode(`?mode=${access}`, memoryStorage())).toBe(DEFAULT_GAME_MODE);
    }
  });

  it("survives storage that throws on every access", () => {
    // Private browsing and blocked third-party storage throw on read *and*
    // write. Neither is worth failing a boot over.
    expect(() => preferredMode("", hostileStorage())).not.toThrow();
    expect(preferredMode("", hostileStorage())).toBe(DEFAULT_GAME_MODE);
    expect(() => rememberMode(GAME_MODE.RANGE, hostileStorage())).not.toThrow();
  });

  it("round-trips a remembered mode", () => {
    const storage = memoryStorage();
    rememberMode(GAME_MODE.RANGE, storage);
    expect(preferredMode("", storage)).toBe(GAME_MODE.RANGE);
  });

  it("works with no storage at all", () => {
    expect(preferredMode("", undefined)).toBe(DEFAULT_GAME_MODE);
    expect(() => rememberMode(GAME_MODE.ROAM, undefined)).not.toThrow();
  });

  it("describes every mode it offers", () => {
    for (const mode of GAME_MODES) {
      expect(mode.name.length, `${mode.id} has no name`).toBeGreaterThan(0);
      expect(mode.blurb.length, `${mode.id} has no blurb`).toBeGreaterThan(0);
      expect(modeInfo(mode.id)).toBe(mode);
    }
  });
});
