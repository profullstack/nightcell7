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

## Licensed third-party assets

Not everything here is generated. These are licensed, and their provenance is
the licence rather than a generator script.

| File                            | Source                                                                                                                 | Licence |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------- |
| `models/fighter_swat.glb`       | [Quaternius — Ultimate Modular Characters](https://quaternius.com/packs/ultimatemodularcharacters.html) (`Swat`)       | CC0 1.0 |
| `models/fighter_adventurer.glb` | [Quaternius — Ultimate Modular Characters](https://quaternius.com/packs/ultimatemodularcharacters.html) (`Adventurer`) | CC0 1.0 |

**CC0 1.0** (https://creativecommons.org/publicdomain/zero/1.0/) is a public
domain dedication: unrestricted commercial use, modification and
redistribution, with no attribution required. The attribution above is
courtesy, not obligation.

Converted with `tools/art/blender/import_character.py`, which drops the clips
the game does not play. The source ships 24 animations per character and
animation data is the bulk of the file, so keeping seven takes a 3 MB character
under 1 MB — which is what makes them affordable against the 15 MB shell budget
(PRD §30).

Kept: `Idle_Gun`, `Idle_Gun_Shoot`, `Walk`, `Run`, `Run_Shoot`, `Death`,
`HitRecieve` (the pack's spelling).

These carry their own rig, materials and animations, so they do not follow the
material-slot or `COL_` conventions the generated props use;
`apps/game/src/assets.test.ts` exempts them explicitly.

## Character animation — MoCap Online

| File                           | Animation source                                | Licence                       |
| ------------------------------ | ----------------------------------------------- | ----------------------------- |
| `models/fighter_insurgent.glb` | MoCap Online rifle library (`W2_*`), retargeted | **NOT CONFIRMED — see below** |
| `models/fighter_soldier.glb`   | MoCap Online rifle library (`W2_*`), retargeted | **NOT CONFIRMED — see below** |

Clips used, all from the pack's rifle set: `W2_Stand_Aim_Idle_v2` (idle),
`W2_Walk_Aim_F_Loop_IPC` (walk), `W2_Jog_Aim_F_Loop_IPC` (run). The in-place
(`IPC`) variants are used deliberately: the server owns movement, so a clip
carrying root motion would fight the simulation.

Retargeted onto Synty's skeleton by `tools/art/blender/retarget_mocap.py`. The
mesh and textures are Synty's under the licence recorded below; only the
animation comes from this pack.

> **Licence status: unresolved, and it blocks commercial release.**
>
> The pack unpacked at `~/src/nightcell7-assets/mocap/` contains no licence,
> EULA or terms file — only format notes. It appears to be MoCap Online's free
> sample pack, but "appears to be" is not provenance, and CLAUDE.md requires
> provenance for every public asset.
>
> This is fine for a development build and is **not** fine for a paid episode.
> Before release, either obtain and record the pack's actual terms here, or
> replace these three clips with animation whose licence is documented. Nothing
> else in the character pipeline depends on which clips are used — the
> retargeter takes `--clips name=file.fbx`, so swapping the source is a
> command-line change, not a code change.

**No death animation.** The pack ships locomotion, rifle handling, zombie and
office clips, and nothing that reads as a death. `Opponents.play()` tolerates a
missing clip by stopping every group, so a killed bot freezes in place rather
than erroring — visibly imperfect, and the honest state until a death clip
exists.

## Synty POLYGON Military

| File                           | Source                                                      | Licence                         |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------- |
| `models/veh_armored_car.glb`   | Synty POLYGON Military — `SM_Veh_Light_Armored_Car_01`      | Synty Store licence (purchased) |
| `models/veh_technical.glb`     | Synty POLYGON Military — `SM_Veh_Pickup_Technical_01`       | Synty Store licence (purchased) |
| `models/prop_barrel.glb`       | Synty POLYGON Military — `SM_Prop_Barrel_01`                | Synty Store licence (purchased) |
| `models/prop_barrel_stack.glb` | Synty POLYGON Military — `SM_Prop_Barrel_Stack_01`          | Synty Store licence (purchased) |
| `models/prop_ammo_box.glb`     | Synty POLYGON Military — `SM_Prop_AmmoBox_01`               | Synty Store licence (purchased) |
| `models/prop_barrier.glb`      | Synty POLYGON Military — `SM_Prop_Barrier_Tall_01`          | Synty Store licence (purchased) |
| `models/prop_water_tank.glb`   | Synty POLYGON Military — `SM_Prop_WaterTank_02`             | Synty Store licence (purchased) |
| `textures/synty_atlas.webp`    | Synty POLYGON Military — `PolygonMilitary_Texture_01_A`     | Synty Store licence (purchased) |
| `textures/synty_vehicles.webp` | Synty POLYGON Military — `PolygonMilitary_Land_Vehicles_03` | Synty Store licence (purchased) |
| `models/wep_rifle.glb`         | Synty POLYGON Military — `SM_Wep_Preset_A_Rifle_01*`        | Synty Store licence (purchased) |
| `models/wep_smg.glb`           | Synty POLYGON Military — `SM_Wep_Preset_A_SMG_01*`          | Synty Store licence (purchased) |
| `models/wep_sniper.glb`        | Synty POLYGON Military — `SM_Wep_Preset_B_Sniper_01*`       | Synty Store licence (purchased) |
| `models/wep_grenade.glb`       | Synty POLYGON Military — `SM_Wep_Grenade_01`                | Synty Store licence (purchased) |
| `models/env_control_tower.glb` | Synty POLYGON Military — `SM_Bld_ControlTower_01`           | Synty Store licence (purchased) |
| `models/env_oil_tower.glb`     | Synty POLYGON Military — `SM_Bld_OilTower_01`               | Synty Store licence (purchased) |
| `models/env_hangar.glb`        | Synty POLYGON Military — `SM_Bld_Hangar_01`                 | Synty Store licence (purchased) |
| `models/env_guard_tower.glb`   | Synty POLYGON Military — `SM_Bld_GuardTower_01`             | Synty Store licence (purchased) |
| `models/env_tent.glb`          | Synty POLYGON Military — `SM_Bld_CamoNet_Tent_01`           | Synty Store licence (purchased) |
| `textures/synty_weapons.webp`  | Synty POLYGON Military — `PolygonMilitary_Weapons_01`       | Synty Store licence (purchased) |

Purchased from https://syntystore.com. The licence grants perpetual,
royalty-free commercial use in unlimited titles and permits modification; it
does **not** permit reselling the assets as assets. Not copyright ownership,
which only a work-for-hire commission gives.

The two Synty **characters** are converted by
`tools/art/blender/import_synty.py` but are **not shipped**: neither route to
animating them works yet (docs/HANDOFF-synty.md), and carrying two models
nothing draws cost 1.24 MB of the shell download at every boot. The converters
and the licence record stay; the GLBs are regenerated on demand with
`node tools/art/import-synty.mjs --with-characters`.

Source files are **not** committed — the pack is 406 MB unpacked and lives
outside the repo. Only the converted GLBs and the shared atlases ship.

Every row above is reproduced by `node tools/art/import-synty.mjs`, which holds
the source file, material slot, decimation ratio and atlas for each asset. It is
not part of `pnpm assets:build`: that runs in CI, and this needs the purchased
pack. Re-running it against the same pack version reproduces the committed
files byte for byte.

Converted with `tools/art/blender/import_synty.py`, which does two things the
plain glTF path cannot:

- **Retargets animation.** Synty's SourceFiles carry a bind pose and nothing
  else; the walk and run cycles are in the Unity and Unreal packages, which are
  engine-locked. The script maps our CC0 clip set onto Synty's Unreal-standard
  55-bone skeleton with copy-rotation constraints and bakes the result. Copying
  f-curves directly does not work — curves live in each bone's rest space and
  the two rigs do not share rest orientations, so the result is a figure with
  its arms through its chest.
- **Shares the atlas.** Synty puts every model in the pack on one 4096 texture.
  Embedding it per character cost 2.48 MB each; binding it once by material
  name costs 357 KB total and takes each character to ~650 KB.

Kept clips: `Idle_Gun`, `Idle_Gun_Shoot`, `Walk`, `Run`, `Run_Shoot`, `Death`,
`HitRecieve`.

### Vehicles and props (static meshes)

The vehicles and props carry no rig, so none of the character retarget applies.
They are converted with `tools/art/blender/import_synty_prop.py`, which is the
easy path the characters could not take:

- **Shared atlases, so props cost no texture at all.** Every prop was authored
  against `PolygonMilitary_Texture_01_A`, which already ships as
  `synty_atlas.webp` for the characters, so the props reuse it and add only
  geometry. The vehicles use Synty's Land_Vehicles atlas; the pack ships ten
  recolour variants over one shared UV layout, so **one** desert variant
  (`Land_Vehicles_03`) is shipped as `synty_vehicles.webp` (76 KB) and bound to
  every vehicle mesh, rather than a separate 2 MB texture per vehicle. Glass was
  authored against Texture_01_A, so glass meshes are routed to `synty_atlas` by
  mesh name at convert time.
- **Decimated to fit the shell budget.** Synty's vehicle FBX is far denser than
  the game needs for set-dressing — the armoured car imports at 24k triangles /
  1.5 MB uncompressed. The two vehicles are decimated (car 0.4, pickup 0.5) to
  land near 0.5 MB and 0.4 MB, verified by preview render to be indistinguishable
  at gameplay distance. Props ship undecimated; they are already 12–143 KB.
- **No embedded textures**, exactly like the characters and generated props: the
  GLB names its material slot and the engine binds the atlas by that name.

These are licensed static meshes, so — like the characters — they do not follow
the generated props' material-slot or `COL_` conventions;
`apps/game/src/assets.test.ts` exempts them explicitly. They are cosmetic
set-dressing and carry no collision proxy.

### Weapons

`wep_rifle`, `wep_smg` and `wep_sniper` come from `import_synty_weapon.py`,
which differs from the prop converter in two ways.

- **They are assembled, not converted.** Synty ships a weapon modular: the
  preset is a receiver, and the magazine, sight, trigger, slide and charging
  handle are separate FBX files sharing its origin. That suits a kit where a
  player swaps attachments and would cost six files and six draw calls per
  rifle here, so the parts are imported together, joined and welded. Bipods and
  fold-out foregrips are skipped — they hang below the barrel and read as
  damage at viewmodel distance.
- **`SOCKET_MUZZLE` is placed by measurement.** CLAUDE.md requires one on every
  weapon, and the pack is not consistent about which way a weapon faces. The
  longest axis is the barrel; which _end_ is the muzzle is decided by the pistol
  grip, which is the lowest part of a firearm and always sits behind the barrel.
  The first attempt used "the muzzle end is the thinner end" instead, which is
  true of the rifle and the sniper and false of the SMG, whose folding stock is
  a thin rod — its socket ended up on the stock. Rendering a marker at the
  socket is what caught it; the coordinates alone looked reasonable for all
  three. `assets.test.ts` now guards the position of each.

The whole armoury costs 2 KB of texture: Synty colour these by UV region
against a 512px atlas rather than by detail, and `Weapons_01` is the neutral
gunmetal — the other nine are camo and tiger-stripe finishes that would tie
every weapon to one faction.
