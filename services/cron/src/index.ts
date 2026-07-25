import { and, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import Redis from "ioredis";
import { baseEnvSchema, createLogger, parseEnv } from "@nightcell7/observability";
import { closeDatabase, getDatabase, orders, paymentEvents } from "@nightcell7/database";
import { CoinpayClient, mapProviderStatus } from "@nightcell7/coinpay";
import { ORDER_STATUS, isNonTerminal, transition } from "@nightcell7/entitlements";

/**
 * Scheduled maintenance commands (PRD §18.7, §24.5).
 *
 * These execute and exit — they never host a live match. Each command is
 * idempotent and safe to re-run, because a cron job that cannot be re-run
 * safely is a cron job nobody dares to re-run after an incident.
 *
 * Usage: `node dist/index.js <command>`
 */

const envSchema = baseEnvSchema.extend({
  REDIS_URL: z.string().min(1),
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().optional(),
  COINPAY_API_BASE: z.string().url(),
  COINPAY_API_KEY: z.string().min(1),
  /** Orders older than this with no terminal status get reconciled. */
  RECONCILE_AFTER_MINUTES: z.coerce.number().int().positive().default(20),
  /** Abandoned orders older than this are expired. */
  EXPIRE_AFTER_HOURS: z.coerce.number().int().positive().default(48),
});

const env = parseEnv(envSchema);
const logger = createLogger({
  service: "cron",
  level: env.LOG_LEVEL,
  buildVersion: env.BUILD_VERSION,
});
const db = getDatabase({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const COMMANDS = {
  RECONCILE_PAYMENTS: "reconcile-payments",
  EXPIRE_ORDERS: "expire-orders",
  CLEANUP_TICKETS: "cleanup-tickets",
  CLEANUP_ROOMS: "cleanup-rooms",
  AUDIT_ORPHAN_RESULTS: "audit-orphan-results",
} as const;

/**
 * Repair orders whose webhook never arrived (PRD §24.5).
 *
 * The provider is polled for the current status; nothing is invented locally.
 */
async function reconcilePayments(): Promise<void> {
  const coinpay = new CoinpayClient({
    apiBase: env.COINPAY_API_BASE,
    apiKey: env.COINPAY_API_KEY,
    returnUrl: `${env.PUBLIC_ORIGIN}/checkout/success`,
    cancelUrl: `${env.PUBLIC_ORIGIN}/checkout/cancel`,
    webhookUrl: `${env.PUBLIC_ORIGIN}/api/v1/webhooks/coinpay`,
  });

  const cutoff = new Date(Date.now() - env.RECONCILE_AFTER_MINUTES * 60_000).toISOString();
  const candidates = await db
    .select({ id: orders.id, status: orders.status, invoiceId: orders.coinpayOrderId })
    .from(orders)
    .where(lt(orders.updatedAt, cutoff))
    .limit(200);

  let checked = 0;
  let repaired = 0;
  let drift = 0;

  for (const order of candidates) {
    if (!isNonTerminal(order.status as never)) continue;
    if (!order.invoiceId) continue;
    checked += 1;

    try {
      const invoice = await coinpay.getInvoice(order.invoiceId);
      const mapped = mapProviderStatus(invoice.status);
      if (mapped === order.status) continue;

      drift += 1;
      const move = transition(order.status as never, mapped);
      if (!move.ok) {
        logger.warn("reconciliation found an illegal transition", {
          orderId: order.id,
          from: order.status,
          to: mapped,
        });
        continue;
      }

      await db
        .update(orders)
        .set({ status: move.status, updatedAt: new Date().toISOString() })
        .where(eq(orders.id, order.id));
      repaired += 1;
      logger.info("order repaired from provider status", {
        orderId: order.id,
        from: order.status,
        to: move.status,
      });
    } catch (error) {
      logger.error("reconciliation lookup failed", { orderId: order.id, error: String(error) });
    }
  }

  // The auditable reconciliation report PRD §24.5 asks for.
  logger.info("reconciliation report", { checked, drift, repaired });
}

/** Expire abandoned orders so they stop appearing as pending forever. */
async function expireOrders(): Promise<void> {
  const cutoff = new Date(Date.now() - env.EXPIRE_AFTER_HOURS * 3_600_000).toISOString();
  const stale = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(lt(orders.createdAt, cutoff), eq(orders.status, ORDER_STATUS.CREATED)))
    .limit(500);

  let expired = 0;
  for (const order of stale) {
    const move = transition(order.status as never, ORDER_STATUS.EXPIRED);
    if (!move.ok) continue;
    await db
      .update(orders)
      .set({ status: ORDER_STATUS.EXPIRED, updatedAt: new Date().toISOString() })
      .where(eq(orders.id, order.id));
    expired += 1;
  }
  logger.info("expired abandoned orders", { expired });
}

/**
 * Sweep ticket keys.
 *
 * Redis TTLs already remove these; the sweep exists to catch a key written
 * without an expiry, which would otherwise leak slowly and invisibly.
 */
async function cleanupTickets(): Promise<void> {
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  let scanned = 0;
  let repaired = 0;
  let cursor = "0";

  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "ticket:*", "COUNT", 500);
    cursor = next;
    for (const key of keys) {
      scanned += 1;
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        await redis.expire(key, 120);
        repaired += 1;
      }
    }
  } while (cursor !== "0");

  logger.info("ticket sweep complete", { scanned, repaired });
  redis.disconnect();
}

/** Drop stale matchmaking and private-room metadata left by a crashed process. */
async function cleanupRooms(): Promise<void> {
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  let removed = 0;
  let cursor = "0";

  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "private:*", "COUNT", 500);
    cursor = next;
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        await redis.del(key);
        removed += 1;
      }
    }
  } while (cursor !== "0");

  logger.info("room metadata sweep complete", { removed });
  redis.disconnect();
}

/** Surface payment events that were received but never processed. */
async function auditOrphanResults(): Promise<void> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentEvents)
    .where(eq(paymentEvents.processingStatus, "received"));

  const stuck = rows[0]?.count ?? 0;
  if (stuck > 0) {
    logger.error("payment events stuck in received state", { stuck });
  } else {
    logger.info("no stuck payment events");
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case COMMANDS.RECONCILE_PAYMENTS:
      await reconcilePayments();
      break;
    case COMMANDS.EXPIRE_ORDERS:
      await expireOrders();
      break;
    case COMMANDS.CLEANUP_TICKETS:
      await cleanupTickets();
      break;
    case COMMANDS.CLEANUP_ROOMS:
      await cleanupRooms();
      break;
    case COMMANDS.AUDIT_ORPHAN_RESULTS:
      await auditOrphanResults();
      break;
    default:
      logger.error("unknown command", { command, known: Object.values(COMMANDS) });
      process.exitCode = 2;
      break;
  }

  await closeDatabase();
}

main().catch((error: unknown) => {
  logger.error("cron command failed", { error: String(error) });
  process.exit(1);
});
