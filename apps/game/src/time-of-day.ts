/**
 * Time of day for a battle.
 *
 * The yard shipped as a single lighting rig — the false dawn the episode is
 * named for — hard-coded into `world.ts`. This lifts the handful of values
 * that actually differ into a table so the gate can offer a day fight as well,
 * without a second scene, a second map or a second set of art.
 *
 * **Night is the shipped look, value for value.** Every number under
 * `TIME_OF_DAY.NIGHT` below is the constant it replaced, so choosing night
 * renders exactly what the game rendered before this file existed. That is the
 * point: a lighting option is only safe to add if the existing option is
 * provably unchanged, and a reviewer can check that by diffing these numbers
 * against the previous `buildWorld`.
 *
 * This is not a day/night *cycle*. Time is chosen once, before the match, and
 * held for its duration — a cycle would mean re-baking shadows mid-fight and
 * would make the night-only ambience (see `insects.ts`) pop in and out.
 */

export const TIME_OF_DAY = {
  /** The false dawn. The shipped look. */
  NIGHT: "night",
  /** Overhead sun, clear air, hard shadows. */
  DAY: "day",
} as const;

export type TimeOfDay = (typeof TIME_OF_DAY)[keyof typeof TIME_OF_DAY];

export interface TimeOfDayInfo {
  readonly id: TimeOfDay;
  readonly name: string;
  /** One line on the gate. Says what the player will actually meet. */
  readonly blurb: string;
}

export const TIMES_OF_DAY: readonly TimeOfDayInfo[] = [
  {
    id: TIME_OF_DAY.NIGHT,
    name: "Night",
    blurb:
      "The false dawn on the north horizon. Long shadows, sodium light — and the insects are out.",
  },
  {
    id: TIME_OF_DAY.DAY,
    name: "Day",
    blurb:
      "Overhead sun and clear air. Longer sightlines and nowhere near as much cover in the dark.",
  },
];

/** Night, because that is what the game looked like before the option existed. */
export const DEFAULT_TIME_OF_DAY: TimeOfDay = TIME_OF_DAY.NIGHT;

/** Storage key for the last time chosen, so the gate reopens where you left it. */
const STORAGE_KEY = "nc7.time";

function isTimeOfDay(value: string | null): value is TimeOfDay {
  return TIMES_OF_DAY.some((entry) => entry.id === value);
}

/**
 * Which time to preselect.
 *
 * `?time=` first so a link can open a specific lighting condition — useful for
 * a bug report or a capture — and the remembered choice second. Mirrors
 * `modes.ts`'s `preferredMode` deliberately: two pickers on the same gate that
 * remember themselves differently is a bug report waiting to happen.
 */
export function preferredTimeOfDay(search: string, storage?: Storage): TimeOfDay {
  const requested = new URLSearchParams(search).get("time");
  if (isTimeOfDay(requested)) return requested;

  try {
    const remembered = storage?.getItem(STORAGE_KEY) ?? null;
    if (isTimeOfDay(remembered)) return remembered;
  } catch {
    // Private browsing and blocked storage both throw on access rather than
    // returning null. A forgotten preference is not worth failing a boot over.
  }

  return DEFAULT_TIME_OF_DAY;
}

/** Remember the chosen time. Failure here is never worth interrupting play. */
export function rememberTimeOfDay(time: TimeOfDay, storage?: Storage): void {
  try {
    storage?.setItem(STORAGE_KEY, time);
  } catch {
    // As above.
  }
}

export function timeOfDayInfo(time: TimeOfDay): TimeOfDayInfo {
  return TIMES_OF_DAY.find((entry) => entry.id === time) ?? TIMES_OF_DAY[0]!;
}

// --------------------------------------------------------------- the rig

export type Rgb = readonly [number, number, number];

export interface DirectionalRig {
  /** Direction the light travels, not the direction to the light. */
  readonly direction: Rgb;
  readonly position: Rgb;
  readonly intensity: number;
  readonly diffuse: Rgb;
  readonly specular: Rgb;
}

export interface LightingRig {
  readonly clearColor: Rgb;
  readonly ambientColor: Rgb;
  readonly fogDensity: number;
  readonly fogColor: Rgb;
  /** Sky dome gradient, zenith to horizon, as CSS colours. */
  readonly sky: readonly [string, string, string];
  /** Colour of the haze bands drawn across the sky dome. */
  readonly skyBand: string;
  readonly hemispheric: {
    readonly intensity: number;
    readonly diffuse: Rgb;
    readonly ground: Rgb;
    readonly specular: Rgb;
  };
  readonly key: DirectionalRig;
  readonly rim: DirectionalRig;
  readonly shadowDarkness: number;
  /** Bloom strength. Daylight washes out a glow layer that reads well at night. */
  readonly glowIntensity: number;
  /** Whether ambient insects spawn. Fireflies and mosquitos are nocturnal. */
  readonly insects: boolean;
}

export const LIGHTING: Record<TimeOfDay, LightingRig> = {
  [TIME_OF_DAY.NIGHT]: {
    clearColor: [0.027, 0.035, 0.047],
    ambientColor: [0.14, 0.17, 0.22],
    fogDensity: 0.0045,
    fogColor: [0.4, 0.47, 0.52],
    sky: ["#263d54", "#697c89", "#b7b7ac"],
    skyBand: "28,43,58",
    hemispheric: {
      intensity: 2.0,
      diffuse: [0.62, 0.7, 0.82],
      ground: [0.27, 0.3, 0.32],
      specular: [0.16, 0.2, 0.26],
    },
    key: {
      direction: [0.45, -0.65, 0.55],
      position: [-10, 26, -95],
      intensity: 2.1,
      diffuse: [0.94, 0.97, 1],
      specular: [0.9, 0.75, 0.5],
    },
    rim: {
      direction: [-0.25, -0.35, -1],
      position: [20, 30, 90],
      intensity: 0.55,
      diffuse: [0.4, 0.58, 0.78],
      specular: [0.5, 0.68, 0.85],
    },
    shadowDarkness: 0.55,
    glowIntensity: 0.55,
    insects: true,
  },

  [TIME_OF_DAY.DAY]: {
    // Lifted well off the ink, but still the same yard: this is a hazy
    // industrial morning, not a bright blue afternoon that would fight the
    // rest of the art direction.
    clearColor: [0.46, 0.55, 0.63],
    ambientColor: [0.34, 0.37, 0.4],
    // Clear air carries further than night haze, which is most of what makes
    // the day fight play differently — the far perimeter is actually visible.
    fogDensity: 0.0024,
    fogColor: [0.66, 0.72, 0.78],
    sky: ["#4d7fb5", "#9fc0dc", "#d8dfe2"],
    skyBand: "255,255,255",
    hemispheric: {
      intensity: 2.6,
      diffuse: [0.86, 0.9, 0.98],
      ground: [0.42, 0.4, 0.36],
      specular: [0.3, 0.33, 0.38],
    },
    key: {
      // High and slightly south: short shadows, and both teams' faces lit.
      direction: [0.35, -0.92, 0.28],
      position: [-20, 70, -60],
      intensity: 3.4,
      diffuse: [1, 0.98, 0.93],
      specular: [1, 0.96, 0.86],
    },
    rim: {
      direction: [-0.25, -0.35, -1],
      position: [20, 30, 90],
      intensity: 0.35,
      diffuse: [0.6, 0.7, 0.85],
      specular: [0.45, 0.55, 0.7],
    },
    // Crisper than night: a soft shadow under a high sun reads as a smudge.
    shadowDarkness: 0.35,
    // Not zero — the lamps and tracers still want a little bloom — but a night
    // glow strength in daylight turns every bright surface into a halo.
    glowIntensity: 0.18,
    insects: false,
  },
};
