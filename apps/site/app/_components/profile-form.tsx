"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ProfileFields } from "@profullstack/profile/react";

type Values = Record<string, string | null>;

/**
 * The signup profile on /account: loaded with GET /api/v1/me/profile, saved
 * with PATCH. Re-keyed on save so the inputs show what the server normalized.
 */
export function ProfileForm() {
  const [values, setValues] = useState<Values | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/me/profile", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile?: Values } | null) => setValues(data?.profile ?? {}))
      .catch(() => setValues({}));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      const res = await fetch("/api/v1/me/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        profile?: Values;
        errors?: Record<string, string>;
      };
      if (res.ok) {
        setErrors({});
        setValues(data.profile ?? values);
        setStatus("Saved.");
      } else {
        setErrors(data.errors ?? {});
        setStatus(
          data.errors ? "A few of those fields need another look." : "Could not save. Try again.",
        );
      }
    } catch {
      setStatus("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!values) return <p>Loading…</p>;
  return (
    <form className="auth-form" onSubmit={save}>
      <ProfileFields
        key={JSON.stringify(values)}
        defaultValues={values}
        errors={errors}
        idPrefix="account-"
      />
      <button className="button button--primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save details"}
      </button>
      {status ? <p className="auth-form__foot">{status}</p> : null}
    </form>
  );
}
