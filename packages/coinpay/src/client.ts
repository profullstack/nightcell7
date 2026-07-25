import { z } from "zod";
import { resolvePrice } from "@nightcell7/entitlements";

/**
 * CoinPayPortal API client.
 *
 * The ONLY payment integration in V1 (PRD §24.1). There is intentionally no
 * provider abstraction layer here: a second processor is a product decision,
 * and a premature interface would invite one to be added quietly.
 */

export interface CoinpayConfig {
  apiBase: string;
  apiKey: string;
  /** Where the buyer is returned to. Shows *pending*, never "unlocked". */
  returnUrl: string;
  cancelUrl: string;
  /** Verified webhooks are the only fulfilment trigger. */
  webhookUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const createInvoiceResultSchema = z.object({
  invoiceId: z.string().min(1),
  /** Hosted CoinPay payment page the buyer is sent to. */
  paymentUrl: z.string().url(),
  status: z.string().min(1),
  expiresAt: z.string().optional(),
});

export type CreateInvoiceResult = z.infer<typeof createInvoiceResultSchema>;

export interface CreateInvoiceInput {
  /** Our internal order id; comes back on every webhook as `referenceId`. */
  orderId: string;
  episodeId: string;
  /** Optional — guest checkout is supported via the claim flow (PRD §23.4). */
  email?: string;
  /** Prevents a double-submit from creating two invoices. */
  idempotencyKey: string;
}

export class CoinpayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CoinpayError";
  }
}

export class CoinpayClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: CoinpayConfig) {
    if (!config.apiKey) throw new Error("COINPAY_API_KEY is required");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  /**
   * Create a hosted invoice for an order.
   *
   * The amount comes from the server catalog, never from the caller — this
   * signature has no `amount` parameter on purpose.
   */
  async createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
    const price = resolvePrice(input.episodeId);
    if (!price.ok) {
      throw new CoinpayError(`cannot price episode: ${price.reason}`, 400, price.reason);
    }

    const body = {
      productId: price.entry.coinpayProductId,
      referenceId: input.orderId,
      amount: price.unitAmount,
      currency: price.currency,
      description: `NIGHTCELL 7 — ${price.entry.title}`,
      customerEmail: input.email,
      successUrl: this.config.returnUrl,
      cancelUrl: this.config.cancelUrl,
      webhookUrl: this.config.webhookUrl,
    };

    const json = await this.request("/v1/invoices", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "idempotency-key": input.idempotencyKey },
    });

    const parsed = createInvoiceResultSchema.safeParse(json);
    if (!parsed.success) {
      throw new CoinpayError("unexpected invoice response shape", 502, "bad_response");
    }
    return parsed.data;
  }

  /** Poll an invoice — used by reconciliation when a webhook was missed. */
  async getInvoice(invoiceId: string): Promise<{ status: string; amountPaid?: number }> {
    const json = (await this.request(`/v1/invoices/${encodeURIComponent(invoiceId)}`, {
      method: "GET",
    })) as { status?: unknown; amountPaid?: unknown };

    if (typeof json.status !== "string") {
      throw new CoinpayError("invoice status missing", 502, "bad_response");
    }
    return {
      status: json.status,
      amountPaid: typeof json.amountPaid === "number" ? json.amountPaid : undefined,
    };
  }

  /**
   * Request a provider-side refund.
   *
   * Manual crypto refunds are deliberately NOT implemented here — PRD §24.7
   * requires dual review and destination verification, which is an operator
   * workflow, not an API call.
   */
  async refund(paymentId: string, reason: string): Promise<{ status: string }> {
    const json = (await this.request(`/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    })) as { status?: unknown };

    if (typeof json.status !== "string") {
      throw new CoinpayError("refund status missing", 502, "bad_response");
    }
    return { status: json.status };
  }

  private async request(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.config.apiBase}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
          ...init.headers,
        },
        body: init.body,
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        // The provider body may echo payer detail; keep it out of the message.
        throw new CoinpayError(
          `coinpay request failed (${response.status})`,
          response.status,
          "request_failed",
        );
      }
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timer);
    }
  }
}
