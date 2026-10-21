"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { currentSession } from "./auth-client";
import { MagicLinkForm } from "./magic-link-form";
import { PasskeySignIn } from "./passkey-button";
import { claimMessage, type ClaimState } from "./claim-state";

/**
 * The page behind the emailed `/claim/<token>` link (PRD §23.4).
 *
 * 1. Ask the API what the link is (claimable, used, expired...).
 * 2. Signed in: attach the purchase on one click. Signed out: sign in or sign
 *    up by email link or passkey, and come back here to finish.
 * 3. The worker attaches the order; poll until the episode is ours, then go
 *    to it.
 *
 * Nothing here unlocks content. The API and the worker decide; the page only
 * reports what they said.
 */

interface Status {
  state: ClaimState;
  email: string | null;
  episodeTitle: string | null;
  playUrl: string | null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "claiming" }
  | { kind: "opening"; playUrl: string }
  | { kind: "error"; message: string };

const POLL_MS = 1500;
const POLL_LIMIT = 40;

async function fetchStatus(token: string): Promise<Status> {
  const response = await fetch("/api/v1/checkout/claim/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return (await response.json()) as Status;
}

export function ClaimView({ token }: { token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [session, setSession] = useState<{ email: string } | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const autoTried = useRef(false);
  const claimPath = `/claim/${token}`;

  const load = useCallback(async () => {
    try {
      const [s, me] = await Promise.all([fetchStatus(token), currentSession()]);
      setStatus(s);
      setSession(me);
      if (s.state === "claimed_by_you" && s.playUrl) {
        setPhase({ kind: "opening", playUrl: s.playUrl });
        window.location.assign(s.playUrl);
        return;
      }
      setPhase({ kind: "ready" });
    } catch {
      setPhase({
        kind: "error",
        message: "Could not reach the server. Check your connection and reload this page.",
      });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = useCallback(async () => {
    setPhase({ kind: "claiming" });
    try {
      const response = await fetch("/api/v1/checkout/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        playUrl?: string;
        error?: { code?: string; message?: string };
      };
      if (response.status === 200 && body.playUrl) {
        setPhase({ kind: "opening", playUrl: body.playUrl });
        window.location.assign(body.playUrl);
        return;
      }
      if (response.status !== 202) {
        // The API refused with a reason; re-read the link so the page shows
        // the matching explanation and the right next step.
        await load();
        if (response.status === 429) {
          setPhase({ kind: "error", message: "Too many attempts. Wait a few minutes and retry." });
        } else if (response.status === 401) {
          setPhase({ kind: "error", message: "Your session ended. Sign in again to claim." });
        }
        return;
      }

      // Queued. The worker attaches the order in a second or two.
      for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const next = await fetchStatus(token).catch(() => null);
        if (next?.state === "claimed_by_you" && next.playUrl) {
          setPhase({ kind: "opening", playUrl: next.playUrl });
          window.location.assign(next.playUrl);
          return;
        }
        if (next && next.state !== "claimable") {
          setStatus(next);
          setPhase({ kind: "ready" });
          return;
        }
      }
      setPhase({
        kind: "error",
        message:
          "Claiming is taking longer than it should. Your purchase is safe; reload this page in a minute.",
      });
    } catch {
      setPhase({ kind: "error", message: "Could not reach the server. Try again." });
    }
  }, [token, load]);

  // Coming back from the emailed sign-in link (or a passkey), finish the
  // claim without another click: that is what the person set out to do.
  useEffect(() => {
    if (autoTried.current || phase.kind !== "ready") return;
    if (status?.state !== "claimable" || !session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auto") !== "1") return;
    autoTried.current = true;
    void claim();
  }, [phase, status, session, claim]);

  if (phase.kind === "loading") return <p>Checking your claim link…</p>;
  if (phase.kind === "opening") {
    return (
      <div className="notice" role="status">
        <strong>It is yours.</strong> Opening {status?.episodeTitle ?? "the episode"}…{" "}
        <a href={phase.playUrl}>Go now</a>.
      </div>
    );
  }
  if (!status) {
    return (
      <p className="auth-form__error" role="alert">
        {phase.kind === "error" ? phase.message : "Something went wrong."}
      </p>
    );
  }

  const title = status.episodeTitle ?? "your episode";
  const signInError = signInErrorFromUrl();
  const message = claimMessage(status.state, title);

  return (
    <>
      {phase.kind === "error" ? (
        <p className="auth-form__error" role="alert">
          {phase.message}
        </p>
      ) : null}
      {signInError ? (
        <p className="auth-form__error" role="alert">
          {signInError}
        </p>
      ) : null}

      <div className="notice" role={message.ok ? "status" : "alert"}>
        <strong>{message.heading}</strong> {message.detail}
      </div>

      {status.state === "claimable" ? (
        session ? (
          <>
            <p>
              Signed in as <strong>{session.email}</strong>. Add {title} to this account?
            </p>
            <p className="cta-row">
              <button
                className="button button--primary"
                type="button"
                onClick={() => void claim()}
                disabled={phase.kind === "claiming"}
              >
                {phase.kind === "claiming" ? "Claiming…" : `Claim ${title}`}
              </button>
              <SignOutLink />
            </p>
          </>
        ) : (
          <>
            <h3>Sign in or create an account</h3>
            <p>
              We email a one-click sign-in link. No password needed, and the same link creates your
              account if you do not have one. The claim finishes as soon as you open it.
            </p>
            <MagicLinkForm
              callbackURL={`${claimPath}?auto=1`}
              defaultEmail={status.email ?? ""}
              submitLabel="Email me a sign-in link"
              idPrefix="claim"
            />
            <p className="cta-row" style={{ marginTop: "1rem" }}>
              <PasskeySignIn
                label="I have a passkey"
                onSignedIn={() => window.location.assign(`${claimPath}?auto=1`)}
              />
            </p>
            <p className="auth-form__foot">
              Prefer a password?{" "}
              <a href={`/login?next=${encodeURIComponent(`${claimPath}?auto=1`)}`}>Sign in</a>.
            </p>
          </>
        )
      ) : null}

      {status.state === "pending" ? (
        <p className="cta-row">
          <button className="button button--ghost" type="button" onClick={() => void load()}>
            Check again
          </button>
        </p>
      ) : null}

      {status.state === "claimed" && !session ? (
        <>
          <p>If it was you, sign in to that account and the episode is in your library.</p>
          <MagicLinkForm
            callbackURL="/library"
            defaultEmail={status.email ?? ""}
            submitLabel="Email me a sign-in link"
            idPrefix="claimed"
          />
        </>
      ) : null}

      {status.state === "expired" ? <ResendForm token={token} email={status.email} /> : null}
      {status.state === "invalid" ? <ResendForm email={null} /> : null}

      <p style={{ marginTop: "2rem" }}>
        Stuck? <a href="/support">Contact support</a> with the email you paid with.
      </p>
    </>
  );
}

function signInErrorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const error = new URLSearchParams(window.location.search).get("error");
  if (!error) return null;
  if (/expired/i.test(error)) {
    return "That sign-in link expired. Send yourself a new one below.";
  }
  return "That sign-in link did not work. It may have been used already. Send yourself a new one below.";
}

function SignOutLink() {
  async function signOut() {
    await fetch("/api/v1/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    window.location.reload();
  }
  return (
    <button className="button button--ghost" type="button" onClick={() => void signOut()}>
      Use a different account
    </button>
  );
}

/**
 * Email a fresh claim link. With the old link it goes to the address that
 * paid; without one, to the address typed, but only if it paid for an
 * unclaimed order. The answer is the same either way.
 */
function ResendForm({ token, email }: { token?: string; email: string | null }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const typed = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    try {
      const response = await fetch("/api/v1/checkout/claim/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...(token ? { token } : {}), ...(typed ? { email: typed } : {}) }),
      });
      if (response.status === 429) {
        setError("Too many requests. Try again in an hour, or contact support.");
        return;
      }
      if (!response.ok) {
        setError(`That did not work (${response.status}). Try again.`);
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice" role="status">
        <strong>Sent.</strong> If that address paid for an episode that has not been claimed, a
        fresh claim link is on its way. It works for 7 days. Check spam if it is not there in a few
        minutes.
      </div>
    );
  }

  return (
    <>
      <h3>Get a fresh link</h3>
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="auth-form__row">
          <label htmlFor="resend-claim-email">Email you paid with</label>
          <input
            id="resend-claim-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={email ?? ""}
            required={!token}
          />
        </div>
        {error ? (
          <p className="auth-form__error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Email me a fresh claim link"}
        </button>
      </form>
    </>
  );
}
