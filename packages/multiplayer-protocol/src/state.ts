import { ArraySchema, MapSchema, Schema, defineTypes } from "@colyseus/schema";

/**
 * Authoritative room state.
 *
 * Everything in here is written by the server only. The client mirrors it and
 * may *predict ahead* of it locally, but reconciles back to these values.
 * PRD §18.3 lists exactly what the server owns; that list is this file.
 *
 * `defineTypes` is used rather than decorators so the package compiles under
 * plain `moduleResolution: bundler` in the browser, Node and Bun without
 * per-consumer TypeScript configuration.
 *
 * Fields are `declare`d and assigned in the constructor, never written as class
 * field initialisers. `Schema`'s constructor installs change-tracking accessors
 * on the instance; an ES2022 class field (define semantics, the default for
 * this target) then replaces each accessor with a plain data property. Nothing
 * is tracked, the MapSchema/ArraySchema children never learn their item type,
 * and the encoder throws `type[Symbol.metadata]` on the first join, which
 * killed the multiplayer process.
 */

export const TEAM = {
  /** American / Nightcell-aligned. */
  NIGHTCELL: 0,
  /** Iranian Security Directorate. */
  DIRECTORATE: 1,
} as const;

export type TeamId = (typeof TEAM)[keyof typeof TEAM];

export const PLAYER_STATE = {
  ALIVE: 0,
  DEAD: 1,
  /** Disconnected but inside the reconnect grace window (PRD §18.10). */
  RECONNECTING: 2,
  SPECTATING: 3,
} as const;

export class PlayerState extends Schema {
  declare sessionId: string;
  declare userId: string;
  declare displayName: string;
  declare team: number;
  declare isBot: boolean;

  // --- transform (server-owned) --------------------------------------------
  declare x: number;
  declare y: number;
  declare z: number;
  declare vx: number;
  declare vy: number;
  declare vz: number;
  declare yaw: number;
  declare pitch: number;
  declare crouching: boolean;
  declare grounded: boolean;

  // --- combat (server-owned) -----------------------------------------------
  declare health: number;
  declare armor: number;
  declare weaponSlot: number;
  declare ammoInMagazine: number;
  declare ammoReserve: number;
  /** Grenades left this life — HUD only; the server owns the count. */
  declare grenades: number;
  /** Match-clock milliseconds; 0 when not reloading. */
  declare reloadingUntilMs: number;
  /** Earliest match-clock time this player may fire again. */
  declare nextFireAtMs: number;
  declare lifeState: number;
  declare respawnAtMs: number;

  // --- scoring --------------------------------------------------------------
  declare kills: number;
  declare deaths: number;
  declare assists: number;
  declare score: number;

  // --- diagnostics ----------------------------------------------------------
  /** Last input sequence the server simulated for this player. */
  declare lastAckedSeq: number;
  declare pingMs: number;
  declare reconnectCount: number;

  constructor() {
    super();
    this.sessionId = "";
    this.userId = "";
    this.displayName = "";
    this.team = TEAM.NIGHTCELL;
    this.isBot = false;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.crouching = false;
    this.grounded = true;
    this.health = 100;
    this.armor = 0;
    this.weaponSlot = 0;
    this.ammoInMagazine = 0;
    this.ammoReserve = 0;
    this.grenades = 0;
    this.reloadingUntilMs = 0;
    this.nextFireAtMs = 0;
    this.lifeState = PLAYER_STATE.ALIVE;
    this.respawnAtMs = 0;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.score = 0;
    this.lastAckedSeq = 0;
    this.pingMs = 0;
    this.reconnectCount = 0;
  }
}

defineTypes(PlayerState, {
  sessionId: "string",
  userId: "string",
  displayName: "string",
  team: "uint8",
  isBot: "boolean",

  x: "float32",
  y: "float32",
  z: "float32",
  vx: "float32",
  vy: "float32",
  vz: "float32",
  yaw: "float32",
  pitch: "float32",
  crouching: "boolean",
  grounded: "boolean",

  health: "uint8",
  armor: "uint8",
  weaponSlot: "uint8",
  ammoInMagazine: "uint8",
  grenades: "uint8",
  ammoReserve: "uint16",
  reloadingUntilMs: "uint32",
  nextFireAtMs: "uint32",
  lifeState: "uint8",
  respawnAtMs: "uint32",

  kills: "uint16",
  deaths: "uint16",
  assists: "uint16",
  score: "int32",

  lastAckedSeq: "uint32",
  pingMs: "uint16",
  reconnectCount: "uint8",
});

export class TeamState extends Schema {
  declare id: number;
  declare score: number;
  declare playerCount: number;

  constructor() {
    super();
    this.id = 0;
    this.score = 0;
    this.playerCount = 0;
  }
}

defineTypes(TeamState, {
  id: "uint8",
  score: "int32",
  playerCount: "uint8",
});

export const MATCH_PHASE = {
  /** Waiting for the minimum player count or the warmup timer. */
  WARMUP: 0,
  LIVE: 1,
  /** Scores frozen, clients showing the scoreboard before disposal. */
  ENDED: 2,
} as const;

export class MatchState extends Schema {
  declare matchId: string;
  declare mapId: string;
  declare mode: string;
  declare phase: number;
  /** Server tick counter — the canonical clock for everything else. */
  declare tick: number;
  declare tickRate: number;
  /** Milliseconds remaining in the match, mirrored for HUD convenience. */
  declare timeRemainingMs: number;
  declare scoreLimit: number;
  declare winningTeam: number;
  declare players: MapSchema<PlayerState>;
  declare teams: ArraySchema<TeamState>;

  constructor() {
    super();
    this.matchId = "";
    this.mapId = "";
    this.mode = "tdm";
    this.phase = MATCH_PHASE.WARMUP;
    this.tick = 0;
    this.tickRate = 30;
    this.timeRemainingMs = 0;
    this.scoreLimit = 75;
    this.winningTeam = -1;
    this.players = new MapSchema<PlayerState>();
    this.teams = new ArraySchema<TeamState>();
  }
}

defineTypes(MatchState, {
  matchId: "string",
  mapId: "string",
  mode: "string",
  phase: "uint8",
  tick: "uint32",
  tickRate: "uint8",
  timeRemainingMs: "uint32",
  scoreLimit: "uint16",
  winningTeam: "int8",
  players: { map: PlayerState },
  teams: [TeamState],
});
