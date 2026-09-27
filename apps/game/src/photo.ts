/**
 * Photo mode.
 *
 * A fixed set of named vantage points inside Ardavan Yard, selected with
 * `?photo=<name>`. This exists so marketing captures and lighting regressions
 * are reproducible: every published screenshot can be regenerated from a commit
 * plus a name, instead of someone hand-flying a camera and never finding the
 * same framing twice.
 *
 * Nothing here changes the simulation. Eye-level frames show playable routes;
 * explicitly captioned overview frames use elevated survey cameras.
 */

export interface Vantage {
  readonly name: string;
  readonly yard?: string;
  readonly time?: "day" | "night";
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
  {
    name: "saffron-overview",
    caption:
      "Saffron Freight: amber cargo islands and staggered crosscuts, seen from above the south flank.",
    yard: "saffron_freight",
    time: "day",
    position: [32, 11, 38],
    yaw: -2.5,
    pitch: 0.23,
    fovDegrees: 74,
  },
  {
    name: "saffron-crosscut",
    caption: "Saffron Freight: a close approach through the cargo lanes.",
    yard: "saffron_freight",
    time: "day",
    position: [1, 1.7, 22],
    yaw: -2.55,
    pitch: 0.01,
    showWeapon: true,
  },
  {
    name: "saffron-detail",
    caption:
      "Saffron freight module: corrugated amber panels, rivets, hazard stripes and sector markings.",
    yard: "saffron_freight",
    time: "day",
    position: [1, 2.2, 28],
    yaw: -1.8,
    pitch: 0.02,
    fovDegrees: 60,
  },
  {
    name: "saffron-night",
    caption: "Saffron Freight after dark, with floodlights across the open flank.",
    yard: "saffron_freight",
    time: "night",
    position: [32, 8, 38],
    yaw: -2.5,
    pitch: 0.16,
    fovDegrees: 74,
  },
  {
    name: "nacre-overview",
    caption:
      "Nacre Relay: four relay houses frame an open central plaza and connected outer lanes.",
    yard: "nacre_relay",
    time: "day",
    position: [32, 11, 38],
    yaw: -2.5,
    pitch: 0.23,
    fovDegrees: 74,
  },
  {
    name: "nacre-plaza",
    caption: "Nacre Relay: the exposed plaza between the ivory and jade relay houses.",
    yard: "nacre_relay",
    time: "day",
    position: [6, 1.7, 6],
    yaw: -2.0,
    pitch: 0.01,
    showWeapon: true,
  },
  {
    name: "nacre-detail",
    caption:
      "Nacre relay house: ceramic panels, jade signal bands, ventilation and NR identification plates.",
    yard: "nacre_relay",
    time: "day",
    position: [7, 2.2, 29],
    yaw: 2.1,
    pitch: 0.01,
    fovDegrees: 60,
  },
  {
    name: "nacre-night",
    caption: "Nacre Relay at night: lit relay houses across the south approach.",
    yard: "nacre_relay",
    time: "night",
    position: [32, 8, 38],
    yaw: -2.5,
    pitch: 0.16,
    fovDegrees: 74,
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
