"use client";

import { useState, type FormEvent } from "react";

/**
 * Email me a sign-in link. The house sign-in: the link proves the address and
 * the address is the account, so the same link signs a new person up.
 *
 * `callbackURL` must be a path on this site; Better Auth resolves it against
 * its own origin after the link is opened.
 */
export function MagicLinkForm({
  callbackURL,
  defaultEmail = "",
  submitLabel = "Email me a sign-in link",
  idPrefix = "magic",
}: {
  callbackURL: string;
  defaultEmail?: string;
  submitLabel?: string;
  idPrefix?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();

    try {
      const response = await fetch("/api/v1/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          callbackURL,
          newUserCallbackURL: callbackURL,
          errorCallbackURL: callbackURL,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(
          response.status === 429
            ? "Too many requests. Wait a minute and try again."
            : (body.message ?? `That did not work (${response.status}).`),
        );
        return;
      }
      setSentTo(email);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="notice" role="status">
        <strong>Check your email.</strong> A sign-in link is on its way to {sentTo}. It works once
        and expires in 15 minutes. Open it in this browser. Not there? Check spam, or{" "}
        <button className="linklike" type="button" onClick={() => setSentTo(null)}>
          send another
        </button>
        .
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <div className="auth-form__row">
        <label htmlFor={`${idPrefix}-email`}>Email</label>
        <input
          id={`${idPrefix}-email`}
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
        {busy ? "Sending…" : submitLabel}
      </button>
    </form>
  );
}
