import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "@nightcell7/database";
import { accounts, sessions, users, verifications } from "@nightcell7/database";
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
  | { kind: "password-reset"; to: string; resetUrl: string };

export function createAuth(config: AuthConfig) {
  const options = {
    appName: "NIGHTCELL 7",
    secret: config.secret,
    baseURL: config.publicOrigin,
    // Everything the browser talks to lives under /api/v1 (PRD §29).
    basePath: "/api/v1/auth",

    database: drizzleAdapter(config.db, {
      provider: "sqlite",
      // Our tables are plural; Better Auth's models are singular.
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),

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
