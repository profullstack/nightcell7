import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  CORRELATION_HEADER,
  type HealthReporter,
  type Logger,
  newCorrelationId,
} from "@nightcell7/observability";
import { canPlayMultiplayer, type AccountContext } from "@nightcell7/auth";
import {
  COLUMNS as PROFILE_COLUMNS,
  mountProfileRoutes,
  saveSignupProfile,
  validateProfile,
  type ProfileStore,
} from "@profullstack/profile";
import {
  CATALOG,
  MAX_REMEMBERED_DEVICES,
  OFFLINE_GRACE_DAYS,
  formatPrice,
  hasAccess,
  resolvePrice,
} from "@nightcell7/entitlements";
import {
  createClaimToken,
  createOfflineLicense,
  describeClaim,
  readClaimTokenIgnoringExpiry,
  type ClaimStatus,
} from "@nightcell7/entitlements/server";
import { signManifest, type ContentManifest, type ObjectSigner } from "@nightcell7/content-schema";
import {
  COINPAY_SIGNATURE_HEADER,
  COINPAY_TIMESTAMP_HEADER,
  CoinpayError,
  mapEventStatus,
  paymentUrlForRef,
  redactEventForLog,
  refsForCoinpayId,
  verifyWebhook,
  type CoinpayClient,
} from "@nightcell7/coinpay";
import {
  CLIENT_PLATFORMS,
  CONTENT_VERSION,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  MULTIPLAYER_SYNC_PATH,
  PROTOCOL_VERSION,
  QUICK_MATCH_LOBBY,
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
import { acceptInvite, redeemCode, type CreditsDeps } from "./credits";
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
  /**
   * Better Auth handler. Owns credentials, sessions and verification; the
   * product rules around it live in @nightcell7/auth.
   */
  auth: {
    handler: (request: Request) => Promise<Response>;
    /**
     * Resolves the caller from request headers.
     *
     * Delegated to Better Auth rather than reading a cookie ourselves: it owns
     * the cookie name, signing and rotation, and a hand-rolled lookup silently
     * saw nobody as signed in when those did not match.
     */
    getSession: (
      headers: Headers,
    ) => Promise<{ userId: string; verified: boolean; email?: string | null } | null>;
  };
  /**
   * The signup profile (@profullstack/profile, table `user_profiles`). Absent,
   * the signup form's profile fields are still validated but not stored, and
   * `/api/v1/me/profile` is not mounted.
   */
  profiles?: ProfileStore;
  /**
   * Gift codes (an episode) and invites. Absent, those routes are not mounted.
   * Minting is staff-only and has no route: services/api/scripts/mint-credit-code.ts.
   */
  credits?: CreditsDeps;
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

  /** Resolve the caller's account, if any. */
  app.use("*", async (c, next) => {
    const session = await deps.auth.getSession(c.req.raw.headers);
    if (!session) {
      c.set("account", null);
      await next();
      return;
    }

    // Identity and verification come from the session; account status and ban
    // state are ours and must be read fresh, so a ban applies immediately
    // rather than at the next sign-in.
    const account = await deps.repos.findAccountById(session.userId);
    c.set("account", account ? { ...account, verified: session.verified } : null);
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

  /**
   * Better Auth owns everything under /api/v1/auth.
   *
   * Mounted before the v1 router so its routes are not shadowed, and given the
   * raw Request because it does its own cookie and body handling.
   */
  /**
   * Email+password signup also takes the house signup profile (first and last
   * name required; company domain, job title and LinkedIn optional). Checked
   * before Better Auth sees the request, so a refused form creates no account,
   * then stripped so Better Auth only gets the fields it owns, and saved once
   * the user row exists. A failed save never fails the signup: the account
   * page can fill it in. Magic-link and passkey signups are not asked.
   */
  app.post("/api/v1/auth/sign-up/email", async (c) => {
    const raw = c.req.raw;
    const body = (await raw
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return deps.auth.handler(raw);

    const check = validateProfile(body);
    if (!check.ok) {
      return c.json(
        {
          code: "INVALID_PROFILE",
          message: "A few of those fields need another look.",
          errors: check.errors,
        },
        400,
      );
    }

    const forwarded = { ...body };
    for (const column of PROFILE_COLUMNS) if (column !== "email") delete forwarded[column];
    const headers = new Headers(raw.headers);
    headers.delete("content-length");
    const response = await deps.auth.handler(
      new Request(raw.url, { method: "POST", headers, body: JSON.stringify(forwarded) }),
    );

    if (response.ok && deps.profiles) {
      const created = (await response
        .clone()
        .json()
        .catch(() => null)) as { user?: { id?: string; email?: string } } | null;
      const userId = created?.user?.id;
      try {
        // Only for a row that really exists: never a stand-in user.
        if (userId && (await deps.repos.findAccountById(userId))) {
          await saveSignupProfile(deps.profiles, userId, check.profile, {
            email: created?.user?.email ?? null,
          });
        }
      } catch (error) {
        deps.logger.error("signup profile not saved", { error: String(error) });
      }
    }
    return response;
  });

  app.on(["GET", "POST"], "/api/v1/auth/*", (c) => deps.auth.handler(c.req.raw));

  // GET / PUT / PATCH /api/v1/me/profile: the signed-in player's own profile.
  if (deps.profiles) {
    mountProfileRoutes(app, {
      store: deps.profiles,
      getUser: async (request: Request) => {
        const session = await deps.auth.getSession(request.headers);
        return session ? { id: session.userId, email: session.email ?? null } : null;
      },
    });
  }

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

  // ------------------------------------------------ gift codes + invites
  if (deps.credits) {
    const cd = deps.credits;
    const codeBody = async (c: { req: { json: () => Promise<unknown> } }) => {
      const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof body?.code === "string" ? body.code.trim().slice(0, 64) : "";
      if (code.length < 4) throw badRequest("invalid_code", "Enter a code.");
      return code;
    };

    v1.post("/me/credits/redeem", async (c) => {
      const account = requireAccount(c);
      const userId = account.userId ?? "";
      if (!userId) throw unauthorized();
      await limit("checkout", userId);
      const r = await redeemCode(cd, userId, await codeBody(c));
      if (!r.ok) return c.json({ ok: false, reason: r.reason, error: r.message }, 400);
      return c.json(r);
    });

    v1.get("/me/invites", async (c) => {
      const account = requireAccount(c);
      const userId = account.userId ?? "";
      if (!userId) throw unauthorized();
      const [quota, invites, invitedBy] = await Promise.all([
        cd.affiliates.quota(userId),
        cd.affiliates.invites(userId),
        cd.affiliates.invitedBy(userId),
      ]);
      return c.json({ quota, invites, invited: Boolean(invitedBy) });
    });

    v1.post("/me/invites", async (c) => {
      const account = requireAccount(c);
      const userId = account.userId ?? "";
      if (!userId) throw unauthorized();
      if (!account.verified)
        throw forbidden("not_verified", "Verify your email before inviting anyone.");
      const body = (await c.req.json().catch(() => null)) as { note?: unknown } | null;
      const note = typeof body?.note === "string" ? body.note.slice(0, 120) : "";
      if ((await cd.affiliates.quota(userId)).left < 1)
        throw badRequest("no_invites_left", "No invites left.");
      const invite = await cd.affiliates.createInvite(userId, note);
      return c.json(
        {
          invite: { ...invite, url: `${deps.env.PUBLIC_ORIGIN}/i/${invite.code}` },
          quota: await cd.affiliates.quota(userId),
        },
        201,
      );
    });

    v1.post("/me/invites/accept", async (c) => {
      const account = requireAccount(c);
      const userId = account.userId ?? "";
      if (!userId) throw unauthorized();
      const r = await acceptInvite(
        cd,
        { userId: userId, verified: Boolean(account.verified) },
        await codeBody(c),
      );
      if (!r.ok) return c.json({ ok: false, reason: r.reason, error: r.message }, 400);
      return c.json({ ok: true });
    });
  }

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
    /** A CoinPay coin (`USDC_POL`) or `paypal`; unused when CoinPay hosts the picker. */
    method: z.string().min(2).max(32).optional(),
  });

  /**
   * What the checkout page offers: every coin the CoinPay business holds a
   * wallet for, plus PayPal. `hosted` means CoinPay shows that picker itself
   * (checkout sessions), so the page needs only one button.
   */
  v1.get("/checkout/coinpay/methods", async (c) => {
    try {
      return c.json(await deps.coinpay.listMethods());
    } catch (error) {
      deps.logger.error("coinpay methods lookup failed", { error: String(error) });
      throw new ApiError(502, "payments_unavailable", "Payments are unavailable right now.");
    }
  });

  v1.post("/checkout/coinpay", async (c) => {
    const account = c.get("account");
    const body = checkoutSchema.parse(await c.req.json());
    await limit("checkout", account?.userId ?? clientKey(c));

    // The server catalog is the price authority; note the absence of any
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
      return c.json({
        orderId: existing.id,
        status: existing.status,
        replayed: true,
        paymentUrl: paymentUrlForRef(existing.coinpayRef, deps.env.COINPAY_API_BASE) ?? undefined,
      });
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

    let checkout;
    try {
      checkout = await deps.coinpay.createCheckout({
        orderId,
        episodeId: body.episodeId,
        email: body.email,
        accountId: account?.userId ?? null,
        method: body.method,
        idempotencyKey: body.idempotencyKey,
      });
    } catch (error) {
      deps.logger.warn("coinpay checkout refused", {
        correlationId: c.get("correlationId"),
        orderId,
        method: body.method,
        error: String(error),
      });
      if (error instanceof CoinpayError && error.status && error.status < 500) {
        const code =
          error.code === "method_required" || error.code === "unsupported_method"
            ? error.code
            : "payment_refused";
        throw new ApiError(
          400,
          code,
          error.message.replace(/^coinpay request failed \(\d+\): ?/, "") ||
            "That payment method is unavailable.",
        );
      }
      throw new ApiError(502, "payments_unavailable", "Payments are unavailable right now.");
    }
    // The CoinPay reference is stored because not every webhook echoes our
    // metadata back: a crypto confirmation and a PayPal capture carry only
    // their payment id.
    await deps.repos.attachCoinpayInvoice(orderId, checkout.ref);

    deps.logger.info("checkout created", {
      correlationId: c.get("correlationId"),
      orderId,
      episodeId: body.episodeId,
      rail: checkout.rail,
    });

    return c.json({
      orderId,
      // The buyer goes to CoinPay. The return page shows *pending* only; the
      // webhook is the sole fulfilment trigger (PRD §24.2).
      paymentUrl: checkout.paymentUrl,
      rail: checkout.rail,
      status: "pending",
      expiresAt: checkout.expiresAt,
    });
  });

  // ------------------------------------------------------------ guest claim

  /**
   * Guest purchase claim (PRD §23.4). A guest pays, the worker emails a
   * one-time `/claim/<token>` link, and the page behind it uses these routes.
   * The token travels in a POST body, never a URL path, so it stays out of
   * access logs.
   */
  const claimTokenSchema = z.object({ token: z.string().min(16).max(1024) });

  async function claimStatusFor(token: string, viewerUserId: string | null) {
    const read = readClaimTokenIgnoringExpiry(token, deps.env.AUTH_SECRET);
    const order = read.ok ? await deps.repos.findOrderForClaim(read.claims.orderId) : null;
    const status: ClaimStatus = describeClaim(
      token,
      deps.env.AUTH_SECRET,
      Math.floor(now().getTime() / 1000),
      { order, viewerUserId },
    );
    const episodeId = order?.episodeIds[0] ?? null;
    const entry = episodeId ? CATALOG.find((e) => e.episodeId === episodeId) : undefined;
    return { status, order, episodeId, episodeTitle: entry?.title ?? null };
  }

  function playUrl(episodeId: string | null): string {
    return episodeId ? `/play?mode=campaign&episode=${encodeURIComponent(episodeId)}` : "/library";
  }

  /** Mint a fresh link for a paid, unclaimed guest order and mail it. */
  async function sendClaimEmail(order: { id: string; email: string | null; episodeIds: string[] }) {
    if (!order.email) return;
    const claim = createClaimToken(
      { orderId: order.id, email: order.email },
      deps.env.AUTH_SECRET,
      Math.floor(now().getTime() / 1000),
    );
    const entry = CATALOG.find((e) => e.episodeId === order.episodeIds[0]);
    await deps.enqueue("email", "purchase-claim", {
      kind: "purchase-claim",
      to: order.email,
      claimUrl: `${deps.env.PUBLIC_ORIGIN}/claim/${claim.token}`,
      episodeTitle: entry?.title ?? "NIGHTCELL 7",
    });
  }

  /** What a claim link is, for the page to explain before anyone signs in. */
  v1.post("/checkout/claim/status", async (c) => {
    await limit("claimStatus", clientKey(c));
    const body = claimTokenSchema.parse(await c.req.json());
    const account = c.get("account");
    const { status, episodeId, episodeTitle } = await claimStatusFor(
      body.token,
      account?.userId ?? null,
    );
    return c.json({
      state: status.state,
      // The token already carries the payment email in its readable payload,
      // so returning it reveals nothing the holder does not have.
      email: status.email ?? null,
      episodeId,
      episodeTitle,
      playUrl: status.state === "claimed_by_you" ? playUrl(episodeId) : null,
    });
  });

  v1.post("/checkout/claim", async (c) => {
    const body = claimTokenSchema.parse(await c.req.json());
    const account = requireAccount(c);
    await limit("claim", account.userId!);

    // Refuse what can never succeed here, with a reason the page can show,
    // rather than queueing it and leaving the buyer polling.
    const { status, episodeId } = await claimStatusFor(body.token, account.userId!);
    switch (status.state) {
      case "claimed_by_you":
        return c.json({ status: "claimed", playUrl: playUrl(episodeId) });
      case "claimable":
        break;
      case "claimed":
        throw new ApiError(409, "already_claimed", "This purchase is already on another account.");
      case "expired":
        throw new ApiError(410, "claim_expired", "This claim link has expired.");
      case "pending":
        throw new ApiError(409, "claim_pending", "This payment has not finished confirming yet.");
      case "unavailable":
        throw new ApiError(409, "claim_unavailable", "This order can no longer be claimed.");
      default:
        throw badRequest("invalid_claim", "This claim link is not valid.");
    }

    // Claim resolution is durable work with an audit trail, so it is queued
    // rather than performed inline. The worker re-checks everything.
    await deps.enqueue("entitlements", "claim", {
      token: body.token,
      userId: account.userId,
      correlationId: c.get("correlationId"),
    });
    return c.json({ status: "processing" }, 202);
  });

  /**
   * Email a fresh claim link. Takes the old (even expired) link, or the
   * payment email. Always answers the same way, so it cannot be used to learn
   * whether an address bought anything; the link only ever goes to the
   * address that paid.
   */
  v1.post("/checkout/claim/resend", async (c) => {
    await limit("claimResend", clientKey(c));
    const body = z
      .object({
        token: z.string().min(16).max(1024).optional(),
        email: z.string().email().max(320).optional(),
      })
      .refine((value) => value.token || value.email, "token or email is required")
      .parse(await c.req.json());

    const orders: { id: string; email: string | null; episodeIds: string[] }[] = [];
    if (body.token) {
      const read = readClaimTokenIgnoringExpiry(body.token, deps.env.AUTH_SECRET);
      if (read.ok) {
        const order = await deps.repos.findOrderForClaim(read.claims.orderId);
        if (order && !order.userId && order.status === "fulfilled") orders.push(order);
      }
    }
    if (body.email) {
      await limit("claimResend", `email:${body.email.toLowerCase()}`);
      for (const order of await deps.repos.listUnclaimedGuestOrders(body.email)) {
        if (!orders.some((o) => o.id === order.id)) orders.push(order);
      }
    }

    for (const order of orders) await sendClaimEmail(order);
    deps.logger.info("claim link resend", {
      correlationId: c.get("correlationId"),
      orders: orders.length,
    });
    return c.json({ sent: true }, 202);
  });

  // ------------------------------------------------------- coinpay webhook

  /**
   * Verified CoinPay webhook. The ONLY thing that fulfils an order.
   *
   * Registered at both /webhooks/coinpay (canonical, PRD §29) and the singular
   * /webhook/coinpay, because the provider dashboard was configured with the
   * singular form and a 404 here means a paid order silently never unlocks.
   * Accepting both costs nothing; losing a payment notification costs a
   * customer.
   */
  const handleCoinpayWebhook = async (c: Context<{ Variables: Variables }>) => {
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

    // Map the event to our order: by the CoinPay reference stored at checkout
    // first (every rail sends its payment id), then by metadata.order_id.
    const orderId = await deps.repos.findOrderIdForCoinpay({
      refs: [
        ...refsForCoinpayId(event.data.paymentId),
        ...refsForCoinpayId(event.data.checkoutSessionId),
      ],
      orderId: event.data.referenceId,
    });

    // Durably record the event BEFORE acknowledging, under a unique constraint
    // on the provider event id. A replay is a no-op, not a second fulfilment.
    const recorded = await deps.repos.recordPaymentEvent({
      id: `pe_${randomUUID()}`,
      providerEventId: event.id,
      eventType: event.type,
      orderId,
      payloadHash: createHash("sha256").update(rawBody).digest("hex"),
      receivedAt: now().toISOString(),
    });

    if (recorded.duplicate) {
      deps.logger.info("coinpay webhook duplicate ignored", { providerEventId: event.id });
      return c.json({ received: true, duplicate: true });
    }

    if (!orderId) {
      // Not ours (another property on the same business, or a test event):
      // acknowledge so CoinPay stops retrying, and leave a trace.
      deps.logger.warn("coinpay webhook for unknown order", redactEventForLog(event));
      return c.json({ received: true, unknownOrder: true });
    }

    // Heavy work is queued so the acknowledgement stays fast (PRD §30.5).
    await deps.enqueue("payments", "coinpay-event", {
      providerEventId: event.id,
      orderId,
      mappedStatus: mapEventStatus(event),
      paymentId: event.data.paymentId,
      correlationId: c.get("correlationId"),
    });

    deps.logger.info("coinpay webhook accepted", redactEventForLog(event));
    return c.json({ received: true });
  };

  v1.post("/webhooks/coinpay", handleCoinpayWebhook);
  v1.post("/webhook/coinpay", handleCoinpayWebhook);

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
    // `roomId` is the LOBBY the ticket admits to, not a Colyseus room id: the
    // client joins-or-creates a room filtered by region/shard/lobby, so quick
    // match players share rooms and a private code maps to exactly one lobby.
    // (A random id here pointed every ticket at a room that never existed.)
    const roomId = body.privateCode ? `private_${body.privateCode}` : QUICK_MATCH_LOBBY;
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
  const path = `${MULTIPLAYER_SYNC_PATH}/${encodeURIComponent(region)}/${encodeURIComponent(shard)}/${encodeURIComponent(roomId)}`;
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
