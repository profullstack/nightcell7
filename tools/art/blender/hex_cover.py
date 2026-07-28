"""
Modular hex-armour cover for ARDAVAN YARD.

The two 4 x 3 x 12 m cross-links in the collision map need a four-metre
module which can tile three times along their length.  A concrete blast core
keeps the silhouette honest while replaceable hexagonal steel plates, exposed
fasteners and a structural frame give the prop a near-future tactical identity.

Nothing is sampled or downloaded.  The committed script is the asset's
provenance and rebuilds the same GLB deterministically.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _lib as L  # noqa: E402

WIDTH = 4.0
LENGTH = 4.0
HEIGHT = 3.0


def add_face_panels(
    armour,
    signal,
    fasteners,
    *,
    side: int,
    axis: str,
) -> None:
    """Tile a face with interlocking hex plates and visible centre bolts."""
    rows = (
        (0.62, (-1.15, 0.0, 1.15)),
        (1.50, (-0.58, 0.58)),
        (2.38, (-1.15, 0.0, 1.15)),
    )

    for row, (height, offsets) in enumerate(rows):
        for column, offset in enumerate(offsets):
            is_signal = row == 1 and column == 0
            target = signal if is_signal else armour

            if axis == "Y":
                centre = (offset, side * 1.955, height)
                bolt_centre = (offset, side * 2.035, height)
            else:
                centre = (side * 1.955, offset, height)
                bolt_centre = (side * 2.035, offset, height)

            L.add_cylinder(
                target,
                centre=centre,
                radius=0.55,
                height=0.13,
                segments=6,
                axis=axis,
            )
            L.add_cylinder(
                fasteners,
                centre=bolt_centre,
                radius=0.065,
                height=0.04,
                segments=8,
                axis=axis,
            )


def build() -> None:
    L.reset_scene()

    core = L.new_bmesh()
    armour = L.new_bmesh()
    signal = L.new_bmesh()
    frame = L.new_bmesh()

    # The collision-sized core is recessed just enough for the armour and frame
    # to sit inside the authoritative 4 x 4 x 3 metre volume.
    L.add_box(core, centre=(0.0, 0.0, HEIGHT / 2), size=(3.76, 3.76, 2.72))

    # Every face is readable from either lane.  Hex plates are real geometry,
    # not a baked texture, so their silhouette and raking highlights survive
    # at gameplay distance.
    for side in (-1, 1):
        add_face_panels(armour, signal, frame, side=side, axis="Y")
        add_face_panels(armour, signal, frame, side=side, axis="X")

    # Structural cage: base/top rails and protected corner posts.  Small bevels
    # create the edge highlights which distinguish a production prop from a
    # greybox without spending triangles on the concrete core.
    for z in (0.13, HEIGHT - 0.13):
        for y in (-1.87, 1.87):
            L.add_box(frame, centre=(0.0, y, z), size=(3.84, 0.18, 0.20))
        for x in (-1.87, 1.87):
            L.add_box(frame, centre=(x, 0.0, z), size=(0.18, 3.84, 0.20))

    for x in (-1.87, 1.87):
        for y in (-1.87, 1.87):
            L.add_box(frame, centre=(x, y, HEIGHT / 2), size=(0.20, 0.20, 2.82))
            L.add_box(frame, centre=(x, y, 0.06), size=(0.46, 0.46, 0.12))

    # Lifting eyes make the module credibly deployable rather than a decorative
    # cube.  They are low-poly hexagonal bosses sized for a crane shackle.
    for x in (-1.35, 1.35):
        for y in (-1.35, 1.35):
            L.add_cylinder(
                frame,
                centre=(x, y, HEIGHT - 0.01),
                radius=0.12,
                height=0.12,
                segments=8,
            )

    L.bevel(frame, width=0.012)

    L.finish_object(
        "hex_cover",
        [
            L.Part(core, L.MAT_CONCRETE),
            L.Part(armour, L.MAT_STEEL),
            L.Part(signal, L.MAT_PAINT_RED),
            L.Part(frame, L.MAT_RUST),
        ],
    )
    L.add_collider("hex_cover", (0.0, 0.0, HEIGHT / 2), (WIDTH, LENGTH, HEIGHT))
    L.export_glb(L.output_path("hex_cover.glb"))


build()
