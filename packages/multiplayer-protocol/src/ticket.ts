import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * One-time match tickets.
 *
 * PRD §18.6 / §23.3: minted by the API after session and ban checks, consumed
 * once by the match service. Short-lived, scoped to one account + room, and
 * never carrying a session cookie or payment credential.
 *
 * This module is a SERVER-ONLY entry point (`@nightcell7/multiplayer-protocol/ticket`)
 * because it imports `node:crypto`. The browser client only ever handles the
 * opaque string, never these functions.
 */

export const ticketClaimsSchema = z.object({
  /** Ticket id — the replay-guard key in Redis. */
  jti: z.string().min(8).max(64),
  /** Account id. Never an email, never a session token. */
  sub: z.string().min(1).max(64),
  displayName: z.string().min(1).max(32),
  matchId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  region: z.string().min(1).max(32),
  shard: z.string().min(1).max(16),
  mode: z.string().min(1).max(32),
  team: z.number().int().min(-1).max(8).optional(),
  partyId: z.string().max(64).optional(),
  /** Inclusive protocol range this ticket is valid for. */
  minProtocol: z.number().int().nonnegative(),
  maxProtocol: z.number().int().nonnegative(),
  /** Unix seconds. */
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
});

export type MatchTicketClaims = z.infer<typeof ticketClaimsSchema>;

const SEPARATOR = ".";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createTicketId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Encode claims into a compact `payload.signature` string.
 * Deliberately not a JWT: no algorithm field means no algorithm-confusion
 * downgrade, and there is exactly one accepted shape.
 */
export function signTicket(claims: MatchTicketClaims, secret: string): string {
  if (!secret || secret.length < 16) {
    throw new Error("ticket secret must be at least 16 characters");
  }
  const parsed = ticketClaimsSchema.parse(claims);
  const payload = base64url(JSON.stringify(parsed));
  return `${payload}${SEPARATOR}${sign(payload, secret)}`;
}

export type TicketVerification =
  | { ok: true; claims: MatchTicketClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "invalid_claims" };

export function verifyTicket(
  token: string,
  secret: string,
  nowSeconds: number,
): TicketVerification {
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

  const parsed = ticketClaimsSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "invalid_claims" };
  if (parsed.data.exp <= nowSeconds) return { ok: false, reason: "expired" };

  return { ok: true, claims: parsed.data };
}

/**
 * Strip the ticket from a URL or log line. PRD §33.3 requires tickets to be
 * redacted from gateway and application logs.
 */
export function redactTicket(value: string): string {
  return value.replace(/([?&]ticket=)[^&\s]+/gi, "$1[redacted]");
}
