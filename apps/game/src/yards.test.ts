import { describe, expect, it } from "vitest";
import { ARDAVAN_YARD, collides, playerAabb, mapChecksum } from "@nightcell7/multiplayer-sim";
import { GroundNavigator } from "../../../packages/multiplayer-sim/src/navigation";
import { YARDS, preferredYard, rememberYard } from "./yards";
import { SANDBOX_GOD_SPAWNS, SANDBOX_HEALTH_SPAWNS } from "./sandbox-rules";
import { EXTRA_YARD_RANGE_POSITIONS } from "./targets";

describe("additional playable yards", () => {
  for (const { map } of YARDS.slice(1)) {
    it(`${map.displayName}: spawns, supplies and range targets are clear and connected`, () => {
      const nav = new GroundNavigator(map);
      const points = [
        ...map.spawns.map((s) => s.position),
        ...SANDBOX_GOD_SPAWNS,
        ...SANDBOX_HEALTH_SPAWNS,
        ...EXTRA_YARD_RANGE_POSITIONS.map(([x, z]) => ({ x, y: 0, z })),
      ];
      for (const point of points) {
        expect(collides(playerAabb(point, false), map), JSON.stringify(point)).toBe(false);
        const route = nav.path(map.spawns[0]!.position, point);
        expect(route.at(-1), JSON.stringify(point)).toEqual(point);
      }
      expect(mapChecksum(map)).not.toBe(mapChecksum(ARDAVAN_YARD));
    });
  }
  it("uses a valid link before storage and rejects unknown / inherited-property IDs", () => {
    const storage = { getItem: () => "saffron_freight" } as unknown as Storage;
    expect(preferredYard("?yard=nacre_relay", storage).id).toBe("nacre_relay");
    expect(preferredYard("", storage).id).toBe("saffron_freight");
    expect(preferredYard("?yard=constructor", storage)).toBe(ARDAVAN_YARD);
    expect(preferredYard("?mode=multiplayer&yard=nacre_relay", storage)).toBe(ARDAVAN_YARD);
  });
  it("works when browser storage is blocked", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(preferredYard("", storage)).toBe(ARDAVAN_YARD);
    expect(() => rememberYard("nacre_relay", storage)).not.toThrow();
  });
});
