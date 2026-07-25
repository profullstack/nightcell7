import { eq, sql } from "drizzle-orm";
import {
  multiplayerMatchPlayers,
  multiplayerMatches,
  multiplayerProfiles,
  type Database,
} from "@nightcell7/database";
import { verifyMatchResult } from "@nightcell7/multiplayer-protocol/server";
import type { MatchResultEvent } from "@nightcell7/multiplayer-protocol";
import { isRankableTermination } from "@nightcell7/multiplayer-protocol";
import type { Logger } from "@nightcell7/observability";

/**
 * Persist a completed match exactly once (PRD §18.9 step 12, §33.3).
 *
 * Two guards, both required:
 *   1. the event must be signed by a match process — a client or a stray queue
 *      producer cannot write match history;
 *   2. the result hash is unique in the database, so a retried job is a no-op.
 */

export type MatchResultOutcome = "persisted" | "duplicate" | "rejected_signature" | "not_rankable";

export async function processMatchResult(
  db: Database,
  logger: Logger,
  event: MatchResultEvent,
  secret: string,
): Promise<MatchResultOutcome> {
  if (!verifyMatchResult(event, secret)) {
    logger.error("rejected unsigned match result", { matchId: event.result.matchId });
    return "rejected_signature";
  }

  const { result } = event;

  const existing = await db
    .select({ id: multiplayerMatches.id })
    .from(multiplayerMatches)
    .where(eq(multiplayerMatches.resultHash, event.resultHash))
    .limit(1);
  if (existing.length > 0) {
    logger.info("duplicate match result ignored", { matchId: result.matchId });
    return "duplicate";
  }

  await db.insert(multiplayerMatches).values({
    id: result.matchId,
    mode: result.mode,
    mapId: result.mapId,
    regionId: result.regionId,
    shardId: result.shardId,
    roomId: result.roomId,
    protocolVersion: result.protocolVersion,
    buildVersion: result.buildVersion,
    status: "completed",
    startedAt: new Date(result.startedAtMs).toISOString(),
    endedAt: new Date(result.endedAtMs).toISOString(),
    durationMs: result.durationMs,
    winningTeam: result.winningTeam,
    terminationReason: result.terminationReason,
    resultHash: event.resultHash,
  });

  for (const player of result.players) {
    await db.insert(multiplayerMatchPlayers).values({
      matchId: result.matchId,
      userId: player.userId,
      team: player.team,
      isBot: player.isBot,
      joinedAt: new Date(player.joinedAtMs).toISOString(),
      leftAt: player.leftAtMs ? new Date(player.leftAtMs).toISOString() : null,
      reconnectCount: player.reconnectCount,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      score: player.score,
      result: player.result,
      reportableSessionId: `${result.matchId}:${player.userId}`,
    });
  }

  // An aborted match must not count as a win or a loss (PRD §18.10). Rows are
  // still written so a report can reference the match.
  if (!isRankableTermination(result.terminationReason)) {
    logger.info("match recorded but not counted", {
      matchId: result.matchId,
      reason: result.terminationReason,
    });
    return "not_rankable";
  }

  for (const player of result.players) {
    if (player.isBot) continue; // bots never consume a user account
    await db
      .insert(multiplayerProfiles)
      .values({
        userId: player.userId,
        displayNameSnapshot: player.displayName,
        matchesPlayed: 1,
        wins: player.result === "win" ? 1 : 0,
        losses: player.result === "loss" ? 1 : 0,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        lastMatchAt: new Date(result.endedAtMs).toISOString(),
      })
      .onConflictDoUpdate({
        target: multiplayerProfiles.userId,
        set: {
          displayNameSnapshot: player.displayName,
          matchesPlayed: sql`${multiplayerProfiles.matchesPlayed} + 1`,
          wins: sql`${multiplayerProfiles.wins} + ${player.result === "win" ? 1 : 0}`,
          losses: sql`${multiplayerProfiles.losses} + ${player.result === "loss" ? 1 : 0}`,
          kills: sql`${multiplayerProfiles.kills} + ${player.kills}`,
          deaths: sql`${multiplayerProfiles.deaths} + ${player.deaths}`,
          assists: sql`${multiplayerProfiles.assists} + ${player.assists}`,
          lastMatchAt: new Date(result.endedAtMs).toISOString(),
        },
      });
  }

  logger.info("match result persisted", {
    matchId: result.matchId,
    players: result.players.length,
  });
  return "persisted";
}
