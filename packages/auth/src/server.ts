import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
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

    database: drizzleAdapter(config.db, {
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
          before: async (user) => {
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

    plugins: [
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
