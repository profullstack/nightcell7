"""
Convert a licensed character into the game's GLB format.

Written for the Quaternius CC0 pack, but nothing here is specific to it: it
imports a glTF, drops the animation clips the game does not use, and re-exports
a compact GLB.

Stripping clips is the whole point. The source ships 24 animations per
character — sword slashes, kicks, waving — and animation data is the bulk of
the file. Keeping only what the game plays takes a 3 MB character to well under
half that, which matters against the 15 MB shell budget (PRD §30).

Usage:
  blender --background --factory-startup --python import_character.py -- \
      --in <src.gltf> --out <dst.glb> --name <object-name>
"""

from __future__ import annotations

import os
import sys

import bpy

# What the game actually plays. Everything else is discarded.
KEEP = {
    "Idle_Gun",       # standing, weapon up
    "Idle_Gun_Shoot", # firing from a stand
    "Walk",
    "Run",
    "Run_Shoot",
    "Death",
    "HitRecieve",     # the pack's spelling
}


def arg(name: str, fallback=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else fallback


def main() -> None:
    source = arg("--in")
    target = arg("--out")
    if not source or not target:
        raise SystemExit("import_character: --in and --out are required")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=source)

    kept, dropped = [], []
    for action in list(bpy.data.actions):
        if action.name in KEEP:
            action.use_fake_user = True
            kept.append(action.name)
        else:
            dropped.append(action.name)
            bpy.data.actions.remove(action)

    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=target,
        export_format="GLB",
        export_apply=False,          # never apply modifiers on a skinned mesh
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )

    print(f"CONVERTED {os.path.basename(target)} bytes={os.path.getsize(target)}")
    print(f"  kept {len(kept)}: {', '.join(sorted(kept))}")
    print(f"  dropped {len(dropped)}")


main()
