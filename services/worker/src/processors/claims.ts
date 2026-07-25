import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  entitlementEvents,
  entitlements,
  orderItems,
  orders,
  users,
  type Database,
} from "@nightcell7/database";
import { ENTITLEMENT_STATUS, applyOrderToEntitlement } from "@nightcell7/entitlements";
import { evaluateClaim, verifyClaimToken } from "@nightcell7/entitlements/server";
import type { Logger } from "@nightcell7/observability";

/**
 * Guest purchase claim (PRD §23.4).
 *
 * A buyer can pay without an account. The payment fulfils an order that has no
 * `user_id`, and an emailed one-time link is what later attaches it. Without
 * this, someone pays $9.99 and has no way to receive the game — which is why
 * this sits on the critical path rather than being a nice-to-have.
 *
 * Safety properties:
 *   - the token is single-use, enforced by a durable marker, not just a flag;
 *   - only a `fulfilled` order can be claimed, so an unpaid order cannot be
 *     redeemed by anyone holding a link;
 *   - an order already owned by an account cannot be re-claimed;
 *   - re-running the job is a no-op once the entitlement exists.
 */

export interface ClaimJob {
  token: string;
  userId: string;
  correlationId?: string;
}

export type ClaimResult =
  | { outcome: "claimed"; orderId: string; episodeIds: string[] }
  | { outcome: "already_claimed"; orderId?: string }
  | { outcome: "rejected"; reason: string };

export async function processClaim(
  db: Database,
  logger: Logger,
  job: ClaimJob,
  secret: string,
): Promise<ClaimResult> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const now = new Date().toISOString();

  // Decode first so we know which order the token points at, then load the
  // durable state the decision actually depends on.
  const peek = await peekOrder(db, job.token, secret, nowSeconds);
  if (!peek.ok) {
    logger.warn("claim rejected", { reason: peek.reason, correlationId: job.correlationId });
    return { outcome: "rejected", reason: peek.reason };
  }

  const claimant = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, job.userId))
    .limit(1);

  const decision = evaluateClaim(job.token, secret, nowSeconds, {
    order: peek.order,
    alreadyConsumed: peek.order.userId !== null,
    claimantEmail: claimant[0]?.email ?? null,
    // The payment email and the claiming account do not have to match: people
    // buy gifts and use different addresses. The token itself is the secret,
    // and it is single-use and short-lived (PRD §23.4).
    requireEmailMatch: false,
  });

  if (!decision.ok) {
    if (decision.reason === "already_claimed") {
      logger.info("claim replay ignored", { orderId: peek.order.id });
      return { outcome: "already_claimed", orderId: peek.order.id };
    }
    logger.warn("claim rejected", { reason: decision.reason, orderId: peek.order.id });
    return { outcome: "rejected", reason: decision.reason };
  }

  // Attach the order to the account. The `user_id is null` predicate makes this
  // the atomic claim: a concurrent second claim updates zero rows.
  const attached = await db
    .update(orders)
    .set({ userId: job.userId, updatedAt: now })
    // `isNull`, not `eq(..., null)` — SQL `= NULL` never matches, which would
    // make every claim silently fail.
    .where(and(eq(orders.id, decision.orderId), isNull(orders.userId)))
    .returning({ id: orders.id });

  if (attached.length === 0) {
    logger.info("claim lost the race; another request attached it first", {
      orderId: decision.orderId,
    });
    return { outcome: "already_claimed", orderId: decision.orderId };
  }

  const items = await db
    .select({ episodeId: orderItems.episodeId })
    .from(orderItems)
    .where(eq(orderItems.orderId, decision.orderId));

  const granted: string[] = [];

  for (const item of items) {
    const existing = await db
      .select()
      .from(entitlements)
      .where(and(eq(entitlements.userId, job.userId), eq(entitlements.episodeId, item.episodeId)))
      .limit(1);

    const result = applyOrderToEntitlement({
      userId: job.userId,
      episodeId: item.episodeId as never,
      orderId: decision.orderId,
      orderStatus: "fulfilled",
      now,
      existing: existing[0]
        ? {
            userId: existing[0].userId,
            episodeId: existing[0].episodeId as never,
            sourceOrderId: existing[0].sourceOrderId ?? decision.orderId,
            status: existing[0].status as never,
            grantedAt: existing[0].grantedAt,
          }
        : null,
    });

    if (!result.ok) {
      logger.info("claim produced no entitlement change", {
        orderId: decision.orderId,
        episodeId: item.episodeId,
        reason: result.reason,
      });
      continue;
    }

    if (!existing[0]) {
      const entitlementId = `ent_${randomUUID()}`;
      await db.insert(entitlements).values({
        id: entitlementId,
        userId: job.userId,
        episodeId: item.episodeId,
        sourceOrderId: decision.orderId,
        status: ENTITLEMENT_STATUS.ACTIVE,
        grantedAt: now,
        reason: "guest_claim",
      });
      await db.insert(entitlementEvents).values({
        id: `ee_${randomUUID()}`,
        entitlementId,
        type: "granted",
        actor: "system:guest-claim",
        metadata: { orderId: decision.orderId, claimedBy: job.userId },
      });
      granted.push(item.episodeId);
    }
  }

  logger.info("guest purchase claimed", {
    orderId: decision.orderId,
    userId: job.userId,
    episodes: granted.length,
  });

  return { outcome: "claimed", orderId: decision.orderId, episodeIds: granted };
}

async function peekOrder(
  db: Database,
  token: string,
  secret: string,
  nowSeconds: number,
): Promise<
  | {
      ok: true;
      order: { id: string; status: string; userId: string | null; email: string | null };
    }
  | { ok: false; reason: string }
> {
  const decoded = verifyClaimToken(token, secret, nowSeconds);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };

  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      userId: orders.userId,
      email: orders.email,
    })
    .from(orders)
    .where(eq(orders.id, decoded.claims.orderId))
    .limit(1);

  const order = rows[0];
  if (!order) return { ok: false, reason: "order_not_found" };
  return { ok: true, order };
}
