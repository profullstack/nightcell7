import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { AuthForm } from "../_components/auth-form";

export const metadata: Metadata = {
  title: "Create an account",
  description: "A free account unlocks multiplayer and your library.",
};

export default function RegisterPage() {
  return (
    <PageShell
      label="Account"
      title="Create an account"
      lede="Free. Required for online multiplayer and to own an episode — not required to play the demo."
    >
      <AuthForm
        endpoint="/api/v1/auth/sign-up/email"
        submitLabel="Create account"
        fields={[
          {
            name: "displayName",
            label: "Display name",
            autoComplete: "nickname",
            placeholder: "How you appear in matches",
            minLength: 3,
            help: "3–20 characters. Letters, digits, underscore, dot and dash.",
          },
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "new-password",
            minLength: 12,
            help: "At least 12 characters.",
          },
        ]}
        // `name` is Better Auth's real-name field; we do not ask for one, so it
        // mirrors the display name rather than sitting empty.
        extra={{ name: "" }}
        successMessage={
          <>
            <strong>Check your email.</strong> We sent a verification link. You need to verify
            before you can sign in — that requirement exists for abuse prevention and match records,
            not to sell you anything.
          </>
        }
      >
        <p className="auth-form__foot">
          Already have an account? <a href="/login">Sign in</a>.
        </p>
      </AuthForm>

      <h3>What an account is for</h3>
      <ul>
        <li>Online multiplayer, which is free but needs a verified identity for moderation</li>
        <li>Your library, if you buy an episode</li>
        <li>Reconnecting to a match you dropped out of</li>
        <li>Reporting and blocking</li>
      </ul>
      <p>
        The demo needs none of this. See <a href="/privacy">privacy</a> for exactly what is stored.
      </p>
    </PageShell>
  );
}
