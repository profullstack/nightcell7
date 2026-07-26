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
# Fingers, toes, eyes and the IK helper bones are deliberately absent: nothing
# in our clip set animates them, and constraining them only adds bake cost.
BONE_MAP = {
    "Hips": "Pelvis",
    "Abdomen": "spine_01",
    "Torso": "spine_02",
    "Chest": "spine_03",
    "Neck": "neck_01",
    "Head": "head",
    "Shoulder.L": "clavicle_l",
    "UpperArm.L": "UpperArm_L",
    "LowerArm.L": "lowerarm_l",
    "Wrist.L": "Hand_L",
    "Shoulder.R": "clavicle_r",
    "UpperArm.R": "UpperArm_R",
    "LowerArm.R": "lowerarm_r",
    "Wrist.R": "Hand_R",
    "UpperLeg.L": "Thigh_L",
    "LowerLeg.L": "calf_l",
    "Foot.L": "Foot_L",
    "UpperLeg.R": "Thigh_R",
    "LowerLeg.R": "calf_r",
    "Foot.R": "Foot_R",
}


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

    # ---- constrain target bones to their source counterparts -------------
    for our_name, synty_name in BONE_MAP.items():
        bone = target.pose.bones.get(synty_name)
        if bone is None or source.pose.bones.get(our_name) is None:
            continue
        constraint = bone.constraints.new("COPY_ROTATION")
        constraint.target = source
        constraint.subtarget = our_name
        constraint.target_space = "WORLD"
        constraint.owner_space = "WORLD"

    # The hips also translate — without this the figure runs on the spot.
    hips = target.pose.bones.get("Pelvis")
    if hips and source.pose.bones.get("Hips"):
        loc = hips.constraints.new("COPY_LOCATION")
        loc.target = source
        loc.subtarget = "Hips"
        loc.target_space = "WORLD"
        loc.owner_space = "WORLD"

    # ---- bake each clip onto the target ----------------------------------
    bones = [b for b in BONE_MAP.values() if target.pose.bones.get(b)]
    baked = []

    for clip in clips:
        source.animation_data_create()
        source.animation_data.action = clip

        start = int(clip.frame_range[0])
        end = int(clip.frame_range[1])
        bpy.context.scene.frame_start = start
        bpy.context.scene.frame_end = end

        bpy.ops.object.select_all(action="DESELECT")
        target.select_set(True)
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.mode_set(mode="POSE")
        for bone in target.pose.bones:
            bone.bone.select = bone.name in bones

        bpy.ops.nla.bake(
            frame_start=start,
            frame_end=end,
            only_selected=True,
            visual_keying=True,
            clear_constraints=False,
            clear_parents=False,
            use_current_action=False,
            bake_types={"POSE"},
        )
        bpy.ops.object.mode_set(mode="OBJECT")

        action = target.animation_data.action
        # Free the source name first. Blender appends .001 if the name is taken,
        # and the engine looks clips up by exact name — "Walk.001" is a clip the
        # game will never ask for.
        source_name = clip.name
        clip.name = f"__src_{source_name}"
        action.name = source_name
        action.use_fake_user = True
        baked.append(action.name)

    # Constraints have served their purpose; leaving them in would re-drive the
    # baked keys from a source rig that is about to be deleted.
    for bone in target.pose.bones:
        for constraint in list(bone.constraints):
            bone.constraints.remove(constraint)

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
        export_bake_animation=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        # No embedded images. Synty puts every character on one shared atlas,
        # so embedding would ship the same 2 MB texture inside each character.
        # The engine binds it once by material name, exactly as it does for the
        # generated props.
        export_image_format="NONE",
    )

    print(f"SYNTY {os.path.basename(out)} bytes={os.path.getsize(out)} clips={len(baked)}")
    print(f"  {', '.join(sorted(baked))}")


main()
