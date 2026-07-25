import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  entitlementEvents,
  entitlements,
  orderItems,
  orders,
  paymentEvents,
  type Database,
} from "@nightcell7/database";
import {
  CATALOG,
  ENTITLEMENT_STATUS,
  ORDER_STATUS,
  applyOrderToEntitlement,
  needsFulfilment,
  transition,
  type OrderStatus,
} from "@nightcell7/entitlements";
import { createClaimToken } from "@nightcell7/entitlements/server";
import type { Logger } from "@nightcell7/observability";

/**
 * CoinPay event fulfilment (PRD §24.2 steps 8-9).
 *
 * This is the only place an entitlement is created from a payment. It is
 * written to be safe to run twice: the same job re-executed must not grant
 * twice, revoke twice, or produce a second audit event.
 */

/**
 * Side effects the fulfilment path needs. Injected so the decision logic stays
 * testable without a queue.
 */
export interface PaymentSideEffects {
  enqueue: (queue: string, name: string, payload: unknown) => Promise<void>;
  claimSecret: string;
  publicOrigin: string;
}

export interface CoinpayEventJob {
  providerEventId: string;
  orderId: string;
  mappedStatus: OrderStatus;
  paymentId?: string;
  correlationId?: string;
}

export interface PaymentProcessResult {
  outcome:
    | "fulfilled"
    | "revoked"
    | "suspended"
    | "status_updated"
    | "unchanged"
    | "unknown_order"
    | "illegal_transition";
  orderId: string;
  detail?: string;
}

export async function processCoinpayEvent(
  db: Database,
  logger: Logger,
  job: CoinpayEventJob,
  effects?: PaymentSideEffects,
): Promise<PaymentProcessResult> {
  const now = new Date().toISOString();

  const orderRows = await db.select().from(orders).where(eq(orders.id, job.orderId)).limit(1);
  const order = orderRows[0];
  if (!order) {
    // An event for an order we never created is an operations problem, not a
    // silent drop.
    logger.error("payment event for unknown order", { orderId: job.orderId });
    await markEventProcessed(db, job.providerEventId, "unknown_order", now);
    return { outcome: "unknown_order", orderId: job.orderId };
  }

  const currentStatus = order.status as OrderStatus;
  const move = transition(currentStatus, job.mappedStatus);
  if (!move.ok) {
    logger.warn("illegal order transition ignored", {
      orderId: job.orderId,
      from: currentStatus,
      to: job.mappedStatus,
    });
    await markEventProcessed(db, job.providerEventId, "illegal_transition", now);
    return { outcome: "illegal_transition", orderId: job.orderId, detail: move.reason };
  }

  if (move.changed) {
    await db
      .update(orders)
      .set({
        status: move.status,
        coinpayPaymentId: job.paymentId ?? order.coinpayPaymentId,
        paidAt: move.status === ORDER_STATUS.PAID ? now : order.paidAt,
        refundedAt: move.status === ORDER_STATUS.REFUNDED ? now : order.refundedAt,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id));
  }

  // `paid` does not unlock anything on its own — fulfilment is a separate,
  // retryable step (PRD §24.3).
  let effectiveStatus = move.status;
  if (needsFulfilment(move.status)) {
    const toFulfilled = transition(move.status, ORDER_STATUS.FULFILLED);
    if (toFulfilled.ok) {
      await db
        .update(orders)
        .set({ status: ORDER_STATUS.FULFILLED, fulfilledAt: now, updatedAt: now })
        .where(eq(orders.id, order.id));
      effectiveStatus = ORDER_STATUS.FULFILLED;
    }
  }

  const result = await applyEntitlements(db, logger, order.id, order.userId, effectiveStatus, now);

  // A guest purchase is worthless to the buyer until they can claim it, so the
  // claim email is part of fulfilment rather than a separate concern.
  if (effects && effectiveStatus === ORDER_STATUS.FULFILLED && !order.userId && order.email) {
    const claim = createClaimToken(
      { orderId: order.id, email: order.email },
      effects.claimSecret,
      Math.floor(Date.now() / 1000),
    );
    await effects.enqueue("email", "purchase-claim", {
      kind: "purchase-claim",
      to: order.email,
      claimUrl: `${effects.publicOrigin}/claim/${claim.token}`,
      episodeTitle: await episodeTitleFor(db, order.id),
    });
    logger.info("claim link queued for guest purchase", { orderId: order.id });
  }

  await markEventProcessed(db, job.providerEventId, "processed", now);
  return { ...result, orderId: order.id };
}

async function applyEntitlements(
  db: Database,
  logger: Logger,
  orderId: string,
  userId: string | null,
  status: OrderStatus,
  now: string,
): Promise<Omit<PaymentProcessResult, "orderId">> {
  if (!userId) {
    // Guest purchase: the entitlement is created when the claim link is used
    // (PRD §23.4). Nothing to grant yet.
    logger.info("order fulfilled for guest; awaiting claim", { orderId });
    return { outcome: "status_updated", detail: "awaiting_claim" };
  }

  const items = await db
    .select({ episodeId: orderItems.episodeId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  let outcome: PaymentProcessResult["outcome"] = "unchanged";

  for (const item of items) {
    const existingRows = await db
      .select()
      .from(entitlements)
      .where(and(eq(entitlements.userId, userId), eq(entitlements.episodeId, item.episodeId)))
      .limit(1);
    const existing = existingRows[0];

    const decision = applyOrderToEntitlement({
      userId,
      episodeId: item.episodeId as never,
      orderId,
      orderStatus: status,
      now,
      existing: existing
        ? {
            userId: existing.userId,
            episodeId: existing.episodeId as never,
            sourceOrderId: existing.sourceOrderId ?? orderId,
            status: existing.status as never,
            grantedAt: existing.grantedAt,
            revokedAt: existing.revokedAt,
          }
        : null,
    });

    if (!decision.ok) {
      logger.info("entitlement unchanged", {
        orderId,
        episodeId: item.episodeId,
        reason: decision.reason,
      });
      continue;
    }

    const entitlementId = existing?.id ?? `ent_${randomUUID()}`;

    if (!existing) {
      await db.insert(entitlements).values({
        id: entitlementId,
        userId,
        episodeId: item.episodeId,
        sourceOrderId: orderId,
        status: decision.entitlement.status,
        grantedAt: decision.entitlement.grantedAt,
        revokedAt: decision.entitlement.revokedAt ?? null,
        reason: decision.entitlement.reason ?? null,
      });
    } else if (existing.status !== decision.entitlement.status) {
      await db
        .update(entitlements)
        .set({
          status: decision.entitlement.status,
          revokedAt: decision.entitlement.revokedAt ?? null,
          reason: decision.entitlement.reason ?? null,
        })
        .where(eq(entitlements.id, entitlementId));
    } else {
      // Already in the target state — replay, nothing to do and no audit noise.
      continue;
    }

    // Entitlement history is append-only (PRD §24.4).
    await db.insert(entitlementEvents).values({
      id: `ee_${randomUUID()}`,
      entitlementId,
      type: decision.event,
      actor: "system:coinpay-webhook",
      metadata: { orderId, orderStatus: status },
    });

    outcome =
      decision.entitlement.status === ENTITLEMENT_STATUS.ACTIVE
        ? "fulfilled"
        : decision.entitlement.status === ENTITLEMENT_STATUS.SUSPENDED
          ? "suspended"
          : "revoked";

    logger.info("entitlement applied", {
      orderId,
      episodeId: item.episodeId,
      status: decision.entitlement.status,
    });
  }

  return { outcome };
}

async function episodeTitleFor(db: Database, orderId: string): Promise<string> {
  const rows = await db
    .select({ episodeId: orderItems.episodeId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .limit(1);
  const episodeId = rows[0]?.episodeId;
  return CATALOG.find((entry) => entry.episodeId === episodeId)?.title ?? "your episode";
}

async function markEventProcessed(
  db: Database,
  providerEventId: string,
  status: string,
  now: string,
): Promise<void> {
  await db
    .update(paymentEvents)
    .set({ processingStatus: status, processedAt: now })
    .where(eq(paymentEvents.providerEventId, providerEventId));
}
