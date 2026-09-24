# Night insects and the day/night battle choice

Two ambient creatures — a firefly and a mosquito — and a Time picker on the
gate that decides whether a match is fought under the false dawn or in
daylight. Insects are nocturnal: by day none of this exists.

## What ships

| File                                             | What it is                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `tools/art/iron-rain/insects.py`                 | Generator for both models, plus the lofting helpers the kit lacked |
| `apps/game/public/assets/models/m3_firefly.glb`  | 2 950 tris, 74 KB                                                  |
| `apps/game/public/assets/models/m3_mosquito.glb` | 4 088 tris, 115 KB                                                 |
| `apps/game/src/time-of-day.ts`                   | The lighting table and the gate preference                         |
| `apps/game/src/insects.ts`                       | Babylon presentation: the swarm, the approach, the wingbeat        |
| `packages/game-core/src/insects.ts`              | Pure bite rules — no Babylon, no DOM                               |

Rebuild the models with:

```
BLENDER=/path/to/blender node tools/art/build-assets.mjs --models-only
```

Both are generated, never hand-modelled, so a commit reproduces them exactly.
Reference photographs and the licence position are recorded in
`apps/game/public/assets/PROVENANCE.md`.

## Scale and axes

Real scale, per the one-Blender-metre-is-one-game-metre rule: the firefly is
22 mm nose to abdomen tip, the mosquito 16 mm with a 30 mm leg span. Both are
built `+X` forward, `+Z` up, `+Y` left.

They are legible in play for different reasons. The firefly reads because its
lantern feeds the scene's `GlowLayer` — at 30 m you see the flash, not the
insect. The mosquito reads only when it is close enough to matter, and
`insects.ts` scales it up as it closes for exactly that reason (see below).

## Material slots

Bound by name at load, like every other generated prop. Registered in the
`MATERIALS` array in `apps/game/src/assets.ts`, which is also the allowlist
`assets.test.ts` checks GLB slots against.

| Slot              | Used by                                    | Notes                                                       |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `ir_chitin`       | Firefly elytra and thorax, mosquito thorax | Warm brown cuticle                                          |
| `ir_chitin_pale`  | Firefly pronotum, mosquito abdomen         | Cream                                                       |
| `ir_chitin_dark`  | Abdomen, eyes, mosquito legs and proboscis | Near-black                                                  |
| `ir_chitin_leg`   | Firefly legs                               | Amber; separate so legs do not render as pale as the shield |
| `ir_membrane`     | All wings                                  | `alphaMode: BLEND`, base alpha 0.32                         |
| `firefly_lantern` | Firefly abdomen tip                        | Emissive, `KHR_materials_emissive_strength`                 |
| `ir_white`        | Mosquito scale bands                       | Existing kit slot                                           |
| `ir_orange`       | Firefly pronotum patch                     | Existing kit slot                                           |

`firefly_lantern` is bound at runtime to an **unlit** `StandardMaterial` in
`createMaterials`, exactly as `lamp_glass` is: it is a light source, and
shading it makes the abdomen darker than the glow it throws.

Neither model ships a `COL_` hull. They are ambience — never shot at, nothing
collides with them — so they are on the `NO_COLLIDER` exemption list in
`assets.test.ts` alongside the carried weapons and the in-flight rocket.

## Clips versus procedural

**There are no animation clips.** Both GLBs export with an empty `animations`
array, and that is a decision rather than an omission:

- **Wingbeat is procedural.** A mosquito beats near 600 Hz and a firefly near 45. Both alias into a strobing mess at 60 fps — past roughly 12 Hz the wing
  appears to crawl backwards or stand still. `WINGBEAT_HZ` is 9, a readable
  flutter that says "flying"; the _whine_ carries the real frequency, where
  the ear can resolve what the eye cannot. The exporter joins meshes by
  material, so both wings are one node and flap in sync, which is what an
  insect does anyway.
- **Flight is procedural.** Each firefly drifts on a Lissajous path around its
  own home point. A baked loop across twelve instances would visibly repeat.
- **The flash is procedural.** A sharp attack and a fast decay, not a sine —
  that envelope is what reads as _Photinus_ rather than a fairy light.

If clips are ever wanted, `finish()` in `tools/art/iron-rain/generate.py`
already has an `animated=True` path that exports actions and skins.

## How the game drives it

```
gate: Time picker (hud.ts)
   └── preferredTimeOfDay(...)            time-of-day.ts
         └── LIGHTING[time]               the rig: sky, fog, lights, glow, insects
               ├── buildWorld(..., time)  world.ts applies it
               └── .insects               night only

render loop (main.ts)
   ├── stepInsectBite(state, matchMs, ...)        game-core — decides IF and WHEN
   │     ├── .bit        → opponents.bite(step.damageDealt)
   │     │                 player.stagger(BITE.DAMAGE)
   │     └── .state      → NightInsects.update(...)   expresses the decision
   └── NightInsects.mosquitoNearness → audio.whine(n) / audio.stopWhine()
```

The split is deliberate: `game-core` decides _whether_ a bite happens,
`insects.ts` only makes sure a mosquito is visibly on its way in before it
lands. A health tick with no visible cause reads as a bug, so the approach
starts 2.5 s before `nextBiteAt` and retreats during the scratch.

### Lighting

`world.ts` used to hold one hard-coded false-dawn rig. The values that differ
between day and night now live in `LIGHTING`, and **the night entry is the
shipped constants value for value** — `time-of-day.test.ts` asserts each one,
because a lighting option is only safe to add if the existing look is provably
unchanged. Night is the default, so an untouched install renders what it always
did.

Time is chosen once, before the match. Changing it reloads with `?time=`, the
same way mode and difficulty already do: the yard is dressed and lit at boot,
and relighting live would mean rebuilding the sky, the shadow generator and
the insect population mid-fight.

### The bite

| Constant          | Value   | Why                                   |
| ----------------- | ------- | ------------------------------------- |
| `DAMAGE`          | 2       | Noticeable, not a threat              |
| `MIN_INTERVAL_MS` | 90 000  | Ninety seconds between bites at worst |
| `MAX_INTERVAL_MS` | 240 000 |                                       |
| `GRACE_MS`        | 60 000  | Nothing bites in the opening minute   |
| `SCRATCH_MS`      | 1 100   | How long the player swats             |
| `FLOOR`           | 70      | A bite never takes you below this     |

`FLOOR` exists because the first numbers (3 damage, 45–120 s) cost 75 health
over a twenty-minute match at the short end of the interval — a mosquito
quietly deciding firefights. The test that caught it is kept. Below the floor
the insect still comes, still bites and still makes you scratch; it just stops
costing anything.

The scratch reuses `PlayerController.stagger`, the existing flinch, rather than
adding a second way to interrupt control — it already honours the
reduced-motion setting.

### Damage ownership

`stepInsectBite` takes a `damage` flag and only subtracts health when the
caller owns the vitals.

- **Single-player** (`deathmatch`, `range`, `roam`): the client is the
  authority on its own player, so `damage: true`.
- **Multiplayer**: CLAUDE.md gives the server damage, death and respawn. The
  client must run this with `damage: false` — the mosquito, the whine and the
  scratch all still play, and no health is invented that the server would only
  snap back on the next reconciliation. Making the bite authoritative online
  means running the same pure function server-side and sending the result
  down; the shape is ready for that and does not assume it.

## Performance

Fireflies are capped at twelve and instantiated as **unique** meshes rather
than hardware instances. That costs a draw call each and is the point: an
instance shares its source's material, so a shared lantern can only flash all
twelve in unison, which looks like fairy lights on a timer. Twelve lanterns
pulsing out of phase is the whole effect.

The mosquito is a single instance, parked disabled below the yard between
visits, and scaled up as it approaches — at 16 mm it is otherwise a subpixel
speck exactly when the player is meant to notice it.

## Not done

- **No rig, no skinning, no baked clips.** See the reasoning above; it is a
  deliberate choice for these two, not a gap to be filled without cause.
- **No firefly audio.** The mosquito whine is synthesised in `GameAudio`;
  fireflies are silent. Real ones are.
- **Nothing is verified in a running browser.** Every claim here about
  geometry, materials and the rules is covered by the asset tests and the unit
  tests, but the swarm, the approach, the flash, the wingbeat and the whine
  have not been watched in the actual game. They need a pass in `pnpm dev`.
