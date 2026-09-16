# IRON RAIN art release

Original NIGHTCELL 7 industrial military art for Ardavan: pale concrete, slate-blue equipment, orange utility markings, dark asphalt, cool daylight and fitted operator equipment. This is stylized browser-game art, not a claim of photorealistic production assets.

All 27 non-approved runtime models are rebuilt as `m3_*.glb`. The approved `m2_carbine_fp.glb` is retained byte for byte. Both operators have new geometry, original skeletons, idle/walk/run/death clips and attachment sockets. The world rifle variants deliberately follow the approved C7 family. No previous M2 scenery or operator mesh is loaded. Old generators remain only as historical source and shared primitive/weapon helpers; their environment and character builders are not called.

`replacements.json` lists every runtime replacement. `docs/art/iron-rain-overview.webp` shows all shipped models, including the retained rifle. The asset manifest records hashes, geometry counts, materials and animation clips. Runtime materials use the shared atlas; the approved weapon retains its coating and normal maps. Effects and streamed music are unchanged audio.

## Reproduce

Requires Blender 4.5 LTS, Node 22+, ffmpeg, repository dependencies and isolated optimizer dependencies:

```sh
npm ci --prefix tools/art/full-set --workspaces=false --ignore-scripts
BLENDER=/path/to/blender node tools/art/build-assets.mjs --previews
node tools/art/full-set/validate.mjs
node tools/art/iron-rain/make-overview.mjs /path/to/chromium
node tools/art/iron-rain/smoke.mjs /path/to/chromium --pointer-lock-adapter
```

The last command uses a headless pointer-lock adapter; native browser pointer locking is not asserted. It exercises seven visible combatants, gate pause, the remembered roam-mode regression and outgoing damage. Automated opponent tests cover floor alignment, continued incoming fire and respawn. Generated Blender masters and intermediate renders go to `build/iron-rain`; optimized GLBs and textures ship in `apps/game/public/assets`.

New content version 1.3.0 and service-worker cache revision keep multiplayer content and browser caches aligned. Wire protocol is unchanged. The existing 9 MiB model/texture/effect-audio budget remains enforced; this release is approximately 7 MiB. See `texture-prompts.md` and runtime `PROVENANCE.md` for origins.
