"use client";

import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * Browser client for Better Auth, used only for the passkey ceremonies (the
 * WebAuthn calls need the browser API and the plugin's challenge handling).
 * Everything else on the site talks to /api/v1/auth with plain fetch.
 */
export const authClient = createAuthClient({
  basePath: "/api/v1/auth",
  plugins: [passkeyClient()],
});

/** True when this browser can do WebAuthn at all. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

/** Who is signed in, from Better Auth's own session endpoint. */
export async function currentSession(): Promise<{ userId: string; email: string } | null> {
  try {
    const response = await fetch("/api/v1/auth/get-session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: { id: string; email: string } } | null;
    return body?.user ? { userId: body.user.id, email: body.user.email } : null;
  } catch {
    return null;
  }
}
