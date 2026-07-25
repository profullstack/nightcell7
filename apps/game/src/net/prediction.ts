import type { InputFrame } from "@nightcell7/multiplayer-protocol";
import {
  createMovementState,
  stepMovement,
  type CollisionMap,
  type MovementState,
  type Vec3,
} from "@nightcell7/multiplayer-sim";

/**
 * Client-side prediction and reconciliation (PRD §18.4).
 *
 * The local player moves immediately on their own input, then rewinds to the
 * server's authoritative state and replays anything the server has not yet
 * acknowledged. Because both sides run the *same* `stepMovement`, a correction
 * is normally sub-millimetre; when it is not, the server wins by definition.
 *
 * Deliberately Babylon-free: the renderer reads `state` each frame, but this
 * class can be tested in Node against the real simulation code.
 */

/** Above this error the visual correction is snapped rather than smoothed. */
export const SNAP_THRESHOLD_M = 2.0;

/** Fraction of remaining visual error removed per 60 Hz frame. */
export const SMOOTHING_PER_FRAME = 0.25;

export interface AuthoritativeState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  grounded: boolean;
  /** Highest input sequence the server has simulated for this player. */
  lastAckedSeq: number;
}

export interface ReconciliationStats {
  corrections: number;
  snaps: number;
  lastErrorM: number;
  maxErrorM: number;
  replayedInputs: number;
}

export class PredictedPlayer {
  /** Predicted state — what the local player feels. */
  state: MovementState;

  /**
   * Visual offset applied on top of `state` so a correction is smoothed out
   * over a few frames instead of teleporting the camera. Never used for
   * gameplay decisions, only for rendering.
   */
  visualOffset: Vec3 = { x: 0, y: 0, z: 0 };

  readonly stats: ReconciliationStats = {
    corrections: 0,
    snaps: 0,
    lastErrorM: 0,
    maxErrorM: 0,
    replayedInputs: 0,
  };

  /** Inputs sent but not yet acknowledged, ordered by sequence. */
  private pending: InputFrame[] = [];
  private nextSeq = 0;

  constructor(
    private readonly map: CollisionMap,
    spawn: Vec3,
    yaw = 0,
  ) {
    this.state = createMovementState(spawn, yaw);
  }

  /** Allocate the next input sequence number. */
  allocateSeq(): number {
    this.nextSeq += 1;
    return this.nextSeq;
  }

  /**
   * Apply an input locally and remember it for replay.
   * Returns the frame so the caller can send exactly what was simulated.
   */
  applyLocalInput(frame: InputFrame): InputFrame {
    this.state = stepMovement(this.state, frame, this.map);
    this.pending.push(frame);
    // Bound the buffer: if acks stop arriving we are disconnected anyway, and
    // an unbounded array would be a slow leak.
    if (this.pending.length > 240) this.pending.shift();
    return frame;
  }

  /**
   * Reconcile against authoritative state.
   *
   * 1. Drop acknowledged inputs.
   * 2. Rewind to the server position.
   * 3. Replay the unacknowledged inputs.
   * 4. Convert any residual difference into a visual offset to be smoothed.
   */
  reconcile(authoritative: AuthoritativeState): void {
    const before = { ...this.state.position };

    this.pending = this.pending.filter((frame) => frame.seq > authoritative.lastAckedSeq);

    this.state = {
      position: { ...authoritative.position },
      velocity: { ...authoritative.velocity },
      yaw: this.state.yaw, // view angles stay client-owned for responsiveness
      pitch: this.state.pitch,
      crouching: authoritative.crouching,
      grounded: authoritative.grounded,
    };

    for (const frame of this.pending) {
      this.state = stepMovement(this.state, frame, this.map);
      this.stats.replayedInputs += 1;
    }

    const error = Math.hypot(
      this.state.position.x - before.x,
      this.state.position.y - before.y,
      this.state.position.z - before.z,
    );

    this.stats.lastErrorM = error;
    this.stats.maxErrorM = Math.max(this.stats.maxErrorM, error);

    if (error > 1e-4) {
      this.stats.corrections += 1;
      if (error > SNAP_THRESHOLD_M) {
        // A large correction is shown honestly rather than hidden by a long
        // smooth — PRD §18.4 forbids masking a material correction.
        this.stats.snaps += 1;
        this.visualOffset = { x: 0, y: 0, z: 0 };
      } else {
        this.visualOffset = {
          x: before.x - this.state.position.x,
          y: before.y - this.state.position.y,
          z: before.z - this.state.position.z,
        };
      }
    }
  }

  /** Decay the visual offset. Call once per rendered frame. */
  updateSmoothing(): void {
    this.visualOffset = {
      x: this.visualOffset.x * (1 - SMOOTHING_PER_FRAME),
      y: this.visualOffset.y * (1 - SMOOTHING_PER_FRAME),
      z: this.visualOffset.z * (1 - SMOOTHING_PER_FRAME),
    };
  }

  /** Where the camera should actually be drawn this frame. */
  renderPosition(): Vec3 {
    return {
      x: this.state.position.x + this.visualOffset.x,
      y: this.state.position.y + this.visualOffset.y,
      z: this.state.position.z + this.visualOffset.z,
    };
  }

  pendingCount(): number {
    return this.pending.length;
  }
}

// --------------------------------------------------------------------------
// Remote player interpolation
// --------------------------------------------------------------------------

/** Render remote players this far behind server time (PRD §30.4). */
export const INTERPOLATION_DELAY_MS = 100;

/** Never extrapolate further than this before showing a recovery. */
export const MAX_EXTRAPOLATION_MS = 250;

export interface RemoteSnapshot {
  atMs: number;
  position: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
}

/**
 * Buffers authoritative snapshots and produces a smooth position `renderTime`
 * behind the newest one.
 */
export class RemotePlayerInterpolator {
  private readonly buffer: RemoteSnapshot[] = [];

  constructor(private readonly delayMs = INTERPOLATION_DELAY_MS) {}

  push(snapshot: RemoteSnapshot): void {
    this.buffer.push(snapshot);
    // Keep roughly a second of history — enough to interpolate through a
    // hiccup, bounded so a long match cannot grow memory.
    while (this.buffer.length > 40) this.buffer.shift();
  }

  /**
   * Sample the buffer at `nowMs`.
   * Returns `extrapolated: true` when running ahead of known data, and null
   * once the safe extrapolation window is exceeded so the caller can snap.
   */
  sample(nowMs: number): (RemoteSnapshot & { extrapolated: boolean }) | null {
    if (this.buffer.length === 0) return null;
    const target = nowMs - this.delayMs;

    const newest = this.buffer[this.buffer.length - 1]!;
    if (target >= newest.atMs) {
      const ahead = target - newest.atMs;
      if (ahead > MAX_EXTRAPOLATION_MS) return null;
      return { ...newest, extrapolated: ahead > 0 };
    }

    const oldest = this.buffer[0]!;
    if (target <= oldest.atMs) return { ...oldest, extrapolated: false };

    for (let i = this.buffer.length - 1; i > 0; i -= 1) {
      const after = this.buffer[i]!;
      const before = this.buffer[i - 1]!;
      if (before.atMs <= target && target <= after.atMs) {
        const span = after.atMs - before.atMs;
        const t = span > 0 ? (target - before.atMs) / span : 0;
        return {
          atMs: target,
          position: {
            x: lerp(before.position.x, after.position.x, t),
            y: lerp(before.position.y, after.position.y, t),
            z: lerp(before.position.z, after.position.z, t),
          },
          yaw: lerpAngle(before.yaw, after.yaw, t),
          pitch: lerp(before.pitch, after.pitch, t),
          crouching: t < 0.5 ? before.crouching : after.crouching,
          extrapolated: false,
        };
      }
    }

    return { ...newest, extrapolated: false };
  }

  clear(): void {
    this.buffer.length = 0;
  }

  get size(): number {
    return this.buffer.length;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
