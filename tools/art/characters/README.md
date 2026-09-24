# Cast art: Blender characters, finished renders

Two steps, both deterministic to rerun.

1. **`build.py` (Blender).** Builds each person in `cast.json` as a 3D
   character and renders them in Cycles: a MakeHuman body from MPFB 2 shaped by
   macro sliders and face targets, subsurface skin, strand hair and stubble as
   particle hair, MakeHuman garments refitted and recoloured, and modelled gear
   (plate carrier, pouches, headset, glasses, Leila's headscarf). The rig is
   posed out of its A-pose and lit on a night stage (key, fill, coloured rim,
   out-of-focus yard lamps, wet ground, thin haze).
2. **`refine.mjs` (image model).** Sends each Blender portrait to the OpenAI
   image edit endpoint with the brief in `refine.json`, which keeps the person,
   pose, framing, gear and lights and raises skin, hair and fabric detail. The
   refined master is what the site and the game's deploy gate show.

## One-time setup

```sh
mise use -g blender@5.2.2
# Blender needs these for libGL/libatk on the dev box:
export LD_LIBRARY_PATH=$HOME/.local/share/mise/installs/ffmpeg/9.0.1/lib:$HOME/.local/share/chrome-deps/usr/lib/x86_64-linux-gnu

# MPFB 2.0.17 from extensions.blender.org (GPL-3.0), checksum-pinned:
curl -L -o mpfb.zip https://extensions.blender.org/download/sha256:4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87/add-on-mpfb-v2.0.17.zip
blender --background --factory-startup --command extension install-file -r user_default -e mpfb.zip

# MakeHuman system assets (CC0) into MPFB's user data folder:
curl -L -o mh.zip http://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
unzip -q mh.zip -d ~/.config/blender/5.2/extensions/.user/user_default/mpfb/data
```

## Run

```sh
blender --background --python tools/art/characters/build.py -- \
  --out build/characters --samples 128 --shots portrait,full --no-export
node tools/art/characters/refine.mjs            # needs OPENAI_API_KEY
```

Useful flags on `build.py`: `--only rook,leila`, `--scale 50` and
`--samples 24` for a quick look, `--skip strands,stubble` to isolate the hair.
A portrait at 128 samples takes about five minutes on the dev box's CPU.

`refine.mjs` never overwrites a refined master. To redo one, move
`docs/art/characters/raw/<id>.png` aside and run it with `--only <id>`.
