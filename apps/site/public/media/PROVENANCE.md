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

## `trailer/nightcell7-trailer.mp4`

- **Source:** the same in-engine renderer as the captures above, stepped rather
  than recorded. The page's clocks are moved onto a virtual timeline once the
  deploy gate is up; each frame advances it by 1/30 s, renders, and is captured.
  A GPU-less box that manages a few frames a second therefore produces a steady
  30 fps film. Bots are seeded, so every render is the same fight.
- **Generator:** `tools/art/trailer.mjs`.
- **Reproduce:**
  ```sh
  pnpm --filter @nightcell7/game build
  node tools/art/trailer.mjs --out docs/trailer
  ```
- **This file is a copy.** `docs/trailer/nightcell7-trailer.mp4` is the
  provenance record; this is the copy the site serves, byte-identical to it
  (both manifests carry sha256 `b322ab2597`). `trailer/manifest.json` records
  the commit, render timestamp, encode and beat list, and names
  `docs/trailer/manifest.json` as its source of truth. Re-render into `docs/`
  and copy across, so the two never diverge silently.
- **Encode:** 26 s, 1280 × 720 at 30 fps, H.264 High / AAC, limited-range
  yuv420p, `faststart` — the combination every browser and phone plays.
- **`poster.webp`:** frame at t=3.4 s of the film itself, extracted with
  ffmpeg. Not a separate render, so the poster cannot show something the film
  does not.
- **Licence:** original work, © NIGHTCELL 7. The music under it is "Ironwood
  Oath" by Þrøngva, written for this game by the project owner — no third-party
  licence to comply with. See `apps/game/public/audio/PROVENANCE.md`.
- **Status:** alpha footage of the multiplayer map. Not campaign material, and
  not a cut trailer: no title cards, and no enemy kill lands in frame. Trailer
  v2 in `docs/prd-sandbox-followups.md` §5 replaces it; every page showing this
  file carries `TrailerNotice` saying so.

## `art/*.webp`

Two different kinds of image, kept in one directory but never conflated in the
copy that shows them.

### `art/iron-rain-overview.webp` — the asset contact sheet

- **Source:** offline renders of the exported `.glb` files themselves, one tile
  per model, with the triangle count printed on each. Not concept art and not a
  marketing illustration.
- **Generator:** the IRON RAIN pass, `tools/art/iron-rain/generate.py`; the
  build's own record is `apps/game/public/assets/art-manifest.json`
  (`"version": "iron-rain-3"`, 2026-09-16, `originalGeometry: true`).
- **Current:** yes, and checkably so — the sheet's 28 tiles match
  `apps/game/public/assets/models/` one for one (27 `m3_*.glb` plus
  `m2_carbine_fp.glb`). If that stops being true, the sheet is stale and must be
  re-rendered rather than re-captioned. The earlier passes
  (`docs/art/full-art-overview.webp`, `docs/art/modern-art-overview.webp`) are
  superseded and are deliberately **not** published here.
- **Copy of:** `docs/art/iron-rain-overview.webp`.
- **Licence:** original work, © NIGHTCELL 7. Purchased Synty POLYGON Military
  geometry is recorded separately in `apps/game/public/assets/PROVENANCE.md`;
  the models on this sheet are the original set.

### `art/{deploy-gate,first-contact,into-the-yard,under-fire}-*.webp` — gameplay

- **Source:** captures of the playable build at 1920 × 1080, with the operators,
  weapons and HUD in frame. The scene is played, not posed.
- **Generator:** `tools/art/capture-gameplay.mjs`.
- **Reproduce:**
  ```sh
  pnpm --filter @nightcell7/game build
  node tools/art/capture-gameplay.mjs --out docs/screenshots
  ```
- **Copies of:** `docs/screenshots/`, whose `manifest.json` records the commit
  (`249dcb8b…`, 2026-09-22) and the captions. `art/manifest.json` here carries
  the same fields and names that file as its source of truth.
- **Status:** the multiplayer sandbox. Campaign locations are still not
  photographable, and nothing here should be captioned as campaign material.

## Vector art

The site's marks and illustrations are **not** in this directory. They are
authored as inline SVG in `apps/site/app/art.tsx` so they recolour with the
palette and stay sharp at any scale. Same licence: original work, no traced or
third-party source.

`icon.svg` / `icon-512.png` are the application mark; see
`apps/game/public/PROVENANCE.md`. Regenerate the rasters with
`node tools/art/icons.mjs` rather than editing them by hand.
