import { describe, expect, it } from "vitest";
import { MAPS } from "./map";
import { createMovementState, stepMovement, collides, playerAabb } from "./movement";

// Exercise real movement, not merely the authored step sizes: a stair may have
// valid risers and still be blocked by a tank, prop, overhang or landing gap.
describe("yard stair routes", () => {
  for (const map of Object.values(MAPS)) {
    for (const [index, flight] of (map.stairs ?? []).entries()) {
      it(`${map.displayName} flight ${index}: walk up without jumping and return`, () => {
        const direction = Math.sign(flight.endZ - flight.startZ);
        const yaw = direction > 0 ? 0 : Math.PI;
        let state = createMovementState({ x: flight.x, y: 0, z: flight.startZ - direction }, yaw);
        const advance = (forward: number) => {
          state = stepMovement(
            state,
            {
              seq: 1,
              dtMs: 1000 / 60,
              moveX: 0,
              moveZ: forward,
              yaw,
              pitch: 0,
              buttons: 0,
              clientTimeMs: 0,
            },
            map,
          );
          expect(collides(playerAabb(state.position, false), map)).toBe(false);
        };
        for (let i = 0; i < 600 && direction * (state.position.z - flight.endZ) < -0.2; i++)
          advance(1);
        expect(state.position.y).toBeGreaterThan(flight.height - 0.3);
        expect(direction * (state.position.z - flight.endZ)).toBeGreaterThan(-0.3);
        for (let i = 0; i < 600 && direction * (state.position.z - flight.startZ) > -1; i++)
          advance(-1);
        for (let i = 0; i < 60; i++) advance(0);
        expect(state.position.y).toBeLessThan(0.1);
      });
    }
  }
});
