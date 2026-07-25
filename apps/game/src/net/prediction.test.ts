import { describe, expect, it } from "vitest";
import { BUTTON, type InputFrame } from "@nightcell7/multiplayer-protocol";
import { MatchSimulation, TICK_MS, type CollisionMap } from "@nightcell7/multiplayer-sim";
import {
  INTERPOLATION_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  PredictedPlayer,
  RemotePlayerInterpolator,
  SNAP_THRESHOLD_M,
} from "./prediction";

const FLAT_MAP: CollisionMap = {
  id: "test-flat",
  displayName: "Flat",
  bounds: { min: { x: -100, y: -20, z: -100 }, max: { x: 100, y: 50, z: 100 } },
  killPlaneY: -10,
  boxes: [{ min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 0, z: 100 } }],
  spawns: [
    { position: { x: 0, y: 0, z: 0 }, yaw: 0, team: 0, label: "A" },
    { position: { x: 0, y: 0, z: 20 }, yaw: Math.PI, team: 1, label: "B" },
  ],
};

function frame(seq: number, overrides: Partial<InputFrame> = {}): InputFrame {
  return {
    seq,
    dtMs: TICK_MS,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    clientTimeMs: seq * TICK_MS,
    ...overrides,
  };
}

describe("client prediction against the real server simulation", () => {
  it("agrees with the server when both run the same inputs", () => {
    // This is the core guarantee: the client's prediction model and the
    // authoritative server share `stepMovement`, so with identical input they
    // must land in the same place (PRD §40, "two clients must be unable to
    // disagree about who moved").
    const sim = new MatchSimulation({ matchId: "m", map: FLAT_MAP });
    sim.startNow();
    const server = sim.addPlayer({ id: "a", userId: "ua", displayName: "A", preferredTeam: 0 });
    server.movement.position = { x: 0, y: 0, z: 0 };
    server.movement.velocity = { x: 0, y: 0, z: 0 };

    const client = new PredictedPlayer(FLAT_MAP, { x: 0, y: 0, z: 0 }, 0);

    for (let i = 0; i < 60; i += 1) {
      const input = frame(client.allocateSeq(), { moveZ: 1, buttons: BUTTON.SPRINT });
      client.applyLocalInput(input);
      sim.queueInput("a", [input]);
      sim.step();
    }

    expect(client.state.position.z).toBeCloseTo(server.movement.position.z, 3);
    expect(client.state.position.x).toBeCloseTo(server.movement.position.x, 3);
  });

  it("moves immediately on local input without waiting for the server", () => {
    const client = new PredictedPlayer(FLAT_MAP, { x: 0, y: 0, z: 0 }, 0);
    client.applyLocalInput(frame(client.allocateSeq(), { moveZ: 1 }));
    expect(client.state.position.z).toBeGreaterThan(0);
    expect(client.pendingCount()).toBe(1);
  });

  it("drops acknowledged inputs and replays only the rest", () => {
    const client = new PredictedPlayer(FLAT_MAP, { x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 5; i += 1) {
      client.applyLocalInput(frame(client.allocateSeq(), { moveZ: 1 }));
    }
    expect(client.pendingCount()).toBe(5);

    client.reconcile({
      position: { ...client.state.position },
      velocity: { ...client.state.velocity },
      yaw: 0,
      pitch: 0,
      crouching: false,
      grounded: true,
      lastAckedSeq: 3,
    });

    expect(client.pendingCount()).toBe(2);
    expect(client.stats.replayedInputs).toBe(2);
  });

  it("converges back to the server after a divergence, and the server wins", () => {
    const client = new PredictedPlayer(FLAT_MAP, { x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 10; i += 1) {
      client.applyLocalInput(frame(client.allocateSeq(), { moveZ: 1 }));
    }

    // Server says the player is somewhere else entirely — e.g. it rejected
    // some movement. The client must not keep its own answer.
    client.reconcile({
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      crouching: false,
      grounded: true,
      lastAckedSeq: 10,
    });

    expect(client.pendingCount()).toBe(0);
    expect(client.state.position.z).toBeCloseTo(0, 6);
    expect(client.stats.corrections).toBe(1);
  });

  it("smooths a small correction visually but never changes the gameplay position", () => {
    const client = new PredictedPlayer(FLAT_MAP, { x: 0, y: 0, z: 0 }, 0);
    client.applyLocalInput(frame(client.allocateSeq(), { moveZ: 1 }));
    const predicted = { ...client.state.position };

    client.reconcile({
      position: { x: predicted.x, y: predicted.y, z: predicted.z - 0.15 },
      velocity: { ...client.state.velocity },
      yaw: 0,
      pitch: 0,
      crouching: false,
      grounded: true,
      lastAckedSeq: 1,
    });

    // Authoritative position moved; the render position lags behind it.
    expect(client.state.position.z).toBeCloseTo(predicted.z - 0.15, 6);
    expect(client.renderPosition().z).not.toBeCloseTo(client.state.position.z, 6);

    // And the visual error decays toward zero.
    for (let i = 0; i < 40; i += 1) client.updateSmoothing();
    expect(Math.abs(client.renderPosition().z - client.state.position.z)).toBeLessThan(0.001);
  });

  it("snaps instead of smoothing when the correction is large", () => {
    const client = new PredictedPlayer(FLAT_MAP, { x: 0, y: 0, z: 0 }, 0);
    client.applyLocalInput(frame(client.allocateSeq(), { moveZ: 1 }));

    client.reconcile({
      position: { x: 0, y: 0, z: SNAP_THRESHOLD_M + 5 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      crouching: false,
      grounded: true,
      lastAckedSeq: 1,
    });

    expect(client.stats.snaps).toBe(1);
    // No hidden offset: the player is shown where the server says they are.
    expect(client.renderPosition().z).toBeCloseTo(client.state.position.z, 6);
  });

  it("keeps view angles client-owned so aiming stays responsive", () => {
    const client = new PredictedPlayer(FLAT_MAP, { x: 0, y: 0, z: 0 }, 0);
    client.applyLocalInput(frame(client.allocateSeq(), { yaw: 1.2, pitch: -0.3 }));

    client.reconcile({
      position: { ...client.state.position },
      velocity: { ...client.state.velocity },
      yaw: 0,
      pitch: 0,
      crouching: false,
      grounded: true,
      lastAckedSeq: 1,
    });

    expect(client.state.yaw).toBeCloseTo(1.2, 6);
    expect(client.state.pitch).toBeCloseTo(-0.3, 6);
  });

  it("bounds the pending input buffer if acknowledgements stop", () => {
    const client = new PredictedPlayer(FLAT_MAP, { x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 1000; i += 1) {
      client.applyLocalInput(frame(client.allocateSeq(), { moveZ: 1 }));
    }
    expect(client.pendingCount()).toBeLessThanOrEqual(240);
  });
});

describe("remote player interpolation", () => {
  function filled(): RemotePlayerInterpolator {
    const interp = new RemotePlayerInterpolator();
    for (let i = 0; i <= 10; i += 1) {
      interp.push({
        atMs: i * 50,
        position: { x: 0, y: 0, z: i },
        yaw: 0,
        pitch: 0,
        crouching: false,
      });
    }
    return interp;
  }

  it("renders behind server time and interpolates between snapshots", () => {
    const interp = filled();
    // At t=525 the render target is 425 ms, between the z=8 and z=9 snapshots.
    const sample = interp.sample(425 + INTERPOLATION_DELAY_MS);
    expect(sample).not.toBeNull();
    expect(sample!.position.z).toBeCloseTo(8.5, 5);
    expect(sample!.extrapolated).toBe(false);
  });

  it("clamps to the oldest snapshot rather than inventing history", () => {
    const interp = filled();
    const sample = interp.sample(0);
    expect(sample!.position.z).toBe(0);
  });

  it("extrapolates briefly through a gap, then gives up so the caller can snap", () => {
    const interp = filled();
    const newest = 500;

    const shortGap = interp.sample(newest + INTERPOLATION_DELAY_MS + 100);
    expect(shortGap).not.toBeNull();
    expect(shortGap!.extrapolated).toBe(true);

    const longGap = interp.sample(newest + INTERPOLATION_DELAY_MS + MAX_EXTRAPOLATION_MS + 1);
    expect(longGap).toBeNull();
  });

  it("returns nothing before any snapshot arrives", () => {
    expect(new RemotePlayerInterpolator().sample(1000)).toBeNull();
  });

  it("bounds its history buffer", () => {
    const interp = new RemotePlayerInterpolator();
    for (let i = 0; i < 500; i += 1) {
      interp.push({
        atMs: i * 50,
        position: { x: 0, y: 0, z: i },
        yaw: 0,
        pitch: 0,
        crouching: false,
      });
    }
    expect(interp.size).toBeLessThanOrEqual(40);
  });

  it("takes the shortest path when interpolating yaw across the wrap point", () => {
    const interp = new RemotePlayerInterpolator(0);
    interp.push({ atMs: 0, position: { x: 0, y: 0, z: 0 }, yaw: 3.0, pitch: 0, crouching: false });
    interp.push({
      atMs: 100,
      position: { x: 0, y: 0, z: 0 },
      yaw: -3.0,
      pitch: 0,
      crouching: false,
    });

    const sample = interp.sample(50)!;
    // Going 3.0 -> -3.0 the short way passes through +/- pi, not through 0.
    expect(Math.abs(sample.yaw)).toBeGreaterThan(3.0);
  });
});
