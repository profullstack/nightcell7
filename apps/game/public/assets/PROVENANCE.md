# Asset provenance

Every file in this directory is **generated**, not authored by hand and not
obtained from anywhere. CLAUDE.md requires provenance for any public asset; for
this set the provenance is a commit, a script and a seed.

## How to rebuild

```sh
pnpm assets:build              # models + textures
pnpm assets:build --previews   # ...and render a preview PNG per model
```

Requires Blender 4.5+ on `PATH` or in `$BLENDER`. Blender's bundled Python
supplies numpy, so there is no pip dependency. `manifest.json` records the
Blender version and commit each build came from.

## Sources

| Output                                                                            | Generator                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------- |
| `models/container.glb`                                                            | `tools/art/blender/container.py`             |
| `models/tank.glb`, `deck`, `pipe_rack`, `wall`, `hardpoint`, `stair`, `lamp_mast` | `tools/art/blender/yard.py`                  |
| `models/character.glb`                                                            | `tools/art/blender/character.py`             |
| `models/carbine.glb`                                                              | `tools/art/blender/weapon.py`                |
| `textures/*_{albedo,normal,orm}.webp`                                             | `tools/art/textures/generate.py`             |
| `textures/env_sky.webp`                                                           | `tools/art/textures/generate.py` (`env_sky`) |

Shared modelling helpers live in `tools/art/blender/_lib.py`; the orchestrator
is `tools/art/build-assets.mjs`.

## Licence

Original work, © NIGHTCELL 7. No third-party assets, no photographic sources,
no scanned or traced material, and nothing derived from another game
(CLAUDE.md). Nothing here was produced by a generative image or 3D model.

## Conventions

These are contracts, not style preferences, and `apps/game/src/assets.test.ts`
enforces them:

- **One Blender metre is one game metre.** Props are sized against the collision
  volumes in `packages/multiplayer-sim/src/map.ts`, which is the authority.
- **Models ship no embedded textures.** A GLB carries geometry, UVs and a
  _named_ material slot; `apps/game/src/assets.ts` binds the shared PBR maps to
  that name. Embedding would ship the same steel texture once per model and
  push the shell past its 15 MB download budget (PRD §30).
- **UVs are in world units** at a fixed texel density (one tile per 4 m), so
  adjacent props always agree on texture scale.
- **`COL_` prefixes collision proxies**, exported so each GLB is
  self-describing. The engine collides against the server's map, not against
  art, so these are not rendered.
- **`SOCKET_` prefixes attachment points.** Every weapon has `SOCKET_MUZZLE`.
- **Deterministic.** All randomness is seeded. Rebuilding on the same commit
  produces the same bytes, so a dirty `git status` after a rebuild means a
  generator picked up an unseeded source of randomness.

## Textures

Seven materials — concrete, steel, rust, paint_red, paint_cyan, grating,
rubber — each with albedo, tangent-space normal, and an ORM pack
(R = occlusion, G = roughness, B = metallic), at 1024², encoded as WebP q88.

`env_sky.webp` is an equirectangular environment map for image-based lighting.
It is **required**, not decorative: a physically-based metal is lit almost
entirely by what it reflects, and with no `scene.environmentTexture` every
steel, rust and grating surface in the yard renders pure black.

Lossy WebP is deliberate. The same set encoded losslessly is 12.5 MB against
1.9 MB here — it would consume nearly the whole shell budget and force smaller,
worse textures.
