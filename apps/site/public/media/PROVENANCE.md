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
- **Licence:** original work, © NIGHTCELL 7. The current captures use the IRON RAIN
  original geometry, rigs and generated surface textures. Model generation is
  in `tools/art/iron-rain/generate.py`; texture sources and prompts are recorded
  in `tools/art/iron-rain/texture-prompts.md`. See
  `apps/game/public/assets/PROVENANCE.md` for the complete asset record.
- **Status:** in-engine IRON RAIN alpha art from published game revision
  `f2f77774c6ebe54d4a8421653f4025da175d90a8`. These images show the multiplayer
  arena; they do not depict completed campaign locations.
- **Capture environment:** Chromium 143.0.7499.0 with SwiftShader, at 1600 × 900.
  The capture harness pauses the warmed-up photo renderer before screenshot
  readback. Normal gameplay rendering is unaffected.

## Vector art

The site's marks and illustrations are **not** in this directory. They are
authored as inline SVG in `apps/site/app/art.tsx` so they recolour with the
palette and stay sharp at any scale. Same licence: original work, no traced or
third-party source.

`icon.svg` / `icon-512.png` are the application mark; see
`apps/game/public/PROVENANCE.md`. Regenerate the rasters with
`node tools/art/icons.mjs` rather than editing them by hand.
