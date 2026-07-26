import { GADGET, type GadgetId } from "./ids";

/**
 * The frag grenade (PRD §13.2).
 *
 * Same contract as `weapons.ts`: these numbers are shared tuning, not one
 * runtime's opinion. The client uses them to draw the arc and the HUD count;
 * the authoritative server uses them to decide where a grenade lands and who it
 * kills. They must never diverge, which is why they live here rather than in
 * either runtime.
 *
 * The grenade is deliberately the only throwable in V1. PRD §13.1 — "four
 * excellent weapons have more value than twenty weak weapons" — applies just as
 * well to gadgets, and the `GADGET` table already lists five more that are
 * campaign fiction rather than multiplayer content.
 */

export interface GrenadeSpec {
  readonly id: GadgetId;
  readonly displayName: string;
  /** Time from leaving the hand to detonation. Not cookable in V1. */
  readonly fuseMs: number;
  /** Carried per life. Replenished on respawn, never mid-life. */
  readonly carried: number;
  /** Minimum gap between throws, so two cannot leave the hand on one frame. */
  readonly cooldownMs: number;
  /** Launch speed along the aim direction, m/s. */
  readonly throwSpeed: number;
  /**
   * Upward bias added to the aim direction, m/s.
   *
   * Without it a grenade thrown at a target on your level lands short of the
   * crosshair, because it starts falling immediately. This is the lob.
   */
  readonly throwLift: number;
  /** Collision radius against world geometry. */
  readonly radiusM: number;
  /** Fraction of speed kept after a bounce. */
  readonly restitution: number;
  /** Fraction of tangential speed kept after a bounce. */
  readonly friction: number;
  /** Full damage within this distance of the blast centre. */
  readonly innerRadiusM: number;
  /** Damage reaches zero at this distance. */
  readonly outerRadiusM: number;
  /**
   * Damage at the centre of the blast.
   *
   * Read this against `applyDamage`, not on its own. Armour absorbs half of
   * incoming damage while it lasts, so a spawn loadout of 100 health and 50
   * armour survives anything under 150 — an obvious-looking 130 leaves someone
   * standing directly on a frag at 20 health, which reads as a broken grenade
   * rather than a balanced one.
   */
  readonly maxDamage: number;
  /**
   * What fraction of the blast the thrower takes.
   *
   * Not 0: a grenade with no downside is thrown at every wall in reach, and
   * the arc has to be a decision. Not 1 either — this is a 6v6 alpha, and
   * dying to your own bounce-back is a worse experience than it is a lesson.
   */
  readonly selfDamageFraction: number;
}

export const GRENADE_SPEC: GrenadeSpec = {
  id: GADGET.FRAG,
  displayName: "Frag",
  fuseMs: 2500,
  carried: 2,
  cooldownMs: 900,
  throwSpeed: 15,
  throwLift: 3.2,
  radiusM: 0.09,
  restitution: 0.32,
  friction: 0.62,
  innerRadiusM: 1.6,
  outerRadiusM: 6.5,
  maxDamage: 165,
  selfDamageFraction: 0.6,
};

/**
 * Blast damage at a distance from the centre.
 *
 * Linear between the inner and outer radius. A quadratic curve is more
 * physical and plays worse: it makes the outer two thirds of the radius do
 * almost nothing, so the grenade reads as either an instant kill or a noise.
 *
 * Pure, so the server, the client's prediction and the tests all agree.
 */
export function grenadeDamageAt(distanceM: number, spec: GrenadeSpec = GRENADE_SPEC): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 0;
  if (distanceM <= spec.innerRadiusM) return spec.maxDamage;
  if (distanceM >= spec.outerRadiusM) return 0;

  const span = spec.outerRadiusM - spec.innerRadiusM;
  const falloff = 1 - (distanceM - spec.innerRadiusM) / span;
  return spec.maxDamage * falloff;
}
