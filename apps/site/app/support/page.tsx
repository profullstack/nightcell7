import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <PageShell label="Help" title="Support" lede="Small project, direct answers.">
      <h3>Contact</h3>
      <p>
        Email <a href="mailto:support@nightcell7.com">support@nightcell7.com</a>. Include your order
        reference if the question is about a purchase, and your display name if it is about
        multiplayer.
      </p>

      <h3>Report a bug</h3>
      <p>
        Issues are public:{" "}
        <a
          href="https://github.com/profullstack/nightcell7/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/profullstack/nightcell7/issues
        </a>
        . Include your platform, browser, and what the in-game build number says.
      </p>

      <h3>Common situations</h3>
      <dl className="faq">
        <div>
          <dt>I paid and nothing unlocked</dt>
          <dd>
            Unlocking waits for the payment provider to confirm, so the page after checkout shows a
            pending state on purpose. If it has not resolved within an hour, email us with the order
            reference — a reconciliation job re-checks stuck orders automatically and support can
            see exactly where yours stopped.
          </dd>
        </div>
        <div>
          <dt>I bought as a guest and never got my claim link</dt>
          <dd>Check spam, then email us. Claim links can be reissued to the paying address.</dd>
        </div>
        <div>
          <dt>Multiplayer says I need to update</dt>
          <dd>
            Your build is older than the protocol the servers run. Reload the browser tab, or
            reinstall the PWA. Clients on different protocol versions cannot share a match.
          </dd>
        </div>
        <div>
          <dt>The game will not start</dt>
          <dd>
            Confirm your browser supports WebGL2 and check{" "}
            <a href="/system-requirements">requirements</a>. If it starts and then fails, the boot
            error shown on screen is the useful thing to send us.
          </dd>
        </div>
        <div>
          <dt>I lost my single-player progress</dt>
          <dd>
            Saves live on your device, not our servers, so clearing browser storage removes them
            permanently. Cloud saves are planned but not built.
          </dd>
        </div>
      </dl>

      <h3>Service status</h3>
      <p>
        Current multiplayer and API status is on the <a href="/status">status page</a>.
      </p>
    </PageShell>
  );
}
