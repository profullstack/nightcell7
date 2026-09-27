import { YardShowcase } from "../new-yards";
import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";

export const metadata: Metadata = { title: "News" };

interface Entry {
  date: string;
  title: string;
  body: string;
}

/**
 * Development log.
 *
 * Kept as data here until there is enough of it to justify MDX. Entries record
 * what actually shipped, not what is planned.
 */
const ENTRIES: Entry[] = [
  {
    date: "2026-09-27",
    title: "Two new yards: Saffron Freight and Nacre Relay",
    body: "Take the cargo lanes of Saffron Freight or cross the open plaza at Nacre Relay. Both yards bring new layouts and architectural art to free bot matches, range practice and exploration. Choose your yard and time of day on the deploy screen, and see the new screenshots in the art gallery.",
  },
  {
    date: "2026-07-26",
    title: "Ardavan Yard is standing up",
    body: "The 6v6 map now exists as collision geometry the server simulates, with three lanes, two vertical routes and protected spawns at both ends. It started as bare geometry, but the shape of the map is final and the server enforces exactly what you see.",
  },
  {
    date: "2026-07-26",
    title: "The server decides what happened",
    body: "Multiplayer is server-authoritative end to end. Clients send input intent only — movement axes, view angles, a button bitfield — and never a position, a hit, an ammunition count or a score. Client prediction runs the identical movement code as the server, so a correction is normally imperceptible, and where they disagree the server wins by definition.",
  },
  {
    date: "2026-07-25",
    title: "First deployment",
    body: "The whole stack is live: marketing site, game shell, API, authoritative match server and background worker. Commerce is wired through CoinPayPortal with an order state machine that separates payment from fulfilment, so a failed unlock can be retried without charging anyone twice.",
  },
];

export default function NewsPage() {
  return (
    <PageShell
      label="Development"
      title="News"
      lede="What has actually shipped. No roadmap promises here — those belong on the roadmap."
    >
      {ENTRIES.map((entry) => (
        <article key={entry.title} className="entry">
          <p className="entry__date">{entry.date}</p>
          <h3>{entry.title}</h3>
          <p>{entry.body}</p>
        </article>
      ))}

      <YardShowcase />
      <p>
        <a href="/gallery">View the updated art and asset gallery</a>
      </p>
    </PageShell>
  );
}
