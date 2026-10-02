import {
  CONTENT_VERSION,
  MATCH_PHASE,
  PROTOCOL_VERSION,
  type ClientPlatform,
  type MatchEndPayload,
  type MatchState,
  type RejectedPayload,
  type WelcomePayload,
} from "@nightcell7/multiplayer-protocol";
import { TDM_RULES } from "@nightcell7/game-core";
import { NetClient, type NetClientEvents } from "./client";

/**
 * The online entry point: ticket, join, and the states a player sees while it
 * happens.
 *
 * DOM-free on purpose, so the same flow the gate drives can be driven by an
 * integration test against the real API, gateway and match server.
 */

export type OnlineStatus =
  | { kind: "idle" }
  | { kind: "ticket"; lobby: string }
  | { kind: "connecting"; lobby: string }
  | { kind: "waiting"; lobby: string; humans: number; bots: number }
  | { kind: "live"; lobby: string; humans: number; bots: number }
  | { kind: "ended"; lobby: string; result: MatchEndPayload | null }
  | { kind: "disconnected"; lobby: string; code: number }
  | { kind: "error"; code: string; message: string; signIn: boolean };

export type Lobby = { kind: "quick" } | { kind: "private"; code: string };

export interface OnlineSessionOptions {
  /** Same-origin by default. The desktop shell loads the production origin, so "" is right there too. */
  apiBase?: string;
  fetch?: typeof fetch;
  buildVersion: string;
  platform: ClientPlatform;
  /** 0 Nightcell, 1 Directorate. The server balances; this is a preference. */
  preferredTeam?: () => number | undefined;
  /** Forwarded from the match room to whoever renders it. */
  events?: NetClientEvents;
  /** Test seam: the client the session joins with. */
  createClient?: (events: NetClientEvents) => NetClient;
}

/** The alphabet the API mints private codes from (no 0/O, 1/I). */
const PRIVATE_CODE = /^[A-HJ-NP-Z2-9]{4,12}$/;

/** Uppercase, strip spaces and dashes; null when what is left cannot be a code. */
export function normalizePrivateCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return PRIVATE_CODE.test(code) ? code : null;
}

/** The shareable link for a private match. `/play/` is where the game is served. */
export function privateMatchLink(origin: string, code: string): string {
  return `${origin}/play/?mode=multiplayer&code=${encodeURIComponent(code)}`;
}

/** Where a signed-out player goes, and comes back from. */
export function signInHref(returnTo: string): string {
  return `/login?next=${encodeURIComponent(returnTo)}`;
}

/** A failed API call, in words a player can act on. */
export function describeApiError(
  status: number,
  code: string | undefined,
  message: string | undefined,
): { code: string; message: string; signIn: boolean } {
  if (status === 401) {
    return { code: "unauthorized", message: "Sign in to play online.", signIn: true };
  }
  if (status === 429) {
    return {
      code: code ?? "rate_limited",
      message: "Too many attempts. Wait a few seconds and try again.",
      signIn: false,
    };
  }
  if (status === 426) {
    return {
      code: code ?? "update_required",
      message: message ?? "This build is out of date. Reload the page to update.",
      signIn: false,
    };
  }
  return {
    code: code ?? `http_${status}`,
    message: message ?? `Matchmaking failed (${status}). Try again.`,
    signIn: false,
  };
}

function lobbyName(lobby: Lobby): string {
  return lobby.kind === "quick" ? "quick" : `private_${lobby.code}`;
}

export class OnlineSession {
  private client?: NetClient;
  private current: OnlineStatus = { kind: "idle" };
  private listeners = new Set<(status: OnlineStatus) => void>();
  private lastLobby: Lobby | null = null;
  private matchResult: MatchEndPayload | null = null;
  private welcome: WelcomePayload | null = null;
  private attempt = 0;

  constructor(private readonly options: OnlineSessionOptions) {}

  get status(): OnlineStatus {
    return this.current;
  }

  get net(): NetClient | undefined {
    return this.client;
  }

  get sessionId(): string {
    return this.welcome?.sessionId ?? "";
  }

  /** The Colyseus room this session is in, once welcomed. */
  get roomId(): string {
    return this.welcome?.roomId ?? "";
  }

  get lobby(): Lobby | null {
    return this.lastLobby;
  }

  onStatus(listener: (status: OnlineStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  quickMatch(): Promise<void> {
    return this.join({ kind: "quick" });
  }

  /** Ask the API for a fresh private code, then join its lobby as the host. */
  async createPrivate(): Promise<string | null> {
    this.set({ kind: "ticket", lobby: "private" });
    const response = await this.post("/api/v1/multiplayer/private-matches", {});
    if (!response) return null;
    const code = normalizePrivateCode(String((response as { code?: string }).code ?? ""));
    if (!code) {
      this.set({
        kind: "error",
        code: "bad_code",
        message: "The server sent an invalid code.",
        signIn: false,
      });
      return null;
    }
    await this.join({ kind: "private", code });
    return code;
  }

  joinPrivate(input: string): Promise<void> {
    const code = normalizePrivateCode(input);
    if (!code) {
      this.set({
        kind: "error",
        code: "bad_code",
        message: "That is not a match code. Codes are 6 letters and digits.",
        signIn: false,
      });
      return Promise.resolve();
    }
    return this.join({ kind: "private", code });
  }

  /** Same lobby again, with a new ticket (tickets are single use). */
  retry(): Promise<void> {
    return this.join(this.lastLobby ?? { kind: "quick" });
  }

  async join(lobby: Lobby): Promise<void> {
    const attempt = (this.attempt += 1);
    await this.close();
    this.lastLobby = lobby;
    this.matchResult = null;
    this.welcome = null;
    const name = lobbyName(lobby);

    this.set({ kind: "ticket", lobby: name });
    const ticket = (await this.post("/api/v1/multiplayer/tickets", {
      mode: TDM_RULES.mode,
      buildVersion: this.options.buildVersion,
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      ...(lobby.kind === "private" ? { privateCode: lobby.code } : {}),
      ...(this.options.preferredTeam?.() !== undefined
        ? { preferredTeam: this.options.preferredTeam() }
        : {}),
    })) as { websocketUrl?: string } | null;
    if (!ticket || attempt !== this.attempt) return;
    if (!ticket.websocketUrl) {
      this.set({
        kind: "error",
        code: "no_url",
        message: "Matchmaking returned no server.",
        signIn: false,
      });
      return;
    }

    this.set({ kind: "connecting", lobby: name });
    const forward = this.options.events ?? {};
    const events: NetClientEvents = {
      onWelcome: (payload) => {
        this.welcome = payload;
        forward.onWelcome?.(payload);
        this.refresh();
      },
      onKill: (payload) => forward.onKill?.(payload),
      onHit: (payload) => forward.onHit?.(payload),
      onRespawn: (payload) => forward.onRespawn?.(payload),
      onMatchEnd: (payload) => {
        this.matchResult = payload;
        forward.onMatchEnd?.(payload);
        this.set({ kind: "ended", lobby: name, result: payload });
      },
      onRejected: (payload: RejectedPayload) => forward.onRejected?.(payload),
      onDisconnected: (code) => {
        forward.onDisconnected?.(code);
        if (attempt !== this.attempt) return;
        this.client = undefined;
        // After a match end the room closes on its own; that is not a fault.
        if (this.current.kind === "ended") return;
        this.set({ kind: "disconnected", lobby: name, code });
      },
    };
    const client = this.options.createClient?.(events) ?? new NetClient(events);
    try {
      await client.join({
        websocketUrl: ticket.websocketUrl,
        buildVersion: this.options.buildVersion,
        platform: this.options.platform,
      });
    } catch (error) {
      if (attempt !== this.attempt) return;
      const message = error instanceof Error ? error.message : String(error);
      this.set({
        kind: "error",
        code: "join_failed",
        message: `Could not join the match: ${message}`,
        signIn: false,
      });
      return;
    }
    if (attempt !== this.attempt) {
      await client.leave();
      return;
    }
    this.client = client;
    this.refresh();
  }

  /**
   * Re-derive waiting/live from the room state. Cheap; the game calls it every
   * frame and listeners only hear about a change.
   */
  refresh(): void {
    const state: MatchState | undefined = this.client?.state;
    const kind = this.current.kind;
    if (!state || !this.welcome) return;
    if (kind !== "connecting" && kind !== "waiting" && kind !== "live") return;
    let humans = 0;
    let bots = 0;
    state.players.forEach((player) => {
      if (player.isBot) bots += 1;
      else humans += 1;
    });
    const lobby = this.current.lobby;
    if (state.phase === MATCH_PHASE.ENDED) {
      this.set({ kind: "ended", lobby, result: this.matchResult });
    } else if (state.phase === MATCH_PHASE.LIVE) {
      this.set({ kind: "live", lobby, humans, bots });
    } else {
      this.set({ kind: "waiting", lobby, humans, bots });
    }
  }

  /** Leave on purpose: no "disconnected" state, no retry prompt. */
  async leave(): Promise<void> {
    this.attempt += 1;
    await this.close();
  }

  private async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client) await client.leave().catch(() => undefined);
    if (this.current.kind !== "error") this.set({ kind: "idle" });
  }

  private set(next: OnlineStatus): void {
    const prev = this.current;
    this.current = next;
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    for (const listener of this.listeners) listener(next);
  }

  private async post(path: string, body: unknown): Promise<unknown | null> {
    const fetchImpl = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(`${this.options.apiBase ?? ""}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      this.set({
        kind: "error",
        code: "network",
        message: "Could not reach the server. Check your connection and try again.",
        signIn: false,
      });
      return null;
    }
    const data = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!response.ok) {
      this.set({
        kind: "error",
        ...describeApiError(response.status, data.error?.code, data.error?.message),
      });
      return null;
    }
    return data;
  }
}
