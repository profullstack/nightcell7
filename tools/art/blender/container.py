"""
Shipping container.

The centre lane of Ardavan Yard is a container yard, so this is the most-seen
prop in the game and the one worth spending triangles on. Three details do
almost all the work of making it read as a real container rather than a
coloured box:

  1. **Corrugation.** The trapezoidal rib profile down the long walls. It is
     the single most recognisable thing about a container and it gives the
     sodium lamps something to rake across.
  2. **Corner castings.** The cast steel blocks at all eight corners. Real
     containers are lifted by them, and their absence is what makes a box look
     like a box.
  3. **A door end.** Two doors, four locking rods, hinges and handles. It gives
     the prop a front, which means placements can be varied meaningfully.

Dimensions are driven by the collision volume, not by the ISO standard: the
yard's container volumes are 6 x 3 x 6 m and the engine places two of these
side by side to fill one. `world.ts` and this file must agree, because the
project rule is that what you see is what you collide with.
"""

from __future__ import annotations

import os
import sys

# Blender does not put the running script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _lib as L  # noqa: E402

# One container. Two of these fill a 6 x 3 x 6 collision volume.
LENGTH = 6.0
WIDTH = 2.9
HEIGHT = 3.0

CORNER = 0.16  # corner casting cube size
WALL = 0.05  # panel thickness
RIB_DEPTH = 0.045  # how far corrugation stands proud
RIB_PITCH = 0.30  # rib repeat along the length


def build(seed: int = 7) -> None:
    L.reset_scene()
    rng = L.rng(seed)

    body = L.new_bmesh()
    steel = L.new_bmesh()

    half_l = LENGTH / 2
    half_w = WIDTH / 2

    # ---- corrugated long walls (run along Z, normal along X) --------------
    inner_h = HEIGHT - 2 * CORNER
    count = int(LENGTH / RIB_PITCH)
    start = -(count * RIB_PITCH) / 2

    for side in (-1, 1):
        x = side * half_w
        for i in range(count):
            z = start + (i + 0.5) * RIB_PITCH
            proud = RIB_DEPTH if i % 2 == 0 else 0.0
            jitter = rng.uniform(-0.003, 0.003)
            L.add_box(
                body,
                centre=(x + side * (proud / 2 + jitter), z, HEIGHT / 2),
                size=(WALL + proud, RIB_PITCH * 0.94, inner_h),
            )
        # Top and bottom rails.
        for zc in (CORNER / 2, HEIGHT - CORNER / 2):
            L.add_box(steel, centre=(x, 0.0, zc), size=(WALL + RIB_DEPTH * 1.2, LENGTH, CORNER))

    # ---- roof: shallow ribs running across the width ----------------------
    roof_ribs = int(LENGTH / 0.5)
    roof_start = -(roof_ribs * 0.5) / 2
    for i in range(roof_ribs):
        z = roof_start + (i + 0.5) * 0.5
        proud = 0.03 if i % 2 == 0 else 0.0
        L.add_box(
            body,
            centre=(0.0, z, HEIGHT - CORNER / 2 + proud / 2),
            size=(WIDTH - 2 * CORNER, 0.47, WALL + proud),
        )

    # ---- floor slab -------------------------------------------------------
    L.add_box(steel, centre=(0.0, 0.0, CORNER / 2), size=(WIDTH - 0.02, LENGTH, CORNER))

    # ---- blank end (front) ------------------------------------------------
    for i in range(int(WIDTH / 0.28)):
        offset = -WIDTH / 2 + (i + 0.5) * 0.28
        proud = 0.035 if i % 2 == 0 else 0.0
        L.add_box(
            body,
            centre=(offset, -half_l + WALL / 2 - proud / 2, HEIGHT / 2),
            size=(0.26, WALL + proud, inner_h),
        )

    # ---- door end (back): two doors, hinges, locking rods -----------------
    door_w = (WIDTH - 2 * CORNER) / 2
    for side in (-1, 1):
        cx = side * door_w / 2
        # Door leaf, slightly recessed so it reads as a separate panel.
        L.add_box(
            steel,
            centre=(cx, half_l - WALL / 2, HEIGHT / 2),
            size=(door_w - 0.02, WALL, inner_h),
        )
        # Two locking rods per leaf, full height.
        for rod in (-1, 1):
            L.add_cylinder(
                steel,
                centre=(cx + rod * door_w * 0.28, half_l + 0.03, HEIGHT / 2),
                radius=0.022,
                height=inner_h - 0.1,
                segments=6,
            )
            # Handle at chest height.
            L.add_box(
                steel,
                centre=(cx + rod * door_w * 0.28, half_l + 0.06, HEIGHT * 0.45),
                size=(0.05, 0.11, 0.22),
            )
        # Hinges on the outboard edge.
        for hz in (HEIGHT * 0.18, HEIGHT * 0.5, HEIGHT * 0.82):
            L.add_box(
                steel,
                centre=(side * (WIDTH / 2 - CORNER * 0.7), half_l + 0.02, hz),
                size=(0.1, 0.09, 0.16),
            )

    # ---- corner castings --------------------------------------------------
    for sx in (-1, 1):
        for sz in (-1, 1):
            for sy in (0, 1):
                L.add_box(
                    steel,
                    centre=(
                        sx * (half_w - CORNER / 2 + 0.01),
                        sz * (half_l - CORNER / 2),
                        CORNER / 2 + sy * (HEIGHT - CORNER),
                    ),
                    size=(CORNER, CORNER, CORNER),
                )

    # Bevel only the hardware, not the corrugation. Bevelling ~40 rib boxes
    # quadrupled the triangle count for highlights that the normal map already
    # provides; the castings and door furniture are what the eye actually
    # tracks, so they keep their edge highlights.
    L.bevel(steel, width=0.01)

    L.finish_object(
        "container",
        [L.Part(body, L.MAT_PAINT_RED), L.Part(steel, L.MAT_STEEL)],
    )

    # Collision proxy: the whole box. The engine uses the server collision map,
    # but a correct COL_ hull keeps the GLB self-describing (CLAUDE.md).
    L.add_collider("container", (0.0, 0.0, HEIGHT / 2), (WIDTH, LENGTH, HEIGHT))

    L.export_glb(L.output_path("container.glb"))


build()
