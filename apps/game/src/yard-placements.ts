import { Vector3 } from "@babylonjs/core";
import type { StairFlight } from "@nightcell7/multiplayer-sim";
import type { Placement } from "./assets";

// Measured after glTF handedness conversion in Babylon: native tail is -Z.
export const HELICOPTER_ROTATION = Math.PI;

export function stairPlacements(flight: StairFlight): Placement[] {
  const segments = Math.ceil(flight.height / 1.5);
  const length = (flight.endZ - flight.startZ) / segments;
  const rise = flight.height / segments;
  return Array.from({ length: segments }, (_, i) => ({
    position: new Vector3(flight.x, i * rise, flight.startZ + (i + 0.5) * length),
    // Native stair GLB rises towards +Z after importing into Babylon.
    rotationY: length < 0 ? Math.PI : 0,
    scaling: new Vector3(flight.width / 2, rise / 1.5, Math.abs(length) / 4),
  }));
}
