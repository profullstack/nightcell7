import {
  Color3,
  PBRMaterial,
  Vector3,
  type AnimationGroup,
  type Material,
  type Mesh,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";
import { rayAabb, type Aabb, type Vec3 } from "@nightcell7/multiplayer-sim";
import { placeAll, placeAnimated, type AssetSet } from "./assets";

/**
 * Training targets.
 *
 * PRD §40: "a grey room, one enemy, and one rifle must already feel good."
 * There was no enemy — `character.glb` had no consumer, because the
 * multiplayer entry point that would draw remote players does not exist yet.
 *
 * These stand, breathe, take hits and collapse. They are *targets*, not AI:
 * they do not move or return fire. `BotController` in `@nightcell7/multiplayer-sim`
 * already implements that and drives the same input path a human does, but it
 * needs a `MatchSimulation` running on the client, which is a separate piece of
 * wiring.
 *
 * Hit detection here is **presentation only**, exactly like the weapon effects.
 * The server owns hit registration through `resolveHitscan`; nothing here is
 * scored or reported.
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

/** How long a target stays down before standing back up, ms. */
const DOWN_MS = 4200;

interface Target {
  readonly root: TransformNode;
  readonly clips: Map<string, AnimationGroup>;
  readonly origin: Vector3;
  readonly box: Aabb;
  /** Timestamp of the hit, or 0 while standing. */
  downAt: number;
}

export interface TargetHit {
  readonly point: Vec3;
  readonly distance: number;
  /** True when the round hit the upper twentieth of the body. */
  readonly headshot: boolean;
}

/**
 * Lift the character out of the dark.
 *
 * The body and webbing use the shared `rubber` material at ~0.12 albedo. On a
 * lit prop that is correct, but a figure standing in an unlit part of a night
 * yard rendered as a featureless dark blob — you could see that someone was
 * there and nothing else. Real games solve this with character-specific
 * lighting rules rather than by repainting the model.
 *
 * So: raise the albedo, drop the reflectivity that was eating what light there
 * was, and put a faint emissive on the team colour so the armband and head
 * band read at range. This is a readability decision, not a fidelity one — an
 * enemy you cannot resolve is a broken game, not a moody one.
 */
/**
 * Team colours.
 *
 * Two axes, not one, because a single hue on a small band is not readable at
 * the ranges this yard plays at. The cloth carries a warm/cool split that reads
 * as a silhouette at 40 m, and the band carries the saturated hue that confirms
 * it up close. One or the other alone was not enough: the bots previously
 * differed only by which weapon they held, which is invisible from the front.
 */
export interface TeamPalette {
  /** Webbing and plate — the small, saturated identifier. */
  readonly band: Color3;
  /** Uniform cloth — the large, desaturated one. */
  readonly cloth: Color3;
}

export const TEAM_PALETTE: { readonly friendly: TeamPalette; readonly enemy: TeamPalette } = {
  // Nightcell: cool cloth, signal cyan band — the colour the HUD already uses
  // for "yours" everywhere else in the interface.
  friendly: { band: new Color3(0.1, 0.75, 0.95), cloth: new Color3(0.42, 0.52, 0.6) },
  // Directorate: warm cloth, hot orange-red band, matching the yard's own
  // containers and hazard paint.
  enemy: { band: new Color3(1.0, 0.28, 0.12), cloth: new Color3(0.72, 0.6, 0.44) },
};

export function brightenCharacter(root: TransformNode, palette?: TeamPalette): void {
  // Local to this call. The cache exists to share one clone across the meshes
  // of a single figure; making it module-level would hand the second team the
  // first team's colours, because the *source* material is shared by both.
  const localised = new Map<Material, Material>();

  for (const mesh of root.getChildMeshes() as Mesh[]) {
    const source = mesh.material;
    if (!source) continue;

    let clone = localised.get(source);
    if (!clone) {
      clone = source.clone(`target_${source.name}`) ?? source;
      if (clone instanceof PBRMaterial) {
        const isTeam = source.name.includes("paint");

        // `albedoColor` MULTIPLIES the albedo texture. The first attempt used
        // 2.3 to drag the figures out of the dark, which pushed every texel
        // past white and erased the texture entirely — the result read as a
        // featureless white stormtrooper, not a fighter in field clothing.
        //
        // A moderate, *warm* multiplier lifts them without flattening them:
        // the weave, the dirt and the wear all survive, and the colour lands
        // on worn khaki rather than bleached plastic.
        // A tint *below* one, not above it.
        //
        // The original "dark blobs" were diagnosed when the yard's ambient
        // was 2.15. It is 4.05 now — raised in the brightness pass — so a
        // multiplier over 1 on top of that clipped every texel to white at
        // exposure 2.05 and produced a featureless pale figure. The characters
        // stopped needing any lift the moment the scene got brighter; what
        // they need is colour.
        const team = palette ?? TEAM_PALETTE.enemy;

        if (isTeam) {
          // Replace the band's texture, do not tint it.
          //
          // `albedoColor` MULTIPLIES, and this material's texture is
          // `paint_red`. Multiplying red by cyan is near-black, so the friendly
          // band came out unlit black while only the enemy's red survived —
          // which is why the two teams still read the same on screen. A flat
          // colour with no texture is the only way to get a saturated hue the
          // source does not already contain.
          clone.albedoTexture = null;
          clone.albedoColor = team.band;
        } else {
          clone.albedoColor = team.cloth;
        }

        // Metallic and roughness are left to the ORM texture. Overriding them
        // to flat values was the other half of the plastic look: it removed
        // every difference between cloth, webbing and boot leather.
        clone.environmentIntensity = 0.85;

        // A little self-illumination so the silhouette separates from an unlit
        // background without washing the surface out. The team band gets more,
        // because it is the thing that has to be identifiable at range.
        // No self-illumination on cloth — it is lit plenty. Only the team band
        // gets a trace, and only enough to survive the bloom threshold rather
        // than glow through it.
        // The band self-illuminates, and generously.
        //
        // This is the one thing that has to be readable across a dark yard at
        // 40 m, and a diffuse surface at that distance is a grey smudge however
        // it is coloured. Emissive puts it above the scene's bloom threshold so
        // the GlowLayer picks it up, which is what turns a colour into a marker.
        // A previous 0.06 was invisible in play.
        clone.emissiveColor = isTeam ? team.band.scale(0.85) : new Color3(0, 0, 0);
      }
      localised.set(source, clone);
    }
    mesh.material = clone;
  }
}

export class TrainingTargets {
  private readonly targets: Target[] = [];

  constructor(scene: Scene, assets: AssetSet) {
    const character = assets.models.get("character");
    const carbine = assets.models.get("carbine");
    if (!character) throw new Error("character model not loaded");

    POSITIONS.forEach(([x, z], index) => {
      const placed = placeAnimated(character, `target${index}`, {
        position: new Vector3(x, 0, z),
        // Facing south, toward the spawn a player enters from.
        rotationY: 0,
      });
      if (!placed) return;

      brightenCharacter(placed.root);

      // Arm them. A figure standing in a contested yard with empty hands reads
      // as a mannequin no matter how good the model is.
      if (carbine) {
        const socket = placed.root
          .getDescendants()
          .find((node) => node.name.includes("SOCKET_WEAPON")) as TransformNode | undefined;
        const [weapon] = placeAll(carbine, `target${index}_weapon`, [
          { position: new Vector3(0, 0, 0), rotationY: Math.PI },
        ]);
        if (weapon) weapon.parent = socket ?? placed.root;
      }

      // Breathing idle so a standing target is not switched off.
      const idle = placed.clips.get("idle");
      if (idle) idle.start(true, 1.0);

      this.targets.push({
        root: placed.root,
        clips: placed.clips,
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
   * Nearest standing target along the ray, or null.
   *
   * `maxDistance` should be the distance to the world geometry behind, so a
   * target standing behind a container cannot be shot through it.
   */
  tryHit(origin: Vec3, direction: Vec3, maxDistance: number): TargetHit | null {
    let nearest: Target | null = null;
    let nearestHit: TargetHit | null = null;

    for (const target of this.targets) {
      if (target.downAt) continue;
      const hit = rayAabb(origin, direction, target.box, maxDistance);
      if (!hit) continue;
      if (!nearestHit || hit.distance < nearestHit.distance) {
        nearestHit = {
          point: hit.point,
          distance: hit.distance,
          headshot: hit.point.y > HEIGHT * 0.82,
        };
        nearest = target;
      }
    }

    if (nearest) {
      nearest.downAt = performance.now();
      nearest.clips.get("idle")?.stop();
      const death = nearest.clips.get("death");
      // Non-looping, and left on its final frame so the body stays down
      // instead of snapping back to a standing pose.
      if (death) death.start(false, 1.0);
    }

    return nearestHit;
  }

  /** Stand targets back up once they have been down long enough. */
  update(): void {
    const now = performance.now();

    for (const target of this.targets) {
      if (!target.downAt || now - target.downAt < DOWN_MS) continue;
      target.downAt = 0;
      target.clips.get("death")?.stop();
      target.clips.get("idle")?.start(true, 1.0);
      target.root.position.copyFrom(target.origin);
      target.root.rotation.set(0, 0, 0);
    }
  }

  dispose(): void {
    for (const target of this.targets) {
      for (const clip of target.clips.values()) clip.dispose();
      target.root.dispose();
    }
    this.targets.length = 0;
  }
}
