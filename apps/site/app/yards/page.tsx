import { YardFilms } from "../yard-films";
import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { YardShowcase, NewYardGallery } from "../new-yards";
import { CapturePlate } from "../gallery";

export const metadata: Metadata = {
  title: "The yards",
  description:
    "Explore Ardavan Yard, Saffron Freight and Nacre Relay. Three free-play yards with distinct routes and architecture.",
};
export default function YardsPage() {
  return (
    <PageShell
      wide
      label="Free to play"
      title="Three yards. Learn every angle."
      lede="Choose your ground, your operator and the time of day. Fight alongside your squad, practice on the range, or explore at your own pace."
    >
      <YardShowcase />
      <h2>Watch the yards in action</h2>
      <YardFilms />
      <h2>Ardavan Yard</h2>
      <p>
        The original industrial yard: three lanes, storage tanks, pipe racks and two elevated
        routes. Ardavan also hosts the online 6v6 alpha.
      </p>
      <CapturePlate name="west-catwalk" label="Ardavan Yard" />
      <a className="button button--ghost" href="/play?mode=demo&yard=ardavan-yard">
        Play Ardavan Yard
      </a>
      <h2>Day shift. Night shift.</h2>
      <p>
        Explore the new layouts from above and on the ground. Open a frame to see the full scene.
      </p>
      <NewYardGallery />
      <p>
        <a href="/gallery">Explore the art and asset gallery</a>
      </p>
    </PageShell>
  );
}
