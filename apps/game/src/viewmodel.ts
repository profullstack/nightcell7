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
import { WEAPON, type WeaponId } from "@nightcell7/game-core";
import { placeAll, type AssetSet } from "./assets";
import { WEAPON_VIEWMODEL } from "./sandbox-rules";

import { TACTICAL_VIEW_ALBEDO_SCALE, TACTICAL_WORLD_ALBEDO_SCALE } from "./tactical-materials";

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
 *
 * The weapon in hand can change: a pickup off a dead fighter swaps the mesh
 * (`setWeapon`). Everything the rest of the game holds on to — the fill light,
 * the muzzle lookup, the rendering group — is re-established on every mount,
 * so a swap is the same code path as the first weapon rather than a special
 * case that drifts.
 */

/** Camera-relative position, tuned against the in-game 90-degree field of view. */
const REST = new Vector3(0.21, -0.185, 0.324);

/** The glTF handedness transform lives below our placement node; +Z is forward. */
const BASE_YAW = 0;

/** How far the weapon may trail the view, in radians of camera rotation. */
const SWAY_LIMIT = 0.045;
/** Fraction of the gap closed per 60 Hz frame. Lower is heavier. */
const SWAY_RECOVERY = 0.14;

const BOB_SPEED = 0.011;
const BOB_AMOUNT = 0.011;

export class Viewmodel {
  private root: TransformNode;
  private muzzle: TransformNode | null = null;
  private weapon: WeaponId;
  private readonly fill: HemisphericLight;
  private bobPhase = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private lastYaw: number;
  private lastPitch: number;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly assets: AssetSet,
    weapon: WeaponId = WEAPON.C9_KESTREL,
  ) {
    // A light that only ever touches the weapon.
    //
    // The yard is a night scene lit by distant sodium lamps, so a weapon held
    // at the camera sits in shadow almost everywhere and renders as a black
    // cut-out. Every first-person game solves this with a rig light; without
    // it the gun is only visible when the player happens to stand under a lamp.
    // `includedOnlyMeshes` keeps it strictly off the world, so it cannot
    // brighten level geometry or give away a player's position.
    this.fill = new HemisphericLight("viewmodel-fill", new Vector3(-0.3, 1, -0.6), scene);
    // Neutral fill preserves the C7's authored material colors under the yard exposure.
    this.fill.intensity = 0.78;
    this.fill.diffuse = new Color3(0.72, 0.73, 0.78);
    this.fill.groundColor = new Color3(0.2, 0.17, 0.14);
    this.fill.specular = new Color3(0.3, 0.32, 0.38);
    this.fill.parent = camera;

    this.weapon = weapon;
    this.root = this.mount(weapon);
    scene.setRenderingAutoClearDepthStencil(1, true, true, false);

    const rotation = (camera as unknown as { rotation?: Vector3 }).rotation;
    this.lastYaw = rotation?.y ?? 0;
    this.lastPitch = rotation?.x ?? 0;
  }

  /** The weapon currently in hand. */
  get weaponId(): WeaponId {
    return this.weapon;
  }

  /**
   * Put a different weapon in hand. Returns true when the mesh changed, so
   * the caller can refresh anything that holds the old mesh list (the muzzle
   * flash exclusion does).
   */
  setWeapon(weapon: WeaponId): boolean {
    if (weapon === this.weapon) return false;
    this.root.dispose();
    this.weapon = weapon;
    this.root = this.mount(weapon);
    return true;
  }

  private mount(weapon: WeaponId): TransformNode {
    const spec = WEAPON_VIEWMODEL[weapon];
    const fallback = WEAPON_VIEWMODEL[WEAPON.C9_KESTREL];
    const container = this.assets.models.get(spec.model) ?? this.assets.models.get(fallback.model);
    if (!container) throw new Error(`${spec.model} model not loaded`);

    // `unique` because the materials below are per-viewmodel: an instanced
    // mesh shares its source's material and ignores assignment to it.
    const [root] = placeAll(container, "viewmodel", [{ position: REST.clone() }], {
      unique: true,
    });
    if (!root) throw new Error(`${spec.model} produced no root node`);

    // Fit to the hand. The first-person carbine keeps its tuned scale; a
    // world mesh standing in for another weapon is sized by its longest
    // extent so a 1.1 m marksman rifle does not fill the screen.
    let scale = spec.scale ?? 1;
    if (spec.scale === undefined && spec.fitLengthM !== undefined) {
      root.computeWorldMatrix(true);
      const { min, max } = root.getHierarchyBoundingVectors(true);
      const longest = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
      if (longest > 1e-3) scale = spec.fitLengthM / longest;
    }
    root.scaling = new Vector3(scale, scale, scale);
    root.parent = this.camera;
    root.rotation = new Vector3(0, BASE_YAW, 0);

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
    for (const mesh of root.getChildMeshes() as Mesh[]) {
      const source = mesh.material;
      if (!source) continue;
      let clone = localised.get(source);
      if (!clone) {
        clone = source.clone(`viewmodel_${source.name}`) ?? source;
        if (clone instanceof PBRMaterial) {
          clone.environmentIntensity = 0.5;
          // Close-range metal shimmers badly under a moving camera otherwise.
          clone.enableSpecularAntiAliasing = true;
          // Keep the authored tan/polymer/metal colors. The world binder dims
          // each color for the yard; lift that factor for the dedicated rig.
          if (source.name.startsWith("nc7_")) {
            clone.albedoColor.scaleInPlace(
              TACTICAL_VIEW_ALBEDO_SCALE / TACTICAL_WORLD_ALBEDO_SCALE,
            );
          }
        }
        localised.set(source, clone);
      }
      mesh.material = clone;
    }

    for (const mesh of root.getChildMeshes() as Mesh[]) {
      // Drawn after the world, over a cleared depth buffer, so it can never
      // intersect level geometry.
      mesh.renderingGroupId = 1;
      mesh.isPickable = false;
      // A viewmodel casting shadows into the world would be visible as a
      // floating rifle-shaped shadow with no owner.
      mesh.receiveShadows = false;
      mesh.alwaysSelectAsActiveMesh = true;
    }

    this.fill.includedOnlyMeshes = root.getChildMeshes();

    this.muzzle =
      (root.getDescendants().find((node) => node.name.includes("SOCKET_MUZZLE")) as
        TransformNode | undefined) ?? null;

    void this.scene;
    return root;
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
    this.fill.dispose();
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}
