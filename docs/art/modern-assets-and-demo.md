# M2 assets and demo combat repair

The previous pass reused old base meshes and reused their URLs. This release
removes those meshes from the runtime and fixes the combat defects that made the
public demo appear empty or inactive.

## What broke

- **Stale cached graphics:** Workbox used CacheFirst with unchanged GLB URLs.
  Existing installations could keep showing old geometry while the three newly
  named assets appeared. All M2 files have new URLs, the content cache is
  versioned, and normal worker activation deletes the legacy cache.
- **Empty demo selection:** `/play?mode=demo` fell through to a remembered
  `nc7.mode=roam`. The public demo link now explicitly selects combat. Explicit
  range/roam links still work.
- **Broken character deformation:** the loaded pre-M2 fighter rigs produced
  skinned bounds several metres below the ground, independently of the standing
  simulation hitboxes. New original rigs remove that retargeting path. Tests
  sample idle/walk/run poses on all seven clones and check position and height,
  rather than merely checking that animation clip names exist.
- **Wrong factions:** creating every enemy before the friendly roster caused
  authoritative balancing to put some figures on the opposite team to their
  appearance. Joins alternate, visuals use the assigned faction, and initial
  pads are distributed within each actual faction.
- **Conflicting death clocks:** rifle kills set `alive=false` without setting the
  simulation respawn deadline, while a separate wall-clock timer also respawned
  bots. One simulation clock now owns the complete death/respawn lifecycle.
- **Inactive combat:** aim used the wrong vertical offset; bots targeted through
  cover and depleted their magazines on walls. Eye-to-chest aim, visibility checks
  and a shared cover navigation graph restore movement into firing lanes.
- **Combat behind the menu:** bots advanced while the start/pause gate was open.
  The combat clock now advances only during active play. The public sandbox also
  avoids the competitive ten-minute/score-limit freeze; server TDM rules remain
  unchanged.

## Full replacement inventory

All 31 former inventory entries are covered by **28 runtime files**. The redundant
fallback character, duplicate carbine and ammo box are consolidated. The approved
original C7 rifle, field case and low cover remain; no licensed legacy geometry
or animation is loaded. All three backdrop structures are now placed in the
unreachable skyline rather than downloaded without being used.

| Retired runtime file        | Current runtime file          |
| --------------------------- | ----------------------------- |
| `container.glb`             | `m2_cargo_module.glb`         |
| `tank.glb`                  | `m2_fuel_reservoir.glb`       |
| `deck.glb`                  | `m2_catwalk.glb`              |
| `pipe_rack.glb`             | `m2_pipe_plant.glb`           |
| `wall.glb`                  | `m2_security_wall.glb`        |
| `hardpoint.glb`             | `m2_command_bunker.glb`       |
| `stair.glb`                 | `m2_access_stair.glb`         |
| `lamp_mast.glb`             | `m2_floodlight.glb`           |
| `fighter_insurgent.glb`     | `m2_operator_directorate.glb` |
| `fighter_soldier.glb`       | `m2_operator_nightcell.glb`   |
| `veh_armored_car.glb`       | `m2_patrol_vehicle.glb`       |
| `veh_technical.glb`         | `m2_utility_vehicle.glb`      |
| `prop_barrel.glb`           | `m2_fuel_drum.glb`            |
| `prop_barrel_stack.glb`     | `m2_drum_pallet.glb`          |
| `prop_barrier.glb`          | `m2_blast_wall.glb`           |
| `prop_water_tank.glb`       | `m2_water_unit.glb`           |
| `wep_rifle.glb`             | `m2_rifle.glb`                |
| `wep_smg.glb`               | `m2_smg.glb`                  |
| `wep_sniper.glb`            | `m2_marksman.glb`             |
| `wep_grenade.glb`           | `m2_grenade.glb`              |
| `env_control_tower.glb`     | `m2_control_tower.glb`        |
| `env_oil_tower.glb`         | `m2_refinery.glb`             |
| `env_hangar.glb`            | `m2_maintenance_hangar.glb`   |
| `env_guard_tower.glb`       | `m2_guard_post.glb`           |
| `env_tent.glb`              | `m2_field_shelter.glb`        |
| `nc7_carbine_v1.glb`        | `m2_carbine_fp.glb`           |
| `nc7_equipment_case_v1.glb` | `m2_field_case.glb`           |
| `nc7_concrete_cover_v1.glb` | `m2_low_cover.glb`            |
| `character.glb`             | `m2_operator_directorate.glb` |
| `carbine.glb`               | `m2_rifle.glb`                |
| `prop_ammo_box.glb`         | `m2_field_case.glb`           |

See [all model renders](modern-art-overview.webp), `art-manifest.json` and the
runtime provenance file. The studio images are model reviews. The combat frame
was captured with the M2 game renderer.

The website's ten-image gallery still contains the previous release's captures.
The M2 gallery refresh started, but the execution environment disconnected before
all ten captures could be completed and published. Re-run `tools/art/capture.mjs`
against this revision and build the site before claiming the website gallery is
updated. This does not affect the game runtime's complete M2 asset inventory.

## Validation and release

- **277 tests pass across 21 files**, with game TypeScript and production build,
  repository ESLint and Prettier checks passing.
- All 28 GLBs pass Khronos validation with **zero errors and zero warnings**.
- Loaded-model tests cover all seven clones, faction assignment, separate spawn
  pads, animation bounds, rifle damage, delayed respawn and continuing fire.
- Navigation tests check collision clearance, ammo preservation behind cover and
  traversal from both actual spawn zones.
- The asset inventory guard rejects old filenames or fallback meshes and checks
  real file hashes and byte totals against the unchanged 9 MiB budget.
- Content version is **1.2.0**; wire protocol remains **2**. Collision volumes are
  unchanged. Deploy client and multiplayer services on the same content revision.
- Browser smoke loads all 28 modern models, renders an enemy at ground level,
  drives shooting through the input handlers to zero health, and verifies pause.
  This environment used the documented headless pointer-lock/DOM input adapter;
  native pointer lock is not a claimed validation result. See [combat frame](demo-combat.webp).
- Browser smoke and production gallery captures are generated by the committed
  scripts. Hardware-specific GPU/frame-time performance needs measurement on
  target devices; the headless renderer is a functional/visual check.

Current model/texture/effect-audio total: **9,342,093 bytes**
(8.91 MiB). Streamed music is excluded as before.

This is an original procedural tactical art set with generated surface textures.
It is not photogrammetry or a claim of AAA production fidelity.
