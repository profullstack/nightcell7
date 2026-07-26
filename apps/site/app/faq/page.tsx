import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";

export const metadata: Metadata = { title: "FAQ" };

const QUESTIONS = [
  {
    q: "What do I get for $9.99?",
    a: "One theater episode: both playable campaigns, roughly 60–90 minutes per side, the Complete Truth epilogue unlocked after you finish both, and every supported platform. No subscription, no battle pass, no loot boxes, no paid weapons.",
  },
  {
    q: "Do I have to buy anything to play?",
    a: "No. The demo gives you a 10–15 minute opening from each side, and the 6v6 Multiplayer Alpha is free to any verified account. You never need to own an episode to play multiplayer.",
  },
  {
    q: "Which side should I play first?",
    a: "Either. Both campaigns are canon and either one is a complete story on its own. Whichever you play second reinterprets the first.",
  },
  {
    q: "Why do I need an account for multiplayer but not the demo?",
    a: "Abuse prevention, reconnect identity, match records, reports and bans. It is not a paywall — multiplayer is free.",
  },
  {
    q: "Is there pay-to-win?",
    a: "No. Nothing affecting damage, armour, movement, matchmaking priority or spawns can be bought. Both factions use mechanically equivalent loadouts.",
  },
  {
    q: "How do payments work?",
    a: "Through CoinPayPortal. Your purchase unlocks only after the payment is confirmed by a verified webhook — the page you land on after paying shows a pending state, not a completed one.",
  },
  {
    q: "Can I play offline?",
    a: "Single-player, yes, once you have downloaded the episode and an offline licence. Multiplayer always requires a connection, a verified account and a compatible build.",
  },
  {
    q: "Is the game finished?",
    a: "No. This is an early build. The multiplayer map is a greybox, the campaigns are not playable yet, and the screenshots on this site are in-engine captures of untextured geometry, labelled as such.",
  },
  {
    q: "Is this about a real conflict?",
    a: "No. Episode 1 is set in an invented near-future crisis. Every organisation, facility, unit and operation is fictional, and neither country is written as the villain.",
  },
];

export default function FaqPage() {
  return (
    <PageShell
      label="Support"
      title="Frequently asked"
      lede="If your question is not here, support is one page away."
    >
      <dl className="faq">
        {QUESTIONS.map((item) => (
          <div key={item.q}>
            <dt>{item.q}</dt>
            <dd>{item.a}</dd>
          </div>
        ))}
      </dl>
      <p>
        Still stuck? <a href="/support">Contact support</a>.
      </p>
    </PageShell>
  );
}
