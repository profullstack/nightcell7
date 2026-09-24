import manifest from "../public/media/yard/manifest.json";
import { ClickableGallery } from "./_components/clickable-gallery";
import { ClickablePlate, ClickableStrip } from "./_components/clickable-figures";

/**
 * In-engine capture gallery.
 *
 * Captions and filenames come from the capture manifest written by
 * `tools/art/capture.mjs`, so the page cannot claim a shot the tool did not
 * take, and a re-capture updates the copy automatically.
 *
 * These are real frames from the current build. Dressing an unfinished build
 * up as finished art is the one thing a game marketing page must not do — and
 * equally, now that the yard is no longer a greybox, calling it one would be
 * inaccurate in the other direction.
 */

interface Shot {
  name: string;
  caption: string;
  file: string;
}

const SHOTS = manifest.shots as Shot[];

export function CaptureGallery() {
  return (
    <>
      <ClickableGallery
        shots={SHOTS}
        width={manifest.viewport.width}
        height={manifest.viewport.height}
      />
      <p className="gallery__note">
        Click any frame to view it full size. In Ardavan Yard, what you see is what you can take
        cover behind.
      </p>
    </>
  );
}

/** The lead capture, used full-bleed behind the hero. */
export function heroCapture(): Shot | undefined {
  return SHOTS.find((s) => s.name === "yard-approach") ?? SHOTS[0];
}

export function captureByName(name: string): Shot | undefined {
  return SHOTS.find((s) => s.name === name);
}

/**
 * A single wide capture used as a section plate.
 *
 * `label` states what the reader is actually looking at. These are frames from
 * the multiplayer map, so a page that implies they are campaign art would be
 * lying — and PRD §21.12 gates launch on exactly that.
 */
export function CapturePlate({ name, label }: { name: string; label: string }) {
  const shot = captureByName(name);
  if (!shot) return null;

  return (
    <ClickablePlate
      shot={shot}
      label={label}
      width={manifest.viewport.width}
      height={manifest.viewport.height}
    />
  );
}

/** A horizontal strip of named captures. */
export function CaptureStrip({ names }: { names: readonly string[] }) {
  const shots = names.map(captureByName).filter((s): s is Shot => s !== undefined);
  if (shots.length === 0) return null;

  return (
    <ClickableStrip
      shots={shots}
      width={manifest.viewport.width}
      height={manifest.viewport.height}
    />
  );
}

/**
 * Shared honesty notice. Any page showing these frames must carry it, so the
 * disclaimer cannot drift out of sync between pages.
 */
export function CaptureNotice() {
  return (
    <p className="gallery__note">
      Ardavan Yard, the 6v6 multiplayer map, built from Episode 1&rsquo;s refinery. Alpha footage:
      the campaign locations are not shown yet.
    </p>
  );
}
