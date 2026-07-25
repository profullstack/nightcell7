import { damageFalloff, type WeaponSpec } from "./weapons";

/**
 * Health and armour model (PRD §12.4).
 *
 * 100 health, 0-100 armour, armour absorbs a configurable fraction. Health
 * regenerates only to a low stabilised threshold; full recovery needs pickups.
 * Difficulty changes tactics, accuracy and resources — never enemy health
 * multipliers ("no bullet-sponge difficulty").
 */

export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;

/** Fraction of incoming damage armour absorbs while it lasts. */
export const ARMOR_ABSORPTION = 0.5;

/** Regeneration ceiling — you always have to find a pickup to get back to full. */
export const REGEN_CEILING = 40;
export const REGEN_DELAY_MS = 4500;
export const REGEN_PER_SECOND = 12;

export interface Vitals {
  health: number;
  armor: number;
}

export interface DamageResult {
  vitals: Vitals;
  /** Damage actually removed from health. */
  healthDamage: number;
  /** Damage soaked by armour. */
  armorDamage: number;
  armorAbsorbed: boolean;
  killed: boolean;
}

/**
 * Apply damage to vitals. Pure: callers own the state, which keeps this usable
 * from the authoritative server, the offline campaign and unit tests alike.
 */
export function applyDamage(vitals: Readonly<Vitals>, amount: number): DamageResult {
  const incoming = Math.max(0, amount);
  const armorBefore = clamp(vitals.armor, 0, MAX_ARMOR);
  const healthBefore = clamp(vitals.health, 0, MAX_HEALTH);

  const absorbable = incoming * ARMOR_ABSORPTION;
  const armorDamage = Math.min(armorBefore, absorbable);
  const healthDamage = incoming - armorDamage;

  const health = Math.max(0, healthBefore - healthDamage);
  const armor = armorBefore - armorDamage;

  return {
    vitals: { health, armor },
    healthDamage,
    armorDamage,
    armorAbsorbed: armorDamage > 0,
    killed: health <= 0 && healthBefore > 0,
  };
}

export interface ShotDamageInput {
  spec: WeaponSpec;
  distanceM: number;
  headshot: boolean;
  /** Number of pellets that connected — 1 for single-projectile weapons. */
  pelletsHit?: number;
  /** Difficulty multiplier applied to damage the *player* receives. */
  incomingMultiplier?: number;
}

/** Damage a single trigger pull deals before armour is considered. */
export function computeShotDamage(input: ShotDamageInput): number {
  const { spec, distanceM, headshot } = input;
  const pellets = clamp(input.pelletsHit ?? 1, 0, spec.pellets);
  const base = spec.damage * pellets;
  const falloff = damageFalloff(spec, Math.max(0, distanceM));
  const head = headshot ? spec.headshotMultiplier : 1;
  const multiplier = input.incomingMultiplier ?? 1;
  return base * falloff * head * multiplier;
}

/** Passive regeneration up to the stabilisation ceiling. */
export function regenerate(vitals: Readonly<Vitals>, elapsedMs: number): Vitals {
  if (vitals.health >= REGEN_CEILING) return { ...vitals };
  const gained = (elapsedMs / 1000) * REGEN_PER_SECOND;
  return {
    health: Math.min(REGEN_CEILING, vitals.health + gained),
    armor: vitals.armor,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}
