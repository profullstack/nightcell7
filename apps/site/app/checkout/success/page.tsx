import type { Metadata } from "next";
import { PageShell } from "../../_components/page-shell";

export const metadata: Metadata = { title: "Payment pending" };

/**
 * Where CoinPay sends the buyer back. It says *pending* and nothing more:
 * only a verified webhook unlocks the episode (PRD §24.2).
 */
export default function CheckoutSuccessPage() {
  return (
    <PageShell
      label="Checkout"
      title="Payment pending"
      lede="Thanks. Your unlock appears as soon as CoinPay confirms the payment."
    >
      <p>
        Crypto payments confirm after the network does, usually within a few minutes. PayPal
        payments can take up to about ten minutes.
      </p>
      <p>
        Signed in? The episode shows up in your <a href="/library">library</a>. Bought as a guest?
        Your one-time claim link arrives by email.
      </p>
    </PageShell>
  );
}
