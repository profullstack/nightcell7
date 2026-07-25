import {
  SPAWN_ENEMY_RADIUS,
  SPAWN_FRIENDLY_BONUS_RADIUS,
  SPAWN_RECENT_DEATH_MS,
  SPAWN_RECENT_DEATH_RADIUS,
} from "./constants";
import { spawnsForTeam, type CollisionMap, type SpawnPoint } from "./map";
import { distance, type Vec3 } from "./vec";

/**
 * Spawn selection (PRD §18.2).
 *
 * "Spawn selection considers nearby enemies, recent deaths, sightlines and team
 * distribution." Scoring is explicit and testable rather than a random pick, so
 * a spawn-camping complaint can be reproduced.
 */

export interface SpawnContext {
  map: CollisionMap;
  team: number;
  /** Living players of any team, used for proximity scoring. */
  occupants: readonly { position: Vec3; team: number; alive: boolean }[];
  /** Where this player (and others) recently died. */
  recentDeaths: readonly { position: Vec3; atMs: number }[];
  nowMs: number;
}

export interface ScoredSpawn {
  spawn: SpawnPoint;
  score: number;
}

export function scoreSpawns(context: SpawnContext): ScoredSpawn[] {
  const candidates = spawnsForTeam(context.map, context.team);

  return candidates
    .map((spawn) => {
      let score = 100;

      for (const occupant of context.occupants) {
        if (!occupant.alive) continue;
        const d = distance(spawn.position, occupant.position);
        if (occupant.team !== context.team) {
          // Heavy penalty for spawning near a living enemy.
          if (d < SPAWN_ENEMY_RADIUS) {
            score -= (1 - d / SPAWN_ENEMY_RADIUS) * 120;
          }
        } else if (d < SPAWN_FRIENDLY_BONUS_RADIUS) {
          // Mild bonus for spawning near a team-mate — fights stay grouped.
          score += (1 - d / SPAWN_FRIENDLY_BONUS_RADIUS) * 15;
        }
      }

      for (const death of context.recentDeaths) {
        const age = context.nowMs - death.atMs;
        if (age > SPAWN_RECENT_DEATH_MS) continue;
        const d = distance(spawn.position, death.position);
        if (d < SPAWN_RECENT_DEATH_RADIUS) {
          const recency = 1 - age / SPAWN_RECENT_DEATH_MS;
          score -= (1 - d / SPAWN_RECENT_DEATH_RADIUS) * 60 * recency;
        }
      }

      return { spawn, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectSpawn(context: SpawnContext): SpawnPoint {
  const scored = scoreSpawns(context);
  const best = scored[0];
  if (!best) {
    throw new Error(`no spawn points defined for team ${context.team} on ${context.map.id}`);
  }
  return best.spawn;
}
