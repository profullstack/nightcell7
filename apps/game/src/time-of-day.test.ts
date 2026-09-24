import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIME_OF_DAY,
  LIGHTING,
  TIME_OF_DAY,
  TIMES_OF_DAY,
  preferredTimeOfDay,
  rememberTimeOfDay,
  timeOfDayInfo,
} from "./time-of-day";

function storage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

/** Storage that throws on every access, as a locked-down browser does. */
function hostileStorage(): Storage {
  return new Proxy({} as Storage, {
    get() {
      throw new Error("storage disabled");
    },
  });
}

describe("time of day", () => {
  it("defaults to night, which is the look the game shipped with", () => {
    expect(DEFAULT_TIME_OF_DAY).toBe(TIME_OF_DAY.NIGHT);
    expect(preferredTimeOfDay("", storage())).toBe(TIME_OF_DAY.NIGHT);
  });

  it("takes ?time= ahead of the remembered choice", () => {
    const store = storage({ "nc7.time": TIME_OF_DAY.NIGHT });
    expect(preferredTimeOfDay("?time=day", store)).toBe(TIME_OF_DAY.DAY);
  });

  it("falls back to the remembered choice, then the default", () => {
    expect(preferredTimeOfDay("", storage({ "nc7.time": TIME_OF_DAY.DAY }))).toBe(TIME_OF_DAY.DAY);
    expect(preferredTimeOfDay("?time=dusk", storage())).toBe(DEFAULT_TIME_OF_DAY);
  });

  it("survives storage that throws on access", () => {
    expect(() => preferredTimeOfDay("", hostileStorage())).not.toThrow();
    expect(preferredTimeOfDay("", hostileStorage())).toBe(DEFAULT_TIME_OF_DAY);
    expect(() => rememberTimeOfDay(TIME_OF_DAY.DAY, hostileStorage())).not.toThrow();
  });

  it("round-trips a remembered choice", () => {
    const store = storage();
    rememberTimeOfDay(TIME_OF_DAY.DAY, store);
    expect(preferredTimeOfDay("", store)).toBe(TIME_OF_DAY.DAY);
  });

  it("describes every option it offers", () => {
    for (const entry of TIMES_OF_DAY) {
      expect(timeOfDayInfo(entry.id)).toBe(entry);
      expect(entry.blurb.length).toBeGreaterThan(0);
    }
  });

  /**
   * The load-bearing assertion of this whole feature: adding a day option must
   * not have changed the night one. These are the constants that were written
   * inline in `buildWorld` before the table existed.
   */
  it("keeps the shipped false-dawn rig byte for byte", () => {
    const night = LIGHTING[TIME_OF_DAY.NIGHT];
    expect(night.clearColor).toEqual([0.027, 0.035, 0.047]);
    expect(night.ambientColor).toEqual([0.14, 0.17, 0.22]);
    expect(night.fogDensity).toBe(0.0045);
    expect(night.fogColor).toEqual([0.4, 0.47, 0.52]);
    expect(night.sky).toEqual(["#263d54", "#697c89", "#b7b7ac"]);
    expect(night.hemispheric).toEqual({
      intensity: 2.0,
      diffuse: [0.62, 0.7, 0.82],
      ground: [0.27, 0.3, 0.32],
      specular: [0.16, 0.2, 0.26],
    });
    expect(night.key.direction).toEqual([0.45, -0.65, 0.55]);
    expect(night.key.position).toEqual([-10, 26, -95]);
    expect(night.key.intensity).toBe(2.1);
    expect(night.rim.intensity).toBe(0.55);
    expect(night.shadowDarkness).toBe(0.55);
    expect(night.glowIntensity).toBe(0.55);
  });

  it("only puts insects out at night", () => {
    expect(LIGHTING[TIME_OF_DAY.NIGHT].insects).toBe(true);
    expect(LIGHTING[TIME_OF_DAY.DAY].insects).toBe(false);
  });

  it("lights the day brighter and clearer than the night", () => {
    const night = LIGHTING[TIME_OF_DAY.NIGHT];
    const day = LIGHTING[TIME_OF_DAY.DAY];
    expect(day.key.intensity).toBeGreaterThan(night.key.intensity);
    // Clear air reaches further, which is most of what changes about play.
    expect(day.fogDensity).toBeLessThan(night.fogDensity);
    // A night bloom in daylight haloes every bright surface.
    expect(day.glowIntensity).toBeLessThan(night.glowIntensity);
  });
});
