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

      <h3>Website analytics</h3>
      <p>
        This website (nightcell7.com) uses CrawlProof for basic traffic analytics. It records page
        views and referrers so we can tell whether anyone is reading this. It does not use cookies
        for tracking, does not build a cross-site profile of you, and does not follow you to other
        websites.
      </p>
      <p>
        This applies to the marketing site only.{" "}
        <strong>The game itself does not phone home.</strong> Launching, playing the demo or playing
        a mission sends no analytics.
      </p>
      <p>
        Blocking it changes nothing about how the site or the game works. Any content blocker, or a
        browser Do Not Track setting, will stop it.
      </p>

      <h3>In-game analytics — only with consent</h3>
      <p>
        Performance and funnel analytics inside the game — renderer and preset, boot errors, mission
        start and completion, session duration, queue time, match completion and disconnect rates —
        are opt-in and off until you say otherwise. Declining changes nothing about how the game
        plays.
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
