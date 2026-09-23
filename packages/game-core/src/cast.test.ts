import { describe, expect, it } from "vitest";
import {
  CIRCLES,
  FACTIONS,
  MIRAGE,
  SUPPORTING_CAST,
  castMember,
  faction,
  type FactionId,
} from "./cast";
import { SIDE } from "./ids";

/**
 * The cast is public copy shared by the site and the game, so the tests guard
 * the two rules that are easy to break by editing a sentence: no spoilers, and
 * the content standards in docs/content-and-culture.md.
 */
const ALL_TEXT = [
  ...SUPPORTING_CAST.flatMap((m) => [m.name, m.role, m.summary]),
  ...FACTIONS.flatMap((f) => [f.name, f.summary]),
  MIRAGE.summary,
].join("\n");

describe("cast canon", () => {
  it("names the four supporting characters from the story bible", () => {
    expect(SUPPORTING_CAST.map((m) => m.name)).toEqual([
      "Jonas Vale",
      "Director Mara Vey",
      "Colonel Arman Daryan",
      "Silas Kade",
    ]);
  });

  it("gives every cast member a real faction", () => {
    for (const member of SUPPORTING_CAST) {
      expect(() => faction(member.faction as FactionId)).not.toThrow();
    }
  });

  it("resolves every name in both protagonists' circles", () => {
    for (const side of [SIDE.ROOK, SIDE.LEILA]) {
      const circle = CIRCLES[side];
      expect(() => castMember(circle.answersTo)).not.toThrow();
      for (const id of circle.crosses) expect(() => castMember(id)).not.toThrow();
    }
  });

  it("gives both protagonists a circle of the same size", () => {
    // PRD §14.3: neither side may be presented as the richer one.
    expect(CIRCLES[SIDE.ROOK].crosses.length).toBe(CIRCLES[SIDE.LEILA].crosses.length);
  });
});

describe("public copy rules", () => {
  it("does not reveal who authorised the cleanup", () => {
    expect(ALL_TEXT).not.toMatch(/approved the burn|authori[sz]ed the (burn|cleanup)/i);
    expect(ALL_TEXT).not.toMatch(/ties to MIRAGE/i);
  });

  it("does not reveal what Nightcell 7 designates", () => {
    expect(ALL_TEXT).not.toMatch(/Nightcell 7 (means|designates|stands for)/i);
  });

  it("ships no Farsi until native review completes", () => {
    // Arabic-script block, which Persian uses.
    expect(ALL_TEXT).not.toMatch(/[؀-ۿ]/);
  });

  it("never calls Daryan a villain without negating it", () => {
    const daryan = castMember("daryan").summary;
    expect(daryan).toMatch(/not a villain/);
  });

  it("describes MIRAGE without operational method", () => {
    expect(MIRAGE.summary).not.toMatch(
      /\b(exploit|payload|protocol|frequency|spoof(?:ing)? GPS)\b/i,
    );
  });
});
