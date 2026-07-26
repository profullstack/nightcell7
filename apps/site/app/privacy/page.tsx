import type { Metadata } from "next";
import { PageShell, DraftNotice } from "../_components/page-shell";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <PageShell
      label="Legal"
      title="Privacy"
      lede="What is collected, why, and what is deliberately not."
    >
      <DraftNotice>Working draft, not yet reviewed by a data-protection professional.</DraftNotice>

      <h3>Never collected</h3>
      <p>
        Without your explicit consent we do not collect any of the following, and the game contains
        no code to do so:
      </p>
      <ul>
        <li>Precise location</li>
        <li>Contacts</li>
        <li>Microphone or camera input</li>
        <li>Browsing history outside this site</li>
        <li>Raw filesystem paths</li>
        <li>Voice recordings</li>
        <li>Device fingerprints beyond what a session needs</li>
      </ul>

      <h3>Required to run an account</h3>
      <ul>
        <li>Email address, and whether it is verified</li>
        <li>Display name</li>
        <li>Session records, so you can revoke a device</li>
        <li>Orders and entitlements — what you bought and what you own</li>
      </ul>

      <h3>Required to run multiplayer</h3>
      <ul>
        <li>Account id, display name and selected region</li>
        <li>Platform, build and protocol version, for compatibility and diagnostics</li>
        <li>Match events and result summaries</li>
        <li>Latency and packet-loss diagnostics</li>
        <li>Reports, blocks and bans</li>
        <li>Coarse network metadata, kept only as long as abuse and reliability work requires</li>
      </ul>

      <h3>Optional, only with consent</h3>
      <p>
        Performance and funnel analytics — renderer and preset, boot errors, mission start and
        completion, session duration, queue time, match completion and disconnect rates. Declining
        changes nothing about how the game plays.
      </p>

      <h3>Payments</h3>
      <p>
        Payments are handled by CoinPayPortal. We store an order reference, amount, currency and
        status. Payer details that the provider sends us are excluded from our logs by design.
      </p>

      <h3>Your local saves</h3>
      <p>
        Single-player progress is stored on your device, not on our servers. Clearing your browser
        storage deletes it, and we cannot recover it.
      </p>
    </PageShell>
  );
}
