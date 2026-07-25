import { z } from "zod";

/**
 * Client input intent.
 *
 * PRD §18.3: the client sends input, never truth. There is deliberately no
 * position, velocity, hit claim or ammunition count in this structure — the
 * server derives all of that. The aim origin is taken from the server's own
 * authoritative position plus eye height, so a client cannot shoot from a
 * place it is not standing.
 */

export const BUTTON = {
  JUMP: 1 << 0,
  CROUCH: 1 << 1,
  SPRINT: 1 << 2,
  FIRE: 1 << 3,
  ADS: 1 << 4,
} as const;

export type ButtonMask = number;

export function hasButton(mask: ButtonMask, button: number): boolean {
  return (mask & button) !== 0;
}

/** Input is accepted at up to 60 Hz (PRD §30.4). */
export const MAX_INPUT_HZ = 60;
export const MIN_INPUT_DT_MS = 1000 / MAX_INPUT_HZ;

/**
 * A single simulation step requested by the client. `dtMs` is clamped on the
 * server regardless of what arrives — a client claiming a 900 ms frame must
 * not be able to travel 900 ms worth of distance in one packet.
 */
export const MAX_INPUT_DT_MS = 50;

export interface InputFrame {
  /** Strictly increasing per connection. Duplicates and regressions are dropped. */
  seq: number;
  /** Client-measured frame duration in ms, clamped server-side. */
  dtMs: number;
  /** Movement axes in local space, each clamped to [-1, 1]. */
  moveX: number;
  moveZ: number;
  /** View angles in radians. Yaw wraps; pitch is clamped to +/- 89 degrees. */
  yaw: number;
  pitch: number;
  buttons: ButtonMask;
  /** Client clock, used only for latency estimation and never for simulation. */
  clientTimeMs: number;
}

export const inputFrameSchema = z.object({
  seq: z.number().int().nonnegative(),
  dtMs: z.number().finite().min(0),
  moveX: z.number().finite(),
  moveZ: z.number().finite(),
  yaw: z.number().finite(),
  pitch: z.number().finite(),
  buttons: z.number().int().nonnegative().max(0xff),
  clientTimeMs: z.number().finite().nonnegative(),
});

/** Input frames are batched so one packet can carry a burst after a hitch. */
export const MAX_INPUT_BATCH = 8;

export const inputBatchSchema = z.object({
  frames: z.array(inputFrameSchema).min(1).max(MAX_INPUT_BATCH),
});

export type InputBatch = z.infer<typeof inputBatchSchema>;

/**
 * Normalise an untrusted frame into something the simulation can safely run.
 * This is the single place where client numbers become server numbers.
 */
export function sanitizeInputFrame(frame: InputFrame): InputFrame {
  const moveX = clamp(frame.moveX, -1, 1);
  const moveZ = clamp(frame.moveZ, -1, 1);
  // Prevent diagonal speed advantage before the sim ever sees the vector.
  const magnitude = Math.hypot(moveX, moveZ);
  const scale = magnitude > 1 ? 1 / magnitude : 1;

  return {
    seq: frame.seq,
    dtMs: clamp(frame.dtMs, 0, MAX_INPUT_DT_MS),
    moveX: moveX * scale,
    moveZ: moveZ * scale,
    yaw: wrapAngle(frame.yaw),
    pitch: clamp(frame.pitch, -MAX_PITCH, MAX_PITCH),
    buttons: frame.buttons & 0xff,
    clientTimeMs: frame.clientTimeMs,
  };
}

export const MAX_PITCH = (89 * Math.PI) / 180;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

export function wrapAngle(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const twoPi = Math.PI * 2;
  let a = radians % twoPi;
  if (a > Math.PI) a -= twoPi;
  if (a < -Math.PI) a += twoPi;
  return a;
}
