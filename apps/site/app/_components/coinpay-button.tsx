"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Sign in with CoinPay. Better Auth runs the OAuth flow (provider "coinpay":
 * PKCE, state, nonce, id_token checked, account bound to the CoinPay `sub`);
 * these buttons only ask it for the CoinPay URL and go there.
 */

interface CoinpayStatus {
  enabled: boolean;
  linked: boolean;
  canDisconnect: boolean;
}

function useCoinpayStatus() {
  const [status, setStatus] = useState<CoinpayStatus | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/me/coinpay", {
        credentials: "include",
        cache: "no-store",
      });
      setStatus(response.ok ? ((await response.json()) as CoinpayStatus) : null);
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { status, reload: load };
}

async function startCoinpay(endpoint: string, body: Record<string, string>): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "coinpay", ...body }),
  });
  const data = (await response.json().catch(() => null)) as {
    url?: string;
    message?: string;
  } | null;
  if (!response.ok || !data?.url)
    throw new Error(data?.message ?? "CoinPay is not available right now.");
  return data.url;
}

/** The primary button on the sign-in and register pages. */
export function CoinpaySignIn({
  next,
  label = "Sign in with CoinPay",
}: {
  next: string;
  label?: string;
}) {
  const { status } = useCoinpayStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status?.enabled) return null;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(
        await startCoinpay("/api/v1/auth/sign-in/social", {
          callbackURL: next,
          errorCallbackURL: "/login?error=coinpay",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <p className="cta-row">
        <button className="button" type="button" onClick={go} disabled={busy}>
          {busy ? "Opening CoinPay…" : label}
        </button>
      </p>
      {error ? (
        <p className="auth-form__error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Connect / Disconnect on the account page. */
export function CoinpayConnect() {
  const { status, reload } = useCoinpayStatus();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("coinpay");
    if (result === "linked") setMessage({ text: "CoinPay connected.", ok: true });
    else if (result === "error") {
      setMessage({
        text: "CoinPay was not connected. It may already be linked to another account.",
        ok: false,
      });
    }
  }, []);

  if (!status?.enabled) return null;

  const connect = async () => {
    setBusy(true);
    try {
      window.location.assign(
        await startCoinpay("/api/v1/auth/link-social", {
          callbackURL: "/account?coinpay=linked",
          errorCallbackURL: "/account?coinpay=error",
        }),
      );
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/me/coinpay", {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not disconnect CoinPay.");
      setMessage({ text: "CoinPay disconnected.", ok: true });
      await reload();
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>CoinPay</h3>
      {status.linked ? (
        <>
          <p>Connected: you can sign in with your CoinPay account.</p>
          {status.canDisconnect ? (
            <p className="cta-row">
              <button
                className="button button--ghost"
                type="button"
                onClick={disconnect}
                disabled={busy}
              >
                Disconnect CoinPay
              </button>
            </p>
          ) : (
            <p>
              CoinPay is this account&apos;s only way in, so it stays connected. Add a passkey to be
              able to disconnect it.
            </p>
          )}
        </>
      ) : (
        <>
          <p>Connect your CoinPay account to sign in with it too.</p>
          <p className="cta-row">
            <button
              className="button button--ghost"
              type="button"
              onClick={connect}
              disabled={busy}
            >
              Connect CoinPay
            </button>
          </p>
        </>
      )}
      {message ? (
        <p
          className={message.ok ? undefined : "auth-form__error"}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}
    </>
  );
}
