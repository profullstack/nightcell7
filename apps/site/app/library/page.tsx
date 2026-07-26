import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { LibraryView } from "../_components/account-view";

export const metadata: Metadata = { title: "Library", robots: { index: false } };

export default function LibraryPage() {
  return (
    <PageShell
      label="Account"
      title="Your library"
      lede="Every episode you own, on every supported platform."
    >
      <LibraryView />
    </PageShell>
  );
}
