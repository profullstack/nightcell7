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
  sessionId = "";
  userId = "";
  displayName = "";
  team: number = TEAM.NIGHTCELL;
  isBot = false;

  // --- transform (server-owned) --------------------------------------------
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  crouching = false;
  grounded = true;

  // --- combat (server-owned) -----------------------------------------------
  health = 100;
  armor = 0;
  weaponSlot = 0;
  ammoInMagazine = 0;
  ammoReserve = 0;
  /** Match-clock milliseconds; 0 when not reloading. */
  reloadingUntilMs = 0;
  /** Earliest match-clock time this player may fire again. */
  nextFireAtMs = 0;
  lifeState: number = PLAYER_STATE.ALIVE;
  respawnAtMs = 0;

  // --- scoring --------------------------------------------------------------
  kills = 0;
  deaths = 0;
  assists = 0;
  score = 0;

  // --- diagnostics ----------------------------------------------------------
  /** Last input sequence the server simulated for this player. */
  lastAckedSeq = 0;
  pingMs = 0;
  reconnectCount = 0;
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
  id = 0;
  score = 0;
  playerCount = 0;
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
  matchId = "";
  mapId = "";
  mode = "tdm";
  phase: number = MATCH_PHASE.WARMUP;
  /** Server tick counter — the canonical clock for everything else. */
  tick = 0;
  tickRate = 30;
  /** Milliseconds remaining in the match, mirrored for HUD convenience. */
  timeRemainingMs = 0;
  scoreLimit = 75;
  winningTeam = -1;
  players = new MapSchema<PlayerState>();
  teams = new ArraySchema<TeamState>();
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
