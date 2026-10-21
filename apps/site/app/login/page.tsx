import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { AuthForm } from "../_components/auth-form";
import { MagicLinkForm } from "../_components/magic-link-form";
import { PasskeyLogin } from "../_components/passkey-login";
import { safeNext } from "../_components/safe-next";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : "";
  const next = safeNext(`?${new URLSearchParams({ next: nextParam })}`) ?? "/account";

  return (
    <PageShell label="Account" title="Sign in" lede="For multiplayer and your library.">
      <p>We email you a one-click link. No password needed; a new address gets a new account.</p>
      <MagicLinkForm callbackURL={next} idPrefix="login" />
      <p className="cta-row" style={{ marginTop: "1rem" }}>
        <PasskeyLogin next={next} />
      </p>

      <h3>Or use a password</h3>
      <AuthForm
        endpoint="/api/v1/auth/sign-in/email"
        submitLabel="Sign in"
        redirectTo="/account"
        honorNext
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
      >
        <p className="auth-form__foot">
          <a href="/forgot-password">Forgot your password?</a>
          {" · "}
          <a href="/register">Create an account</a>
        </p>
      </AuthForm>
    </PageShell>
  );
}
