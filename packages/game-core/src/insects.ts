import { applyDamage, MAX_HEALTH, type Vitals } from "./damage";

/**
 * Night insect nuisance: the mosquito bite and the scratch that follows.
 *
 * This is ambience with teeth, not a combat system. A bite costs a few points
 * and interrupts you for about a second — enough that a night fight feels like
 * standing in a yard at 4 a.m., nowhere near enough to decide one. The numbers
 * below are chosen so a full match is worth a handful of health, not a death.
 *
 * Pure, like the rest of `game-core`: the caller owns the state and the clock.
 * That keeps it usable from the offline campaign, from a test, and — if the
 * bite ever becomes authoritative — from the match server without change.
 *
 * ## Where the damage is allowed to apply
 *
 * CLAUDE.md is explicit that in multiplayer "the server owns movement
 * validation, fire cadence, projectiles, damage, death, respawn, score, and
 * match outcome". A client that quietly subtracted health from its own player
 * would be inventing damage the server never agreed to, and the next
 * reconciliation would snap it back anyway.
 *
 * So the rule is: `damage` is only ever applied by a caller that owns the
 * vitals. In single-player that is the client. In multiplayer it is nobody
 * yet — the client runs this with `damage: false` and gets the mosquito, the
 * whine and the scratch as pure presentation. Making the bite authoritative
 * online means running this on the server and sending the result down; the
 * shape here is deliberately ready for that and deliberately does not assume
 * it.
 */

export const BITE = {
  /**
   * Health per bite.
   *
   * Two was imperceptible: a fighter carrying 150 stamina lost about 1% and a
   * playtester could not tell whether he had ever been bitten. Ambience you
   * cannot feel is not ambience, it is dead code.
   */
  DAMAGE: 7,
  /** A bite lands somewhere in this window after the last one. */
  MIN_INTERVAL_MS: 35_000,
  MAX_INTERVAL_MS: 75_000,
  /**
   * A bite never takes you below this fraction of your maximum health.
   *
   * A fraction, not the flat 70 it replaced: stamina varies by armour class,
   * so a flat floor meant a 150-health fighter could lose 80 points to insects
   * while a 100-health one lost 30. At 0.8 the whole match costs at most a
   * fifth of the bar whoever you are — individually noticeable, collectively
   * incapable of deciding a firefight. Below the floor the mosquito still
   * comes, still bites and still makes you swat; it just stops costing health.
   */
  FLOOR_FRACTION: 0.8,
  /** How long the player swats and scratches — the pause has to be felt. */
  SCRATCH_MS: 1_800,
  /**
   * How long before the bite the player starts swatting at it.
   *
   * The swat leads the bite rather than following it, because that is the
   * beat: you hear it, you take a hand off the rifle to wave it away, you
   * miss, and it gets you anyway. Ordering it the other way round made the
   * swat read as a reaction to damage, which is just a flinch.
   */
  SWAT_LEAD_MS: 850,
  /**
   * Nothing bites in the opening minute.
   *
   * The first contact of a match is the worst possible moment to take the
   * player's hands off the rifle, and a bite in the first ten seconds reads as
   * a bug rather than atmosphere. Shortened from a minute once playtesting
   * showed nobody ever stayed locked long enough to meet a mosquito at all:
   * The floor already caps what a whole match can cost, so frequency is cheap.
   */
  GRACE_MS: 20_000,
} as const;

export interface InsectBiteState {
  /** Match clock, in ms, at which the next bite lands. */
  readonly nextBiteAt: number;
  /** Set once the swat for this cycle has been reported, so it fires once. */
  readonly swatAnnounced: boolean;
  /** Match clock until which the player is scratching; 0 when they are not. */
  readonly scratchUntil: number;
  /** Bites taken this match. Surfaced on the end-of-match card. */
  readonly bites: number;
}

/** A source of randomness in [0, 1). Injected so tests are deterministic. */
export type Random = () => number;

function interval(rand: Random): number {
  return BITE.MIN_INTERVAL_MS + rand() * (BITE.MAX_INTERVAL_MS - BITE.MIN_INTERVAL_MS);
}

export function createInsectBiteState(rand: Random): InsectBiteState {
  return {
    nextBiteAt: BITE.GRACE_MS + interval(rand),
    swatAnnounced: false,
    scratchUntil: 0,
    bites: 0,
  };
}

export interface InsectBiteOptions {
  /** False by day, and false wherever insects are switched off entirely. */
  readonly enabled: boolean;
  /**
   * Whether this caller owns the player's vitals and may subtract health.
   * See the note on multiplayer above.
   */
  readonly damage: boolean;
  readonly vitals: Readonly<Vitals>;
  readonly maxHealth?: number;
}

export interface InsectBiteStep {
  readonly state: InsectBiteState;
  /** True through the swat window that leads the bite. */
  readonly swatting: boolean;
  /** True only on the tick the swat begins — drive the one-shot effect off this. */
  readonly startedSwat: boolean;
  /** Health actually removed. Zero at or below the floor. */
  readonly damageDealt: number;
  /** True only on the tick a bite lands — drive the sting effect off this. */
  readonly bit: boolean;
  /** True for the whole scratch, including the tick the bite landed. */
  readonly scratching: boolean;
  /** Vitals after the bite. Unchanged when `damage` is false or nothing bit. */
  readonly vitals: Vitals;
}

/**
 * Advance the nuisance clock to `nowMs` (match time, not wall time).
 *
 * Deliberately never bites while the player is already scratching: two bites
 * inside a second would read as a swarm, and the point is that this is barely
 * there.
 */
export function stepInsectBite(
  state: Readonly<InsectBiteState>,
  nowMs: number,
  rand: Random,
  options: InsectBiteOptions,
): InsectBiteStep {
  const scratching = nowMs < state.scratchUntil;

  if (!options.enabled || scratching || nowMs < state.nextBiteAt) {
    // The swat window: close enough to the bite that the player is already
    // waving at it, but it has not landed yet.
    const swatting =
      options.enabled &&
      !scratching &&
      nowMs >= state.nextBiteAt - BITE.SWAT_LEAD_MS &&
      nowMs < state.nextBiteAt;
    const startedSwat = swatting && !state.swatAnnounced;

    return {
      state: startedSwat ? { ...state, swatAnnounced: true } : { ...state },
      damageDealt: 0,
      bit: false,
      swatting,
      startedSwat,
      scratching,
      vitals: { ...options.vitals },
    };
  }

  // Never past the floor, and never a negative "heal" for a player already
  // below it from gunfire.
  const floor = (options.maxHealth ?? MAX_HEALTH) * BITE.FLOOR_FRACTION;
  const headroom = Math.max(0, options.vitals.health - floor);
  const amount = Math.min(BITE.DAMAGE, headroom);
  const vitals =
    options.damage && amount > 0
      ? applyDamage(options.vitals, amount, options.maxHealth).vitals
      : { ...options.vitals };

  return {
    damageDealt: options.damage ? amount : 0,
    state: {
      nextBiteAt: nowMs + interval(rand),
      // Armed again for the next cycle's swat.
      swatAnnounced: false,
      scratchUntil: nowMs + BITE.SCRATCH_MS,
      bites: state.bites + 1,
    },
    bit: true,
    // The swat is over the instant it connects; what follows is the scratch.
    swatting: false,
    startedSwat: false,
    scratching: true,
    vitals,
  };
}
