import Image from "next/image";
import manifest from "../public/media/yard/manifest.json";

/**
 * In-engine capture gallery.
 *
 * Captions and filenames come from the capture manifest written by
 * `tools/art/capture.mjs`, so the page cannot claim a shot the tool did not
 * take, and a re-capture updates the copy automatically.
 *
 * These are real frames from the greybox build, labelled as such. Dressing an
 * unfinished build up as finished art is the one thing a game marketing page
 * must not do.
 */

interface Shot {
  name: string;
  caption: string;
  file: string;
}

const SHOTS = manifest.shots as Shot[];

export function CaptureGallery() {
  const [lead, ...rest] = SHOTS;
  if (!lead) return null;

  return (
    <div className="gallery">
      <figure className="gallery__lead">
        <Image
          src={`/media/yard/${lead.file}`}
          alt={lead.caption}
          width={manifest.viewport.width}
          height={manifest.viewport.height}
          sizes="(min-width: 1100px) 1100px, 100vw"
          priority={false}
        />
        <figcaption>
          <span className="gallery__index">01</span>
          {lead.caption}
        </figcaption>
      </figure>

      <ul className="gallery__grid">
        {rest.map((shot, i) => (
          <li key={shot.name}>
            <figure>
              <Image
                src={`/media/yard/${shot.file}`}
                alt={shot.caption}
                width={manifest.viewport.width}
                height={manifest.viewport.height}
                sizes="(min-width: 900px) 33vw, 100vw"
              />
              <figcaption>
                <span className="gallery__index">{String(i + 2).padStart(2, "0")}</span>
                {shot.caption}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>

      <p className="gallery__note">
        Captured in engine from the current build at {manifest.viewport.width}&times;
        {manifest.viewport.height}. Ardavan Yard is still a greybox: the geometry you see is the
        collision data the multiplayer server enforces, not final art.
      </p>
    </div>
  );
}

/** The lead capture, used full-bleed behind the hero. */
export function heroCapture(): Shot | undefined {
  return SHOTS.find((s) => s.name === "west-catwalk") ?? SHOTS[0];
}
