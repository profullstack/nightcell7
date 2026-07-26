import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";

export const metadata: Metadata = { title: "Verify your email" };

/**
 * Informational only.
 *
 * The verification link points straight at the API, which validates the token
 * and redirects. This page is where people land when they open the site
 * before clicking, or when a link has already been used.
 */
export default function VerifyEmailPage() {
  return (
    <PageShell
      label="Account"
      title="Verify your email"
      lede="One click in your inbox and you are done."
    >
      <p>
        We sent a verification link when you registered. Open it and you will be signed in
        automatically.
      </p>

      <h3>Nothing arrived</h3>
      <ul>
        <li>Check spam — a new domain often lands there first.</li>
        <li>
          The link expires after 24 hours. If yours has, sign in and we will send a fresh one.
        </li>
        <li>
          Still nothing? <a href="/support">Contact support</a> and we will verify you by hand.
        </li>
      </ul>

      <h3>Why verification is required</h3>
      <p>
        Online multiplayer is free, but it needs an identity that survives a ban and can be attached
        to a match record and a report. An unverified email makes all of that meaningless. It is not
        a paywall — the demo needs no account at all.
      </p>

      <p className="cta-row">
        <a className="button button--ghost" href="/login">
          Sign in
        </a>
      </p>
    </PageShell>
  );
}
