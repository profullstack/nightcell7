# Saffron Freight and Nacre Relay

Original map and architectural art authored for NIGHTCELL 7 on 2026-09-27.
No external reference images, generated bitmap assets, or third-party models
were added. Existing perimeter and skyline art retains its recorded provenance.

Saffron Freight uses amber corrugated freight islands in alternating rows,
with taller stacks on the lateral approaches. Nacre Relay uses pale ceramic
relay houses, charcoal ventilation panels and jade signal bands around an open
cross-shaped plaza. Both have protected central spawn approaches and continuous
outer flanks. These are independently authored interiors, not transformed copies
of Ardavan Yard.

`packages/multiplayer-sim/src/map.ts` owns every architectural solid.
`apps/game/src/yard-art.ts` draws each at its exact collision extent and adds
surface ribs, vents, frames and original SF/NR lettering. Canvas-generated signs
and deploy-screen plan diagrams are deterministic code-native artwork.

The free demo, bot deathmatch, range and roam modes can select yards. Online
matchmaking remains on its existing Ardavan contract. Range target positions
are adapted to the new interiors. Day/night selection remains independent.

Validation includes player capsule clearance and navigation to every spawn,
pickup and range target, selected-map combat simulation, browser selection,
and rendered scene inspection. No new download assets are required.

## Screenshots and gameplay films

Eight 1600×900 screenshots cover day and night overviews, ground-level routes,
and architectural detail. The homepage, `/yards`, `/gallery`, press, news,
multiplayer and episode pages reuse these captures through the existing image
viewer. The asset gallery adds close-up views of the new architecture alongside
the original model contact sheet.

Reproduce the screenshots after building the game:

```sh
node tools/art/capture.mjs --collection new-yards --out apps/site/public/media/new-yards --width 1600 --height 900
```

Each new yard also has a 30-second bot-deathmatch film. The capture tool drives
movement, shooting, reloading and a grenade throw through real game inputs.
It steps the normal simulation on a virtual clock and captures 900 frames at
30 fps, then encodes H.264/AAC MP4. Software capture uses one MSAA sample,
512-pixel shadows and adaptive resolution; geometry, bots and gameplay rules
are unchanged. Audio is the existing game soundtrack mixed with yard ambience,
not live recorded weapon or radio audio. Posters are frames from the films.

```sh
node tools/art/trailer.mjs --yard saffron_freight --seconds 30 --gameplay-only --time day --out apps/site/public/media/yard-films/saffron
node tools/art/trailer.mjs --yard nacre_relay --seconds 30 --gameplay-only --time day --out apps/site/public/media/yard-films/nacre
```

Each output directory contains a manifest with its source commit, capture time,
settings and file metadata. The films appear on the homepage, yards, gallery and
press pages with native controls and no autoplay or video preloading.
