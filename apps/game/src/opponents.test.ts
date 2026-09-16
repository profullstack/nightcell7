import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FreeCamera,
  LoadAssetContainerAsync,
  Mesh,
  NullEngine,
  Scene,
  Vector3,
  type AnimationGroup,
  type TransformNode,
} from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { type MatchSimulation, TEAM_IDS, TICK_MS } from "@nightcell7/multiplayer-sim";
import { Opponents } from "./opponents";
import { type AssetSet } from "./assets";

interface Inspection {
  sim: MatchSimulation;
  views: Map<
    string,
    { root: TransformNode; clips: Map<string, AnimationGroup>; friendly: boolean }
  >;
}

async function fixture() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  new FreeCamera("test-camera", new Vector3(0, 2, 20), scene);
  const models: AssetSet["models"] = new Map(
    await Promise.all(
      ["m2_operator_directorate", "m2_operator_nightcell", "m2_rifle", "m2_smg", "m2_grenade"].map(
        async (name) => {
          const container = await LoadAssetContainerAsync(
            new Uint8Array(readFileSync(join(__dirname, "../public/assets/models", `${name}.glb`))),
            scene,
            { pluginExtension: ".glb" },
          );
          return [name, container] as const;
        },
      ),
    ),
  ) as AssetSet["models"];
  const opponents = new Opponents(scene, { models, materials: new Map() });
  return {
    engine,
    scene,
    opponents,
    inspect: opponents as unknown as Inspection,
    dispose: () => {
      opponents.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

describe("public combat demo with shipped operator models", () => {
  it("spawns four real enemies and three friendlies at floor level before the gate opens", async () => {
    const f = await fixture();
    try {
      expect(f.inspect.views.size).toBe(7);
      for (const prefix of ["bot-e", "bot-f"]) {
        const positions = [...f.inspect.views]
          .filter(([id]) => id.startsWith(prefix))
          .map(([, v]) => v.root.position.asArray().join(","));
        expect(new Set(positions).size).toBe(positions.length);
      }
      for (const [id, view] of f.inspect.views) {
        const p = f.inspect.sim.players.get(id)!;
        const friendly = id.startsWith("bot-f");
        expect(p.team).toBe(friendly ? TEAM_IDS.NIGHTCELL : TEAM_IDS.DIRECTORATE);
        expect(view.friendly).toBe(friendly);
        expect(view.root.position.y).toBe(0);
        expect(view.root.position.x).toBe(p.movement.position.x);
        expect(
          view.root
            .getChildMeshes()
            .some((m) => m.getTotalVertices() > 0 && m.isEnabled() && m.isVisible),
        ).toBe(true);
      }
    } finally {
      f.dispose();
    }
  });

  it("keeps every cloned operator above ground and next to its hitbox throughout locomotion", async () => {
    const f = await fixture();
    try {
      for (const [id, view] of f.inspect.views) {
        const feet = f.inspect.sim.players.get(id)!.movement.position;
        const body = view.root
          .getChildMeshes()
          .filter(
            (m): m is Mesh =>
              m instanceof Mesh && m.getTotalVertices() > 0 && !m.name.includes("_weapon"),
          );
        for (const name of ["idle", "walk", "run"]) {
          for (const group of view.clips.values()) group.stop();
          const clip = view.clips.get(name)!;
          clip.start(true);
          for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
            clip.goToFrame(clip.from + (clip.to - clip.from) * fraction);
            for (const bone of f.scene.skeletons.flatMap((s) => s.bones))
              bone.getTransformNode()?.computeWorldMatrix(true);
            for (const skeleton of f.scene.skeletons) skeleton.prepare(true);
            let minY = Infinity,
              maxY = -Infinity;
            for (const mesh of body) {
              mesh.computeWorldMatrix(true);
              mesh.refreshBoundingInfo(true, true);
              const b = mesh.getBoundingInfo().boundingBox;
              minY = Math.min(minY, b.minimumWorld.y);
              maxY = Math.max(maxY, b.maximumWorld.y);
              expect(
                Math.abs(b.centerWorld.x - feet.x),
                `${id} ${name} detached body`,
              ).toBeLessThan(0.9);
              expect(
                Math.abs(b.centerWorld.z - feet.z),
                `${id} ${name} detached body`,
              ).toBeLessThan(0.9);
            }
            expect(minY, `${id} ${name} below floor`).toBeGreaterThan(feet.y - 0.18);
            expect(maxY, `${id} ${name} missing body`).toBeGreaterThan(feet.y + 1.6);
            expect(maxY).toBeLessThan(feet.y + 2.0);
          }
          clip.stop();
        }
      }
    } finally {
      f.dispose();
    }
  });

  it("takes rifle damage, stays down, then respawns once with fresh ammo on the simulation clock", async () => {
    const f = await fixture();
    try {
      const enemy = f.inspect.sim.players.get("bot-e0")!;
      for (const [id, p] of f.inspect.sim.players)
        if (id !== enemy.id) p.movement.position = { x: 30, y: 0, z: 40 };
      enemy.movement.position = { x: 0, y: 0, z: 9 };
      enemy.ammo[0]!.magazine = 0;
      enemy.ammo[0]!.reserve = 0;
      for (let n = 0; n < 3; n++)
        expect(
          f.opponents.tryHit({ x: 0, y: 1.1, z: 12 }, { x: 0, y: 0, z: -1 }, 6),
        ).not.toBeNull();
      expect(enemy.alive).toBe(false);
      for (let n = 0; n < 30; n++) f.opponents.update(TICK_MS, { x: 30, y: 0, z: 40 }, 0);
      expect(enemy.alive).toBe(false);
      for (let n = 0; n < 152; n++) f.opponents.update(TICK_MS, { x: 30, y: 0, z: 40 }, 0);
      expect(enemy.alive).toBe(true);
      expect(enemy.health).toBe(100);
      expect(enemy.ammo[0]!.reserve).toBeGreaterThan(0);
      expect(f.inspect.views.get(enemy.id)!.root.position.y).toBe(0);
    } finally {
      f.dispose();
    }
  });

  it("continues producing incoming fire and visible combatants during an extended demo", async () => {
    const f = await fixture();
    try {
      let shots = 0;
      for (let tick = 0; tick < 1800; tick++) {
        f.opponents.update(TICK_MS, { x: -11, y: 0, z: 18 }, 0);
        shots += f.opponents.drainShots().length;
      }
      expect(shots).toBeGreaterThan(5);
      expect(f.inspect.sim.phase).toBe("live");
      expect(
        [...f.inspect.sim.players.values()].filter((p) => p.isBot && p.alive).length,
      ).toBeGreaterThan(2);
    } finally {
      f.dispose();
    }
  });
});
