import { MISSION, SIDE, isDemoMission } from "./ids";
import type { EpisodeId, MissionId, SideId } from "./ids";
import { getMission, missionsForSide } from "./campaign";
import type { DifficultyId } from "./difficulty";

/**
 * Campaign progress rules.
 *
 * Pure functions over a plain progress record so the same logic drives the
 * in-game menu, the save migration and the marketing site's "owned/completed"
 * badges without any of them re-deriving the rules.
 */

export interface MissionProgress {
  readonly missionId: MissionId;
  completed: boolean;
  /** Highest difficulty the mission has been completed on. */
  bestDifficulty?: DifficultyId;
  bestTimeMs?: number;
  collectiblesFound: string[];
}

export interface SideProgress {
  readonly side: SideId;
  missions: MissionProgress[];
  completed: boolean;
}

export interface EpisodeProgress {
  readonly episodeId: EpisodeId;
  sides: SideProgress[];
  completeTruthUnlocked: boolean;
  completeTruthCompleted: boolean;
}

export function emptyEpisodeProgress(episodeId: EpisodeId): EpisodeProgress {
  return {
    episodeId,
    sides: [SIDE.ROOK, SIDE.LEILA].map((side) => ({
      side,
      completed: false,
      missions: missionsForSide(side).map((m) => ({
        missionId: m.id,
        completed: false,
        collectiblesFound: [],
      })),
    })),
    completeTruthUnlocked: false,
    completeTruthCompleted: false,
  };
}

export function isSideComplete(progress: EpisodeProgress, side: SideId): boolean {
  const sideProgress = progress.sides.find((s) => s.side === side);
  if (!sideProgress) return false;
  const required = missionsForSide(side);
  return required.every(
    (m) => sideProgress.missions.find((p) => p.missionId === m.id)?.completed === true,
  );
}

export function completedSides(progress: EpisodeProgress): SideId[] {
  return [SIDE.ROOK, SIDE.LEILA].filter((side) => isSideComplete(progress, side));
}

/**
 * Complete Truth unlocks only after BOTH campaigns are finished (PRD §10.7).
 * The epilogue is never sold separately and never unlocked early.
 */
export function shouldUnlockCompleteTruth(progress: EpisodeProgress): boolean {
  return completedSides(progress).length === 2;
}

/** Record a mission completion and recompute derived unlock state. */
export function completeMission(
  progress: EpisodeProgress,
  missionId: MissionId,
  outcome: { difficulty: DifficultyId; timeMs: number; collectibles?: readonly string[] },
): EpisodeProgress {
  if (missionId === MISSION.COMPLETE_TRUTH) {
    if (!progress.completeTruthUnlocked) {
      throw new Error("complete-truth completed before it was unlocked");
    }
    return { ...progress, completeTruthCompleted: true };
  }

  const spec = getMission(missionId);
  const next: EpisodeProgress = {
    ...progress,
    sides: progress.sides.map((sideProgress) => {
      if (sideProgress.side !== spec.side) return sideProgress;
      return {
        ...sideProgress,
        missions: sideProgress.missions.map((mission) => {
          if (mission.missionId !== missionId) return mission;
          return {
            ...mission,
            completed: true,
            bestDifficulty: bestOf(mission.bestDifficulty, outcome.difficulty),
            bestTimeMs:
              mission.bestTimeMs === undefined
                ? outcome.timeMs
                : Math.min(mission.bestTimeMs, outcome.timeMs),
            collectiblesFound: unique([
              ...mission.collectiblesFound,
              ...(outcome.collectibles ?? []),
            ]),
          };
        }),
      };
    }),
  };

  const withSideFlags: EpisodeProgress = {
    ...next,
    sides: next.sides.map((s) => ({ ...s, completed: isSideComplete(next, s.side) })),
  };

  return {
    ...withSideFlags,
    completeTruthUnlocked:
      withSideFlags.completeTruthUnlocked || shouldUnlockCompleteTruth(withSideFlags),
  };
}

/**
 * Whether a mission may be started right now.
 *
 * Demo missions are always playable without an account or entitlement; paid
 * missions need the episode entitlement AND the previous mission on that side.
 * Either side may be played first — there is no cross-side gate (PRD §9).
 */
export function canStartMission(
  progress: EpisodeProgress,
  missionId: MissionId,
  options: { hasEntitlement: boolean },
):
  | { allowed: true }
  | { allowed: false; reason: "entitlement_required" | "locked" | "prerequisite" } {
  if (missionId === MISSION.COMPLETE_TRUTH) {
    if (!options.hasEntitlement) return { allowed: false, reason: "entitlement_required" };
    return progress.completeTruthUnlocked
      ? { allowed: true }
      : { allowed: false, reason: "locked" };
  }

  const spec = getMission(missionId);
  if (spec.requiresEntitlement && !options.hasEntitlement) {
    return { allowed: false, reason: "entitlement_required" };
  }
  if (isDemoMission(missionId) || spec.order === 1) return { allowed: true };

  const sideProgress = progress.sides.find((s) => s.side === spec.side);
  const previous = missionsForSide(spec.side).find((m) => m.order === spec.order - 1);
  if (!previous) return { allowed: true };
  const previousDone =
    sideProgress?.missions.find((m) => m.missionId === previous.id)?.completed === true;
  return previousDone ? { allowed: true } : { allowed: false, reason: "prerequisite" };
}

const DIFFICULTY_RANK: Record<string, number> = {
  "field-agent": 0,
  operative: 1,
  black: 2,
};

function bestOf(a: DifficultyId | undefined, b: DifficultyId): DifficultyId {
  if (!a) return b;
  return (DIFFICULTY_RANK[b] ?? 0) > (DIFFICULTY_RANK[a] ?? 0) ? b : a;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
