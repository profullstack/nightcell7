"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ProfileFields } from "@profullstack/profile/react";
import { safeNext } from "./safe-next";

/**
 * Shared client-side form for the auth pages.
 *
 * Talks to Better Auth on the same origin, so the session cookie is set by the
 * browser and no token is ever handled in JavaScript. Errors are surfaced
 * verbatim from the API's machine-readable code rather than swallowed, because
 * "something went wrong" on a sign-in page is the most frustrating message in
 * software.
 */

export interface Field {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
  minLength?: number;
}

interface Props {
  endpoint: string;
  fields: Field[];
  submitLabel: string;
  /** Where to send the browser on success. */
  redirectTo?: string;
  /**
   * Prefer a same-origin `?next=` path over `redirectTo`, so the game can send
   * a signed-out player here and get them back to the match they asked for.
   */
  honorNext?: boolean;
  /** Shown instead of redirecting, for flows that end in "check your email". */
  successMessage?: ReactNode;
  /** Extra values posted alongside the fields. */
  extra?: Record<string, unknown>;
  /**
   * Signup only: also ask for the house profile (@profullstack/profile) —
   * first and last name required; company, job title and LinkedIn optional.
   */
  profile?: boolean;
  children?: ReactNode;
}

/** The profile fields besides email, which the form already has. */
const PROFILE_FIELDS = [
  "first_name",
  "last_name",
  "company_domain",
  "job_title",
  "linkedin_url",
] as const;

const FRIENDLY_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password do not match an account.",
  USER_ALREADY_EXISTS: "An account with that email already exists.",
  EMAIL_NOT_VERIFIED: "Verify your email before signing in. Check your inbox.",
  PASSWORD_TOO_SHORT: "That password is too short.",
  INVALID_PROFILE: "A few of those fields need another look.",
  INVALID_TOKEN: "That link is invalid or has already been used.",
  TOKEN_EXPIRED: "That link has expired. Request a new one.",
};

export function AuthForm({
  endpoint,
  fields,
  submitLabel,
  redirectTo,
  honorNext,
  successMessage,
  extra,
  profile,
  children,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { ...extra };
    for (const field of fields) payload[field.name] = form.get(field.name);
    if (profile) for (const name of PROFILE_FIELDS) payload[name] = form.get(name);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Same origin, so the session cookie comes back on the response.
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
          error?: { code?: string; message?: string };
          errors?: Record<string, string>;
        };
        setFieldErrors(body.errors ?? {});
        const code = body.code ?? body.error?.code ?? "";
        setError(
          FRIENDLY_ERRORS[code] ??
            body.message ??
            body.error?.message ??
            `That did not work (${response.status}).`,
        );
        setBusy(false);
        return;
      }

      const next = honorNext ? safeNext(window.location.search) : null;
      if (next || redirectTo) {
        window.location.assign(next ?? redirectTo!);
        return;
      }
      setDone(true);
      setBusy(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (done && successMessage) {
    return <div className="notice">{successMessage}</div>;
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate={false}>
      {fields.map((field) => (
        <div className="auth-form__row" key={field.name}>
          <label htmlFor={field.name}>{field.label}</label>
          <input
            id={field.name}
            name={field.name}
            type={field.type ?? "text"}
            autoComplete={field.autoComplete}
            placeholder={field.placeholder}
            required={field.required ?? true}
            minLength={field.minLength}
          />
          {field.help ? <p className="auth-form__help">{field.help}</p> : null}
        </div>
      ))}

      {profile ? (
        <ProfileFields fields={PROFILE_FIELDS} errors={fieldErrors} idPrefix="signup-" />
      ) : null}

      {error ? (
        <p className="auth-form__error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="button button--primary" type="submit" disabled={busy}>
        {busy ? "Working…" : submitLabel}
      </button>

      {children}
    </form>
  );
}
