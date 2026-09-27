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
