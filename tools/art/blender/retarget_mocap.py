"""
Retarget MoCap Online's animation library onto a Synty POLYGON character.

This is the third attempt at animating these characters and the first that
works. The previous two are still in the tree with their findings — see
docs/HANDOFF-synty.md — and the reason they failed is the reason this one does
not.

Rest-relative retargeting transfers a source bone's *deviation from its own
rest* onto the target's rest:

    T_pose = S_pose @ S_rest⁻¹ @ T_rest

That formula is correct and standard, and it has one precondition: both
skeletons must share a reference pose. Our own generated rig rests arms-down at
0.69 m across while Synty binds in a T-pose at 2.03 m, so transferring
deviation moved the legs correctly and left the arms stuck out sideways for
every frame of every clip. Nothing about the maths was wrong; the inputs were.

MoCap Online's rig is a 3ds Max Biped, and it rests in a T-pose — measured at
1.95 m across against Synty's 2.03 m. Same reference pose, so the precondition
holds and the same formula that failed before now applies cleanly.

The two rigs still use different *names* (Biped's `LeftArm` against Unreal's
`UpperArm_L`), but a name map is a lookup table, not a problem.

**The retarget works. Wiring it into the game does not yet**, so this is not
called by `import-synty.mjs` and the bots still use the generated character.

Verified by render: idle, walk and run all produce an upright figure holding a
rifle in a two-handed aim, 1.72-1.79 m tall with the arms down (0.59-0.66 m
across), legs striding. That is the first time either character has animated
correctly.

What blocks shipping it: dropping the result into `Opponents` makes the bots
*invisible*. They load, no console error, no 404, and nothing draws. Two things
were tried and neither fixed it — wrapping every root node from
`instantiateModelsToScene` in one parent (the licensed GLB has an armature and a
mesh as separate roots, where the generated character has a single `__root__`),
and confirming the clip names survive the `name.split("_").pop()` lookup in
`placeAnimated`. The next step is to instrument what `placeAnimated` actually
returns for this container rather than reason about it.

Usage:
  blender --background --factory-startup --python retarget_mocap.py -- \
      --fbx <SK_Chr_...fbx> --clips <name=file.fbx> [--clips ...] \
      --out <dest.glb>
"""

from __future__ import annotations

import os
import sys

import bpy

# MoCap Online's 3ds Max Biped on the left, Synty's Unreal skeleton on the
# right. Both are ordinary humanoids and every limb has a counterpart, which is
# what makes a plain name map sufficient — no IK solving, no re-synthesis.
#
# Fingers, toes and the roll/twist helpers are deliberately absent: nothing
# downstream reads them and they only add bake cost.
BONE_MAP = {
    "Hips": "Pelvis",
    "Spine": "spine_01",
    "Spine1": "spine_02",
    "Spine2": "spine_03",
    "Neck": "neck_01",
    "Head": "head",
    "LeftShoulder": "clavicle_l",
    "LeftArm": "UpperArm_L",
    "LeftForeArm": "lowerarm_l",
    "LeftHand": "Hand_L",
    "RightShoulder": "clavicle_r",
    "RightArm": "UpperArm_R",
    "RightForeArm": "lowerarm_r",
    "RightHand": "Hand_R",
    "LeftUpLeg": "Thigh_L",
    "LeftLeg": "calf_l",
    "LeftFoot": "Foot_L",
    "RightUpLeg": "Thigh_R",
    "RightLeg": "calf_r",
    "RightFoot": "Foot_R",
}


def args(name: str) -> list[str]:
    return [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == name]


def arg(name: str, fallback=None):
    values = args(name)
    return values[0] if values else fallback


def armature(objects):
    found = [o for o in objects if o.type == "ARMATURE"]
    if not found:
        raise SystemExit("retarget_mocap: no armature")
    return found[0]


def depth(pose_bone) -> int:
    count, bone = 0, pose_bone.bone
    while bone.parent:
        count += 1
        bone = bone.parent
    return count


def main() -> None:
    fbx, out = arg("--fbx"), arg("--out")
    if not fbx or not out:
        raise SystemExit("retarget_mocap: --fbx and --out are required")

    clips = []
    for spec in args("--clips"):
        name, _, path = spec.partition("=")
        if not name or not path:
            raise SystemExit(f"retarget_mocap: --clips wants name=file.fbx, got {spec!r}")
        clips.append((name, path))
    if not clips:
        raise SystemExit("retarget_mocap: at least one --clips is required")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ---- the target: Synty character -------------------------------------
    bpy.ops.import_scene.fbx(filepath=fbx)
    target = armature(bpy.data.objects)
    target.name = "target_rig"
    target_meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    # Synty authors in centimetres; glTF is metres.
    if abs(target.scale.x - 1.0) < 1e-6 and target.dimensions.z > 10:
        target.scale = (0.01, 0.01, 0.01)

    # The FBX ships a bind-pose action that would otherwise export as a clip.
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    for pose_bone in target.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"

    baked: list[str] = []

    for clip_name, clip_path in clips:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=clip_path)
        imported = [o for o in bpy.data.objects if o not in before]
        source = armature(imported)

        # Flatten the source's object transform into its bones.
        #
        # The retarget below composes a *motion* (S_pose @ S_rest⁻¹) with the
        # target's rest, and moving a motion between spaces is a conjugation,
        # not a pre-multiply. Rather than carry that algebra, both armatures are
        # simply put in the same space: the target already had its transform
        # applied above, and this does the same for the source.
        #
        # Skipping it is not subtle — the mocap FBX imports Y-up while the Synty
        # FBX does not, so the residue is a flat 90 degrees and the character
        # animates lying on its back (measured 0.97 x 1.99 x 0.78 for something
        # 1.79 m tall).
        bpy.ops.object.select_all(action="DESELECT")
        source.select_set(True)
        bpy.context.view_layer.objects.active = source
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

        source_action = next(
            (a for a in bpy.data.actions if a.users > 0 and a is not None and a.fcurves), None
        )
        if source.animation_data is None or source.animation_data.action is None:
            raise SystemExit(f"retarget_mocap: {clip_path} carried no animation")
        source_action = source.animation_data.action
        # Blender 4.4+ slotted actions: an action assigned without a slot does
        # not evaluate, and every frame silently reads as the rest pose.
        if source_action.slots and source.animation_data.action_slot is None:
            source.animation_data.action_slot = source_action.slots[0]

        pairs = []
        missing = []
        for their_name, synty_name in BONE_MAP.items():
            s_bone = source.pose.bones.get(their_name)
            t_bone = target.pose.bones.get(synty_name)
            if s_bone is None:
                missing.append(f"mocap rig has no {their_name!r}")
                continue
            if t_bone is None:
                missing.append(f"Synty rig has no {synty_name!r}")
                continue
            rest_delta = s_bone.bone.matrix_local.inverted() @ t_bone.bone.matrix_local
            pairs.append((s_bone, t_bone, rest_delta))

        # Fatal, never skipped. A silently-skipped name is what let the first
        # version of the sibling script map zero bones, bake five empty actions
        # and export a character in its bind pose with no error anywhere.
        if missing:
            raise SystemExit(
                "retarget_mocap: BONE_MAP does not match these rigs:\n  " + "\n  ".join(missing)
            )

        # Parents before children: setting a pose bone's matrix reads its
        # parent's current transform, so a child solved first is invalidated.
        pairs.sort(key=lambda entry: depth(entry[1]))
        hips = next((p for p in pairs if p[1].name == "Pelvis"), None)

        target.animation_data_create()
        action = bpy.data.actions.new(clip_name)
        target.animation_data.action = action

        start, end = (int(v) for v in source_action.frame_range)
        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()

            for s_bone, t_bone, rest_delta in pairs:
                world = source.matrix_world @ s_bone.matrix @ rest_delta
                t_bone.matrix = target.matrix_world.inverted() @ world
                # Each child reads the parent just written, so flush per bone.
                bpy.context.view_layer.update()

            for _, t_bone, _ in pairs:
                t_bone.keyframe_insert("rotation_quaternion", frame=frame)
            if hips:
                hips[1].keyframe_insert("location", frame=frame)

        if not action.fcurves:
            raise SystemExit(f"retarget_mocap: {clip_name} baked no curves")

        action.use_fake_user = True
        # Each action needs its own NLA track to survive the export;
        # `export_animation_mode="ACTIONS"` does not reliably find loose ones.
        track = target.animation_data.nla_tracks.new()
        track.name = clip_name
        track.strips.new(clip_name, int(action.frame_range[0]), action)
        baked.append(clip_name)

        # The source rig and its mesh have served their purpose. Its action goes
        # too, or it exports alongside ours and doubles the clip count.
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)

    # Drop every action that is not one of ours.
    #
    # Each imported FBX brings its own action along, named after the source file
    # ("Armature|W2_Walk_Aim_F_Loop_IPC|..."). They carry the mocap rig's bone
    # names, so they do nothing to a Synty skeleton — but the exporter does not
    # know that and ships them anyway, which is four extra clips of dead weight
    # that all read as the bind pose.
    wanted = set(baked)
    for action in list(bpy.data.actions):
        if action.name not in wanted:
            bpy.data.actions.remove(action)

    # ---- material slot the engine binds the shared atlas to ---------------
    for mesh in target_meshes:
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
        # ignores the actions entirely.
        export_bake_animation=False,
        export_nla_strips=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_image_format="NONE",
    )

    print(f"MOCAP {os.path.basename(out)} bytes={os.path.getsize(out)} clips={len(baked)}")
    print(f"  {', '.join(baked)}")


main()
