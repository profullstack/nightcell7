"""
Import a Synty POLYGON character and retarget our animation set onto it.

Synty ships its SourceFiles without animation — the FBX carries a bind pose and
nothing else, because the walk and run cycles live in the Unity and Unreal
packages, which are engine-locked and unusable here. The characters are exactly
what the game needs (an `Insurgent` and a `Soldier`, by name, at ~2k triangles
on a 55-bone Unreal-standard skeleton) but they would stand frozen.

The animation we already ship is CC0 and rigged to a different skeleton, so
this maps one onto the other. Both are ordinary humanoids and every limb has a
counterpart, which is what makes a plain bone-name map sufficient — no IK
solving, no motion re-synthesis.

The retarget is done with copy-rotation constraints and a bake rather than by
copying f-curves directly. Curves are expressed in each bone's own rest space,
and the two rigs do not share rest orientations, so copying them produces a
figure with its arms through its chest. Constraints resolve in world space and
the bake writes the result back as ordinary keyframes.

**This script does not yet produce a shippable character**, and the output is
deliberately not wired into the game. What it does now is run correctly and
fail visibly, which it did not before. The remaining blocker is measured and
specific:

  * source rig rest pose:  0.69 m across (arms down), and no clip exceeds 0.72
  * Synty bind pose:       2.03 m across (T-pose, arms straight out)

Rest-relative retargeting transfers the source's *deviation from its own rest*.
With rests that far apart the legs transfer correctly and the arms never leave
the T-pose, which is exactly what the exported clips measure.

Two fixes were tried and rejected, both measured rather than eyeballed:

  * **Copy world orientation outright.** Removes the rest precondition, and
    discards the bone-axis conventions with it — the figure ends up lying down
    (2.14 x 0.52 x 0.39 for something 1.79 m tall).
  * **Re-rest the target into the source's A-pose** by rotating each bone by
    the minimal arc onto its counterpart's rest direction, then applying that
    as the rest pose. The corrections come out incoherent — 169 degrees on the
    left upper arm against 11 on the right, where a mirror pair must be
    symmetric — so the two rigs' rest frames are not being compared in a common
    basis, and the applied result is still 2.05 m across.

The more promising route is to stop retargeting altogether: skin the Synty
*mesh* to our existing rig with automatic weights and keep the clips we already
have working, rather than moving animation between skeletons at all.

Usage:
  blender --background --factory-startup --python import_synty.py -- \
      --fbx <SK_Chr_...fbx> --anims <source.glb> --atlas <texture.png> \
      --out <dest.glb>
"""

from __future__ import annotations

import os
import sys

import bpy

# Our animation rig on the left, the Unreal-standard Synty rig on the right.
#
# Every name here is checked against both armatures at run time and a mismatch
# is fatal — see `build_pairs`. The first version of this table was written from
# memory and got the *source* side wrong on almost every bone ("Hips",
# "LowerArm.L", "Wrist.L" against a rig that actually calls them "hips",
# "forearm.L", "hand.L"). Because the lookup skipped anything it could not find,
# the result was zero mapped bones, zero keyframes, five empty actions and a
# character exported in its bind pose — with no error anywhere. That silence is
# what the validation below exists to prevent.
#
# Fingers, toes, eyes and the IK helper bones are deliberately absent: our clip
# set does not animate them, and constraining them only adds bake cost.
BONE_MAP = {
    "hips": "Pelvis",
    "spine": "spine_01",
    "chest": "spine_02",
    "neck": "neck_01",
    "head": "head",
    "shoulder.L": "clavicle_l",
    "upperarm.L": "UpperArm_L",
    "forearm.L": "lowerarm_l",
    "hand.L": "Hand_L",
    "shoulder.R": "clavicle_r",
    "upperarm.R": "UpperArm_R",
    "forearm.R": "lowerarm_r",
    "hand.R": "Hand_R",
    "thigh.L": "Thigh_L",
    "shin.L": "calf_l",
    "foot.L": "Foot_L",
    "thigh.R": "Thigh_R",
    "shin.R": "calf_r",
    "foot.R": "Foot_R",
}

# The Synty rig carries a third spine bone our clips have no counterpart for.
# It is left at rest deliberately: an unmapped bone still follows its parent, so
# the chain stays continuous, and inventing motion for it would be worse than
# not moving it.

def arg(name: str, fallback=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else fallback


def only_armature(objects):
    found = [o for o in objects if o.type == "ARMATURE"]
    if not found:
        raise SystemExit("import_synty: no armature found")
    return found[0]


def main() -> None:
    fbx, anims, out = arg("--fbx"), arg("--anims"), arg("--out")
    atlas = arg("--atlas")
    if not fbx or not anims or not out:
        raise SystemExit("import_synty: --fbx, --anims and --out are required")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ---- the target: Synty character -------------------------------------
    bpy.ops.import_scene.fbx(filepath=fbx)
    target = only_armature(bpy.data.objects)
    target.name = "target_rig"
    target_meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    # Synty's bind pose is authored in centimetres; glTF is metres.
    if abs(target.scale.x - 1.0) < 1e-6 and target.dimensions.z > 10:
        target.scale = (0.01, 0.01, 0.01)

    # The FBX ships a bind-pose action that would otherwise export as a clip.
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    # ---- the source: our animated rig ------------------------------------
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=anims)
    imported = [o for o in bpy.data.objects if o not in before]
    source = only_armature(imported)
    source.name = "source_rig"
    # Only its animation is wanted; its geometry is discarded after baking.
    source_meshes = [o for o in imported if o.type == "MESH"]

    clips = [a for a in bpy.data.actions if a.users > 0 or a.use_fake_user]
    if not clips:
        raise SystemExit("import_synty: source glb carried no actions")

    # ---- retarget, rest-pose relative -------------------------------------
    #
    # Copy-rotation constraints in world space were the first attempt and are
    # wrong: they force the target bone to adopt the source bone's *absolute*
    # orientation, which is only correct if both skeletons share rest poses.
    # Synty uses Unreal's axis convention and our clips use another, so every
    # bone sat at its rest-pose difference from where it belonged and the error
    # compounded down each limb. The figure measured 1.90 x 2.00 x 2.47 m
    # instead of roughly 0.6 x 0.4 x 1.8 — limbs splayed in every direction.
    #
    # The correct relation carries the rest difference through:
    #
    #     target.matrix = source.matrix @ (source.rest⁻¹ @ target.rest)
    #
    # so the source's *motion away from its own rest* is what transfers, rather
    # than its raw orientation.
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    pairs = []
    missing = []
    for our_name, synty_name in BONE_MAP.items():
        t_bone = target.pose.bones.get(synty_name)
        s_bone = source.pose.bones.get(our_name)
        if t_bone is None:
            missing.append(f"target has no {synty_name!r}")
            continue
        if s_bone is None:
            missing.append(f"source has no {our_name!r}")
            continue
        pairs.append((s_bone, t_bone, None))

    # Fatal, not skipped.
    #
    # Skipping an unmatched bone is what made the first version of this script
    # produce a silent, plausible-looking failure: the whole map missed, nothing
    # was keyed, and a bind-posed character shipped. A name that does not
    # resolve means the table is wrong about a rig, and there is no useful
    # retarget to be had from the remainder.
    if missing:
        raise SystemExit(
            "import_synty: BONE_MAP does not match these rigs:\n  "
            + "\n  ".join(missing)
            + f"\n\nsource bones: {sorted(b.name for b in source.pose.bones)}"
            + f"\ntarget bones: {sorted(b.name for b in target.pose.bones)}"
        )

    # Parents before children: setting a pose bone's matrix reads its parent's
    # current transform, so a child solved first is immediately invalidated.
    def depth(pose_bone):
        n, b = 0, pose_bone.bone
        while b.parent:
            n += 1
            b = b.parent
        return n

    pairs.sort(key=lambda entry: depth(entry[1]))

    pairs = [
        (
            s_bone,
            t_bone,
            (source.matrix_world @ s_bone.bone.matrix_local).inverted()
            @ (target.matrix_world @ t_bone.bone.matrix_local),
        )
        for s_bone, t_bone, _ in pairs
    ]

    hips_pair = next((p for p in pairs if p[1].name == "Pelvis"), None)
    baked = []

    for clip in clips:
        source.animation_data_create()
        source.animation_data.action = clip

        start = int(clip.frame_range[0])
        end = int(clip.frame_range[1])

        target.animation_data_create()
        action = bpy.data.actions.new(f"__baked_{clip.name}")
        target.animation_data.action = action

        for pose_bone in target.pose.bones:
            pose_bone.rotation_mode = "QUATERNION"

        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()

            for s_bone, t_bone, rest_delta in pairs:
                # Rest-relative retarget:
                #
                #     T_pose = S_pose @ S_rest⁻¹ @ T_rest
                #
                # transfers the source's motion away from its own rest onto the
                # target's rest. This is the standard formula and it is correct
                # — but only when both skeletons share a reference pose, which
                # these two do NOT. See the module docstring: the arms come out
                # stuck in Synty's T-pose, and that is the remaining blocker.
                s_pose_world = source.matrix_world @ s_bone.matrix
                t_bone.matrix = target.matrix_world.inverted() @ (s_pose_world @ rest_delta)
                # Each child reads the parent just written, so flush per bone.
                bpy.context.view_layer.update()

            for _, t_bone, _ in pairs:
                t_bone.keyframe_insert("rotation_quaternion", frame=frame)
            if hips_pair:
                hips_pair[1].keyframe_insert("location", frame=frame)

        # An action with no curves is the signature of a retarget that ran
        # over an empty bone list. It exports as nothing at all, or — with
        # `export_bake_animation` on — as one anonymous baked clip named after
        # the object, which is how this last shipped broken.
        if not action.fcurves:
            raise SystemExit(
                f"import_synty: baking {clip.name!r} produced no curves "
                f"({len(pairs)} bone pairs, frames {start}-{end})"
            )

        source_name = clip.name
        clip.name = f"__src_{source_name}"
        action.name = source_name
        action.use_fake_user = True
        # Each action needs its own NLA track to survive the export.
        # `export_animation_mode="ACTIONS"` does not reliably find actions that
        # are merely present in the file with a fake user; a track makes the
        # association to this object explicit.
        track = target.animation_data.nla_tracks.new()
        track.name = source_name
        track.strips.new(source_name, int(action.frame_range[0]), action)
        baked.append(action.name)

    for obj in [source, *source_meshes]:
        bpy.data.objects.remove(obj, do_unlink=True)

    # Drop the source clips. They were renamed out of the way so the baked
    # results could take their names, but they still carry fake users and would
    # otherwise export alongside — doubling the animation count and the file.
    for action in list(bpy.data.actions):
        if action.name.startswith("__src_"):
            bpy.data.actions.remove(action)

    # ---- material naming --------------------------------------------------
    # Rename to a slot the engine knows, so the shared atlas is bound at load
    # exactly like the generated props' materials. Synty's own name
    # ("Characters_For_Andrew:lambert") is an artist's working name and means
    # nothing to us.
    for mesh in target_meshes:
        for slot in mesh.material_slots:
            if slot.material:
                slot.material.name = "synty_atlas"

    # ---- texture: Synty ships one shared atlas ---------------------------
    if atlas and os.path.exists(atlas):
        image = bpy.data.images.load(atlas)
        for mesh in target_meshes:
            for slot in mesh.material_slots:
                material = slot.material
                if not material:
                    continue
                material.name = "synty_atlas"
                material.use_nodes = True
                bsdf = material.node_tree.nodes.get("Principled BSDF")
                if not bsdf:
                    continue
                tex = material.node_tree.nodes.new("ShaderNodeTexImage")
                tex.image = image
                material.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
                bsdf.inputs["Metallic"].default_value = 0.0
                bsdf.inputs["Roughness"].default_value = 0.85

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        # OFF. With this on, the exporter emits a single baked animation per
        # object — named after the object, covering every bone in T/R/S — and
        # ignores the actions entirely. That is what "all five clips collapsed
        # into one called target_rig" actually was.
        export_bake_animation=False,
        export_nla_strips=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        # No embedded images. Synty puts every character on one shared atlas,
        # so embedding would ship the same 2 MB texture inside each character.
        # The engine binds it once by material name, exactly as it does for the
        # generated props.
        export_image_format="NONE",
    )

    print(
        f"SYNTY {os.path.basename(out)} bytes={os.path.getsize(out)} "
        f"clips={len(baked)} bones={len(pairs)}"
    )
    print(f"  {', '.join(sorted(baked))}")


main()
