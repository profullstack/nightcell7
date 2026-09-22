import { describe, expect, it } from "vitest";
import { COLORS } from "./loadout";
import {
  MIN_TEAM_DISTANCE,
  colorDistance,
  enemyPaletteFor,
  materialRole,
  paletteFromColor,
  teamPalettes,
} from "./targets";

/**
 * The bug these cover: every fighter in the yard rendered the same blue.
 *
 * `brightenCharacter` classified materials by an exclusion list — "team" meant
 * a name containing `paint` or `nc7_team`, "cloth" meant a name that did not
 * start with `nc7_` or `ir_`. Every material on both shipped operator models is
 * `ir_`-prefixed, so the first test never matched and the second excluded
 * everything. No team colour was applied to anyone, and both models share
 * `ir_blue`.
 *
 * These assert against the real material names, read out of the GLBs:
 *   m3_operator_nightcell:  ir_uniform ir_rubber ir_canvas ir_steel ir_blue ir_glass
 *   m3_operator_directorate: ir_canvas ir_rubber ir_blue ir_steel ir_glass
 */
const NIGHTCELL_MATERIALS = [
  "ir_uniform",
  "ir_rubber",
  "ir_canvas",
  "ir_steel",
  "ir_blue",
  "ir_glass",
];
const DIRECTORATE_MATERIALS = ["ir_canvas", "ir_rubber", "ir_blue", "ir_steel", "ir_glass"];

describe("material roles", () => {
  it("colours something on every shipped operator model", () => {
    for (const materials of [NIGHTCELL_MATERIALS, DIRECTORATE_MATERIALS]) {
      const coloured = materials.filter((name) => materialRole(name) !== "keep");
      expect(coloured.length).toBeGreaterThan(0);
    }
  });

  it("treats the uniform as cloth and the accent as the band", () => {
    expect(materialRole("ir_uniform")).toBe("cloth");
    expect(materialRole("ir_canvas")).toBe("cloth");
    expect(materialRole("ir_blue")).toBe("band");
    expect(materialRole("nc7_team")).toBe("band");
    expect(materialRole("nc7_cloth")).toBe("cloth");
  });

  it("never repaints equipment or skin", () => {
    for (const name of ["ir_steel", "ir_rubber", "ir_glass", "ir_skin", "nc7_lens", "nc7_alloy"]) {
      expect(materialRole(name)).toBe("keep");
    }
  });

  it("leaves an unknown material authored rather than guessing", () => {
    expect(materialRole("ir_something_new")).toBe("keep");
  });
});

describe("the two sides are always different colours", () => {
  it("separates the sides for every colour the gate offers", () => {
    for (const color of COLORS) {
      const { own, enemy } = teamPalettes(color.id);
      const distance = colorDistance(own.band, enemy.band);
      expect(
        distance,
        `${color.name} put the enemy ${distance.toFixed(3)} away, under ${MIN_TEAM_DISTANCE}`,
      ).toBeGreaterThanOrEqual(MIN_TEAM_DISTANCE);
    }
  });

  it("moves the enemy off a colour the player takes", () => {
    // Ember is the enemy's usual palette. A player wearing it must push the
    // enemy somewhere else rather than both sides ending up orange.
    const ember = paletteFromColor("ember");
    const against = enemyPaletteFor(ember);
    expect(colorDistance(against.band, ember.band)).toBeGreaterThanOrEqual(MIN_TEAM_DISTANCE);
  });

  it("gives the player the colour they actually picked", () => {
    for (const color of COLORS) {
      const { own } = teamPalettes(color.id);
      expect(own.band.toHexString().toLowerCase()).toBe(color.band.toLowerCase());
    }
  });

  it("falls back to the default palette for an unknown colour id", () => {
    const { own, enemy } = teamPalettes("not-a-colour");
    expect(colorDistance(own.band, enemy.band)).toBeGreaterThanOrEqual(MIN_TEAM_DISTANCE);
  });
});
