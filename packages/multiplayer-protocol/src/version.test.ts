import { describe, expect, it } from "vitest";
import {
  CLIENT_MESSAGE,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  SERVER_MESSAGE,
  clientMessageSchemas,
  isContentCompatible,
  isProtocolCompatible,
  CONTENT_VERSION,
} from "./index";

/**
 * Client/server compatibility, which CLAUDE.md requires alongside any protocol
 * change.
 *
 * The rule these guard is not "the number went up" — it is that a client and a
 * server which disagree about the gameplay contract must never end up in the
 * same room. Grenades made that concrete: `CLIENT_MESSAGE.THROW_GRENADE`
 * existed in v1 and did nothing, so the message set alone never changed in a
 * way a version check could see. What changed was the *behaviour* — a v1
 * client would take blast damage it can neither cause nor render.
 */

describe("protocol compatibility", () => {
  it("admits its own version", () => {
    expect(isProtocolCompatible(PROTOCOL_VERSION)).toBe(true);
  });

  it("refuses a client from the future", () => {
    expect(isProtocolCompatible(PROTOCOL_VERSION + 1)).toBe(false);
  });

  it("refuses anything below the supported window", () => {
    expect(isProtocolCompatible(MIN_SUPPORTED_PROTOCOL_VERSION - 1)).toBe(false);
  });

  it("refuses a version that is not an integer at all", () => {
    // These arrive from an untrusted join payload, not from our own code.
    for (const value of [Number.NaN, 1.5, Infinity, -1]) {
      expect(isProtocolCompatible(value), `accepted ${value}`).toBe(false);
    }
  });

  it("keeps the supported window closed while grenades are asymmetric", () => {
    // Grenades deal damage a v1 client cannot cause, see or avoid, so the
    // window is deliberately shut rather than left open for a smoother deploy.
    // If a later change reopens it, that has to be a deliberate edit here.
    expect(MIN_SUPPORTED_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
  });

  it("pins the content version to an exact match", () => {
    expect(isContentCompatible(CONTENT_VERSION)).toBe(true);
    expect(isContentCompatible(`${CONTENT_VERSION}-dev`)).toBe(false);
  });
});

describe("grenade messages", () => {
  it("carries a throw channel with a schema on both sides", () => {
    expect(CLIENT_MESSAGE.THROW_GRENADE).toBeDefined();
    expect(clientMessageSchemas[CLIENT_MESSAGE.THROW_GRENADE]).toBeDefined();
    expect(SERVER_MESSAGE.GRENADE_THROWN).toBeDefined();
    expect(SERVER_MESSAGE.GRENADE_EXPLODED).toBeDefined();
  });

  it("accepts a throw request and nothing more", () => {
    const schema = clientMessageSchemas[CLIENT_MESSAGE.THROW_GRENADE];
    expect(schema.safeParse({ seq: 12 }).success).toBe(true);

    // Deliberately no position, direction or count: the server derives all
    // three (PRD §18.3). A client that tries to supply them is not honoured.
    const extra = schema.safeParse({ seq: 12, x: 999, count: 99 });
    expect(extra.success).toBe(true);
    expect(extra.success && "x" in extra.data).toBe(false);
  });

  it("rejects a malformed sequence number", () => {
    const schema = clientMessageSchemas[CLIENT_MESSAGE.THROW_GRENADE];
    expect(schema.safeParse({ seq: -1 }).success).toBe(false);
    expect(schema.safeParse({ seq: "3" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("gives every server message a distinct wire code", () => {
    // Two messages sharing a code silently routes one to the other's handler.
    const codes = Object.values(SERVER_MESSAGE);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every client message a distinct wire code", () => {
    const codes = Object.values(CLIENT_MESSAGE);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
