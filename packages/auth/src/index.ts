import { z } from "zod";

/**
 * @nightcell7/auth
 *
 * Account rules shared by the API and the site (PRD §23).
 *
 * Better Auth owns credential storage, hashing and session issuance; this
 * package owns the product rules layered on top: who may play what, display
 * name policy, and the ban checks a multiplayer ticket depends on.
 */

export const ACCESS = {
  /** No account: browse, demo, benchmark, settings (PRD §23.1). */
  ANONYMOUS: "anonymous",
  /** Signed in but email not yet verified. */
  UNVERIFIED: "unverified",
  VERIFIED: "verified",
} as const;

export type AccessLevel = (typeof ACCESS)[keyof typeof ACCESS];

export interface AccountContext {
  userId: string | null;
  verified: boolean;
  status: "active" | "restricted" | "banned" | "deleted";
  multiplayerBannedUntil?: string | null;
}

export function accessLevel(account: AccountContext | null): AccessLevel {
  if (!account?.userId) return ACCESS.ANONYMOUS;
  return account.verified ? ACCESS.VERIFIED : ACCESS.UNVERIFIED;
}

export type MultiplayerEligibility =
  | { eligible: true }
  | { eligible: false; reason: "account_required" | "account_unverified" | "account_banned" };

/**
 * Online multiplayer requires a verified account (PRD §5.1) — that requirement
 * exists for abuse prevention, reconnect identity and moderation, not to gate
 * a purchase. Multiplayer itself stays free.
 */
export function canPlayMultiplayer(
  account: AccountContext | null,
  now = new Date(),
): MultiplayerEligibility {
  if (!account?.userId) return { eligible: false, reason: "account_required" };
  if (account.status === "banned" || account.status === "deleted") {
    return { eligible: false, reason: "account_banned" };
  }
  if (!account.verified) return { eligible: false, reason: "account_unverified" };
  if (account.multiplayerBannedUntil) {
    const until = new Date(account.multiplayerBannedUntil);
    if (until.getTime() > now.getTime()) return { eligible: false, reason: "account_banned" };
  }
  return { eligible: true };
}

// --------------------------------------------------------------------------
// Display names (PRD §23.3)
// --------------------------------------------------------------------------

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 20;
/** Name changes are rate limited and audited. */
export const DISPLAY_NAME_CHANGE_COOLDOWN_DAYS = 30;

export const displayNameSchema = z
  .string()
  .min(DISPLAY_NAME_MIN)
  .max(DISPLAY_NAME_MAX)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "letters, digits, underscore, dot and dash only");

export function canChangeDisplayName(
  lastChangedAt: string | null | undefined,
  now = new Date(),
): boolean {
  if (!lastChangedAt) return true;
  const elapsed = now.getTime() - new Date(lastChangedAt).getTime();
  return elapsed >= DISPLAY_NAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

// --------------------------------------------------------------------------
// Guest claim (PRD §23.4)
// --------------------------------------------------------------------------

/** Short-lived, one-use claim links. */
export const CLAIM_TOKEN_TTL_MINUTES = 60 * 24 * 7;

export const claimTokenSchema = z.object({
  orderId: z.string().min(1),
  email: z.string().email(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  nonce: z.string().min(8),
});

export type ClaimTokenClaims = z.infer<typeof claimTokenSchema>;

export function isClaimExpired(claims: ClaimTokenClaims, now = new Date()): boolean {
  return new Date(claims.expiresAt).getTime() <= now.getTime();
}

// --------------------------------------------------------------------------
// Session cookies (PRD §23.5)
// --------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = "nc7_session";

export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
