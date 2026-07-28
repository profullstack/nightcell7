import { describe, expect, it } from "vitest";
import { titleFromStem, toTrack } from "./audio";

/**
 * The soundtrack is discovered by globbing `public/audio/music/<artist>/`
 * (see the `soundtrack()` plugin in `vite.config.ts`), so titles and artist
 * names are derived from paths rather than written by hand.
 *
 * That trade is only worth it if the derivation is right, and the failure mode
 * is silent: a wrong title shows up in a "now playing" line, never in an error.
 * These lock the rules against the tracks that were previously listed by hand,
 * which is the one case where the correct answer is already known.
 */
describe("track titles", () => {
  it("reproduces the hand-written titles exactly", () => {
    expect(titleFromStem("frost-on-the-oar")).toBe("Frost on the Oar");
    expect(titleFromStem("runes-on-ice")).toBe("Runes on Ice");
    expect(titleFromStem("ironwood-oath")).toBe("Ironwood Oath");
    expect(titleFromStem("storm-crown-oath")).toBe("Storm Crown Oath");
    expect(titleFromStem("the-wolf-called-want")).toBe("The Wolf Called Want");
    expect(titleFromStem("the-wolf-called-want-part-2")).toBe("The Wolf Called Want (Part 2)");
  });

  it("capitalises a leading minor word", () => {
    // "the" is lowercase mid-title but must not be when it leads.
    expect(titleFromStem("the-oath")).toBe("The Oath");
    expect(titleFromStem("a-quiet-war")).toBe("A Quiet War");
  });

  it("takes an already-spaced filename as authored", () => {
    // Nobody who names a file "More Than Enough.mp3" wants it re-cased.
    expect(titleFromStem("More Than Enough")).toBe("More Than Enough");
  });
});

describe("tracks from paths", () => {
  it("maps artist folder to display name and builds the path", () => {
    expect(toTrack("throngva/runes-on-ice.mp3")).toEqual({
      file: "music/throngva/runes-on-ice.mp3",
      title: "Runes on Ice",
      artist: "Þrøngva",
    });
  });

  it("handles spaces and a mixed-case extension", () => {
    expect(toTrack("throngva/More Than Enough.mp3")).toEqual({
      file: "music/throngva/More Than Enough.mp3",
      title: "More Than Enough",
      artist: "Þrøngva",
    });
    expect(toTrack("throngva/Loud.MP3").title).toBe("Loud");
  });

  it("falls back to the folder name for an unknown artist", () => {
    // A new artist should appear sensibly without needing a code change,
    // which is the whole point of globbing the directory.
    expect(toTrack("kaviran/dust-line.mp3").artist).toBe("Kaviran");
  });
});
