# PRD — arsenal parity, battlefield pickups, God Mode, and two new weapons

Status: **proposed, not built.** Requirements only; no code in this commit.
Canonical requirements live in `docs/prd.md` (CLAUDE.md, "Process"); this is a
scoped follow-up in the style of `prd-sandbox-followups.md`, to be folded in or
superseded when the work lands.

Origin: playtest feedback, 2026-09-24. Four asks, in the order they were made.

## The arsenal today

Five weapons in `packages/game-core/src/weapons.ts`:

| Id              | Name                 | Role            |
| --------------- | -------------------- | --------------- |
| `P11`           | P11                  | Sidearm         |
| `C9_KESTREL`    | C9 Kestrel           | Assault rifle   |
| `B4_BREACHER`   | B4 Breaching Shotgun | Close quarters  |
| `M7_LANCE`      | M7 Lance             | Marksman        |
| `M9_HAMMERFALL` | M9 Hammerfall        | Rocket launcher |

`packages/multiplayer-sim/src/pickups.ts` already models two pickup kinds,
`PICKUP_KIND.HEALTH` and `PICKUP_KIND.WEAPON`, and already drops a dead
fighter's weapon. So items 1 and 2 below are **extensions of working systems,
not new ones** — that is the cheapest way to build them and the way that keeps
one rule in one place.

---

## 1. Enemy arsenal parity, and taking what they drop

**Intent.** Killing an enemy should be worth something material. Right now the
bots do not visibly range across the full arsenal, so a kill rarely changes
what you are carrying.

**Requirements.**

1. Bots draw from the **entire** arsenal, including `M9_HAMMERFALL`, not a
   rifle-only subset.
2. Weapon mix is weighted, not uniform. A yard where four of eight fighters
   carry rocket launchers is a fireworks display, not a firefight. Suggested
   opening weights: Kestrel 0.40, Breacher 0.20, Lance 0.20, P11 0.10,
   Hammerfall 0.10, with **at most one Hammerfall alive per side** at a time.
3. A killed fighter drops the weapon they were holding, as a `WEAPON` pickup,
   at the point of death.
4. A drop carries **ammunition with it** — the magazine as it stood plus a
   fraction of the dead fighter's reserve. Picking up a launcher with no rocket
   is a tease, not a reward.
5. Picking up a weapon you already hold takes its **ammo only**, and says so.
6. Drops expire on a timer so the yard does not silt up with rifles, and the
   timer is long enough to cross open ground for one.

**Constraints.** Damage, death and drops are server-owned in multiplayer
(CLAUDE.md, "Multiplayer"): the drop is decided in `multiplayer-sim`, never on
the client. Multiplayer Alpha cannot be pay-to-win, so a dropped weapon must be
available to whoever reaches it, with no entitlement check.

**Acceptance.** A player who kills a Hammerfall carrier can pick up the
launcher and fire it without returning to spawn; the pickup is authored once in
`multiplayer-sim` and consumed by both the client and the bot controller.

---

## 2. God Mode pickup — 30 seconds

**Intent.** An occasional, loud, obviously-temporary power spike, in the
tradition of a quad damage or an invulnerability rune.

**Requirements.**

1. A third pickup kind, `PICKUP_KIND.GOD_MODE`, spawning on the same scheduled
   mechanism health packs already use.
2. **30 seconds**, timed on the simulation clock, not wall time.
3. Effect: the holder takes no damage. Whether it also boosts outgoing damage
   is an open question below — it should be one or the other, not both.
4. Rare and irregular: a long base interval with jitter, so it is never a
   thing you can camp. Suggested 2–4 minutes, first spawn no earlier than 90 s.
5. Unmistakable while active — the model, a HUD countdown, and an audio cue at
   pickup and at expiry. A player must never be surprised by it ending.
6. Picking a second one up while active **extends** rather than stacks, and the
   total is capped at 30 s so two cannot chain into a minute.
7. It does not survive death. Dying drops it, full stop.

**Constraints.** Server-authoritative in multiplayer, like all damage. In
single-player the client may own it, exactly as the mosquito bite does.

**Open question.** Invulnerability in a 6v6 Team Deathmatch is a strong
statement. Worth deciding before building whether the multiplayer version is
invulnerability or something softer (heavy damage resistance, or a damage
boost), while single-player keeps the full version.

---

## 3. Two new weapons — arc pulse and flamethrower

**Intent.** Both were asked for ("maybe both"). They are genuinely different
weapons and should not be built as one reskinned in two colours.

### 3a. Arc pulse (electrical)

- Short-range, wide arc, chains between nearby targets.
- Low direct damage; the value is the **disable**, not the kill — a brief
  stagger, a scrambled HUD, or a weapon jam on whoever it catches.
- Charges before discharge, so committing to a shot is a real decision.
- Reads as a hard blue-white flash, which the existing `GlowLayer` already
  supports.

### 3b. Flamethrower

- Very short range, continuous fuel drain rather than a magazine.
- Damage over time that persists briefly after the stream stops, so it
  punishes standing still rather than tracking perfectly.
- Denies ground: the point is to make a lane unusable for a moment.
- The expensive part is the VFX, not the rules; budget it against PRD §30.

**Shared requirements.** Both need a model with `SOCKET_MUZZLE` (CLAUDE.md,
"Assets"), a first-person viewmodel, generated audio with variations, an entry
in `WEAPON_SPECS`, bot support, and inclusion in the drop table from item 1.
Neither is a paid weapon — CLAUDE.md forbids those in V1.

**Open question.** Five weapons is already a full loadout wheel. Decide whether
these two are additions or replacements before modelling anything, and whether
a damage-over-time and a status-effect model are worth introducing to
`game-core`, which currently has neither.

---

## 4. Outstanding — the night fireflies are not visible

Shipped in #84 and confirmed live, but a playtest reported seeing nothing.
Investigation found the code and models load correctly in production and the
swarm constructs (26 fireflies, all in frustum, nearest 7 m), yet no lantern
pixel reaches the frame in headless capture.

Two contributing causes are established:

1. **The PWA does not auto-update.** `apps/game/vite.config` sets
   `registerType: "prompt"` by design (PRD §27.4, never force an update
   mid-mission), so a returning player keeps the cached pre-merge bundle until
   they hard-reload. Any playtest of a just-shipped change must start with a
   hard reload, and this is worth saying in the release notes.
2. **True scale is below the resolution of the frame.** A 25 mm insect is under
   one pixel past roughly 30 m at 1080p, and the lantern is a third of it.

The verification could not be completed on the build box: it has no GPU, so
headless Chrome software-renders at about 1 fps, and the frame delta clamp
means insect time advances ~10x slower than wall time. **This needs a human
with a GPU**, which is the one thing the box cannot supply.

---

## Sequencing

Item 1 first: it extends a system that already works, it is the smallest
change, and it is the one that most changes how a fight plays. Item 2 next,
since it reuses the pickup scheduler item 1 touches. Item 3 last and only after
its open question is settled, because it is the only one that needs new art,
new audio and new rules all at once.
