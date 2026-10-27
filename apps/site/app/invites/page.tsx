import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { InvitesView } from "../_components/codes-view";

export const metadata: Metadata = { title: "Invites", robots: { index: false } };

export default function InvitesPage() {
  return (
    <PageShell
      label="Account"
      title="Invites"
      lede="Three per account. Hand them to people you want in the cell."
    >
      <InvitesView />
    </PageShell>
  );
}
