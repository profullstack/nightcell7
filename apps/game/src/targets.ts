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
import { colorInfo } from "./loadout";

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

/**
 * Which materials carry a team colour, and which are left as authored.
 *
 * This used to be an exclusion list: "team" meant a name containing `paint` or
 * `nc7_team`, and "cloth" meant a name that did *not* start with `nc7_` or
 * `ir_`. The shipped operators are `m3_operator_nightcell` and
 * `m3_operator_directorate`, and every material on both is `ir_`-prefixed
 * (`ir_uniform`, `ir_canvas`, `ir_blue`, `ir_steel`, `ir_rubber`, `ir_glass`).
 * So the first test never matched and the second excluded everything: neither
 * branch ever ran, no team colour was ever applied, and since both models share
 * `ir_blue` every fighter in the yard came out the same blue. The call site
 * even says "without this both teams are the same model with the same
 * materials" — it was right, the matching just never fired.
 *
 * Naming the roles instead of excluding prefixes is what stops that happening
 * again: a new material is uncoloured until it is listed, which is a visible
 * omission, rather than silently disabling the whole system.
 */
const BAND_MATERIALS = /(^|_)(paint|team|marking|mark|blue|orange)($|_|\.|\d)/i;
const CLOTH_MATERIALS = /(^|_)(uniform|canvas|cloth|camo|fabric|olive|sand)($|_|\.|\d)/i;

/** Equipment and flesh: never team-coloured, whatever side carries it. */
const KEEP_AUTHORED =
  /(^|_)(steel|rubber|glass|lens|skin|light|plaster|concrete|alloy)($|_|\.|\d)/i;

export type MaterialRole = "band" | "cloth" | "keep";

/** Exported for the tests: the classification is the part that broke. */
export function materialRole(name: string): MaterialRole {
  if (KEEP_AUTHORED.test(name)) return "keep";
  if (BAND_MATERIALS.test(name)) return "band";
  if (CLOTH_MATERIALS.test(name)) return "cloth";
  return "keep";
}

/**
 * How far apart two colours read, 0 to ~1.7.
 *
 * Plain RGB distance, weighted towards the channels the eye resolves best. It
 * does not need to be a perceptual colour space to answer the only question
 * asked of it: are these two bands obviously different across a yard.
 */
export function colorDistance(a: Color3, b: Color3): number {
  const dr = (a.r - b.r) * 1.0;
  const dg = (a.g - b.g) * 1.3;
  const db = (a.b - b.b) * 0.8;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Candidate enemy palettes, deliberately spread around the wheel.
 *
 * The enemy is not fixed, because the player may now choose their own colour
 * and could pick the one the enemy was wearing. Two teams in the same colour is
 * not a cosmetic problem, it is the game becoming unplayable.
 */
const ENEMY_CANDIDATES: readonly TeamPalette[] = [
  { band: new Color3(1.0, 0.28, 0.12), cloth: new Color3(0.72, 0.6, 0.44) }, // ember
  { band: new Color3(0.1, 0.75, 0.95), cloth: new Color3(0.42, 0.52, 0.6) }, // signal
  { band: new Color3(0.68, 0.85, 0.2), cloth: new Color3(0.4, 0.47, 0.3) }, // olive
  { band: new Color3(0.95, 0.75, 0.25), cloth: new Color3(0.66, 0.6, 0.44) }, // sand
  { band: new Color3(0.85, 0.3, 0.9), cloth: new Color3(0.5, 0.4, 0.55) }, // orchid
];

/** Below this the two sides are not reliably tellable apart at range. */
export const MIN_TEAM_DISTANCE = 0.55;

/** The gate's colour swatch as a wearable palette. */
export function paletteFromColor(id: string): TeamPalette {
  const chosen = colorInfo(id);
  return {
    band: Color3.FromHexString(chosen.band),
    cloth: Color3.FromHexString(chosen.cloth),
  };
}

/**
 * Both palettes for a match: what the player's side wears, and what the other
 * side wears so the two can never be confused.
 */
export function teamPalettes(colorId: string): {
  readonly own: TeamPalette;
  readonly enemy: TeamPalette;
} {
  const own = paletteFromColor(colorId);
  return { own, enemy: enemyPaletteFor(own) };
}

/**
 * The enemy palette to wear against `own`: whichever candidate sits furthest
 * from it. Always returns something, and the test asserts that "furthest" is
 * never closer than `MIN_TEAM_DISTANCE` for any colour the gate offers, so the
 * two sides cannot collide however the player dresses.
 */
export function enemyPaletteFor(own: TeamPalette): TeamPalette {
  let best = ENEMY_CANDIDATES[0]!;
  let bestDistance = -1;
  for (const candidate of ENEMY_CANDIDATES) {
    const distance = colorDistance(candidate.band, own.band);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

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
        const role = materialRole(source.name);
        const team = palette ?? TEAM_PALETTE.enemy;
        if (role === "band") {
          // The texture has to go: an albedo texture multiplies the colour, and
          // the authored one is the blue that made every fighter look alike.
          clone.albedoTexture = null;
          clone.albedoColor = team.band.scale(0.55);
        } else if (role === "cloth") {
          // The texture stays. It carries the weave and the seams, and
          // `albedoColor` multiplies through it, so tinting keeps the fabric.
          // Clearing it here turned the uniform into a flat white sheet.
          clone.albedoColor = team.cloth;
        }
        // Equipment and skin keep what the artist gave them. Only the uniform
        // and the unit markings answer to the player's team.
        clone.environmentIntensity = 0.65;
        clone.emissiveColor = role === "band" ? team.band.scale(0.35) : new Color3(0, 0, 0);
      }
      localised.set(source, clone);
    }
    mesh.material = clone;
  }
}

export class TrainingTargets {
  private readonly targets: Target[] = [];

  constructor(scene: Scene, assets: AssetSet) {
    const character = assets.models.get("m3_operator_directorate");
    const carbine = assets.models.get("m3_rifle");
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
          { position: new Vector3(0, 0, 0), rotationY: 0 },
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
