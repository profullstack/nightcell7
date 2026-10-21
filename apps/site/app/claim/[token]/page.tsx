import type { Metadata } from "next";
import { PageShell } from "../../_components/page-shell";
import { ClaimView } from "../../_components/claim-view";

export const metadata: Metadata = {
  title: "Claim your episode",
  // A claim link is a secret; keep it out of indexes and other sites' logs.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <PageShell
      label="Checkout"
      title="Claim your episode"
      lede="You bought without an account. Attach the purchase to one and play."
    >
      <ClaimView token={decodeURIComponent(token)} />
    </PageShell>
  );
}
