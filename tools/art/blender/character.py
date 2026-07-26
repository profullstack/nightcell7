"""
Player character — armoured operative.

The first version of this file stacked axis-aligned cubes. It read as a
Minecraft figure, and no amount of texturing fixes a silhouette made of blocks.
This one lofts the body from cross-sections that change along their length, so
limbs taper and the torso has a waist, and layers hard-surface gear on top.

Deliberately an **irregular fighter**, not a regular soldier. The earlier
version was a high-cut ballistic helmet, NVG mount, plate carrier and
pauldrons — unmistakably a Western regular, which is wrong for a story whose
premise is that neither side is the default villain. This one wears a cloth
head wrap, a field jacket, and a simple chest rig over civilian trousers: the
silhouette of someone fighting with what they have rather than what they were
issued.

It stays **fictional and unmarked**. No insignia, no script, no religious or
ethnic signifiers — those would be caricature, and CLAUDE.md gates
Iranian/Farsi content on native review that has not happened. Faction identity
is carried by an armband and head-wrap accent in the team colour, nothing else.

The art direction still does real work for a script: cloth wraps, webbing,
pouches and boots are simple forms, and a wrapped head with a shadowed face
avoids the facial detail procedural generation cannot do well.

Rules that still hold from the first version:

  1. **Readable silhouette.** Competitive play depends on identifying a shape in
     a fraction of a second against cluttered industrial geometry. Pauldrons, a
     distinct helmet brow, and a backpack give an outline recognisable from any
     angle.
  2. **Team identity by material, never geometry.** Both sides are the exact
     same mesh with a different paint material, so neither presents a smaller
     target. PRD: Multiplayer Alpha cannot be pay-to-win, and a slimmer skin
     would be precisely that.
  3. **1.8 m standing**, matching the capsule the server simulates, centred on
     the origin in plan so the mesh sits on the simulated position with no
     offset fudge.
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _lib as L  # noqa: E402
import animate  # noqa: E402

HEIGHT = 1.8

# Roughly 7.5 heads, the standard heroic-but-not-cartoon proportion.
HEAD_TOP = 1.80
NECK_Y = 1.46
CHEST_Y = 1.28
WAIST_Y = 1.02
HIP_Y = 0.92


def build_torso(body: L.Part) -> None:
    """
    Torso lofted hips -> waist -> chest -> shoulders.

    The chest section is much wider than deep (squash pushes it toward a
    rounded rectangle); a circular section reads as a barrel, not a ribcage.
    """
    L.limb(
        body,
        [
            ((0.0, 0.0, HIP_Y - 0.10), 0.155, 0.115),
            ((0.0, 0.0, HIP_Y), 0.160, 0.120),
            ((0.0, 0.0, WAIST_Y), 0.145, 0.105),
            ((0.0, 0.0, WAIST_Y + 0.12), 0.170, 0.120),
            ((0.0, 0.0, CHEST_Y), 0.195, 0.135),
            ((0.0, 0.0, CHEST_Y + 0.10), 0.200, 0.138),
            ((0.0, 0.0, NECK_Y - 0.04), 0.165, 0.120),
        ],
        segments=14,
        squash=0.35,
    )


def build_legs(body: L.Part) -> None:
    for side in (-1, 1):
        x = side * 0.098
        # Thigh -> knee -> calf -> ankle. The calf bulge is small but it is
        # what stops a leg reading as a cone.
        L.limb(
            body,
            [
                ((x, 0.0, HIP_Y), 0.098, 0.098),
                ((x, 0.005, 0.72), 0.092, 0.094),
                ((x, 0.004, 0.50), 0.075, 0.078),
                ((x, 0.0, 0.44), 0.070, 0.072),  # knee
                ((x, -0.004, 0.34), 0.076, 0.080),  # calf
                ((x, 0.0, 0.16), 0.055, 0.058),
                ((x, 0.0, 0.09), 0.050, 0.054),  # ankle
            ],
            segments=10,
        )


def build_arms(body: L.Part) -> None:
    for side in (-1, 1):
        x = side * 0.225
        # Shoulder -> bicep -> elbow -> forearm -> wrist, drifting forward as
        # it descends so the arms hang naturally rather than pin-straight.
        L.limb(
            body,
            [
                ((x, 0.0, CHEST_Y + 0.08), 0.072, 0.072),
                ((x, -0.005, 1.24), 0.068, 0.070),
                ((x, -0.015, 1.10), 0.058, 0.060),
                ((x - side * 0.005, -0.030, 1.00), 0.052, 0.054),  # elbow
                ((x - side * 0.012, -0.075, 0.95), 0.050, 0.052),
                ((x - side * 0.020, -0.150, 0.94), 0.044, 0.046),  # wrist
            ],
            segments=10,
        )


def build_head(body: L.Part) -> None:
    """Neck and the skull under the helmet — mostly hidden, but it fills the gap."""
    L.limb(
        body,
        [
            ((0.0, 0.0, NECK_Y - 0.05), 0.062, 0.058),
            ((0.0, 0.0, NECK_Y + 0.03), 0.058, 0.055),
            ((0.0, -0.005, 1.56), 0.078, 0.082),
            ((0.0, -0.008, 1.63), 0.086, 0.092),
            ((0.0, -0.005, 1.70), 0.080, 0.086),
            ((0.0, 0.0, 1.745), 0.055, 0.060),
        ],
        segments=12,
    )


def build_gear(armour: L.Part, gear: L.Part, rng) -> None:
    """
    Everything worn over the body.

    Hard surface, faceted, bevelled — the contrast against the smooth body
    underneath is what makes the gear read as equipment rather than anatomy.
    """
    # ---- head wrap ---------------------------------------------------------
    # A shemagh-style wrap: bulkier and rounder than a helmet, with a tail down
    # the back. Reads as cloth at a glance, which is the whole point.
    L.limb(
        gear,
        [
            ((0.0, -0.004, 1.545), 0.092, 0.098),
            ((0.0, -0.006, 1.600), 0.104, 0.112),
            ((0.0, -0.006, 1.660), 0.101, 0.108),
            ((0.0, -0.004, 1.715), 0.082, 0.090),
            ((0.0, 0.0, 1.752), 0.048, 0.054),
        ],
        segments=14,
    )
    # Folded band around the brow, in the team colour — the one faction marker
    # above the waist.
    L.limb(
        armour,
        [
            ((0.0, -0.006, 1.583), 0.106, 0.114),
            ((0.0, -0.006, 1.612), 0.108, 0.116),
        ],
        segments=14,
    )
    # Tail of the wrap hanging over the shoulder and down the back.
    L.add_box(gear, centre=(0.045, 0.088, 1.520), size=(0.115, 0.070, 0.150), rotation_z=0.12)
    L.add_box(gear, centre=(0.060, 0.105, 1.410), size=(0.095, 0.055, 0.120), rotation_z=0.20)
    # Face cloth: the lower face is covered, which is both characterful and the
    # reason this model needs no facial geometry.
    L.add_box(gear, centre=(0.0, -0.082, 1.520), size=(0.150, 0.048, 0.078))
    # Shadowed eye band.
    L.add_box(gear, centre=(0.0, -0.088, 1.578), size=(0.140, 0.035, 0.030))

    # ---- field jacket and chest rig ---------------------------------------
    # A soft jacket rather than armour: no shoulder yoke, no rigid front plate.
    # Slight asymmetry (one closure flap) keeps it from reading as a uniform.
    L.add_box(gear, centre=(0.0, -0.108, 1.20), size=(0.290, 0.048, 0.340))
    L.add_box(gear, centre=(0.0, 0.104, 1.20), size=(0.290, 0.044, 0.340))
    L.add_box(gear, centre=(0.055, -0.128, 1.20), size=(0.075, 0.022, 0.330))  # closure flap

    # Chest rig: a simple harness of straps and magazine pouches, worn over the
    # jacket. Four pouches sized for rifle magazines, not modular panels.
    for sx in (-1, 1):
        L.add_box(gear, centre=(sx * 0.088, -0.060, 1.320), size=(0.048, 0.170, 0.030))  # strap
    L.add_box(gear, centre=(0.0, -0.128, 1.130), size=(0.300, 0.030, 0.028))  # rig base
    for i in range(4):
        L.add_box(
            gear,
            centre=(-0.117 + i * 0.078, -0.150, 1.190),
            size=(0.066, 0.055, 0.145),
        )
    # Canvas satchel on the hip and a bandolier across the chest.
    L.add_box(gear, centre=(-0.170, 0.030, 0.960), size=(0.090, 0.130, 0.170))
    for i in range(6):
        L.add_box(
            gear,
            centre=(-0.115 + i * 0.050, -0.140, 1.305 - i * 0.026),
            size=(0.044, 0.036, 0.052),
            rotation_z=0.0,
        )

    # Armband — the faction marker. Cloth tied round the upper arm, which is
    # how an irregular unit actually identifies itself.
    for sx in (-1, 1):
        L.limb(
            armour,
            [
                ((sx * 0.252, -0.004, 1.190), 0.070, 0.072),
                ((sx * 0.250, -0.006, 1.140), 0.072, 0.074),
            ],
            segments=10,
        )

    # ---- belt, holster, thigh rig -----------------------------------------
    L.add_box(gear, centre=(0.0, 0.0, 0.955), size=(0.330, 0.240, 0.062))
    L.add_box(gear, centre=(0.155, -0.020, 0.845), size=(0.070, 0.110, 0.190))  # holster
    L.add_box(gear, centre=(-0.140, -0.040, 0.800), size=(0.085, 0.075, 0.150))  # dump pouch

    # ---- knee pads, gloves, boots -----------------------------------------
    for sx in (-1, 1):
        x = sx * 0.098
        # Cloth knee wrap rather than a moulded pad.
        L.add_box(gear, centre=(x, -0.062, 0.455), size=(0.108, 0.048, 0.098))
        # Glove: a blockier cap on the wrist, so hands read without fingers.
        L.add_box(gear, centre=(sx * 0.205 - sx * 0.020, -0.205, 0.935), size=(0.078, 0.115, 0.082))
        # Boot: sole plus upper. Wider than the ankle, which anchors the figure.
        L.add_box(gear, centre=(x, -0.030, 0.028), size=(0.105, 0.255, 0.055))
        L.add_box(gear, centre=(x, -0.010, 0.085), size=(0.098, 0.170, 0.070))

    # ---- backpack ----------------------------------------------------------
    # A rolled blanket and a small canvas pack, not a modern rucksack.
    L.add_cylinder(gear, centre=(0.0, 0.185, 1.300), radius=0.055, height=0.34, segments=10, axis="X")
    L.limb(
        gear,
        [
            ((0.0, 0.170, 1.040), 0.115, 0.062),
            ((0.0, 0.180, 1.110), 0.128, 0.072),
            ((0.0, 0.178, 1.210), 0.124, 0.070),
            ((0.0, 0.168, 1.255), 0.100, 0.056),
        ],
        segments=10,
        squash=0.5,
    )
    _ = rng


def build(seed: int = 31) -> None:
    L.reset_scene()
    rng = L.rng(seed)

    body = L.new_bmesh()  # skin/undersuit, smoothed
    armour = L.new_bmesh()  # team-coloured plate
    gear = L.new_bmesh()  # webbing, boots, weapon furniture — always dark

    build_torso(body)
    build_legs(body)
    build_arms(body)
    build_head(body)
    build_gear(armour, gear, rng)

    # Smooth only the body. Gear keeps its hard edges; a smoothed plate carrier
    # looks inflated rather than rigid.
    L.subdivide_smooth(body, cuts=1)

    L.bevel(armour, width=0.006)
    L.bevel(gear, width=0.005)

    mesh = L.finish_object(
        "character",
        [
            L.Part(body, L.MAT_RUBBER),
            L.Part(armour, L.MAT_PAINT_RED),
            L.Part(gear, L.MAT_RUBBER),
        ],
        shade_smooth_angle=math.radians(38),
    )

    # ---- rig and animation -------------------------------------------------
    # Bound by proximity rather than Blender's automatic weights: this mesh is
    # a union of many disjoint pieces, and bone-heat weighting needs closed
    # connected geometry — it fails outright here.
    rig = L.build_armature("character_rig")
    L.bind_by_proximity(mesh, rig)
    animate.build_all(rig)

    # Collision proxy matching the simulated capsule.
    L.add_collider("character", (0.0, 0.0, HEIGHT / 2), (0.6, 0.4, HEIGHT))
    # Where a weapon world-model attaches, and where other players' tracers
    # should originate.
    L.add_socket("WEAPON", (0.20, -0.26, 0.95))
    L.add_socket("HEAD", (0.0, 0.0, 1.63))

    L.export_glb(L.output_path("character.glb"), animated=True)


build()
