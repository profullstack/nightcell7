import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ORDER_STATUS, type OrderStatus } from "@nightcell7/entitlements";

/**
 * CoinPayPortal webhook verification and event mapping (PRD §24.4).
 *
 * Rules this file exists to enforce:
 *   - the signature is verified against the RAW body, before any JSON parsing;
 *   - stale events are rejected so a captured webhook cannot be replayed later;
 *   - the provider event id is the idempotency key;
 *   - the browser return URL never unlocks anything — only a verified event
 *     moves an order forward.
 */

export const COINPAY_SIGNATURE_HEADER = "x-coinpay-signature";
export const COINPAY_TIMESTAMP_HEADER = "x-coinpay-timestamp";

/** Events older than this are rejected as replays. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export const coinpayEventSchema = z.object({
  /** Provider-unique event id — stored under a unique constraint. */
  id: z.string().min(1).max(128),
  type: z.string().min(1).max(64),
  createdAt: z.string(),
  data: z.object({
    /** Our internal order id, echoed back by the provider. */
    referenceId: z.string().min(1).max(128),
    paymentId: z.string().min(1).max(128).optional(),
    invoiceId: z.string().min(1).max(128).optional(),
    status: z.string().min(1).max(64),
    currency: z.string().min(3).max(8).optional(),
    /** Minor units of the fiat amount the buyer was quoted. */
    amount: z.number().int().nonnegative().optional(),
    amountPaid: z.number().int().nonnegative().optional(),
    asset: z.string().max(32).optional(),
    payerEmail: z.string().email().max(320).optional(),
  }),
});

export type CoinpayEvent = z.infer<typeof coinpayEventSchema>;

export type VerificationFailure =
  | "missing_signature"
  | "missing_timestamp"
  | "bad_timestamp"
  | "stale_event"
  | "bad_signature"
  | "malformed_body"
  | "invalid_event";

export type WebhookVerification =
  { ok: true; event: CoinpayEvent } | { ok: false; reason: VerificationFailure };

export interface VerifyWebhookInput {
  /** The exact bytes received. Never a re-serialised object. */
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string;
  nowSeconds: number;
}

/**
 * Verify and parse a CoinPay webhook.
 *
 * The signed payload is `${timestamp}.${rawBody}`; binding the timestamp into
 * the signature is what makes the freshness check meaningful — otherwise an
 * attacker could replay an old body with a fresh header.
 */
export function verifyWebhook(input: VerifyWebhookInput): WebhookVerification {
  if (!input.signature) return { ok: false, reason: "missing_signature" };
  if (!input.timestamp) return { ok: false, reason: "missing_timestamp" };

  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(input.nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_event" };
  }

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex");

  const provided = input.signature.trim().toLowerCase();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, reason: "malformed_body" };
  }

  const event = coinpayEventSchema.safeParse(parsed);
  if (!event.success) return { ok: false, reason: "invalid_event" };

  return { ok: true, event: event.data };
}

/** Test/dev helper for producing a valid signature. Never used in production. */
export function signWebhookPayload(rawBody: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Provider status -> internal order status.
 *
 * Unknown provider statuses map to `manual_review` rather than being ignored:
 * a payment state we do not understand is an operations problem, not a silent
 * no-op.
 */
export function mapProviderStatus(providerStatus: string): OrderStatus {
  switch (providerStatus.toLowerCase()) {
    case "new":
    case "created":
      return ORDER_STATUS.CREATED;
    case "pending":
    case "awaiting_payment":
      return ORDER_STATUS.PENDING;
    case "confirming":
    case "unconfirmed":
      return ORDER_STATUS.CONFIRMING;
    case "paid":
    case "complete":
    case "completed":
    case "confirmed":
      return ORDER_STATUS.PAID;
    case "underpaid":
      return ORDER_STATUS.UNDERPAID;
    case "overpaid":
      return ORDER_STATUS.OVERPAID;
    case "expired":
      return ORDER_STATUS.EXPIRED;
    case "canceled":
    case "cancelled":
      return ORDER_STATUS.CANCELED;
    case "refunded":
      return ORDER_STATUS.REFUNDED;
    case "reversed":
    case "chargeback":
      return ORDER_STATUS.REVERSED;
    case "disputed":
      return ORDER_STATUS.DISPUTED;
    default:
      return ORDER_STATUS.MANUAL_REVIEW;
  }
}

/**
 * Redact provider payloads before logging (PRD §24.4, §33.2).
 * Payer identifiers and any key-like field must not reach the log stream.
 */
export function redactEventForLog(event: CoinpayEvent): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    data: {
      referenceId: event.data.referenceId,
      paymentId: event.data.paymentId,
      status: event.data.status,
      currency: event.data.currency,
      amount: event.data.amount,
      // Deliberately omitted: payerEmail, asset-level payer details.
    },
  };
}
