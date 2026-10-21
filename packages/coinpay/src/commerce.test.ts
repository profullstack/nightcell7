import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_STATUS,
  EPISODE_PRICE_USD_CENTS,
  ORDER_STATUS,
  applyOrderToEntitlement,
  canTransition,
  decideEntitlement,
  formatPrice,
  hasAccess,
  isNonTerminal,
  isOfflineLicenseValid,
  needsFulfilment,
  offlineExpiry,
  resolvePrice,
  transition,
} from "@nightcell7/entitlements";
import { EPISODE } from "@nightcell7/game-core";
import {
  CoinpayClient,
  WEBHOOK_TOLERANCE_SECONDS,
  mapEventStatus,
  mapProviderStatus,
  normaliseApiOrigin,
  redactEventForLog,
  signWebhookPayload,
  verifyWebhook,
} from "./index";

const SECRET = "whsec_test_0123456789abcdef";

function makeWebhook(overrides: Record<string, unknown> = {}, atSeconds = 1_700_000_000) {
  // CoinPay's wire shape (coinpayportal src/lib/webhooks/service.ts).
  const body = JSON.stringify({
    id: "evt_pay_1_1700000000",
    type: "payment.forwarded",
    data: {
      payment_id: "pay_1",
      status: "forwarded",
      currency: "USDC_POL",
      amount: 9.99,
      amount_usd: 9.99,
      metadata: { order_id: "ord_1", property: "nightcell7.com", account_id: "u1" },
    },
    created_at: new Date(atSeconds * 1000).toISOString(),
    business_id: "biz_1",
    ...overrides,
  });
  return {
    rawBody: body,
    signature: signWebhookPayload(body, atSeconds, SECRET),
    secret: SECRET,
    nowSeconds: atSeconds,
  };
}

describe("catalog is the price authority", () => {
  it("prices the episode at $9.99 and formats it for display", () => {
    const price = resolvePrice(EPISODE.FALSE_DAWN);
    expect(price.ok).toBe(true);
    if (!price.ok) return;
    expect(price.unitAmount).toBe(EPISODE_PRICE_USD_CENTS);
    expect(price.unitAmount).toBe(999);
    expect(formatPrice(price.unitAmount)).toBe("$9.99");
  });

  it("includes both campaigns and the epilogue in one purchase", () => {
    const price = resolvePrice(EPISODE.FALSE_DAWN);
    if (!price.ok) throw new Error("expected a price");
    expect(price.entry.includes).toEqual(
      expect.arrayContaining(["rook-campaign", "leila-campaign", "complete-truth"]),
    );
  });

  it("refuses to price an unknown episode", () => {
    expect(resolvePrice("not-an-episode")).toEqual({ ok: false, reason: "unknown_episode" });
  });
});

describe("order state machine", () => {
  it("walks the happy path created -> pending -> paid -> fulfilled", () => {
    expect(canTransition(ORDER_STATUS.CREATED, ORDER_STATUS.PENDING)).toBe(true);
    expect(canTransition(ORDER_STATUS.PENDING, ORDER_STATUS.PAID)).toBe(true);
    expect(canTransition(ORDER_STATUS.PAID, ORDER_STATUS.FULFILLED)).toBe(true);
  });

  it("treats a replayed transition as a no-op success", () => {
    const result = transition(ORDER_STATUS.PAID, ORDER_STATUS.PAID);
    expect(result).toEqual({ ok: true, status: ORDER_STATUS.PAID, changed: false });
  });

  it("rejects illegal jumps, including straight to fulfilled", () => {
    expect(transition(ORDER_STATUS.CREATED, ORDER_STATUS.FULFILLED).ok).toBe(false);
    expect(transition(ORDER_STATUS.EXPIRED, ORDER_STATUS.PAID).ok).toBe(false);
    expect(transition(ORDER_STATUS.REFUNDED, ORDER_STATUS.FULFILLED).ok).toBe(false);
  });

  it("keeps refunds reachable after fulfilment", () => {
    expect(canTransition(ORDER_STATUS.FULFILLED, ORDER_STATUS.REFUNDED)).toBe(true);
    expect(canTransition(ORDER_STATUS.FULFILLED, ORDER_STATUS.REVERSED)).toBe(true);
  });

  it("flags paid-but-unfulfilled orders for the reconciliation job", () => {
    expect(needsFulfilment(ORDER_STATUS.PAID)).toBe(true);
    expect(needsFulfilment(ORDER_STATUS.FULFILLED)).toBe(false);
    expect(isNonTerminal(ORDER_STATUS.PENDING)).toBe(true);
    expect(isNonTerminal(ORDER_STATUS.REFUNDED)).toBe(false);
  });
});

describe("entitlement rules", () => {
  const base = {
    userId: "u1",
    episodeId: EPISODE.FALSE_DAWN,
    orderId: "ord_1",
    now: "2026-07-25T00:00:00.000Z",
  };

  it("does not unlock content on `paid` alone — only on `fulfilled`", () => {
    expect(decideEntitlement(ORDER_STATUS.PAID).status).toBeNull();
    expect(decideEntitlement(ORDER_STATUS.FULFILLED).status).toBe(ENTITLEMENT_STATUS.ACTIVE);
  });

  it("grants exactly once and is idempotent on replay", () => {
    const first = applyOrderToEntitlement({ ...base, orderStatus: ORDER_STATUS.FULFILLED });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);
    expect(hasAccess(first.entitlement)).toBe(true);

    const replay = applyOrderToEntitlement({
      ...base,
      orderStatus: ORDER_STATUS.FULFILLED,
      existing: first.entitlement,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.created).toBe(false);
    expect(replay.entitlement.grantedAt).toBe(first.entitlement.grantedAt);
  });

  it("revokes on refund and on reversal", () => {
    const granted = applyOrderToEntitlement({ ...base, orderStatus: ORDER_STATUS.FULFILLED });
    if (!granted.ok) throw new Error("expected grant");

    for (const status of [ORDER_STATUS.REFUNDED, ORDER_STATUS.REVERSED] as const) {
      const revoked = applyOrderToEntitlement({
        ...base,
        orderStatus: status,
        existing: granted.entitlement,
      });
      expect(revoked.ok).toBe(true);
      if (!revoked.ok) continue;
      expect(revoked.entitlement.status).toBe(ENTITLEMENT_STATUS.REVOKED);
      expect(hasAccess(revoked.entitlement)).toBe(false);
      expect(revoked.entitlement.revokedAt).toBe(base.now);
    }
  });

  it("suspends rather than destroys access during a dispute", () => {
    const granted = applyOrderToEntitlement({ ...base, orderStatus: ORDER_STATUS.FULFILLED });
    if (!granted.ok) throw new Error("expected grant");
    const disputed = applyOrderToEntitlement({
      ...base,
      orderStatus: ORDER_STATUS.DISPUTED,
      existing: granted.entitlement,
    });
    expect(disputed.ok).toBe(true);
    if (!disputed.ok) return;
    expect(disputed.entitlement.status).toBe(ENTITLEMENT_STATUS.SUSPENDED);
    expect(hasAccess(disputed.entitlement)).toBe(false);
  });

  it("does not let a refund on a superseded order revoke a later purchase", () => {
    const active = applyOrderToEntitlement({ ...base, orderStatus: ORDER_STATUS.FULFILLED });
    if (!active.ok) throw new Error("expected grant");

    const staleRefund = applyOrderToEntitlement({
      ...base,
      orderId: "ord_old",
      orderStatus: ORDER_STATUS.REFUNDED,
      existing: active.entitlement,
    });
    expect(staleRefund).toEqual({ ok: false, reason: "revocation_targets_superseded_order" });
  });

  it("expires an offline licence after the grace window", () => {
    const issued = new Date("2026-07-25T00:00:00.000Z");
    const license = {
      userId: "u1",
      episodeId: EPISODE.FALSE_DAWN,
      deviceId: "d1",
      tokenId: "t1",
      issuedAt: issued.toISOString(),
      expiresAt: offlineExpiry(issued).toISOString(),
    };
    expect(isOfflineLicenseValid(license, new Date("2026-08-10T00:00:00.000Z"))).toBe(true);
    expect(isOfflineLicenseValid(license, new Date("2026-09-10T00:00:00.000Z"))).toBe(false);
    expect(isOfflineLicenseValid({ ...license, revokedAt: issued.toISOString() }, issued)).toBe(
      false,
    );
  });
});

describe("coinpay webhooks", () => {
  it("accepts a correctly signed, fresh event", () => {
    const result = verifyWebhook(makeWebhook());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.id).toBe("evt_pay_1_1700000000");
    expect(result.event.data.paymentId).toBe("pay_1");
    expect(result.event.data.referenceId).toBe("ord_1");
    expect(result.event.data.property).toBe("nightcell7.com");
  });

  it("rejects a tampered body even with a valid-looking signature", () => {
    const input = makeWebhook();
    const tampered = { ...input, rawBody: input.rawBody.replace('"amount":9.99', '"amount":1') };
    expect(verifyWebhook(tampered)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a replayed event outside the freshness window", () => {
    const at = 1_700_000_000;
    const input = makeWebhook({}, at);
    const later = { ...input, nowSeconds: at + WEBHOOK_TOLERANCE_SECONDS + 1 };
    expect(verifyWebhook(later)).toEqual({ ok: false, reason: "stale_event" });
  });

  it("rejects a missing signature or timestamp instead of trusting the body", () => {
    const input = makeWebhook();
    expect(verifyWebhook({ ...input, signature: null })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    const noTimestamp = input.signature.replace(/^t=\d+,/, "");
    expect(verifyWebhook({ ...input, signature: noTimestamp })).toEqual({
      ok: false,
      reason: "missing_timestamp",
    });
  });

  it("rejects a signature made with a different secret", () => {
    const input = makeWebhook();
    expect(verifyWebhook({ ...input, secret: "whsec_wrong_secret_value" })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("maps provider statuses onto internal order states", () => {
    expect(mapProviderStatus("paid")).toBe(ORDER_STATUS.PAID);
    expect(mapProviderStatus("CONFIRMING")).toBe(ORDER_STATUS.CONFIRMING);
    expect(mapProviderStatus("chargeback")).toBe(ORDER_STATUS.REVERSED);
    expect(mapProviderStatus("underpaid")).toBe(ORDER_STATUS.UNDERPAID);
  });

  it("sends an unrecognised provider status to manual review, never to paid", () => {
    expect(mapProviderStatus("some_new_provider_state")).toBe(ORDER_STATUS.MANUAL_REVIEW);
  });

  it("keeps payer identifiers out of log output", () => {
    const verified = verifyWebhook(
      makeWebhook({
        data: {
          payment_id: "pay_1",
          status: "completed",
          payer_email: "buyer@example.com",
          metadata: { order_id: "ord_1", email: "buyer@example.com" },
        },
      }),
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const logged = JSON.stringify(redactEventForLog(verified.event));
    expect(logged).not.toContain("buyer@example.com");
    expect(logged).toContain("ord_1");
  });

  it("reads the payment id from data, never the top-level event id", () => {
    const verified = verifyWebhook(
      makeWebhook({
        type: "payment.confirmed",
        data: { payment_id: "pay_9", status: "confirmed" },
      }),
    );
    if (!verified.ok) throw new Error("expected a verified event");
    expect(verified.event.data.paymentId).toBe("pay_9");
    expect(verified.event.data.referenceId).toBeUndefined();
    expect(mapEventStatus(verified.event)).toBe(ORDER_STATUS.PAID);
  });

  it("maps CoinPay event types, keeping under- and overpayment", () => {
    const base = { id: "e", createdAt: "", data: { paymentId: "p", status: "" } };
    expect(mapEventStatus({ ...base, type: "payment.expired" })).toBe(ORDER_STATUS.EXPIRED);
    expect(mapEventStatus({ ...base, type: "payment.disputed" })).toBe(ORDER_STATUS.DISPUTED);
    expect(
      mapEventStatus({
        ...base,
        type: "payment.confirmed",
        data: { paymentId: "p", status: "underpaid" },
      }),
    ).toBe(ORDER_STATUS.UNDERPAID);
  });
});

describe("coinpay client", () => {
  type Call = { url: string; init: RequestInit };
  function fakeFetch(routes: Record<string, (body: unknown) => [number, unknown]>, calls: Call[]) {
    return (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const path = new URL(url).pathname;
      const handler = routes[path];
      const [status, json] = handler
        ? handler(init.body ? JSON.parse(String(init.body)) : null)
        : [404, {}];
      return new Response(JSON.stringify(json), { status });
    }) as unknown as typeof fetch;
  }
  const coins = (): [number, unknown] => [
    200,
    {
      business_id: "biz_1",
      coins: [
        { symbol: "BTC", is_active: true },
        { symbol: "USDC_POL", is_active: true },
      ],
    },
  ];

  it("folds the dead api.coinpayportal.com host and an /api suffix onto the origin", () => {
    expect(normaliseApiOrigin("https://api.coinpayportal.com")).toBe("https://coinpayportal.com");
    expect(normaliseApiOrigin("https://coinpayportal.com/api")).toBe("https://coinpayportal.com");
  });

  it("falls back to a coin picker plus PayPal while hosted sessions 404", async () => {
    const calls: Call[] = [];
    const client = new CoinpayClient({
      apiKey: "cp_live_test",
      returnUrl: "https://nightcell7.com/checkout/success",
      cancelUrl: "https://nightcell7.com/checkout/cancel",
      fetchImpl: fakeFetch({ "/api/supported-coins": coins }, calls),
    });
    const listed = await client.listMethods();
    expect(listed.hosted).toBe(false);
    expect(listed.methods.map((m) => m.id)).toEqual(["BTC", "USDC_POL", "paypal"]);
  });

  it("creates a crypto payment with property, account and email metadata", async () => {
    const calls: Call[] = [];
    let sent: Record<string, unknown> = {};
    const client = new CoinpayClient({
      apiBase: "https://api.coinpayportal.com",
      apiKey: "cp_live_test",
      returnUrl: "https://nightcell7.com/checkout/success",
      cancelUrl: "https://nightcell7.com/checkout/cancel",
      fetchImpl: fakeFetch(
        {
          "/api/supported-coins": coins,
          "/api/payments/create": (body) => {
            sent = body as Record<string, unknown>;
            return [201, { success: true, payment: { id: "pay_1" } }];
          },
        },
        calls,
      ),
    });
    const result = await client.createCheckout({
      orderId: "ord_1",
      episodeId: EPISODE.FALSE_DAWN,
      email: "buyer@example.com",
      accountId: "u1",
      method: "usdc_pol",
      idempotencyKey: "idem-1",
    });
    expect(result).toMatchObject({
      rail: "crypto",
      ref: "crypto:pay_1",
      paymentUrl: "https://coinpayportal.com/pay/pay_1",
    });
    expect(sent).toMatchObject({ amount: 9.99, blockchain: "USDC_POL", currency: "USD" });
    expect(sent.metadata).toMatchObject({
      property: "nightcell7.com",
      account_id: "u1",
      email: "buyer@example.com",
      order_id: "ord_1",
    });
    expect(calls.every((c) => c.url.startsWith("https://coinpayportal.com/"))).toBe(true);
  });

  it("refuses a coin the business has no wallet for before CoinPay does", async () => {
    const client = new CoinpayClient({
      apiKey: "cp_live_test",
      returnUrl: "r",
      cancelUrl: "c",
      fetchImpl: fakeFetch({ "/api/supported-coins": coins }, []),
    });
    await expect(
      client.createCheckout({
        orderId: "o",
        episodeId: EPISODE.FALSE_DAWN,
        method: "BASE",
        idempotencyKey: "idem-2",
      }),
    ).rejects.toMatchObject({ code: "unsupported_method" });
  });

  it("opens a PayPal order on the business", async () => {
    let sent: Record<string, unknown> = {};
    const client = new CoinpayClient({
      apiKey: "cp_live_test",
      returnUrl: "r",
      cancelUrl: "c",
      fetchImpl: fakeFetch(
        {
          "/api/supported-coins": coins,
          "/api/paypal/payments/create": (body) => {
            sent = body as Record<string, unknown>;
            return [
              200,
              { transaction_id: "tx_1", checkout_url: "https://coinpayportal.com/pay/paypal/tx_1" },
            ];
          },
        },
        [],
      ),
    });
    const result = await client.createCheckout({
      orderId: "o",
      episodeId: EPISODE.FALSE_DAWN,
      method: "paypal",
      idempotencyKey: "idem-3",
    });
    expect(result).toMatchObject({ rail: "paypal", ref: "paypal:tx_1" });
    expect(sent).toMatchObject({ business_id: "biz_1", amount: 9.99 });
  });

  it("uses a hosted checkout session once CoinPay has one", async () => {
    let sent: Record<string, unknown> = {};
    const client = new CoinpayClient({
      apiKey: "cp_live_test",
      returnUrl: "r",
      cancelUrl: "c",
      fetchImpl: fakeFetch(
        {
          "/api/checkout/sessions": (body) => {
            if (!body || Object.keys(body as object).length === 0)
              return [400, { error: "amount is required" }];
            sent = body as Record<string, unknown>;
            return [201, { id: "cs_1", url: "https://coinpayportal.com/checkout/cs_1" }];
          },
        },
        [],
      ),
    });
    const result = await client.createCheckout({
      orderId: "o",
      episodeId: EPISODE.FALSE_DAWN,
      accountId: "u1",
      idempotencyKey: "idem-4",
    });
    expect(result).toMatchObject({
      rail: "session",
      ref: "session:cs_1",
      paymentUrl: "https://coinpayportal.com/checkout/cs_1",
    });
    expect(sent).toMatchObject({
      amount: 9.99,
      currency: "USD",
      account_id: "u1",
      property: "nightcell7.com",
      expires_in_minutes: 60,
    });
  });

  it("drives a full webhook -> order -> entitlement flow exactly once", () => {
    const verified = verifyWebhook(makeWebhook());
    if (!verified.ok) throw new Error("expected a verified event");

    const mapped = mapEventStatus(verified.event);
    const toPaid = transition(ORDER_STATUS.PENDING, mapped);
    expect(toPaid).toEqual({ ok: true, status: ORDER_STATUS.PAID, changed: true });

    // Paid alone unlocks nothing.
    expect(decideEntitlement(ORDER_STATUS.PAID).status).toBeNull();

    const toFulfilled = transition(ORDER_STATUS.PAID, ORDER_STATUS.FULFILLED);
    expect(toFulfilled.ok).toBe(true);

    const grant = applyOrderToEntitlement({
      userId: "u1",
      episodeId: EPISODE.FALSE_DAWN,
      orderId: verified.event.data.referenceId ?? "ord_1",
      orderStatus: ORDER_STATUS.FULFILLED,
      now: "2026-07-25T00:00:00.000Z",
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    expect(grant.created).toBe(true);
    expect(hasAccess(grant.entitlement)).toBe(true);
  });
});
