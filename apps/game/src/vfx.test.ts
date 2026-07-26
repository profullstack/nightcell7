import { ARDAVAN_YARD } from "@nightcell7/multiplayer-sim";
import { describe, expect, it } from "vitest";
import { traceShot } from "./vfx";

/**
 * Ballistics for the weapon effects.
 *
 * Only the pure part is tested: `WeaponEffects` needs a GPU context, but the
 * decision of *where a round lands* does not, and that is the part that can be
 * silently wrong. A tracer that ends in the wrong place looks like a netcode
 * bug rather than an art bug, so it is worth pinning down.
 *
 * Every expectation below is derived from the real ARDAVAN_YARD collision map,
 * so these also fail if the map changes shape underneath the effects. Note the
 * central hard point (x -6..6, z -4..4, 2.6 m tall) blocks the middle of the
 * centre lane — the first draft of this file assumed that lane was open and
 * asserted against the perimeter wall behind it.
 */

const EYE_HEIGHT = 1.65;

describe("traceShot", () => {
  it("stops on the central hard point when firing up the centre lane", () => {
    const trace = traceShot({ x: 0, y: EYE_HEIGHT, z: 40 }, { x: 0, y: 0, z: -1 }, ARDAVAN_YARD);

    expect(trace.hit).toBe(true);
    // South face of the hard point, 36 m away — not the perimeter behind it.
    expect(trace.point.z).toBeCloseTo(4, 3);
    expect(trace.distance).toBeCloseTo(36, 3);
  });

  it("stops at the first thing in the way, not the last", () => {
    // A container stack sits at x -8..-2, z 14..20. Firing north from behind
    // it must land on its near face rather than punching through to the hard
    // point or the wall beyond.
    const trace = traceShot({ x: -5, y: EYE_HEIGHT, z: 30 }, { x: 0, y: 0, z: -1 }, ARDAVAN_YARD);

    expect(trace.hit).toBe(true);
    expect(trace.point.z).toBeCloseTo(20, 3);
    expect(trace.distance).toBeCloseTo(10, 3);
  });

  it("hits the ground when fired downward", () => {
    const trace = traceShot({ x: 0, y: EYE_HEIGHT, z: 30 }, { x: 0, y: -1, z: 0 }, ARDAVAN_YARD);

    expect(trace.hit).toBe(true);
    // The ground slab's top face is y = 0.
    expect(trace.point.y).toBeCloseTo(0, 3);
    expect(trace.distance).toBeCloseTo(EYE_HEIGHT, 3);
  });

  it("falls back to max range when the shot leaves the map", () => {
    // Straight up from open ground: the yard has no roof, and neither the west
    // catwalk (x -32..-24) nor the east gantry (x 24..32) is overhead at x = 0.
    const trace = traceShot(
      { x: 0, y: EYE_HEIGHT, z: 30 },
      { x: 0, y: 1, z: 0 },
      ARDAVAN_YARD,
      200,
    );

    expect(trace.hit).toBe(false);
    expect(trace.distance).toBe(200);
    // A miss must still produce an end point, or the tracer has nowhere to
    // draw to and simply does not appear.
    expect(trace.point.y).toBeCloseTo(EYE_HEIGHT + 200, 3);
  });

  it("never reports a hit behind the shooter", () => {
    // The slab test clamps tMin at 0. A negative distance would draw a tracer
    // going backwards out of the player's head.
    for (const direction of [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ]) {
      const trace = traceShot({ x: 0, y: EYE_HEIGHT, z: 30 }, direction, ARDAVAN_YARD);
      expect(trace.distance).toBeGreaterThanOrEqual(0);
    }
  });
});
