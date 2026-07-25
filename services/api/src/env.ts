import { z } from "zod";
import { baseEnvSchema, parseEnv } from "@nightcell7/observability";

/**
 * API environment contract (PRD §17.6).
 *
 * Secrets are `.min(16)` rather than merely required so a placeholder like
 * "changeme" fails the boot check instead of shipping to production.
 */
export const apiEnvSchema = baseEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(3001),

  AUTH_SECRET: z.string().min(16),
  TICKET_SECRET: z.string().min(16),
  TICKET_TTL_SECONDS: z.coerce.number().int().min(15).max(120).default(45),
  MATCH_RESULT_SECRET: z.string().min(16),

  REDIS_URL: z.string().min(1),
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().optional(),

  COINPAY_API_BASE: z.string().url(),
  COINPAY_API_KEY: z.string().min(1),
  COINPAY_WEBHOOK_SECRET: z.string().min(16),

  // R2 is optional at boot so local development and CI do not need object
  // storage; the content routes degrade to an obvious placeholder instead.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("nightcell7-content"),

  MULTIPLAYER_REGION: z.string().default("us-west"),
  MULTIPLAYER_SHARD: z.string().default("1"),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadEnv(): ApiEnv {
  return parseEnv(apiEnvSchema);
}
