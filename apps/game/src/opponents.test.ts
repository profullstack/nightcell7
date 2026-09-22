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
import { BUTTON } from "@nightcell7/multiplayer-protocol";
import { type MatchSimulation, PICKUP_KIND, TEAM_IDS, TICK_MS } from "@nightcell7/multiplayer-sim";
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
      ["m3_operator_directorate", "m3_operator_nightcell", "m3_rifle", "m3_smg", "m3_grenade"].map(
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

  it("takes rifle damage through the simulation, drops its weapon, stays down, then respawns with fresh ammo", async () => {
    const f = await fixture();
    try {
      const enemy = f.inspect.sim.players.get("bot-e0")!;
      // Everyone else far away and disarmed, so only the player's rounds count.
      for (const [id, p] of f.inspect.sim.players) {
        if (id === enemy.id) continue;
        p.movement.position = { x: 30, y: 0, z: 40 };
        for (const ammo of p.ammo) {
          ammo.magazine = 0;
          ammo.reserve = 0;
        }
      }
      // Armed but unable to fire, so its drop has rounds in it.
      enemy.nextFireAtMs = Number.MAX_SAFE_INTEGER;
      // Past spawn protection.
      for (let n = 0; n < 50; n++) f.opponents.update(TICK_MS, { x: 30, y: 0, z: 40 }, 0);
      enemy.movement.position = { x: 0, y: 0, z: 9 };

      // Stand at z=12 and fire down -Z at the enemy 3 m away.
      const me = f.inspect.sim.players.get("local-player")!;
      for (const ammo of me.ammo) ammo.magazine = 30;
      const aim = Math.PI; // yaw measured from +Z, so π looks down -Z
      let shots = 0;
      for (let n = 0; n < 90 && enemy.alive; n++) {
        f.opponents.applyLocalInput({
          seq: n + 1,
          dtMs: TICK_MS,
          moveX: 0,
          moveZ: 0,
          yaw: aim,
          pitch: 0,
          buttons: BUTTON.FIRE,
          clientTimeMs: 0,
        });
        f.opponents.update(TICK_MS, { x: 0, y: 0, z: 12 }, aim);
        enemy.movement.position = { x: 0, y: 0, z: 9 };
        shots += f.opponents.drainLocalShots().filter((s) => s.point !== null).length;
      }
      expect(shots).toBeGreaterThan(0);
      expect(enemy.alive).toBe(false);
      // Its rifle is on the ground where it fell.
      expect([...f.inspect.sim.pickups.values()].some((p) => p.kind === PICKUP_KIND.WEAPON)).toBe(
        true,
      );

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

  it("lets the bots hurt the player, kills them, and redeploys them on the simulation clock", async () => {
    const f = await fixture();
    try {
      const me = f.inspect.sim.players.get("local-player")!;
      // Stand in front of an armed enemy with no cover.
      const enemy = f.inspect.sim.players.get("bot-e0")!;
      enemy.movement.position = { x: 0, y: 0, z: 9 };
      let damage = 0;
      let died = false;
      let respawn: { position: { x: number; y: number; z: number } } | null = null;
      for (let n = 0; n < 900 && !respawn; n++) {
        f.opponents.update(TICK_MS, { x: 0, y: 0, z: 14 }, Math.PI);
        damage += f.opponents.drainDamage();
        died = died || f.opponents.drainLocalDeath();
        respawn = f.opponents.drainLocalRespawn();
        if (!died) expect(f.opponents.localStatus().alive).toBe(me.alive);
      }
      expect(damage).toBeGreaterThan(0);
      expect(died).toBe(true);
      expect(respawn).not.toBeNull();
      expect(f.opponents.localStatus().alive).toBe(true);
      expect(f.opponents.localStatus().health).toBe(100);
    } finally {
      f.dispose();
    }
  });

  it("continues producing incoming fire and visible combatants during an extended demo", async () => {
    const f = await fixture();
    try {
      let shots = 0;
      const start = f.inspect.views.get("bot-e0")!.root.position.clone();
      let moved = false;
      let aliveSum = 0;
      for (let tick = 0; tick < 1800; tick++) {
        f.opponents.update(TICK_MS, { x: -11, y: 0, z: 18 }, 0);
        shots += f.opponents.drainShots().length;
        if (Vector3.Distance(start, f.inspect.views.get("bot-e0")!.root.position) > 1) moved = true;
        aliveSum += [...f.inspect.sim.players.values()].filter((p) => p.isBot && p.alive).length;
      }
      expect(shots).toBeGreaterThan(5);
      expect(moved).toBe(true);
      expect(f.inspect.sim.phase).toBe("live");
      // Averaged over the run: at any one instant the count swings between one
      // and seven as fighters die and redeploy, which is the demo working.
      expect(aliveSum / 1800).toBeGreaterThan(2);
    } finally {
      f.dispose();
    }
  });
});
