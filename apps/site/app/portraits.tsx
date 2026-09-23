/**
 * Painted cast portraits.
 *
 * One image per person, 600 × 900, served from `/media/characters`. The game's
 * deploy gate shows the same paintings at thumbnail size, so a player picks the
 * face they have already met here. How each was made (model, prompt, date) is
 * in `docs/art/characters/manifest.json`; see `media/PROVENANCE.md`.
 *
 * `PLAYABLE` is who the yard lets you deploy as: two a side, the same set the
 * game's `CHARACTERS` lists. A "Play as" link opens the free demo with that
 * character already chosen.
 */

export const PORTRAIT_IDS = ["rook", "leila", "vale", "vey", "daryan", "kade"] as const;
export type PortraitId = (typeof PORTRAIT_IDS)[number];

export const PLAYABLE: ReadonlySet<string> = new Set(["rook", "vale", "leila", "daryan"]);

export function playHref(id: string): string {
  return `/play/?mode=demo&character=${encodeURIComponent(id)}`;
}

export function Portrait({
  id,
  name,
  className,
  priority = false,
}: {
  id: string;
  name: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    // Plain <img>, as the lightbox does: a static webp already at display size.
    <img
      className={className}
      src={`/media/characters/${id}.webp`}
      alt={`Painted portrait of ${name}`}
      width={600}
      height={900}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
