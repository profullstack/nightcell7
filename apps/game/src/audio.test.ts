import { describe, expect, it } from "vitest";
import SOUNDTRACK from "virtual:soundtrack";
import { shuffledOrder, titleFromStem, toTrack } from "./audio";

/**
 * The soundtrack is discovered by globbing `public/audio/music/<artist>/[<album>/]`
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
  const ALBUM = "Þrøngva/After the Winter of Want";

  it("reads artist, album and title from an album folder", () => {
    expect(toTrack(`${ALBUM}/003. Ironwood Oath.mp3`)).toEqual({
      file: `music/${ALBUM}/003. Ironwood Oath.mp3`,
      title: "Ironwood Oath",
      artist: "Þrøngva",
      album: "After the Winter of Want",
    });
  });

  it("drops the track number however many digits it has", () => {
    expect(toTrack(`${ALBUM}/015. The Wolf Called Want (Part 2).mp3`).title).toBe(
      "The Wolf Called Want (Part 2)",
    );
    expect(toTrack(`${ALBUM}/20. Valhalla on Loop.mp3`).title).toBe("Valhalla on Loop");
  });

  it("keeps a number that is part of the title", () => {
    // Only "<digits>. " at the start is a track number.
    expect(toTrack("Þrøngva/1999.mp3").title).toBe("1999");
  });

  it("still takes a song straight under the artist, with no album", () => {
    expect(toTrack("Þrøngva/More Than Enough.mp3")).toEqual({
      file: "music/Þrøngva/More Than Enough.mp3",
      title: "More Than Enough",
      artist: "Þrøngva",
    });
    expect(toTrack("Þrøngva/Loud.MP3").title).toBe("Loud");
  });

  it("falls back to the folder name for an unknown artist", () => {
    // A new artist should appear sensibly without needing a code change,
    // which is the whole point of globbing the directory.
    expect(toTrack("kaviran/dust-line.mp3").artist).toBe("Kaviran");
  });
});

describe("the shipped soundtrack", () => {
  // The real glob over public/audio/music, through the same plugin the build uses.
  it("finds every track on the album, including inside the album folder", () => {
    const album = SOUNDTRACK.filter((f) => f.startsWith("Þrøngva/After the Winter of Want/"));
    expect(album).toHaveLength(20);
    expect(SOUNDTRACK.every((f) => f.toLowerCase().endsWith(".mp3"))).toBe(true);
  });

  it("finds the second album, in track order, with titles from the lyric sheet", () => {
    const tracks = SOUNDTRACK.filter((f) => f.startsWith("Þrøngva/When the Ravens Lied/")).map(
      toTrack,
    );
    expect(tracks).toHaveLength(12);
    expect(tracks.every((t) => t.artist === "Þrøngva" && t.album === "When the Ravens Lied")).toBe(
      true,
    );
    expect(tracks.map((t) => t.title)).toEqual([
      "Huginn Brings the Word",
      "Who Fired First",
      "Loki's Mirror",
      "Merchant of the Long Knife",
      "Ledger of Ash",
      "Heimdall Does Not Sleep",
      "Same Rain on Both Shields",
      "Lower the Spear",
      "Muninn Remembers",
      "Longship Bounce",
      "Not Our Ragnarök",
      "True Dawn",
    ]);
  });

  it("no longer ships the old tracks", () => {
    expect(SOUNDTRACK.filter((f) => f.startsWith("throngva/"))).toEqual([]);
  });
});

describe("shuffled play order", () => {
  it("plays every track once before any repeats", () => {
    for (let run = 0; run < 50; run++) {
      const order = shuffledOrder(32);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    }
  });

  it("never starts a reshuffle with the track that just finished", () => {
    for (let last = 0; last < 32; last++) {
      for (let run = 0; run < 20; run++)
        expect(shuffledOrder(32, Math.random, last)[0]).not.toBe(last);
    }
  });

  it("mixes both albums rather than playing them in list order", () => {
    const tracks = SOUNDTRACK.map(toTrack);
    const firstHalfAlbums = new Set(
      shuffledOrder(tracks.length, () => 0.5)
        .slice(0, 12)
        .map((i) => tracks[i]?.album),
    );
    expect(firstHalfAlbums.size).toBe(2);
  });
});
