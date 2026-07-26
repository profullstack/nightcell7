import type { Metadata } from "next";
import { PageShell, DraftNotice } from "../_components/page-shell";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <PageShell label="Legal" title="Terms of use" lede="The agreement between you and NIGHTCELL 7.">
      <DraftNotice>
        Working draft, not yet reviewed by a qualified lawyer. Do not rely on this as a final
        agreement.
      </DraftNotice>

      <h3>Early build</h3>
      <p>
        NIGHTCELL 7 is in active development. Features described on this site may change, and the
        build you play today is not representative of a finished game.
      </p>

      <h3>What a purchase gives you</h3>
      <p>
        A personal, non-transferable licence to play the episode you bought on the supported
        platforms, including both campaigns and the Complete Truth epilogue. You are buying access
        to the game, not ownership of its content.
      </p>

      <h3>Accounts</h3>
      <p>
        You are responsible for keeping your credentials secure. We may suspend an account that
        breaches the <a href="/community-guidelines">community guidelines</a> or is involved in
        payment fraud.
      </p>

      <h3>Acceptable use</h3>
      <ul>
        <li>Do not modify the client to gain a multiplayer advantage.</li>
        <li>Do not attempt to disrupt, overload or gain unauthorised access to the services.</li>
        <li>
          Do not redistribute game content. Browser assets being fetchable is not permission to
          republish them.
        </li>
      </ul>

      <h3>Availability</h3>
      <p>
        The Multiplayer Alpha is provided as-is and may be taken offline for maintenance or ended
        entirely. Your purchased single-player content does not depend on it.
      </p>

      <h3>Fiction</h3>
      <p>NIGHTCELL 7 is a work of fiction. See the notice in the footer of every page.</p>
    </PageShell>
  );
}
