"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Gift codes and invites, rendered in the browser for the same reason as the
 * account view: the session is an HttpOnly cookie the browser already holds.
 *
 * A gift code is Episode 1 for one account. Invites are scarce (three per
 * account), single use, and say who brought whom in; they unlock nothing on
 * their own.
 */

const INVITE_KEY = "nc7_invite";

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as ApiBody;
  return { ok: response.ok, data };
}

interface ApiBody {
  error?: string | { message?: string };
  message?: string;
  invite?: { url: string };
}

const errorOf = (data: ApiBody, fallback: string): string =>
  (typeof data.error === "string" ? data.error : data.error?.message) ?? data.message ?? fallback;

export function RedeemCode() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    const { ok, data } = await postJson("/api/v1/me/credits/redeem", { code });
    setBusy(false);
    if (!ok) return setMsg({ ok: false, text: errorOf(data, "That code did not work.") });
    setCode("");
    setMsg({ ok: true, text: "Episode 1 is in your library." });
  }

  return (
    <form className="auth-form" onSubmit={redeem}>
      <div className="auth-form__row">
        <label htmlFor="codes-field-1">Gift code</label>
        <input
          id="codes-field-1"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="NC7-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          required
          style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase" }}
        />
      </div>
      <p className="cta-row">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? "Redeeming…" : "Redeem"}
        </button>
        {msg?.ok ? <a href="/library">Open your library</a> : null}
      </p>
      {msg ? (
        <p className={msg.ok ? undefined : "auth-form__error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}

interface InviteRow {
  id: string;
  note: string;
  createdAt: number;
  expiresAt: number | null;
  usedAt: number | null;
  revokedAt?: number | null;
}

interface InvitesData {
  quota: { total: number; used: number; left: number };
  invites: InviteRow[];
  invited: boolean;
}

function inviteState(i: InviteRow): string {
  if (i.revokedAt) return "revoked";
  if (i.usedAt) return `accepted ${new Date(i.usedAt).toISOString().slice(0, 10)}`;
  if (i.expiresAt && i.expiresAt < Date.now()) return "expired";
  return i.expiresAt ? `open until ${new Date(i.expiresAt).toISOString().slice(0, 10)}` : "open";
}

export function InvitesView() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<InvitesData | null>(null);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/v1/me/invites", { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) return setSignedIn(false);
        setSignedIn(true);
        setData((await r.json()) as InvitesData);
      })
      .catch(() => setSignedIn(false));
  }, []);

  useEffect(() => {
    load();
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    let held: string | null = null;
    try {
      held = localStorage.getItem(INVITE_KEY);
    } catch {
      // Storage may be blocked; the code can still be typed.
    }
    setCode(fromUrl ?? held ?? "");
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);
    const { ok, data: d } = await postJson("/api/v1/me/invites", { note });
    if (!ok) return setMsg({ ok: false, text: errorOf(d, "Could not make an invite.") });
    setLink(d.invite?.url ?? null);
    setNote("");
    load();
  }

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);
    const { ok, data: d } = await postJson("/api/v1/me/invites/accept", { code });
    if (!ok) return setMsg({ ok: false, text: errorOf(d, "That invite did not work.") });
    try {
      localStorage.removeItem(INVITE_KEY);
    } catch {
      // nothing to clear
    }
    setMsg({ ok: true, text: "Invite accepted. Welcome to the cell." });
    load();
  }

  if (signedIn === null) return <p>Loading…</p>;
  if (!signedIn) {
    return (
      <div className="notice">
        <strong>You are not signed in.</strong> Sign in to see your invites
        {code ? " and accept the one you were sent" : ""}.
        <p className="cta-row" style={{ marginTop: "1rem" }}>
          <a className="button button--primary" href="/login?next=%2Finvites">
            Sign in
          </a>
          <a className="button button--ghost" href="/register">
            Create an account
          </a>
        </p>
      </div>
    );
  }
  if (!data) return <p>Loading…</p>;

  return (
    <>
      {!data.invited && code ? (
        <>
          <h3>Accept your invite</h3>
          <p>New accounts with a verified email can accept one invite.</p>
          <form className="auth-form" onSubmit={accept}>
            <div className="auth-form__row">
              <label htmlFor="codes-field-2">Invite code</label>
              <input
                id="codes-field-2"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </div>
            <p className="cta-row">
              <button className="button button--primary" type="submit">
                Accept invite
              </button>
            </p>
          </form>
        </>
      ) : null}

      <h3>Invite someone</h3>
      <p>
        {data.quota.left} of {data.quota.total} left. Each invite works once and expires after 30
        days.
      </p>
      <form className="auth-form" onSubmit={create}>
        <div className="auth-form__row">
          <label htmlFor="codes-field-3">Who is it for? (optional)</label>
          <input
            id="codes-field-3"
            value={note}
            maxLength={120}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <p className="cta-row">
          <button className="button button--primary" type="submit" disabled={data.quota.left < 1}>
            Make an invite link
          </button>
        </p>
      </form>
      {link ? (
        <p>
          Send this link; it is shown only once:{" "}
          <code style={{ wordBreak: "break-all" }}>{link}</code>
        </p>
      ) : null}
      {msg ? (
        <p className={msg.ok ? undefined : "auth-form__error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      ) : null}

      {data.invites.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>For</th>
              <th>Made</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {data.invites.map((i) => (
              <tr key={i.id}>
                <td>{i.note || "invite"}</td>
                <td>{new Date(i.createdAt).toISOString().slice(0, 10)}</td>
                <td>{inviteState(i)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

/** Keeps the invite from /i/<code> for after sign-up and email verification. */
export function HoldInvite({ code }: { code: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(INVITE_KEY, code);
    } catch {
      // Storage may be blocked; the link carries the code too.
    }
  }, [code]);
  return null;
}
