/**
 * Photo mode.
 *
 * A fixed set of named vantage points inside Ardavan Yard, selected with
 * `?photo=<name>`. This exists so marketing captures and lighting regressions
 * are reproducible: every published screenshot can be regenerated from a commit
 * plus a name, instead of someone hand-flying a camera and never finding the
 * same framing twice.
 *
 * Nothing here changes the map or the simulation. The camera is placed at eye
 * height in the real playable volume, so a photo-mode frame is a view a player
 * can actually stand in and see.
 */

export interface Vantage {
  readonly name: string;
  /** Short line used in the capture manifest and the site's alt text. */
  readonly caption: string;
  readonly position: readonly [number, number, number];
  /** Radians. Yaw is measured from +Z, matching the simulation. */
  readonly yaw: number;
  readonly pitch: number;
  readonly fovDegrees?: number;
  /** Include the actual first-person rig in selected gameplay plates. */
  readonly showWeapon?: boolean;
}

export const VANTAGES: readonly Vantage[] = [
  {
    name: "yard-approach",
    caption: "Looking north from the Nightcell end of the yard, toward the hardpoint.",
    showWeapon: true,
    position: [0, 1.7, 44],
    yaw: Math.PI,
    pitch: 0.02,
  },
  {
    name: "west-catwalk",
    caption:
      "The west catwalk above the pipe rack — one of the yard's two vertical routes, and the only place both spawn markers are visible at once.",
    position: [-28, 8.1, 24],
    yaw: Math.PI * 0.86,
    pitch: 0.14,
  },
  {
    name: "tank-row",
    caption:
      "The east lane, running between the storage tanks and the perimeter with the gantry deck overhead.",
    position: [34, 1.7, 14],
    yaw: Math.PI,
    pitch: 0.03,
    fovDegrees: 78,
  },
  {
    name: "central-hardpoint",
    caption: "The hardpoint in the middle of the yard. Whoever holds it holds the centre lane.",
    showWeapon: true,
    position: [-17, 1.7, 15],
    yaw: Math.PI * 0.88,
    pitch: 0.02,
  },
  {
    name: "gantry-overlook",
    caption: "From the east gantry, looking back across the containers under the floodlights.",
    position: [30, 8.1, -14],
    yaw: Math.PI * 1.32,
    pitch: 0.2,
    fovDegrees: 82,
  },
  {
    name: "north-gate",
    caption: "The Directorate end of the yard, by the north gate.",
    position: [0, 1.7, -22],
    yaw: Math.PI,
    pitch: 0.06,
  },
  {
    name: "pipe-rack-run",
    caption:
      "The west lane pipe rack, looking south under the catwalk. Cover here is continuous but low, so the lane rewards movement over holding an angle.",
    position: [-20, 1.7, -22],
    yaw: 0,
    pitch: 0.04,
    fovDegrees: 80,
  },
  {
    name: "container-alley",
    caption: "Between the north containers, where both sides meet in the first seconds of a match.",
    position: [0, 1.7, -8],
    yaw: Math.PI,
    pitch: 0.0,
    fovDegrees: 74,
  },
  {
    name: "muster-point",
    caption:
      "The Nightcell muster point at the southern gate, where a squad forms up before pushing into the yard.",
    position: [0, 1.7, 52],
    yaw: Math.PI,
    pitch: 0.05,
    fovDegrees: 84,
  },
  {
    name: "under-the-gantry",
    caption:
      "Beneath the east gantry, looking up the tank row. Holding the deck overhead means giving up the lane below it.",
    position: [27, 1.7, 6],
    yaw: Math.PI * 1.04,
    pitch: 0.22,
    fovDegrees: 80,
  },
];

export function vantageByName(name: string): Vantage | undefined {
  return VANTAGES.find((v) => v.name === name);
}

/** Reads `?photo=<name>` from the current URL. */
export function requestedVantage(search: string): Vantage | undefined {
  const name = new URLSearchParams(search).get("photo");
  return name ? vantageByName(name) : undefined;
}
