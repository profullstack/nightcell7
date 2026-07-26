"""
Import a Synty POLYGON static mesh (vehicle or prop) and bind it to a shared
engine material slot.

This is the easy sibling of `import_synty.py`. That script exists only because
Synty ships its *characters* without animation and the clips have to be
retargeted onto a foreign skeleton — a hard, brittle job. Vehicles and props
carry no rig and no animation, so there is nothing to retarget: the whole job
is unit conversion, material naming, and recentring so the engine can place the
model by its ground contact point.

Two facts about the raw SourceFiles FBX, both confirmed by probing, shape this:

  1. **The FBX is already in metres.** Blender's FBX importer reads Synty's unit
     metadata and lands the mesh at real-world scale (an armoured car imports at
     2.5 x 1.5 x 4.65 m). `import_synty.py`'s manual 0.01 was for the *skeletal*
     character FBX, which imports differently; applying it here would shrink a
     vehicle to centimetres. So this script scales nothing — it only *applies*
     the importer's transform so it bakes into the vertices.

  2. **Every mesh shares one placeholder material ("VehicleSHD").** The Unity
     prefab assigns real materials per mesh (body -> a Land_Vehicles atlas,
     windows -> the shared Texture_01_A atlas), but that assignment does not
     survive to the FBX — it is one generic shader on everything. The mesh
     *names* do survive, though, and they carry the distinction: a windscreen is
     "..._Glass...". So materials are assigned by mesh name, not by the source
     material name, which does not exist here.

The engine binds textures by material-slot name at load time exactly as it does
for the characters and the generated props (see `apps/game/src/assets.ts`), so
the GLB ships no embedded image. That is what lets every vehicle share one
357 KB atlas instead of embedding a 2 MB texture apiece.

Usage:
  blender --background --factory-startup --python import_synty_prop.py -- \
      --fbx <SM_Veh_...fbx> --out <dest.glb> \
      --primary-slot synty_vehicles \
      --primary-atlas <Land_Vehicles_NN.png> \
      --glass-atlas <PolygonMilitary_Texture_01_A.png> \
      [--preview <preview.png>]

`--primary-slot` defaults to `synty_atlas`, which is right for props: they were
authored against Texture_01_A, which the game already ships under that name, so
a prop needs no new texture at all. The two `--atlas` arguments are only used to
render the preview faithfully; the exported GLB never carries them.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Vector


def arg(name: str, fallback=None):
    argv = sys.argv
    return argv[argv.index(name) + 1] if name in argv else fallback


def has(name: str) -> bool:
    return name in sys.argv


def visible_meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def combined_bounds(objects):
    """World-space bounding box over `objects`."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))
    return lo, hi


def bind_atlas(material, atlas_path):
    """Attach `atlas_path` to the material's base colour for a faithful preview.

    The exported GLB drops this again (`export_image_format="NONE"`); it exists
    so the preview render shows the real UVs sampling the real atlas, which is
    the only honest test that a single shared atlas maps a given vehicle
    correctly.
    """
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        return
    image = bpy.data.images.load(atlas_path, check_existing=True)
    tex = material.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    material.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.75


def render_preview(out_png: str) -> None:
    """A cheap hero shot to eyeball geometry and texturing.

    Deliberately a near-copy of `preview.py`'s framing so previews across the
    asset set read consistently. Cycles on CPU: a headless box has no GL
    context for EEVEE.
    """
    lo, hi = combined_bounds(visible_meshes())
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.5)

    bpy.ops.mesh.primitive_plane_add(size=radius * 20, location=(centre.x, centre.y, lo.z))
    ground = bpy.context.active_object
    ground_mat = bpy.data.materials.new("preview_ground")
    ground_mat.use_nodes = True
    gb = ground_mat.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = (0.05, 0.055, 0.065, 1.0)
    gb.inputs["Roughness"].default_value = 0.7
    ground.data.materials.append(ground_mat)

    aim = bpy.data.objects.new("aim", None)
    aim.location = centre
    bpy.context.collection.objects.link(aim)

    def lamp(name, energy, color, offset):
        light = bpy.data.lights.new(name, type="AREA")
        light.energy = energy * radius * radius
        light.size = radius * 3
        light.color = color
        obj = bpy.data.objects.new(name, light)
        obj.location = centre + Vector(offset) * radius
        bpy.context.collection.objects.link(obj)
        track = obj.constraints.new("TRACK_TO")
        track.target = aim

    lamp("key", 130, (1.0, 0.82, 0.6), (2.2, -2.4, 2.6))
    lamp("fill", 38, (0.55, 0.72, 1.0), (-2.8, -1.6, 1.4))
    lamp("rim", 70, (0.6, 0.8, 1.0), (-1.2, 3.0, 1.8))

    cam_data = bpy.data.cameras.new("preview")
    cam_data.lens = 55
    cam = bpy.data.objects.new("preview", cam_data)
    cam.location = centre + Vector((radius * 2.6, -radius * 3.0, radius * 1.9))
    bpy.context.collection.objects.link(cam)
    track = cam.constraints.new("TRACK_TO")
    track.target = aim
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("preview_world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.02,
        0.025,
        0.035,
        1.0,
    )
    scene.render.filepath = out_png
    os.makedirs(os.path.dirname(os.path.abspath(out_png)), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW {out_png}")


def main() -> None:
    fbx, out = arg("--fbx"), arg("--out")
    if not fbx or not out:
        raise SystemExit("import_synty_prop: --fbx and --out are required")

    primary_slot = arg("--primary-slot", "synty_atlas")
    primary_atlas = arg("--primary-atlas")
    glass_atlas = arg("--glass-atlas")
    preview = arg("--preview")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=fbx)

    meshes = visible_meshes()
    if not meshes:
        raise SystemExit("import_synty_prop: no mesh in FBX")

    # ---- geometry cleanup ------------------------------------------------
    #
    # Synty's SourceFiles FBX exports every face all but isolated: the armoured
    # car arrives as 24k triangles carried by 44k vertices, a 3.6x blow-up from
    # smoothing splits and doubled seams. Uncompressed glTF stores one vertex
    # record per unique vertex, so that duplication is paid for byte-for-byte in
    # the download. Welding coincident vertices recovers most of it with no
    # visible change — UVs live per face-corner and survive the merge, and
    # normals are recomputed from Synty's own smoothing angle afterwards.
    weld = float(arg("--weld", "0.0002"))
    decimate = float(arg("--decimate", "0")) if has("--decimate") else 0.0
    for mesh in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        if weld > 0:
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.mesh.remove_doubles(threshold=weld)
            bpy.ops.object.mode_set(mode="OBJECT")
            # Re-smooth from Synty's own crease angle. The auto-smooth operator
            # was renamed in Blender 4.1; fall back for older builds.
            try:
                bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
            except (AttributeError, RuntimeError, TypeError):
                bpy.ops.object.shade_smooth()
        if decimate > 0:
            mod = mesh.modifiers.new("decimate", "DECIMATE")
            mod.ratio = decimate
            bpy.ops.object.modifier_apply(modifier=mod.name)

    # The importer already brought the mesh in at metres; apply its transform so
    # the 0.01 unit scale bakes into the vertices rather than riding on the
    # object, then recentre on the ground so the engine can place by the model's
    # foot. Sanity-check the result: a vehicle or prop is metres, not
    # centimetres and not tens of metres.
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    lo, hi = combined_bounds(meshes)
    if max(hi - lo) > 60 or max(hi - lo) < 0.05:
        raise SystemExit(
            f"import_synty_prop: implausible size {tuple(round(v, 2) for v in (hi - lo))} — "
            "unit metadata not as expected"
        )

    centre = (lo + hi) / 2
    for obj in meshes:
        if obj.parent is None:
            obj.location -= Vector((centre.x, centre.y, lo.z))
    bpy.context.view_layer.update()

    # ---- materials: assigned by MESH name -------------------------------
    #
    # The FBX carries one placeholder shader on every mesh, so the body/glass
    # split has to come from the mesh name. Glass was authored against the
    # shared Texture_01_A atlas (which ships as `synty_atlas`); everything else
    # samples the primary slot.
    slot_materials: dict[str, bpy.types.Material] = {}

    def material_for(slot: str) -> bpy.types.Material:
        mat = slot_materials.get(slot)
        if mat is None:
            mat = bpy.data.materials.new(slot)
            atlas = glass_atlas if slot == "synty_atlas" else primary_atlas
            if atlas and os.path.exists(atlas):
                bind_atlas(mat, atlas)
            slot_materials[slot] = mat
        return mat

    for mesh in meshes:
        slot = "synty_atlas" if "glass" in mesh.name.lower() else primary_slot
        mat = material_for(slot)
        if not mesh.data.materials:
            mesh.data.materials.append(mat)
        else:
            for i in range(len(mesh.data.materials)):
                mesh.data.materials[i] = mat

    # Drop any orphaned placeholder materials the FBX brought in.
    for m in list(bpy.data.materials):
        if m.name not in slot_materials and m.name != "preview_ground":
            if m.users == 0:
                bpy.data.materials.remove(m)

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        # No embedded images: the engine binds the shared atlas by material
        # name, exactly as it does for the characters and generated props.
        export_image_format="NONE",
    )

    size = os.path.getsize(out)
    slots = ", ".join(sorted(slot_materials))
    print(f"SYNTY_PROP {os.path.basename(out)} bytes={size} slots=[{slots}]")

    # Preview last: it drops a ground plane and lights into the live scene, and
    # exporting after that would ship the ground plane inside the GLB. The
    # export above does not touch the in-memory materials, so the atlas is still
    # bound for a faithful render.
    if preview:
        render_preview(preview)


main()
