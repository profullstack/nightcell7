import { Vector3, type Scene, type TransformNode } from "@babylonjs/core";
import { rayAabb, type Aabb, type Vec3 } from "@nightcell7/multiplayer-sim";
import { placeAll, type AssetSet } from "./assets";

/**
 * Training targets.
 *
 * PRD §40: "a grey room, one enemy, and one rifle must already feel good."
 * There was no enemy. `character.glb` was built and then had no consumer — the
 * multiplayer entry point that would render remote players does not exist yet —
 * so single-player was an empty yard with a working gun and nothing to point it
 * at.
 *
 * These are deliberately *training targets*, not AI opponents: they stand,
 * they take hits, they fall, they reset. There is no animation system and no
 * bot pathing on the client, and a figure sliding around the yard frozen in a
 * standing pose would look worse than one that honestly stands still.
 *
 * Hit detection here is **presentation only**, exactly like the weapon effects.
 * In a real match the server owns hit registration through `resolveHitscan`.
 * This exists so the single-player sandbox has feedback; it awards nothing and
 * is not reported anywhere.
 */

/** Where targets stand. All verified clear of the collision volumes. */
const POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [-4, 9],
  [10, 18],
  [-12, 24],
  [14, 31],
  [-18, 35],
];

/** Matches the simulated player capsule, so shooting one feels honest. */
const HALF_WIDTH = 0.3;
const HEIGHT = 1.8;

/** How long a target lies down before standing back up, ms. */
const DOWN_MS = 3200;
/** How long the fall takes, ms. */
const FALL_MS = 420;

interface Target {
  root: TransformNode;
  readonly origin: Vector3;
  readonly box: Aabb;
  /** Timestamp the target was hit, or 0 while standing. */
  downAt: number;
}

export interface TargetHit {
  readonly point: Vec3;
  readonly distance: number;
}

export class TrainingTargets {
  private readonly targets: Target[] = [];

  constructor(scene: Scene, assets: AssetSet) {
    const container = assets.models.get("character");
    if (!container) throw new Error("character model not loaded");

    const roots = placeAll(
      container,
      "target",
      POSITIONS.map(([x, z]) => ({
        position: new Vector3(x, 0, z),
        // Facing south, toward the Nightcell spawn a player enters from.
        rotationY: 0,
      })),
    );

    roots.forEach((root, index) => {
      const spot = POSITIONS[index];
      if (!spot) return;
      const [x, z] = spot;
      this.targets.push({
        root,
        origin: new Vector3(x, 0, z),
        box: {
          min: { x: x - HALF_WIDTH, y: 0, z: z - HALF_WIDTH },
          max: { x: x + HALF_WIDTH, y: HEIGHT, z: z + HALF_WIDTH },
        },
        downAt: 0,
      });
    });

    void scene;
  }

  /**
   * Nearest target along the ray, or null.
   *
   * `maxDistance` should be the distance to the world geometry behind, so a
   * target standing behind a container cannot be shot through it.
   */
  tryHit(origin: Vec3, direction: Vec3, maxDistance: number): TargetHit | null {
    let nearest: Target | null = null;
    let nearestHit: TargetHit | null = null;

    for (const target of this.targets) {
      if (target.downAt) continue; // already down
      const hit = rayAabb(origin, direction, target.box, maxDistance);
      if (!hit) continue;
      if (!nearestHit || hit.distance < nearestHit.distance) {
        nearestHit = { point: hit.point, distance: hit.distance };
        nearest = target;
      }
    }

    if (nearest) nearest.downAt = performance.now();
    return nearestHit;
  }

  /** Animate falls and stand targets back up. Call once per frame. */
  update(): void {
    const now = performance.now();

    for (const target of this.targets) {
      if (!target.downAt || target.downAt < 0) continue;

      const elapsed = now - target.downAt;
      if (elapsed >= DOWN_MS) {
        target.downAt = 0;
        target.root.rotation.x = 0;
        target.root.position.copyFrom(target.origin);
        continue;
      }

      // Topple backwards about the feet over FALL_MS, then lie still.
      const t = Math.min(1, elapsed / FALL_MS);
      // Ease out, so it drops fast and settles rather than rotating linearly.
      const eased = 1 - (1 - t) * (1 - t);
      target.root.rotation.x = eased * (Math.PI / 2);
      // Compensate the pivot: rotating about the origin would sink the body
      // into the ground, since the model's origin is at its feet.
      target.root.position.set(
        target.origin.x,
        target.origin.y + eased * 0.28,
        target.origin.z - eased * 0.55,
      );
    }
  }

  dispose(): void {
    for (const target of this.targets) target.root.dispose();
    this.targets.length = 0;
  }
}
