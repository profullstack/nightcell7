"""
Animation cycles for the player character.

The character stood frozen because there was no animation system at all — not
a missing clip, an entirely missing capability. A figure that slides across the
yard in a standing pose reads as a bug, which is why the training targets
shipped static rather than moving.

Cycles are authored as keyframed bone rotations rather than captured: there is
no motion-capture source and no animator, and a script is reproducible the same
way the meshes are. They are deliberately simple and readable — a clear
contact-pass/passing-pass walk beats an elaborate one that reads as mush at
gameplay distance.

Angles are degrees, X is the primary swing axis for limbs (the bones run down
the body, so a rotation about X swings them forward and back).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _lib as L  # noqa: E402

# 24 fps authoring; glTF stores seconds, so the rate only sets keyframe spacing.
FPS = 24


def _zero_pose() -> dict:
    """Every animated bone at rest. Keyed on every frame — see `key_pose`."""
    return {
        "hips": (0, 0, 0), "spine": (0, 0, 0), "chest": (0, 0, 0),
        "neck": (0, 0, 0), "head": (0, 0, 0),
        "shoulder.L": (0, 0, 0), "upperarm.L": (0, 0, 0),
        "forearm.L": (0, 0, 0), "hand.L": (0, 0, 0),
        "shoulder.R": (0, 0, 0), "upperarm.R": (0, 0, 0),
        "forearm.R": (0, 0, 0), "hand.R": (0, 0, 0),
        "thigh.L": (0, 0, 0), "shin.L": (0, 0, 0), "foot.L": (0, 0, 0),
        "thigh.R": (0, 0, 0), "shin.R": (0, 0, 0), "foot.R": (0, 0, 0),
    }


def _merge(*poses: dict) -> dict:
    out = _zero_pose()
    for pose in poses:
        out.update(pose)
    return out


def idle(rig) -> None:
    """
    Breathing idle, 3 s loop.

    Almost nothing happens on purpose. A standing soldier is still; the point
    is only that the figure is not *perfectly* still, which is what makes a
    model look switched off.
    """
    action = L.new_action(rig, "idle")
    frames = 72

    for frame, lean in ((1, 0.0), (24, 1.4), (48, -0.6), (frames, 0.0)):
        L.key_pose(rig, frame, _merge({
            "chest": (-lean * 0.6, 0, 0),
            "spine": (lean * 0.3, 0, 0),
            "head": (lean * 0.4, lean * 0.8, 0),
            # Weapon stays shouldered: arms barely move.
            "upperarm.L": (-6 + lean, 0, -8),
            "forearm.L": (-38, 0, 0),
            "upperarm.R": (-8 + lean, 0, 8),
            "forearm.R": (-44, 0, 0),
        }))

    L.set_action_range(action, 1, frames)


def _walk_cycle(rig, name: str, *, swing: float, lift: float, lean: float, frames: int) -> None:
    """
    Shared walk/run construction.

    Four poses: contact, passing, opposite contact, opposite passing. That is
    the minimum that reads as walking rather than shuffling, and doubling it
    would not survive the distance these are seen at.
    """
    action = L.new_action(rig, name)
    half = frames // 2
    quarter = frames // 4

    def contact(front: str, back: str) -> dict:
        return {
            f"thigh.{front}": (-swing, 0, 0),
            f"shin.{front}": (swing * 0.25, 0, 0),
            f"foot.{front}": (swing * 0.35, 0, 0),
            f"thigh.{back}": (swing * 0.8, 0, 0),
            f"shin.{back}": (-swing * 0.5, 0, 0),
            f"foot.{back}": (-swing * 0.15, 0, 0),
            # Arms counter-swing; the weapon side swings less because it is
            # holding something.
            f"upperarm.{back}": (-swing * 0.45 - 6, 0, -8),
            f"upperarm.{front}": (swing * 0.30 - 8, 0, 8),
            "forearm.L": (-38, 0, 0),
            "forearm.R": (-44, 0, 0),
            "chest": (-lean, 0, swing * 0.10),
            "spine": (-lean * 0.5, 0, -swing * 0.06),
            "hips": (lean * 0.3, 0, 0),
        }

    def passing(up: str, down: str) -> dict:
        return {
            f"thigh.{up}": (-swing * 0.15, 0, 0),
            f"shin.{up}": (swing * 0.9, 0, 0),
            f"foot.{up}": (-swing * 0.30, 0, 0),
            f"thigh.{down}": (swing * 0.20, 0, 0),
            f"shin.{down}": (-swing * 0.10, 0, 0),
            f"foot.{down}": (0, 0, 0),
            f"upperarm.{up}": (-6, 0, -8),
            f"upperarm.{down}": (-8, 0, 8),
            "forearm.L": (-38, 0, 0),
            "forearm.R": (-44, 0, 0),
            "chest": (-lean, 0, 0),
            "spine": (-lean * 0.5, 0, 0),
            "hips": (lean * 0.3, 0, 0),
        }

    L.key_pose(rig, 1, _merge(contact("L", "R")))
    L.key_pose(rig, 1 + quarter, _merge(passing("R", "L")))
    L.key_pose(rig, 1 + half, _merge(contact("R", "L")))
    L.key_pose(rig, 1 + half + quarter, _merge(passing("L", "R")))
    L.key_pose(rig, 1 + frames, _merge(contact("L", "R")))

    # Vertical bob: the body rises over the passing pose and drops on contact.
    for frame, height in (
        (1, 0.0), (1 + quarter, lift), (1 + half, 0.0),
        (1 + half + quarter, lift), (1 + frames, 0.0),
    ):
        L.key_location(rig, "hips", frame, (0.0, 0.0, height))

    L.set_action_range(action, 1, 1 + frames)


def walk(rig) -> None:
    _walk_cycle(rig, "walk", swing=26.0, lift=0.035, lean=4.0, frames=28)


def run(rig) -> None:
    _walk_cycle(rig, "run", swing=42.0, lift=0.070, lean=11.0, frames=18)


def fire(rig) -> None:
    """Recoil kick, ~0.2 s. Played over the top of whatever else is running."""
    action = L.new_action(rig, "fire")
    base = {
        "upperarm.L": (-6, 0, -8), "forearm.L": (-38, 0, 0),
        "upperarm.R": (-8, 0, 8), "forearm.R": (-44, 0, 0),
    }
    L.key_pose(rig, 1, _merge(base))
    L.key_pose(rig, 2, _merge(base, {
        "chest": (4.5, 0, 0), "neck": (3.0, 0, 0),
        "upperarm.L": (-1, 0, -8), "upperarm.R": (-3, 0, 8),
    }))
    L.key_pose(rig, 6, _merge(base, {"chest": (1.5, 0, 0), "neck": (1.0, 0, 0)}))
    L.key_pose(rig, 12, _merge(base))
    L.set_action_range(action, 1, 12)


def death(rig) -> None:
    """
    Collapse, ~1 s, ending face down.

    Not a ragdoll: there is no physics on characters, and a keyed collapse that
    always looks the same is better than none. It ends in a settled pose so the
    body can simply stay there.
    """
    action = L.new_action(rig, "death")
    L.key_pose(rig, 1, _merge({
        "upperarm.L": (-6, 0, -8), "forearm.L": (-38, 0, 0),
        "upperarm.R": (-8, 0, 8), "forearm.R": (-44, 0, 0),
    }))
    # Stagger: knees buckle, torso folds.
    L.key_pose(rig, 8, _merge({
        "hips": (12, 0, 4), "spine": (14, 0, 0), "chest": (10, 0, -6),
        "head": (-14, 0, 0),
        "thigh.L": (-24, 0, 0), "shin.L": (38, 0, 0),
        "thigh.R": (-14, 0, 0), "shin.R": (26, 0, 0),
        "upperarm.L": (-40, 0, -22), "upperarm.R": (-34, 0, 20),
        "forearm.L": (-20, 0, 0), "forearm.R": (-24, 0, 0),
    }))
    # Down.
    L.key_pose(rig, 20, _merge({
        "hips": (68, 0, 6), "spine": (22, 0, 0), "chest": (16, 0, -8),
        "head": (-24, 0, 4),
        "thigh.L": (-52, 0, 6), "shin.L": (64, 0, 0),
        "thigh.R": (-40, 0, -4), "shin.R": (52, 0, 0),
        "upperarm.L": (-72, 0, -30), "upperarm.R": (-64, 0, 28),
        "forearm.L": (-12, 0, 0), "forearm.R": (-16, 0, 0),
    }))
    # Settle.
    L.key_pose(rig, 26, _merge({
        "hips": (72, 0, 6), "spine": (20, 0, 0), "chest": (14, 0, -8),
        "head": (-20, 0, 4),
        "thigh.L": (-56, 0, 6), "shin.L": (66, 0, 0),
        "thigh.R": (-44, 0, -4), "shin.R": (54, 0, 0),
        "upperarm.L": (-74, 0, -30), "upperarm.R": (-66, 0, 28),
        "forearm.L": (-10, 0, 0), "forearm.R": (-14, 0, 0),
    }))
    L.key_location(rig, "hips", 1, (0.0, 0.0, 0.0))
    L.key_location(rig, "hips", 20, (0.0, -0.10, -0.62))
    L.key_location(rig, "hips", 26, (0.0, -0.12, -0.66))
    L.set_action_range(action, 1, 26)


def build_all(rig) -> None:
    """Author every cycle. Order sets the order they appear in the GLB."""
    idle(rig)
    walk(rig)
    run(rig)
    fire(rig)
    death(rig)
