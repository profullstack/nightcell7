import { BUTTON, type InputFrame } from "@nightcell7/multiplayer-protocol";
import { TICK_MS } from "./constants";
import type { MatchSimulation, SimPlayer } from "./simulation";
import { distance, horizontalLength, sub } from "./vec";

/**
 * Bot controller (PRD §18.11).
 *
 * Bots exist to make the alpha playable at low population — not to fake player
 * counts. They drive the *same* input path as a human: they produce
 * `InputFrame`s and hand them to `queueInput`, so they are subject to identical
 * server validation, movement rules, fire cadence and ammunition. A bot cannot
 * do anything a client could not.
 *
 * Difficulty is tuned for onboarding, deliberately not for perfect aim.
 */

export interface BotTuning {
  /** Radians of aim error at rest; larger = worse aim. */
  aimError: number;
  /** How quickly the bot turns toward its target, radians per second. */
  turnRate: number;
  /** Delay between acquiring a target and opening fire. */
  reactionMs: number;
  /** Range beyond which the bot will not engage. */
  engageRangeM: number;
  /** Distance the bot tries to hold from its target. */
  preferredRangeM: number;
}

export const DEFAULT_BOT_TUNING: BotTuning = {
  aimError: 0.06,
  turnRate: 3.2,
  reactionMs: 420,
  engageRangeM: 45,
  preferredRangeM: 14,
};

/** Small deterministic PRNG so a bot match can be replayed exactly. */
class Lcg {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
  signed(): number {
    return this.next() * 2 - 1;
  }
}

export class BotController {
  private seq = 0;
  private readonly rng: Lcg;
  private targetId: string | null = null;
  private targetAcquiredAtMs = 0;

  constructor(
    readonly playerId: string,
    seed: number,
    readonly tuning: BotTuning = DEFAULT_BOT_TUNING,
  ) {
    this.rng = new Lcg(seed);
  }

  /** Produce one input frame for this tick and queue it on the simulation. */
  update(sim: MatchSimulation): void {
    const self = sim.players.get(this.playerId);
    if (!self || !self.alive) return;

    const target = this.pickTarget(sim, self);
    const dtMs = TICK_MS;

    let yaw = self.movement.yaw;
    let pitch = self.movement.pitch;
    let moveX = 0;
    let moveZ = 0;
    let buttons = 0;

    if (target) {
      const toTarget = sub(target.movement.position, self.movement.position);
      const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
      const eyeDelta = toTarget.y + 0.9;
      const desiredPitch = -Math.atan2(eyeDelta, Math.max(0.001, horizontalLength(toTarget)));

      const maxTurn = this.tuning.turnRate * (dtMs / 1000);
      yaw = approachAngle(yaw, desiredYaw + this.rng.signed() * this.tuning.aimError, maxTurn);
      pitch = approachAngle(
        pitch,
        desiredPitch + this.rng.signed() * this.tuning.aimError,
        maxTurn,
      );

      const range = distance(self.movement.position, target.movement.position);
      // Close the gap, then hold a working distance rather than sprinting into
      // contact — this reads as "cautious", not "melee-seeking".
      if (range > this.tuning.preferredRangeM + 3) {
        moveZ = 1;
        if (range > this.tuning.preferredRangeM * 2) buttons |= BUTTON.SPRINT;
      } else if (range < this.tuning.preferredRangeM - 4) {
        moveZ = -1;
      } else {
        moveX = this.rng.next() > 0.5 ? 0.7 : -0.7;
      }

      const acquiredFor = sim.elapsedMs - this.targetAcquiredAtMs;
      const aimed = Math.abs(angleDelta(yaw, desiredYaw)) < 0.09;
      if (acquiredFor >= this.tuning.reactionMs && aimed && range <= this.tuning.engageRangeM) {
        buttons |= BUTTON.FIRE;
      }
    } else {
      // Patrol: wander toward the middle of the map so bots do not idle in spawn.
      const toCentre = sub({ x: 0, y: 0, z: 0 }, self.movement.position);
      if (horizontalLength(toCentre) > 6) {
        yaw = approachAngle(
          yaw,
          Math.atan2(toCentre.x, toCentre.z),
          this.tuning.turnRate * (dtMs / 1000),
        );
        moveZ = 1;
      }
    }

    this.seq += 1;
    const frame: InputFrame = {
      seq: this.seq,
      dtMs,
      moveX,
      moveZ,
      yaw,
      pitch,
      buttons,
      clientTimeMs: sim.elapsedMs,
    };

    sim.queueInput(this.playerId, [frame]);
  }

  private pickTarget(sim: MatchSimulation, self: SimPlayer): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bestDistance = Infinity;

    for (const other of sim.players.values()) {
      if (other.id === self.id) continue;
      if (other.team === self.team) continue;
      if (!other.alive) continue;
      const d = distance(self.movement.position, other.movement.position);
      if (d > this.tuning.engageRangeM) continue;
      if (d < bestDistance) {
        best = other;
        bestDistance = d;
      }
    }

    if (best?.id !== this.targetId) {
      this.targetId = best?.id ?? null;
      this.targetAcquiredAtMs = sim.elapsedMs;
    }

    return best;
  }
}

function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function approachAngle(from: number, to: number, maxStep: number): number {
  const delta = angleDelta(from, to);
  const step = Math.min(Math.abs(delta), maxStep) * Math.sign(delta);
  return from + step;
}
