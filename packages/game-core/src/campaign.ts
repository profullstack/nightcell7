import { EPISODE, LOCATION, MISSION, SIDE } from "./ids";
import type { EpisodeId, LocationId, MissionId, SideId } from "./ids";

/**
 * Episode 1 campaign structure (PRD §8).
 *
 * Three shared locations, six mission variants, one epilogue. The second side
 * reuses geometry but never "the same level backwards" — each variant declares
 * its own entry, security state and objective order so the difference is data,
 * not level-designer memory.
 */

export interface MissionSpec {
  readonly id: MissionId;
  readonly episode: EpisodeId;
  readonly side: SideId;
  readonly location: LocationId;
  readonly title: string;
  /** Order within that side's campaign, 1-based. */
  readonly order: number;
  readonly entry: string;
  readonly objectives: readonly string[];
  /** Systems this mission is responsible for teaching. */
  readonly introduces: readonly string[];
  readonly requiresEntitlement: boolean;
  /** Minutes, first playthrough. */
  readonly targetRuntimeMinutes: number;
}

export const MISSION_SPECS: readonly MissionSpec[] = [
  {
    id: MISSION.ROOK_DEAD_DROP,
    episode: EPISODE.FALSE_DAWN,
    side: SIDE.ROOK,
    location: LOCATION.KAVIRAN,
    title: "Dead Drop",
    order: 1,
    entry: "Safehouse, on foot, covert",
    objectives: [
      "Meet Vale",
      "Recover MIRAGE shard",
      "Survive assassination",
      "Identify compromised exit",
      "Escape Kaviran",
      "Reach maintenance transport",
    ],
    introduces: [
      "movement",
      "interaction",
      "suppressed-pistol",
      "takedown",
      "carbine",
      "night-vision",
      "health-armor",
      "checkpoints",
    ],
    requiresEntitlement: false,
    targetRuntimeMinutes: 22,
  },
  {
    id: MISSION.LEILA_COUNTER_SIGNAL,
    episode: EPISODE.FALSE_DAWN,
    side: SIDE.LEILA,
    location: LOCATION.KAVIRAN,
    title: "Counter-Signal",
    order: 1,
    entry: "Directorate vehicle, authorised perimeter",
    objectives: [
      "Analyse conflicting telemetry",
      "Lock down Kaviran",
      "Inspect compromised surveillance",
      "Identify Orison impostors",
      "Recover intercepted Nightcell fragment",
      "Pursue Rook without attacking protected personnel",
    ],
    introduces: [
      "authorized-access",
      "signal-tap",
      "target-identification",
      "jammer",
      "manipulated-orders",
    ],
    requiresEntitlement: false,
    targetRuntimeMinutes: 22,
  },
  {
    id: MISSION.ROOK_BLACK_RELAY,
    episode: EPISODE.FALSE_DAWN,
    side: SIDE.ROOK,
    location: LOCATION.RELAY_K17,
    title: "Black Relay",
    order: 2,
    entry: "Lower maintenance shaft",
    objectives: [
      "Enter lower maintenance",
      "Disable alarm array",
      "Reach operations deck",
      "Recover signing key",
      "Survive purge",
      "Escape cable tunnel",
    ],
    introduces: [
      "shotgun",
      "emp-puck",
      "security-drone",
      "marksman",
      "vertical-routes",
      "timed-escape",
    ],
    requiresEntitlement: true,
    targetRuntimeMinutes: 26,
  },
  {
    id: MISSION.LEILA_BROKEN_CHAIN,
    episode: EPISODE.FALSE_DAWN,
    side: SIDE.LEILA,
    location: LOCATION.RELAY_K17,
    title: "Broken Chain",
    order: 2,
    entry: "Upper perimeter, weather-exposed catwalks",
    objectives: [
      "Secure upper perimeter",
      "Verify purge order",
      "Prevent evidence destruction",
      "Identify Nightcell credentials",
      "Reach operations deck from above",
      "Stop local reinforcements entering Orison's trap",
    ],
    introduces: [
      "surveillance-routing",
      "false-command-isolation",
      "defensive-encounters",
      "friendly-hostile-ambiguity",
    ],
    requiresEntitlement: true,
    targetRuntimeMinutes: 26,
  },
  {
    id: MISSION.ROOK_FALSE_DAWN,
    episode: EPISODE.FALSE_DAWN,
    side: SIDE.ROOK,
    location: LOCATION.ARDAVAN,
    title: "False Dawn",
    order: 3,
    entry: "Seawater intake or pipe rack",
    objectives: [
      "Sabotage western launch branch",
      "Acquire M7 coil rifle",
      "Reach central command",
      "Defeat or bypass Kade",
      "Transmit Rook evidence",
      "Escape",
    ],
    introduces: ["coil-rifle", "underground-facility", "launch-sabotage"],
    requiresEntitlement: true,
    targetRuntimeMinutes: 30,
  },
  {
    id: MISSION.LEILA_FIRST_LIGHT,
    episode: EPISODE.FALSE_DAWN,
    side: SIDE.LEILA,
    location: LOCATION.ARDAVAN,
    title: "First Light",
    order: 3,
    entry: "Controlled checkpoint",
    objectives: [
      "Discover Orison replacement teams",
      "Sabotage eastern launch branch",
      "Protect authentic command link",
      "Prevent retaliatory authorization",
      "Transmit Leila evidence",
      "Reach surface at sunrise",
    ],
    introduces: ["command-link-defense", "retaliation-prevention"],
    requiresEntitlement: true,
    targetRuntimeMinutes: 30,
  },
  {
    id: MISSION.COMPLETE_TRUTH,
    episode: EPISODE.FALSE_DAWN,
    side: SIDE.ROOK, // Played from both viewpoints; attributed to neither route.
    location: LOCATION.ARDAVAN,
    title: "Complete Truth",
    order: 4,
    entry: "Epilogue",
    objectives: [
      "Reconcile both evidence halves",
      "Uncover the burn designation",
      "Establish the off-book channel",
    ],
    introduces: [],
    requiresEntitlement: true,
    targetRuntimeMinutes: 12,
  },
];

const MISSION_BY_ID = new Map(MISSION_SPECS.map((m) => [m.id, m]));

export function getMission(id: MissionId): MissionSpec {
  const spec = MISSION_BY_ID.get(id);
  if (!spec) throw new Error(`unknown mission: ${id}`);
  return spec;
}

/** The three story missions of one side, in play order. */
export function missionsForSide(side: SideId): readonly MissionSpec[] {
  return MISSION_SPECS.filter((m) => m.side === side && m.id !== MISSION.COMPLETE_TRUTH).sort(
    (a, b) => a.order - b.order,
  );
}

/**
 * Cross-campaign events (PRD §8.2). Each is authored once and referenced from
 * both sides, so the two campaigns cannot silently disagree about what happened.
 */
export interface TimelineEvent {
  /** Fictional in-world clock, "HH:MM". */
  readonly at: string;
  readonly location: LocationId;
  readonly summary: string;
  /** Which side experiences this first-hand. `both` marks a shared set piece. */
  readonly witness: SideId | "both";
  /** Present when the *other* side later reinterprets this event. */
  readonly reinterpretedBy?: SideId;
}

export const SHARED_TIMELINE: readonly TimelineEvent[] = [
  { at: "01:10", location: LOCATION.KAVIRAN, summary: "Rook meets Vale", witness: SIDE.ROOK },
  {
    at: "01:13",
    location: LOCATION.KAVIRAN,
    summary: "Leila receives intrusion alert",
    witness: SIDE.LEILA,
  },
  {
    at: "01:16",
    location: LOCATION.KAVIRAN,
    summary: "Orison kills Vale",
    witness: SIDE.ROOK,
    reinterpretedBy: SIDE.LEILA,
  },
  {
    at: "01:18",
    location: LOCATION.KAVIRAN,
    summary: "Leila locks the district",
    witness: SIDE.LEILA,
  },
  {
    at: "01:23",
    location: LOCATION.KAVIRAN,
    summary: "Rook disables district power",
    witness: SIDE.ROOK,
    reinterpretedBy: SIDE.LEILA,
  },
  {
    at: "01:24",
    location: LOCATION.KAVIRAN,
    summary: "Leila uses the blackout to isolate a false relay",
    witness: SIDE.LEILA,
  },
  { at: "01:41", location: LOCATION.KAVIRAN, summary: "Both depart toward K-17", witness: "both" },
  {
    at: "03:40",
    location: LOCATION.RELAY_K17,
    summary: "Rook enters lower K-17 maintenance",
    witness: SIDE.ROOK,
  },
  {
    at: "03:43",
    location: LOCATION.RELAY_K17,
    summary: "Leila reaches the upper perimeter",
    witness: SIDE.LEILA,
  },
  {
    at: "03:55",
    location: LOCATION.RELAY_K17,
    summary: "Rook disables the alarm array",
    witness: SIDE.ROOK,
  },
  {
    at: "03:57",
    location: LOCATION.RELAY_K17,
    summary: "Leila blocks a purge order from local forces",
    witness: SIDE.LEILA,
    reinterpretedBy: SIDE.ROOK,
  },
  {
    at: "04:08",
    location: LOCATION.RELAY_K17,
    summary: "Both find evidence of paired strike packages",
    witness: "both",
  },
  {
    at: "04:14",
    location: LOCATION.RELAY_K17,
    summary: "First direct radio confrontation",
    witness: "both",
  },
  {
    at: "04:20",
    location: LOCATION.RELAY_K17,
    summary: "Separate routes toward Ardavan",
    witness: "both",
  },
  {
    at: "05:05",
    location: LOCATION.ARDAVAN,
    summary: "Rook enters through seawater intake",
    witness: SIDE.ROOK,
  },
  {
    at: "05:09",
    location: LOCATION.ARDAVAN,
    summary: "Leila enters through controlled access",
    witness: SIDE.LEILA,
  },
  {
    at: "05:28",
    location: LOCATION.ARDAVAN,
    summary: "Each sabotages one launch branch",
    witness: "both",
  },
  {
    at: "05:37",
    location: LOCATION.ARDAVAN,
    summary: "Orison attempts manual launch",
    witness: "both",
  },
  {
    at: "05:44",
    location: LOCATION.ARDAVAN,
    summary: "Primary strikes prevented",
    witness: "both",
  },
  {
    at: "05:48",
    location: LOCATION.ARDAVAN,
    summary: "Evidence transmission begins",
    witness: "both",
  },
  {
    at: "05:52",
    location: LOCATION.ARDAVAN,
    summary: "Nightcell interrupts upload",
    witness: "both",
  },
  {
    at: "05:55",
    location: LOCATION.ARDAVAN,
    summary: "Sunrise and Complete Truth setup",
    witness: "both",
  },
];

/** Timeline entries a player has legitimately witnessed, given completed sides. */
export function visibleTimeline(completedSides: readonly SideId[]): readonly TimelineEvent[] {
  if (completedSides.length === 0) return [];
  return SHARED_TIMELINE.filter(
    (event) => event.witness === "both" || completedSides.includes(event.witness),
  );
}
