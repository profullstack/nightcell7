import type Redis from "ioredis";
import type { Queue } from "bullmq";
import { namespacedKey } from "@nightcell7/observability";
import { signMatchResult } from "@nightcell7/multiplayer-protocol/server";
import type { MatchResult } from "@nightcell7/multiplayer-protocol";

/**
 * External collaborators a room needs.
 *
 * Behind an interface so the room can be exercised with in-memory fakes — the
 * gameplay guarantees in PRD §18.13 must be testable without Redis.
 */
export interface RoomServices {
  /** Atomically consume a one-time ticket. False means replayed or unknown. */
  consumeTicket(ticketId: string): Promise<boolean>;
  isBanned(userId: string): Promise<boolean>;
  publishMatchResult(result: MatchResult, secret: string): Promise<void>;
}

export function createRoomServices(redis: Redis, resultsQueue: Queue): RoomServices {
  return {
    async consumeTicket(ticketId) {
      // DEL returns the number of keys removed. Exactly one connection can see
      // a 1, which is the replay guard (PRD §18.6).
      const removed = await redis.del(namespacedKey("ticket", ticketId));
      return removed === 1;
    },

    async isBanned(userId) {
      // Ban state is mirrored into Redis by the worker so the join path stays
      // fast and does not touch the durable database on every connection.
      const value = await redis.get(namespacedKey("ban", userId));
      return value !== null;
    },

    async publishMatchResult(result, secret) {
      const event = signMatchResult(result, secret, Date.now());
      await resultsQueue.add("match-result", event, {
        // The result hash is the idempotency key, so a retried job is safe.
        jobId: event.resultHash,
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 10,
        backoff: { type: "exponential", delay: 3000 },
      });
    },
  };
}

/** In-memory implementation for local development and tests. */
export function createMemoryRoomServices(
  options: {
    tickets?: Set<string>;
    bans?: Set<string>;
    onResult?: (result: MatchResult) => void;
  } = {},
): RoomServices {
  const tickets = options.tickets ?? new Set<string>();
  const bans = options.bans ?? new Set<string>();

  return {
    async consumeTicket(ticketId) {
      return tickets.delete(ticketId);
    },
    async isBanned(userId) {
      return bans.has(userId);
    },
    async publishMatchResult(result) {
      options.onResult?.(result);
    },
  };
}
