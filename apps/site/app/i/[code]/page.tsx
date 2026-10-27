import type { Metadata } from "next";
import { PageShell } from "../../_components/page-shell";
import { HoldInvite } from "../../_components/codes-view";

export const metadata: Metadata = { title: "You're invited", robots: { index: false } };

export default async function InviteLanding({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw)
    .replace(/[^A-Za-z0-9-]/g, "")
    .slice(0, 40);
  const next = encodeURIComponent(`/invites?code=${code}`);
  return (
    <PageShell
      label="Invite"
      title="Someone wants you in the cell"
      lede="NIGHTCELL 7: FALSE DAWN. Two campaigns, one night, and a free multiplayer alpha."
    >
      <HoldInvite code={code} />
      <p>
        Your invite: <code>{code}</code>
      </p>
      <p>
        Create an account, verify your email, then accept the invite on your invites page. The free
        demo and multiplayer need nothing else.
      </p>
      <p className="cta-row">
        <a className="button button--primary" href="/register">
          Create an account
        </a>
        <a className="button button--ghost" href={`/login?next=${next}`}>
          I have an account
        </a>
      </p>
    </PageShell>
  );
}
