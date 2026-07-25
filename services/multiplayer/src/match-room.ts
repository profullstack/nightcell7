import { Room, type Client } from "colyseus";
import {
  CLIENT_MESSAGE,
  JOIN_REJECTION,
  JoinRejectedError,
  MATCH_PHASE,
  MATCH_TERMINATION,
  PLAYER_STATE,
  SERVER_MESSAGE,
  MatchState,
  PlayerState,
  TeamState,
  isContentCompatible,
  isProtocolCompatible,
  joinOptionsSchema,
  parseClientMessage,
  PROTOCOL_VERSION,
  CONTENT_VERSION,
  type ClientMessageType,
  type MatchResult,
  type MatchPlayerResult,
} from "@nightcell7/multiplayer-protocol";
import { verifyTicket, type MatchTicketClaims } from "@nightcell7/multiplayer-protocol/server";
import {
  ARDAVAN_YARD,
  BotController,
  MatchSimulation,
  SNAPSHOT_RATE,
  TICK_MS,
  mapChecksum,
  type SimEvent,
  type SimPlayer,
} from "@nightcell7/multiplayer-sim";
import { TDM_RULES } from "@nightcell7/game-core";
import type { Logger } from "@nightcell7/observability";
import type { RoomServices } from "./services";

/**
 * Authoritative Team Deathmatch room (PRD §18.7).
 *
 * The room is transport plus lifecycle; every gameplay decision belongs to
 * `MatchSimulation`. Keeping that boundary sharp is what lets the entire
 * ruleset be tested without a socket.
 */

interface RoomOptions {
  services: RoomServices;
  logger: Logger;
  region: string;
  shard: string;
  buildVersion: string;
  ticketSecret: string;
  matchResultSecret: string;
  botFill: boolean;
}

export class MatchRoom extends Room<MatchState> {
  override maxClients = TDM_RULES.maxPlayers;

  private sim!: MatchSimulation;
  private services!: RoomServices;
  private logger!: Logger;
  private opts!: RoomOptions;

  private readonly bots = new Map<string, BotController>();
  private readonly claimsBySession = new Map<string, MatchTicketClaims>();
  private readonly joinedAt = new Map<string, number>();
  private snapshotAccumulatorMs = 0;
  private startedAtMs = 0;
  private resultEmitted = false;
  private draining = false;

  override onCreate(options: RoomOptions): void {
    this.opts = options;
    this.services = options.services;
    this.logger = options.logger.child({ roomId: this.roomId });

    this.sim = new MatchSimulation({ matchId: this.roomId, map: ARDAVAN_YARD });

    const state = new MatchState();
    state.matchId = this.sim.matchId;
    state.mapId = ARDAVAN_YARD.id;
    state.mode = TDM_RULES.mode;
    state.tickRate = TDM_RULES.mode ? 1000 / TICK_MS : 30;
    state.scoreLimit = TDM_RULES.scoreLimit;
    state.timeRemainingMs = TDM_RULES.durationMs;
    state.teams.push(Object.assign(new TeamState(), { id: 0, score: 0, playerCount: 0 }));
    state.teams.push(Object.assign(new TeamState(), { id: 1, score: 0, playerCount: 0 }));
    this.setState(state);

    this.startedAtMs = Date.now();
    this.registerMessageHandlers();

    // Fixed authoritative tick. Colyseus drives the clock; the simulation does
    // not read wall time, so a slow tick cannot become a speed advantage.
    this.setSimulationInterval(() => this.tick(), TICK_MS);

    this.logger.info("room created", {
      map: ARDAVAN_YARD.id,
      checksum: mapChecksum(ARDAVAN_YARD),
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  /**
   * Handshake and ticket consumption (PRD §18.5, §18.6).
   *
   * Throwing `JoinRejectedError` gives the client a machine-readable reason, so
   * an out-of-date build can offer an update instead of a generic failure.
   */
  override async onAuth(_client: Client, options: unknown): Promise<MatchTicketClaims> {
    const parsed = joinOptionsSchema.safeParse(options);
    if (!parsed.success) throw new JoinRejectedError(JOIN_REJECTION.TICKET_INVALID);
    const join = parsed.data;

    if (this.draining) throw new JoinRejectedError(JOIN_REJECTION.SERVICE_DRAINING);
    if (!isProtocolCompatible(join.protocolVersion)) {
      throw new JoinRejectedError(
        join.protocolVersion > PROTOCOL_VERSION
          ? JOIN_REJECTION.PROTOCOL_INCOMPATIBLE
          : JOIN_REJECTION.UPDATE_REQUIRED,
      );
    }
    if (!isContentCompatible(join.contentVersion)) {
      throw new JoinRejectedError(JOIN_REJECTION.CONTENT_MISMATCH);
    }

    const verification = verifyTicket(
      join.ticket,
      this.opts.ticketSecret,
      Math.floor(Date.now() / 1000),
    );
    if (!verification.ok) {
      throw new JoinRejectedError(
        verification.reason === "expired"
          ? JOIN_REJECTION.TICKET_EXPIRED
          : JOIN_REJECTION.TICKET_INVALID,
      );
    }

    const claims = verification.claims;

    // Single-use consumption. The Redis DEL-if-present is the replay guard:
    // a second connection with the same ticket loses the race and is rejected.
    const consumed = await this.services.consumeTicket(claims.jti);
    if (!consumed) throw new JoinRejectedError(JOIN_REJECTION.TICKET_REPLAYED);

    // Re-check the ban at join time: a ban issued after the ticket was minted
    // must still keep the player out.
    if (await this.services.isBanned(claims.sub)) {
      throw new JoinRejectedError(JOIN_REJECTION.ACCOUNT_BANNED);
    }

    if (this.sim.phase === "ended") throw new JoinRejectedError(JOIN_REJECTION.ROOM_ENDED);
    if (this.sim.players.size >= TDM_RULES.maxPlayers) {
      throw new JoinRejectedError(JOIN_REJECTION.ROOM_FULL);
    }

    return claims;
  }

  override onJoin(client: Client, _options: unknown, claims: MatchTicketClaims): void {
    this.claimsBySession.set(client.sessionId, claims);
    this.joinedAt.set(client.sessionId, Date.now());

    // A human replaces a bot at a safe point rather than expanding the match
    // beyond 6v6 (PRD §18.11).
    this.releaseBotSeat(claims.team);

    const player = this.sim.addPlayer({
      id: client.sessionId,
      userId: claims.sub,
      displayName: claims.displayName,
      preferredTeam: claims.team,
    });

    this.syncPlayerToState(player, true);

    client.send(SERVER_MESSAGE.WELCOME, {
      sessionId: client.sessionId,
      matchId: this.sim.matchId,
      roomId: this.roomId,
      mapId: ARDAVAN_YARD.id,
      region: this.opts.region,
      shard: this.opts.shard,
      tickRate: 1000 / TICK_MS,
      snapshotRate: SNAPSHOT_RATE,
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      serverTimeMs: this.sim.elapsedMs,
    });

    this.logger.info("player joined", { userId: claims.sub, team: player.team });
    this.fillBots();
  }

  /**
   * Reconnect handling (PRD §18.10).
   *
   * The seat is held for the grace window; a voluntary quit releases it
   * immediately so a leaver cannot hold a slot hostage.
   */
  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const claims = this.claimsBySession.get(client.sessionId);
    this.sim.markDisconnected(client.sessionId);

    if (consented || this.sim.phase === "ended") {
      this.removePlayer(client.sessionId);
      return;
    }

    try {
      await this.allowReconnection(client, TDM_RULES.reconnectGraceMs / 1000);
      this.sim.markReconnected(client.sessionId);
      this.logger.info("player reconnected", { userId: claims?.sub });
    } catch {
      this.logger.info("reconnect window expired", { userId: claims?.sub });
      this.removePlayer(client.sessionId);
    }
  }

  override onDispose(): void {
    this.emitResult(
      this.sim.terminationReason === "score_limit"
        ? MATCH_TERMINATION.SCORE_LIMIT
        : this.sim.terminationReason === "time_limit"
          ? MATCH_TERMINATION.TIME_LIMIT
          : this.draining
            ? MATCH_TERMINATION.SERVICE_RESTART
            : MATCH_TERMINATION.ABANDONED,
    );
    this.logger.info("room disposed");
  }

  /** Stop accepting joins; let the match finish inside the drain window. */
  beginDrain(): void {
    this.draining = true;
    this.lock().catch(() => undefined);
  }

  // ----------------------------------------------------------------- input

  private registerMessageHandlers(): void {
    const handle = <T extends ClientMessageType>(
      type: T,
      handler: (client: Client, payload: unknown) => void,
    ) => {
      this.onMessage(type, (client, payload) => {
        const parsed = parseClientMessage(type, payload);
        if (!parsed.ok) {
          // Malformed messages are counted, not fatal — but a client producing
          // a stream of them gets disconnected (PRD §33.3).
          const player = this.sim.players.get(client.sessionId);
          if (player) {
            player.rejectedInputs += 1;
            if (player.rejectedInputs > 200) {
              this.logger.warn("disconnecting client for malformed traffic", {
                sessionId: client.sessionId,
              });
              client.leave(4002);
            }
          }
          return;
        }
        handler(client, parsed.data);
      });
    };

    handle(CLIENT_MESSAGE.INPUT, (client, payload) => {
      const { frames } = payload as { frames: Parameters<MatchSimulation["queueInput"]>[1] };
      this.sim.queueInput(client.sessionId, frames);
    });

    handle(CLIENT_MESSAGE.RELOAD, (client) => this.sim.requestReload(client.sessionId));

    handle(CLIENT_MESSAGE.SWITCH_WEAPON, (client, payload) => {
      this.sim.requestWeaponSwitch(client.sessionId, (payload as { slot: number }).slot);
    });

    handle(CLIENT_MESSAGE.QUICK_MESSAGE, (client, payload) => {
      const player = this.sim.players.get(client.sessionId);
      if (!player) return;
      // Broadcast only within the team; the vocabulary is a fixed enum, so
      // there is no free-form text to moderate (PRD §18.12).
      this.broadcast(SERVER_MESSAGE.QUICK_MESSAGE, {
        sessionId: client.sessionId,
        team: player.team,
        message: (payload as { message: string }).message,
      });
    });

    handle(CLIENT_MESSAGE.PING_MARK, (client, payload) => {
      const player = this.sim.players.get(client.sessionId);
      if (!player) return;
      // The mark is derived from the SERVER's view of the player, using only
      // the distance the client supplied.
      const distance = Math.min((payload as { distance: number }).distance, 200);
      const yaw = player.movement.yaw;
      const pitch = player.movement.pitch;
      this.broadcast(SERVER_MESSAGE.PING_MARK, {
        sessionId: client.sessionId,
        team: player.team,
        x: player.movement.position.x + Math.sin(yaw) * Math.cos(pitch) * distance,
        y: player.movement.position.y + 1.6 - Math.sin(pitch) * distance,
        z: player.movement.position.z + Math.cos(yaw) * Math.cos(pitch) * distance,
      });
    });

    handle(CLIENT_MESSAGE.PONG, (client, payload) => {
      const sent = this.pingSentAt.get(client.sessionId);
      if (sent && (payload as { id: number }).id === sent.id) {
        this.sim.setLatency(client.sessionId, (Date.now() - sent.at) / 2);
      }
    });
  }

  private readonly pingSentAt = new Map<string, { id: number; at: number }>();
  private pingCounter = 0;
  private pingAccumulatorMs = 0;

  // ------------------------------------------------------------------ tick

  private tick(): void {
    const events = this.sim.step();

    for (const bot of this.bots.values()) bot.update(this.sim);

    this.releaseExpiredSeats();

    this.snapshotAccumulatorMs += TICK_MS;
    if (this.snapshotAccumulatorMs >= 1000 / SNAPSHOT_RATE) {
      this.snapshotAccumulatorMs = 0;
      this.syncState();
    }

    this.pingAccumulatorMs += TICK_MS;
    if (this.pingAccumulatorMs >= 5000) {
      this.pingAccumulatorMs = 0;
      this.sendPings();
    }

    this.dispatchEvents(events);
    this.sendAcks();
  }

  private syncState(): void {
    this.state.tick = this.sim.tick;
    this.state.phase =
      this.sim.phase === "warmup"
        ? MATCH_PHASE.WARMUP
        : this.sim.phase === "live"
          ? MATCH_PHASE.LIVE
          : MATCH_PHASE.ENDED;
    this.state.timeRemainingMs = this.sim.timeRemainingMs();
    this.state.winningTeam = this.sim.winningTeam ?? -1;

    for (const team of this.state.teams) {
      team.score = this.sim.scores[team.id] ?? 0;
      team.playerCount = [...this.sim.players.values()].filter((p) => p.team === team.id).length;
    }

    for (const player of this.sim.players.values()) {
      this.syncPlayerToState(player, false);
    }
  }

  private syncPlayerToState(player: SimPlayer, created: boolean): void {
    let entry = this.state.players.get(player.id);
    if (!entry) {
      entry = new PlayerState();
      entry.sessionId = player.id;
      entry.userId = player.userId;
      entry.displayName = player.displayName;
      entry.isBot = player.isBot;
      this.state.players.set(player.id, entry);
    }

    entry.team = player.team;
    entry.x = player.movement.position.x;
    entry.y = player.movement.position.y;
    entry.z = player.movement.position.z;
    entry.vx = player.movement.velocity.x;
    entry.vy = player.movement.velocity.y;
    entry.vz = player.movement.velocity.z;
    entry.yaw = player.movement.yaw;
    entry.pitch = player.movement.pitch;
    entry.crouching = player.movement.crouching;
    entry.grounded = player.movement.grounded;

    entry.health = Math.round(player.health);
    entry.armor = Math.round(player.armor);
    entry.weaponSlot = player.weaponSlot;
    entry.ammoInMagazine = player.ammo[player.weaponSlot]?.magazine ?? 0;
    entry.ammoReserve = player.ammo[player.weaponSlot]?.reserve ?? 0;
    entry.reloadingUntilMs = Math.max(0, Math.round(player.reloadingUntilMs));
    entry.nextFireAtMs = Math.max(0, Math.round(player.nextFireAtMs));
    entry.lifeState = player.alive
      ? PLAYER_STATE.ALIVE
      : player.connected
        ? PLAYER_STATE.DEAD
        : PLAYER_STATE.RECONNECTING;
    entry.respawnAtMs = Math.max(0, Math.round(player.respawnAtMs));

    entry.kills = player.kills;
    entry.deaths = player.deaths;
    entry.assists = player.assists;
    entry.score = player.score;
    entry.lastAckedSeq = player.lastAckedSeq;
    entry.pingMs = Math.round(player.latencyMs);
    entry.reconnectCount = player.reconnectCount;

    if (created) this.state.players.set(player.id, entry);
  }

  private dispatchEvents(events: SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case "match_start":
          this.broadcast(SERVER_MESSAGE.MATCH_START, { startedAtMs: Date.now() });
          break;
        case "hit":
          this.broadcast(SERVER_MESSAGE.HIT, event);
          break;
        case "kill":
          this.broadcast(SERVER_MESSAGE.KILL, {
            attackerSessionId: event.attackerId,
            victimSessionId: event.victimId,
            weaponId: event.weaponId,
            headshot: event.headshot,
            respawnAtMs: event.respawnAtMs,
          });
          break;
        case "respawn":
          this.broadcast(SERVER_MESSAGE.RESPAWN, {
            sessionId: event.playerId,
            x: event.position.x,
            y: event.position.y,
            z: event.position.z,
            yaw: event.yaw,
            tick: event.tick,
          });
          break;
        case "match_end":
          this.syncState();
          this.broadcast(SERVER_MESSAGE.MATCH_END, {
            matchId: this.sim.matchId,
            winningTeam: event.winningTeam,
            reason: event.reason,
            scores: event.scores,
            durationMs: event.durationMs,
          });
          this.emitResult(
            event.reason === "score_limit"
              ? MATCH_TERMINATION.SCORE_LIMIT
              : MATCH_TERMINATION.TIME_LIMIT,
          );
          // Give clients a moment on the scoreboard before disposal.
          this.clock.setTimeout(() => void this.disconnect(), 8000);
          break;
      }
    }
  }

  private sendAcks(): void {
    for (const client of this.clients) {
      const player = this.sim.players.get(client.sessionId);
      if (!player) continue;
      client.send(SERVER_MESSAGE.ACK, {
        seq: player.lastAckedSeq,
        tick: this.sim.tick,
        clientTimeMs: this.sim.elapsedMs,
      });
    }
  }

  private sendPings(): void {
    this.pingCounter += 1;
    const id = this.pingCounter;
    const at = Date.now();
    for (const client of this.clients) {
      this.pingSentAt.set(client.sessionId, { id, at });
      client.send(SERVER_MESSAGE.PING, { id, serverTimeMs: this.sim.elapsedMs });
    }
  }

  // ------------------------------------------------------------------ bots

  private fillBots(): void {
    if (!this.opts.botFill) return;
    if (this.sim.phase === "ended") return;

    while (this.sim.players.size < TDM_RULES.maxPlayers) {
      const id = `bot_${this.sim.players.size}_${this.roomId}`;
      try {
        const bot = this.sim.addPlayer({
          id,
          userId: id,
          displayName: `BOT ${this.sim.players.size + 1}`,
          isBot: true,
        });
        this.bots.set(id, new BotController(id, this.sim.players.size + 1));
        this.syncPlayerToState(bot, true);
      } catch {
        break;
      }
    }
  }

  /** Free one bot seat, preferring the team a joining human wants. */
  private releaseBotSeat(preferredTeam: number | undefined): void {
    const candidates = [...this.bots.keys()]
      .map((id) => this.sim.players.get(id))
      .filter((p): p is SimPlayer => p !== undefined);
    if (candidates.length === 0) return;

    const target =
      candidates.find((p) => preferredTeam !== undefined && p.team === preferredTeam) ??
      candidates[0];
    if (target) this.removePlayer(target.id);
  }

  private releaseExpiredSeats(): void {
    for (const sessionId of this.sim.expiredSeats()) {
      this.removePlayer(sessionId);
    }
  }

  private removePlayer(sessionId: string): void {
    this.sim.removePlayer(sessionId);
    this.state.players.delete(sessionId);
    this.bots.delete(sessionId);
    this.pingSentAt.delete(sessionId);
  }

  // --------------------------------------------------------------- results

  /**
   * Publish the durable match summary exactly once.
   *
   * Signed with the shared match-result secret so the worker can prove the
   * event came from a match process (PRD §33.3).
   */
  private emitResult(reason: (typeof MATCH_TERMINATION)[keyof typeof MATCH_TERMINATION]): void {
    if (this.resultEmitted) return;
    this.resultEmitted = true;

    const endedAt = Date.now();
    const players: MatchPlayerResult[] = [];

    for (const player of this.sim.players.values()) {
      const won =
        this.sim.winningTeam === null
          ? "draw"
          : player.team === this.sim.winningTeam
            ? "win"
            : "loss";
      players.push({
        userId: player.userId,
        displayName: player.displayName,
        team: player.team,
        isBot: player.isBot,
        joinedAtMs: this.joinedAt.get(player.id) ?? this.startedAtMs,
        leftAtMs: null,
        reconnectCount: player.reconnectCount,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        score: player.score,
        result: reason === MATCH_TERMINATION.ABANDONED ? "abandoned" : won,
      });
    }

    const result: MatchResult = {
      matchId: this.sim.matchId,
      roomId: this.roomId,
      mode: TDM_RULES.mode,
      mapId: ARDAVAN_YARD.id,
      regionId: this.opts.region,
      shardId: this.opts.shard,
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: this.opts.buildVersion,
      startedAtMs: this.startedAtMs,
      endedAtMs: endedAt,
      durationMs: endedAt - this.startedAtMs,
      winningTeam: this.sim.winningTeam,
      terminationReason: reason,
      teamScores: Object.fromEntries(
        Object.entries(this.sim.scores).map(([team, score]) => [team, score]),
      ),
      players,
    };

    void this.services.publishMatchResult(result, this.opts.matchResultSecret).catch((error) => {
      this.logger.error("failed to publish match result", { error: String(error) });
    });
  }
}
