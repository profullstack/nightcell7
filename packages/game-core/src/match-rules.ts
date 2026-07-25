/**
 * Team Deathmatch rules (PRD §18.1).
 *
 * The only V1 multiplayer mode. Shared by the authoritative server, the bot
 * controller and the client HUD so nobody has a private idea of when a match
 * ends.
 */

export const MATCH_MODE = {
  TEAM_DEATHMATCH: "tdm",
} as const;
export type MatchMode = (typeof MATCH_MODE)[keyof typeof MATCH_MODE];

export interface MatchRules {
  readonly mode: MatchMode;
  readonly teamSize: number;
  readonly maxPlayers: number;
  readonly minHumansToStart: number;
  readonly scoreLimit: number;
  readonly durationMs: number;
  readonly warmupMs: number;
  readonly respawnDelayMs: number;
  /** Invulnerability immediately after respawning, to stop spawn-camping. */
  readonly spawnProtectionMs: number;
  readonly pointsPerKill: number;
  readonly pointsPerAssist: number;
  /** Killing a team-mate is a failure state, not a scoring option. */
  readonly pointsPerTeamKill: number;
  /** Seconds a seat is reserved after an unexpected disconnect (PRD §18.10). */
  readonly reconnectGraceMs: number;
  /** Damage share required within the assist window to be credited. */
  readonly assistDamageFraction: number;
  readonly assistWindowMs: number;
}

export const TDM_RULES: MatchRules = {
  mode: MATCH_MODE.TEAM_DEATHMATCH,
  teamSize: 6,
  maxPlayers: 12,
  minHumansToStart: 1, // bots fill the rest during the alpha (PRD §18.11)
  scoreLimit: 75,
  durationMs: 10 * 60 * 1000,
  warmupMs: 15 * 1000,
  respawnDelayMs: 5000,
  spawnProtectionMs: 1500,
  pointsPerKill: 100,
  pointsPerAssist: 50,
  pointsPerTeamKill: -100,
  reconnectGraceMs: 20_000,
  assistDamageFraction: 0.25,
  assistWindowMs: 8000,
};

export interface TeamScores {
  [teamId: number]: number;
}

export type MatchOutcome =
  | { ended: false }
  | { ended: true; reason: "score_limit" | "time_limit"; winningTeam: number | null };

/**
 * Decide whether a match is over. Pure so the tick loop, the bot harness and
 * the load-test client all agree.
 */
export function evaluateMatchOutcome(
  scores: TeamScores,
  elapsedMs: number,
  rules: MatchRules = TDM_RULES,
): MatchOutcome {
  const entries = Object.entries(scores).map(([team, score]) => ({
    team: Number(team),
    score,
  }));

  const leader = entries.reduce<{ team: number; score: number } | null>(
    (best, entry) => (best === null || entry.score > best.score ? entry : best),
    null,
  );

  if (leader && leader.score >= rules.scoreLimit) {
    return { ended: true, reason: "score_limit", winningTeam: leader.team };
  }

  if (elapsedMs >= rules.durationMs) {
    const top = leader?.score ?? 0;
    const tied = entries.filter((e) => e.score === top);
    return {
      ended: true,
      reason: "time_limit",
      winningTeam: tied.length === 1 ? (tied[0]?.team ?? null) : null,
    };
  }

  return { ended: false };
}

/**
 * Auto-balance takes priority over faction preference (PRD §18.1).
 * Returns the team a joining player should be placed on.
 */
export function assignTeam(
  counts: Readonly<Record<number, number>>,
  preferred: number | undefined,
  rules: MatchRules = TDM_RULES,
): number {
  const a = counts[0] ?? 0;
  const b = counts[1] ?? 0;

  if (preferred === 0 && a < rules.teamSize && a <= b) return 0;
  if (preferred === 1 && b < rules.teamSize && b <= a) return 1;

  if (a === b) return preferred === 1 ? 1 : 0;
  return a < b ? 0 : 1;
}
