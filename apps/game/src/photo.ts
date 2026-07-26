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
}

export const VANTAGES: readonly Vantage[] = [
  {
    name: "yard-approach",
    caption:
      "The approach from the Nightcell muster point, looking north up the centre lane toward the false dawn.",
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
    caption:
      "Pushing north off the central hard point. Container colour encodes the contested axis — cyan is Directorate ground — so the lane is legible without a minimap.",
    position: [-17, 1.7, 15],
    yaw: Math.PI * 0.88,
    pitch: 0.02,
  },
  {
    name: "gantry-overlook",
    caption: "From the east gantry, looking back across the container yard under the sodium masts.",
    position: [30, 8.1, -14],
    yaw: Math.PI * 1.32,
    pitch: 0.2,
    fovDegrees: 82,
  },
  {
    name: "north-gate",
    caption: "The Directorate end of the yard, looking into the first light beyond the north wall.",
    position: [0, 1.7, -22],
    yaw: Math.PI,
    pitch: 0.06,
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
