import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { Credits, postgresStore as creditStore } from "@profullstack/redeem-credits";
import { Affiliates, postgresStore as affStore } from "@profullstack/affiliates";
import { EPISODE } from "@nightcell7/game-core";
import { entitlementEvents, entitlements, users, type Database } from "@nightcell7/database";

/**
 * Credit codes (@profullstack/redeem-credits) and invites (@profullstack/affiliates).
 *
 * NIGHTCELL 7 sells one thing: the $9.99 episode, a permanent entitlement. So a
 * credit code grants an episode (unit `episode:<id>`, amount 1), written into
 * `entitlements` with an `entitlement_events` row, the same tables a fulfilled
 * CoinPay order writes. The grant is idempotent on (user, episode).
 *
 * Invites are scarce (3 per account), single use, and record who invited whom.
 * They carry NO bonus: granting the episode per invite would let every new
 * account hand out three more free copies. What an invite should give is a
 * decision for the owner (see the PR). One invite per account; a second is
 * refused `already_invited` and stays unused.
 */

export const EPISODE_UNIT_PREFIX = "episode:";
export const INVITE_QUOTA = 3;
export const INVITEE_MAX_AGE_DAYS = 7;
const DAY_MS = 86_400_000;

export const episodeUnit = (episodeId: string) => `${EPISODE_UNIT_PREFIX}${episodeId}`;
export const DEFAULT_EPISODE_UNIT = episodeUnit(EPISODE.FALSE_DAWN);

export interface CreditsDeps {
  credits: Credits;
  affiliates: Affiliates;
  ownsEpisode(userId: string, episodeId: string): Promise<boolean>;
  /** Grant an active entitlement unless one exists. True when it was created. */
  grantEpisode(userId: string, episodeId: string, actor: string): Promise<boolean>;
  accountInfo(userId: string): Promise<{ email: string; createdAt: Date } | null>;
  /** Emails of other accounts on any of these domains. */
  emailsOnDomains(domains: string[], excludeUserId: string): Promise<string[]>;
}

type PgLike = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> };

export function createCreditsDeps(pool: PgLike, db: Database): CreditsDeps {
  return {
    credits: new Credits(creditStore(pool as never)),
    affiliates: new Affiliates(affStore(pool as never), { defaultQuota: INVITE_QUOTA }),
    async ownsEpisode(userId, episodeId) {
      const rows = await db
        .select({ status: entitlements.status })
        .from(entitlements)
        .where(and(eq(entitlements.userId, userId), eq(entitlements.episodeId, episodeId)))
        .limit(1);
      return rows[0]?.status === "active";
    },
    async grantEpisode(userId, episodeId, actor) {
      const id = `ent_${randomUUID()}`;
      const inserted = await db
        .insert(entitlements)
        .values({
          id,
          userId,
          episodeId,
          sourceOrderId: null,
          status: "active",
          grantedAt: new Date().toISOString(),
          reason: "credit_code",
        })
        .onConflictDoNothing()
        .returning({ id: entitlements.id });
      if (!inserted[0]) return false;
      await db.insert(entitlementEvents).values({
        id: `ee_${randomUUID()}`,
        entitlementId: id,
        type: "granted",
        actor,
        metadata: { source: actor },
      });
      return true;
    },
    async accountInfo(userId) {
      const rows = await db
        .select({ email: users.email, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0] ?? null;
    },
    async emailsOnDomains(domains, excludeUserId) {
      const rows = await db
        .select({ email: users.email })
        .from(users)
        .where(
          and(
            ne(users.id, excludeUserId),
            inArray(sql`lower(split_part(${users.email}, '@', 2))`, domains),
          ),
        );
      return rows.map((r) => r.email);
    },
  };
}

/** Warm the module tables at boot rather than on a first request. */
export async function warmCredits(deps: CreditsDeps): Promise<void> {
  await deps.credits.list();
  await deps.affiliates.quota("__warmup__");
}

// ------------------------------------------------------------------ codes

export type RedeemOutcome =
  | { ok: true; episodeId: string; granted: boolean }
  | { ok: false; reason: string; message: string };

export const REDEEM_MESSAGES: Record<string, string> = {
  invalid: "That code is not valid.",
  expired: "That code has expired.",
  used_up: "That code has already been used.",
  already_redeemed: "You already redeemed that code.",
  revoked: "That code was revoked.",
  already_owned: "You already own Episode 1, so the code was not used. Pass it on to someone.",
  unsupported: "That code is not for anything this account can receive.",
};

/**
 * Redeem a code for its episode. Every code we mint is for the one episode on
 * sale, so an owner is refused before the code is spent.
 */
export async function redeemCode(
  deps: CreditsDeps,
  userId: string,
  code: string,
): Promise<RedeemOutcome> {
  const episodeId = DEFAULT_EPISODE_UNIT.slice(EPISODE_UNIT_PREFIX.length);
  if (await deps.ownsEpisode(userId, episodeId)) {
    return { ok: false, reason: "already_owned", message: REDEEM_MESSAGES.already_owned! };
  }
  const r = await deps.credits.redeem(code, userId);
  if (!r.ok)
    return {
      ok: false,
      reason: r.reason,
      message: REDEEM_MESSAGES[r.reason] ?? "That code did not work.",
    };
  if (!r.grant.unit.startsWith(EPISODE_UNIT_PREFIX)) {
    return { ok: false, reason: "unsupported", message: REDEEM_MESSAGES.unsupported! };
  }
  const granted = await deps.grantEpisode(
    userId,
    r.grant.unit.slice(EPISODE_UNIT_PREFIX.length),
    `code:${r.codeId}`,
  );
  return { ok: true, episodeId: r.grant.unit.slice(EPISODE_UNIT_PREFIX.length), granted };
}

// ---------------------------------------------------------------- invites

let disposable: Set<string> | undefined;
async function isThrowaway(email: string): Promise<boolean> {
  if (!disposable) {
    const mod = (await import("disposable-email-domains")) as unknown as
      { default?: string[] } | string[];
    disposable = new Set(Array.isArray(mod) ? mod : (mod.default ?? []));
  }
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return true;
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++)
    if (disposable.has(parts.slice(i).join("."))) return true;
  return false;
}

/** Same mailbox: no +tags, no dots on Gmail, googlemail = gmail. */
export function mailboxKey(email: string): string {
  const [rawLocal = "", rawDomain = ""] = email.trim().toLowerCase().split("@");
  let local = rawLocal.split("+")[0] ?? "";
  let domain = rawDomain;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export const ACCEPT_MESSAGES: Record<string, string> = {
  not_verified: "Verify your email first, then accept the invite.",
  not_found: "Sign in first.",
  account_too_old: `Invites are for new accounts (first ${INVITEE_MAX_AGE_DAYS} days).`,
  throwaway_email: "Invites are not open to throwaway email addresses.",
  duplicate_account: "Another NIGHTCELL 7 account already uses that mailbox.",
  invalid: "That invite code is not valid.",
  expired: "That invite has expired.",
  used: "That invite has already been used.",
  self: "You cannot accept your own invite.",
  revoked: "That invite was revoked.",
  already_invited: "Your account has already accepted an invite.",
};

export type AcceptOutcome =
  { ok: true; inviterId: string } | { ok: false; reason: string; message: string };

/**
 * Accept an invite for a new, verified account. redeemInvite() is the single
 * atomic gate; invitedBy() is never pre-checked.
 */
export async function acceptInvite(
  deps: CreditsDeps,
  account: { userId: string; verified: boolean },
  code: string,
  now = Date.now(),
): Promise<AcceptOutcome> {
  const refuse = (reason: string): AcceptOutcome => ({
    ok: false,
    reason,
    message: ACCEPT_MESSAGES[reason] ?? reason,
  });
  if (!account.verified) return refuse("not_verified");
  const info = await deps.accountInfo(account.userId);
  if (!info) return refuse("not_found");
  if (now - new Date(info.createdAt).getTime() > INVITEE_MAX_AGE_DAYS * DAY_MS)
    return refuse("account_too_old");
  if (await isThrowaway(info.email)) return refuse("throwaway_email");
  const key = mailboxKey(info.email);
  const domain = key.split("@")[1] ?? "";
  const domains = domain === "gmail.com" ? ["gmail.com", "googlemail.com"] : [domain];
  const others = await deps.emailsOnDomains(domains, account.userId);
  if (others.some((e) => mailboxKey(e) === key)) return refuse("duplicate_account");

  const r = await deps.affiliates.redeemInvite(code, account.userId);
  if (!r.ok) return refuse(r.reason);
  return { ok: true, inviterId: r.inviterId };
}
