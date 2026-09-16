# NIGHTCELL 7 — tactical asset study 01

An original first pass toward grounded military FPS art, prepared after reviewing
`profullstack/nightcell7` at commit `e5b3dae25a607ddc731111454e3dee93aa982b97`.
These are actual 3D meshes, supplied as GLB and editable Blender scenes. The
renders show the exported geometry. The integrated full-set pipeline now lives in `tools/art/full-set`. This folder
retains the reproducible three-asset study and its standalone viewer.

## Included

| Asset          | Visible triangles | Render primitives | GLB bytes | Dimensions                               |
| -------------- | ----------------: | ----------------: | --------: | ---------------------------------------- |
| C7 carbine     |            17,344 |                 7 |   612,836 | 0.958 m long, 0.415 m high               |
| Equipment case |             5,956 |                 6 |   231,316 | 0.884 × 0.586 × 0.475 m                  |
| Concrete cover |             4,372 |                 4 |   202,652 | 2.400 m long, 0.781 m deep, 1.063 m high |

All three GLBs together: **1,046,804 bytes**. The viewer engine, source scenes,
preview PNGs, and shared maps are additional bytes. Primitive counts exclude
collision proxies and represent base rendering submissions before shadow passes.

- `models/`: geometry, UVs, normals, named PBR materials and attachment points.
- `textures/`: four shared detail normal maps from the repository's original
  procedural material library. GLBs do not embed or reference textures; the
  included adapter binds the shared maps. Roughness and metallic use authored
  scalar factors. No baked wear/albedo/AO texture set is claimed.
- `source/`: editable `.blend` files plus the generation and viewer sources.
- `previews/`: studio renders of the exported GLBs; Babylon captures when present.
- `index.html` / `viewer.js`: standalone Babylon orbit viewer, including wireframe.
- `manifest.json`, `structure-check.json`, `validation.json`: provenance and checks.

## Review locally

Extract the ZIP, open a terminal in its directory, and run:

```sh
python3 -m http.server 8765
```

Open `http://localhost:8765`. A local server is required for GLB loading; opening
`index.html` through `file://` is insufficient. The viewer bundles Babylon and
loads all files locally. Drag to orbit, scroll to zoom, or toggle wireframe.

## What the source review found

1. The runtime already supports the necessary format: Babylon 7, GLB, named
   material slots, shared normal/ORM maps and instanced static props. Replacing
   the engine is unnecessary for this art experiment.
2. The active viewmodel is `wep_rifle`, not the generated `carbine`. The former
   uses the Synty color atlas. Only editing `tools/art/blender/weapon.py` would
   therefore leave the visible player weapon unchanged.
3. `viewmodel.ts` sets every cloned PBR material's `albedoColor` to gray `(0.62,
0.62, 0.62)`. That replaces authored colors on a new multi-material model.
4. `world.ts` uses ambient intensity 4.05, key intensity 5.4, exposure 2.05 and
   bloom threshold 0.62. `assets.ts` compensates by dimming Synty albedos. A
   realistic material set should be evaluated under a neutral reference rig,
   then tuned in the actual yard; copying these compensations blindly will
   alter surface response and color.
5. Map collision is authoritative in `packages/multiplayer-sim/src/map.ts`.
   Existing barrier volumes are 3.2 m high. The low cover in this study cannot
   simply replace `prop_barrier` without reconciling silhouette and collision.

Source links:

- https://github.com/profullstack/nightcell7/blob/e5b3dae25a607ddc731111454e3dee93aa982b97/apps/game/src/assets.ts
- https://github.com/profullstack/nightcell7/blob/e5b3dae25a607ddc731111454e3dee93aa982b97/apps/game/src/viewmodel.ts
- https://github.com/profullstack/nightcell7/blob/e5b3dae25a607ddc731111454e3dee93aa982b97/apps/game/src/world.ts
- https://github.com/profullstack/nightcell7/blob/e5b3dae25a607ddc731111454e3dee93aa982b97/packages/multiplayer-sim/src/map.ts

## Integration notes

The active game was left intact. Use the isolated viewer to approve proportions
and materials first. `bind-materials.ts` supplies the missing binding for the
`nc7_*` material names, preserving their glTF base colors. It also removes
`COL_` meshes from renderable containers. Pass it the pack base URL after GLB
loading and before instantiating.

The rifle is authored along Blender -Y / glTF +Z. As with existing weapons,
Babylon's handedness conversion means the existing `Math.PI` weapon yaw remains
relevant. The muzzle is at glTF `(0, 0.007, 0.612)`. A starting framing estimate
is scale 0.525 and forward offset 0.324, placing the muzzle around 0.645 m from
the camera. These are calculated starting values, **not validated in-game
framing**; ADS and hand alignment still require captures. Five anchors are
included: muzzle, ejection, sight, left grip and right grip.

Before selecting the sample as a viewmodel, restrict the existing gray atlas
compensation to Synty materials, for example:

```ts
if (source.name === "synty_weapons") {
  clone.albedoColor = new Color3(0.62, 0.62, 0.62);
}
```

The same principle applies to environment intensity. Preserve sample factors,
then tune them against the actual rig light and exposure. The adapter intentionally
does not change scene lighting or gameplay.

Load this pack on demand for evaluation. Adding every new mesh to the default
`MODELS` array also makes the game preload it. The existing art budget gate is
9 MiB; do not raise that gate merely to add an art study. Profile the final
replacement set after removing superseded downloads or using separate content
loading. This sample has no world LODs yet.

## Reproduce

Geometry requires Blender 4.5+. From the extracted pack:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python source/tools/art/tactical-sample/generate.py -- --out ./rebuilt
```

Copy the delivered `textures/` into `rebuilt/textures/`, then render:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python source/tools/art/tactical-sample/preview.py -- --pack ./rebuilt
node source/tools/art/tactical-sample/validate.mjs ./rebuilt
```

The generation source imports the included upstream `_lib.py` helper. Source
Blender scenes preserve editable geometry and material factors; shared normal
maps are rebound by the render script or Babylon adapter.

To rebuild the viewer, copy `source/tools/art/tactical-sample/` into an installed
Nightcell7 checkout, then run from the repository root:

```sh
pnpm install --frozen-lockfile
node tools/art/tactical-sample/build-viewer.mjs
```

Geometry generation and the viewer build are separate steps. `build-viewer.mjs`
expects the model manifest and exported GLBs to exist in `build/tactical-sample/`.

## Remaining work for a production military FPS look

This first pass establishes shape, scale, material separation and integration
contracts. The main remaining work is high-poly detail and baked normal/AO maps,
paint wear tied to edges and contact, dedicated albedo/roughness authoring,
optimized distant LODs, first-person arms, and reload/ADS animation. A production
weapon should separate animated components; this review export merges by
material to limit draw submissions. Characters, vehicles and the full level
were not replaced. The studio renders use their own lights and are not claims
about the result in the current yard.
