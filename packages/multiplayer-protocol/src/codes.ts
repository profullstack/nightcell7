/**
 * Machine-readable rejection and termination codes.
 *
 * PRD §18.5 requires the server to return a *machine-readable* reason so the
 * client can show an update path, a ban notice or a retry instead of a generic
 * "connection failed".
 */
export const JOIN_REJECTION = {
  UPDATE_REQUIRED: "update_required",
  PROTOCOL_INCOMPATIBLE: "protocol_incompatible",
  CONTENT_MISMATCH: "content_mismatch",
  TICKET_INVALID: "ticket_invalid",
  TICKET_EXPIRED: "ticket_expired",
  TICKET_REPLAYED: "ticket_replayed",
  ROOM_FULL: "room_full",
  ROOM_ENDED: "room_ended",
  REGION_UNAVAILABLE: "region_unavailable",
  ACCOUNT_BANNED: "account_banned",
  ACCOUNT_UNVERIFIED: "account_unverified",
  SERVICE_DRAINING: "service_draining",
  SHARD_AT_CAPACITY: "shard_at_capacity",
} as const;

export type JoinRejectionCode = (typeof JOIN_REJECTION)[keyof typeof JOIN_REJECTION];

/** Colyseus reserves codes < 4000; ours start above the reserved range. */
export const JOIN_REJECTION_WS_CODE = 4001;

export class JoinRejectedError extends Error {
  constructor(
    readonly code: JoinRejectionCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "JoinRejectedError";
  }

  toJSON() {
    return { code: this.code, detail: this.detail };
  }
}

/** Why a match stopped. Persisted on `multiplayer_matches.termination_reason`. */
export const MATCH_TERMINATION = {
  SCORE_LIMIT: "score_limit",
  TIME_LIMIT: "time_limit",
  ABANDONED: "abandoned",
  SERVICE_RESTART: "service_restart",
  ERROR: "error",
} as const;

export type MatchTerminationReason = (typeof MATCH_TERMINATION)[keyof typeof MATCH_TERMINATION];

/**
 * A match that did not finish normally must not count as a win or a loss
 * (PRD §18.10).
 */
export function isRankableTermination(reason: MatchTerminationReason): boolean {
  return reason === MATCH_TERMINATION.SCORE_LIMIT || reason === MATCH_TERMINATION.TIME_LIMIT;
}

/** Reasons a player's own connection ended. */
export const LEAVE_REASON = {
  VOLUNTARY: "voluntary",
  TIMEOUT: "timeout",
  KICKED: "kicked",
  BANNED: "banned",
  MATCH_ENDED: "match_ended",
} as const;

export type LeaveReason = (typeof LEAVE_REASON)[keyof typeof LEAVE_REASON];
