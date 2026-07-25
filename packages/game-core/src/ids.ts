/**
 * Canonical content identifiers.
 *
 * These strings appear in save files, entitlement rows, content manifests and
 * match records, so they are append-only: never rename an existing id.
 */

export const EPISODE = {
  FALSE_DAWN: "false-dawn",
} as const;
export type EpisodeId = (typeof EPISODE)[keyof typeof EPISODE];

/** The two playable campaigns. Neither is "the good side" (PRD §4.3). */
export const SIDE = {
  ROOK: "rook",
  LEILA: "leila",
} as const;
export type SideId = (typeof SIDE)[keyof typeof SIDE];

export const LOCATION = {
  KAVIRAN: "kaviran",
  RELAY_K17: "relay-k17",
  ARDAVAN: "ardavan",
} as const;
export type LocationId = (typeof LOCATION)[keyof typeof LOCATION];

/** Six mission variants: three per side over three shared locations (PRD §8). */
export const MISSION = {
  ROOK_DEAD_DROP: "rook-dead-drop",
  ROOK_BLACK_RELAY: "rook-black-relay",
  ROOK_FALSE_DAWN: "rook-false-dawn",
  LEILA_COUNTER_SIGNAL: "leila-counter-signal",
  LEILA_BROKEN_CHAIN: "leila-broken-chain",
  LEILA_FIRST_LIGHT: "leila-first-light",
  COMPLETE_TRUTH: "complete-truth",
} as const;
export type MissionId = (typeof MISSION)[keyof typeof MISSION];

export const WEAPON = {
  P11: "p11",
  C9_KESTREL: "c9-kestrel",
  B4_BREACHER: "b4-breacher",
  M7_LANCE: "m7-lance",
} as const;
export type WeaponId = (typeof WEAPON)[keyof typeof WEAPON];

export const GADGET = {
  FRAG: "frag-grenade",
  EMP_PUCK: "emp-puck",
  SIGNAL_TAP: "signal-tap",
  JAMMER: "portable-jammer",
  GHOST_KEY: "ghost-key",
  NIGHT_VISION: "night-vision",
} as const;
export type GadgetId = (typeof GADGET)[keyof typeof GADGET];

export const ENEMY = {
  RIFLEMAN: "rifleman",
  BREACHER: "breacher",
  MARKSMAN: "marksman",
  HEAVY: "heavy",
  SECURITY_DRONE: "security-drone",
} as const;
export type EnemyId = (typeof ENEMY)[keyof typeof ENEMY];

export const MULTIPLAYER_MAP = {
  ARDAVAN_YARD: "ardavan-yard",
} as const;
export type MultiplayerMapId = (typeof MULTIPLAYER_MAP)[keyof typeof MULTIPLAYER_MAP];

/** Missions playable without an entitlement (PRD §9). */
export const DEMO_MISSIONS: readonly MissionId[] = [
  MISSION.ROOK_DEAD_DROP,
  MISSION.LEILA_COUNTER_SIGNAL,
];

export function isDemoMission(mission: MissionId): boolean {
  return DEMO_MISSIONS.includes(mission);
}
