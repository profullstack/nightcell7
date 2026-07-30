import { describe, expect, it } from "vitest";
import { ARDAVAN_YARD, mapChecksum, type MapVolume } from "./map";

/**
 * Guards for the tagged prop volumes.
 *
 * These props began life as art only — vehicles and T-walls staged behind the
 * spawns, deliberately outside the lanes so they could never become cover a
 * player trusts and then dies behind. That was the wrong trade: players run
 * *into* the map, so anything behind the spawn is something nobody ever sees.
 *
 * Promoting them to real collision fixes the visibility problem and keeps
 * `world.ts`'s first rule — what you see is what you collide with — but it puts
 * solid geometry in the lanes, which is a gameplay change. These tests hold the
 * invariants that make that safe.
 */

const props = ARDAVAN_YARD.boxes.filter((b): b is MapVolume & { tag: string } => Boolean(b.tag));

function overlaps(a: MapVolume, b: MapVolume): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

describe("tagged prop volumes", () => {
  it("ships the props the client knows how to draw", () => {
    // A tag the client has no model for renders nothing, leaving invisible
    // collision — the exact bug this whole change exists to fix, inverted.
    const known = new Set([
      "vehicle_armored_car",
      "vehicle_technical",
      "barrier",
      "water_tank",
      "barrel_stack",
      "tent",
      "guard_tower",
    ]);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      expect(known, `unknown tag ${p.tag}`).toContain(p.tag);
    }
  });

  it("sits inside the playable bounds", () => {
    for (const p of props) {
      expect(p.min.x, p.tag).toBeGreaterThanOrEqual(ARDAVAN_YARD.bounds.min.x);
      expect(p.max.x, p.tag).toBeLessThanOrEqual(ARDAVAN_YARD.bounds.max.x);
      expect(p.min.z, p.tag).toBeGreaterThanOrEqual(ARDAVAN_YARD.bounds.min.z);
      expect(p.max.z, p.tag).toBeLessThanOrEqual(ARDAVAN_YARD.bounds.max.z);
    }
  });

  it("rests on the ground rather than floating", () => {
    // A prop drawn at its volume floor but specified above ground would hover.
    for (const p of props) {
      expect(p.min.y, p.tag).toBe(0);
      expect(p.max.y, p.tag).toBeGreaterThan(0.5);
    }
  });

  it("never overlaps another collision volume", () => {
    // Two solids in the same space produce geometry a player can be pushed
    // into, and z-fighting where the models intersect.
    for (const p of props) {
      for (const other of ARDAVAN_YARD.boxes) {
        if (other === p) continue;
        // The ground slab is beneath everything by design.
        if (other.max.y <= 0) continue;
        expect(overlaps(p, other), `${p.tag} overlaps another volume`).toBe(false);
      }
    }
  });

  it("never blocks a spawn point", () => {
    // Spawning inside a solid is the worst possible outcome of this change.
    for (const spawn of ARDAVAN_YARD.spawns) {
      for (const p of props) {
        const inside =
          spawn.position.x > p.min.x - 1 &&
          spawn.position.x < p.max.x + 1 &&
          spawn.position.z > p.min.z - 1 &&
          spawn.position.z < p.max.z + 1;
        expect(inside, `${p.tag} blocks spawn ${spawn.label}`).toBe(false);
      }
    }
  });

  it("stays out of the protected spawn ends", () => {
    // Cover belongs in the contested middle. Solid geometry at the spawn ends
    // would give whichever team spawns there a free position.
    for (const p of props) {
      const centreZ = (p.min.z + p.max.z) / 2;
      expect(Math.abs(centreZ), `${p.tag} is in a spawn end`).toBeLessThan(36);
    }
  });
});

describe("tags are cosmetic", () => {
  it("does not let a tag change the checksum", () => {
    // The tag tells the client what to draw. Two clients disagreeing about a
    // model is cosmetic; disagreeing about where the solid is is not — so the
    // tag must stay out of the handshake, or a purely visual change would lock
    // players out of a match.
    const retagged = {
      ...ARDAVAN_YARD,
      boxes: ARDAVAN_YARD.boxes.map((b) => (b.tag ? { ...b, tag: "barrier" as const } : b)),
    };
    expect(mapChecksum(retagged)).toBe(mapChecksum(ARDAVAN_YARD));
  });

  it("still changes the checksum when a prop moves", () => {
    const moved = {
      ...ARDAVAN_YARD,
      boxes: ARDAVAN_YARD.boxes.map((b) =>
        b.tag ? { ...b, min: { ...b.min, x: b.min.x + 1 } } : b,
      ),
    };
    expect(mapChecksum(moved)).not.toBe(mapChecksum(ARDAVAN_YARD));
  });
});
