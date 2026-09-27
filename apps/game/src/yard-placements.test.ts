import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LoadAssetContainerAsync, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { MAPS } from "@nightcell7/multiplayer-sim";
import { placeAll } from "./assets";
import { HELICOPTER_ROTATION, stairPlacements } from "./yard-placements";

describe("imported yard geometry agrees with shared collision", () => {
  it("places the high end of every rendered stair at its uphill collision endpoint", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const model = await LoadAssetContainerAsync(
        new Uint8Array(readFileSync(`${__dirname}/../public/assets/models/m3_access_stair.glb`)),
        scene,
        { pluginExtension: ".glb" },
      );
      for (const map of Object.values(MAPS))
        for (const flight of map.stairs ?? []) {
          const placements = stairPlacements(flight);
          const roots = placeAll(model, "test-stair", placements);
          for (const [i, root] of roots.entries()) {
            const expectedY = (flight.height * (i + 1)) / roots.length;
            const expectedZ =
              flight.startZ + ((flight.endZ - flight.startZ) * (i + 1)) / roots.length;
            const high: Vector3[] = [];
            for (const mesh of root.getChildMeshes()) {
              if (!mesh.name.includes("ir_plaster")) continue;
              mesh.computeWorldMatrix(true);
              const positions = mesh.getVerticesData("position")!;
              for (let v = 0; v < positions.length; v += 3) {
                const world = Vector3.TransformCoordinates(
                  Vector3.FromArray(positions, v),
                  mesh.getWorldMatrix(),
                );
                if (Math.abs(world.y - expectedY) < 0.02) high.push(world);
              }
            }
            expect(high.length).toBeGreaterThan(0);
            const uphillZ = (flight.endZ > flight.startZ ? Math.max : Math.min)(
              ...high.map((v) => v.z),
            );
            // The bevel and quantized vertex positions allow centimetre relief.
            expect(Math.abs(uphillZ - expectedZ)).toBeLessThan(0.02);
          }
          roots.forEach((root) => root.dispose());
        }
      model.dispose();
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("aligns the imported helicopter tail proxy with the separate shared solid", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const model = await LoadAssetContainerAsync(
        new Uint8Array(readFileSync(`${__dirname}/../public/assets/models/m3_helicopter.glb`)),
        scene,
        { pluginExtension: ".glb" },
      );
      for (const map of Object.values(MAPS)) {
        const body = map.boxes.find((box) => box.tag === "helicopter")!;
        const tail = map.boxes.find((box) => box.tag === "helicopter_tail")!;
        const [root] = placeAll(model, "test-aircraft", [
          {
            position: new Vector3((body.min.x + body.max.x) / 2, 0, (body.min.z + body.max.z) / 2),
            rotationY: HELICOPTER_ROTATION,
          },
        ]);
        const mesh = root!.getChildMeshes().find((mesh) => mesh.name.includes("COL_tail"))!;
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo().boundingBox;
        for (const axis of ["x", "y", "z"] as const) {
          expect(bounds.minimumWorld[axis]).toBeCloseTo(tail.min[axis], 2);
          expect(bounds.maximumWorld[axis]).toBeCloseTo(tail.max[axis], 2);
        }
        root!.dispose();
      }
      model.dispose();
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
