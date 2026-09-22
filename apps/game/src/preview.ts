import {
  Color3,
  Vector3,
  type AnimationGroup,
  type FreeCamera,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";
import { ARDAVAN_YARD, EYE_HEIGHT_STANDING, isClearOfSolids } from "@nightcell7/multiplayer-sim";
import { placeAnimated, type AssetSet } from "./assets";
import { SIDE, colorInfo, type Loadout } from "./loadout";
import { brightenCharacter } from "./targets";

/**
 * The operator on the deploy gate.
 *
 * A first-person player never sees their own body, so the chooser is where
 * the choice has to be visible: the chosen faction's figure stands in the
 * yard a couple of metres in front of the camera, in the chosen colours,
 * idling and turning slowly. Placed relative to the camera every frame
 * rather than at a fixed point, because the gate also reopens on pause,
 * wherever the player happens to be standing.
 *
 * Presentation only. Nothing here touches the simulation.
 */

/**
 * How far in front of the camera the figure stands, metres: as far as
 * `DISTANCE_M` when the ground is clear, stepping closer when a wall or the
 * spawn tent is in the way, never nearer than `MIN_DISTANCE_M`.
 */
const DISTANCE_M = 2.6;
const MIN_DISTANCE_M = 1.3;
/** Slow turn either side of facing the camera, radians. */
const SWAY_RADIANS = 0.45;

export class LoadoutPreview {
  private root: TransformNode | null = null;
  private clips: Map<string, AnimationGroup> | null = null;
  private phase = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: FreeCamera,
    private readonly assets: AssetSet,
  ) {}

  /** Show this loadout's figure, replacing whatever was shown before. */
  show(loadout: Loadout): void {
    this.hide();
    const model = this.assets.models.get(
      loadout.side === SIDE.DIRECTORATE ? "m3_operator_directorate" : "m3_operator_nightcell",
    );
    if (!model) return;

    const placed = placeAnimated(model, "preview", { position: Vector3.Zero(), rotationY: 0 });
    if (!placed) return;

    const color = colorInfo(loadout.color);
    brightenCharacter(placed.root, {
      band: Color3.FromHexString(color.band),
      cloth: Color3.FromHexString(color.cloth),
    });
    for (const mesh of placed.root.getChildMeshes()) {
      // Never a target: the figure is a mirror, not a fighter.
      mesh.isPickable = false;
    }

    this.root = placed.root;
    this.clips = placed.clips;
    const idle = placed.clips.get("idle");
    if (idle) idle.start(true, 1.0);
    this.place();
    void this.scene;
  }

  hide(): void {
    if (this.clips) for (const clip of this.clips.values()) clip.dispose();
    this.root?.dispose();
    this.root = null;
    this.clips = null;
  }

  get visible(): boolean {
    return this.root !== null;
  }

  update(deltaMs: number): void {
    if (!this.root) return;
    this.phase += deltaMs * 0.0009;
    this.place();
  }

  private place(): void {
    if (!this.root) return;
    const forward = this.camera.getDirection(Vector3.Forward());
    const flat = new Vector3(forward.x, 0, forward.z);
    if (flat.lengthSquared() < 1e-6) flat.set(0, 0, -1);
    flat.normalize();

    const eye = this.camera.position;
    const feetY = eye.y - EYE_HEIGHT_STANDING;
    let distance = DISTANCE_M;
    while (
      distance > MIN_DISTANCE_M &&
      !isClearOfSolids(
        ARDAVAN_YARD,
        { x: eye.x + flat.x * distance, y: feetY, z: eye.z + flat.z * distance },
        0.45,
      )
    ) {
      distance -= 0.2;
    }
    this.root.position.set(eye.x + flat.x * distance, feetY, eye.z + flat.z * distance);
    // Operators face along the simulation's yaw axis (0 faces +Z), so to
    // face the camera the figure looks back along -flat.
    const facing = Math.atan2(-flat.x, -flat.z);
    this.root.rotation.set(0, facing + Math.sin(this.phase) * SWAY_RADIANS, 0);
  }

  dispose(): void {
    this.hide();
  }
}
