import { describe, expect, it } from "vitest";
import { ARDAVAN_YARD } from "@nightcell7/multiplayer-sim";
import { VANTAGES } from "./photo";

describe("marketing photo viewpoints", () => {
  it("keeps every camera outside solid map geometry", () => {
    for (const vantage of VANTAGES) {
      const [x, y, z] = vantage.position;
      const obstructed = ARDAVAN_YARD.boxes.some(
        ({ min, max }) =>
          x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z,
      );
      expect(obstructed, `${vantage.name} camera is inside a solid`).toBe(false);
    }
  });
});
