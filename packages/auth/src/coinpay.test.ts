import { createSign, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  coinpayPlaceholderEmail,
  coinpayProvider,
  createAuth,
  isCoinpayPlaceholderEmail,
} from "./server";

/**
 * Sign in with CoinPay end to end against a fake CoinPay (discovery, JWKS,
 * token, userinfo) and Better Auth's memory adapter: the account is bound to
 * the CoinPay `sub`, a CoinPay email never reaches an existing account, and a
 * forged state or a wrong nonce is refused.
 */

const ORIGIN = "https://nightcell7.test";
const ISSUER = "https://coinpay.test";
const CLIENT_ID = "cp_test_client";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function idToken(claims: Record<string, unknown>): string {
  const input = `${b64({ alg: "RS256", kid: "k1", typ: "JWT" })}.${b64(claims)}`;
  const signature = createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url");
  return `${input}.${signature}`;
}

/** What the fake CoinPay answers for the next code exchange. */
let next: { sub: string; email: string; nonce?: string } = { sub: "", email: "" };
let lastAuthorize: URL | null = null;

const realFetch = globalThis.fetch;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function fakeCoinpay(input: string | URL | Request): Promise<Response> {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.origin !== ISSUER) return realFetch(input as Request);
  switch (url.pathname) {
    case "/.well-known/openid-configuration":
      return Promise.resolve(
        json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/api/oauth/authorize`,
          token_endpoint: `${ISSUER}/api/oauth/token`,
          userinfo_endpoint: `${ISSUER}/api/oauth/userinfo`,
          jwks_uri: `${ISSUER}/api/oauth/jwks`,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
    case "/api/oauth/jwks":
      return Promise.resolve(json({ keys: [jwk] }));
    case "/api/oauth/token": {
      const now = Math.floor(Date.now() / 1000);
      return Promise.resolve(
        json({
          access_token: "at",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken({
            iss: ISSUER,
            aud: CLIENT_ID,
            sub: next.sub,
            email: next.email,
            email_verified: false,
            nonce: next.nonce ?? lastAuthorize?.searchParams.get("nonce"),
            iat: now,
            exp: now + 600,
          }),
        }),
      );
    }
    case "/api/oauth/userinfo":
      return Promise.resolve(json({ sub: next.sub, email: next.email, email_verified: false }));
    default:
      return Promise.resolve(new Response("not found", { status: 404 }));
  }
}

const db: Record<string, Record<string, unknown>[]> = {
  user: [],
  session: [],
  account: [],
  verification: [],
  passkey: [],
};
let auth: ReturnType<typeof createAuth>;

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(fakeCoinpay));
  auth = createAuth({
    db: {} as never,
    adapter: memoryAdapter(db),
    secret: "test-secret-test-secret-test-secret-0123",
    publicOrigin: ORIGIN,
    isProduction: false,
    sendEmail: async () => {},
    coinpay: { clientId: CLIENT_ID, clientSecret: "test-client-secret", issuer: ISSUER },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Start a sign-in: the CoinPay URL and the state cookie Better Auth set. */
let caller = 0;
async function start(headers: Record<string, string> = {}, endpoint = "sign-in/social") {
  // A fresh address per start: Better Auth limits sign-in starts per IP.
  headers = { "x-forwarded-for": `198.51.100.${++caller}`, ...headers };
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/v1/auth/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify({
        provider: "coinpay",
        callbackURL: "/account",
        errorCallbackURL: "/login",
      }),
    }),
  );
  const body = (await response.json()) as { url?: string };
  lastAuthorize = body.url ? new URL(body.url) : null;
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { response, authorize: lastAuthorize, cookie };
}

async function callback(state: string, cookie: string) {
  return auth.handler(
    new Request(
      `${ORIGIN}/api/v1/auth/callback/coinpay?code=c1&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie },
      },
    ),
  );
}

const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c?.includes("session_token"));

describe("Sign in with CoinPay", () => {
  it("sends PKCE S256, state and nonce to CoinPay with the exact redirect", async () => {
    const { authorize } = await start();
    expect(authorize?.origin + authorize!.pathname).toBe(`${ISSUER}/api/oauth/authorize`);
    expect(authorize!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize!.searchParams.get("state")).toBeTruthy();
    expect(authorize!.searchParams.get("nonce")).toBeTruthy();
    expect(authorize!.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/v1/auth/callback/coinpay`,
    );
    expect(authorize!.searchParams.get("client_id")).toBe(CLIENT_ID);
  });

  it("a CoinPay login carrying a victim's email gets its own account, bound to the sub", async () => {
    db.user!.push({
      id: "victim",
      email: "victim@example.com",
      emailVerified: true,
      name: "",
      displayName: "victim-0001",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    next = { sub: "attacker-sub", email: "victim@example.com" };
    const { authorize, cookie } = await start();
    const response = await callback(authorize!.searchParams.get("state")!, cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/account");
    expect(sessionCookie(response)).toBeTruthy();

    const account = db.account!.find(
      (a) => a.providerId === "coinpay" && a.accountId === "attacker-sub",
    );
    expect(account).toBeTruthy();
    expect(account!.userId).not.toBe("victim");
    const user = db.user!.find((u) => u.id === account!.userId)!;
    expect(user.email).toBe(coinpayPlaceholderEmail("attacker-sub"));
    expect(user.emailVerified).toBe(false);
    expect(db.account!.some((a) => a.userId === "victim")).toBe(false);

    // the same sub signs into the same account next time
    const again = await start();
    await callback(again.authorize!.searchParams.get("state")!, again.cookie);
    expect(db.account!.filter((a) => a.accountId === "attacker-sub")).toHaveLength(1);
    expect(
      db.user!.filter((u) => u.email === coinpayPlaceholderEmail("attacker-sub")),
    ).toHaveLength(1);
  });

  it("refuses a forged state", async () => {
    next = { sub: "forged-sub", email: "f@example.com" };
    const { cookie } = await start();
    const response = await callback("forged", cookie);
    expect(response.headers.get("location") ?? "").toContain("error");
    expect(sessionCookie(response)).toBeFalsy();
    expect(db.account!.some((a) => a.accountId === "forged-sub")).toBe(false);
  });

  it("refuses an id_token whose nonce does not match", async () => {
    next = { sub: "nonce-sub", email: "n@example.com", nonce: "not-the-nonce" };
    const { authorize, cookie } = await start();
    const response = await callback(authorize!.searchParams.get("state")!, cookie);
    expect(response.headers.get("location") ?? "").toContain("error");
    expect(sessionCookie(response)).toBeFalsy();
    expect(db.account!.some((a) => a.accountId === "nonce-sub")).toBe(false);
  });

  it("linking needs a signed-in session", async () => {
    const { response } = await start({}, "link-social");
    expect(response.status).toBe(401);
  });

  it("the placeholder domain is CoinPay's alone", async () => {
    expect(isCoinpayPlaceholderEmail(coinpayPlaceholderEmail("x"))).toBe(true);
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/v1/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          email: coinpayPlaceholderEmail("someone-else"),
          password: "a-long-enough-password",
          name: "",
          displayName: "squatter",
        }),
      }),
    );
    expect(response.ok).toBe(false);
    expect(db.user!.some((u) => u.email === coinpayPlaceholderEmail("someone-else"))).toBe(false);
  });

  it("maps the CoinPay profile to an unverified placeholder", async () => {
    const mapped = await coinpayProvider({ clientId: "c", clientSecret: "s" }).mapProfileToUser({
      sub: "S-1",
      email: "real@example.com",
      name: "Real Person",
    });
    expect(mapped.email).toBe(coinpayPlaceholderEmail("S-1"));
    expect(mapped.emailVerified).toBe(false);
  });
});
