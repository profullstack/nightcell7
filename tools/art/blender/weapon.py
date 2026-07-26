"""
Carbine — the V1 primary weapon.

In a first-person game the weapon is the single most-viewed object: it occupies
the lower third of the screen every frame of every match. The game currently
renders nothing in the player's hands at all, which is a large part of why the
build reads as unfinished.

Two uses, one mesh:

  * **Viewmodel** — held in front of the camera. This is why the detail budget
    is spent on the parts that face the player: the receiver's right side, the
    magazine, the optic and the charging handle.
  * **World model** — attached to `SOCKET_WEAPON` on the character. At that
    distance only the silhouette survives, and the same mesh serves.

`SOCKET_MUZZLE` is mandatory for every weapon (CLAUDE.md). The engine spawns
muzzle flash and tracer origins there. Note that it is a *presentation* anchor
only: the authoritative shot origin is derived from the server's player
position, never from this transform, so a tampered client cannot shoot from
somewhere else.

Oriented with the barrel down -Y (Blender forward) and the sight line along Z
so the engine can parent it to the camera without a correction rotation.
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _lib as L  # noqa: E402

# Overall length, breech to muzzle. A real short-barrelled carbine is ~0.75 m;
# matching that keeps the viewmodel from feeling like a toy.
LENGTH = 0.74


def build(seed: int = 41) -> None:
    L.reset_scene()

    body = L.new_bmesh()  # receiver, furniture — dark polymer
    metal = L.new_bmesh()  # barrel, bolt, hardware

    # ---- receiver --------------------------------------------------------
    L.add_box(body, centre=(0.0, 0.0, 0.0), size=(0.055, 0.30, 0.085))
    # Upper rail: a flat top with a repeating rail profile reads instantly as
    # a modern carbine even in silhouette.
    L.add_box(metal, centre=(0.0, -0.02, 0.055), size=(0.042, 0.30, 0.022))
    for i in range(9):
        L.add_box(
            metal,
            centre=(0.0, -0.15 + i * 0.033, 0.070),
            size=(0.046, 0.016, 0.012),
        )

    # Ejection port and forward assist on the right side.
    L.add_box(metal, centre=(0.031, -0.03, 0.012), size=(0.008, 0.085, 0.045))
    L.add_cylinder(metal, centre=(0.032, 0.04, 0.02), radius=0.012, height=0.02, segments=8, axis="X")
    # Charging handle at the rear.
    L.add_box(metal, centre=(0.0, 0.145, 0.048), size=(0.07, 0.045, 0.016))

    # ---- barrel and handguard -------------------------------------------
    L.add_cylinder(metal, centre=(0.0, -0.30, 0.008), radius=0.0105, height=0.30, segments=12, axis="Y")
    # Handguard with vent slots.
    L.add_box(body, centre=(0.0, -0.27, 0.005), size=(0.048, 0.24, 0.052))
    for i in range(5):
        for sx in (-1, 1):
            L.add_box(
                body,
                centre=(sx * 0.025, -0.35 + i * 0.036, 0.005),
                size=(0.006, 0.020, 0.030),
            )
    # Gas block and front sight base.
    L.add_box(metal, centre=(0.0, -0.40, 0.020), size=(0.030, 0.038, 0.042))
    # Muzzle device: a slotted brake, the last thing on the barrel.
    L.add_cylinder(metal, centre=(0.0, -0.455, 0.008), radius=0.017, height=0.055, segments=12, axis="Y")
    for i in range(3):
        L.add_box(metal, centre=(0.0, -0.45 + i * 0.016, 0.026), size=(0.030, 0.006, 0.018))

    # ---- magazine --------------------------------------------------------
    # Curved by stacking three slightly rotated segments — a straight box reads
    # as a placeholder, and the curve is visible in the viewmodel.
    for i, (dy, dz, rot) in enumerate(
        ((0.0, -0.085, 0.0), (0.012, -0.155, 0.06), (0.030, -0.220, 0.13))
    ):
        L.add_box(body, centre=(0.0, dy, dz), size=(0.032, 0.075 - i * 0.004, 0.075))
    L.add_box(body, centre=(0.030, -0.255, 0.0), size=(0.036, 0.080, 0.016))

    # ---- grip and stock --------------------------------------------------
    L.add_box(body, centre=(0.0, 0.075, -0.105), size=(0.038, 0.062, 0.14))
    L.add_box(metal, centre=(0.0, 0.045, -0.032), size=(0.022, 0.055, 0.020))  # trigger guard
    L.add_box(metal, centre=(0.0, 0.035, -0.045), size=(0.010, 0.024, 0.028))  # trigger

    # Collapsible stock: buffer tube plus a cheek piece and butt plate.
    L.add_cylinder(metal, centre=(0.0, 0.235, 0.012), radius=0.019, height=0.16, segments=10, axis="Y")
    L.add_box(body, centre=(0.0, 0.255, 0.0), size=(0.046, 0.11, 0.070))
    L.add_box(body, centre=(0.0, 0.315, -0.010), size=(0.050, 0.028, 0.105))  # butt plate

    # ---- optic -----------------------------------------------------------
    L.add_box(metal, centre=(0.0, -0.05, 0.088), size=(0.034, 0.010, 0.030))  # mount
    L.add_box(metal, centre=(0.0, 0.02, 0.088), size=(0.034, 0.010, 0.030))
    L.add_cylinder(metal, centre=(0.0, -0.015, 0.108), radius=0.021, height=0.085, segments=12, axis="Y")
    L.add_cylinder(metal, centre=(0.0, -0.060, 0.108), radius=0.024, height=0.012, segments=12, axis="Y")

    L.bevel(body, width=0.0025)
    L.bevel(metal, width=0.002)

    L.finish_object(
        "carbine",
        [L.Part(body, L.MAT_RUBBER), L.Part(metal, L.MAT_STEEL)],
        shade_smooth_angle=math.radians(35),
    )

    # Mandatory for every weapon (CLAUDE.md). Sits just ahead of the muzzle
    # device, pointing down -Y with the barrel.
    L.add_socket("MUZZLE", (0.0, -0.492, 0.008))
    # Where a spent case leaves the ejection port.
    L.add_socket("EJECT", (0.036, -0.03, 0.012))
    # Aim-down-sights anchor: the centre of the optic's rear lens.
    L.add_socket("SIGHT", (0.0, -0.060, 0.108))

    L.export_glb(L.output_path("carbine.glb"))
    _ = seed


build()
