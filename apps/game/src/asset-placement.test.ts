import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TransformNode } from "@babylonjs/core";
import { NullEngine, Scene, LoadAssetContainerAsync, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { placeAll, placeAnimated } from "./assets";

async function load(scene: Scene, name: string) {
  return LoadAssetContainerAsync(
    new Uint8Array(readFileSync(join(__dirname, "../public/assets/models", `${name}.glb`))),
    scene,
    { pluginExtension: ".glb" },
  );
}

describe("runtime GLB placement", () => {
  it("rotates and scales cover without overwriting the imported coordinate transform", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const container = await load(scene, "m3_low_cover");
      for (const mesh of [...container.meshes])
        if (mesh.name.startsWith("COL_")) {
          container.meshes.splice(container.meshes.indexOf(mesh), 1);
          mesh.dispose();
        }
      const [root] = placeAll(container, "cover", [
        { position: new Vector3(10, 0, 31), rotationY: Math.PI / 2, scaling: new Vector3(2, 1, 1) },
      ]);
      root!.computeWorldMatrix(true);
      for (const child of root!.getChildMeshes()) child.computeWorldMatrix(true);
      const { min, max } = root!.getHierarchyBoundingVectors(true);
      const size = max.subtract(min);
      expect(size.x).toBeCloseTo(0.78, 2);
      expect(size.z).toBeCloseTo(2.4 * 2, 2);
      expect((min.x + max.x) / 2).toBeCloseTo(10, 2);
      expect((min.z + max.z) / 2).toBeCloseTo(31, 2);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("keeps the carbine muzzle forward at first-person scale", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const [root] = placeAll(await load(scene, "m2_carbine_fp"), "view", [
        { position: new Vector3(0.21, -0.185, 0.324), scaling: new Vector3(0.525, 0.525, 0.525) },
      ]);
      const muzzle = root!
        .getDescendants()
        .find((n) => n.name.includes("SOCKET_MUZZLE")) as TransformNode;
      muzzle.computeWorldMatrix(true);
      expect(muzzle.getAbsolutePosition().z).toBeCloseTo(0.324 + 0.612 * 0.525, 3);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("retains animated rigs and hand sockets after cloning", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      for (const name of [
        "m3_operator_directorate",
        "m3_operator_directorate",
        "m3_operator_nightcell",
      ]) {
        const placed = placeAnimated(await load(scene, name), name, {
          position: new Vector3(4, 0, 5),
          rotationY: 0.7,
        });
        expect(placed).not.toBeNull();
        const hand = placed!.root
          .getDescendants()
          .find((n) => n.name.includes("SOCKET_WEAPON")) as TransformNode;
        expect(hand).toBeDefined();
        for (const clip of ["idle", "walk", "run"]) {
          const group = placed!.clips.get(clip);
          expect(group, `${name} ${clip}`).toBeDefined();
          group!.start(true);
          group!.goToFrame((group!.from + group!.to) / 2);
          hand.computeWorldMatrix(true);
          expect(hand.getAbsolutePosition().asArray().every(Number.isFinite)).toBe(true);
          group!.stop();
        }
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
