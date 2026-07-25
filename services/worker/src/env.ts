import { z } from "zod";
import { baseEnvSchema, parseEnv } from "@nightcell7/observability";

export const workerEnvSchema = baseEnvSchema.extend({
  WORKER_PORT: z.coerce.number().int().positive().default(3003),
  REDIS_URL: z.string().min(1),
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().optional(),
  MATCH_RESULT_SECRET: z.string().min(16),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadEnv(): WorkerEnv {
  return parseEnv(workerEnvSchema);
}
