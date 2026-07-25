import http from "node:http";
import { Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { HealthReporter, createLogger, installGracefulShutdown } from "@nightcell7/observability";
import { closeDatabase, getDatabase } from "@nightcell7/database";
import type { MatchResultEvent } from "@nightcell7/multiplayer-protocol";
import { processCoinpayEvent, type CoinpayEventJob } from "./processors/payments";
import { processMatchResult } from "./processors/match-results";
import { createResendSender, type EmailJob } from "./processors/email";
import { loadEnv } from "./env";

/**
 * Worker daemon (PRD §18.7).
 *
 * Always-on. Owns everything durable that must not block an HTTP response:
 * CoinPay fulfilment, match-result persistence, and transactional email.
 * Every processor is idempotent because BullMQ will retry.
 */

const env = loadEnv();
const logger = createLogger({
  service: "worker",
  level: env.LOG_LEVEL,
  buildVersion: env.BUILD_VERSION,
});
const health = new HealthReporter("worker", env.BUILD_VERSION);

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const db = getDatabase({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const email = createResendSender(env.RESEND_API_KEY, env.EMAIL_FROM, logger);

const workers: Worker[] = [];

workers.push(
  new Worker(
    "payments",
    async (job: Job<CoinpayEventJob>) => {
      const result = await processCoinpayEvent(db, logger.child({ jobId: job.id }), job.data);
      // An unknown order is not retryable — retrying cannot make it exist.
      if (result.outcome === "unknown_order") return result;
      return result;
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  ),
);

workers.push(
  new Worker(
    "match-results",
    async (job: Job<MatchResultEvent>) =>
      processMatchResult(db, logger.child({ jobId: job.id }), job.data, env.MATCH_RESULT_SECRET),
    { connection, concurrency: env.WORKER_CONCURRENCY },
  ),
);

workers.push(
  new Worker(
    "email",
    async (job: Job<EmailJob>) => {
      await email.send(job.data);
    },
    { connection, concurrency: 2 },
  ),
);

workers.push(
  new Worker(
    "entitlements",
    async (job: Job<{ token: string; userId: string }>) => {
      // Guest-claim resolution (PRD §23.4). Kept as its own queue so a claim
      // backlog cannot delay payment fulfilment.
      logger.info("claim job received", { jobId: job.id });
      return { status: "not_implemented" };
    },
    { connection, concurrency: 2 },
  ),
);

for (const worker of workers) {
  worker.on("failed", (job, error) => {
    logger.error("job failed", {
      queue: worker.name,
      jobId: job?.id,
      attempts: job?.attemptsMade,
      error: error.message,
    });
  });
  worker.on("completed", (job) => {
    logger.debug("job completed", { queue: worker.name, jobId: job.id });
  });
}

/** Queue lag and failures must be observable (PRD §30.5). */
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health/live") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(health.live()));
    return;
  }
  if (req.url === "/health/ready") {
    const body = health.ready();
    res.writeHead(body.status === "ok" ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404).end();
});

healthServer.listen(env.WORKER_PORT, () => {
  health.setReady(true, { queues: workers.map((w) => w.name) });
  logger.info("worker running", { port: env.WORKER_PORT, queues: workers.map((w) => w.name) });
});

installGracefulShutdown({
  logger,
  health,
  timeoutMs: 30_000,
  onShutdown: async () => {
    // Close workers first so in-flight jobs finish before the connection drops.
    await Promise.all(workers.map((worker) => worker.close()));
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    connection.disconnect();
    await closeDatabase();
  },
});
