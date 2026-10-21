"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Method {
  id: string;
  label: string;
  rail: "crypto" | "paypal";
}

interface Methods {
  hosted: boolean;
  methods: Method[];
}

/**
 * Start a CoinPay checkout.
 *
 * The price is never sent: the API prices the order from its own catalog.
 * When CoinPay hosts the picker (checkout sessions) there is one button; until
 * then the buyer picks one of the coins the CoinPay business takes, or PayPal.
 */
export function CheckoutForm({ episodeId }: { episodeId: string }) {
  const [methods, setMethods] = useState<Methods | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/checkout/coinpay/methods", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: Methods) => live && setMethods(data))
      .catch(() => live && setError("Payments are unavailable right now. Try again shortly."));
    return () => {
      live = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const method = String(form.get("method") ?? "").trim();

    try {
      const res = await fetch("/api/v1/checkout/coinpay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          episodeId,
          ...(email ? { email } : {}),
          ...(method ? { method } : {}),
          // One key per attempt: a double click replays, a new choice does not.
          idempotencyKey: `web_${crypto.randomUUID()}`,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        paymentUrl?: string;
        error?: { message?: string };
      };
      if (!res.ok || !body.paymentUrl) {
        setError(body.error?.message ?? "Checkout could not be started. Try another method.");
        return;
      }
      window.location.assign(body.paymentUrl);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!methods && !error) return <p>Loading payment options…</p>;

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <div className="auth-form__row">
        <label htmlFor="checkout-email">Email for your receipt and claim link</label>
        <input id="checkout-email" name="email" type="email" autoComplete="email" />
      </div>

      {methods && !methods.hosted ? (
        <div className="auth-form__row">
          <label htmlFor="checkout-method">Pay with</label>
          <select id="checkout-method" name="method" defaultValue="USDC_POL" required>
            {methods.methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? (
        <p className="auth-form__error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="button button--commerce" type="submit" disabled={busy || !methods}>
        {busy ? "Opening CoinPay…" : "Continue to CoinPay"}
      </button>
    </form>
  );
}
