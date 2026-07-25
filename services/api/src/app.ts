import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  CORRELATION_HEADER,
  type HealthReporter,
  type Logger,
  newCorrelationId,
} from "@nightcell7/observability";
import { SESSION_COOKIE_NAME, canPlayMultiplayer, type AccountContext } from "@nightcell7/auth";
import {
  CATALOG,
  MAX_REMEMBERED_DEVICES,
  OFFLINE_GRACE_DAYS,
  formatPrice,
  hasAccess,
  resolvePrice,
} from "@nightcell7/entitlements";
import { createOfflineLicense } from "@nightcell7/entitlements/server";
import { signManifest, type ContentManifest, type ObjectSigner } from "@nightcell7/content-schema";
import {
  COINPAY_SIGNATURE_HEADER,
  COINPAY_TIMESTAMP_HEADER,
  mapProviderStatus,
  redactEventForLog,
  verifyWebhook,
  type CoinpayClient,
} from "@nightcell7/coinpay";
import {
  CLIENT_PLATFORMS,
  CONTENT_VERSION,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  QUICK_MESSAGES,
} from "@nightcell7/multiplayer-protocol";
import { createTicketId, signTicket } from "@nightcell7/multiplayer-protocol/server";
import { MULTIPLAYER_MAP, TDM_RULES } from "@nightcell7/game-core";
import {
  ApiError,
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  tooManyRequests,
  unauthorized,
} from "./errors";
import type { RateLimitName, RateLimiter } from "./rate-limit";
import type { Repositories } from "./repository";
import type { ApiEnv } from "./env";

/**
 * The centralised API (PRD §29).
 *
 * Everything a browser, PWA or Electron client needs, served from
 * `https://nightcell7.com/api/v1`. No response ever contains an internal
 * Railway hostname — matchmaking returns a public `wss://nightcell7.com/...`
 * URL and nothing else (PRD §29.2).
 */

export interface Dependencies {
  env: ApiEnv;
  logger: Logger;
  health: HealthReporter;
  repos: Repositories;
  rateLimiter: RateLimiter;
  coinpay: CoinpayClient;
  /** Publishes durable work; the API never does heavy work inline (PRD §24.4). */
  enqueue: (queue: string, name: string, payload: unknown) => Promise<void>;
  /** Redis-backed ticket nonce registry, so a ticket can be consumed once. */
  registerTicket: (ticketId: string, ttlSeconds: number) => Promise<void>;
  /** Content manifest loading and per-object R2 signing (PRD §26.4). */
  content: {
    loadManifest: (episodeId: string, version: string) => Promise<ContentManifest | null>;
    sign: ObjectSigner;
  };
  now?: () => Date;
}

type Variables = {
  correlationId: string;
  account: AccountContext | null;
};

export function createApp(deps: Dependencies) {
  const app = new Hono<{ Variables: Variables }>();
  const now = deps.now ?? (() => new Date());
  const isProduction = deps.env.NODE_ENV === "production";

  // ---------------------------------------------------------------- context
  app.use("*", async (c, next) => {
    const correlationId = c.req.header(CORRELATION_HEADER) ?? newCorrelationId();
    c.set("correlationId", correlationId);
    c.header(CORRELATION_HEADER, correlationId);
    // Authenticated API responses are never cached (PRD §22.5, §27.2).
    c.header("cache-control", "no-store");
    await next();
  });

  app.onError((error, c) => {
    const correlationId = c.get("correlationId");
    if (!(error instanceof ApiError)) {
      deps.logger.error("unhandled api error", { correlationId, error: String(error) });
    }
    return errorResponse(c, error, correlationId);
  });

  app.notFound((c) => errorResponse(c, notFound(), c.get("correlationId")));

  /** Resolve the caller's account from the session cookie, if any. */
  app.use("*", async (c, next) => {
    const cookie = c.req.header("cookie") ?? "";
    const token = readCookie(cookie, SESSION_COOKIE_NAME);
    c.set("account", token ? await deps.repos.findAccountBySessionToken(token) : null);
    await next();
  });

  function requireAccount(c: { get: (key: "account") => AccountContext | null }): AccountContext {
    const account = c.get("account");
    if (!account?.userId) throw unauthorized();
    return account;
  }

  async function limit(name: RateLimitName, subject: string): Promise<void> {
    const result = await deps.rateLimiter.consume(name, subject);
    if (!result.allowed) throw tooManyRequests();
  }

  // ----------------------------------------------------------------- health
  app.get("/health/live", (c) => c.json(deps.health.live()));
  app.get("/health/ready", (c) => {
    const body = deps.health.ready();
    return c.json(body, body.status === "ok" ? 200 : 503);
  });

  const v1 = new Hono<{ Variables: Variables }>();

  // ---------------------------------------------------------------- catalog
  v1.get("/catalog", (c) =>
    c.json({
      episodes: CATALOG.map((entry) => ({
        episodeId: entry.episodeId,
        title: entry.title,
        currency: entry.currency,
        unitAmount: entry.unitAmount,
        displayPrice: formatPrice(entry.unitAmount, entry.currency),
        status: entry.status,
        includes: entry.includes,
      })),
    }),
  );

  v1.get("/episodes/:slug", (c) => {
    const entry = CATALOG.find((e) => e.episodeId === c.req.param("slug"));
    if (!entry) throw notFound("unknown_episode", "That episode does not exist.");
    const account = c.get("account");
    return c.json({
      episodeId: entry.episodeId,
      title: entry.title,
      unitAmount: entry.unitAmount,
      displayPrice: formatPrice(entry.unitAmount),
      status: entry.status,
      includes: entry.includes,
      owned: account?.userId ? undefined : false,
    });
  });

  // -------------------------------------------------------------------- me
  v1.get("/me", (c) => {
    const account = c.get("account");
    if (!account?.userId) return c.json({ authenticated: false });
    return c.json({
      authenticated: true,
      userId: account.userId,
      verified: account.verified,
      status: account.status,
    });
  });

  v1.get("/me/entitlements", async (c) => {
    const account = requireAccount(c);
    const rows = await deps.repos.listEntitlements(account.userId!);
    return c.json({
      entitlements: rows.map((row) => ({
        episodeId: row.episodeId,
        status: row.status,
        grantedAt: row.grantedAt,
        active: hasAccess({
          userId: account.userId!,
          episodeId: row.episodeId as never,
          sourceOrderId: "",
          status: row.status as never,
          grantedAt: row.grantedAt,
        }),
      })),
    });
  });

  v1.get("/me/orders", async (c) => {
    const account = requireAccount(c);
    return c.json({ orders: await deps.repos.listOrders(account.userId!) });
  });

  v1.get("/me/devices", async (c) => {
    const account = requireAccount(c);
    return c.json({ devices: await deps.repos.listDevices(account.userId!) });
  });

  v1.delete("/me/devices/:id", async (c) => {
    const account = requireAccount(c);
    const revoked = await deps.repos.revokeDevice(account.userId!, c.req.param("id"));
    if (!revoked) throw notFound("unknown_device", "That device is not on your account.");
    return c.json({ revoked: true });
  });

  // -------------------------------------------------------------- checkout
  const checkoutSchema = z.object({
    episodeId: z.string().min(1).max(64),
    email: z.string().email().optional(),
    idempotencyKey: z.string().min(8).max(128),
  });

  v1.post("/checkout/coinpay", async (c) => {
    const account = c.get("account");
    const body = checkoutSchema.parse(await c.req.json());
    await limit("checkout", account?.userId ?? clientKey(c));

    // The server catalog is the price authority — note the absence of any
    // client-supplied amount (PRD §24.1).
    const price = resolvePrice(body.episodeId);
    if (!price.ok) throw badRequest(price.reason, "That episode cannot be purchased right now.");

    if (account?.userId) {
      const owned = await deps.repos.findEntitlement(account.userId, body.episodeId);
      if (owned && owned.status === "active") {
        throw new ApiError(409, "already_owned", "You already own this episode.");
      }
    }

    const existing = await deps.repos.findOrderByIdempotencyKey(body.idempotencyKey);
    if (existing) {
      return c.json({ orderId: existing.id, status: existing.status, replayed: true });
    }

    const orderId = `ord_${randomUUID()}`;
    await deps.repos.createOrder({
      id: orderId,
      userId: account?.userId ?? null,
      email: body.email ?? null,
      episodeId: body.episodeId,
      currency: price.currency,
      unitAmount: price.unitAmount,
      idempotencyKey: body.idempotencyKey,
    });

    const invoice = await deps.coinpay.createInvoice({
      orderId,
      episodeId: body.episodeId,
      email: body.email,
      idempotencyKey: body.idempotencyKey,
    });
    await deps.repos.attachCoinpayInvoice(orderId, invoice.invoiceId);

    deps.logger.info("checkout created", {
      correlationId: c.get("correlationId"),
      orderId,
      episodeId: body.episodeId,
    });

    return c.json({
      orderId,
      // The buyer goes to CoinPay. The return page shows *pending* only; the
      // webhook is the sole fulfilment trigger (PRD §24.2).
      paymentUrl: invoice.paymentUrl,
      status: "pending",
      expiresAt: invoice.expiresAt,
    });
  });

  v1.post("/checkout/claim", async (c) => {
    const body = z.object({ token: z.string().min(16).max(512) }).parse(await c.req.json());
    const account = requireAccount(c);
    await limit("claim", account.userId!);

    // Claim resolution is durable work with an audit trail, so it is queued
    // rather than performed inline.
    await deps.enqueue("entitlements", "claim", {
      token: body.token,
      userId: account.userId,
      correlationId: c.get("correlationId"),
    });
    return c.json({ status: "processing" }, 202);
  });

  // ------------------------------------------------------- coinpay webhook
  v1.post("/webhooks/coinpay", async (c) => {
    await limit("webhook", "global");

    // The signature covers the RAW body; it must be read as text before any
    // JSON parsing (PRD §24.4).
    const rawBody = await c.req.text();
    const verification = verifyWebhook({
      rawBody,
      signature: c.req.header(COINPAY_SIGNATURE_HEADER),
      timestamp: c.req.header(COINPAY_TIMESTAMP_HEADER),
      secret: deps.env.COINPAY_WEBHOOK_SECRET,
      nowSeconds: Math.floor(now().getTime() / 1000),
    });

    if (!verification.ok) {
      deps.logger.warn("coinpay webhook rejected", {
        correlationId: c.get("correlationId"),
        reason: verification.reason,
      });
      // 400, not 500: the provider should not retry an unverifiable event.
      throw badRequest("invalid_webhook", "Signature verification failed.");
    }

    const event = verification.event;

    // Durably record the event BEFORE acknowledging, under a unique constraint
    // on the provider event id. A replay is a no-op, not a second fulfilment.
    const recorded = await deps.repos.recordPaymentEvent({
      id: `pe_${randomUUID()}`,
      providerEventId: event.id,
      eventType: event.type,
      orderId: event.data.referenceId,
      payloadHash: createHash("sha256").update(rawBody).digest("hex"),
      receivedAt: now().toISOString(),
    });

    if (recorded.duplicate) {
      deps.logger.info("coinpay webhook duplicate ignored", { providerEventId: event.id });
      return c.json({ received: true, duplicate: true });
    }

    // Heavy work is queued so the acknowledgement stays fast (PRD §30.5).
    await deps.enqueue("payments", "coinpay-event", {
      providerEventId: event.id,
      orderId: event.data.referenceId,
      mappedStatus: mapProviderStatus(event.data.status),
      paymentId: event.data.paymentId,
      correlationId: c.get("correlationId"),
    });

    deps.logger.info("coinpay webhook accepted", redactEventForLog(event));
    return c.json({ received: true });
  });

  // --------------------------------------------------------------- content

  /**
   * Require an active entitlement for `episodeId`, or refuse.
   *
   * A suspended entitlement (payment disputed) is treated exactly like no
   * entitlement for content access, while leaving the row intact so it can be
   * restored (PRD §5.6).
   */
  async function requireEntitlement(userId: string, episodeId: string): Promise<void> {
    const entitlement = await deps.repos.findEntitlement(userId, episodeId);
    if (!entitlement || entitlement.status !== "active") {
      throw forbidden("entitlement_required", "Purchase this episode to download it.");
    }
  }

  v1.get("/content/:episode/manifest", async (c) => {
    const account = requireAccount(c);
    const episodeId = c.req.param("episode");
    await requireEntitlement(account.userId!, episodeId);

    const version = await deps.repos.findCurrentEpisodeVersion(episodeId);
    if (!version) {
      throw notFound("no_published_version", "This episode has no published content yet.");
    }

    const manifest = await deps.content.loadManifest(episodeId, version.version);
    if (!manifest) {
      throw notFound("manifest_unavailable", "Content manifest is not available.");
    }

    // Every asset URL is individually signed and short-lived; the manifest
    // itself is entitlement-protected, not just the assets (PRD §26.4).
    const signed = await signManifest({
      manifest,
      hasEntitlement: true,
      sign: deps.content.sign,
      now: now(),
    });

    return c.json(signed);
  });

  const offlineLicenseSchema = z.object({
    deviceId: z.string().min(8).max(128),
    deviceLabel: z.string().max(64).optional(),
    platform: z.enum(CLIENT_PLATFORMS),
  });

  v1.post("/content/:episode/offline-license", async (c) => {
    const account = requireAccount(c);
    const episodeId = c.req.param("episode");
    const body = offlineLicenseSchema.parse(await c.req.json());
    await requireEntitlement(account.userId!, episodeId);

    // Remembered devices are capped, but with a soft policy: no invasive
    // hardware fingerprinting, and the user can revoke from their account
    // page (PRD §26.6).
    const devices = await deps.repos.listDevices(account.userId!);
    const active = devices.filter((d) => !d.revokedAt);
    if (active.length >= MAX_REMEMBERED_DEVICES && !active.some((d) => d.id === body.deviceId)) {
      throw new ApiError(
        409,
        "device_limit_reached",
        "Remove a device from your account before adding another.",
      );
    }

    const nowSeconds = Math.floor(now().getTime() / 1000);
    const license = createOfflineLicense(
      {
        userId: account.userId!,
        episodeId,
        deviceId: body.deviceId,
        contentVersion: CONTENT_VERSION,
      },
      deps.env.AUTH_SECRET,
      nowSeconds,
      OFFLINE_GRACE_DAYS,
    );

    await deps.repos.recordOfflineLicense({
      id: `ol_${randomUUID()}`,
      userId: account.userId!,
      episodeId,
      deviceId: body.deviceId,
      tokenId: license.jti,
      issuedAt: new Date(license.issuedAt * 1000).toISOString(),
      expiresAt: new Date(license.expiresAt * 1000).toISOString(),
      platform: body.platform,
      label: body.deviceLabel ?? body.platform,
    });

    return c.json({
      license: license.token,
      episodeId,
      contentVersion: CONTENT_VERSION,
      issuedAt: new Date(license.issuedAt * 1000).toISOString(),
      // Surfaced so the client can show a clear renewal date rather than
      // failing mysteriously one day (PRD §26.5).
      expiresAt: new Date(license.expiresAt * 1000).toISOString(),
      graceDays: OFFLINE_GRACE_DAYS,
    });
  });

  v1.post("/content/:episode/download-session", async (c) => {
    const account = requireAccount(c);
    const episodeId = c.req.param("episode");
    await requireEntitlement(account.userId!, episodeId);

    const version = await deps.repos.findCurrentEpisodeVersion(episodeId);
    if (!version) throw notFound("no_published_version", "No published content.");

    const sessionId = `dl_${randomUUID()}`;
    await deps.repos.startDownload({
      id: sessionId,
      userId: account.userId!,
      episodeId,
      versionId: version.id,
      platform: c.req.header("x-nightcell-platform") ?? "web",
      startedAt: now().toISOString(),
    });

    return c.json({ sessionId, episodeId, version: version.version });
  });

  // ----------------------------------------------------------- multiplayer
  v1.get("/multiplayer/status", (c) =>
    c.json({
      // Never a fabricated live player count (PRD §20.4). Real counts come from
      // the multiplayer service and carry a timestamp.
      alpha: true,
      mode: TDM_RULES.mode,
      teamSize: TDM_RULES.teamSize,
      maxPlayers: TDM_RULES.maxPlayers,
      map: MULTIPLAYER_MAP.ARDAVAN_YARD,
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      botFillEnabled: true,
      requiresVerifiedAccount: true,
      free: true,
      observedAt: now().toISOString(),
    }),
  );

  v1.get("/multiplayer/regions", (c) =>
    c.json({
      regions: [
        {
          id: deps.env.MULTIPLAYER_REGION,
          shards: [deps.env.MULTIPLAYER_SHARD],
          status: "available",
        },
      ],
      observedAt: now().toISOString(),
    }),
  );

  v1.get("/multiplayer/profile", async (c) => {
    const account = requireAccount(c);
    const profile = await deps.repos.getMultiplayerProfile(account.userId!);
    // V1 statistics are informational and unranked (PRD §25).
    return c.json({ profile, ranked: false });
  });

  v1.get("/multiplayer/history", async (c) => {
    const account = requireAccount(c);
    const limitParam = Number(c.req.query("limit") ?? 20);
    const take = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;
    return c.json({ matches: await deps.repos.listMatchHistory(account.userId!, take) });
  });

  v1.get("/multiplayer/matches/:matchId", async (c) => {
    const account = requireAccount(c);
    const matchId = c.req.param("matchId");
    if (!(await deps.repos.wasInMatch(account.userId!, matchId))) {
      throw notFound("unknown_match", "That match is not in your history.");
    }
    const match = await deps.repos.getMatch(matchId);
    if (!match) throw notFound("unknown_match", "That match is not in your history.");
    return c.json({ match });
  });

  const ticketRequestSchema = z.object({
    mode: z.literal(TDM_RULES.mode).default(TDM_RULES.mode),
    region: z.string().max(32).optional(),
    preferredTeam: z.number().int().min(0).max(1).optional(),
    buildVersion: z.string().min(1).max(64),
    protocolVersion: z.number().int().nonnegative(),
    contentVersion: z.string().min(1).max(32),
    privateCode: z.string().min(4).max(12).optional(),
  });

  /**
   * Mint a one-time match ticket.
   *
   * This is the gate that makes the WSS endpoint safe: session and ban checks
   * happen here, over HTTPS, and the socket only ever sees a short-lived,
   * single-use token (PRD §18.6, §23.3).
   */
  v1.post("/multiplayer/tickets", async (c) => {
    const account = requireAccount(c);
    await limit("ticket", account.userId!);

    const body = ticketRequestSchema.parse(await c.req.json());

    const eligibility = canPlayMultiplayer(account, now());
    if (!eligibility.eligible) {
      throw forbidden(eligibility.reason, multiplayerDenialMessage(eligibility.reason));
    }

    if (
      body.protocolVersion < MIN_SUPPORTED_PROTOCOL_VERSION ||
      body.protocolVersion > PROTOCOL_VERSION
    ) {
      throw new ApiError(426, "update_required", "Update NIGHTCELL 7 to join multiplayer.");
    }
    if (body.contentVersion !== CONTENT_VERSION) {
      throw new ApiError(426, "content_mismatch", "Your game content is out of date.");
    }

    const profile = await deps.repos.getMultiplayerProfile(account.userId!);
    const displayName = profile?.displayName ?? `Operative-${account.userId!.slice(0, 6)}`;

    const region = deps.env.MULTIPLAYER_REGION;
    const shard = deps.env.MULTIPLAYER_SHARD;
    const matchId = `match_${randomUUID()}`;
    const roomId = body.privateCode ? `room_private_${body.privateCode}` : `room_${randomUUID()}`;
    const issuedAt = Math.floor(now().getTime() / 1000);
    const expiresAt = issuedAt + deps.env.TICKET_TTL_SECONDS;
    const ticketId = createTicketId();

    const ticket = signTicket(
      {
        jti: ticketId,
        sub: account.userId!,
        displayName,
        matchId,
        roomId,
        region,
        shard,
        mode: body.mode,
        team: body.preferredTeam,
        minProtocol: MIN_SUPPORTED_PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        iat: issuedAt,
        exp: expiresAt,
      },
      deps.env.TICKET_SECRET,
    );

    await deps.registerTicket(ticketId, deps.env.TICKET_TTL_SECONDS + 30);

    // The client is told the public URL and nothing else. It must never
    // construct or discover an internal Railway address (PRD §18.6).
    const websocketUrl = buildSyncUrl(deps.env.PUBLIC_ORIGIN, region, shard, roomId, ticket);

    return c.json({
      matchId,
      roomId,
      region,
      shard,
      protocolVersion: PROTOCOL_VERSION,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      websocketUrl,
    });
  });

  v1.post("/multiplayer/matchmaking/join", async (c) => {
    const account = requireAccount(c);
    await limit("matchmaking", account.userId!);
    // Quick Match reserves through the same ticket path; the client is told to
    // call /tickets so there is exactly one place session+ban checks happen.
    return c.json({ next: "/api/v1/multiplayer/tickets", queued: false });
  });

  v1.delete("/multiplayer/matchmaking/:ticketId", async (c) => {
    requireAccount(c);
    return c.json({ canceled: true, ticketId: c.req.param("ticketId") });
  });

  v1.post("/multiplayer/private-matches", async (c) => {
    const account = requireAccount(c);
    await limit("privateMatch", account.userId!);
    const eligibility = canPlayMultiplayer(account, now());
    if (!eligibility.eligible) {
      // A private code must never be a way around a ban (PRD §18.13).
      throw forbidden(eligibility.reason, multiplayerDenialMessage(eligibility.reason));
    }
    return c.json({ code: generatePrivateCode(), expiresInSeconds: 900 });
  });

  v1.post("/multiplayer/private-matches/:code/join", async (c) => {
    const account = requireAccount(c);
    await limit("matchmaking", account.userId!);
    const eligibility = canPlayMultiplayer(account, now());
    if (!eligibility.eligible) {
      throw forbidden(eligibility.reason, multiplayerDenialMessage(eligibility.reason));
    }
    return c.json({ next: "/api/v1/multiplayer/tickets", privateCode: c.req.param("code") });
  });

  const reportSchema = z.object({
    reportedUserId: z.string().min(1).max(64),
    matchId: z.string().min(1).max(64),
    category: z.enum(["cheating", "harassment", "inappropriate_name", "griefing", "other"]),
    description: z.string().max(1000).optional(),
  });

  v1.post("/multiplayer/reports", async (c) => {
    const account = requireAccount(c);
    await limit("report", account.userId!);
    const body = reportSchema.parse(await c.req.json());

    if (body.reportedUserId === account.userId) {
      throw badRequest("cannot_report_self", "You cannot report yourself.");
    }
    // Only players who actually shared the match may report it — this is what
    // stops report-bombing a stranger.
    if (!(await deps.repos.wasInMatch(account.userId!, body.matchId))) {
      throw forbidden("not_in_match", "You were not in that match.");
    }

    await deps.repos.createReport({
      id: `rep_${randomUUID()}`,
      reporterUserId: account.userId!,
      reportedUserId: body.reportedUserId,
      matchId: body.matchId,
      category: body.category,
      description: body.description,
    });
    return c.json({ submitted: true }, 201);
  });

  v1.post("/multiplayer/blocks/:userId", async (c) => {
    const account = requireAccount(c);
    const target = c.req.param("userId");
    if (target === account.userId)
      throw badRequest("cannot_block_self", "You cannot block yourself.");
    await deps.repos.addBlock(account.userId!, target);
    return c.json({ blocked: true });
  });

  v1.delete("/multiplayer/blocks/:userId", async (c) => {
    const account = requireAccount(c);
    await deps.repos.removeBlock(account.userId!, c.req.param("userId"));
    return c.json({ blocked: false });
  });

  v1.get("/multiplayer/blocks", async (c) => {
    const account = requireAccount(c);
    return c.json({ blocked: await deps.repos.listBlocks(account.userId!) });
  });

  v1.get("/multiplayer/quick-messages", (c) => c.json({ messages: QUICK_MESSAGES }));

  // ------------------------------------------------------------ misc
  v1.post("/newsletter/subscribe", async (c) => {
    const body = z
      .object({ email: z.string().email(), source: z.string().max(64).default("site") })
      .parse(await c.req.json());
    await limit("newsletter", clientKey(c));
    await deps.repos.subscribeNewsletter(body.email, body.source);
    return c.json({ subscribed: true }, 202);
  });

  v1.post("/feedback", async (c) => {
    const account = c.get("account");
    await limit("feedback", account?.userId ?? clientKey(c));
    const body = z
      .object({
        buildVersion: z.string().min(1).max(64),
        category: z.string().min(1).max(64),
        message: z.string().min(1).max(4000),
        episodeId: z.string().max(64).optional(),
        side: z.enum(["rook", "leila"]).optional(),
        multiplayerMatchId: z.string().max(64).optional(),
      })
      .parse(await c.req.json());

    await deps.repos.createFeedback({
      id: `fb_${randomUUID()}`,
      userId: account?.userId ?? null,
      ...body,
    });
    return c.json({ received: true }, 201);
  });

  app.route("/api/v1", v1);

  // Version metadata for support and diagnostics.
  app.get("/api/v1/version", (c) =>
    c.json({
      build: deps.env.BUILD_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      environment: isProduction ? "production" : deps.env.NODE_ENV,
    }),
  );

  return app;
}

// ---------------------------------------------------------------- helpers

export function buildSyncUrl(
  publicOrigin: string,
  region: string,
  shard: string,
  roomId: string,
  ticket: string,
): string {
  const origin = new URL(publicOrigin);
  const scheme = origin.protocol === "https:" ? "wss:" : "ws:";
  const path = `/api/v1/multiplayer/sync/${encodeURIComponent(region)}/${encodeURIComponent(shard)}/${encodeURIComponent(roomId)}`;
  return `${scheme}//${origin.host}${path}?ticket=${encodeURIComponent(ticket)}`;
}

function multiplayerDenialMessage(reason: string): string {
  switch (reason) {
    case "account_required":
      return "Create a free account to play multiplayer.";
    case "account_unverified":
      return "Verify your email to play multiplayer.";
    default:
      return "Your account cannot join multiplayer right now.";
  }
}

export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Rate-limit subject for unauthenticated callers. */
function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  // Set by the gateway, which strips any client-supplied value first.
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const PRIVATE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePrivateCode(length = 6): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += PRIVATE_CODE_ALPHABET[byte % PRIVATE_CODE_ALPHABET.length];
  }
  return code;
}
