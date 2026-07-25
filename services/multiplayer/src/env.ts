import { z } from "zod";
import { baseEnvSchema, parseEnv } from "@nightcell7/observability";

export const multiplayerEnvSchema = baseEnvSchema.extend({
  MULTIPLAYER_PORT: z.coerce.number().int().positive().default(3002),
  MULTIPLAYER_REGION: z.string().min(1).default("us-west"),
  MULTIPLAYER_SHARD: z.string().min(1).default("1"),
  /** Certified by load test, never guessed in code (PRD §30.4). */
  MULTIPLAYER_MAX_ROOMS: z.coerce.number().int().positive().default(20),
  BOT_FILL: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  TICKET_SECRET: z.string().min(16),
  MATCH_RESULT_SECRET: z.string().min(16),
  REDIS_URL: z.string().min(1),
});

export type MultiplayerEnv = z.infer<typeof multiplayerEnvSchema>;

export function loadEnv(): MultiplayerEnv {
  return parseEnv(multiplayerEnvSchema);
}
