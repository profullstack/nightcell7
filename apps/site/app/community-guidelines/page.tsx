import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";

export const metadata: Metadata = { title: "Community Guidelines" };

export default function GuidelinesPage() {
  return (
    <PageShell
      label="Multiplayer"
      title="Community guidelines"
      lede="Short, because the multiplayer alpha deliberately has a small surface to misuse."
    >
      <h3>What is expected</h3>
      <ul>
        <li>
          Play the match. Deliberately throwing, blocking team-mates or feeding is not allowed.
        </li>
        <li>No cheating, exploiting geometry, or modifying the client to gain an advantage.</li>
        <li>Display names must not contain slurs, harassment, impersonation or sexual content.</li>
        <li>Do not evade a ban with a new account or a private match code.</li>
      </ul>

      <h3>What we deliberately did not build</h3>
      <p>
        There is no voice chat and no free-form text chat in V1. Communication is limited to a fixed
        set of pings and quick messages. That is a moderation decision: a vocabulary that cannot
        express harassment does not need to be moderated for it.
      </p>

      <h3>Reporting and blocking</h3>
      <p>
        You can report a player from the scoreboard or your match history, and you can block any
        account. Reports carry the match id and server-side session data only — we never upload your
        microphone, screenshots or unrelated device information.
      </p>
      <p>
        Only players who were actually in a match can report someone from it, which keeps
        report-bombing off the table.
      </p>

      <h3>Enforcement</h3>
      <p>
        Restrictions range from a temporary matchmaking suspension to a permanent multiplayer ban.
        Every action is recorded and auditable. A multiplayer ban does not remove episodes you have
        paid for — you keep your single-player content.
      </p>
    </PageShell>
  );
}
