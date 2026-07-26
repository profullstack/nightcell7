"""
Structural geometry for ARDAVAN YARD.

Every piece here is sized against a collision volume in
`packages/multiplayer-sim/src/map.ts`. That file is the authority: if a volume
moves, the art follows it, never the other way round. The project rule is that
what you see is what you collide with, so a prop that is prettier but the wrong
size is a bug, not a style choice.

Volumes this file serves (x, y-up, z in metres):

  tank         8 x 8 x 12    east lane storage vessels
  deck         8 x 0.4 x 4   catwalk / gantry decking, tiled along z
  pipe_rack    4 x 4 x 5     west lane pipe run, tiled along z
  wall         2 x 12 x 6    perimeter, tiled along its long axis
  hardpoint   12 x 2.6 x 8   central objective block
  stair        2 x 1.5 x 4   ramp steps
  lamp_mast    -             9 m mast, placed freely

Run all of them with one Blender start:
  blender --background --factory-startup --python yard.py -- --output <dir>
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _lib as L  # noqa: E402


# --------------------------------------------------------------------- tank


def build_tank(seed: int = 21) -> None:
    """
    Horizontal pressure vessel on saddle supports.

    The collision volume is 8 x 8 x 12, which no vertical cylinder fills
    convincingly. A horizontal vessel of diameter 8 running the 12 m length
    fills it almost exactly, and reads instantly as refinery plant. The corners
    the cylinder cannot reach are filled with a walkway, ladder and pipework so
    the silhouette does not obviously fall short of its own collision box.
    """
    L.reset_scene()
    rng = L.rng(seed)

    radius = 4.0
    length = 12.0
    body = L.new_bmesh()
    steel = L.new_bmesh()

    # Shell, lying along Y, centred at Z = radius so it sits in the volume.
    L.add_cylinder(
        body, centre=(0.0, 0.0, radius), radius=radius, height=length, segments=32, axis="Y"
    )

    # Dished heads. A pressure vessel never ends in a flat disc, and the flat
    # version read as a cut-off tube. Approximated with two stepped rings
    # rather than a real torispherical surface — at gameplay distance the
    # silhouette is all that matters and this costs a fraction of the triangles.
    for sy in (-1, 1):
        for step, (r_scale, offset) in enumerate(((0.92, 0.30), (0.70, 0.52), (0.38, 0.66))):
            L.add_cylinder(
                body,
                centre=(0.0, sy * (length / 2 + offset), radius),
                radius=radius * r_scale,
                height=0.26 if step < 2 else 0.2,
                segments=32,
                axis="Y",
            )

    # Reinforcing bands. Real vessels are rolled from plate and banded at the
    # seams; the bands also break up a very large untextured cylinder.
    for i in range(5):
        y = -length / 2 + (i + 0.5) * (length / 5)
        L.add_cylinder(
            steel, centre=(0.0, y, radius), radius=radius + 0.06, height=0.22, segments=32, axis="Y"
        )

    # Saddle supports.
    for sy in (-1, 1):
        y = sy * length * 0.3
        L.add_box(steel, centre=(0.0, y, 0.45), size=(radius * 1.7, 0.6, 0.9))
        for sx in (-1, 1):
            L.add_box(steel, centre=(sx * radius * 0.7, y, 1.15), size=(0.3, 0.55, 0.7))

    # Top walkway with kick rails, spanning the length.
    L.add_box(steel, centre=(0.0, 0.0, radius * 2 - 0.05), size=(1.4, length * 0.92, 0.1))
    for sx in (-1, 1):
        for i in range(7):
            y = -length * 0.42 + i * (length * 0.84 / 6)
            L.add_cylinder(
                steel,
                centre=(sx * 0.68, y, radius * 2 + 0.5),
                radius=0.035,
                height=1.0,
                segments=6,
            )
        L.add_cylinder(
            steel,
            centre=(sx * 0.68, 0.0, radius * 2 + 0.98),
            radius=0.045,
            height=length * 0.86,
            segments=6,
            axis="Y",
        )

    # End-cap nozzles and a manway, so the ends are not bare discs.
    for sy in (-1, 1):
        L.add_cylinder(
            steel,
            centre=(0.0, sy * (length / 2 + 0.2), radius),
            radius=0.55,
            height=0.4,
            segments=16,
            axis="Y",
        )
        L.add_cylinder(
            steel,
            centre=(radius * 0.45, sy * (length / 2 + 0.15), radius * 0.6),
            radius=0.22,
            height=0.3,
            segments=10,
            axis="Y",
        )

    # Access ladder up one side.
    for i in range(14):
        z = 0.4 + i * 0.55
        if z > radius * 2 - 0.2:
            break
        L.add_cylinder(
            steel, centre=(-radius - 0.25, length * 0.36, z), radius=0.025, height=0.6,
            segments=6, axis="X",
        )
    for sy in (-0.12, 0.12):
        L.add_cylinder(
            steel,
            centre=(-radius - 0.25, length * 0.36 + sy * 4, radius),
            radius=0.03,
            height=radius * 2 - 0.3,
            segments=6,
        )

    # Pipework running off the vessel, filling the volume's dead corners.
    for i, (px, pz) in enumerate(((radius * 0.8, 0.9), (radius * 0.86, 1.7))):
        L.add_cylinder(
            steel, centre=(px, 0.0, pz), radius=0.16 + i * 0.04, height=length * 1.0,
            segments=12, axis="Y",
        )
        for j in range(3):
            y = -length * 0.35 + j * (length * 0.35)
            L.add_cylinder(
                steel, centre=(px, y, pz), radius=0.24 + i * 0.04, height=0.12,
                segments=12, axis="Y",
            )

    L.bevel(steel, width=0.012)

    L.finish_object(
        "tank",
        [L.Part(body, L.MAT_RUST), L.Part(steel, L.MAT_STEEL)],
        shade_smooth_angle=math.radians(40),
    )
    L.add_collider("tank", (0.0, 0.0, 4.0), (8.0, 12.0, 8.0))
    L.export_glb(L.output_path("tank.glb"))
    _ = rng


# --------------------------------------------------------------------- deck


def build_deck(seed: int = 22) -> None:
    """
    One 4 m section of catwalk / gantry decking, 8 m wide.

    Tiled along z by the engine to cover the 40 m gantry and the 68 m catwalk.
    A section rather than a single long mesh so the two runs share one asset,
    and so a partially-occluded run still culls per section.
    """
    L.reset_scene()

    width = 8.0
    span = 4.0
    thickness = 0.4

    grating = L.new_bmesh()
    steel = L.new_bmesh()

    # Walking surface. Modelled as a thin slab; the holes are in the texture,
    # which is far cheaper than real perforated geometry and reads identically
    # from above at standing height.
    L.add_box(grating, centre=(0.0, 0.0, thickness - 0.03), size=(width - 0.1, span, 0.06))

    # Longitudinal stringers and cross beams carry the deck.
    for sx in (-1, 1):
        L.add_box(steel, centre=(sx * (width / 2 - 0.12), 0.0, thickness / 2), size=(0.16, span, thickness))
    L.add_box(steel, centre=(0.0, 0.0, thickness / 2), size=(0.14, span, thickness * 0.9))
    for sy in (-1, 1):
        L.add_box(steel, centre=(0.0, sy * (span / 2 - 0.08), thickness / 2), size=(width - 0.2, 0.14, thickness * 0.8))

    # Handrails: top rail, mid rail, toe board, stanchions. Handrails are the
    # single strongest cue that a surface is walkable.
    for sx in (-1, 1):
        x = sx * (width / 2 - 0.08)
        L.add_box(steel, centre=(x, 0.0, thickness + 0.07), size=(0.04, span, 0.14))  # toe board
        for i in range(3):
            y = -span / 2 + (i + 0.5) * (span / 3)
            L.add_cylinder(steel, centre=(x, y, thickness + 0.55), radius=0.032, height=1.1, segments=6)
        for z in (thickness + 0.52, thickness + 1.05):
            L.add_cylinder(steel, centre=(x, 0.0, z), radius=0.032, height=span, segments=6, axis="Y")

    L.bevel(steel, width=0.008)

    L.finish_object("deck", [L.Part(grating, L.MAT_GRATING), L.Part(steel, L.MAT_STEEL)])
    L.add_collider("deck", (0.0, 0.0, thickness / 2), (width, span, thickness))
    L.export_glb(L.output_path("deck.glb"))
    _ = seed


# ---------------------------------------------------------------- pipe rack


def build_pipe_rack(seed: int = 23) -> None:
    """One 5 m section of the west-lane pipe rack: 4 m wide, 4 m tall."""
    L.reset_scene()
    rng = L.rng(seed)

    width = 4.0
    span = 5.0
    height = 4.0

    steel = L.new_bmesh()
    pipes = L.new_bmesh()

    # Portal frame: two columns and a cap beam at each end of the section.
    for sy in (-1, 1):
        y = sy * (span / 2 - 0.15)
        for sx in (-1, 1):
            L.add_box(steel, centre=(sx * (width / 2 - 0.2), y, height / 2), size=(0.28, 0.28, height))
        L.add_box(steel, centre=(0.0, y, height - 0.15), size=(width - 0.1, 0.24, 0.3))
        L.add_box(steel, centre=(0.0, y, height * 0.55), size=(width - 0.5, 0.18, 0.22))
        # Knee braces.
        for sx in (-1, 1):
            L.add_box(
                steel,
                centre=(sx * (width / 2 - 0.62), y, height - 0.62),
                size=(0.9, 0.16, 0.16),
                rotation_z=0.0,
            )

    # The pipes themselves, at two levels and varied diameters.
    levels = ((height - 0.42, 0.30), (height - 0.42, 0.18), (height * 0.55 - 0.2, 0.24))
    offsets = (-1.2, -0.45, 0.35, 1.15)
    for i, x in enumerate(offsets):
        z, r = levels[i % len(levels)]
        radius = r * (0.85 + rng.random() * 0.3)
        L.add_cylinder(pipes, centre=(x, 0.0, z + radius), radius=radius, height=span, segments=20, axis="Y")
        # No flanges. Two attempts at collar rings both rendered as spheres:
        # smooth-by-angle averages normals across the short ring and its parent
        # pipe, turning a 16%-proud collar into a ball. The pipes are held by
        # visible clamps at the frames instead, which is both cheaper and a
        # clearer read of how the run is supported.
        for sy in (-1, 1):
            L.add_box(
                steel,
                centre=(x, sy * (span / 2 - 0.15), z + radius),
                size=(radius * 2.3, 0.1, radius * 0.5),
            )

    L.bevel(steel, width=0.01)

    L.finish_object(
        "pipe_rack",
        [L.Part(steel, L.MAT_STEEL), L.Part(pipes, L.MAT_RUST)],
        shade_smooth_angle=math.radians(40),
    )
    L.add_collider("pipe_rack", (0.0, 0.0, height / 2), (width, span, height))
    L.export_glb(L.output_path("pipe_rack.glb"))


# --------------------------------------------------------------------- wall


def build_wall(seed: int = 24) -> None:
    """
    One 6 m panel of the 12 m perimeter wall.

    Precast concrete panels with pilasters and a capping beam. Deliberately
    plain: the perimeter is a boundary, and detail here would pull the eye away
    from the lanes where the game is actually played.
    """
    L.reset_scene()
    rng = L.rng(seed)

    thickness = 2.0
    height = 12.0
    span = 6.0

    concrete = L.new_bmesh()
    steel = L.new_bmesh()

    L.add_box(concrete, centre=(0.0, 0.0, height / 2), size=(thickness * 0.62, span, height))

    # Pilasters at the panel joints give the run a rhythm at yard distance.
    for sy in (-1, 1):
        L.add_box(concrete, centre=(0.0, sy * span / 2, height / 2), size=(thickness, 0.5, height))

    # Capping beam and a recessed band, so the wall is not a featureless slab.
    L.add_box(concrete, centre=(0.0, 0.0, height - 0.3), size=(thickness * 0.8, span, 0.6))
    L.add_box(concrete, centre=(0.0, 0.0, height * 0.62), size=(thickness * 0.5, span, 0.35))
    L.add_box(concrete, centre=(0.0, 0.0, 0.35), size=(thickness * 0.78, span, 0.7))

    # Razor-wire brackets along the top: a strong silhouette read against the
    # false-dawn sky, which is where the perimeter is most often seen.
    for i in range(3):
        y = -span / 2 + (i + 0.5) * (span / 3)
        L.add_cylinder(steel, centre=(0.0, y, height + 0.42), radius=0.035, height=0.85, segments=6)
        L.add_cylinder(
            steel, centre=(0.28, y, height + 0.72), radius=0.03, height=0.5, segments=6, axis="X"
        )
    for z in (height + 0.55, height + 0.8):
        L.add_cylinder(steel, centre=(0.16, 0.0, z), radius=0.02, height=span, segments=5, axis="Y")

    L.bevel(steel, width=0.008)
    L.finish_object("wall", [L.Part(concrete, L.MAT_CONCRETE), L.Part(steel, L.MAT_STEEL)])
    L.add_collider("wall", (0.0, 0.0, height / 2), (thickness, span, height))
    L.export_glb(L.output_path("wall.glb"))
    _ = rng


# ---------------------------------------------------------------- hardpoint


def build_hardpoint(seed: int = 25) -> None:
    """The central objective block: 12 x 2.6 x 8, a low concrete plinth."""
    L.reset_scene()

    width, height, depth = 12.0, 2.6, 8.0
    concrete = L.new_bmesh()
    steel = L.new_bmesh()

    L.add_box(concrete, centre=(0.0, 0.0, height / 2), size=(width, depth, height))
    # Chamfered top edge and a kerb, so it reads as cast concrete.
    L.add_box(concrete, centre=(0.0, 0.0, height - 0.08), size=(width - 0.5, depth - 0.5, 0.3))
    L.add_box(concrete, centre=(0.0, 0.0, 0.2), size=(width + 0.3, depth + 0.3, 0.4))

    # Bollards around the edge and a handrail on one side: cover cues that tell
    # a player where they can and cannot be shot from.
    for i in range(5):
        x = -width / 2 + (i + 0.5) * (width / 5)
        L.add_cylinder(steel, centre=(x, depth / 2 - 0.4, height + 0.45), radius=0.09, height=0.9, segments=8)
    L.add_cylinder(
        steel, centre=(0.0, depth / 2 - 0.4, height + 0.86), radius=0.05, height=width * 0.8,
        segments=8, axis="X",
    )

    L.bevel(steel, width=0.01)
    L.finish_object("hardpoint", [L.Part(concrete, L.MAT_CONCRETE), L.Part(steel, L.MAT_STEEL)])
    L.add_collider("hardpoint", (0.0, 0.0, height / 2), (width, depth, height))
    L.export_glb(L.output_path("hardpoint.glb"))
    _ = seed


# -------------------------------------------------------------------- stair


def build_stair(seed: int = 26) -> None:
    """One 2 x 1.5 x 4 ramp step, matching the stepped access boxes."""
    L.reset_scene()

    width, rise, run = 2.0, 1.5, 4.0
    steel = L.new_bmesh()
    grating = L.new_bmesh()

    # Treads climbing the box, rather than a solid wedge: the collision is a
    # box, but a visible stair is what tells a player the route is climbable.
    steps = 5
    for i in range(steps):
        z = (i + 1) * (rise / steps)
        y = -run / 2 + (i + 0.5) * (run / steps)
        L.add_box(grating, centre=(0.0, y, z - 0.03), size=(width - 0.12, run / steps, 0.06))
        L.add_box(steel, centre=(0.0, y - run / steps / 2, z - rise / steps / 2), size=(width - 0.2, 0.05, rise / steps))

    # Stringers and a handrail.
    for sx in (-1, 1):
        x = sx * (width / 2 - 0.06)
        L.add_box(steel, centre=(x, 0.0, rise / 2), size=(0.1, run, rise * 0.9))
        for i in range(3):
            y = -run / 2 + (i + 0.5) * (run / 3)
            z = rise * ((i + 0.5) / 3)
            L.add_cylinder(steel, centre=(x, y, z + 0.55), radius=0.03, height=1.1, segments=6)

    L.bevel(steel, width=0.008)
    L.finish_object("stair", [L.Part(grating, L.MAT_GRATING), L.Part(steel, L.MAT_STEEL)])
    L.add_collider("stair", (0.0, 0.0, rise / 2), (width, run, rise))
    L.export_glb(L.output_path("stair.glb"))
    _ = seed


# ---------------------------------------------------------------- lamp mast


def build_lamp_mast(seed: int = 27) -> None:
    """
    A 9 m sodium lamp mast.

    Eleven of these line the lanes and they are the yard's practical lights, so
    the head has to read as a fitting rather than a glowing cube. The emissive
    lens is a separate material the engine drives with its glow layer.
    """
    L.reset_scene()

    steel = L.new_bmesh()
    lens = L.new_bmesh()

    height = 9.0

    # Tapered mast: a base section and a narrower upper section.
    L.add_cylinder(steel, centre=(0.0, 0.0, 0.12), radius=0.34, height=0.24, segments=12)
    L.add_cylinder(steel, centre=(0.0, 0.0, height * 0.28), radius=0.16, height=height * 0.56, segments=12)
    L.add_cylinder(steel, centre=(0.0, 0.0, height * 0.76), radius=0.12, height=height * 0.42, segments=12)

    # Base flange bolts.
    for i in range(6):
        a = i * math.tau / 6
        L.add_cylinder(
            steel, centre=(math.cos(a) * 0.26, math.sin(a) * 0.26, 0.27), radius=0.028,
            height=0.08, segments=6,
        )

    # Bracket arm reaching out, then the lamp head hanging off it.
    L.add_cylinder(steel, centre=(0.45, 0.0, height - 0.1), radius=0.07, height=0.9, segments=8, axis="X")
    L.add_box(steel, centre=(0.86, 0.0, height - 0.26), size=(0.5, 0.34, 0.16))
    # Housing: a shallow shade over the lens, which is what makes the pool of
    # light below read as cast rather than ambient.
    L.add_box(steel, centre=(0.86, 0.0, height - 0.36), size=(0.62, 0.44, 0.1))
    L.add_box(lens, centre=(0.86, 0.0, height - 0.45), size=(0.5, 0.34, 0.08))

    L.bevel(steel, width=0.008)
    L.finish_object(
        "lamp_mast",
        [L.Part(steel, L.MAT_STEEL), L.Part(lens, L.MAT_GLASS_EMISSIVE)],
        shade_smooth_angle=math.radians(35),
    )
    L.add_collider("lamp_mast", (0.0, 0.0, height / 2), (0.4, 0.4, height))
    # Where the engine attaches the point light, so art and lighting cannot
    # drift apart.
    L.add_socket("LAMP", (0.86, 0.0, height - 0.5))
    L.export_glb(L.output_path("lamp_mast.glb"))
    _ = seed


BUILDERS = {
    "tank": build_tank,
    "deck": build_deck,
    "pipe_rack": build_pipe_rack,
    "wall": build_wall,
    "hardpoint": build_hardpoint,
    "stair": build_stair,
    "lamp_mast": build_lamp_mast,
}


def main() -> None:
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    for name, fn in BUILDERS.items():
        if only and name not in only:
            continue
        fn()


main()
