import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@nightcell7/multiplayer-sim";
import {
  ARMOR_CLASS,
  ARMOR_CLASSES,
  ARMORY,
  COLORS,
  CREDITS_PER_KILL,
  CREDITS_PER_PACK,
  CREDITS_START,
  CHARACTER,
  CHARACTERS,
  DEFAULT_LOADOUT,
  SIDE,
  affordable,
  armoryItem,
  loadCredits,
  preferredLoadout,
  rememberLoadout,
  saveCredits,
  sideTeam,
  withCharacter,
} from "./loadout";

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

describe("loadout choices", () => {
  it("maps each side to its team", () => {
    expect(sideTeam(SIDE.NIGHTCELL)).toBe(TEAM_IDS.NIGHTCELL);
    expect(sideTeam(SIDE.DIRECTORATE)).toBe(TEAM_IDS.DIRECTORATE);
  });

  it("offers the same number of characters on each side, protagonist first", () => {
    const nightcell = CHARACTERS.filter((c) => c.side === SIDE.NIGHTCELL);
    const directorate = CHARACTERS.filter((c) => c.side === SIDE.DIRECTORATE);
    expect(nightcell.length).toBe(directorate.length);
    expect(nightcell[0]?.id).toBe(CHARACTER.ROOK);
    expect(directorate[0]?.id).toBe(CHARACTER.LEILA);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
  });

  it("ships a portrait for every playable character", () => {
    for (const character of CHARACTERS) {
      const file = new URL(`../public/assets/portraits/${character.portrait}`, import.meta.url);
      expect(existsSync(file), character.portrait).toBe(true);
    }
  });

  it("takes the side from the character", () => {
    const leila = withCharacter(DEFAULT_LOADOUT, CHARACTER.LEILA);
    expect(leila.side).toBe(SIDE.DIRECTORATE);
    expect(withCharacter(leila, CHARACTER.VALE).side).toBe(SIDE.NIGHTCELL);
  });

  it("makes armour a trade, not a free upgrade", () => {
    const [light, standard, heavy] = ARMOR_CLASSES;
    expect(light!.armor).toBeLessThan(standard!.armor);
    expect(standard!.armor).toBeLessThan(heavy!.armor);
    expect(light!.staminaBonus).toBeGreaterThan(heavy!.staminaBonus);
    expect(heavy!.staminaBonus).toBeLessThan(0);
  });

  it("has distinct colours with valid hex", () => {
    expect(new Set(COLORS.map((c) => c.id)).size).toBe(COLORS.length);
    for (const color of COLORS) {
      expect(color.band).toMatch(/^#[0-9a-f]{6}$/i);
      expect(color.cloth).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("loadout persistence", () => {
  it("defaults with nothing stored", () => {
    expect(preferredLoadout("")).toEqual(DEFAULT_LOADOUT);
  });

  it("round-trips a remembered loadout", () => {
    const storage = memoryStorage();
    const chosen = {
      character: CHARACTER.DARYAN,
      side: SIDE.DIRECTORATE,
      armor: ARMOR_CLASS.HEAVY,
      color: "ember",
    } as const;
    rememberLoadout(chosen, storage);
    expect(preferredLoadout("", storage)).toEqual(chosen);
  });

  it("lets the query string pick the side over the remembered one", () => {
    const storage = memoryStorage({
      "nc7.loadout": JSON.stringify({ ...DEFAULT_LOADOUT, character: CHARACTER.LEILA }),
    });
    expect(preferredLoadout("?side=nightcell", storage).side).toBe(SIDE.NIGHTCELL);
    expect(preferredLoadout("?side=nightcell", storage).character).toBe(CHARACTER.ROOK);
    expect(preferredLoadout("?side=martian", storage).side).toBe(SIDE.DIRECTORATE);
  });

  it("lets a Play as link pick the character, and the side with it", () => {
    const storage = memoryStorage({
      "nc7.loadout": JSON.stringify({ ...DEFAULT_LOADOUT, character: CHARACTER.VALE }),
    });
    const leila = preferredLoadout("?character=leila", storage);
    expect(leila.character).toBe(CHARACTER.LEILA);
    expect(leila.side).toBe(SIDE.DIRECTORATE);
    expect(preferredLoadout("?character=kade", storage).character).toBe(CHARACTER.VALE);
  });

  it("upgrades a loadout remembered before characters existed", () => {
    const storage = memoryStorage({
      "nc7.loadout": JSON.stringify({
        side: "directorate",
        gender: "male",
        armor: "light",
        color: "olive",
      }),
    });
    expect(preferredLoadout("", storage)).toEqual({
      character: CHARACTER.LEILA,
      side: SIDE.DIRECTORATE,
      armor: ARMOR_CLASS.LIGHT,
      color: "olive",
    });
  });

  it("falls back one field at a time on a stale or hand-edited entry", () => {
    const storage = memoryStorage({
      "nc7.loadout": JSON.stringify({
        character: "mirage", // no such person
        side: "directorate",
        armor: "titanium",
        color: "ember",
      }),
    });
    expect(preferredLoadout("", storage)).toEqual({
      character: CHARACTER.LEILA,
      side: SIDE.DIRECTORATE,
      armor: ARMOR_CLASS.STANDARD,
      color: "ember",
    });
    expect(preferredLoadout("", memoryStorage({ "nc7.loadout": "{not json" }))).toEqual(
      DEFAULT_LOADOUT,
    );
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => rememberLoadout(DEFAULT_LOADOUT, broken)).not.toThrow();
    expect(preferredLoadout("", broken)).toEqual(DEFAULT_LOADOUT);
    expect(loadCredits(broken)).toBe(CREDITS_START);
    expect(() => saveCredits(10, broken)).not.toThrow();
  });
});

describe("credits and the armory", () => {
  it("starts with enough for a weapon and a resupply, and earns in the yard", () => {
    expect(loadCredits()).toBe(CREDITS_START);
    expect(CREDITS_PER_KILL).toBeGreaterThan(0);
    expect(CREDITS_PER_PACK).toBeGreaterThan(0);
    const cheapestWeapon = Math.min(...ARMORY.filter((i) => i.weapon).map((i) => i.price));
    const resupply = armoryItem("ammo")!.price;
    expect(CREDITS_START).toBeGreaterThanOrEqual(cheapestWeapon + resupply);
  });

  it("round-trips credits and never stores a negative or fractional balance", () => {
    const storage = memoryStorage();
    saveCredits(123.9, storage);
    expect(loadCredits(storage)).toBe(123);
    saveCredits(-5, storage);
    expect(loadCredits(storage)).toBe(0);
    expect(loadCredits(memoryStorage({ "nc7.credits": "garbage" }))).toBe(CREDITS_START);
  });

  it("prices everything above zero and knows what is affordable", () => {
    for (const item of ARMORY) expect(item.price).toBeGreaterThan(0);
    const medkit = armoryItem("medkit")!;
    expect(affordable(medkit.price, medkit)).toBe(true);
    expect(affordable(medkit.price - 1, medkit)).toBe(false);
    expect(armoryItem("jetpack" as never)).toBeUndefined();
  });
});
