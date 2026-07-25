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
  WEBHOOK_TOLERANCE_SECONDS,
  mapProviderStatus,
  redactEventForLog,
  signWebhookPayload,
  verifyWebhook,
} from "./index";

const SECRET = "whsec_test_0123456789abcdef";

function makeWebhook(overrides: Record<string, unknown> = {}, atSeconds = 1_700_000_000) {
  const body = JSON.stringify({
    id: "evt_1",
    type: "payment.completed",
    createdAt: new Date(atSeconds * 1000).toISOString(),
    data: {
      referenceId: "ord_1",
      paymentId: "pay_1",
      status: "paid",
      currency: "USD",
      amount: 999,
    },
    ...overrides,
  });
  return {
    rawBody: body,
    timestamp: String(atSeconds),
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
    expect(result.event.id).toBe("evt_1");
    expect(result.event.data.referenceId).toBe("ord_1");
  });

  it("rejects a tampered body even with a valid-looking signature", () => {
    const input = makeWebhook();
    const tampered = { ...input, rawBody: input.rawBody.replace('"amount":999', '"amount":1') };
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
    expect(verifyWebhook({ ...input, timestamp: null })).toEqual({
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
          referenceId: "ord_1",
          paymentId: "pay_1",
          status: "paid",
          payerEmail: "buyer@example.com",
        },
      }),
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const logged = JSON.stringify(redactEventForLog(verified.event));
    expect(logged).not.toContain("buyer@example.com");
    expect(logged).toContain("ord_1");
  });

  it("drives a full webhook -> order -> entitlement flow exactly once", () => {
    const verified = verifyWebhook(makeWebhook());
    if (!verified.ok) throw new Error("expected a verified event");

    const mapped = mapProviderStatus(verified.event.data.status);
    const toPaid = transition(ORDER_STATUS.PENDING, mapped);
    expect(toPaid).toEqual({ ok: true, status: ORDER_STATUS.PAID, changed: true });

    // Paid alone unlocks nothing.
    expect(decideEntitlement(ORDER_STATUS.PAID).status).toBeNull();

    const toFulfilled = transition(ORDER_STATUS.PAID, ORDER_STATUS.FULFILLED);
    expect(toFulfilled.ok).toBe(true);

    const grant = applyOrderToEntitlement({
      userId: "u1",
      episodeId: EPISODE.FALSE_DAWN,
      orderId: verified.event.data.referenceId,
      orderStatus: ORDER_STATUS.FULFILLED,
      now: "2026-07-25T00:00:00.000Z",
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    expect(grant.created).toBe(true);
    expect(hasAccess(grant.entitlement)).toBe(true);
  });
});
