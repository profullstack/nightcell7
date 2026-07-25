import { z } from "zod";
import { MATCH_TERMINATION } from "./codes";

/**
 * Match result contract (browser-safe: schemas and types only).
 *
 * PRD §33.3: result persistence accepts only signed/internal events from the
 * owning match service, and duplicate result events are idempotent. The
 * `resultHash` is the idempotency key — the worker uses it to make a replayed
 * queue job a no-op rather than double-counting a player's kills.
 */

export const matchPlayerResultSchema = z.object({
  userId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(32),
  team: z.number().int().min(0).max(8),
  isBot: z.boolean(),
  joinedAtMs: z.number().int().nonnegative(),
  leftAtMs: z.number().int().nonnegative().nullable(),
  reconnectCount: z.number().int().nonnegative(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  score: z.number().int(),
  result: z.enum(["win", "loss", "draw", "abandoned"]),
});

export type MatchPlayerResult = z.infer<typeof matchPlayerResultSchema>;

export const matchResultSchema = z.object({
  matchId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  mode: z.string().min(1).max(32),
  mapId: z.string().min(1).max(64),
  regionId: z.string().min(1).max(32),
  shardId: z.string().min(1).max(16),
  protocolVersion: z.number().int().nonnegative(),
  buildVersion: z.string().min(1).max(64),
  startedAtMs: z.number().int().nonnegative(),
  endedAtMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  winningTeam: z.number().int().nullable(),
  terminationReason: z.nativeEnum(MATCH_TERMINATION),
  teamScores: z.record(z.string(), z.number().int()),
  players: z.array(matchPlayerResultSchema).max(24),
});

export type MatchResult = z.infer<typeof matchResultSchema>;

/** Envelope the match service publishes onto the worker queue. */
export interface MatchResultEvent {
  result: MatchResult;
  resultHash: string;
  /** HMAC over `resultHash`, proving the event came from a match process. */
  signature: string;
  emittedAtMs: number;
}
