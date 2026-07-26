"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageShell, DraftNotice } from "../_components/page-shell";
import { AuthForm } from "../_components/auth-form";

function ResetForm() {
  const token = useSearchParams().get("token");

  if (!token) {
    return (
      <DraftNotice>
        This page needs the link from your reset email. Request one from{" "}
        <a href="/forgot-password">forgot password</a>.
      </DraftNotice>
    );
  }

  return (
    <AuthForm
      endpoint="/api/v1/auth/reset-password"
      submitLabel="Set new password"
      redirectTo="/login"
      fields={[
        {
          name: "newPassword",
          label: "New password",
          type: "password",
          autoComplete: "new-password",
          minLength: 12,
          help: "At least 12 characters.",
        },
      ]}
      extra={{ token }}
    />
  );
}

export default function ResetPasswordPage() {
  return (
    <PageShell label="Account" title="Set a new password">
      <Suspense fallback={<p>Loading…</p>}>
        <ResetForm />
      </Suspense>
    </PageShell>
  );
}
