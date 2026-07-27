"""
Put a Synty POLYGON character on *our* rig, instead of moving animation onto
theirs.

`import_synty.py` tries the textbook thing: retarget our clips onto Synty's
55-bone Unreal skeleton. That is still blocked on a rest-pose mismatch (our rig
rests arms-down at 0.69 m across, Synty's bind is a T-pose at 2.03 m) and every
fix for it trades one artefact for another — see docs/HANDOFF-synty.md.

This script sidesteps the problem rather than solving it. Our rig already
carries all five clips, correctly, today. A Synty character is — for our
purposes — a 4,000-triangle mesh. So: bind the mesh to the rig we already have
and throw Synty's skeleton away. There is no retarget, because there are no
longer two skeletons.

The one thing that has to happen first is the pose. Automatic weights bind a
mesh *as it currently stands* to an armature *as it currently rests*, so a
T-posed mesh over an arms-down rig would weight the arms against thin air. The
mesh is therefore posed into our rig's A-pose using Synty's own armature, the
deformation is baked into the vertices, and only then is that armature deleted.

**Not finished, and not wired into the game.** It gets much further than the
retarget in `import_synty.py` — the export carries all five clips, the height
matches our rig to within 2%, and the torso, legs and head animate correctly —
but the arms do not survive the bind: one ends up locked straight out at
shoulder height and the other crumples into the chest.

What is known, so the next attempt does not re-derive it:

  * The pose step itself is correct. Every mapped arm bone reaches its target
    direction to within 0.0 degrees, verified by comparing achieved against
    wanted world directions bone by bone. The arms are provably pointing down
    before the mesh is baked, yet the baked mesh still measures 1.16 m across
    against our rig's 0.69 m — so the mesh is not following its own skeleton.
  * The `POSE_MAP` is arms-only for a measured reason (see the comment on it).
  * The character's extreme vertices are fingertips weighted to
    `indexFinger_03_l/r`, bones this script never poses. Whether the fingers
    are actually parented under `Hand_*` in Synty's FBX hierarchy has not been
    confirmed, and is the first thing to check.
  * The likeliest remaining cause is the automatic-weight bind rather than the
    pose: `ARMATURE_AUTO` weights the mesh as it stands against our rig's rest,
    and any residual arm mismatch there is enough to attach the whole limb to
    the torso.

Before spending more on this: the cheaper route is probably to stop moving
animation between skeletons in either direction, and instead get clips authored
*for* the Synty skeleton — an auto-rigging service takes the mesh and returns a
rigged, animated FBX, which needs no retarget and no rebind at all.

Usage:
  blender --background --factory-startup --python skin_synty.py -- \
      --fbx <SK_Chr_...fbx> --rig <character.glb> --out <dest.glb>
"""

from __future__ import annotations

import os
import sys

import bpy
from mathutils import Matrix, Vector

# Synty's bone on the left, ours on the right.
#
# **Arms only, deliberately.** The two rigs differ in exactly one way that
# matters here: Synty binds in a T-pose and ours rests arms-down. The spine,
# pelvis and legs already agree to within a few degrees.
#
# Including them is actively harmful, and measurably so: the pelvis and spine
# bones do not share a direction convention between an Unreal skeleton and
# ours, so "point this bone the way its counterpart points" rotates the whole
# body. With the full map the figure collapsed from 1.79 m tall to 0.49 m.
POSE_MAP = {
    "clavicle_l": "shoulder.L",
    "UpperArm_L": "upperarm.L",
    "lowerarm_l": "forearm.L",
    "Hand_L": "hand.L",
    "clavicle_r": "shoulder.R",
    "UpperArm_R": "upperarm.R",
    "lowerarm_r": "forearm.R",
    "Hand_R": "hand.R",
}


def arg(name: str, fallback=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else fallback


def bone_direction(armature, bone) -> Vector:
    """A bone's rest direction in world space. Blender bones run along local +Y."""
    return ((armature.matrix_world @ bone.matrix_local).to_quaternion() @ Vector((0, 1, 0))).normalized()


def body_meshes(objects):
    """
    The character mesh, never its collision proxy.

    `character.glb` ships a `COL_character` hull alongside the body, and it is
    both taller and far wider than the figure — 1.9 x 2.0 x 2.8 against
    0.69 x 0.62 x 1.75. Measuring the two together is what produced the
    long-standing "the retarget splays the limbs, 1.90 x 2.00 x 2.47" reading in
    docs/HANDOFF-synty.md, which was never true of the character at all.
    """
    return [
        o
        for o in objects
        if o.type == "MESH" and not o.name.startswith("COL_") and len(o.data.vertices) > 100
    ]


def measure(objects) -> Vector:
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        for vertex in mesh.vertices:
            world = evaluated.matrix_world @ vertex.co
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))
        evaluated.to_mesh_clear()
    return hi - lo


def pose_to_match(synty_rig, our_rig) -> None:
    """
    Pose the Synty skeleton into our rig's rest shape.

    Each mapped bone is given the world orientation that points it along its
    counterpart's rest direction. The rotation is computed against the bone's
    *rest* orientation and applied absolutely, not as a delta on whatever the
    bone currently reads.

    That distinction is the whole bug in the earlier attempt at this. Applying a
    rest-derived correction on top of the current orientation double-counts
    every parent: once the clavicle moves, the upper arm's current direction is
    no longer its rest direction, so the correction meant for the rest pose
    over-rotates it, and the errors compound down the limb. Setting each bone's
    orientation absolutely makes the order of operations irrelevant.
    """
    bpy.context.view_layer.objects.active = synty_rig
    bpy.ops.object.mode_set(mode="POSE")

    missing = []
    plan = []
    for synty_name, our_name in POSE_MAP.items():
        pose_bone = synty_rig.pose.bones.get(synty_name)
        our_bone = our_rig.data.bones.get(our_name)
        if pose_bone is None:
            missing.append(f"Synty rig has no {synty_name!r}")
            continue
        if our_bone is None:
            missing.append(f"our rig has no {our_name!r}")
            continue
        plan.append((pose_bone, bone_direction(our_rig, our_bone)))

    if missing:
        raise SystemExit("skin_synty: POSE_MAP does not match these rigs:\n  " + "\n  ".join(missing))

    # Parents first: a child's world orientation is only meaningful once its
    # parent is where it belongs.
    def depth(entry) -> int:
        count, bone = 0, entry[0].bone
        while bone.parent:
            count += 1
            bone = bone.parent
        return count

    for pose_bone, wanted in sorted(plan, key=depth):
        rest = (synty_rig.matrix_world @ pose_bone.bone.matrix_local).to_quaternion()
        have = (rest @ Vector((0, 1, 0))).normalized()
        # Minimal arc, so the bone keeps its own roll and only its direction
        # changes. Adopting the counterpart's full orientation instead would
        # drag our rig's twist convention across with it.
        target_rotation = have.rotation_difference(wanted) @ rest

        current = pose_bone.matrix
        pose_bone.matrix = Matrix.LocRotScale(
            current.to_translation(),
            synty_rig.matrix_world.to_quaternion().inverted() @ target_rotation,
            current.to_scale(),
        )
        bpy.context.view_layer.update()

    bpy.ops.object.mode_set(mode="OBJECT")


def main() -> None:
    fbx, rig_path, out = arg("--fbx"), arg("--rig"), arg("--out")
    if not fbx or not rig_path or not out:
        raise SystemExit("skin_synty: --fbx, --rig and --out are required")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ---- the Synty character: we want its mesh and nothing else -----------
    bpy.ops.import_scene.fbx(filepath=fbx)
    synty_objects = list(bpy.data.objects)
    synty_rig = next((o for o in synty_objects if o.type == "ARMATURE"), None)
    synty_meshes = body_meshes(synty_objects)
    if synty_rig is None or not synty_meshes:
        raise SystemExit("skin_synty: expected an armature and a mesh in the FBX")

    # Synty authors in centimetres.
    if abs(synty_rig.scale.x - 1.0) < 1e-6 and synty_rig.dimensions.z > 10:
        synty_rig.scale = (0.01, 0.01, 0.01)
        bpy.context.view_layer.update()

    # The FBX ships a bind-pose action that would export as a clip.
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    # ---- our rig, with the clips already on it ---------------------------
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=rig_path)
    ours = [o for o in bpy.data.objects if o not in before]
    our_rig = next((o for o in ours if o.type == "ARMATURE"), None)
    if our_rig is None:
        raise SystemExit("skin_synty: no armature in the rig file")
    our_meshes = [o for o in ours if o.type == "MESH"]
    our_body = body_meshes(ours)

    print(f"SKIN before pose: synty = {tuple(round(v, 2) for v in measure(synty_meshes))}")

    # ---- match the rest shape, then bake it into the vertices -------------
    pose_to_match(synty_rig, our_rig)
    posed = measure(synty_meshes)
    print(f"SKIN after pose:  synty = {tuple(round(v, 2) for v in posed)}")

    for mesh in synty_meshes:
        bpy.context.view_layer.objects.active = mesh
        for modifier in list(mesh.modifiers):
            if modifier.type == "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        # Nothing may still reference the skeleton about to be deleted.
        mesh.parent = None
        mesh.matrix_world = mesh.matrix_world.copy()
        mesh.vertex_groups.clear()

    bpy.data.objects.remove(synty_rig, do_unlink=True)

    # ---- height match ------------------------------------------------------
    #
    # Two humanoids from different packs are never the same height, and a
    # centimetre of mismatch reads as the head floating off the neck once the
    # mesh is weighted to someone else's spine.
    ours_size = measure(our_body)
    synty_size = measure(synty_meshes)
    if synty_size.z > 1e-4:
        factor = ours_size.z / synty_size.z
        # A sane correction is a few percent between two humanoids. Anything
        # larger means the pose step mangled the figure, and scaling would only
        # hide it — the first run collapsed the body and then "corrected" it by
        # 5.7x, which measures as the right height and looks like nothing.
        if not 0.75 <= factor <= 1.35:
            raise SystemExit(
                f"skin_synty: implausible height correction x{factor:.2f} "
                f"(synty {tuple(round(v, 2) for v in synty_size)} vs "
                f"ours {tuple(round(v, 2) for v in ours_size)}) — the pose step is wrong"
            )
        for mesh in synty_meshes:
            mesh.scale = tuple(v * factor for v in mesh.scale)
        bpy.context.view_layer.update()
        print(f"SKIN height match: x{factor:.4f}")

    # ---- bind to our rig ---------------------------------------------------
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in synty_meshes:
        mesh.select_set(True)
    our_rig.select_set(True)
    bpy.context.view_layer.objects.active = our_rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    for mesh in synty_meshes:
        if not any(m.type == "ARMATURE" for m in mesh.modifiers):
            raise SystemExit(f"skin_synty: {mesh.name} did not bind to the rig")

    # Our own placeholder body is replaced, not kept alongside.
    for mesh in our_meshes:
        bpy.data.objects.remove(mesh, do_unlink=True)

    # ---- material slot the engine binds the shared atlas to ---------------
    for mesh in synty_meshes:
        for slot in mesh.material_slots:
            if slot.material:
                slot.material.name = "synty_atlas"

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        # OFF: it emits one baked clip per object, named after the object, and
        # ignores the actions entirely. See docs/HANDOFF-synty.md.
        export_bake_animation=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        # The atlas is bound once by the engine, as for every other Synty asset.
        export_image_format="NONE",
    )

    clips = sorted(a.name for a in bpy.data.actions)
    print(
        f"SKIN {os.path.basename(out)} bytes={os.path.getsize(out)} "
        f"clips={len(clips)} verts={sum(len(m.data.vertices) for m in synty_meshes)}"
    )
    print(f"  {', '.join(clips)}")


main()
