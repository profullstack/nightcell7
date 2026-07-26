import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Server-only entitlement crypto.
 *
 * Imported as `@nightcell7/entitlements/server`. Kept out of the main entry
 * point so `node:crypto` never reaches the marketing site's browser bundle —
 * the site imports `CATALOG` from the same package.
 *
 * Two token types live here, and they are deliberately different shapes:
 *
 *   - CLAIM tokens attach a guest purchase to an account. One use, then dead.
 *   - OFFLINE LICENCES let an owned episode launch without a network. They are
 *     long-lived by design (30 days) and therefore carry a device binding and a
 *     revocation id.
 *
 * Neither is an authentication token and neither grants anything on its own:
 * both are checked against durable state before they do anything.
 */

const SEPARATOR = ".";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encode(claims: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}${SEPARATOR}${sign(payload, secret)}`;
}

type DecodeResult<T> =
  | { ok: true; claims: T }
  | { ok: false; reason: "malformed" | "bad_signature" | "invalid_claims" | "expired" };

function decode<T extends z.ZodType<{ exp: number }>>(
  token: string,
  secret: string,
  schema: T,
  nowSeconds: number,
): DecodeResult<z.infer<T>> {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payload, signature] = parts as [string, string];

  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "invalid_claims" };
  if (parsed.data.exp <= nowSeconds) return { ok: false, reason: "expired" };

  return { ok: true, claims: parsed.data };
}

// --------------------------------------------------------------------------
// Guest purchase claim (PRD §23.4)
// --------------------------------------------------------------------------

export const CLAIM_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export const claimClaimsSchema = z.object({
  jti: z.string().min(8).max(64),
  orderId: z.string().min(1).max(128),
  /** The email CoinPay associated with the payment. */
  email: z.string().email().max(320),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
});

export type ClaimClaims = z.infer<typeof claimClaimsSchema>;

export function createClaimToken(
  input: { orderId: string; email: string },
  secret: string,
  nowSeconds: number,
): { token: string; jti: string; expiresAt: number } {
  const jti = randomBytes(16).toString("hex");
  const exp = nowSeconds + CLAIM_TOKEN_TTL_SECONDS;
  const claims: ClaimClaims = {
    jti,
    orderId: input.orderId,
    email: input.email.toLowerCase(),
    iat: nowSeconds,
    exp,
  };
  return { token: encode(claims, secret), jti, expiresAt: exp };
}

export function verifyClaimToken(
  token: string,
  secret: string,
  nowSeconds: number,
): DecodeResult<ClaimClaims> {
  return decode(token, secret, claimClaimsSchema, nowSeconds);
}

export type ClaimOutcome =
  | { ok: true; orderId: string; email: string }
  | {
      ok: false;
      reason:
        | "invalid_token"
        | "expired"
        | "already_claimed"
        | "order_not_found"
        | "order_not_fulfilled"
        | "email_mismatch";
    };

export interface ClaimContext {
  /** Current durable state of the order the token points at. */
  order: { id: string; status: string; userId: string | null; email: string | null } | null;
  /** True when this token id has already been consumed. */
  alreadyConsumed: boolean;
  /** Email on the account doing the claiming, when we want to require a match. */
  claimantEmail?: string | null;
  /** Require the claimant's email to equal the payment email. */
  requireEmailMatch?: boolean;
}

/**
 * Decide whether a claim may proceed. Pure, so the rules are testable without
 * a database and cannot drift between the API and the worker.
 */
export function evaluateClaim(
  token: string,
  secret: string,
  nowSeconds: number,
  context: ClaimContext,
): ClaimOutcome {
  const decoded = verifyClaimToken(token, secret, nowSeconds);
  if (!decoded.ok) {
    return { ok: false, reason: decoded.reason === "expired" ? "expired" : "invalid_token" };
  }

  // One use. A leaked link that has already been redeemed is inert.
  if (context.alreadyConsumed) return { ok: false, reason: "already_claimed" };

  const order = context.order;
  if (!order || order.id !== decoded.claims.orderId) {
    return { ok: false, reason: "order_not_found" };
  }

  // Only a fulfilled order can be claimed — an unpaid or pending order must
  // never hand over content just because someone has the link.
  if (order.status !== "fulfilled") return { ok: false, reason: "order_not_fulfilled" };

  // Claiming an order that already belongs to someone is a support case.
  if (order.userId) return { ok: false, reason: "already_claimed" };

  if (context.requireEmailMatch) {
    const claimant = context.claimantEmail?.toLowerCase() ?? null;
    if (!claimant || claimant !== decoded.claims.email.toLowerCase()) {
      return { ok: false, reason: "email_mismatch" };
    }
  }

  return { ok: true, orderId: decoded.claims.orderId, email: decoded.claims.email };
}

// --------------------------------------------------------------------------
// Offline licences (PRD §26.5)
// --------------------------------------------------------------------------

export const offlineLicenseClaimsSchema = z.object({
  jti: z.string().min(8).max(64),
  sub: z.string().min(1).max(64),
  episodeId: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(128),
  /** Content version the licence was issued against. */
  contentVersion: z.string().min(1).max(32),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
});

export type OfflineLicenseClaims = z.infer<typeof offlineLicenseClaimsSchema>;

export function createOfflineLicense(
  input: { userId: string; episodeId: string; deviceId: string; contentVersion: string },
  secret: string,
  nowSeconds: number,
  graceDays: number,
): { token: string; jti: string; issuedAt: number; expiresAt: number } {
  const jti = randomUUID();
  const exp = nowSeconds + graceDays * 24 * 60 * 60;
  const claims: OfflineLicenseClaims = {
    jti,
    sub: input.userId,
    episodeId: input.episodeId,
    deviceId: input.deviceId,
    contentVersion: input.contentVersion,
    iat: nowSeconds,
    exp,
  };
  return { token: encode(claims, secret), jti, issuedAt: nowSeconds, expiresAt: exp };
}

export function verifyOfflineLicense(
  token: string,
  secret: string,
  nowSeconds: number,
): DecodeResult<OfflineLicenseClaims> {
  return decode(token, secret, offlineLicenseClaimsSchema, nowSeconds);
}

/**
 * Whether an offline licence should still open the game on this device.
 *
 * A revoked licence (refund, chargeback, device removal) fails even while the
 * signature is still valid — which is why revocation is checked separately
 * rather than being folded into expiry.
 */
export function isOfflineLicenseUsable(
  claims: OfflineLicenseClaims,
  context: { deviceId: string; revoked: boolean; nowSeconds: number },
): { usable: true } | { usable: false; reason: "expired" | "revoked" | "wrong_device" } {
  if (context.revoked) return { usable: false, reason: "revoked" };
  if (claims.exp <= context.nowSeconds) return { usable: false, reason: "expired" };
  if (claims.deviceId !== context.deviceId) return { usable: false, reason: "wrong_device" };
  return { usable: true };
}
