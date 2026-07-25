import { z } from "zod";
import type { EpisodeId } from "@nightcell7/game-core";
import { ORDER_STATUS, type OrderStatus } from "./orders";

/**
 * Entitlement rules (PRD §5.6, §26).
 *
 * "Buy once, play everywhere." An entitlement is per user + episode, granted
 * exactly once from a fulfilled order, and revoked only by a confirmed refund
 * or reversal. Free multiplayer access is never affected by a revocation
 * (PRD §5.6) — that is a separate check, and this module never touches it.
 */

export const ENTITLEMENT_STATUS = {
  ACTIVE: "active",
  /** Payment disputed; access paused pending review, not destroyed. */
  SUSPENDED: "suspended",
  REVOKED: "revoked",
} as const;

export type EntitlementStatus = (typeof ENTITLEMENT_STATUS)[keyof typeof ENTITLEMENT_STATUS];

export const ENTITLEMENT_EVENT = {
  GRANTED: "granted",
  SUSPENDED: "suspended",
  RESTORED: "restored",
  REVOKED: "revoked",
} as const;

export type EntitlementEventType = (typeof ENTITLEMENT_EVENT)[keyof typeof ENTITLEMENT_EVENT];

export interface Entitlement {
  userId: string;
  episodeId: EpisodeId;
  sourceOrderId: string;
  status: EntitlementStatus;
  grantedAt: string;
  revokedAt?: string | null;
  reason?: string | null;
}

export const entitlementSchema = z.object({
  userId: z.string().min(1),
  episodeId: z.string().min(1),
  sourceOrderId: z.string().min(1),
  status: z.nativeEnum(ENTITLEMENT_STATUS),
  grantedAt: z.string(),
  revokedAt: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});

/** Only an active entitlement unlocks paid content. */
export function hasAccess(entitlement: Entitlement | undefined | null): boolean {
  return entitlement?.status === ENTITLEMENT_STATUS.ACTIVE;
}

export interface EntitlementDecision {
  /** What the entitlement should look like after processing this order state. */
  status: EntitlementStatus | null;
  event: EntitlementEventType | null;
  reason: string;
}

/**
 * Map an order status onto the entitlement it should produce.
 *
 * Centralising this is what keeps "refund revokes access" true across the
 * webhook path, the reconciliation cron and any support tooling — none of them
 * gets to invent its own rule.
 */
export function decideEntitlement(orderStatus: OrderStatus): EntitlementDecision {
  switch (orderStatus) {
    case ORDER_STATUS.FULFILLED:
      return {
        status: ENTITLEMENT_STATUS.ACTIVE,
        event: ENTITLEMENT_EVENT.GRANTED,
        reason: "order_fulfilled",
      };
    case ORDER_STATUS.DISPUTED:
      return {
        status: ENTITLEMENT_STATUS.SUSPENDED,
        event: ENTITLEMENT_EVENT.SUSPENDED,
        reason: "payment_disputed",
      };
    case ORDER_STATUS.REFUNDED:
      return {
        status: ENTITLEMENT_STATUS.REVOKED,
        event: ENTITLEMENT_EVENT.REVOKED,
        reason: "refunded",
      };
    case ORDER_STATUS.REVERSED:
      return {
        status: ENTITLEMENT_STATUS.REVOKED,
        event: ENTITLEMENT_EVENT.REVOKED,
        reason: "payment_reversed",
      };
    default:
      // Everything else — created, pending, confirming, paid-but-not-fulfilled —
      // grants nothing. Notably `paid` alone does NOT unlock content.
      return { status: null, event: null, reason: "no_change" };
  }
}

export type GrantResult =
  | { ok: true; entitlement: Entitlement; event: EntitlementEventType; created: boolean }
  | { ok: false; reason: string };

export interface GrantInput {
  userId: string;
  episodeId: EpisodeId;
  orderId: string;
  orderStatus: OrderStatus;
  now: string;
  existing?: Entitlement | null;
}

/**
 * Idempotent entitlement application.
 *
 * Calling this twice for the same fulfilled order returns the same active
 * entitlement and reports `created: false`, which is what makes a replayed
 * webhook or a re-run reconciliation job safe (PRD §24.4).
 */
export function applyOrderToEntitlement(input: GrantInput): GrantResult {
  const decision = decideEntitlement(input.orderStatus);
  if (decision.status === null) {
    return { ok: false, reason: decision.reason };
  }

  const existing = input.existing ?? null;

  if (existing && existing.sourceOrderId !== input.orderId) {
    // A second order for content the user already owns must not silently
    // re-point the entitlement; that is a support/refund question.
    if (
      decision.status === ENTITLEMENT_STATUS.ACTIVE &&
      existing.status === ENTITLEMENT_STATUS.ACTIVE
    ) {
      return { ok: false, reason: "already_owned_by_another_order" };
    }
    if (decision.status === ENTITLEMENT_STATUS.REVOKED) {
      // Refunding an older order must not revoke access bought again later.
      return { ok: false, reason: "revocation_targets_superseded_order" };
    }
  }

  if (existing && existing.status === decision.status) {
    return { ok: true, entitlement: existing, event: decision.event!, created: false };
  }

  const entitlement: Entitlement = {
    userId: input.userId,
    episodeId: input.episodeId,
    sourceOrderId: existing?.sourceOrderId ?? input.orderId,
    status: decision.status,
    grantedAt: existing?.grantedAt ?? input.now,
    revokedAt: decision.status === ENTITLEMENT_STATUS.REVOKED ? input.now : null,
    reason: decision.reason,
  };

  return { ok: true, entitlement, event: decision.event!, created: existing === null };
}

// --------------------------------------------------------------------------
// Offline licences (PRD §26.5)
// --------------------------------------------------------------------------

/** Initial offline grace period, subject to testing before launch. */
export const OFFLINE_GRACE_DAYS = 30;

export interface OfflineLicense {
  userId: string;
  episodeId: EpisodeId;
  deviceId: string;
  tokenId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

export function isOfflineLicenseValid(license: OfflineLicense, now: Date): boolean {
  if (license.revokedAt) return false;
  return new Date(license.expiresAt).getTime() > now.getTime();
}

export function offlineExpiry(issuedAt: Date, days = OFFLINE_GRACE_DAYS): Date {
  return new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Remembered devices per account (PRD §26.6). No hardware fingerprinting. */
export const MAX_REMEMBERED_DEVICES = 10;
