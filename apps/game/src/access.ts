import { DEMO_MISSIONS, EPISODE, type MissionId } from "@nightcell7/game-core";

/**
 * Who may play what.
 *
 * PRD §23.1 draws the line: browsing, the demo, the benchmark and settings need
 * no account; online multiplayer needs a *verified* account; paid campaign
 * content needs an entitlement.
 *
 * Kept as a pure function so the rule is testable and identical wherever it is
 * asked — the boot screen, a mission select, and any future launcher all get
 * the same answer instead of each inventing one.
 */

export const PLAY_MODE = {
  /** Free opening from either side. No account. */
  DEMO: "demo",
  /** Paid campaign. Needs an account and an entitlement. */
  CAMPAIGN: "campaign",
  /** Free 6v6 alpha. Needs a verified account. */
  MULTIPLAYER: "multiplayer",
  /** Free technical scene: benchmark, training, greybox. No account. */
  SANDBOX: "sandbox",
} as const;

export type PlayMode = (typeof PLAY_MODE)[keyof typeof PLAY_MODE];

export function parseMode(search: string): PlayMode {
  const value = new URLSearchParams(search).get("mode");
  switch (value) {
    case PLAY_MODE.DEMO:
    case PLAY_MODE.CAMPAIGN:
    case PLAY_MODE.MULTIPLAYER:
      return value;
    default:
      // A bare /play is the sandbox, so the greybox stays openable by anyone.
      return PLAY_MODE.SANDBOX;
  }
}

export interface Viewer {
  authenticated: boolean;
  verified: boolean;
  /** Episode ids the viewer owns with an active entitlement. */
  entitledEpisodes: readonly string[];
}

export const ANONYMOUS: Viewer = {
  authenticated: false,
  verified: false,
  entitledEpisodes: [],
};

export type AccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "account_required" | "verification_required" | "entitlement_required";
      title: string;
      detail: string;
      actions: { label: string; href: string; primary?: boolean }[];
    };

export function decideAccess(
  mode: PlayMode,
  viewer: Viewer,
  episodeId: string = EPISODE.FALSE_DAWN,
): AccessDecision {
  // Free and anonymous by design. Requiring an account here would be the one
  // change most likely to stop someone ever trying the game.
  if (mode === PLAY_MODE.DEMO || mode === PLAY_MODE.SANDBOX) return { allowed: true };

  if (!viewer.authenticated) {
    return {
      allowed: false,
      reason: "account_required",
      title: "An account is required",
      detail:
        mode === PLAY_MODE.MULTIPLAYER
          ? "Multiplayer is free, but it needs a verified account so bans, reports and match records mean something."
          : "Sign in to play the campaign you own.",
      actions: [
        { label: "Sign in", href: "/login", primary: true },
        { label: "Create a free account", href: "/register" },
        { label: "Play the demo instead", href: "/play?mode=demo" },
      ],
    };
  }

  if (mode === PLAY_MODE.MULTIPLAYER && !viewer.verified) {
    return {
      allowed: false,
      reason: "verification_required",
      title: "Verify your email",
      detail:
        "Multiplayer needs a verified address. Check your inbox — it is one click, and it is not a paywall.",
      actions: [
        { label: "How verification works", href: "/verify-email", primary: true },
        { label: "Play the demo instead", href: "/play?mode=demo" },
      ],
    };
  }

  if (mode === PLAY_MODE.CAMPAIGN && !viewer.entitledEpisodes.includes(episodeId)) {
    return {
      allowed: false,
      reason: "entitlement_required",
      title: "You do not own this episode",
      detail:
        "One purchase covers both campaigns, the Complete Truth epilogue and every supported platform.",
      actions: [
        { label: "See Episode 1", href: `/episodes/${episodeId}`, primary: true },
        { label: "Play the demo instead", href: "/play?mode=demo" },
      ],
    };
  }

  return { allowed: true };
}

/** Whether a specific mission may start, for a future mission-select screen. */
export function canPlayMission(mission: MissionId, viewer: Viewer, episodeId = EPISODE.FALSE_DAWN) {
  if (DEMO_MISSIONS.includes(mission)) return decideAccess(PLAY_MODE.DEMO, viewer, episodeId);
  return decideAccess(PLAY_MODE.CAMPAIGN, viewer, episodeId);
}

/**
 * Ask the API who the viewer is.
 *
 * Never throws: a failed lookup degrades to anonymous, so an API blip locks
 * paid content rather than taking the free demo down with it.
 */
export async function loadViewer(fetchImpl: typeof fetch = fetch): Promise<Viewer> {
  try {
    const me = await fetchImpl("/api/v1/me", { credentials: "include", cache: "no-store" });
    if (!me.ok) return ANONYMOUS;
    const body = (await me.json()) as { authenticated?: boolean; verified?: boolean };
    if (!body.authenticated) return ANONYMOUS;

    let entitledEpisodes: string[] = [];
    const owned = await fetchImpl("/api/v1/me/entitlements", {
      credentials: "include",
      cache: "no-store",
    });
    if (owned.ok) {
      const data = (await owned.json()) as {
        entitlements?: { episodeId: string; active: boolean }[];
      };
      entitledEpisodes = (data.entitlements ?? []).filter((e) => e.active).map((e) => e.episodeId);
    }

    return { authenticated: true, verified: body.verified === true, entitledEpisodes };
  } catch {
    return ANONYMOUS;
  }
}
