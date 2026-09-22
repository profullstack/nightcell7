# Sandbox follow-ups: female operator, trailer v2, chooser and armory

Status: **requirements, not a locked decision.** Written 2026-09-22 against
`main` after PRs #49 to #57 landed. This file records what the day's sandbox
work left open, what each item needs, and in what order to take them. When
any decision below is taken, record it in `docs/prd.md` in the same commit
as the code (CLAUDE.md).

---

## 1. Summary

The public demo at `/play` is now a playable loop: damage, death and
redeploy, stamina that grows with health packs, weapon drops off the player's
kills, a status bar, hit feedback, three difficulty tiers, an operator chooser
with an animated preview, and a credits armory. Two things the chooser
promises are not yet real, and two of the day's deliverables were first
passes:

1. **Female operator.** The chooser shows the option disabled with "art
   pending". The operator bodies are procedural Blender builds, so this is a
   generator change plus wiring, not a purchase or a licence.
2. **Colour has no effect in play.** ~~It tints the preview figure only.~~
   **Done 2026-09-22.** It also turned out that _nobody_ was team-coloured:
   see §4, which was a live bug, not just a missing feature.
3. **Trailer v2.** The 26 s film shows movement, firing, a frag and a weapon
   switch, but no enemy kill lands in frame, and it has no title cards.
4. **Credits are browser-local.** The armory balance lives in `localStorage`,
   so it does not follow an account or survive a cleared browser.

Everything here stays inside the locked V1 rules: no paid weapons, no
pay-to-win, no subscriptions, no microtransactions (`docs/prd.md`,
"Prohibited in V1"). Credits are earned in play and buy nothing with money.

---

## 2. Baseline: what shipped on 2026-09-22

| PR  | What                                                                                           |
| --- | ---------------------------------------------------------------------------------------------- |
| #49 | Player damage, death/redeploy, health packs, weapon drops, status bar; sim `applyWeaponIntent` |
| #50 | Stamina: max health 150, +25 per pack to 300, kept across redeploys; `humanIncomingDamage`     |
| #51 | Easy tuning: 4 health per rifle round, enemy bots fire in bursts (`burstMs`/`burstPauseMs`)    |
| #52 | Hit feedback: blood, hit-direction arc, stagger, red "TAKING FIRE" alert                       |
| #53 | Difficulty picker (Easy/Medium/Hard), drops only off the player's kills, pointer-lock guard    |
| #55 | Operator chooser (side, gender, armour, colour) with preview figure; credits armory            |
| #56 | README gameplay screenshots via `tools/art/capture-gameplay.mjs`                               |
| #57 | Trailer via `tools/art/trailer.mjs`: 26 s, 720p30, H.264/AAC, `docs/trailer/`                  |

Key files: `apps/game/src/loadout.ts` (choices, credits, armory catalog),
`apps/game/src/preview.ts` (the figure on the gate), `apps/game/src/difficulty.ts`,
`apps/game/src/sandbox-rules.ts` (stamina, packs, bot loadouts, easy tuning),
`packages/multiplayer-sim/src/pickups.ts` (packs, drops, stamina growth).

---

## 3. Female operator

### 3.1 Requirement

The Gender group on the deploy gate offers Male and Female. Both are real: a
distinct body for each faction, animated with the same idle, walk, run and
death clips, wearing the same faction band and cloth, carrying weapons on the
same socket. Bots may use either body. Nothing about damage, hitbox height or
speed differs between them; the simulation's player capsule is one size.

### 3.2 How the bodies are made today

Both shipped operators are original geometry built by
`tools/art/iron-rain/generate.py`, function `operator(enemy)`, on an original
skeleton, exported as `m3_operator_nightcell.glb` and
`m3_operator_directorate.glb` with `SOCKET_WEAPON` and the four clips. No
third-party mesh or animation is involved (`apps/game/public/assets/PROVENANCE.md`),
which is why this item is unblocked: the earlier MoCap Online licence question
in `docs/HANDOFF-synty.md` does not apply to the IRON RAIN set.

### 3.3 Work

1. **Generator.** Add a body profile parameter to `operator()` and a second
   profile with its own proportions (shoulder and hip widths, torso length,
   neck, helmet fit). Same bone names and rest pose so the existing clips
   drive it unchanged. Register `operator_nightcell_f` and
   `operator_directorate_f` in `BUILDERS`.
2. **Assets.** Add the two GLBs to `apps/game/src/assets.ts` `MODELS`, the
   asset manifest and `replacements.json`; regenerate
   `docs/art/iron-rain-overview.webp`. Stay inside the 9 MiB runtime budget
   (`tools/art/full-set/validate.mjs`); two more bodies should cost well under
   1 MiB.
3. **Game.** `loadout.ts`: set `GENDERS[female].available = true` and drop the
   note. A helper `operatorModel(side, gender)` used by `preview.ts` and by
   `Opponents` when placing bots. Bots pick a body per roster index so a squad
   is mixed.
4. **Tests.** `opponents.test.ts` fixture loads the new models; a test that
   both bodies keep the floor-alignment and hitbox-adjacency checks that the
   existing locomotion test enforces; `loadout.test.ts` no longer expects
   Female to be unavailable.
5. **Provenance.** `PROVENANCE.md` row for the new bodies: original geometry,
   `generate.py`, commit.

### 3.4 Acceptance

- Picking Female on the gate shows a visibly different figure in the yard, in
  the chosen colours, idling.
- Deploying as Female puts that body on the squad's side of the roster and
  the other faction's female body among the enemies.
- All 326 existing tests still pass; the locomotion test covers four bodies.
- No new third-party asset, no licence to confirm.

Estimate: two to three days for one engineer who knows the generator.

---

## 4. Colour that shows in play

### 4.0 Done, 2026-09-22 — and it was a bug, not a gap

Reported from the live build: "everyone is blue in gameplay." Investigating it
found the colour swatch was the smaller half of the problem. Three faults:

1. **No fighter was ever team-coloured.** `brightenCharacter` picked materials
   by exclusion: "team" meant a name containing `paint` or `nc7_team`, "cloth"
   meant a name that did _not_ start with `nc7_` or `ir_`. Every material on
   both shipped operators is `ir_`-prefixed (`ir_uniform`, `ir_canvas`,
   `ir_blue`, `ir_steel`, `ir_rubber`, `ir_glass`), so the first test never
   matched and the second excluded everything. Neither branch ever ran. Both
   models share `ir_blue`, so every fighter in the yard came out the same blue
   and friend was indistinguishable from foe. The call site's own comment said
   "without this both teams are the same model with the same materials" — it
   was right, the matching just never fired.

   Materials are now classified by **role** (`materialRole`), naming what is a
   band, what is cloth, and what keeps its authored colour. A material that is
   not listed stays authored, which is a visible omission rather than a silent
   disabling of the whole system.

2. **The palette was keyed on an absolute faction**, `player.team ===
TEAM_IDS.NIGHTCELL`, which is only the right question while the player is
   Nightcell. Choosing Directorate on the gate put your own squad in the enemy
   colour and the enemies in yours. It now asks `player.team === playerTeam`.

3. **The gate's colour never reached the yard.** It does now, through
   `Opponents({ color })` at boot and `setColor()` when the swatch changes with
   the gate still up.

**The two sides can never collide.** The player may now wear any of the five
colours, including the one the enemy used to wear, so the enemy palette is
chosen as whichever candidate sits furthest from the player's
(`enemyPaletteFor`). A test asserts the separation exceeds `MIN_TEAM_DISTANCE`
for every colour the gate offers. Two teams in one colour is not a cosmetic
problem, it is the game becoming unplayable.

Covered by `team-colour.test.ts` (classification and separation) and two cases
in `opponents.test.ts` that load the real GLBs and read the albedo that ends up
on the meshes, because the classifier and the wiring each broke separately.

### 4.1 Requirement (met)

The colour chosen on the gate is visible while playing, not only on the
preview figure.

### 4.2 Options, in order of value for cost

1. **Squad wears it.** Friendly bots take the player's band and cloth colours,
   so "my colour" reads as "my squad" from the first second. Cheap: the tint
   already exists (`brightenCharacter`), the roster knows which bots are
   friendly. The enemy faction keeps its own palette so sides stay legible.
2. **Gloves on the viewmodel.** The first-person carbine has no hands. Adding
   a pair of gloved hands to `m2_carbine_fp` (the one retained, approved
   asset) touches an asset the art notes say to keep byte for byte, so this
   waits on a new first-person rig. Not for now.
3. **Death cam.** On death, a two-second third-person view of the player's
   body where they fell, in their colours, before the KIA overlay. Needs the
   body placed at the controller's position and a camera orbit; a nice piece,
   a day's work, and the first time the player sees their own operator.

Recommendation: do option 1 now, with the female operator; option 3 after the
trailer v2. Skip 2.

---

## 5. Trailer v2

### 5.1 What is wrong with v1

`docs/trailer/nightcell7-trailer.mp4` proves the pipeline: stepped rendering on
a virtual clock, steady 30 fps, correct encode. As a film it is polite. The
beat list in `tools/art/trailer.mjs` was written blind; no enemy dies on
camera, the frag detonates off-screen, and there are no title cards.

### 5.2 Requirement

- 30 to 40 seconds. Opens on the gate with the operator, cuts to combat
  within four seconds, shows at least two enemy kills with the muzzle flash,
  tracer and the fighter dropping in frame, one frag detonation in frame, a
  weapon pickup off a kill with the notice, a health pack taken, one death
  with the blood and KIA overlay, and a redeploy. Ends on a title card.
- Title cards: "NIGHTCELL 7", "Play free in the browser", the URL. Rendered
  as PNG frames by the tool (no fonts on the encode box: draw them in a
  headless page of `apps/site` or a static HTML card, captured the same way).
- 1920x1080 at 30 fps, H.264 High, crf 20 to 23, `faststart`, limited range,
  AAC. Under 15 MB at 1080p, or ship 720p in the repo and 1080p on the site.
- Music: **settled.** The concern here was that no licence text was checked in
  beside `apps/game/public/audio/music/throngva/`. There is one, a directory
  up: `apps/game/public/audio/PROVENANCE.md` records the tracks as original
  work by Þrøngva written for this game by the project owner, not licensed
  from a third party. Nothing to clear, so promotional use is fine.

### 5.3 How to get kills on camera

The bots are seeded, so a beat list can be tuned against the actual fight.
Add a `--rehearse` mode to `trailer.mjs` that runs the beats without
capturing, logging kills, deaths, pickups and grenade detonations with their
frame numbers and screen positions (project the event's world position
through the camera). Adjust the beats until the events land in the middle
third of the frame, then capture. Cheaper than aiming by eye at twenty frames
a minute.

### 5.4 Where it goes

- `docs/trailer/` in the repo (provenance).
- `apps/site/public/media/trailer/` with a `<video>` on the home page and
  `og:video` for link previews. A directory rather than a bare
  `media/trailer.mp4`, to match `media/yard/` and carry a manifest beside the
  file.
- The Steam store page when that exists (`docs/prd-steam.md`).

**Done for v1, 2026-09-22.** The film shipped to the site ahead of v2 rather
than waiting for it: the home page had no moving image at all, which is worse
than alpha footage that says it is alpha footage. It sits in its own section
directly under the hero, and on `/press` with a download link. Both carry
`TrailerNotice` — alpha footage of the multiplayer map, no title cards, not
campaign material. When v2 lands it replaces the file in `docs/trailer/`, gets
copied across, and both manifests are rewritten; the page copy follows the
manifest and needs no edit.

Estimate: two days, most of it rehearsal.

---

## 6. Credits and the armory beyond the browser

### 6.1 Requirement

A signed-in player's credits and loadout follow their account. A guest's stay
in the browser, as now.

### 6.2 Work

- Persist `nc7.credits` and `nc7.loadout` through `packages/save-data` for a
  signed-in viewer (the `/api/v1/me` viewer already gates access), with the
  browser copy as the guest fallback and as an offline cache.
- Server-side earning: kills and packs are already simulation events; when
  the sandbox runs against a match room rather than the local `Opponents`,
  credit them on the server so a tampered client cannot mint credits.
- Guardrails, in code and in the PRD: credits are never purchasable, never
  convertible, and in multiplayer buy cosmetics only (colour, and a future
  patch or callsign). No weapon, ammunition, armour or health is purchasable
  in a match at any price. `packages/entitlements` should refuse any catalog
  entry that grants a `WeaponId`.

Payments are explicitly deferred ("credits only for now, figure out payments
later"). When they come, they buy the episode, not the armory.

---

## 7. Difficulty and survivability tuning

Easy was measured (four minutes standing in the open: two to four hits at
about 4 health each at mid-map, first death at 201 s in the enemy lane).
Medium and Hard were set from the difficulty table and not measured.

- Add the survival measurement as a repeatable script under `tools/` (it
  existed as a temporary test during #51) and record numbers for all three
  tiers in this file.
- Decide whether Hard should be Black (1.5x) rather than Operative (1.0x).
- Regeneration climbs to an absolute 40; with 300 stamina that is 13%. Decide
  whether the ceiling should be a fraction of stamina. The PRD says 40; a
  change is a PRD change.

---

## 8. Smaller items

- **Gender radio while disabled.** Keep the disabled state and note until 3
  lands; do not hide the option, the intent is visible.
- **Armour class mid-session.** Changing it on the pause gate applies plates
  at once, which is a free heal of the armour pool. Either apply on redeploy
  only, or charge for it through the armory. Recommend redeploy only.
- **Stagger under reduced motion.** The view jolt is skipped; the movement
  slow-down stays. Confirm with a reduced-motion user that the slow-down alone
  reads as "hit".
- **Health pack spawn points** are five hand-picked coordinates checked
  against solids. When the map changes, the test in
  `apps/game/src/sandbox-rules.test.ts` will say so.
- **Capture tools** share ~150 lines (static server, Chrome lookup, WebP);
  fold them into `tools/art/lib/` when the third tool appears.

---

## 9. Order

1. Female operator (§3) with squad colour (§4 option 1) in the same PR: one
   generator change, one wiring change, one overview render.
2. Trailer v2 (§5) with the rehearsal mode and the music licence text.
3. Credits on the account (§6) once Better Auth wiring lands (see
   `docs/prd.md`, "Not yet built").
4. Tuning pass (§7) and the small items (§8) as they come up.

Nothing here blocks the free Steam listing in `docs/prd-steam.md`; the female
operator and trailer v2 improve the store page and should precede it.
