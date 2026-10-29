import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { passkey } from "@better-auth/passkey";
import type { Database } from "@nightcell7/database";
import { accounts, passkeys, sessions, users, verifications } from "@nightcell7/database";
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from "./index.js";

/**
 * Better Auth instance.
 *
 * Server-only entry point (`@nightcell7/auth/server`) — the site imports the
 * rules from the main entry and never this.
 *
 * Better Auth owns credentials, hashing, sessions and verification tokens. The
 * product rules layered on top (multiplayer eligibility, display-name policy,
 * guest claim) stay in the main entry so they can be unit tested without a
 * database.
 */

export interface AuthConfig {
  db: Database;
  secret: string;
  /** Canonical public origin, e.g. https://nightcell7.com */
  publicOrigin: string;
  isProduction: boolean;
  /**
   * Queues a transactional email. Injected so the auth package never depends
   * on Resend or the queue directly, and so tests can assert on what would be
   * sent without sending anything.
   */
  sendEmail: (job: AuthEmail) => Promise<void>;
  /**
   * Sign in with CoinPay (a confidential OIDC client). Absent, the provider is
   * not registered and the site hides its buttons.
   */
  coinpay?: CoinpaySignInConfig | null;
  /** Tests only: a Better Auth adapter in place of the Drizzle one over `db`. */
  adapter?: BetterAuthOptions["database"];
}

export interface CoinpaySignInConfig {
  clientId: string;
  clientSecret: string;
  /** CoinPay origin; discovery is read from /.well-known/openid-configuration. */
  issuer?: string;
}

/** The provider id: callback is /api/v1/auth/callback/coinpay. */
export const COINPAY_PROVIDER_ID = "coinpay";

/** Address domain of accounts made by a CoinPay sign-in (never deliverable). */
export const COINPAY_PLACEHOLDER_DOMAIN = "coinpay.nightcell7.invalid";

/**
 * The account email of a CoinPay-only account. CoinPay never verifies email
 * addresses, so its email is never used as ours: matching on it would let
 * anyone register CoinPay with your address and sign into your account.
 */
export function coinpayPlaceholderEmail(sub: string): string {
  return `${sub.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@${COINPAY_PLACEHOLDER_DOMAIN}`;
}

export function isCoinpayPlaceholderEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase().endsWith(`@${COINPAY_PLACEHOLDER_DOMAIN}`);
}

/**
 * Better Auth's generic OAuth provider for CoinPay: discovery, PKCE S256,
 * state, nonce bound to the id_token, id_token verified against CoinPay's JWKS,
 * and the account bound to the CoinPay `sub` (accounts.provider_id = coinpay,
 * account_id = sub). The profile maps to an unverified placeholder email, so a
 * CoinPay sign-in can never match an existing account by email.
 */
export function coinpayProvider(config: CoinpaySignInConfig) {
  const issuer = (config.issuer ?? "https://coinpayportal.com").replace(/\/+$/, "");
  return {
    providerId: COINPAY_PROVIDER_ID,
    name: "CoinPay",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    scopes: ["openid", "profile", "email"],
    pkce: true,
    requireIdTokenVerification: true,
    accountSubject: ({ profile }: { profile: Record<string, unknown> }) =>
      String(profile.sub ?? ""),
    // Never refresh the account's email or name from CoinPay on later sign-ins.
    overrideUserInfo: false,
    mapProfileToUser: (profile: Record<string, unknown>) => {
      const sub = String(profile.sub ?? "");
      const name = typeof profile.name === "string" ? profile.name : "";
      return {
        email: coinpayPlaceholderEmail(sub),
        emailVerified: false,
        name,
        displayName: defaultDisplayName(`${name.replace(/\s+/g, "") || "player"}@x`),
      };
    },
  };
}

export type AuthEmail =
  | { kind: "verify-email"; to: string; verifyUrl: string }
  | { kind: "password-reset"; to: string; resetUrl: string }
  | { kind: "magic-link"; to: string; signInUrl: string };

/** How long an emailed sign-in link works. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

/**
 * A display name for an account created by a magic link or passkey, where no
 * signup form asked for one. Derived from the email's local part so it reads
 * like the person, with a random suffix because display names are unique.
 * Always satisfies `displayNameSchema`; the player can change it later.
 */
export function defaultDisplayName(email: string, random: () => number = Math.random): string {
  const local = (email.split("@")[0] ?? "")
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .replace(/^[^A-Za-z0-9]+/, "");
  const base = (local || "player").slice(0, DISPLAY_NAME_MAX - 5);
  const suffix = String(Math.floor(random() * 10_000)).padStart(4, "0");
  const name = `${base}-${suffix}`;
  return name.length >= DISPLAY_NAME_MIN ? name : `player-${suffix}`;
}

/**
 * Provider tokens Better Auth writes to `accounts` on every social sign-in.
 *
 * Nothing in NIGHTCELL 7 calls a provider API on a player's behalf, so these
 * are never needed after sign-in, and a plaintext refresh token sitting in our
 * database is a standing credential for an attacker with database access.
 * Sign-in today is email+password, magic link and passkey (no social provider),
 * so these columns are always NULL; this keeps them NULL if one is ever added.
 * A feature that genuinely needs a provider token must seal it under a
 * user-derived key (@profullstack/sealed-secrets), not store it here.
 */
const OAUTH_TOKEN_FIELDS = [
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
] as const;

/** Returns the account record with every provider token set to null. */
export function stripOAuthTokens<T extends Record<string, unknown>>(account: T): T {
  const out: Record<string, unknown> = { ...account };
  for (const field of OAUTH_TOKEN_FIELDS) {
    if (field in out) out[field] = null;
  }
  return out as T;
}

export function createAuth(config: AuthConfig) {
  const options = {
    appName: "NIGHTCELL 7",
    secret: config.secret,
    baseURL: config.publicOrigin,
    // Everything the browser talks to lives under /api/v1 (PRD §29).
    basePath: "/api/v1/auth",

    database:
      config.adapter ??
      drizzleAdapter(config.db, {
        provider: "pg",
        // Our tables are plural; Better Auth's models are singular.
        schema: {
          user: users,
          session: sessions,
          account: accounts,
          verification: verifications,
          passkey: passkeys,
        },
      }),

    databaseHooks: {
      account: {
        // Never persist social-login provider tokens (see stripOAuthTokens).
        create: {
          before: async (account) => ({ data: stripOAuthTokens(account) }),
        },
        update: {
          before: async (account) => ({ data: stripOAuthTokens(account) }),
        },
      },
      user: {
        create: {
          // The email+password signup form asks for a display name; a magic
          // link or passkey signup does not, and the column is NOT NULL.
          before: async (user, context) => {
            // The placeholder domain belongs to CoinPay sign-ins: nobody can
            // sign up (password or magic link) with it and squat a sub.
            if (
              isCoinpayPlaceholderEmail(user.email) &&
              !String(context?.path ?? "").startsWith("/callback/")
            ) {
              return false;
            }
            const record = user as typeof user & { displayName?: string | null };
            if (record.displayName) return { data: record };
            return { data: { ...record, displayName: defaultDisplayName(record.email) } };
          },
        },
      },
    },

    emailAndPassword: {
      enabled: true,
      // A verified email is what multiplayer eligibility is built on
      // (PRD §23.1), so sign-in is gated on it rather than checked later.
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      sendResetPassword: async ({ user, url }) => {
        await config.sendEmail({ kind: "password-reset", to: user.email, resetUrl: url });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await config.sendEmail({ kind: "verify-email", to: user.email, verifyUrl: url });
      },
    },

    user: {
      additionalFields: {
        // The in-game name. Distinct from Better Auth's `name`, which is a
        // real name field we do not ask for.
        displayName: {
          type: "string",
          required: true,
          input: true,
        },
        status: {
          type: "string",
          required: false,
          defaultValue: "active",
          // Never settable from a signup payload — that would let anyone
          // register themselves as unbanned or privileged.
          input: false,
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },

    advanced: {
      useSecureCookies: config.isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
    },

    // Only our own origin may drive the auth endpoints.
    trustedOrigins: [config.publicOrigin],

    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
    },

    account: {
      accountLinking: {
        enabled: true,
        // Never link a sign-in to an existing account by email. A CoinPay
        // identity joins an existing account only through link-social, which
        // needs that account's session.
        disableImplicitLinking: true,
        // link-social from a signed-in session: CoinPay's (placeholder) email
        // never equals the account's, and CoinPay never says verified.
        allowDifferentEmails: true,
        trustedProviders: config.coinpay ? [COINPAY_PROVIDER_ID] : [],
        updateUserInfoOnLink: false,
      },
    },

    plugins: [
      ...(config.coinpay ? [genericOAuth({ config: [coinpayProvider(config.coinpay)] })] : []),
      // The house sign-in: the link proves the address, and the address is
      // the account, so the same link signs a new buyer up.
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        sendMagicLink: async ({ email, url }) => {
          await config.sendEmail({ kind: "magic-link", to: email, signInUrl: url });
        },
      }),
      passkey({
        rpID: new URL(config.publicOrigin).hostname,
        rpName: "NIGHTCELL 7",
        origin: config.publicOrigin,
      }),
    ],
  } satisfies BetterAuthOptions;

  return betterAuth(options);
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Signup payload validation.
 *
 * Better Auth validates its own fields; this covers the display name so a
 * rejected name fails before an account row is attempted.
 */
export const signUpFields = {
  displayNameMin: DISPLAY_NAME_MIN,
  displayNameMax: DISPLAY_NAME_MAX,
};
