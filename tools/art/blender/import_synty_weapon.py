"""
Assemble a Synty POLYGON weapon from its parts and export it as one GLB.

Synty ships weapons modular: a `Preset` is a receiver, and the magazine, sight,
trigger, slide and charging handle are separate FBX files that share its origin.
That is right for a kit where players swap attachments; here it would mean six
draw calls and six files for one rifle, so the parts are imported together and
joined.

Two things this does that the prop converter does not:

  * **Places `SOCKET_MUZZLE`.** CLAUDE.md requires it on every weapon, and the
    engine spawns muzzle flash and tracer origins there. The barrel axis is
    detected from the mesh rather than assumed, because the pack is not
    consistent about which way a weapon faces and a socket on the wrong end
    puts the flash behind the player's shoulder.
  * **Names the material slot.** Synty's own names are an artist's working
    names ("RoyaleMaterial182", "lambert2368") and mean nothing to the engine,
    which binds the shared weapons atlas by slot name.

Static FBX, so already in metres — only Synty's *skeletal* files are in
centimetres. Applying a 0.01 scale here would produce an invisible weapon.

Usage:
  blender --background --factory-startup --python import_synty_weapon.py -- \
      --base <SM_Wep_Preset_A_Rifle_01> --out <dest.glb> [--slot synty_weapons]
"""

from __future__ import annotations

import glob
import os
import sys

import bpy
import bmesh
from mathutils import Vector

# Parts that belong to a weapon but are not wanted on a first-person model.
# Bipods hang below the barrel and read as damage at viewmodel distance; the
# fold-out variants duplicate geometry that is already there.
SKIP_SUFFIXES = ("_Bipod_L", "_Bipod_R", "_Forgrip_Fold", "_RailCanted")


def arg(name: str, fallback=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else fallback


def barrel_tip(objects) -> tuple[Vector, str, float]:
    """
    Find the muzzle: the point the bore exits, in world space.

    Two questions, answered separately.

    **Which axis, and which end?** The longest axis is the barrel. The end is
    decided by the pistol grip — it is the lowest part of any firearm and always
    sits behind the barrel, so the muzzle is the far end from it.

    The obvious alternative, "the muzzle end is thinner than the receiver end",
    was tried first and is wrong: it holds for the rifle and the sniper and
    fails on the SMG, whose folding stock is a thin rod that reads as thinner
    than the barrel. Rendering a marker at the socket is what caught it — the
    numbers alone looked plausible for all three.

    **Where across the barrel?** Only from geometry at the tip. Using the whole
    weapon's bounding-box centre puts the socket below the bore, because the
    magazine and grip drag the centre downward, and muzzle flash then spawns
    under the barrel.
    """
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    points: list[Vector] = []

    for obj in objects:
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            points.append(world)
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))

    size = hi - lo
    axis = max(range(3), key=lambda i: size[i])
    # Of the two cross axes, the grip hangs along the taller one.
    down = max((i for i in range(3) if i != axis), key=lambda i: size[i])

    # Where the grip sits along the barrel axis: the mean of the lowest slice.
    grip = [p for p in points if p[down] <= lo[down] + size[down] * 0.18]
    grip_at = sum(p[axis] for p in grip) / len(grip) if grip else (lo[axis] + hi[axis]) / 2

    muzzle_is_low = abs(lo[axis] - grip_at) > abs(hi[axis] - grip_at)
    end = lo[axis] if muzzle_is_low else hi[axis]

    # Centre of just the geometry at that end — the barrel's cross-section.
    band = size[axis] * 0.04
    at_tip = [p for p in points if abs(p[axis] - end) <= band] or points
    tip = Vector(
        (end if i == axis else sum(p[i] for p in at_tip) / len(at_tip) for i in range(3))
    )
    return tip, "xyz"[axis], size[axis]


def main() -> None:
    base = arg("--base")
    out = arg("--out")
    slot = arg("--slot", "synty_weapons")
    if not base or not out:
        raise SystemExit("import_synty_weapon: --base and --out are required")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    parts = sorted(glob.glob(f"{base}*.fbx"))
    if not parts:
        raise SystemExit(f"import_synty_weapon: nothing matched {base}*.fbx")

    for path in parts:
        stem = os.path.basename(path)[:-4]
        if any(stem.endswith(suffix) for suffix in SKIP_SUFFIXES):
            continue
        bpy.ops.import_scene.fbx(filepath=path)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("import_synty_weapon: no meshes imported")

    tip, axis, length = barrel_tip(meshes)

    # ---- join into one object -------------------------------------------
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()

    weapon = bpy.context.view_layer.objects.active
    weapon.name = os.path.basename(out)[:-4]

    # ---- one material slot the engine can bind ---------------------------
    weapon.data.materials.clear()
    material = bpy.data.materials.new(slot)
    material.use_nodes = True
    weapon.data.materials.append(material)

    # ---- weld: the parts meet at coincident vertices ---------------------
    mesh = bmesh.new()
    mesh.from_mesh(weapon.data)
    bmesh.ops.remove_doubles(mesh, verts=mesh.verts[:], dist=0.0002)
    mesh.to_mesh(weapon.data)
    mesh.free()

    # ---- bake the import transform into the mesh -------------------------
    #
    # The FBX importer leaves the weapon with a 0.01 scale and a -90° X rotation
    # (Synty authors in centimetres, Y-up). That is invisible in Blender and
    # survives export as a node transform, which means every child coordinate is
    # expressed in centimetres in a rotated basis. The socket below then reads
    # as `72.0` rather than `0.72` — correct once the parent is applied, but
    # unreadable, untestable, and a trap for anything that reads the node
    # directly. Applying it here makes object space world space.
    bpy.ops.object.select_all(action="DESELECT")
    weapon.select_set(True)
    bpy.context.view_layer.objects.active = weapon
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # ---- SOCKET_MUZZLE, at the barrel tip ---------------------------------
    #
    # Deliberately not parented to the weapon. A rigid weapon needs no bone to
    # follow, and a root-level socket exports its position in plain metres in
    # the same space as the mesh — matching the generated carbine, which the
    # engine and the asset tests both already expect. Parenting it cost an
    # earlier round of this: `location` set before parenting is interpreted in
    # the parent's space, so the socket landed at the origin, on the shooter
    # rather than the barrel.
    socket = bpy.data.objects.new("SOCKET_MUZZLE", None)
    socket.empty_display_type = "ARROWS"
    socket.empty_display_size = 0.05
    bpy.context.collection.objects.link(socket)
    socket.location = tip

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        # The atlas is bound once by the engine, as with every other Synty
        # asset — embedding it per weapon would ship the same texture each time.
        export_image_format="NONE",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
    )

    weapon.data.calc_loop_triangles()
    print(
        f"WEAPON {os.path.basename(out)} bytes={os.path.getsize(out)} "
        f"tris={len(weapon.data.loop_triangles)} parts={len(parts)} "
        f"barrel={axis} len={length:.3f} muzzle=({tip.x:.3f},{tip.y:.3f},{tip.z:.3f})"
    )


main()
