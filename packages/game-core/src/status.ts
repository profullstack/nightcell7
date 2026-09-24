/**
 * Lingering effects a weapon leaves on whoever it hit.
 *
 * `game-core` had no model for this before the arc pulse and the flamethrower,
 * because nothing needed one: every weapon resolved entirely inside the tick
 * that fired it. Both of the new pair are defined by what happens *after* the
 * trigger — fire that keeps burning once the stream moves on, and a discharge
 * that leaves a fighter unable to aim for a moment — so the model is the
 * feature, not scaffolding around it.
 *
 * Pure, like the rest of the package: the caller owns the list and the clock,
 * so the authoritative server, the offline campaign and a unit test all run
 * the same arithmetic.
 *
 * ## Refresh, never stack
 *
 * Holding a flame stream on one target re-applies the burn every tick. If
 * those accumulated, a second of contact would queue ten seconds of damage and
 * the weapon would kill long after the shooter had walked away. So applying an
 * effect that is already running extends it to the longer of the two, and the
 * per-second rate is the stronger of the two rather than their sum. The
 * ceiling on damage is therefore the rate, which is a number that can be
 * balanced, rather than the tick rate, which cannot.
 */

export const STATUS_KIND = {
  /** Fire. Keeps doing damage after contact ends. */
  BURN: "burn",
  /** An electrical discharge. Barely hurts; the cost is control. */
  ARC: "arc",
} as const;

export type StatusKind = (typeof STATUS_KIND)[keyof typeof STATUS_KIND];

/** What a weapon applies on hit, as authored on its spec. */
export interface StatusEffect {
  readonly kind: StatusKind;
  /** Health per second while it runs. Zero for a pure disable. */
  readonly damagePerSecond: number;
  readonly durationMs: number;
  /**
   * How much the victim's aim and movement are damped, 0 to 1.
   *
   * The arc's whole point. Never 1: taking the stick away entirely for even
   * half a second is punishing out of all proportion, and it is the same
   * reason the mosquito's scratch damps rather than locks.
   */
  readonly disrupt: number;
}

/** One effect currently running on a fighter. */
export interface ActiveStatus {
  readonly kind: StatusKind;
  readonly damagePerSecond: number;
  readonly disrupt: number;
  /** Match clock at which it ends. */
  readonly expiresAtMs: number;
}

/**
 * Apply an effect, refreshing any of the same kind rather than adding another.
 *
 * Returns a new list; the input is never mutated.
 */
export function applyStatus(
  active: readonly ActiveStatus[],
  effect: StatusEffect,
  nowMs: number,
): ActiveStatus[] {
  const expiresAtMs = nowMs + effect.durationMs;
  const existing = active.find((s) => s.kind === effect.kind);

  const next: ActiveStatus = existing
    ? {
        kind: effect.kind,
        // The stronger source wins outright. Summing would make a weapon's
        // real damage a function of how many ticks the stream happened to land.
        damagePerSecond: Math.max(existing.damagePerSecond, effect.damagePerSecond),
        disrupt: Math.max(existing.disrupt, effect.disrupt),
        expiresAtMs: Math.max(existing.expiresAtMs, expiresAtMs),
      }
    : {
        kind: effect.kind,
        damagePerSecond: effect.damagePerSecond,
        disrupt: effect.disrupt,
        expiresAtMs,
      };

  return [...active.filter((s) => s.kind !== effect.kind), next];
}

export interface StatusTick {
  readonly active: ActiveStatus[];
  /** Health to remove this tick, before armour. */
  readonly damage: number;
  /** Strongest disruption currently running, 0 to 1. */
  readonly disrupt: number;
}

/**
 * Advance every running effect by `elapsedMs` and collect what it costs.
 *
 * Expiry is checked before damage, so an effect never bills for time past its
 * own end — at a low frame rate a long tick would otherwise charge for a
 * second of burning that finished a moment into it.
 */
export function tickStatuses(
  active: readonly ActiveStatus[],
  nowMs: number,
  elapsedMs: number,
): StatusTick {
  const live: ActiveStatus[] = [];
  let damage = 0;
  let disrupt = 0;

  for (const status of active) {
    const remaining = status.expiresAtMs - (nowMs - elapsedMs);
    if (remaining <= 0) continue;

    const billed = Math.min(Math.max(0, elapsedMs), remaining);
    damage += (billed / 1000) * status.damagePerSecond;

    if (status.expiresAtMs > nowMs) {
      live.push(status);
      disrupt = Math.max(disrupt, status.disrupt);
    }
  }

  return { active: live, damage, disrupt };
}

/** Whether any effect of this kind is running. Drives the client's effects. */
export function hasStatus(active: readonly ActiveStatus[], kind: StatusKind): boolean {
  return active.some((s) => s.kind === kind);
}
