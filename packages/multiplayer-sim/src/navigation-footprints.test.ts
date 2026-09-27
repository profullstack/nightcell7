import { describe, expect, it } from "vitest";
import { MAPS } from "./map";
import { GroundNavigator } from "./navigation";
import { rayAabb } from "./hitscan";
import { distance, normalize, sub } from "./vec";

describe("coalesced ground navigation", () => {
  for (const map of Object.values(MAPS))
    it(`${map.displayName}: retains the exact obstacle footprint`, () => {
      const nav = new GroundNavigator(map);
      const raw = map.boxes
        .filter((b) => b.max.y > 0.4 && b.min.y < 1.8)
        .map((b) => ({
          min: { x: b.min.x - 0.43, y: -1, z: b.min.z - 0.43 },
          max: { x: b.max.x + 0.43, y: 2, z: b.max.z + 0.43 },
        }));
      let seed = 8127;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 1000; i++) {
        const from = { x: random() * 76 - 38, y: 0, z: random() * 116 - 58 };
        const to = { x: random() * 76 - 38, y: 0, z: random() * 116 - 58 };
        const direction = normalize(sub(to, from));
        const expected = !raw.some((b) => rayAabb(from, direction, b, distance(from, to)));
        expect(nav.clear(from, to)).toBe(expected);
      }
    });
});
