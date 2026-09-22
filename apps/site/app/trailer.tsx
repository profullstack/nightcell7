import manifest from "../public/media/trailer/manifest.json";

/**
 * The gameplay trailer.
 *
 * Same rule as the capture gallery: the numbers on the page come from the
 * manifest the render tool wrote, so the copy cannot claim a film that was
 * never made, and re-rendering updates the page rather than the prose.
 *
 * The film is a byte-identical copy of `docs/trailer/nightcell7-trailer.mp4`
 * (matching sha256 in both manifests). The repo copy stays the provenance
 * record; this one is what the site serves.
 */

export const TRAILER = {
  src: `/media/trailer/${manifest.file}`,
  poster: `/media/trailer/${manifest.poster}`,
  width: manifest.width,
  height: manifest.height,
  seconds: Math.round(manifest.seconds),
  megabytes: (manifest.bytes / 1024 / 1024).toFixed(1),
} as const;

/**
 * `preload="none"`.
 *
 * The film is 7 MB — more than the entire rest of the home page. Preloading it
 * would make the landing page four times heavier for every visitor who never
 * presses play, so the poster frame stands in until they do. The poster is a
 * real frame from the film itself, not a separate render.
 */
export function TrailerFilm({ label }: { label: string }) {
  return (
    <figure className="film">
      <video
        className="film__video"
        controls
        preload="none"
        playsInline
        poster={TRAILER.poster}
        width={TRAILER.width}
        height={TRAILER.height}
      >
        <source src={TRAILER.src} type="video/mp4" />
        <p>
          Your browser cannot play this video.{" "}
          <a href={TRAILER.src} download>
            Download the trailer
          </a>{" "}
          ({TRAILER.megabytes} MB, H.264 MP4).
        </p>
      </video>
      <figcaption>
        <span className="film__label">
          {label} &middot; {TRAILER.seconds} seconds &middot; {TRAILER.width}&times;
          {TRAILER.height}
        </span>
        <span>
          Rendered offline from the current build, one frame at a time on a virtual clock, so a
          GPU-less box produces a steady {manifest.fps} fps. The bots are seeded: every render is
          the same fight. Music is &ldquo;{manifest.musicTitle}&rdquo; by {manifest.musicArtist},
          written for this game.
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Shared honesty notice for the film, mirroring `CaptureNotice`.
 *
 * The same rule the gallery follows applies harder to a trailer, because a
 * trailer is the one asset a reader assumes is a promise. This one is alpha
 * footage of the multiplayer map and nothing else.
 */
export function TrailerNotice() {
  return (
    <p className="gallery__note">
      Alpha footage of Ardavan Yard, the 6v6 multiplayer map &mdash; not campaign material, and not
      a cut trailer with title cards. It is the sandbox as it plays today.
    </p>
  );
}
