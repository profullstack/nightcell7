import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { AuthForm } from "../_components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <PageShell label="Account" title="Sign in" lede="For multiplayer and your library.">
      <AuthForm
        endpoint="/api/v1/auth/sign-in/email"
        submitLabel="Sign in"
        redirectTo="/account"
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
