import type Redis from "ioredis";

/**
 * Route-specific rate limits (PRD §29.2, §33.3).
 *
 * Backed by Redis so limits hold across replicas — a per-process counter would
 * multiply the real limit by the replica count, which is how "rate limited"
 * quietly becomes "not rate limited" after a scale-up.
 */

export interface RateLimitRule {
  /** Requests allowed within the window. */
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  checkout: { limit: 10, windowSeconds: 60 },
  claim: { limit: 10, windowSeconds: 600 },
  ticket: { limit: 20, windowSeconds: 60 },
  matchmaking: { limit: 30, windowSeconds: 60 },
  privateMatch: { limit: 10, windowSeconds: 300 },
  report: { limit: 10, windowSeconds: 3600 },
  feedback: { limit: 5, windowSeconds: 300 },
  newsletter: { limit: 5, windowSeconds: 3600 },
  webhook: { limit: 600, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export interface RateLimiter {
  consume(name: RateLimitName, subject: string): Promise<RateLimitResult>;
}

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(name: RateLimitName, subject: string): Promise<RateLimitResult> {
    const rule = RATE_LIMITS[name];
    const key = `rl:${name}:${subject}`;

    // INCR + conditional EXPIRE is a fixed window: cheap, and adequate for the
    // abuse shapes here. A sliding window would be a later refinement.
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, rule.windowSeconds);
    const ttl = await this.redis.ttl(key);

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetSeconds: ttl > 0 ? ttl : rule.windowSeconds,
    };
  }
}

/** In-memory limiter for local development and tests. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async consume(name: RateLimitName, subject: string): Promise<RateLimitResult> {
    const rule = RATE_LIMITS[name];
    const key = `${name}:${subject}`;
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + rule.windowSeconds * 1000;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: rule.limit - 1, resetSeconds: rule.windowSeconds };
    }

    bucket.count += 1;
    return {
      allowed: bucket.count <= rule.limit,
      remaining: Math.max(0, rule.limit - bucket.count),
      resetSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
}
