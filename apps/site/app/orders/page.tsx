import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { OrdersView } from "../_components/account-view";

export const metadata: Metadata = { title: "Orders", robots: { index: false } };

export default function OrdersPage() {
  return (
    <PageShell label="Account" title="Your orders" lede="Every purchase and its current state.">
      <OrdersView />
      <h3>Something looks wrong</h3>
      <p>
        An order can sit in a pending state briefly while the payment confirms. If one is stuck for
        more than an hour, <a href="/support">contact support</a> with its id. See also{" "}
        <a href="/refunds">refunds</a>.
      </p>
    </PageShell>
  );
}
