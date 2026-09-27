import { YardFilms } from "../yard-films";
import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";
import { AssetSheet, SHEET_SUMMARY } from "../art-pass";
import { NewYardGallery } from "../new-yards";
import { CaptureGallery } from "../gallery";

export const metadata: Metadata = {
  title: "Art and asset gallery",
  description:
    "Explore NIGHTCELL 7 weapons, operators, original yard architecture and in-game screenshots.",
};
export default function GalleryPage() {
  return (
    <PageShell
      wide
      label="Inside NIGHTCELL 7"
      title="Art and asset gallery"
      lede="Weapons, operators and places to fight. Open any image to see it full size."
    >
      <h2>The arsenal and architecture</h2>
      <p>{SHEET_SUMMARY}</p>
      <AssetSheet />
      <h2>Saffron Freight &amp; Nacre Relay</h2>
      <p>
        Two distinct yards, from the markings on a freight module to the routes around the relay
        plaza. These are captures from the playable game.
      </p>
      <NewYardGallery />
      <h2>Gameplay films</h2>
      <YardFilms />
      <p>
        <a className="button button--primary" href="/yards">
          Choose a yard
        </a>
      </p>
      <h2>Ardavan Yard</h2>
      <CaptureGallery />
    </PageShell>
  );
}
