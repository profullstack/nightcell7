"""
Player character.

This asset exists because remote players are currently *invisible*: the client
interpolates their positions (`RemotePlayerInterpolator`) and
`NetClient.remotePosition()` returns them, but nothing in the game ever calls
it or creates a mesh. A six-a-side match therefore renders an empty yard.

Design constraints, in priority order:

  1. **Readable silhouette.** A competitive shooter lives or dies on whether you
     can identify a player shape in a fraction of a second against cluttered
     industrial geometry. Chunky pauldrons, a helmet with a distinct brow, and a
     backpack give a recognisable outline from any angle.
  2. **Team legibility without pay-to-win.** Team identity is carried by
     material (`paint_red` / `paint_cyan`), not by geometry, so the two sides
     are exactly the same size and present exactly the same hitbox. PRD §
     "Multiplayer Alpha is free and cannot be pay-to-win" — a smaller-silhouette
     skin would be precisely that.
  3. **Matches the capsule the server simulates.** 1.8 m standing, roughly
     0.6 m across the shoulders, centred on the origin in plan so the mesh sits
     on the simulated position without an offset fudge.

Unrigged and unanimated on purpose: V1 has no animation system, and a static
mesh that reads correctly beats a rigged one that cannot be driven. It is built
in a neutral standing pose so a skeleton can be added later without redoing the
silhouette.
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _lib as L  # noqa: E402

HEIGHT = 1.8


def build(seed: int = 31) -> None:
    L.reset_scene()

    armour = L.new_bmesh()  # team-coloured plate
    gear = L.new_bmesh()  # webbing, boots, weapon — always dark

    # ---- legs ------------------------------------------------------------
    for sx in (-1, 1):
        x = sx * 0.115
        # Thigh and shin, slightly tapered by stacking two boxes.
        L.add_box(gear, centre=(x, 0.0, 0.24), size=(0.17, 0.20, 0.48))
        L.add_box(gear, centre=(x, 0.005, 0.66), size=(0.19, 0.23, 0.40))
        # Boot: wider than the shin, which anchors the figure to the ground.
        L.add_box(gear, centre=(x, -0.03, 0.05), size=(0.20, 0.30, 0.10))
        # Knee pad, in team colour so the legs are not a dark mass.
        L.add_box(armour, centre=(x, -0.10, 0.47), size=(0.16, 0.06, 0.14))

    # ---- torso -----------------------------------------------------------
    # Built as a stack rather than one box so the chest tapers into the
    # shoulders. Heights are chosen to leave NO vertical gap anywhere up the
    # figure: the first version ended the torso at 1.32 and started the neck at
    # 1.41, which rendered as a head floating above the body.
    L.add_box(gear, centre=(0.0, 0.0, 0.90), size=(0.33, 0.22, 0.22))  # waist / belt
    L.add_box(armour, centre=(0.0, 0.0, 1.10), size=(0.40, 0.25, 0.24))  # lower chest
    L.add_box(armour, centre=(0.0, 0.0, 1.29), size=(0.44, 0.27, 0.20))  # upper chest, widest
    L.add_box(armour, centre=(0.0, -0.15, 1.16), size=(0.34, 0.06, 0.34))  # plate carrier front
    # Collar bridging chest to neck, so the head sits ON the body.
    L.add_box(gear, centre=(0.0, 0.0, 1.41), size=(0.26, 0.20, 0.08))

    # Magazine pouches across the front — small shapes that catch the light.
    for i in range(3):
        L.add_box(gear, centre=(-0.11 + i * 0.11, -0.19, 1.02), size=(0.09, 0.06, 0.14))

    # Backpack: pushes the silhouette asymmetric front-to-back, which is what
    # makes facing direction readable at distance.
    L.add_box(gear, centre=(0.0, 0.185, 1.18), size=(0.30, 0.15, 0.38))
    L.add_cylinder(gear, centre=(0.0, 0.26, 1.33), radius=0.05, height=0.28, segments=8, axis="X")

    # ---- shoulders and arms ---------------------------------------------
    for sx in (-1, 1):
        # Pauldron — the strongest silhouette element on the upper body. Sits
        # just outboard of the chest and overlaps it, so there is no seam.
        L.add_box(armour, centre=(sx * 0.245, 0.0, 1.31), size=(0.15, 0.26, 0.19))
        # Upper arm hangs from under the pauldron.
        L.add_box(gear, centre=(sx * 0.255, -0.005, 1.13), size=(0.125, 0.16, 0.24))
        # Elbow, then a forearm angled in and forward as if holding a weapon.
        L.add_box(gear, centre=(sx * 0.245, -0.03, 1.00), size=(0.115, 0.14, 0.10))
        L.add_box(gear, centre=(sx * 0.205, -0.16, 0.97), size=(0.105, 0.26, 0.105))
        # Glove.
        L.add_box(gear, centre=(sx * 0.185, -0.29, 0.96), size=(0.095, 0.10, 0.095))

    # ---- head ------------------------------------------------------------
    L.add_box(gear, centre=(0.0, 0.0, 1.485), size=(0.125, 0.13, 0.09))  # neck
    L.add_box(armour, centre=(0.0, 0.0, 1.60), size=(0.215, 0.245, 0.185))  # helmet shell
    L.add_box(armour, centre=(0.0, 0.0, 1.695), size=(0.185, 0.215, 0.045))  # crown
    L.add_box(armour, centre=(0.0, -0.135, 1.585), size=(0.195, 0.05, 0.085))  # brow / visor lip
    L.add_box(gear, centre=(0.0, -0.115, 1.535), size=(0.165, 0.05, 0.07))  # face shadow
    # Comms boom, a small asymmetric tell for facing.
    L.add_cylinder(gear, centre=(0.07, -0.115, 1.515), radius=0.012, height=0.12, segments=5, axis="Y")

    L.bevel(armour, width=0.008)
    L.bevel(gear, width=0.006)

    L.finish_object(
        "character",
        [L.Part(armour, L.MAT_PAINT_RED), L.Part(gear, L.MAT_RUBBER)],
    )

    # Collision proxy matching the simulated capsule.
    L.add_collider("character", (0.0, 0.0, HEIGHT / 2), (0.6, 0.4, HEIGHT))
    # Where a weapon world-model attaches, and where tracers should originate
    # for other players' shots.
    L.add_socket("WEAPON", (0.22, -0.30, 0.98), rotation=(0.0, 0.0, 0.0))
    L.add_socket("HEAD", (0.0, 0.0, 1.62))

    L.export_glb(L.output_path("character.glb"))
    _ = seed, math


build()
