"""
Player character — armoured operative.

The first version of this file stacked axis-aligned cubes. It read as a
Minecraft figure, and no amount of texturing fixes a silhouette made of blocks.
This one lofts the body from cross-sections that change along their length, so
limbs taper and the torso has a waist, and layers hard-surface gear on top.

The art direction does real work here. A helmeted, visored operative in heavy
gear is almost entirely *hard surface* — plates, pouches, straps, boots — which
is what a script is good at. The things procedural generation genuinely cannot
do well are faces, skin and bare hands, and this design has none of them
visible. That is a deliberate choice, not a dodge: it is also why real military
shooters can reuse one body under many loadouts.

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
    # ---- helmet: a cut-down sphere with a brow and a rail ------------------
    L.limb(
        armour,
        [
            ((0.0, -0.004, 1.585), 0.098, 0.104),
            ((0.0, -0.006, 1.635), 0.108, 0.115),
            ((0.0, -0.006, 1.685), 0.104, 0.110),
            ((0.0, -0.004, 1.730), 0.086, 0.092),
            ((0.0, 0.0, 1.762), 0.052, 0.056),
        ],
        segments=14,
    )
    # Brow / visor lip — the strongest single read on the head.
    L.add_box(armour, centre=(0.0, -0.098, 1.605), size=(0.185, 0.045, 0.055))
    # Visor itself, recessed and dark.
    L.add_box(gear, centre=(0.0, -0.082, 1.565), size=(0.155, 0.040, 0.062))
    # Side rails and an NVG mount: small asymmetric shapes that sell "kit".
    for sx in (-1, 1):
        L.add_box(gear, centre=(sx * 0.098, -0.010, 1.600), size=(0.020, 0.130, 0.030))
    L.add_box(gear, centre=(0.0, -0.085, 1.700), size=(0.055, 0.045, 0.030))
    # Ear cups.
    for sx in (-1, 1):
        L.add_cylinder(
            gear, centre=(sx * 0.100, -0.005, 1.545), radius=0.042, height=0.030,
            segments=10, axis="X",
        )
    # Comms boom.
    L.add_cylinder(gear, centre=(0.055, -0.075, 1.520), radius=0.010, height=0.10, segments=6, axis="Y")

    # ---- plate carrier -----------------------------------------------------
    # Front and back plates, slightly proud of the chest, with a shoulder yoke.
    L.add_box(armour, centre=(0.0, -0.115, 1.20), size=(0.270, 0.052, 0.330))
    L.add_box(armour, centre=(0.0, 0.112, 1.20), size=(0.270, 0.048, 0.330))
    for sx in (-1, 1):
        L.add_box(armour, centre=(sx * 0.135, 0.0, 1.345), size=(0.075, 0.240, 0.055))
    # Cummerbund.
    L.add_box(gear, centre=(0.0, 0.0, 1.055), size=(0.330, 0.235, 0.085))

    # ---- pouches -----------------------------------------------------------
    for i in range(3):
        L.add_box(
            gear,
            centre=(-0.105 + i * 0.105, -0.150, 1.105),
            size=(0.088, 0.058, 0.135),
        )
    # Radio on the back, admin pouch on the chest.
    L.add_box(gear, centre=(-0.115, 0.140, 1.240), size=(0.070, 0.050, 0.115))
    L.add_box(gear, centre=(0.085, -0.145, 1.290), size=(0.105, 0.035, 0.085))

    # ---- pauldrons ---------------------------------------------------------
    for sx in (-1, 1):
        # Tapered top and bottom so the plate sits *over* the shoulder and
        # blends into the arm. Straight-sided rings with capped ends read as a
        # separate blob floating beside the body, which is how the first
        # attempt rendered.
        L.limb(
            armour,
            [
                ((sx * 0.200, 0.0, 1.385), 0.038, 0.052),
                ((sx * 0.218, 0.0, 1.350), 0.062, 0.086),
                ((sx * 0.228, 0.0, 1.305), 0.066, 0.092),
                ((sx * 0.230, 0.0, 1.258), 0.060, 0.084),
                ((sx * 0.228, 0.0, 1.220), 0.044, 0.062),
            ],
            segments=12,
        )

    # ---- belt, holster, thigh rig -----------------------------------------
    L.add_box(gear, centre=(0.0, 0.0, 0.955), size=(0.330, 0.240, 0.062))
    L.add_box(gear, centre=(0.155, -0.020, 0.845), size=(0.070, 0.110, 0.190))  # holster
    L.add_box(gear, centre=(-0.140, -0.040, 0.800), size=(0.085, 0.075, 0.150))  # dump pouch

    # ---- knee pads, gloves, boots -----------------------------------------
    for sx in (-1, 1):
        x = sx * 0.098
        L.add_box(armour, centre=(x, -0.070, 0.455), size=(0.105, 0.055, 0.115))  # knee
        # Glove: a blockier cap on the wrist, so hands read without fingers.
        L.add_box(gear, centre=(sx * 0.205 - sx * 0.020, -0.205, 0.935), size=(0.078, 0.115, 0.082))
        # Boot: sole plus upper. Wider than the ankle, which anchors the figure.
        L.add_box(gear, centre=(x, -0.030, 0.028), size=(0.105, 0.255, 0.055))
        L.add_box(gear, centre=(x, -0.010, 0.085), size=(0.098, 0.170, 0.070))

    # ---- backpack ----------------------------------------------------------
    L.limb(
        gear,
        [
            ((0.0, 0.185, 1.045), 0.130, 0.070),
            ((0.0, 0.195, 1.120), 0.148, 0.082),
            ((0.0, 0.195, 1.250), 0.150, 0.084),
            ((0.0, 0.185, 1.330), 0.128, 0.070),
        ],
        segments=10,
        squash=0.55,
    )
    L.add_cylinder(gear, centre=(0.0, 0.268, 1.290), radius=0.045, height=0.26, segments=8, axis="X")
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

    L.finish_object(
        "character",
        [
            L.Part(body, L.MAT_RUBBER),
            L.Part(armour, L.MAT_PAINT_RED),
            L.Part(gear, L.MAT_RUBBER),
        ],
        shade_smooth_angle=math.radians(38),
    )

    # Collision proxy matching the simulated capsule.
    L.add_collider("character", (0.0, 0.0, HEIGHT / 2), (0.6, 0.4, HEIGHT))
    # Where a weapon world-model attaches, and where other players' tracers
    # should originate.
    L.add_socket("WEAPON", (0.20, -0.26, 0.95))
    L.add_socket("HEAD", (0.0, 0.0, 1.63))

    L.export_glb(L.output_path("character.glb"))


build()
