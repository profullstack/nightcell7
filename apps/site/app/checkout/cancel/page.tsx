import type { Metadata } from "next";
import { CATALOG } from "@nightcell7/entitlements";
import { PageShell } from "../../_components/page-shell";

export const metadata: Metadata = { title: "Checkout canceled" };

export default function CheckoutCancelPage() {
  const episode = CATALOG[0];
  return (
    <PageShell label="Checkout" title="Checkout canceled" lede="Nothing was charged.">
      <p>
        {episode ? (
          <a className="button button--commerce" href={`/checkout/${episode.episodeId}`}>
            Try again
          </a>
        ) : null}
      </p>
    </PageShell>
  );
}
