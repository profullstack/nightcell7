import { z } from "zod";
import { inputBatchSchema } from "./input";
import { CLIENT_PLATFORMS } from "./version";

/**
 * Non-state messages. Continuous player state travels through the Colyseus
 * schema in `state.ts`; this file covers discrete intents and events.
 */

// --------------------------------------------------------------------------
// Client -> server
// --------------------------------------------------------------------------

export const CLIENT_MESSAGE = {
  INPUT: "i",
  RELOAD: "r",
  SWITCH_WEAPON: "w",
  THROW_GRENADE: "g",
  INTERACT: "e",
  PING_MARK: "p",
  QUICK_MESSAGE: "q",
  READY: "ready",
  PONG: "pong",
} as const;

export type ClientMessageType = (typeof CLIENT_MESSAGE)[keyof typeof CLIENT_MESSAGE];

/**
 * Bounded quick-chat vocabulary. PRD §18.1 excludes voice and free-form text
 * from V1 specifically to keep the moderation surface small — this enum is the
 * entire vocabulary and must stay an enum.
 */
export const QUICK_MESSAGES = [
  "affirmative",
  "negative",
  "enemy_spotted",
  "need_backup",
  "regrouping",
  "good_game",
] as const;
export type QuickMessage = (typeof QUICK_MESSAGES)[number];

export const clientMessageSchemas = {
  [CLIENT_MESSAGE.INPUT]: inputBatchSchema,
  [CLIENT_MESSAGE.RELOAD]: z.object({ seq: z.number().int().nonnegative() }),
  [CLIENT_MESSAGE.SWITCH_WEAPON]: z.object({
    seq: z.number().int().nonnegative(),
    slot: z.number().int().min(0).max(3),
  }),
  [CLIENT_MESSAGE.THROW_GRENADE]: z.object({ seq: z.number().int().nonnegative() }),
  [CLIENT_MESSAGE.INTERACT]: z.object({
    seq: z.number().int().nonnegative(),
    targetId: z.string().max(64),
  }),
  [CLIENT_MESSAGE.PING_MARK]: z.object({
    // A world point the client is *looking at*; the server re-derives it from
    // authoritative aim and only uses this to disambiguate distance.
    distance: z.number().finite().min(0).max(200),
  }),
  [CLIENT_MESSAGE.QUICK_MESSAGE]: z.object({ message: z.enum(QUICK_MESSAGES) }),
  [CLIENT_MESSAGE.READY]: z.object({ ready: z.boolean() }),
  [CLIENT_MESSAGE.PONG]: z.object({ id: z.number().int().nonnegative() }),
} as const;

export type ClientMessagePayload<T extends ClientMessageType> = z.infer<
  (typeof clientMessageSchemas)[T]
>;

/**
 * Validate an untrusted inbound message. Returns a discriminated result rather
 * than throwing so the room can count violations per connection and rate-limit
 * a misbehaving client instead of crashing a tick.
 */
export function parseClientMessage<T extends ClientMessageType>(
  type: T,
  payload: unknown,
): { ok: true; data: ClientMessagePayload<T> } | { ok: false; error: string } {
  const schema = clientMessageSchemas[type];
  if (!schema) return { ok: false, error: `unknown_message_type:${String(type)}` };
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "invalid_payload" };
  }
  return { ok: true, data: result.data as ClientMessagePayload<T> };
}

// --------------------------------------------------------------------------
// Server -> client
// --------------------------------------------------------------------------

export const SERVER_MESSAGE = {
  /** Sent once on join: room identity, tick rate, the caller's session id. */
  WELCOME: "welcome",
  /** Last processed input sequence — drives client reconciliation. */
  ACK: "ack",
  /** Someone took damage. Cosmetic on the client; damage itself is in state. */
  HIT: "hit",
  KILL: "kill",
  RESPAWN: "respawn",
  MATCH_START: "match_start",
  MATCH_END: "match_end",
  /** A grenade left someone's hand. Clients simulate its flight themselves. */
  GRENADE_THROWN: "gt",
  GRENADE_EXPLODED: "gx",
  PING_MARK: "ping_mark",
  QUICK_MESSAGE: "quick_message",
  REJECTED: "rejected",
  PING: "ping",
} as const;

export type ServerMessageType = (typeof SERVER_MESSAGE)[keyof typeof SERVER_MESSAGE];

export interface WelcomePayload {
  sessionId: string;
  matchId: string;
  roomId: string;
  mapId: string;
  region: string;
  shard: string;
  tickRate: number;
  snapshotRate: number;
  protocolVersion: number;
  contentVersion: string;
  serverTimeMs: number;
}

export interface AckPayload {
  /** Highest input sequence the server has simulated for this player. */
  seq: number;
  /** Server tick the ack corresponds to. */
  tick: number;
  /** Echo of the client clock from that input, for round-trip estimation. */
  clientTimeMs: number;
}

export interface HitPayload {
  attackerSessionId: string;
  victimSessionId: string;
  damage: number;
  /** True when armour absorbed part of the damage — drives a different sound. */
  armorAbsorbed: boolean;
  headshot: boolean;
  /** Server tick of the hit, for late-joining spectacle only. */
  tick: number;
}

export interface KillPayload {
  attackerSessionId: string | null;
  victimSessionId: string;
  weaponId: string;
  headshot: boolean;
  respawnAtMs: number;
}

export interface RespawnPayload {
  sessionId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  tick: number;
}

export interface MatchEndPayload {
  matchId: string;
  winningTeam: number | null;
  reason: string;
  scores: Record<number, number>;
  durationMs: number;
}

/**
 * A thrown grenade.
 *
 * Deliberately *not* replicated per tick. The flight model in
 * `@nightcell7/multiplayer-sim` is deterministic and shared, so every client
 * can run it from this one message and arrive at the same place the server
 * does — which costs one packet per throw instead of a position for every
 * grenade on every snapshot (PRD §30.3, network budget).
 */
export interface GrenadeThrownPayload {
  grenadeId: string;
  ownerSessionId: string;
  team: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuseMs: number;
  tick: number;
}

export interface GrenadeExplodedPayload {
  grenadeId: string;
  ownerSessionId: string;
  x: number;
  y: number;
  z: number;
  /** Session ids the blast reached, for hit feedback. Damage itself is state. */
  victimSessionIds: string[];
  tick: number;
}

export interface RejectedPayload {
  code: string;
  detail?: string;
  /** Where to send the player to resolve it, e.g. an update page. */
  actionUrl?: string;
}

export interface PingMarkPayload {
  sessionId: string;
  team: number;
  x: number;
  y: number;
  z: number;
}

export interface QuickMessagePayload {
  sessionId: string;
  team: number;
  message: QuickMessage;
}

export interface ServerMessageMap {
  [SERVER_MESSAGE.WELCOME]: WelcomePayload;
  [SERVER_MESSAGE.ACK]: AckPayload;
  [SERVER_MESSAGE.HIT]: HitPayload;
  [SERVER_MESSAGE.KILL]: KillPayload;
  [SERVER_MESSAGE.RESPAWN]: RespawnPayload;
  [SERVER_MESSAGE.MATCH_START]: { startedAtMs: number };
  [SERVER_MESSAGE.MATCH_END]: MatchEndPayload;
  [SERVER_MESSAGE.GRENADE_THROWN]: GrenadeThrownPayload;
  [SERVER_MESSAGE.GRENADE_EXPLODED]: GrenadeExplodedPayload;
  [SERVER_MESSAGE.PING_MARK]: PingMarkPayload;
  [SERVER_MESSAGE.QUICK_MESSAGE]: QuickMessagePayload;
  [SERVER_MESSAGE.REJECTED]: RejectedPayload;
  [SERVER_MESSAGE.PING]: { id: number; serverTimeMs: number };
}

// --------------------------------------------------------------------------
// Handshake
// --------------------------------------------------------------------------

export const joinOptionsSchema = z.object({
  ticket: z.string().min(16).max(2048),
  buildVersion: z.string().min(1).max(64),
  protocolVersion: z.number().int().nonnegative(),
  contentVersion: z.string().min(1).max(32),
  platform: z.enum(CLIENT_PLATFORMS),
});

export type JoinOptions = z.infer<typeof joinOptionsSchema>;
