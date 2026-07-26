import type { Scene, TransformNode } from "@babylonjs/core";
import { Color3, HemisphericLight, Vector3, type Camera, type Mesh } from "@babylonjs/core";
import { placeAll, type AssetSet } from "./assets";

/**
 * First-person weapon viewmodel.
 *
 * The carbine occupies the lower third of the screen for every frame of every
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

/** Resting offset from the camera: right, down, forward, in metres. */
const REST = new Vector3(0.21, -0.17, 0.34);

/**
 * Base yaw of the viewmodel.
 *
 * The carbine is modelled with its barrel along Blender -Y, which the glTF
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
 * 90° field of view, where a 0.74 m carbine held at arm's length covers most of
 * the frame — which is exactly how it first looked. Scaling the mesh is the
 * cheap equivalent and is indistinguishable in the result.
 */
const VIEW_SCALE = 0.62;

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
    const container = assets.models.get("carbine");
    if (!container) throw new Error("carbine model not loaded");

    const [root] = placeAll(container, "viewmodel", [
      { position: REST.clone(), scaling: new Vector3(VIEW_SCALE, VIEW_SCALE, VIEW_SCALE) },
    ]);
    if (!root) throw new Error("carbine produced no root node");

    this.root = root;
    this.root.parent = camera;
    this.root.rotation = new Vector3(0, BASE_YAW, 0);

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
    fill.intensity = 1.9;
    fill.diffuse = new Color3(0.72, 0.76, 0.88);
    fill.groundColor = new Color3(0.2, 0.17, 0.14);
    fill.specular = new Color3(0.5, 0.52, 0.58);
    fill.includedOnlyMeshes = this.root.getChildMeshes();
    fill.parent = camera;

    this.muzzle =
      (this.root.getDescendants().find((node) => node.name.includes("SOCKET_MUZZLE")) as
        TransformNode | undefined) ?? null;

    const rotation = (camera as unknown as { rotation?: Vector3 }).rotation;
    this.lastYaw = rotation?.y ?? 0;
    this.lastPitch = rotation?.x ?? 0;
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
