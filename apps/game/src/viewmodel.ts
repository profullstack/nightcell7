import type { Scene, TransformNode } from "@babylonjs/core";
import {
  Color3,
  HemisphericLight,
  PBRMaterial,
  Vector3,
  type Camera,
  type Material,
  type Mesh,
} from "@babylonjs/core";
import { placeAll, type AssetSet } from "./assets";

/**
 * First-person weapon viewmodel.
 *
 * The weapon occupies the lower third of the screen for every frame of every
 * match, so it is the single most-viewed object in the game — and until now the
 * player's hands were empty, which is a large part of why the build read as
 * unfinished. PRD §40: "a grey room, one enemy, and one rifle must already feel
 * good".
 *
 * Two things here are not cosmetic:
 *
 *  * **Its own rendering group.** The viewmodel sits centimetres from the near
 *    plane. Rendered with the world it clips through every wall the player
 *    stands near, so it is drawn in group 1 over a cleared depth buffer.
 *  * **Sway lags rotation.** The weapon trails the camera by a few frames.
 *    Without it the gun is welded to the view and the whole image feels rigid;
 *    with it, turning has weight. Deliberately small — this is a competitive
 *    shooter, and a viewmodel that swings across the screen hides targets.
 *
 * The muzzle transform (`SOCKET_MUZZLE`) is a *presentation* anchor only. The
 * authoritative shot origin is derived from the server's player position, never
 * from this node, so a tampered viewmodel cannot move where bullets come from.
 */

/**
 * Resting offset from the camera: right, down, forward, in metres.
 *
 * The forward offset is derived, not guessed: the carbine's framing was the
 * version that looked right, so the Synty rifle is placed so its muzzle sits
 * the same 0.645 m in front of the eye, given that the rifle is 1.03 m to the
 * carbine's 0.81 m and its origin sits further back. Keeping the old offset
 * would have pushed the barrel through the middle of the screen.
 *
 * The height is the one value tuned against a screenshot rather than derived.
 * Matching the muzzle exactly (-0.214) put the receiver off the bottom edge,
 * because the rifle carries more body below its bore than the carbine did.
 */
const REST = new Vector3(0.21, -0.185, 0.293);

/**
 * Base yaw of the viewmodel.
 *
 * The weapons are modelled with their barrel along Blender -Y — the generated
 * carbine and the converted Synty ones alike — which the glTF
 * exporter maps to +Z. Babylon's glTF loader then wraps the import in a
 * `__root__` node scaled (1, 1, -1) to convert right-handed glTF into its own
 * left-handed space — so the barrel ends up pointing along -Z, straight back at
 * the player. It rendered as a rifle held stock-first.
 *
 * Turning the whole thing round is the fix. Doing it here rather than in the
 * generator keeps the exported asset in the orientation the rest of the glTF
 * ecosystem expects.
 */
const BASE_YAW = Math.PI;

/**
 * Viewmodel scale.
 *
 * Real games render the weapon through a second, narrower camera so a
 * true-scale rifle does not swallow the screen. This build has one camera at a
 * 90° field of view, where a full-size rifle held at arm's length covers most
 * of the frame — which is exactly how it first looked. Scaling the mesh is the
 * cheap equivalent and is indistinguishable in the result.
 *
 * 0.488 is the value that gives the 1.03 m Synty rifle the same apparent length
 * the 0.81 m carbine had at 0.62, so the framing carries over unchanged.
 */
const VIEW_SCALE = 0.488;

/**
 * The weapon the player holds.
 *
 * The generated `carbine` it replaced is still built and still ships, as a
 * fallback that does not depend on a licensed pack being present.
 */
const WEAPON = "wep_rifle" as const;

/** How far the weapon may trail the view, in radians of camera rotation. */
const SWAY_LIMIT = 0.045;
/** Fraction of the gap closed per 60 Hz frame. Lower is heavier. */
const SWAY_RECOVERY = 0.14;

const BOB_SPEED = 0.011;
const BOB_AMOUNT = 0.011;

export class Viewmodel {
  private readonly root: TransformNode;
  private readonly muzzle: TransformNode | null;
  private bobPhase = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private lastYaw: number;
  private lastPitch: number;

  constructor(scene: Scene, camera: Camera, assets: AssetSet) {
    const container = assets.models.get(WEAPON);
    if (!container) throw new Error(`${WEAPON} model not loaded`);

    // `unique` because the materials below are per-viewmodel: an instanced
    // mesh shares its source's material and ignores assignment to it.
    const [root] = placeAll(
      container,
      "viewmodel",
      [{ position: REST.clone(), scaling: new Vector3(VIEW_SCALE, VIEW_SCALE, VIEW_SCALE) }],
      { unique: true },
    );
    if (!root) throw new Error(`${WEAPON} produced no root node`);

    this.root = root;
    this.root.parent = camera;
    this.root.rotation = new Vector3(0, BASE_YAW, 0);

    // Give the weapon its own material instances with a much weaker
    // environment contribution.
    //
    // `environmentIntensity` is 2.9 scene-wide, which the yard needs — but a
    // near-polished metal held 30 cm from the camera reflects that straight
    // into the bloom threshold, and the receiver, rail and optic rendered as a
    // solid white blob whenever the weapon was on screen. It is per-material,
    // so the fix is local to the viewmodel and leaves the world untouched.
    //
    // This whole block is why `placeAll` above is asked for `unique` meshes.
    // Assigning to an `InstancedMesh`'s material is a silent no-op, so every
    // value set here was landing on nothing — forcing the weapon bright red as
    // a test changed precisely one thing on screen: nothing.
    const localised = new Map<Material, Material>();
    for (const mesh of this.root.getChildMeshes() as Mesh[]) {
      const source = mesh.material;
      if (!source) continue;
      let clone = localised.get(source);
      if (!clone) {
        clone = source.clone(`viewmodel_${source.name}`) ?? source;
        if (clone instanceof PBRMaterial) {
          clone.environmentIntensity = 0.5;
          // Close-range metal shimmers badly under a moving camera otherwise.
          clone.enableSpecularAntiAliasing = true;
          // Relax the atlas's world-object dimming.
          //
          // `synty_weapons` scales albedo to 0.36 so a weapon lying out in the
          // yard does not clip past the bloom threshold under hemispheric 4.05.
          // The viewmodel is the opposite case: held below the eye-line, away
          // from the lamps, inside the strongest part of the vignette, and lit
          // mostly by its own rig light. 0.62 reads as gunmetal there; 0.36
          // reads as a black cut-out and 1.0 as pale blue plastic.
          clone.albedoColor = new Color3(0.62, 0.62, 0.62);
        }
        localised.set(source, clone);
      }
      mesh.material = clone;
    }

    for (const mesh of this.root.getChildMeshes() as Mesh[]) {
      // Drawn after the world, over a cleared depth buffer, so it can never
      // intersect level geometry.
      mesh.renderingGroupId = 1;
      mesh.isPickable = false;
      // A viewmodel casting shadows into the world would be visible as a
      // floating rifle-shaped shadow with no owner.
      mesh.receiveShadows = false;
      mesh.alwaysSelectAsActiveMesh = true;
    }
    scene.setRenderingAutoClearDepthStencil(1, true, true, false);

    // A light that only ever touches the weapon.
    //
    // The yard is a night scene lit by distant sodium lamps, so a weapon held
    // at the camera sits in shadow almost everywhere and renders as a black
    // cut-out. Every first-person game solves this with a rig light; without
    // it the gun is only visible when the player happens to stand under a lamp.
    // `includedOnlyMeshes` keeps it strictly off the world, so it cannot
    // brighten level geometry or give away a player's position.
    const fill = new HemisphericLight("viewmodel-fill", new Vector3(-0.3, 1, -0.6), scene);
    // Tuned against the scene's exposure, not in isolation: the weapon is lit
    // by this *and* the scene. The Synty atlas is darker than the generated
    // carbine's steel, so this sits a little above the 0.62 that suited the
    // old model. The tint is near-neutral — the strongly blue value it used to
    // carry turned the grey rifle into pale blue plastic once the material
    // changes above actually started applying.
    fill.intensity = 0.78;
    fill.diffuse = new Color3(0.72, 0.73, 0.78);
    fill.groundColor = new Color3(0.2, 0.17, 0.14);
    fill.specular = new Color3(0.3, 0.32, 0.38);
    fill.includedOnlyMeshes = this.root.getChildMeshes();
    fill.parent = camera;

    this.muzzle =
      (this.root.getDescendants().find((node) => node.name.includes("SOCKET_MUZZLE")) as
        TransformNode | undefined) ?? null;

    const rotation = (camera as unknown as { rotation?: Vector3 }).rotation;
    this.lastYaw = rotation?.y ?? 0;
    this.lastPitch = rotation?.x ?? 0;
  }

  /** Every mesh belonging to the weapon, for light exclusion. */
  meshes(): Mesh[] {
    return this.root.getChildMeshes() as Mesh[];
  }

  /** World-space muzzle position, for flash and tracer origins. */
  muzzlePosition(): Vector3 | null {
    return this.muzzle ? this.muzzle.getAbsolutePosition() : null;
  }

  /**
   * @param deltaMs frame time
   * @param speed   horizontal speed in m/s, for the walk bob
   * @param yaw     current camera yaw, radians
   * @param pitch   current camera pitch, radians
   */
  update(deltaMs: number, speed: number, yaw: number, pitch: number): void {
    // Normalise the frame so behaviour does not change with frame rate.
    const frames = Math.min(deltaMs / 16.667, 4);

    // Sway: accumulate the view delta, then bleed it off.
    const dYaw = yaw - this.lastYaw;
    const dPitch = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;

    this.swayYaw = clamp(this.swayYaw - dYaw, -SWAY_LIMIT, SWAY_LIMIT);
    this.swayPitch = clamp(this.swayPitch - dPitch, -SWAY_LIMIT, SWAY_LIMIT);
    const recovery = 1 - Math.pow(1 - SWAY_RECOVERY, frames);
    this.swayYaw -= this.swayYaw * recovery;
    this.swayPitch -= this.swayPitch * recovery;

    // Bob: advances with distance travelled, not with time, so standing still
    // is still and sprinting bobs faster without a separate state machine.
    this.bobPhase += speed * deltaMs * BOB_SPEED;
    const bobX = Math.cos(this.bobPhase) * BOB_AMOUNT * Math.min(speed / 4, 1);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * BOB_AMOUNT * Math.min(speed / 4, 1);

    this.root.position.set(REST.x + bobX, REST.y - bobY, REST.z);
    this.root.rotation.set(this.swayPitch, BASE_YAW + this.swayYaw, this.swayYaw * 0.4);
  }

  dispose(): void {
    this.root.dispose();
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}
