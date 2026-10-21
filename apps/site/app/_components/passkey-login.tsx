"use client";

import { PasskeySignIn } from "./passkey-button";

/** Passkey sign-in on the login page; a client wrapper so it can redirect. */
export function PasskeyLogin({ next }: { next: string }) {
  return <PasskeySignIn onSignedIn={() => window.location.assign(next)} />;
}
