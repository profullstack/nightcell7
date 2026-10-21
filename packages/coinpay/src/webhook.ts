import { createHmac, timingSafeEqual } from "node:crypto";
import { ORDER_STATUS, type OrderStatus } from "@nightcell7/entitlements";

/**
 * CoinPayPortal webhook verification and event mapping (PRD §24.4).
 *
 * Rules this file exists to enforce:
 *   - the signature is verified against the RAW body, before any JSON parsing;
 *   - stale events are rejected so a captured webhook cannot be replayed later;
 *   - the provider event id is the idempotency key;
 *   - the browser return URL never unlocks anything; only a verified event
 *     moves an order forward.
 *
 * The wire contract is CoinPay's (src/lib/webhooks/service.ts there):
 *
 *   X-CoinPay-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>">
 *   { "id": "evt_<payment>_<ts>", "type": "payment.confirmed",
 *     "data": { "payment_id", "status", "amount", "metadata"? ... },
 *     "created_at", "business_id" }
 *
 * The top-level `id` is the EVENT, not the payment. Hosted checkout sessions
 * add `checkout_session_id`, `account_id`, `property`, `customer_email` and
 * `metadata`, at the top level or inside `data`; both are read.
 */

export const COINPAY_SIGNATURE_HEADER = "x-coinpay-signature";
/** Legacy: CoinPay puts the timestamp inside the signature header. */
export const COINPAY_TIMESTAMP_HEADER = "x-coinpay-timestamp";

/** Events older than this are rejected as replays. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface CoinpayEvent {
  /** Provider-unique event id; stored under a unique constraint. */
  id: string;
  type: string;
  createdAt: string;
  data: {
    /** CoinPay payment (or PayPal transaction) id. */
    paymentId?: string;
    checkoutSessionId?: string;
    /** Our order id, from metadata.order_id, when CoinPay echoed metadata. */
    referenceId?: string;
    accountId?: string;
    property?: string;
    status: string;
    currency?: string;
    /** USD major units, as CoinPay reports it. */
    amount?: number;
    payerEmail?: string;
  };
}

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
  /** `t=<unix>,v1=<hex>` as CoinPay sends it. */
  signature: string | null | undefined;
  /** Only for a bare-hex signature; CoinPay itself never sends this. */
  timestamp?: string | null | undefined;
  secret: string;
  nowSeconds: number;
}

/**
 * Verify and parse a CoinPay webhook.
 *
 * The signed payload is `${timestamp}.${rawBody}`; binding the timestamp into
 * the signature is what makes the freshness check meaningful.
 */
export function verifyWebhook(input: VerifyWebhookInput): WebhookVerification {
  if (!input.signature) return { ok: false, reason: "missing_signature" };

  let ts: string | undefined;
  const provided: string[] = [];
  if (input.signature.includes("=")) {
    for (const part of input.signature.split(",")) {
      const [k, v] = part.split("=", 2).map((s) => s?.trim());
      if (k === "t") ts = v;
      else if (k === "v1" && v) provided.push(v.toLowerCase());
    }
  } else {
    ts = input.timestamp ?? undefined;
    provided.push(input.signature.trim().toLowerCase());
  }
  if (!ts) return { ok: false, reason: "missing_timestamp" };
  if (provided.length === 0) return { ok: false, reason: "missing_signature" };

  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(input.nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_event" };
  }

  const expected = Buffer.from(
    createHmac("sha256", input.secret).update(`${ts}.${input.rawBody}`).digest("hex"),
  );
  const matched = provided.some((sig) => {
    const a = Buffer.from(sig);
    return a.length === expected.length && timingSafeEqual(a, expected);
  });
  if (!matched) return { ok: false, reason: "bad_signature" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, reason: "malformed_body" };
  }

  const event = parseEvent(parsed);
  if (!event) return { ok: false, reason: "invalid_event" };
  return { ok: true, event };
}

function str(value: unknown, max = 320): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Read CoinPay's nested shape, falling back to the flat test-webhook shape. */
export function parseEvent(payload: unknown): CoinpayEvent | null {
  const top = obj(payload);
  const hasData = top.data && typeof top.data === "object";
  const d = hasData ? obj(top.data) : top;
  const meta = { ...obj(top.metadata), ...obj(d.metadata) };

  const id = str(top.id, 128);
  const type = str(top.type, 64) ?? str(top.event, 64);
  if (!id || !type) return null;

  // Read the payment id from `data` first: the top-level id is the event.
  const paymentId = str(d.payment_id, 128) ?? (hasData ? str(d.id, 128) : undefined);
  const checkoutSessionId = str(d.checkout_session_id, 128) ?? str(top.checkout_session_id, 128);
  const referenceId = str(meta.order_id, 128) ?? str(meta.orderId, 128);
  if (!paymentId && !checkoutSessionId && !referenceId) return null;

  return {
    id,
    type,
    createdAt: str(top.created_at, 64) ?? str(top.createdAt, 64) ?? new Date().toISOString(),
    data: {
      paymentId,
      checkoutSessionId,
      referenceId,
      accountId: str(top.account_id, 128) ?? str(d.account_id, 128) ?? str(meta.account_id, 128),
      property: str(top.property, 128) ?? str(d.property, 128) ?? str(meta.property, 128),
      status: str(d.status, 64) ?? "",
      currency: str(d.currency, 16),
      amount: num(d.amount_usd) ?? num(d.amount),
      payerEmail:
        str(top.customer_email) ?? str(d.customer_email) ?? str(d.payer_email) ?? str(meta.email),
    },
  };
}

/** Test/dev helper producing CoinPay's `t=..,v1=..` header. Never used in production. */
export function signWebhookPayload(rawBody: string, timestamp: number, secret: string): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
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
    case "detected":
      return ORDER_STATUS.CONFIRMING;
    case "paid":
    case "complete":
    case "completed":
    case "confirmed":
    case "forwarded":
    case "forwarding":
    case "captured":
      return ORDER_STATUS.PAID;
    case "underpaid":
      return ORDER_STATUS.UNDERPAID;
    case "overpaid":
      return ORDER_STATUS.OVERPAID;
    case "expired":
      return ORDER_STATUS.EXPIRED;
    case "canceled":
    case "cancelled":
    case "failed":
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
 * Event -> internal order status. The event type is CoinPay's statement of
 * what happened; `data.status` refines it (an under- or overpayment still
 * arrives as `payment.confirmed`).
 */
export function mapEventStatus(event: CoinpayEvent): OrderStatus {
  const fromStatus = event.data.status ? mapProviderStatus(event.data.status) : null;
  switch (event.type.toLowerCase()) {
    case "payment.confirmed":
    case "payment.forwarded":
    case "payment.completed":
    case "checkout.session.completed":
    case "checkout_session.completed":
      return fromStatus === ORDER_STATUS.UNDERPAID || fromStatus === ORDER_STATUS.OVERPAID
        ? fromStatus
        : ORDER_STATUS.PAID;
    case "payment.expired":
    case "checkout.session.expired":
    case "checkout_session.expired":
      return ORDER_STATUS.EXPIRED;
    case "payment.failed":
      return ORDER_STATUS.CANCELED;
    case "payment.disputed":
      return ORDER_STATUS.DISPUTED;
    case "payment.dispute_resolved":
      return ORDER_STATUS.MANUAL_REVIEW;
    default:
      return fromStatus ?? ORDER_STATUS.MANUAL_REVIEW;
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
      checkoutSessionId: event.data.checkoutSessionId,
      property: event.data.property,
      status: event.data.status,
      currency: event.data.currency,
      amount: event.data.amount,
      // Deliberately omitted: payerEmail, account id.
    },
  };
}
