import { describe, expect, it } from "vitest";
import { EPISODE, MISSION } from "@nightcell7/game-core";
import {
  ANONYMOUS,
  PLAY_MODE,
  canPlayMission,
  decideAccess,
  loadViewer,
  parseMode,
  type Viewer,
} from "./access";

const VERIFIED: Viewer = { authenticated: true, verified: true, entitledEpisodes: [] };
const UNVERIFIED: Viewer = { authenticated: true, verified: false, entitledEpisodes: [] };
const OWNER: Viewer = {
  authenticated: true,
  verified: true,
  entitledEpisodes: [EPISODE.FALSE_DAWN],
};

describe("play mode parsing", () => {
  it("reads a known mode from the query string", () => {
    expect(parseMode("?mode=demo")).toBe(PLAY_MODE.DEMO);
    expect(parseMode("?mode=multiplayer")).toBe(PLAY_MODE.MULTIPLAYER);
    expect(parseMode("?mode=campaign")).toBe(PLAY_MODE.CAMPAIGN);
  });

  it("falls back to the free sandbox for anything else", () => {
    expect(parseMode("")).toBe(PLAY_MODE.SANDBOX);
    expect(parseMode("?mode=")).toBe(PLAY_MODE.SANDBOX);
    // An unknown mode must not accidentally unlock paid content.
    expect(parseMode("?mode=campaign-pro")).toBe(PLAY_MODE.SANDBOX);
  });
});

describe("the demo never needs an account", () => {
  it("lets an anonymous visitor play the demo and the sandbox", () => {
    expect(decideAccess(PLAY_MODE.DEMO, ANONYMOUS)).toEqual({ allowed: true });
    expect(decideAccess(PLAY_MODE.SANDBOX, ANONYMOUS)).toEqual({ allowed: true });
  });

  it("allows demo missions anonymously", () => {
    expect(canPlayMission(MISSION.ROOK_DEAD_DROP, ANONYMOUS).allowed).toBe(true);
    expect(canPlayMission(MISSION.LEILA_COUNTER_SIGNAL, ANONYMOUS).allowed).toBe(true);
  });
});

describe("the real game needs an account", () => {
  it("blocks campaign and multiplayer for an anonymous visitor", () => {
    for (const mode of [PLAY_MODE.CAMPAIGN, PLAY_MODE.MULTIPLAYER] as const) {
      const decision = decideAccess(mode, ANONYMOUS);
      expect(decision.allowed, mode).toBe(false);
      if (decision.allowed) continue;
      expect(decision.reason).toBe("account_required");
      // Always offers a way to keep playing rather than a dead end.
      expect(decision.actions.some((a) => a.href === "/play?mode=demo")).toBe(true);
    }
  });

  it("blocks a paid mission for an anonymous visitor", () => {
    const decision = canPlayMission(MISSION.ROOK_BLACK_RELAY, ANONYMOUS);
    expect(decision.allowed).toBe(false);
  });

  it("requires verification for multiplayer specifically", () => {
    const decision = decideAccess(PLAY_MODE.MULTIPLAYER, UNVERIFIED);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("verification_required");
  });

  it("lets a verified account into multiplayer without owning anything", () => {
    // Multiplayer is free; owning an episode is irrelevant to it (PRD §5.4).
    expect(decideAccess(PLAY_MODE.MULTIPLAYER, VERIFIED)).toEqual({ allowed: true });
  });

  it("requires an entitlement for the campaign, even when verified", () => {
    const decision = decideAccess(PLAY_MODE.CAMPAIGN, VERIFIED);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("entitlement_required");
  });

  it("lets an owner play the campaign", () => {
    expect(decideAccess(PLAY_MODE.CAMPAIGN, OWNER)).toEqual({ allowed: true });
  });

  it("does not let an entitlement for one episode unlock another", () => {
    const decision = decideAccess(PLAY_MODE.CAMPAIGN, OWNER, "some-other-episode");
    expect(decision.allowed).toBe(false);
  });
});

describe("viewer lookup", () => {
  function jsonResponse(body: unknown, ok = true) {
    return { ok, json: async () => body } as unknown as Response;
  }

  it("reports an anonymous viewer when the API says so", async () => {
    const viewer = await loadViewer(async () => jsonResponse({ authenticated: false }));
    expect(viewer).toEqual(ANONYMOUS);
  });

  it("collects only active entitlements", async () => {
    const viewer = await loadViewer(async (url) => {
      if (String(url).includes("entitlements")) {
        return jsonResponse({
          entitlements: [
            { episodeId: "false-dawn", active: true },
            { episodeId: "revoked-one", active: false },
          ],
        });
      }
      return jsonResponse({ authenticated: true, verified: true });
    });

    expect(viewer.authenticated).toBe(true);
    expect(viewer.entitledEpisodes).toEqual(["false-dawn"]);
  });

  it("degrades to anonymous when the API is unreachable", async () => {
    // Locks paid content rather than taking the free demo down with it.
    const viewer = await loadViewer(async () => {
      throw new Error("network down");
    });
    expect(viewer).toEqual(ANONYMOUS);
    expect(decideAccess(PLAY_MODE.DEMO, viewer)).toEqual({ allowed: true });
  });

  it("degrades to anonymous on a non-ok response", async () => {
    const viewer = await loadViewer(async () => jsonResponse({}, false));
    expect(viewer).toEqual(ANONYMOUS);
  });
});
