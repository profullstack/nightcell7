import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { MatchResult, MatchResultEvent } from "./results";

/**
 * Server-only protocol helpers.
 *
 * Imported as `@nightcell7/multiplayer-protocol/server`. Kept out of the main
 * entry point so `node:crypto` can never be pulled into a browser bundle.
 */
export * from "./ticket";

/**
 * Stable content hash of a completed match. Bot rows are included: two matches
 * that differ only in bot performance are still different matches.
 *
 * This is the idempotency key for result persistence (PRD §33.3).
 */
export function computeResultHash(result: MatchResult): string {
  const canonical = JSON.stringify({
    matchId: result.matchId,
    startedAtMs: result.startedAtMs,
    endedAtMs: result.endedAtMs,
    terminationReason: result.terminationReason,
    winningTeam: result.winningTeam,
    players: [...result.players]
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .map((p) => [p.userId, p.team, p.kills, p.deaths, p.assists, p.score, p.result]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Sign a match result so the worker can prove it came from a match process and
 * not from a client or a stray queue producer.
 */
export function signMatchResult(
  result: MatchResult,
  secret: string,
  emittedAtMs: number,
): MatchResultEvent {
  const resultHash = computeResultHash(result);
  return {
    result,
    resultHash,
    signature: createHmac("sha256", secret).update(resultHash).digest("base64url"),
    emittedAtMs,
  };
}

export function verifyMatchResult(event: MatchResultEvent, secret: string): boolean {
  const recomputed = computeResultHash(event.result);
  if (recomputed !== event.resultHash) return false;
  const expected = createHmac("sha256", secret).update(recomputed).digest("base64url");
  const a = Buffer.from(event.signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
