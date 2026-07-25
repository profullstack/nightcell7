import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { HealthReporter, createLogger, installGracefulShutdown } from "@nightcell7/observability";
import { getDatabase, closeDatabase } from "@nightcell7/database";
import { CoinpayClient } from "@nightcell7/coinpay";
import { PROTOCOL_VERSION } from "@nightcell7/multiplayer-protocol";
import { createApp } from "./app";
import { loadEnv } from "./env";
import { RedisRateLimiter } from "./rate-limit";
import { createRepositories } from "./repository";
import { createR2Signer, createUnconfiguredSigner } from "./r2";

/**
 * API daemon bootstrap (PRD §18.7).
 *
 * Environment is validated before anything connects, so a missing secret fails
 * at boot rather than at the first purchase.
 */

const env = loadEnv();
const logger = createLogger({
  service: "api",
  level: env.LOG_LEVEL,
  buildVersion: env.BUILD_VERSION,
});
const health = new HealthReporter("api", env.BUILD_VERSION, PROTOCOL_VERSION);

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const database = getDatabase({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const queues = new Map<string, Queue>();
function queueFor(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: redis });
    queues.set(name, queue);
  }
  return queue;
}

const coinpay = new CoinpayClient({
  apiBase: env.COINPAY_API_BASE,
  apiKey: env.COINPAY_API_KEY,
  returnUrl: `${env.PUBLIC_ORIGIN}/checkout/success`,
  cancelUrl: `${env.PUBLIC_ORIGIN}/checkout/cancel`,
  webhookUrl: `${env.PUBLIC_ORIGIN}/api/v1/webhooks/coinpay`,
});

const app = createApp({
  env,
  logger,
  health,
  repos: createRepositories(database),
  rateLimiter: new RedisRateLimiter(redis),
  coinpay,
  enqueue: async (queue, name, payload) => {
    await queueFor(queue).add(name, payload, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
    });
  },
  content: {
    // Manifests live in R2 next to the packs they describe. Until the asset
    // pipeline publishes one, this returns null and the route 404s rather than
    // inventing an empty manifest.
    loadManifest: async () => null,
    sign:
      env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
        ? createR2Signer({
            accountId: env.R2_ACCOUNT_ID,
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            bucket: env.R2_BUCKET,
          })
        : createUnconfiguredSigner(),
  },
  registerTicket: async (ticketId, ttlSeconds) => {
    // Registered here, consumed once by the match service. The SET NX in the
    // multiplayer service is what makes replay impossible (PRD §18.6).
    await redis.set(`ticket:${ticketId}`, "issued", "EX", ttlSeconds);
  },
});

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  logger.info("api listening", { port: info.port, protocolVersion: PROTOCOL_VERSION });
});

async function checkReadiness(): Promise<void> {
  try {
    await redis.ping();
    health.setReady(true, { redis: "ok" });
  } catch (error) {
    health.setReady(false, { redis: "unavailable", error: String(error) });
  }
}

void checkReadiness();
const readinessTimer = setInterval(() => void checkReadiness(), 10_000);
readinessTimer.unref();

installGracefulShutdown({
  logger,
  health,
  onShutdown: async () => {
    clearInterval(readinessTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all([...queues.values()].map((queue) => queue.close()));
    redis.disconnect();
    await closeDatabase();
  },
});
