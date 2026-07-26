import type { Metadata } from "next";
import { PageShell, DraftNotice } from "../_components/page-shell";

export const metadata: Metadata = { title: "Refunds" };

export default function RefundsPage() {
  return (
    <PageShell
      label="Commerce"
      title="Refunds"
      lede="What happens to your purchase, your access and your saves if you ask for your money back."
    >
      <DraftNotice>
        Working draft. This policy has not yet been reviewed by a qualified professional, and
        applicable consumer law plus CoinPayPortal&rsquo;s own rules take priority over anything
        written here.
      </DraftNotice>

      <h3>Requesting a refund</h3>
      <p>
        Contact <a href="/support">support</a> with your order reference. Refunds are issued through
        CoinPayPortal where the payment method supports it. Because payments settle in crypto, a
        manual refund requires us to verify the destination address before sending anything — that
        check is deliberate and can take longer than a card refund.
      </p>

      <h3>What a refund removes</h3>
      <ul>
        <li>Access to the refunded episode: both campaigns and the Complete Truth epilogue.</li>
        <li>The ability to download that episode&rsquo;s content packs.</li>
        <li>Any offline licence issued for that episode.</li>
      </ul>

      <h3>What a refund does not remove</h3>
      <ul>
        <li>Your account.</li>
        <li>The free demo.</li>
        <li>
          Free Multiplayer Alpha access. Refunding an episode does not restrict multiplayer — only a
          separate community or payment-fraud decision does.
        </li>
        <li>Your local single-player progress, which stays on your device.</li>
      </ul>

      <h3>Disputed and reversed payments</h3>
      <p>
        If a payment is disputed or reversed, access to the associated episode is suspended while it
        is reviewed rather than deleted outright, so it can be restored if the dispute resolves in
        your favour.
      </p>

      <h3>Records</h3>
      <p>
        Every change to what you own is written to an append-only history, so a support agent can
        always tell you exactly what happened to your purchase and when.
      </p>
    </PageShell>
  );
}
