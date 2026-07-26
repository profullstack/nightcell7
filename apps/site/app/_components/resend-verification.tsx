"use client";

import { useState, type FormEvent } from "react";

/**
 * Resend a verification email.
 *
 * Always reports success, whatever the API says. Distinguishing "sent" from
 * "no such account" here would turn this into an oracle for testing which
 * addresses are registered — the same reason the password-reset flow does not
 * confirm either.
 */
export function ResendVerification({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const email = String(new FormData(event.currentTarget).get("email") ?? "");

    try {
      await fetch("/api/v1/auth/send-verification-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, callbackURL: "/account" }),
      });
      setDone(true);
    } catch {
      // Only a transport failure is worth surfacing; anything the API says
      // about the address stays private.
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice">
        <strong>Sent.</strong> If that address has an unverified account, a new link is on its way.
        It expires in 24 hours. Check spam — a new sending domain often lands there first.
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <div className="auth-form__row">
        <label htmlFor="resend-email">Email</label>
        <input
          id="resend-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={defaultEmail}
          required
        />
      </div>

      {error ? (
        <p className="auth-form__error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="button button--primary" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Resend verification email"}
      </button>
    </form>
  );
}
