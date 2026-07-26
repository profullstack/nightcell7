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
| `textures/synty_atlas.webp`                           | working, 357 KB, shared by characters + props   |
| `tools/art/blender/import_synty.py`                   | character converter; maths fixed, export broken |
| `tools/art/blender/import_synty_prop.py`              | static-mesh converter; **working, shipped**     |
| 2 vehicles + 5 props (`veh_*`, `prop_*`)              | **integrated** — converted, textured, placed    |
| `textures/synty_vehicles.webp`                        | working, 76 KB, shared by all vehicles          |
| Weapons                                               | **none integrated** — still the next win        |
| Shell budget                                          | 6.33 MB against a 9 MB guard                    |

Source pack is at `~/src/nightcell7-assets/SourceFiles/` (406 MB, outside the
repo, not committed).

## The one blocking bug

Synty ships SourceFiles without animation — the cycles live in the Unity and
Unreal packages, which are engine-locked. So our CC0 clips have to be retargeted
onto Synty's Unreal-standard 55-bone skeleton.

**First attempt (wrong).** Copy-rotation constraints in world space, then
`nla.bake`. That forces the target bone to adopt the source bone's _absolute_
orientation, which is only correct if both skeletons share rest poses. They do
not — Synty uses Unreal's axis convention, our clips another. Every bone sat at
its rest-pose difference and the error compounded down each limb.

Measured: **1.90 x 2.00 x 2.47 m** for a figure that should be about
**0.6 x 0.4 x 1.8**. Limbs splayed in every direction.

**Second attempt (maths right, export wrong).** `import_synty.py` now solves
each bone directly:

```
target.matrix = source.matrix @ (source.rest⁻¹ @ target.rest)
```

so what transfers is the source's motion _away from its own rest_, not its raw
orientation. Parents are solved before children and the view layer is flushed
between bones, because setting a pose bone's matrix reads its parent's current
transform.

That runs. What fails is the export: the manually keyed actions do not survive
`export_scene.gltf` the way `nla.bake`'s did. **All five clips collapse into a
single animation named `target_rig`** — after the object, not the actions.

## Next steps, in order

1. **Fix the export.** The maths is believed correct; only the action handling
   is wrong. Options worth trying, cheapest first:
   - Push each baked action to an NLA track before export, rather than relying
     on `export_animation_mode="ACTIONS"` finding loose actions.
   - Check `action.id_root` is `"OBJECT"` on the actions created with
     `bpy.data.actions.new()`.
   - Keep the rest-relative solve but write the result through `nla.bake`
     (which demonstrably exported correctly), e.g. by driving the target with
     `COPY_TRANSFORMS` against a helper armature already offset by the rest
     delta.

2. **Verify objectively, not by eye.** Load the exported GLB, set a mid-`walk`
   frame, and measure the mesh bounding box. It must be near
   `0.6 x 0.4 x 1.8`. A bind-pose preview looks fine even when the animation is
   broken — that is exactly how this shipped in the first place.

3. **Then swap the bots back.** Two lines in `apps/game/src/opponents.ts`,
   marked in a comment there:
   `assets.models.get("fighter_soldier")` / `("fighter_insurgent")`, and clip
   names change from lowercase (`walk`/`run`/`idle`/`death`) to Synty's
   (`Walk`/`Run`/`Idle_Gun`/`Death`).

4. ~~**Then vehicles and props.**~~ **Done.** `import_synty_prop.py` converts
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

5. **Then weapons.** `SM_Wep_*` with the `PolygonMilitary_Weapons_*` atlases,
   replacing the generated carbine. `import_synty_prop.py` is the right starting
   point, but a weapon needs a `SOCKET_MUZZLE` node and is exempt from the
   `COL_` rule — see how `assets.test.ts` handles the carbine.

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
