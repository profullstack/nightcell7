# Handoff: Synty POLYGON Military integration

State as of `9885785`. Written so the next session can resume without
re-deriving anything.

## Where things stand

`/play` works and renders correctly. The bots use the **generated** character
(`character.glb`), not the Synty ones — that is a deliberate fallback, not an
oversight.

The Synty characters are committed, load fine, are textured, and are **not
shipped**, because their animation retarget is broken.

| Thing                                                 | State                                           |
| ----------------------------------------------------- | ----------------------------------------------- |
| `models/fighter_insurgent.glb`, `fighter_soldier.glb` | committed, load, textured, animation wrong      |
| `textures/synty_atlas.webp`                           | working, 388 KB, shared by characters + props   |
| `tools/art/blender/import_synty.py`                   | character converter; maths fixed, export broken |
| `tools/art/blender/import_synty_prop.py`              | static-mesh converter; **working, shipped**     |
| 2 vehicles + 5 props (`veh_*`, `prop_*`)              | **integrated** — converted, textured, placed    |
| `textures/synty_vehicles.webp`                        | working, 76 KB, shared by all vehicles          |
| 3 weapons (`wep_*`) + `synty_weapons.webp`            | **integrated** — player viewmodel and bot hands |
| Shell budget                                          | 7.13 MB against a 9 MB guard                    |

Source pack is at `~/src/nightcell7-assets/SourceFiles/` (406 MB, outside the
repo, not committed).

## The blocking bug

Synty ships SourceFiles without animation — the cycles live in the Unity and
Unreal packages, which are engine-locked. So our CC0 clips have to be
retargeted onto Synty's Unreal-standard 55-bone skeleton.

**The previous diagnosis in this document was wrong.** It said the maths was
correct and the glTF export was broken. Three separate faults were actually in
play, and the first two hid the third:

1. **`BONE_MAP`'s source side did not match any real bone.** It listed `Hips`,
   `Abdomen`, `Torso`, `LowerArm.L`, `Wrist.L`, `UpperLeg.L`; the rig actually
   has `hips`, `spine`, `chest`, `forearm.L`, `hand.L`, `thigh.L`. The lookup
   _skipped_ anything it could not find, so zero bones mapped, zero keyframes
   were written and all five actions came out empty — with no error. Now fixed,
   and a mismatch is fatal rather than skipped.

2. **`export_bake_animation=True` overrode the actions.** With it on, the
   exporter emits one baked animation per object, named after the object and
   covering all 55 bones in T/R/S. That is precisely the reported symptom, "all
   five clips collapse into a single animation named `target_rig`" — it was
   never an action-handling bug. Now off, with each action pushed to its own
   NLA track.

3. **The "limbs splayed, 1.90 x 2.00 x 2.47 m" measurement was an artefact.**
   The scene contains a stray 42-vertex `Icosphere` that dominated the bounding
   box. Measuring the character mesh alone gives 2.03 x 0.32 x 1.79 — correct
   height, correct depth. Nothing was ever splayed. (That sphere is still in the
   committed `fighter_*.glb` and should be tracked down separately.)

With 1 and 2 fixed, all five clips export under their own names and the legs
animate correctly. What remains is a real, measured rest-pose mismatch:

|                 | across | note                                  |
| --------------- | ------ | ------------------------------------- |
| our source rig  | 0.69 m | rests arms-down; no clip exceeds 0.72 |
| Synty bind pose | 2.03 m | T-pose, arms straight out             |

Rest-relative retargeting transfers _deviation from rest_. The source barely
deviates from its own arms-down rest, so the target barely deviates from its
T-pose: legs move, arms stay out. Every clip measures 2.02-2.05 m across.

## Next steps, in order

1. ~~**Stop retargeting. Skin the Synty mesh to our rig instead.**~~
   **Tried — `tools/art/blender/skin_synty.py`. Gets close, still not
   shippable.** The export carries all five clips, height matches our rig to
   within 2%, and the torso, legs and head animate correctly. The arms do not:
   one locks straight out at shoulder height, the other crumples into the
   chest.

   The pose step is provably correct — every mapped arm bone reaches its target
   direction to within 0.0 degrees, checked bone by bone — yet the baked mesh
   still measures 1.16 m across against our rig's 0.69 m, so the mesh is not
   following its own skeleton. Suspicion is on the `ARMATURE_AUTO` bind rather
   than the pose. The character's extreme vertices turn out to be fingertips
   weighted to `indexFinger_03_l/r`, bones the script never poses; whether
   those are parented under `Hand_*` in the FBX has not been confirmed and is
   the first thing to check.

   Two approaches that were tried and measured, so they are not repeated:
   - _Copy world orientation outright_ — removes the rest precondition and the
     bone-axis conventions with it; the figure lies down (2.14 x 0.52 x 0.39).
   - _Re-rest the target into the source's A-pose_ by rotating each bone by the
     minimal arc onto its counterpart's rest direction, then applying that as
     the rest. The corrections come out incoherent — 169 degrees on the left
     upper arm against 11 on the right, where a mirror pair must be symmetric —
     so the two rest frames are not being compared in a common basis. Worth
     revisiting only with that basis problem understood.

2. **Get clips authored for the Synty skeleton instead.**
   Both directions of moving animation between these two skeletons have now
   cost more than they are worth. An auto-rigging service takes a mesh and
   returns a rigged, animated FBX — no retarget, no rebind, and the result is
   authored against the body it ships with. That is very likely cheaper than a
   third attempt at either script here.

3. **Verify objectively, and measure the right mesh.** Load the exported GLB,
   assign each action directly (muting or deleting the NLA, or the assigned
   action masks whichever strip you unmute), step every frame, and measure the
   _character_ mesh — explicitly excluding the collision proxy, which is what
   produced the bogus splay reading above — the "stray Icosphere" is
   `COL_character`, the collision hull that ships inside `character.glb`, at
   1.9 x 2.0 x 2.8 against a body of 0.69 x 0.62 x 1.75. A walk frame should be near
   `0.6-0.9 x 0.4 x 1.8`. A bind-pose preview looks fine even when the
   animation is broken, which is how this shipped in the first place.

4. **Then swap the bots back.** Two lines in `apps/game/src/opponents.ts`,
   marked in a comment there:
   `assets.models.get("fighter_soldier")` / `("fighter_insurgent")`, and clip
   names change from lowercase (`walk`/`run`/`idle`/`death`) to Synty's
   (`Walk`/`Run`/`Idle_Gun`/`Death`).

5. ~~**Then vehicles and props.**~~ **Done.** `import_synty_prop.py` converts
   the static `SM_Veh_*` / `SM_Prop_*` meshes: no retarget, just unit apply,
   recentre-to-ground, per-mesh material naming, weld and (for vehicles)
   decimate. Shipped: `veh_armored_car`, `veh_technical` and five props
   (`prop_barrel`, `prop_barrel_stack`, `prop_ammo_box`, `prop_barrier`,
   `prop_water_tank`). Two lessons for weapons next:
   - **The FBX is already metres and uses one placeholder material.** No 0.01
     scale (that was the _skeletal_ path); split body vs glass by mesh name.
   - **Land_Vehicles_NN are one UV layout in ten recolours,** so one variant
     (`03`, desert) is bound to every vehicle as `synty_vehicles`. Props reuse
     `synty_atlas` (Texture_01_A) and cost no new texture at all.
   - **Vehicles decimate hard without visible loss** (car 24k→~10k tris,
     1.5 MB→0.5 MB). Verified by preview render, not by eye.

   Placement is cosmetic set-dressing in the spawn zones and back corners
   (`world.ts`, "cosmetic set-dressing" block) — deliberately non-colliding and
   kept out of the three lanes, so rule 1 still holds for the play space.
   Promoting any to real cover is a `map.ts` collision + checksum change.

6. ~~**Then weapons.**~~ **Done.** `import_synty_weapon.py` assembles the
   modular `SM_Wep_*` parts into one mesh and places `SOCKET_MUZZLE`.
   `wep_rifle` is the player's viewmodel; the Directorate carry it and Nightcell
   the SMG, so the two sides are legible at a glance. The generated `carbine` is
   still built and still ships as a fallback. Three lessons:
   - **The muzzle end cannot be guessed from cross-section.** See PROVENANCE.md
     — the SMG's folding stock defeats it. The grip is the reliable reference.
   - **Bake the FBX import transform into the mesh.** Left alone it is a 0.01
     scale and a -90° X rotation, which survives export as a node transform and
     makes every child coordinate centimetres in a rotated basis — the muzzle
     socket read `72.0` instead of `0.72`.
   - **`placeAll` returns hardware instances, and assigning to an
     `InstancedMesh`'s material is a silent no-op.** The viewmodel needs its own
     material, so it now asks for `unique` meshes. Without it every material
     change was landing on nothing; forcing the weapon bright red changed
     nothing on screen, which is what finally identified it.

7. **Everything licensed is reproducible.** `node tools/art/import-synty.mjs`
   holds the source file, slot, decimation and atlas for every Synty asset and
   reproduces the committed files byte for byte. Before it, those parameters
   lived only in one session's shell history.

## Traps already hit — do not repeat

- **`loadModel` used to dispose any material whose name was not one of our
  generated slots.** That destroyed all seven Synty materials and left the
  meshes with none, which Babylon renders as flat white. It now disposes only
  materials nothing references. This cost three wrong diagnoses (albedo
  scaling, emissive clearing, GlowLayer exclusion) because it presented as an
  exposure problem. **Instrument before theorising.**
- **The yard is lit hot** — hemispheric 4.05, exposure 2.05, bloom threshold
  0.62. Any imported material authored for neutral lighting clips to white.
  Scale `albedoColor` to land near 0.18 effective, which is where the yard's
  own concrete and steel sit.
- **Blender appends `.001`** if an action name is taken, and the engine looks
  clips up by exact name. Rename the source out of the way first, then delete
  the renamed sources before export or they ship alongside and double the file.
- **The _skeletal_ (`SK_Chr_*`) FBX imports at centimetres**; scale by 0.01.
  The **static** (`SM_*`) FBX does not — Blender reads its unit metadata and
  lands it at metres already (`import_synty_prop.py` only _applies_ the
  importer's transform, and range-checks the result). Do not blanket-scale.
- **Budget accounting counts flat `.mp3` files in the audio root only.** Music
  lives in `audio/music/<artist>/` and is streamed, deliberately outside the
  shell budget.
- **CI runs against GitHub's PR _merge_ commit**, not the branch head. A branch
  that passes locally can still fail when main has touched the same file —
  `PROVENANCE.md` did exactly this twice.

## Licence

Synty Store licence, purchased. Perpetual, royalty-free commercial use in
unlimited titles, modification permitted; reselling the assets as assets is
not. Not copyright ownership. Recorded in
`apps/game/public/assets/PROVENANCE.md`.
