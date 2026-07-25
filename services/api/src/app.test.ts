import { describe, expect, it, beforeEach } from "vitest";
import { HealthReporter, createLogger } from "@nightcell7/observability";
import { SESSION_COOKIE_NAME } from "@nightcell7/auth";
import {
  COINPAY_SIGNATURE_HEADER,
  COINPAY_TIMESTAMP_HEADER,
  signWebhookPayload,
} from "@nightcell7/coinpay";
import { CONTENT_VERSION, PROTOCOL_VERSION } from "@nightcell7/multiplayer-protocol";
import { verifyTicket } from "@nightcell7/multiplayer-protocol/server";
import { createApp, buildSyncUrl, generatePrivateCode, readCookie } from "./app";
import type { Dependencies } from "./app";
import { MemoryRateLimiter } from "./rate-limit";
import type { Repositories } from "./repository";
import type { ContentManifest } from "@nightcell7/content-schema";
import type { ApiEnv } from "./env";

const TICKET_SECRET = "ticket-secret-for-tests-0000000";
const WEBHOOK_SECRET = "webhook-secret-for-tests-000000";

const env: ApiEnv = {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "https://nightcell7.com",
  BUILD_VERSION: "0.1.0-test",
  LOG_LEVEL: "error",
  API_PORT: 3001,
  AUTH_SECRET: "auth-secret-for-tests-000000000",
  TICKET_SECRET,
  TICKET_TTL_SECONDS: 45,
  MATCH_RESULT_SECRET: "match-result-secret-for-tests-0",
  REDIS_URL: "redis://localhost:6379",
  TURSO_DATABASE_URL: "file:memory",
  COINPAY_API_BASE: "https://api.coinpayportal.test",
  COINPAY_API_KEY: "key",
  COINPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  R2_BUCKET: "nightcell7-content-test",
  MULTIPLAYER_REGION: "us-west",
  MULTIPLAYER_SHARD: "1",
};

/** Minimal in-memory repositories: enough to exercise every guard. */
function fakeRepos(overrides: Partial<Repositories> = {}): Repositories {
  const seenEvents = new Set<string>();
  const base: Repositories = {
    async findAccountBySessionToken(token) {
      if (token === "verified") {
        return { userId: "u_verified", verified: true, status: "active" };
      }
      if (token === "unverified") {
        return { userId: "u_unverified", verified: false, status: "active" };
      }
      if (token === "banned") {
        return {
          userId: "u_banned",
          verified: true,
          status: "active",
          multiplayerBannedUntil: "2099-01-01T00:00:00.000Z",
        };
      }
      return null;
    },
    async listEntitlements() {
      return [];
    },
    async findEntitlement() {
      return null;
    },
    async findOrderByIdempotencyKey() {
      return null;
    },
    async createOrder() {},
    async attachCoinpayInvoice() {},
    async listOrders() {
      return [];
    },
    async recordPaymentEvent(input) {
      if (seenEvents.has(input.providerEventId)) return { duplicate: true };
      seenEvents.add(input.providerEventId);
      return { duplicate: false };
    },
    async listDevices() {
      return [];
    },
    async revokeDevice() {
      return true;
    },
    async getMultiplayerProfile() {
      return null;
    },
    async listMatchHistory() {
      return [];
    },
    async getMatch() {
      return null;
    },
    async wasInMatch(_userId, matchId) {
      return matchId === "match_shared";
    },
    async createReport() {},
    async addBlock() {},
    async removeBlock() {},
    async listBlocks() {
      return [];
    },
    async subscribeNewsletter() {},
    async createFeedback() {},
    async findCurrentEpisodeVersion() {
      return null;
    },
    async recordOfflineLicense() {},
    async startDownload() {},
  };
  return { ...base, ...overrides };
}

interface Harness {
  app: ReturnType<typeof createApp>;
  enqueued: { queue: string; name: string; payload: unknown }[];
  invoices: number;
  tickets: string[];
}

function harness(
  repoOverrides: Partial<Repositories> = {},
  manifest: ContentManifest | null = null,
): Harness {
  const enqueued: Harness["enqueued"] = [];
  const tickets: string[] = [];
  const state = { invoices: 0 };

  const coinpay = {
    createInvoice: async () => {
      state.invoices += 1;
      return {
        invoiceId: `inv_${state.invoices}`,
        paymentUrl: "https://pay.coinpayportal.test/inv_1",
        status: "pending",
      };
    },
    getInvoice: async () => ({ status: "pending" }),
    refund: async () => ({ status: "refunded" }),
  } as unknown as Dependencies["coinpay"];

  const app = createApp({
    env,
    logger: createLogger({ service: "api-test", level: "error", sink: () => {} }),
    health: new HealthReporter("api", env.BUILD_VERSION, PROTOCOL_VERSION),
    repos: fakeRepos(repoOverrides),
    rateLimiter: new MemoryRateLimiter(),
    coinpay,
    enqueue: async (queue, name, payload) => {
      enqueued.push({ queue, name, payload });
    },
    registerTicket: async (ticketId) => {
      tickets.push(ticketId);
    },
    content: {
      loadManifest: async () => manifest,
      sign: async (key, ttl) => `https://r2.test/${key}?ttl=${ttl}`,
    },
  });

  return {
    app,
    enqueued,
    tickets,
    get invoices() {
      return state.invoices;
    },
  };
}

function authed(token: string): RequestInit {
  return { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } };
}

function jsonPost(body: unknown, token?: string): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.cookie = `${SESSION_COOKIE_NAME}=${token}`;
  return { method: "POST", headers, body: JSON.stringify(body) };
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe("catalog", () => {
  it("publishes the $9.99 price from the server catalog", async () => {
    const res = await h.app.request("/api/v1/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      episodes: {
        episodeId: string;
        unitAmount: number;
        displayPrice: string;
        includes: string[];
      }[];
    };
    const episode = body.episodes.find((e) => e.episodeId === "false-dawn");
    expect(episode?.unitAmount).toBe(999);
    expect(episode?.displayPrice).toBe("$9.99");
    expect(episode?.includes).toContain("complete-truth");
  });

  it("marks every API response no-store", async () => {
    const res = await h.app.request("/api/v1/catalog");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("authentication gates", () => {
  it("reports an anonymous caller without failing", async () => {
    const res = await h.app.request("/api/v1/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("requires a session for entitlements, orders and devices", async () => {
    for (const path of ["/api/v1/me/entitlements", "/api/v1/me/orders", "/api/v1/me/devices"]) {
      const res = await h.app.request(path);
      expect(res.status, path).toBe(401);
    }
  });

  it("returns a machine-readable error code", async () => {
    const res = await h.app.request("/api/v1/me/entitlements");
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });
});

describe("checkout", () => {
  it("creates one order and one invoice, and never accepts a client amount", async () => {
    const res = await h.app.request(
      "/api/v1/checkout/coinpay",
      // A client trying to set its own price: the field is simply not read.
      jsonPost(
        { episodeId: "false-dawn", idempotencyKey: "idem-key-1", unitAmount: 1, amount: 1 },
        "verified",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paymentUrl: string; status: string };
    expect(body.status).toBe("pending");
    expect(body.paymentUrl).toContain("coinpayportal");
    expect(h.invoices).toBe(1);
  });

  it("replays an existing order for a repeated idempotency key", async () => {
    const replayHarness = harness({
      async findOrderByIdempotencyKey() {
        return { id: "ord_existing", status: "pending" };
      },
    });
    const res = await replayHarness.app.request(
      "/api/v1/checkout/coinpay",
      jsonPost({ episodeId: "false-dawn", idempotencyKey: "idem-key-1" }, "verified"),
    );
    const body = (await res.json()) as { orderId: string; replayed: boolean };
    expect(body).toEqual({ orderId: "ord_existing", status: "pending", replayed: true });
    // No second invoice was created.
    expect(replayHarness.invoices).toBe(0);
  });

  it("refuses to sell an episode the account already owns", async () => {
    const owned = harness({
      async findEntitlement() {
        return { status: "active" };
      },
    });
    const res = await owned.app.request(
      "/api/v1/checkout/coinpay",
      jsonPost({ episodeId: "false-dawn", idempotencyKey: "idem-key-2" }, "verified"),
    );
    expect(res.status).toBe(409);
  });

  it("rejects an unknown episode", async () => {
    const res = await h.app.request(
      "/api/v1/checkout/coinpay",
      jsonPost({ episodeId: "not-real", idempotencyKey: "idem-key-3" }, "verified"),
    );
    expect(res.status).toBe(400);
  });
});

describe("coinpay webhook", () => {
  function webhookRequest(
    eventId: string,
    secret = WEBHOOK_SECRET,
    at = Math.floor(Date.now() / 1000),
  ) {
    const body = JSON.stringify({
      id: eventId,
      type: "payment.completed",
      createdAt: new Date(at * 1000).toISOString(),
      data: { referenceId: "ord_1", paymentId: "pay_1", status: "paid" },
    });
    return new Request("https://nightcell7.com/api/v1/webhooks/coinpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [COINPAY_TIMESTAMP_HEADER]: String(at),
        [COINPAY_SIGNATURE_HEADER]: signWebhookPayload(body, at, secret),
      },
      body,
    });
  }

  it("accepts a valid event and queues fulfilment instead of doing it inline", async () => {
    const res = await h.app.fetch(webhookRequest("evt_a"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    const job = h.enqueued.find((e) => e.queue === "payments");
    expect(job).toBeDefined();
    expect(job?.payload).toMatchObject({ providerEventId: "evt_a", mappedStatus: "paid" });
  });

  it("treats a replayed provider event as a no-op", async () => {
    await h.app.fetch(webhookRequest("evt_b"));
    const before = h.enqueued.length;

    const res = await h.app.fetch(webhookRequest("evt_b"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    // Crucially, no second fulfilment job.
    expect(h.enqueued.length).toBe(before);
  });

  it("rejects an event signed with the wrong secret and queues nothing", async () => {
    const res = await h.app.fetch(webhookRequest("evt_c", "the-wrong-secret-value-000000"));
    expect(res.status).toBe(400);
    expect(h.enqueued).toHaveLength(0);
  });
});

describe("multiplayer tickets", () => {
  const validBody = {
    mode: "tdm",
    buildVersion: "0.1.0-test",
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
  };

  it("mints a one-time ticket for a verified account", async () => {
    const res = await h.app.request("/api/v1/multiplayer/tickets", jsonPost(validBody, "verified"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { websocketUrl: string; matchId: string };

    // The URL is the public origin — never an internal Railway host.
    expect(body.websocketUrl).toMatch(
      /^wss:\/\/nightcell7\.com\/api\/v1\/multiplayer\/sync\/us-west\/1\/room_/,
    );
    expect(body.websocketUrl).not.toMatch(/railway|internal|\.up\./);

    // The ticket is registered for single-use consumption.
    expect(h.tickets).toHaveLength(1);

    const ticket = new URL(body.websocketUrl).searchParams.get("ticket");
    expect(ticket).toBeTruthy();
    const verified = verifyTicket(ticket!, TICKET_SECRET, Math.floor(Date.now() / 1000));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.sub).toBe("u_verified");
    expect(verified.claims.matchId).toBe(body.matchId);
    // A ticket carries no payment or session credential (PRD §23.3).
    const serialized = JSON.stringify(verified.claims);
    expect(serialized).not.toContain("coinpay");
    expect(serialized).not.toContain(env.AUTH_SECRET);
  });

  it("issues a ticket that expires within the configured TTL", async () => {
    const res = await h.app.request("/api/v1/multiplayer/tickets", jsonPost(validBody, "verified"));
    const body = (await res.json()) as { expiresAt: string };
    const ttlSeconds = (new Date(body.expiresAt).getTime() - Date.now()) / 1000;
    expect(ttlSeconds).toBeLessThanOrEqual(env.TICKET_TTL_SECONDS + 2);
    expect(ttlSeconds).toBeGreaterThan(0);
  });

  it("refuses anonymous, unverified and banned accounts", async () => {
    const anonymous = await h.app.request("/api/v1/multiplayer/tickets", jsonPost(validBody));
    expect(anonymous.status).toBe(401);

    const unverified = await h.app.request(
      "/api/v1/multiplayer/tickets",
      jsonPost(validBody, "unverified"),
    );
    expect(unverified.status).toBe(403);
    expect(((await unverified.json()) as { error: { code: string } }).error.code).toBe(
      "account_unverified",
    );

    const banned = await h.app.request(
      "/api/v1/multiplayer/tickets",
      jsonPost(validBody, "banned"),
    );
    expect(banned.status).toBe(403);
    expect(((await banned.json()) as { error: { code: string } }).error.code).toBe(
      "account_banned",
    );
  });

  it("tells an out-of-date client to update instead of failing opaquely", async () => {
    const oldProtocol = await h.app.request(
      "/api/v1/multiplayer/tickets",
      jsonPost({ ...validBody, protocolVersion: PROTOCOL_VERSION + 1 }, "verified"),
    );
    expect(oldProtocol.status).toBe(426);
    expect(((await oldProtocol.json()) as { error: { code: string } }).error.code).toBe(
      "update_required",
    );

    const badContent = await h.app.request(
      "/api/v1/multiplayer/tickets",
      jsonPost({ ...validBody, contentVersion: "0.0.1" }, "verified"),
    );
    expect(badContent.status).toBe(426);
    expect(((await badContent.json()) as { error: { code: string } }).error.code).toBe(
      "content_mismatch",
    );
  });

  it("does not let a private match code bypass a ban", async () => {
    const create = await h.app.request(
      "/api/v1/multiplayer/private-matches",
      jsonPost({}, "banned"),
    );
    expect(create.status).toBe(403);

    const join = await h.app.request(
      "/api/v1/multiplayer/private-matches/ABC123/join",
      jsonPost({}, "banned"),
    );
    expect(join.status).toBe(403);
  });
});

describe("multiplayer status and moderation", () => {
  it("never reports a fabricated live player count", async () => {
    const res = await h.app.request("/api/v1/multiplayer/status");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("playersOnline");
    expect(body).not.toHaveProperty("liveePlayers");
    expect(body.free).toBe(true);
    expect(body.requiresVerifiedAccount).toBe(true);
    // Any operational metric carries a timestamp (PRD §20.4).
    expect(typeof body.observedAt).toBe("string");
  });

  it("only accepts a report from someone who was in that match", async () => {
    const stranger = await h.app.request(
      "/api/v1/multiplayer/reports",
      jsonPost(
        { reportedUserId: "u_other", matchId: "match_not_mine", category: "cheating" },
        "verified",
      ),
    );
    expect(stranger.status).toBe(403);

    const participant = await h.app.request(
      "/api/v1/multiplayer/reports",
      jsonPost(
        { reportedUserId: "u_other", matchId: "match_shared", category: "cheating" },
        "verified",
      ),
    );
    expect(participant.status).toBe(201);
  });

  it("refuses self-report and self-block", async () => {
    const selfReport = await h.app.request(
      "/api/v1/multiplayer/reports",
      jsonPost(
        { reportedUserId: "u_verified", matchId: "match_shared", category: "cheating" },
        "verified",
      ),
    );
    expect(selfReport.status).toBe(400);

    const selfBlock = await h.app.request(
      "/api/v1/multiplayer/blocks/u_verified",
      jsonPost({}, "verified"),
    );
    expect(selfBlock.status).toBe(400);
  });

  it("hides a match the caller did not play in", async () => {
    const res = await h.app.request(
      "/api/v1/multiplayer/matches/match_not_mine",
      authed("verified"),
    );
    expect(res.status).toBe(404);
  });

  it("exposes only the bounded quick-message vocabulary", async () => {
    const res = await h.app.request("/api/v1/multiplayer/quick-messages");
    const body = (await res.json()) as { messages: string[] };
    expect(body.messages.length).toBeLessThanOrEqual(8);
    expect(body.messages).toContain("enemy_spotted");
  });
});

describe("content gating", () => {
  it("blocks a paid manifest without an active entitlement", async () => {
    const res = await h.app.request("/api/v1/content/false-dawn/manifest", authed("verified"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "entitlement_required",
    );
  });
});

describe("helpers", () => {
  it("builds a wss sync URL from an https origin", () => {
    const url = buildSyncUrl("https://nightcell7.com", "us-west", "1", "room_a", "tkt");
    expect(url).toBe("wss://nightcell7.com/api/v1/multiplayer/sync/us-west/1/room_a?ticket=tkt");
  });

  it("builds a ws URL for local development", () => {
    expect(buildSyncUrl("http://localhost:8080", "dev", "1", "r", "t")).toMatch(
      /^ws:\/\/localhost:8080\/api\/v1\/multiplayer\/sync\//,
    );
  });

  it("reads a session cookie out of a multi-cookie header", () => {
    expect(readCookie("a=1; nc7_session=abc; b=2", "nc7_session")).toBe("abc");
    expect(readCookie("a=1", "nc7_session")).toBeNull();
  });

  it("generates unambiguous private codes", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generatePrivateCode();
      expect(code).toHaveLength(6);
      // No 0/O/1/I confusion when a player reads a code aloud.
      expect(code).not.toMatch(/[01OI]/);
    }
  });
});
