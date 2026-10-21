import { resolvePrice } from "@nightcell7/entitlements";

/**
 * CoinPayPortal API client.
 *
 * The ONLY payment integration in V1 (PRD §24.1). There is intentionally no
 * provider abstraction layer here: a second processor is a product decision,
 * and a premature interface would invite one to be added quietly.
 *
 * Three CoinPay rails, one call (`createCheckout`):
 *
 *  - hosted checkout sessions (`POST /api/checkout/sessions`): CoinPay shows
 *    every coin the business takes plus PayPal on its own page. Used whenever
 *    the endpoint exists; it is feature-detected, because a 404 there means
 *    this CoinPay does not have it yet.
 *  - crypto (`POST /api/payments/create`): the buyer picked a coin on our
 *    checkout page; the coin list is whatever the business holds a wallet for
 *    (`GET /api/supported-coins`), never a hard-coded guess.
 *  - PayPal (`POST /api/paypal/payments/create`).
 *
 * Every rail carries the same metadata: `property`, `account_id`, `email` and
 * our `order_id`. The CoinPay reference each rail returns is stored on the
 * order, because not every CoinPay webhook echoes metadata back (a crypto
 * `payment.confirmed` and every PayPal event carry only the payment id).
 */

export const COINPAY_DEFAULT_ORIGIN = "https://coinpayportal.com";
export const PROPERTY = "nightcell7.com";
export const PAYPAL_METHOD = "paypal";

/** CoinPay's `blockchain` values, with the names a buyer recognises. */
export const COIN_LABELS: Readonly<Record<string, string>> = {
  BTC: "Bitcoin",
  BCH: "Bitcoin Cash",
  ETH: "Ethereum",
  POL: "Polygon",
  SOL: "Solana",
  BNB: "BNB",
  XRP: "XRP",
  ADA: "Cardano",
  DOGE: "Dogecoin",
  USDC_ETH: "USDC on Ethereum",
  USDC_POL: "USDC on Polygon",
  USDC_SOL: "USDC on Solana",
  USDC_BASE: "USDC on Base",
  USDT_ETH: "USDT on Ethereum",
  USDT_POL: "USDT on Polygon",
  USDT_SOL: "USDT on Solana",
  USDT_TRON: "USDT on TRON",
};

export type CheckoutRail = "session" | "crypto" | "paypal";

export interface CheckoutMethod {
  /** A CoinPay `blockchain` value, or `paypal`. */
  id: string;
  label: string;
  rail: Exclude<CheckoutRail, "session">;
}

export interface CheckoutMethods {
  /** True when CoinPay hosts the picker itself (checkout sessions). */
  hosted: boolean;
  methods: CheckoutMethod[];
}

export interface CoinpayConfig {
  /** CoinPay origin. `https://coinpayportal.com`, `/api` suffix tolerated. */
  apiBase?: string;
  apiKey: string;
  /** Optional: discovered from the API key when absent. */
  businessId?: string;
  /** Where the buyer is returned to. Shows *pending*, never "unlocked". */
  returnUrl: string;
  cancelUrl: string;
  /** "auto" feature-detects hosted sessions; "off" never uses them. */
  sessions?: "auto" | "on" | "off";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Payment window, 15-120 minutes. */
  expiresInMinutes?: number;
}

export interface CreateCheckoutInput {
  /** Our internal order id; travels as metadata.order_id. */
  orderId: string;
  episodeId: string;
  /** Optional: guest checkout is supported via the claim flow (PRD §23.4). */
  email?: string;
  /** Our user id when signed in. */
  accountId?: string | null;
  /** A coin (`USDC_POL`) or `paypal`. Ignored when CoinPay hosts the picker. */
  method?: string;
  /** Prevents a double-submit from creating two payments. */
  idempotencyKey: string;
}

export interface CheckoutResult {
  rail: CheckoutRail;
  /** `<rail>:<coinpay id>`, stored on the order and matched by the webhook. */
  ref: string;
  /** CoinPay's page the buyer is sent to. */
  paymentUrl: string;
  expiresAt?: string;
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

/**
 * Normalise the configured base to CoinPay's origin.
 *
 * Vault values come as `https://coinpayportal.com/api`, and this repo once
 * shipped `https://api.coinpayportal.com` (a host that does not resolve), so
 * both are folded back onto the real origin rather than trusted verbatim.
 */
export function normaliseApiOrigin(base?: string): string {
  if (!base) return COINPAY_DEFAULT_ORIGIN;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return COINPAY_DEFAULT_ORIGIN;
  }
  if (url.hostname === "api.coinpayportal.com") url.hostname = "coinpayportal.com";
  return url.origin;
}

/** Make a ref from a rail and a CoinPay id. */
export function coinpayRef(rail: CheckoutRail, id: string): string {
  return `${rail}:${id}`;
}

/** Every ref a webhook for this CoinPay id could match. */
export function refsForCoinpayId(id: string | undefined | null): string[] {
  if (!id) return [];
  return [coinpayRef("crypto", id), coinpayRef("paypal", id), coinpayRef("session", id)];
}

const SESSION_PROBE_TTL_MS = 10 * 60_000;
const COINS_TTL_MS = 5 * 60_000;

export class CoinpayClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly origin: string;
  private sessionsKnown: { available: boolean; at: number } | null = null;
  private coinsCache: { coins: string[]; businessId: string | null; at: number } | null = null;

  constructor(private readonly config: CoinpayConfig) {
    if (!config.apiKey) throw new Error("COINPAY_API_KEY is required");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.origin = normaliseApiOrigin(config.apiBase);
  }

  /** What the checkout page should offer. */
  async listMethods(): Promise<CheckoutMethods> {
    const hosted = await this.sessionsAvailable();
    const { coins } = await this.supportedCoins();
    const methods: CheckoutMethod[] = coins.map((coin) => ({
      id: coin,
      label: COIN_LABELS[coin] ?? coin,
      rail: "crypto",
    }));
    methods.push({ id: PAYPAL_METHOD, label: "PayPal", rail: "paypal" });
    return { hosted, methods };
  }

  /**
   * Create a CoinPay checkout for an order.
   *
   * The amount comes from the server catalog, never from the caller: this
   * signature has no `amount` parameter on purpose.
   */
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const price = resolvePrice(input.episodeId);
    if (!price.ok) {
      throw new CoinpayError(`cannot price episode: ${price.reason}`, 400, price.reason);
    }
    const amount = price.unitAmount / 100;
    const description = `NIGHTCELL 7: ${price.entry.title}`;
    const metadata = {
      property: PROPERTY,
      account_id: input.accountId ?? null,
      email: input.email ?? null,
      order_id: input.orderId,
      episode_id: input.episodeId,
    };
    const expiresInMinutes = this.config.expiresInMinutes ?? 60;

    if (await this.sessionsAvailable()) {
      const session = await this.tryCreateSession(
        {
          amount,
          currency: price.currency,
          description,
          customer_email: input.email,
          account_id: input.accountId ?? null,
          property: PROPERTY,
          metadata,
          success_url: this.config.returnUrl,
          cancel_url: this.config.cancelUrl,
          expires_in_minutes: expiresInMinutes,
        },
        input.idempotencyKey,
      );
      if (session) return session;
    }

    const method = (input.method ?? "").trim();
    if (!method) {
      throw new CoinpayError("choose a payment method", 400, "method_required");
    }

    if (method.toLowerCase() === PAYPAL_METHOD) {
      const businessId = await this.businessId();
      const json = (await this.request("/api/paypal/payments/create", {
        method: "POST",
        body: JSON.stringify({
          business_id: businessId,
          amount,
          currency: price.currency,
          description,
          metadata,
          customer_email: input.email,
          invoiceNumber: input.orderId,
          success_url: this.config.returnUrl,
          cancel_url: this.config.cancelUrl,
        }),
        headers: { "idempotency-key": input.idempotencyKey },
      })) as { transaction_id?: unknown; checkout_url?: unknown; approve_url?: unknown };
      const id = typeof json.transaction_id === "string" ? json.transaction_id : "";
      const url =
        typeof json.checkout_url === "string"
          ? json.checkout_url
          : typeof json.approve_url === "string"
            ? json.approve_url
            : "";
      if (!id || !url)
        throw new CoinpayError("unexpected PayPal response shape", 502, "bad_response");
      return { rail: "paypal", ref: coinpayRef("paypal", id), paymentUrl: url };
    }

    const coin = method.toUpperCase();
    const { coins } = await this.supportedCoins();
    if (!coins.includes(coin)) {
      // A real chain, spelled correctly, that this business has no wallet for
      // is refused by CoinPay at the moment the buyer presses Buy. Refuse it
      // here instead, with the list that is actually on offer.
      throw new CoinpayError(`${coin} is not offered`, 400, "unsupported_method");
    }
    const json = (await this.request("/api/payments/create", {
      method: "POST",
      body: JSON.stringify({
        amount,
        currency: price.currency,
        blockchain: coin,
        description,
        metadata,
        success_url: this.config.returnUrl,
        redirect_url: this.config.returnUrl,
        cancel_url: this.config.cancelUrl,
        expires_in_minutes: expiresInMinutes,
      }),
      headers: { "idempotency-key": `${input.idempotencyKey}:${coin}` },
    })) as { payment?: { id?: unknown; expires_at?: unknown } };
    const id = typeof json.payment?.id === "string" ? json.payment.id : "";
    if (!id) throw new CoinpayError("unexpected payment response shape", 502, "bad_response");
    return {
      rail: "crypto",
      ref: coinpayRef("crypto", id),
      paymentUrl: `${this.origin}/pay/${encodeURIComponent(id)}`,
      expiresAt: typeof json.payment?.expires_at === "string" ? json.payment.expires_at : undefined,
    };
  }

  /**
   * Current CoinPay status of a stored ref, for reconciliation when a webhook
   * was missed. Only crypto payments have a public status read; other rails
   * return null and are left to their webhooks.
   */
  async getPaymentStatus(ref: string): Promise<string | null> {
    const [rail, id] = splitRef(ref);
    if (rail !== "crypto" || !id) return null;
    const json = (await this.request(`/api/payments/${encodeURIComponent(id)}`, {
      method: "GET",
    })) as { payment?: { status?: unknown } };
    return typeof json.payment?.status === "string" ? json.payment.status : null;
  }

  private async sessionsAvailable(): Promise<boolean> {
    const mode = this.config.sessions ?? "auto";
    if (mode === "off") return false;
    if (mode === "on") return true;
    const known = this.sessionsKnown;
    if (known && Date.now() - known.at < SESSION_PROBE_TTL_MS) return known.available;
    // An empty body is refused by validation when the route exists, and 404s
    // when it does not; nothing is created either way.
    let available = false;
    try {
      const response = await this.raw("/api/checkout/sessions", { method: "POST", body: "{}" });
      available = response.status !== 404 && response.status !== 405;
    } catch {
      available = false;
    }
    this.sessionsKnown = { available, at: Date.now() };
    return available;
  }

  private async tryCreateSession(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<CheckoutResult | null> {
    const response = await this.raw("/api/checkout/sessions", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "idempotency-key": idempotencyKey },
    });
    if (response.status === 404 || response.status === 405) {
      this.sessionsKnown = { available: false, at: Date.now() };
      return null;
    }
    const json = await readJson(response);
    if (!response.ok) {
      throw new CoinpayError(
        `coinpay checkout session failed (${response.status})${providerError(json)}`,
        response.status,
        "request_failed",
      );
    }
    const s = (json as { session?: unknown }).session ?? json;
    const id = typeof (s as { id?: unknown }).id === "string" ? (s as { id: string }).id : "";
    const url = typeof (s as { url?: unknown }).url === "string" ? (s as { url: string }).url : "";
    if (!id || !url)
      throw new CoinpayError("unexpected session response shape", 502, "bad_response");
    const expiresAt = (s as { expires_at?: unknown }).expires_at;
    return {
      rail: "session",
      ref: coinpayRef("session", id),
      paymentUrl: url,
      expiresAt: typeof expiresAt === "string" ? expiresAt : undefined,
    };
  }

  private async supportedCoins(): Promise<{ coins: string[]; businessId: string | null }> {
    const cached = this.coinsCache;
    if (cached && Date.now() - cached.at < COINS_TTL_MS) return cached;
    const json = (await this.request("/api/supported-coins?active_only=true", {
      method: "GET",
    })) as { coins?: Array<{ symbol?: unknown; is_active?: unknown }>; business_id?: unknown };
    const coins = (json.coins ?? [])
      .filter((c) => c.is_active !== false && typeof c.symbol === "string")
      .map((c) => String(c.symbol).toUpperCase());
    const fresh = {
      coins: [...new Set(coins)],
      businessId: typeof json.business_id === "string" ? json.business_id : null,
      at: Date.now(),
    };
    this.coinsCache = fresh;
    return fresh;
  }

  private async businessId(): Promise<string> {
    if (this.config.businessId) return this.config.businessId;
    const { businessId } = await this.supportedCoins();
    if (!businessId) throw new CoinpayError("CoinPay business id unknown", 502, "no_business");
    return businessId;
  }

  private async raw(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.origin}${path}`, {
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
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
  ): Promise<unknown> {
    const response = await this.raw(path, init);
    const json = await readJson(response);
    if (!response.ok) {
      // CoinPay's `error` string says what was wrong ("No BTC wallet
      // configured..."), and carries no payer detail; keep it.
      throw new CoinpayError(
        `coinpay request failed (${response.status})${providerError(json)}`,
        response.status,
        "request_failed",
      );
    }
    return json;
  }
}

function splitRef(ref: string): [string, string] {
  const i = ref.indexOf(":");
  return i < 0 ? ["", ref] : [ref.slice(0, i), ref.slice(i + 1)];
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function providerError(json: unknown): string {
  const error = (json as { error?: unknown } | null)?.error;
  return typeof error === "string" ? `: ${error.slice(0, 200)}` : "";
}

/** Where a stored ref can be paid again (a replayed checkout), when known. */
export function paymentUrlForRef(ref: string | null | undefined, apiBase?: string): string | null {
  if (!ref) return null;
  const [rail, id] = splitRef(ref);
  if (!id) return null;
  const origin = normaliseApiOrigin(apiBase);
  if (rail === "crypto") return `${origin}/pay/${encodeURIComponent(id)}`;
  if (rail === "paypal") return `${origin}/pay/paypal/${encodeURIComponent(id)}`;
  return null;
}
