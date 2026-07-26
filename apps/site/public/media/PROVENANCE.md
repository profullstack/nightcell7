# Media provenance

CLAUDE.md: "No public asset without provenance" and "preserve prompts, sources,
licences and dates". Everything served from `apps/site/public/media` is
accounted for here.

## `yard/*.webp`

- **Source:** in-engine captures of `ARDAVAN_YARD` rendered by `apps/game`
  (Babylon.js). Not concept art, not a render from another tool, and not
  sourced from anywhere outside this repository.
- **Generator:** `tools/art/capture.mjs`, driving the named vantages declared in
  `apps/game/src/photo.ts`.
- **Reproduce:**
  ```sh
  pnpm --filter @nightcell7/game build
  node tools/art/capture.mjs --out apps/site/public/media/yard
  ```
  The scene is deterministic apart from procedural noise seeds, so a given
  commit reproduces the same framings. `yard/manifest.json` records the commit,
  capture timestamp, viewport and per-shot camera transform.
- **Licence:** original work, © NIGHTCELL 7. No third-party assets, textures,
  models or photographs are involved — all surface texture is generated at
  runtime in `apps/game/src/world.ts`.
- **Status:** these are greybox frames. The site labels them as such, and that
  label must survive any copy edit until the map ships final art.

## Vector art

The site's marks and illustrations are **not** in this directory. They are
authored as inline SVG in `apps/site/app/art.tsx` so they recolour with the
palette and stay sharp at any scale. Same licence: original work, no traced or
third-party source.

`icon.svg` / `icon-512.png` are the application mark; see
`apps/game/public/PROVENANCE.md`. Regenerate the rasters with
`node tools/art/icons.mjs` rather than editing them by hand.
