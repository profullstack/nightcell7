import { z } from "zod";

/**
 * Unified order state machine (PRD §24.3).
 *
 * `paid` and `fulfilled` are deliberately separate states so a failure to grant
 * an entitlement can be retried without re-charging anyone, and so a stuck
 * order is visible as "paid but not fulfilled" rather than silently lost.
 *
 * Transitions are append-only in the event history: this module decides whether
 * a transition is legal, it never mutates history.
 */

export const ORDER_STATUS = {
  CREATED: "created",
  PENDING: "pending",
  CONFIRMING: "confirming",
  PAID: "paid",
  FULFILLED: "fulfilled",
  REFUNDED: "refunded",
  REVERSED: "reversed",
  DISPUTED: "disputed",
  CANCELED: "canceled",
  EXPIRED: "expired",
  UNDERPAID: "underpaid",
  OVERPAID: "overpaid",
  MANUAL_REVIEW: "manual_review",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const orderStatusSchema = z.nativeEnum(ORDER_STATUS);

/**
 * Legal transitions. Anything not listed is rejected — an unknown provider
 * event must never be able to walk an order into an arbitrary state.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [ORDER_STATUS.CREATED]: [
    ORDER_STATUS.PENDING,
    ORDER_STATUS.CANCELED,
    ORDER_STATUS.EXPIRED,
    ORDER_STATUS.MANUAL_REVIEW,
  ],
  [ORDER_STATUS.PENDING]: [
    ORDER_STATUS.CONFIRMING,
    ORDER_STATUS.PAID,
    ORDER_STATUS.UNDERPAID,
    ORDER_STATUS.OVERPAID,
    ORDER_STATUS.CANCELED,
    ORDER_STATUS.EXPIRED,
    ORDER_STATUS.MANUAL_REVIEW,
  ],
  [ORDER_STATUS.CONFIRMING]: [
    ORDER_STATUS.PAID,
    ORDER_STATUS.UNDERPAID,
    ORDER_STATUS.OVERPAID,
    ORDER_STATUS.EXPIRED,
    ORDER_STATUS.MANUAL_REVIEW,
  ],
  // Fulfilment is the only forward move from paid; refunds may still arrive.
  [ORDER_STATUS.PAID]: [
    ORDER_STATUS.FULFILLED,
    ORDER_STATUS.REFUNDED,
    ORDER_STATUS.REVERSED,
    ORDER_STATUS.DISPUTED,
    ORDER_STATUS.MANUAL_REVIEW,
  ],
  [ORDER_STATUS.FULFILLED]: [
    ORDER_STATUS.REFUNDED,
    ORDER_STATUS.REVERSED,
    ORDER_STATUS.DISPUTED,
    ORDER_STATUS.MANUAL_REVIEW,
  ],
  // A dispute can resolve either way.
  [ORDER_STATUS.DISPUTED]: [
    ORDER_STATUS.FULFILLED,
    ORDER_STATUS.REVERSED,
    ORDER_STATUS.REFUNDED,
    ORDER_STATUS.MANUAL_REVIEW,
  ],
  [ORDER_STATUS.UNDERPAID]: [
    ORDER_STATUS.PAID,
    ORDER_STATUS.REFUNDED,
    ORDER_STATUS.EXPIRED,
    ORDER_STATUS.MANUAL_REVIEW,
  ],
  [ORDER_STATUS.OVERPAID]: [
    ORDER_STATUS.PAID,
    ORDER_STATUS.FULFILLED,
    ORDER_STATUS.REFUNDED,
    ORDER_STATUS.MANUAL_REVIEW,
  ],
  [ORDER_STATUS.MANUAL_REVIEW]: [
    ORDER_STATUS.PAID,
    ORDER_STATUS.FULFILLED,
    ORDER_STATUS.REFUNDED,
    ORDER_STATUS.REVERSED,
    ORDER_STATUS.CANCELED,
    ORDER_STATUS.EXPIRED,
  ],
  // Terminal.
  [ORDER_STATUS.REFUNDED]: [],
  [ORDER_STATUS.REVERSED]: [],
  [ORDER_STATUS.CANCELED]: [],
  [ORDER_STATUS.EXPIRED]: [],
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUS.REFUNDED,
  ORDER_STATUS.REVERSED,
  ORDER_STATUS.CANCELED,
  ORDER_STATUS.EXPIRED,
];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true; // idempotent replay of the same webhook
  return (TRANSITIONS[from] ?? []).includes(to);
}

export type TransitionResult =
  { ok: true; status: OrderStatus; changed: boolean } | { ok: false; reason: string };

/**
 * Apply a status transition.
 *
 * Replaying the same transition is a success with `changed: false` — provider
 * webhooks retry, and a retry must not become an error page or a second
 * fulfilment (PRD §24.4).
 */
export function transition(from: OrderStatus, to: OrderStatus): TransitionResult {
  if (from === to) return { ok: true, status: to, changed: false };
  if (!canTransition(from, to)) {
    return { ok: false, reason: `illegal_transition:${from}->${to}` };
  }
  return { ok: true, status: to, changed: true };
}

/** Orders in these states still need watching by the reconciliation job. */
export function isNonTerminal(status: OrderStatus): boolean {
  return !isTerminal(status) && status !== ORDER_STATUS.FULFILLED;
}

/** True when the buyer has paid but the content has not been unlocked yet. */
export function needsFulfilment(status: OrderStatus): boolean {
  return status === ORDER_STATUS.PAID || status === ORDER_STATUS.OVERPAID;
}
