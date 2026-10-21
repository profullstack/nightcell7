import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATALOG, formatPrice } from "@nightcell7/entitlements";
import { PageShell } from "../../_components/page-shell";
import { CheckoutForm } from "../../_components/checkout-form";

export const metadata: Metadata = { title: "Checkout" };

export function generateStaticParams() {
  return CATALOG.map((entry) => ({ episode: entry.episodeId }));
}

export default async function CheckoutPage({ params }: { params: Promise<{ episode: string }> }) {
  const { episode: episodeId } = await params;
  const entry = CATALOG.find((e) => e.episodeId === episodeId);
  if (!entry) notFound();

  return (
    <PageShell
      label="Checkout"
      title={entry.title}
      lede="One purchase. Both campaigns, the Complete Truth epilogue, and every supported platform."
    >
      <div className="price-block">
        <span className="price">{formatPrice(entry.unitAmount, entry.currency)}</span>
        <span className="price-note">One-time · No subscription</span>
      </div>

      <ul className="includes">
        <li>Rook&rsquo;s campaign and Leila&rsquo;s campaign</li>
        <li>The Complete Truth epilogue, unlocked once you finish both</li>
        <li>Browser, installable PWA, Windows, macOS and Linux</li>
        <li>Offline single-player access</li>
      </ul>

      <CheckoutForm episodeId={entry.episodeId} />

      <p>
        Not sure yet? The demo and the multiplayer alpha are free and need no payment details:{" "}
        <a href="/play?mode=demo">play the free demo</a>.
      </p>

      <h3>How it works</h3>
      <ol>
        <li>You pay on CoinPayPortal, in crypto or with PayPal.</li>
        <li>
          You come back to a page that says <em>pending</em>. That page never grants access by
          itself.
        </li>
        <li>Your unlock happens only when the payment is confirmed by a verified webhook.</li>
        <li>If you bought without an account, you get a one-time claim link by email.</li>
      </ol>
      <p>
        See <a href="/refunds">refunds</a> for what happens if you change your mind.
      </p>
    </PageShell>
  );
}
