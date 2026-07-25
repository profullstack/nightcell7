import { Client, type Room } from "colyseus.js";
import {
  BUTTON,
  CLIENT_MESSAGE,
  CONTENT_VERSION,
  MAX_INPUT_BATCH,
  PROTOCOL_VERSION,
  SERVER_MESSAGE,
  type AckPayload,
  type ClientPlatform,
  type InputFrame,
  type KillPayload,
  type MatchEndPayload,
  type MatchState,
  type RejectedPayload,
  type WelcomePayload,
} from "@nightcell7/multiplayer-protocol";
import { ARDAVAN_YARD, TICK_MS, type CollisionMap } from "@nightcell7/multiplayer-sim";
import { PredictedPlayer, RemotePlayerInterpolator } from "./prediction";

/**
 * Multiplayer client.
 *
 * Connects only to the URL the matchmaking API handed back — it never builds a
 * WebSocket address itself and never sees an internal Railway host
 * (PRD §18.6, §29.2).
 */

export interface NetClientEvents {
  onWelcome?(payload: WelcomePayload): void;
  onKill?(payload: KillPayload): void;
  onMatchEnd?(payload: MatchEndPayload): void;
  onRejected?(payload: RejectedPayload): void;
  onDisconnected?(code: number): void;
}

export interface JoinRequest {
  /** Exact `websocketUrl` from POST /api/v1/multiplayer/tickets. */
  websocketUrl: string;
  buildVersion: string;
  platform: ClientPlatform;
}

export class NetClient {
  private room?: Room<MatchState>;
  private predicted?: PredictedPlayer;
  private readonly remotes = new Map<string, RemotePlayerInterpolator>();
  private inputQueue: InputFrame[] = [];
  private accumulatorMs = 0;
  private sessionId = "";

  constructor(
    private readonly events: NetClientEvents = {},
    private readonly map: CollisionMap = ARDAVAN_YARD,
  ) {}

  async join(request: JoinRequest): Promise<void> {
    const url = new URL(request.websocketUrl);
    const ticket = url.searchParams.get("ticket");
    if (!ticket) throw new Error("matchmaking response did not include a ticket");

    // Strip the ticket from the endpoint the transport keeps around, so it
    // cannot end up in a console log or an error report (PRD §33.3).
    url.searchParams.delete("ticket");

    const client = new Client(`${url.protocol}//${url.host}`);

    this.room = await client.joinById<MatchState>(this.roomIdFromPath(url.pathname), {
      ticket,
      buildVersion: request.buildVersion,
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      platform: request.platform,
    });

    this.bind(this.room);
  }

  private roomIdFromPath(pathname: string): string {
    // /api/v1/multiplayer/sync/{region}/{shard}/{roomId}
    const parts = pathname.split("/").filter(Boolean);
    const roomId = parts[parts.length - 1];
    if (!roomId) throw new Error("malformed sync path");
    return roomId;
  }

  private bind(room: Room<MatchState>): void {
    room.onMessage(SERVER_MESSAGE.WELCOME, (payload: WelcomePayload) => {
      this.sessionId = payload.sessionId;
      const me = room.state.players.get(payload.sessionId);
      this.predicted = new PredictedPlayer(
        this.map,
        { x: me?.x ?? 0, y: me?.y ?? 0, z: me?.z ?? 0 },
        me?.yaw ?? 0,
      );
      this.events.onWelcome?.(payload);
    });

    room.onMessage(SERVER_MESSAGE.ACK, (ack: AckPayload) => {
      const me = room.state.players.get(this.sessionId);
      if (!me || !this.predicted) return;
      // The authoritative state always comes from the schema; the ack only
      // tells us how far the server has consumed our input.
      this.predicted.reconcile({
        position: { x: me.x, y: me.y, z: me.z },
        velocity: { x: me.vx, y: me.vy, z: me.vz },
        yaw: me.yaw,
        pitch: me.pitch,
        crouching: me.crouching,
        grounded: me.grounded,
        lastAckedSeq: ack.seq,
      });
    });

    room.onMessage(SERVER_MESSAGE.PING, (payload: { id: number }) => {
      room.send(CLIENT_MESSAGE.PONG, { id: payload.id });
    });

    room.onMessage(SERVER_MESSAGE.KILL, (payload: KillPayload) => this.events.onKill?.(payload));
    room.onMessage(SERVER_MESSAGE.MATCH_END, (payload: MatchEndPayload) =>
      this.events.onMatchEnd?.(payload),
    );
    room.onMessage(SERVER_MESSAGE.REJECTED, (payload: RejectedPayload) =>
      this.events.onRejected?.(payload),
    );

    room.onLeave((code) => this.events.onDisconnected?.(code));
  }

  /**
   * Feed one rendered frame of input.
   *
   * Input is produced at a fixed rate regardless of frame rate, so a 144 Hz
   * machine does not send more (or move further) than a 60 Hz one.
   */
  update(deltaMs: number, intent: InputIntent): void {
    if (!this.predicted || !this.room) return;

    this.accumulatorMs += deltaMs;
    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;

      const frame: InputFrame = {
        seq: this.predicted.allocateSeq(),
        dtMs: TICK_MS,
        moveX: intent.moveX,
        moveZ: intent.moveZ,
        yaw: intent.yaw,
        pitch: intent.pitch,
        buttons: intent.buttons,
        clientTimeMs: performance.now(),
      };

      this.predicted.applyLocalInput(frame);
      this.inputQueue.push(frame);
    }

    if (this.inputQueue.length > 0) {
      const frames = this.inputQueue.splice(0, MAX_INPUT_BATCH);
      this.room.send(CLIENT_MESSAGE.INPUT, { frames });
    }

    this.predicted.updateSmoothing();
    this.sampleRemotes();
  }

  private sampleRemotes(): void {
    if (!this.room) return;
    const now = performance.now();
    this.room.state.players.forEach((player, sessionId) => {
      if (sessionId === this.sessionId) return;
      let interpolator = this.remotes.get(sessionId);
      if (!interpolator) {
        interpolator = new RemotePlayerInterpolator();
        this.remotes.set(sessionId, interpolator);
      }
      interpolator.push({
        atMs: now,
        position: { x: player.x, y: player.y, z: player.z },
        yaw: player.yaw,
        pitch: player.pitch,
        crouching: player.crouching,
      });
    });

    for (const sessionId of this.remotes.keys()) {
      if (!this.room.state.players.get(sessionId)) this.remotes.delete(sessionId);
    }
  }

  remotePosition(sessionId: string) {
    return this.remotes.get(sessionId)?.sample(performance.now()) ?? null;
  }

  get localPlayer(): PredictedPlayer | undefined {
    return this.predicted;
  }

  get state(): MatchState | undefined {
    return this.room?.state;
  }

  reload(): void {
    this.room?.send(CLIENT_MESSAGE.RELOAD, { seq: this.predicted?.allocateSeq() ?? 0 });
  }

  switchWeapon(slot: number): void {
    this.room?.send(CLIENT_MESSAGE.SWITCH_WEAPON, {
      seq: this.predicted?.allocateSeq() ?? 0,
      slot,
    });
  }

  async leave(): Promise<void> {
    await this.room?.leave(true);
    this.room = undefined;
    this.remotes.clear();
    this.inputQueue = [];
  }
}

export interface InputIntent {
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  buttons: number;
}

export function emptyIntent(): InputIntent {
  return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 };
}

/** Translate held keys into the protocol's button bitfield. */
export function buttonsFromKeys(keys: Set<string>): number {
  let buttons = 0;
  if (keys.has("Space")) buttons |= BUTTON.JUMP;
  if (keys.has("ControlLeft") || keys.has("KeyC")) buttons |= BUTTON.CROUCH;
  if (keys.has("ShiftLeft")) buttons |= BUTTON.SPRINT;
  if (keys.has("Mouse0")) buttons |= BUTTON.FIRE;
  if (keys.has("Mouse2")) buttons |= BUTTON.ADS;
  return buttons;
}
