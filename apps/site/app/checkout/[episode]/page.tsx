import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATALOG, formatPrice } from "@nightcell7/entitlements";
import { PageShell, DraftNotice } from "../../_components/page-shell";

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

      <DraftNotice>
        <strong>Purchasing is not open yet.</strong> The payment integration is built and tested,
        but production credentials are not configured, so no order can currently be completed. We
        would rather tell you that here than take you to a payment page that fails.
      </DraftNotice>

      <p>
        In the meantime the demo and the multiplayer alpha are free and need no payment details:
      </p>
      <p className="cta-row">
        <a className="button button--primary" href="/play?mode=demo">
          Play the free demo
        </a>
        <a className="button button--ghost" href="/multiplayer">
          Multiplayer Alpha
        </a>
      </p>

      <h3>How it will work</h3>
      <ol>
        <li>You are sent to CoinPayPortal to pay.</li>
        <li>
          You come back to a page that says <em>pending</em> — that page never grants access by
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
