import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs, run by node in production; no declarations.
import { createGameServer, parseRange } from "./game-static.mjs";

/**
 * The production game file server. Its first version never percent-decoded
 * the URL, so every album track (spaces, and a Þ in the artist folder) got
 * `index.html` with a 200 and no track played.
 */
const ALBUM = "audio/music/Þrøngva/After the Winter of Want";
const TRACK = `${ALBUM}/001. Frost on the Oar.mp3`;
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

let dir: string;
let dist: string;
let base: string;
let server: ReturnType<typeof createGameServer>;

const encoded = (p: string) => p.split("/").map(encodeURIComponent).join("/");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nc7-static-"));
  dist = join(dir, "dist");
  mkdirSync(join(dist, ALBUM), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(dist, TRACK), BYTES);
  // A sibling a bare prefix check would wrongly admit.
  mkdirSync(join(dir, "dist-old"));
  writeFileSync(join(dir, "dist-old", "secret.txt"), "secret");

  server = createGameServer(dist);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("game static server", () => {
  it("serves a track whose path has spaces and non-ASCII letters", async () => {
    const res = await fetch(`${base}/play/${encoded(TRACK)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true);
  });

  it("answers a byte range with 206 and just those bytes", async () => {
    const res = await fetch(`${base}/play/${encoded(TRACK)}`, {
      headers: { range: "bytes=100-199" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(100, 200))).toBe(true);
  });

  it("rejects a range past the end with 416", async () => {
    const res = await fetch(`${base}/play/${encoded(TRACK)}`, {
      headers: { range: "bytes=5000-" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */1000");
  });

  it("still falls back to the shell for an unknown route", async () => {
    const res = await fetch(`${base}/play/some/client/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>shell</title>");
  });

  it("does not let decoding open a path out of dist", async () => {
    const res = await fetch(`${base}/play/%2e%2e%2fdist-old%2fsecret.txt`);
    expect(res.status).toBe(403);
  });

  it("rejects malformed percent-encoding", async () => {
    const res = await fetch(`${base}/play/%E0%A4%A`);
    expect(res.status).toBe(400);
  });
});

describe("parseRange", () => {
  it("reads open, closed and suffix ranges", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("bytes=0-", 1000)).toEqual([0, 999]);
    expect(parseRange("bytes=10-19", 1000)).toEqual([10, 19]);
    expect(parseRange("bytes=-100", 1000)).toEqual([900, 999]);
    expect(parseRange("bytes=990-5000", 1000)).toEqual([990, 999]);
  });

  it("refuses what cannot be satisfied", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("invalid");
    expect(parseRange("bytes=20-10", 1000)).toBe("invalid");
    expect(parseRange("bytes=-", 1000)).toBe("invalid");
  });
});
