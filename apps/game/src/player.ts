import type { FreeCamera, Scene, Vector3 } from "@babylonjs/core";
import { BUTTON, MAX_INPUT_DT_MS, type InputFrame } from "@nightcell7/multiplayer-protocol";
import {
  createMovementState,
  EYE_HEIGHT_CROUCHED,
  EYE_HEIGHT_STANDING,
  isBelowKillPlane,
  stepMovement,
  type CollisionMap,
  type MovementState,
  type Vec3,
} from "@nightcell7/multiplayer-sim";

/**
 * First-person controller.
 *
 * This deliberately does NOT use Babylon's built-in camera collisions. It runs
 * `stepMovement` from `@nightcell7/multiplayer-sim` — the same pure function
 * the authoritative server runs (PRD §18.4). Single-player therefore has
 * identical movement feel to multiplayer, and a change to acceleration or step
 * height cannot land in one and not the other.
 *
 * The camera is a passive follower here: it is told where the simulation put
 * the player, and never integrates motion itself.
 */

const PITCH_LIMIT = (89 * Math.PI) / 180;

export interface ControllerOptions {
  /** Radians of view rotation per pixel of mouse travel. */
  sensitivity?: number;
  invertY?: boolean;
}

export interface ControllerStatus {
  readonly position: Vec3;
  readonly speed: number;
  readonly grounded: boolean;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly locked: boolean;
}

export class PlayerController {
  private state: MovementState;
  private readonly held = new Set<string>();
  private yaw: number;
  private pitch = 0;
  private seq = 0;
  private locked = false;
  private firing = false;
  private readonly sensitivity: number;
  private readonly invertY: boolean;
  private readonly spawn: Vec3;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly scene: Scene,
    private readonly camera: FreeCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly map: CollisionMap,
    spawn: { position: Vec3; yaw: number },
    options: ControllerOptions = {},
  ) {
    this.spawn = { ...spawn.position };
    this.yaw = spawn.yaw;
    this.state = createMovementState(this.spawn, this.yaw);
    this.sensitivity = options.sensitivity ?? 0.0022;
    this.invertY = options.invertY ?? false;

    this.attach();
    this.syncCamera();
  }

  // ------------------------------------------------------------- lifecycle

  private attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never swallow the browser's own escape hatches.
      if (e.code === "F5" || e.code === "F12") return;
      this.held.add(e.code);
      if (this.locked) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.held.delete(e.code);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.locked) return;
      this.yaw += e.movementX * this.sensitivity;
      const dy = e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dy));
    };

    const onMouseDown = (e: MouseEvent) => {
      if (this.locked && e.button === 0) this.firing = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.firing = false;
    };

    const onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        // Dropping lock must also drop every held key, or the player keeps
        // walking into a wall while the pause overlay is up.
        this.held.clear();
        this.firing = false;
      }
      this.onLockChanged?.(this.locked);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    document.addEventListener("pointerlockchange", onLockChange);
    // Losing focus mid-strafe otherwise leaves the key latched down.
    const onBlur = () => this.held.clear();
    window.addEventListener("blur", onBlur);

    this.disposers.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("mousemove", onMouseMove),
      () => window.removeEventListener("mousedown", onMouseDown),
      () => window.removeEventListener("mouseup", onMouseUp),
      () => document.removeEventListener("pointerlockchange", onLockChange),
      () => window.removeEventListener("blur", onBlur),
    );
  }

  dispose(): void {
    this.disposers.forEach((fn) => fn());
    this.disposers.length = 0;
  }

  /** Assigned by the shell so the start gate can react to lock/unlock. */
  onLockChanged?: (locked: boolean) => void;

  requestLock(): void {
    void this.canvas.requestPointerLock();
  }

  get isLocked(): boolean {
    return this.locked;
  }

  // ---------------------------------------------------------------- update

  /** Advance one frame. `deltaMs` comes from the engine, not from a timer. */
  update(deltaMs: number): void {
    // Clamp exactly as the server would, so a long frame (tab restore, GC
    // pause) cannot teleport the player.
    const dtMs = Math.min(deltaMs, MAX_INPUT_DT_MS);
    if (dtMs <= 0) return;

    const input: InputFrame = {
      seq: (this.seq += 1),
      dtMs,
      moveX: this.axis("KeyD", "KeyA"),
      moveZ: this.axis("KeyW", "KeyS"),
      yaw: this.yaw,
      pitch: this.pitch,
      buttons: this.buttons(),
      clientTimeMs: performance.now(),
    };

    this.state = stepMovement(this.state, input, this.map);

    // The kill plane exists so a geometry hole cannot strand a player; in
    // single-player the honest response is simply to put them back.
    if (isBelowKillPlane(this.state.position, this.map)) {
      this.state = createMovementState(this.spawn, this.yaw);
    }

    this.syncCamera();
  }

  private axis(positive: string, negative: string): number {
    let value = 0;
    if (this.held.has(positive)) value += 1;
    if (this.held.has(negative)) value -= 1;
    return value;
  }

  private buttons(): number {
    let mask = 0;
    if (this.held.has("Space")) mask |= BUTTON.JUMP;
    if (this.held.has("ControlLeft") || this.held.has("KeyC")) mask |= BUTTON.CROUCH;
    if (this.held.has("ShiftLeft")) mask |= BUTTON.SPRINT;
    if (this.firing) mask |= BUTTON.FIRE;
    if (this.held.has("KeyQ")) mask |= BUTTON.ADS;
    return mask;
  }

  private syncCamera(): void {
    const eye = this.state.crouching ? EYE_HEIGHT_CROUCHED : EYE_HEIGHT_STANDING;
    this.camera.position.set(
      this.state.position.x,
      this.state.position.y + eye,
      this.state.position.z,
    );

    // Babylon's FreeCamera yaw is measured from +Z, matching the simulation's
    // convention, so the angles can be handed straight over.
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    void this.scene;
  }

  status(): ControllerStatus {
    const v = this.state.velocity;
    return {
      position: { ...this.state.position },
      speed: Math.hypot(v.x, v.z),
      grounded: this.state.grounded,
      crouching: this.state.crouching,
      sprinting: this.held.has("ShiftLeft"),
      locked: this.locked,
    };
  }

  /** World-space eye position, used for muzzle origin and audio. */
  eyePosition(): Vector3 {
    return this.camera.position.clone();
  }
}
