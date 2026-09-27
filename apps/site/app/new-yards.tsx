import manifest from "../public/media/new-yards/manifest.json";
import { ClickableGallery } from "./_components/clickable-gallery";
import { ClickablePlate, ClickableStrip } from "./_components/clickable-figures";
import type { LightboxShot } from "./_components/lightbox";

export const NEW_YARD_SHOTS: LightboxShot[] = manifest.shots.map((shot) => ({
  ...shot,
  dir: "new-yards",
}));

export const NEW_YARDS = [
  {
    id: "saffron_freight",
    name: "Saffron Freight",
    shot: "saffron-overview",
    description:
      "Climb the cargo loading roofs, flank the tank farm, or fight through the helicopter service bay and supply convoy.",
  },
  {
    id: "nacre_relay",
    name: "Nacre Relay",
    shot: "nacre-overview",
    description:
      "Take the relay roof stairs, cross the helicopter plaza, or weave between patrol jeeps, field shelters and storage tanks.",
  },
] as const;

export function YardShowcase() {
  return (
    <div className="yard-showcase">
      {NEW_YARDS.map((yard) => {
        const shot = NEW_YARD_SHOTS.find((entry) => entry.name === yard.shot)!;
        return (
          <article key={yard.id}>
            <ClickablePlate
              shot={shot}
              label={yard.name}
              width={manifest.viewport.width}
              height={manifest.viewport.height}
            />
            <h3>{yard.name}</h3>
            <p>{yard.description}</p>
            <a className="button button--ghost" href={`/play?mode=demo&yard=${yard.id}`}>
              Play {yard.name}
            </a>
          </article>
        );
      })}
    </div>
  );
}

export function YardArtGallery() {
  return (
    <ClickableStrip
      shots={NEW_YARD_SHOTS.filter((shot) => shot.name.endsWith("-detail"))}
      width={manifest.viewport.width}
      height={manifest.viewport.height}
    />
  );
}

export function NewYardGallery() {
  return (
    <ClickableGallery
      shots={NEW_YARD_SHOTS}
      width={manifest.viewport.width}
      height={manifest.viewport.height}
    />
  );
}
