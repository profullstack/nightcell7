"""
Asset preview renderer.

CLAUDE.md requires every asset to be previewed and validated. A triangle count
tells you nothing about whether a model actually looks like the thing it is
supposed to be, so this loads a built GLB and renders a hero shot of it.

Cycles on CPU rather than EEVEE: EEVEE needs a real GL context, which a
headless build box does not have. Sample count is deliberately low — this is a
"did the geometry come out right" check, not a beauty render.

Usage:
  blender --background --factory-startup --python preview.py -- \
      --glb build/models/container.glb --out build/previews/container.png
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Vector


def arg(name: str, fallback: str | None = None) -> str | None:
    argv = sys.argv
    return argv[argv.index(name) + 1] if name in argv else fallback


def scene_bounds():
    """World-space bounding box of every mesh, used to frame the camera."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name.startswith("COL_"):
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))
    if not found:
        raise SystemExit("preview: no visible mesh in GLB")
    return lo, hi


def main() -> None:
    glb = arg("--glb")
    out = arg("--out")
    if not glb or not out:
        raise SystemExit("preview: --glb and --out are required")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)

    # Colliders are structural, not visual — hide them so they do not obscure
    # the model being reviewed.
    for obj in bpy.data.objects:
        if obj.name.startswith("COL_"):
            obj.hide_render = True

    lo, hi = scene_bounds()
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.5)

    # ---- ground plane so the model has something to sit on and shadow onto
    bpy.ops.mesh.primitive_plane_add(size=radius * 20, location=(centre.x, centre.y, lo.z))
    ground = bpy.context.active_object
    ground_mat = bpy.data.materials.new("preview_ground")
    ground_mat.use_nodes = True
    ground_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        0.05,
        0.055,
        0.065,
        1.0,
    )
    ground_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
    ground.data.materials.append(ground_mat)

    # ---- three-point-ish lighting, warm key / cool fill, matching the game
    # Energies scale with radius squared, not radius: these lights are placed a
    # multiple of `radius` away, and irradiance falls off with distance
    # squared. Scaling linearly blows out every large asset.
    key = bpy.data.lights.new("key", type="AREA")
    key.energy = 130 * radius * radius
    key.size = radius * 3
    key.color = (1.0, 0.82, 0.6)
    key_obj = bpy.data.objects.new("key", key)
    key_obj.location = centre + Vector((radius * 2.2, -radius * 2.4, radius * 2.6))
    bpy.context.collection.objects.link(key_obj)

    fill = bpy.data.lights.new("fill", type="AREA")
    fill.energy = 38 * radius * radius
    fill.size = radius * 4
    fill.color = (0.55, 0.72, 1.0)
    fill_obj = bpy.data.objects.new("fill", fill)
    fill_obj.location = centre + Vector((-radius * 2.8, -radius * 1.6, radius * 1.4))
    bpy.context.collection.objects.link(fill_obj)

    rim = bpy.data.lights.new("rim", type="AREA")
    rim.energy = 70 * radius * radius
    rim.size = radius * 2
    rim.color = (0.6, 0.8, 1.0)
    rim_obj = bpy.data.objects.new("rim", rim)
    rim_obj.location = centre + Vector((-radius * 1.2, radius * 3.0, radius * 1.8))
    bpy.context.collection.objects.link(rim_obj)

    for light in (key_obj, fill_obj, rim_obj):
        track = light.constraints.new("TRACK_TO")
        empty = bpy.data.objects.new(f"aim_{light.name}", None)
        empty.location = centre
        bpy.context.collection.objects.link(empty)
        track.target = empty

    # ---- camera: three-quarter view, the angle that shows form best
    cam_data = bpy.data.cameras.new("preview")
    cam_data.lens = 60
    cam = bpy.data.objects.new("preview", cam_data)
    angle = math.radians(38)
    cam.location = centre + Vector(
        (
            math.cos(angle) * radius * 3.1,
            math.sin(angle) * radius * 3.1 + radius * 1.4,
            radius * 1.35,
        )
    )
    bpy.context.collection.objects.link(cam)
    aim = bpy.data.objects.new("aim_cam", None)
    aim.location = centre
    bpy.context.collection.objects.link(aim)
    cam.constraints.new("TRACK_TO").target = aim
    bpy.context.scene.camera = cam

    # ---- world: dark, slightly blue, like the yard at night
    world = bpy.data.worlds.new("preview")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.03, 0.05, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = world

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(arg("--samples", "48"))
    scene.cycles.use_denoising = True
    scene.render.resolution_x = int(arg("--width", "900"))
    scene.render.resolution_y = int(arg("--height", "640"))
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.render.filepath = out

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW {out}")


main()
