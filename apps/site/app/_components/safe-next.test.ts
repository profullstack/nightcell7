import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("returns a same-origin path, query intact", () => {
    expect(safeNext("?next=%2Fplay%2F%3Fmode%3Dmultiplayer%26match%3Dquick")).toBe(
      "/play/?mode=multiplayer&match=quick",
    );
  });

  it("refuses anything that leaves the origin", () => {
    for (const next of [
      "https://evil.test/",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
    ]) {
      expect(safeNext(`?next=${encodeURIComponent(next)}`)).toBeNull();
    }
    expect(safeNext("")).toBeNull();
  });

  it("refuses tab and newline tricks a browser would turn into //host", () => {
    for (const raw of ["/%09/evil.test", "/%0a/evil.test", "/%0d%0a/evil.test", "/a\\b"]) {
      expect(safeNext(`?next=${raw}`)).toBeNull();
    }
  });
});
