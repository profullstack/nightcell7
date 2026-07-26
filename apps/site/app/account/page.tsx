import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { AccountView } from "../_components/account-view";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default function AccountPage() {
  return (
    <PageShell label="Account" title="Your account">
      <AccountView />
    </PageShell>
  );
}
