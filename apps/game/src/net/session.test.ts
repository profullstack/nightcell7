import { describe, expect, it } from "vitest";
import {
  OnlineSession,
  describeApiError,
  normalizePrivateCode,
  privateMatchLink,
  signInHref,
} from "./session";

describe("online session helpers", () => {
  it("normalises a typed private code and rejects impossible ones", () => {
    expect(normalizePrivateCode(" abc-23x ")).toBe("ABC23X");
    // 0, O, 1 and I are not in the API's alphabet.
    expect(normalizePrivateCode("ABC0O1")).toBeNull();
    expect(normalizePrivateCode("AB")).toBeNull();
  });

  it("builds the share link and the sign-in round trip", () => {
    expect(privateMatchLink("https://nightcell7.com", "ABC234")).toBe(
      "https://nightcell7.com/play/?mode=multiplayer&code=ABC234",
    );
    expect(signInHref("/play/?mode=multiplayer&match=quick")).toBe(
      "/login?next=%2Fplay%2F%3Fmode%3Dmultiplayer%26match%3Dquick",
    );
  });

  it("turns API failures into something a player can act on", () => {
    expect(describeApiError(401, "unauthorized", "x")).toMatchObject({ signIn: true });
    expect(describeApiError(403, "verification_required", "Verify your email.")).toEqual({
      code: "verification_required",
      message: "Verify your email.",
      signIn: false,
    });
    expect(describeApiError(429, undefined, undefined).message).toMatch(/Too many/);
  });

  it("goes ticket -> error without touching the network client on a refused ticket", async () => {
    const seen: string[] = [];
    const session = new OnlineSession({
      buildVersion: "test",
      platform: "web",
      fetch: async () =>
        new Response(
          JSON.stringify({ error: { code: "verification_required", message: "Verify." } }),
          { status: 403 },
        ),
      createClient: () => {
        throw new Error("must not connect without a ticket");
      },
    });
    session.onStatus((s) => seen.push(s.kind));
    await session.quickMatch();
    expect(seen).toEqual(["ticket", "error"]);
    expect(session.status).toMatchObject({ code: "verification_required", signIn: false });
  });

  it("refuses a malformed code before asking for a ticket", async () => {
    let calls = 0;
    const session = new OnlineSession({
      buildVersion: "test",
      platform: "web",
      fetch: async () => {
        calls += 1;
        return new Response("{}");
      },
    });
    await session.joinPrivate("??");
    expect(calls).toBe(0);
    expect(session.status).toMatchObject({ kind: "error", code: "bad_code" });
  });
});
