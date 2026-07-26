import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { AuthForm } from "../_components/auth-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <PageShell
      label="Account"
      title="Reset your password"
      lede="We will email you a link. It works once and expires."
    >
      <AuthForm
        endpoint="/api/v1/auth/forget-password"
        submitLabel="Send reset link"
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
        extra={{ redirectTo: "/reset-password" }}
        successMessage={
          <>
            <strong>Check your email.</strong> If an account exists for that address, a reset link
            is on its way. We do not confirm whether an address is registered — that would let
            anyone test which emails have accounts.
          </>
        }
      >
        <p className="auth-form__foot">
          Remembered it? <a href="/login">Sign in</a>.
        </p>
      </AuthForm>
    </PageShell>
  );
}
