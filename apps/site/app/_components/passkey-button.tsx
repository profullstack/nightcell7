"use client";

import { useEffect, useState } from "react";
import { authClient, passkeysSupported } from "./auth-client";

/** Sign in with a passkey already saved to an account, then run `onSignedIn`. */
export function PasskeySignIn({
  onSignedIn,
  label = "Sign in with a passkey",
}: {
  onSignedIn: () => void;
  label?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSupported(passkeysSupported()), []);
  if (!supported) return null;

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        setError(
          "No passkey worked for this site. Use the email link instead; you can add a passkey from your account afterwards.",
        );
        return;
      }
      onSignedIn();
    } catch {
      setError("The passkey prompt was closed or failed. Try again or use the email link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="button button--ghost" type="button" onClick={signIn} disabled={busy}>
        {busy ? "Waiting for your passkey…" : label}
      </button>
      {error ? (
        <p className="auth-form__error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Save a passkey to the signed-in account. */
export function AddPasskey() {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setSupported(passkeysSupported()), []);
  if (!supported) return <p>This browser cannot save a passkey. Email sign-in links still work.</p>;

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await authClient.passkey.addPasskey();
      setMessage(
        result?.error
          ? { ok: false, text: "The passkey was not saved. Try again." }
          : { ok: true, text: "Passkey saved. Next time, sign in with it." },
      );
    } catch {
      setMessage({ ok: false, text: "The passkey prompt was closed or failed. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="cta-row">
        <button className="button button--ghost" type="button" onClick={add} disabled={busy}>
          {busy ? "Waiting for your device…" : "Add a passkey"}
        </button>
      </p>
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
