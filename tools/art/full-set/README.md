# Full tactical art pipeline

This pipeline rebuilds the entire 31-model runtime inventory. The three original
C7 study assets are the starting point for the palette and weapon family.
Characters retain the working skeletons and animation clips; licensed scenery
retains its base topology and receives new geometry and surface treatment.

Install isolated build dependencies with:

```sh
npm ci --prefix tools/art/full-set --workspaces=false --ignore-scripts
BLENDER=/path/to/blender pnpm assets:build --models-only
BLENDER=/path/to/blender pnpm assets:build --textures-only
node tools/art/full-set/validate.mjs
```

`overhaul.py` reads converted baseline models from the pinned Git commit listed
in the script. `optimize.mjs` welds identical vertices and compacts attributes
without changing texture density or requiring a network decoder. Sockets and
animation channels survive optimization. UVs outside 0–1 stay full precision.
`validate.mjs` validates all 31 shipped files and their provenance hashes.

Render every export with:

```sh
blender --background --factory-startup --threads 4 --python-exit-code 1 \
  --python tools/art/full-set/preview.py -- --pack build/full-art/output
```

`--only <name>` selects one preview. `overhaul.py --only name,name` updates a
subset and merges its metadata into the build manifest. Build outputs and editable
Blender scenes stay under `build/full-art/output`; raw licensed sources are never
opened or overwritten.

After building the game, regenerate the marketing gallery with:

```sh
pnpm --filter @nightcell7/game build
node tools/art/capture.mjs --chrome /path/to/chromium --width 1600 --height 900
```

The gallery is actual Babylon gameplay geometry. Studio model renders are separate
review images. See `docs/art/full-tactical-overhaul.md` and
`apps/game/public/assets/PROVENANCE.md` for coverage and retained licenses.
