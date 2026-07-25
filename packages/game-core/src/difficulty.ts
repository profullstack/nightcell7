/**
 * Difficulty (PRD §12.6).
 *
 * The explicit product rule is that difficulty changes tactics, accuracy and
 * resources — not enemy health. There is deliberately no `enemyHealthMultiplier`
 * field here; adding one would be a product decision, not a tuning change.
 */

export const DIFFICULTY = {
  FIELD_AGENT: "field-agent",
  OPERATIVE: "operative",
  BLACK: "black",
} as const;

export type DifficultyId = (typeof DIFFICULTY)[keyof typeof DIFFICULTY];

export interface DifficultySpec {
  readonly id: DifficultyId;
  readonly displayName: string;
  /** Multiplier on damage the *player* takes. */
  readonly incomingDamageMultiplier: number;
  /** Enemy reaction delay after first perceiving the player, milliseconds. */
  readonly enemyReactionMs: number;
  /** Enemy shot accuracy, 0-1. */
  readonly enemyAccuracy: number;
  /** Multiplier on ammunition and health pickup density. */
  readonly pickupDensity: number;
  /** How aggressively enemies flank rather than hold position, 0-1. */
  readonly enemyFlankBias: number;
  readonly controllerAimAssist: "strong" | "standard" | "reduced";
  /** Objective markers and route hints. */
  readonly navigationHints: boolean;
  /** Black trims the HUD rather than inflating enemies. */
  readonly reducedHud: boolean;
}

export const DIFFICULTY_SPECS: Readonly<Record<DifficultyId, DifficultySpec>> = {
  [DIFFICULTY.FIELD_AGENT]: {
    id: DIFFICULTY.FIELD_AGENT,
    displayName: "Field Agent",
    incomingDamageMultiplier: 0.6,
    enemyReactionMs: 700,
    enemyAccuracy: 0.35,
    pickupDensity: 1.4,
    enemyFlankBias: 0.2,
    controllerAimAssist: "strong",
    navigationHints: true,
    reducedHud: false,
  },
  [DIFFICULTY.OPERATIVE]: {
    id: DIFFICULTY.OPERATIVE,
    displayName: "Operative",
    incomingDamageMultiplier: 1.0,
    enemyReactionMs: 420,
    enemyAccuracy: 0.55,
    pickupDensity: 1.0,
    enemyFlankBias: 0.5,
    controllerAimAssist: "standard",
    navigationHints: true,
    reducedHud: false,
  },
  [DIFFICULTY.BLACK]: {
    id: DIFFICULTY.BLACK,
    displayName: "Black",
    incomingDamageMultiplier: 1.5,
    enemyReactionMs: 240,
    enemyAccuracy: 0.72,
    pickupDensity: 0.65,
    enemyFlankBias: 0.85,
    controllerAimAssist: "reduced",
    navigationHints: false,
    reducedHud: true,
  },
};

export function getDifficulty(id: DifficultyId): DifficultySpec {
  const spec = DIFFICULTY_SPECS[id];
  if (!spec) throw new Error(`unknown difficulty: ${id}`);
  return spec;
}

export const DEFAULT_DIFFICULTY: DifficultyId = DIFFICULTY.OPERATIVE;
