import { DIFFICULTY, getDifficulty } from "@nightcell7/game-core";
import { DEFAULT_BOT_TUNING, type BotTuning } from "@nightcell7/multiplayer-sim";
import { SANDBOX_ENEMY_TUNING, SANDBOX_HUMAN_INCOMING_DAMAGE } from "./sandbox-rules";

/**
 * Sandbox difficulty, chosen on the deploy gate.
 *
 * Three tiers over the same yard and the same bots. What changes is how
 * much a hit costs the player and how the Directorate bots fight:
 *
 *  - Easy: about four health per rifle round, enemies firing in bursts with
 *    a real pause and worse aim. For exploring the yard.
 *  - Medium: the campaign's Field Agent multiplier, match bots.
 *  - Hard: full match damage, match bots. What the multiplayer alpha is.
 *
 * Bots always take full damage from the player and from each other, so the
 * tier never makes the player's own rounds weaker.
 */

export const SANDBOX_DIFFICULTY = {
  EASY: "easy",
  MEDIUM: "medium",
  HARD: "hard",
} as const;

export type SandboxDifficultyId = (typeof SANDBOX_DIFFICULTY)[keyof typeof SANDBOX_DIFFICULTY];

export interface SandboxDifficulty {
  readonly id: SandboxDifficultyId;
  readonly name: string;
  /** One line on the gate. Says what the player will actually feel. */
  readonly blurb: string;
  /** Multiplier on damage the player takes. */
  readonly incomingDamage: number;
  /** How the enemy bots fight. Friendlies always use match tuning. */
  readonly enemyTuning: BotTuning;
}

export const SANDBOX_DIFFICULTIES: readonly SandboxDifficulty[] = [
  {
    id: SANDBOX_DIFFICULTY.EASY,
    name: "Easy",
    blurb: "A hit stings, a fight is survivable. Enemies fire in bursts. Explore the yard.",
    incomingDamage: SANDBOX_HUMAN_INCOMING_DAMAGE,
    enemyTuning: SANDBOX_ENEMY_TUNING,
  },
  {
    id: SANDBOX_DIFFICULTY.MEDIUM,
    name: "Medium",
    blurb: "Field Agent damage and match bots. Use cover, or the lanes will use you.",
    incomingDamage: getDifficulty(DIFFICULTY.FIELD_AGENT).incomingDamageMultiplier,
    enemyTuning: DEFAULT_BOT_TUNING,
  },
  {
    id: SANDBOX_DIFFICULTY.HARD,
    name: "Hard",
    blurb: "Full match damage and match bots. Four rifles empty you in about a second.",
    incomingDamage: getDifficulty(DIFFICULTY.OPERATIVE).incomingDamageMultiplier,
    enemyTuning: DEFAULT_BOT_TUNING,
  },
];

/** Easy, because the player who has to pick one is the one still learning. */
export const DEFAULT_SANDBOX_DIFFICULTY: SandboxDifficultyId = SANDBOX_DIFFICULTY.EASY;

/** Storage key for the last tier chosen, so the gate reopens where you left it. */
const STORAGE_KEY = "nc7.difficulty";

function isDifficulty(value: string | null): value is SandboxDifficultyId {
  return SANDBOX_DIFFICULTIES.some((tier) => tier.id === value);
}

/**
 * Which tier to preselect: `?difficulty=` first, the remembered choice
 * second, Easy otherwise. Same shape as `preferredMode`, for the same
 * reasons.
 */
export function preferredDifficulty(search: string, storage?: Storage): SandboxDifficultyId {
  const requested = new URLSearchParams(search).get("difficulty");
  if (isDifficulty(requested)) return requested;

  try {
    const remembered = storage?.getItem(STORAGE_KEY) ?? null;
    if (isDifficulty(remembered)) return remembered;
  } catch {
    // Private browsing and blocked storage both throw on access rather than
    // returning null. A forgotten preference is not worth failing a boot over.
  }

  return DEFAULT_SANDBOX_DIFFICULTY;
}

/** Remember the chosen tier. Failure here is never worth interrupting play. */
export function rememberDifficulty(tier: SandboxDifficultyId, storage?: Storage): void {
  try {
    storage?.setItem(STORAGE_KEY, tier);
  } catch {
    // As above.
  }
}

export function difficultyInfo(tier: SandboxDifficultyId): SandboxDifficulty {
  return SANDBOX_DIFFICULTIES.find((entry) => entry.id === tier) ?? SANDBOX_DIFFICULTIES[0]!;
}
