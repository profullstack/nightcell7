# CoinPayPortal integration

CoinPayPortal is the **sole V1 payment integration** (PRD §24.1). Do not add
Stripe code, keys, webhooks, checkout or documentation. If CoinPayPortal
internally supports multiple rails or wallets, those details stay behind its
contract.

## Non-negotiables

1. **The server catalog is the price authority.** `resolvePrice()` in
   `packages/entitlements/src/catalog.ts` is the only source of an amount, and
   `CoinpayClient.createInvoice()` has no amount parameter at all.
2. **The browser return URL proves nothing.** `/checkout/success` shows a
   pending state. Only a verified webhook moves an order forward.
3. **`paid` is not `fulfilled`.** They are separate states so a failed grant can
   be retried without re-charging anyone, and so a stuck order is visible.
4. **Replays are no-ops.** The provider event id carries a unique constraint;
   a duplicate webhook returns `{ received: true, duplicate: true }` and queues
   nothing.
5. **Environments are isolated.** Staging and production use different API keys
   and different webhook secrets.

## Order states

```
created -> pending -> confirming -> paid -> fulfilled
                                     |
                    refunded / reversed / disputed
        underpaid / overpaid / canceled / expired / manual_review
```

Legal transitions live in `packages/entitlements/src/orders.ts`. Anything not
listed is rejected — an unknown provider event must never walk an order into an
arbitrary state. An unrecognised provider status maps to `manual_review`, never
to `paid`.

## Webhook verification

```
POST /api/v1/webhooks/coinpay
x-coinpay-timestamp: <unix seconds>
x-coinpay-signature: hex(hmac-sha256(secret, "<timestamp>.<raw body>"))
```

The signature covers the **raw body**, verified before any JSON parsing. The
timestamp is bound into the signed payload so an old body cannot be replayed
with a fresh header; events outside a 300 s window are rejected.

Verification failures return **400**, not 500 — the provider should not retry an
event we can never accept.

## Fulfilment path

```
api    verify signature
       -> record payment_events row (unique provider_event_id)  <- idempotency
       -> enqueue "payments" job
       -> 200 (fast; heavy work is never inline)

worker load order, apply the state transition
       -> if paid/overpaid, transition to fulfilled
       -> grant/suspend/revoke the entitlement
       -> append an entitlement_events audit row
       -> mark the payment event processed
```

Guest purchases create the order without a user; the entitlement is attached
when the emailed claim link is used (PRD §23.4).

## Reconciliation

`services/cron` runs `reconcile-payments` every 10 minutes: it finds
non-terminal orders older than the threshold, asks CoinPay for the current
status, and repairs any drift through the same legal-transition check. It emits
an auditable report (`checked`, `drift`, `repaired`) and is safe to re-run.

Never assume CoinPayPortal or an underlying rail files taxes anywhere. Digital
tax classification and jurisdiction handling are a separate, required gate.

## Refunds

Provider-supported refunds use the CoinPay workflow. **Manual crypto refunds are
deliberately not implemented in code** — PRD §24.7 requires dual review and
destination verification, which is an operator workflow, not an API call.

A confirmed refund or reversal revokes only the associated paid entitlement.
Free multiplayer and the demo remain available unless the account is separately
banned. Every revocation writes an audit event and notifies the user.

## Before production

- [ ] Production CoinPay account approved
- [ ] Separate staging and production credentials + webhook secrets
- [ ] Webhook endpoint reachable and verified end to end in staging
- [ ] Underpayment and overpayment behaviour documented
- [ ] Refund and revocation flow rehearsed
- [ ] Offline-licence behaviour after refund defined
- [ ] Tax classification reviewed by a professional
