#!/usr/bin/env python3
"""
Procedural PBR texture generator for NIGHTCELL 7.

Every surface in the game is textured from this file. Nothing is downloaded,
photographed or traced, which is what lets the whole set satisfy CLAUDE.md's
"no public asset without provenance" rule — the provenance is this script plus
a seed.

Each material produces the three maps a glTF/Babylon PBR workflow needs:

  <name>_albedo.webp   base colour, no lighting baked in
  <name>_normal.webp   tangent-space normal, derived from a height field
  <name>_orm.webp      R = ambient occlusion, G = roughness, B = metallic

ORM packing is not an optimisation detail — it is the layout Babylon reads
directly (`useRoughnessFromMetallicTextureGreen` / `...MetallicTextureBlue`),
so three separate greyscale files would cost three texture fetches per pixel
for no benefit.

Everything is tileable. The noise lattices wrap, so a 4 m tile repeats across a
120 m yard without a visible seam. Run with Blender's bundled Python, which
already has numpy:

  /home/ubuntu/.local/opt/blender/4.5/python/bin/python3.11 generate.py --out <dir>
"""

from __future__ import annotations

import argparse
import os
import struct
import zlib

import numpy as np

RES = 1024


# --------------------------------------------------------------------- noise


def _lattice(rng: np.random.Generator, freq: int) -> np.ndarray:
    return rng.random((freq, freq), dtype=np.float64)


def _smoothstep(t: np.ndarray) -> np.ndarray:
    return t * t * (3.0 - 2.0 * t)


def value_noise(size: int, freq: int, rng: np.random.Generator) -> np.ndarray:
    """
    Tileable bilinear value noise.

    The lattice index wraps with `% freq`, which is what makes the result
    seamless — the right edge samples the same lattice column as the left.
    """
    grid = _lattice(rng, freq)

    coords = np.arange(size, dtype=np.float64) * freq / size
    i0 = np.floor(coords).astype(int) % freq
    i1 = (i0 + 1) % freq
    frac = _smoothstep(coords - np.floor(coords))

    # Interpolate rows then columns.
    top = grid[np.ix_(i0, i0)] * (1 - frac)[None, :] + grid[np.ix_(i0, i1)] * frac[None, :]
    bottom = grid[np.ix_(i1, i0)] * (1 - frac)[None, :] + grid[np.ix_(i1, i1)] * frac[None, :]
    return top * (1 - frac)[:, None] + bottom * frac[:, None]


def fbm(size: int, rng: np.random.Generator, octaves: int = 6, base_freq: int = 4) -> np.ndarray:
    """Fractional Brownian motion — the general-purpose "natural variation" field."""
    total = np.zeros((size, size))
    amplitude = 1.0
    norm = 0.0
    freq = base_freq
    for _ in range(octaves):
        total += value_noise(size, freq, rng) * amplitude
        norm += amplitude
        amplitude *= 0.5
        freq *= 2
    return total / norm


def ridged(size: int, rng: np.random.Generator, octaves: int = 5, base_freq: int = 4) -> np.ndarray:
    """Ridged noise — sharp creases, used for cracks and weld lines."""
    total = np.zeros((size, size))
    amplitude = 1.0
    norm = 0.0
    freq = base_freq
    for _ in range(octaves):
        n = value_noise(size, freq, rng)
        total += (1.0 - np.abs(n * 2 - 1)) ** 2 * amplitude
        norm += amplitude
        amplitude *= 0.5
        freq *= 2
    return total / norm


def worley(size: int, cells: int, rng: np.random.Generator) -> np.ndarray:
    """
    Tileable Worley (cellular) noise — distance to the nearest feature point.

    Used for concrete aggregate and rust blotching. Points are jittered inside
    a regular grid and neighbours are checked with wraparound, which keeps it
    seamless and O(size^2 * 9) instead of O(size^2 * cells^2).
    """
    # One jittered feature point per cell, stored as an in-cell fraction so a
    # wrapped neighbour can be un-wrapped back into continuous space.
    jitter = rng.random((cells, cells, 2))

    ys, xs = np.meshgrid(
        (np.arange(size) + 0.5) / size, (np.arange(size) + 0.5) / size, indexing="ij"
    )
    cy = np.floor(ys * cells).astype(int)
    cx = np.floor(xs * cells).astype(int)

    best = np.full((size, size), 10.0)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            iy = (cy + dy) % cells
            ix = (cx + dx) % cells
            # Use the unwrapped cell index for the position: a neighbour off the
            # left edge must sit at a negative coordinate, not jump to the far
            # side, or the distance field creases at the tile seam.
            py = ((cy + dy) + jitter[iy, ix, 0]) / cells
            px = ((cx + dx) + jitter[iy, ix, 1]) / cells
            best = np.minimum(best, np.sqrt((ys - py) ** 2 + (xs - px) ** 2))

    return best / best.max()


def streaks(size: int, rng: np.random.Generator, strength: float = 1.0) -> np.ndarray:
    """
    Vertical runoff streaking.

    Weathering is directional: water carries dirt and rust *down*. Isotropic
    noise alone always reads as "procedural"; this is what makes a surface look
    like it has been rained on.
    """
    # Sparse origins — only some columns ever start a run.
    seeds = value_noise(size, 96, rng)
    seeds = np.clip((seeds - 0.62) * 5.0, 0, 1)
    seeds *= np.clip(value_noise(size, 16, rng) * 1.4, 0, 1)

    # Smear downward with decay. Repeating one noise row instead (the naive
    # version) gives dead-straight full-height stripes that alias badly and
    # read as a rendering fault rather than as weathering.
    trail = seeds.copy()
    for _ in range(7):
        trail = np.maximum(trail, np.roll(trail, 1, axis=0) * 0.86)
    for _ in range(3):
        trail = np.maximum(trail, np.roll(trail, 4, axis=0) * 0.72)

    # Break the runs up so they fade unevenly, like real dirt.
    trail *= 0.55 + 0.45 * fbm(size, rng, octaves=4, base_freq=12)
    trail = blur(trail, 1)

    return np.clip(trail * strength, 0, 1)


def blur(a: np.ndarray, radius: int = 2) -> np.ndarray:
    """Cheap separable box blur with wraparound, for AO and softening."""
    out = a.astype(np.float64)
    k = radius * 2 + 1
    acc = np.zeros_like(out)
    for shift in range(-radius, radius + 1):
        acc += np.roll(out, shift, axis=0)
    out = acc / k
    acc = np.zeros_like(out)
    for shift in range(-radius, radius + 1):
        acc += np.roll(out, shift, axis=1)
    return acc / k


def normalise(a: np.ndarray) -> np.ndarray:
    lo, hi = a.min(), a.max()
    return (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)


# ------------------------------------------------------------- map synthesis


def height_to_normal(height: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """
    Tangent-space normal from a height field via central differences.

    Rolling rather than padding keeps the normal map tileable in step with the
    height it came from.
    """
    # Z stays at 1 and the gradient is scaled against it. Driving Z toward zero
    # instead (the obvious-looking `1/strength`) tips every normal almost flat
    # to the surface, which is what turned concrete into bubble wrap.
    #
    # The gain is divided by the resolution ratio so a 512 and a 1024 version of
    # the same material have the same apparent relief rather than the larger one
    # looking smoother.
    gain = 18.0 * strength / (height.shape[0] / 512.0)

    # Soften by one texel first. Central differences on a raw height field
    # amplify single-texel noise into a normal map that sparkles under a moving
    # camera — the speckle is far more visible in motion than in a still.
    height = blur(height, 1)

    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5

    nx = -dx * gain
    ny = -dy * gain
    nz = np.ones_like(height)

    length = np.sqrt(nx**2 + ny**2 + nz**2)
    nx, ny, nz = nx / length, ny / length, nz / length

    return np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)


def cavity_ao(height: np.ndarray, radius: int = 6) -> np.ndarray:
    """
    Approximate AO: how far below its local average a texel sits.

    Not a ray-traced occlusion pass, but for tiling detail it is the part of AO
    that actually reads — dirt and shadow gathering in the low spots.
    """
    # Soften first, for the same reason the normal pass does: AO built from a
    # raw height field speckles, and speckled AO reads as dirt-coloured noise.
    height = blur(height, 1)
    local = blur(height, radius)
    ao = np.clip(1.0 - (local - height) * 6.0, 0.0, 1.0)
    return np.clip(ao * 0.85 + 0.15, 0, 1)


# ------------------------------------------------------------------ PNG I/O


def write_png(path: str, rgb: np.ndarray) -> None:
    """Minimal PNG writer (stdlib only) — avoids a Pillow dependency."""
    data = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
    if data.ndim == 2:
        data = np.stack([data] * 3, axis=-1)
    height, width, _ = data.shape

    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(height))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(png)


# ----------------------------------------------------------------- materials


def mat_concrete(size: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)

    # Aggregate is the exposed stone in the mix. It must be fine and low
    # amplitude: at 48 cells it dominated the relief and read as bubble wrap.
    aggregate = 1.0 - worley(size, 150, rng)
    pits = np.clip(worley(size, 60, rng) - 0.55, 0, 1) * 2.0
    mottle = fbm(size, rng, octaves=6, base_freq=3)
    # Capped well below texel frequency. At base_freq 64 the top octave landed
    # at 512 — per-texel noise, which shows up as speckle in both the normal
    # and the AO channel.
    grain = fbm(size, rng, octaves=3, base_freq=20)
    grime = fbm(size, rng, octaves=4, base_freq=8)
    cracks = np.clip(ridged(size, rng, octaves=4, base_freq=5) - 0.70, 0, 1) * 4.0

    height = (
        normalise(mottle * 0.55 + grain * 0.2 + aggregate * 0.25) - pits * 0.35 - cracks * 0.6
    )

    # Wider tonal spread than the first pass, which came out nearly flat.
    base = 0.15 + mottle * 0.14 + aggregate * 0.06 + grain * 0.04
    base = base - cracks * 0.10 - pits * 0.05
    # Concrete is faintly warm; a pure grey reads as untextured plastic.
    albedo = np.stack([base * 1.03, base, base * 0.94], axis=-1)
    albedo = np.clip(albedo - grime[..., None] * 0.05, 0, 1)

    roughness = np.clip(0.80 + mottle * 0.14 - aggregate * 0.06 + cracks * 0.1, 0.45, 1.0)
    metallic = np.zeros((size, size))
    ao = cavity_ao(height)

    return {
        "albedo": albedo,
        "normal": height_to_normal(height, strength=1.6),
        "orm": np.stack([ao, roughness, metallic], axis=-1),
    }


def brushed(size: int, rng: np.random.Generator, along: int = 1) -> np.ndarray:
    """
    Anisotropic brushed-metal grain.

    Brushing produces fine lines *along* one axis, which means the value must
    vary quickly across that axis and barely at all along it. Isotropic noise —
    what the first version used — just looks like grey static and is the reason
    the steel read as flat untextured plastic.
    """
    across = 0 if along == 1 else 1
    lines = rng.random(size)
    # Smooth slightly across the grain so the lines have width.
    lines = (lines + np.roll(lines, 1) + np.roll(lines, -1)) / 3.0

    grain = np.repeat(lines[:, None], size, axis=1) if across == 0 else np.repeat(
        lines[None, :], size, axis=0
    )
    # Long-wavelength modulation so the brushing is not perfectly uniform.
    return grain * 0.7 + value_noise(size, 8, rng) * 0.3


def mat_steel(size: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)

    grain = brushed(size, rng, along=1)
    plate = fbm(size, rng, octaves=4, base_freq=3)
    dents = 1.0 - worley(size, 14, rng)
    scratch = np.clip(ridged(size, rng, octaves=3, base_freq=40) - 0.76, 0, 1) * 3.0
    grime = fbm(size, rng, octaves=5, base_freq=10)

    # Plate seams: a welded steel structure is made of panels, and the seam
    # lines are what give a large flat surface any sense of scale.
    u = np.linspace(0, 1, size, endpoint=False)
    seam_x = np.abs(((u * 3) % 1.0) - 0.5)
    seam_y = np.abs(((u * 2) % 1.0) - 0.5)
    seams = np.minimum(seam_x[None, :], seam_y[:, None])
    seams = np.clip(1.0 - seams * 26.0, 0, 1)

    height = normalise(grain * 0.18 + plate * 0.5 + dents * 0.32) - seams * 0.5 + scratch * 0.12

    # Much wider tonal range than the flat first attempt.
    base = 0.17 + plate * 0.16 + grain * 0.10 - grime * 0.05
    base = base - seams * 0.05
    albedo = np.stack([base * 0.96, base, base * 1.08], axis=-1)

    roughness = np.clip(
        0.30 + grain * 0.26 + plate * 0.14 + grime * 0.12 - scratch * 0.12, 0.12, 0.92
    )
    metallic = np.clip(0.94 - scratch * 0.25 - grime * 0.1, 0, 1)
    ao = cavity_ao(height, radius=4)

    return {
        "albedo": np.clip(albedo, 0, 1),
        "normal": height_to_normal(height, strength=1.0),
        "orm": np.stack([ao, roughness, metallic], axis=-1),
    }


def mat_rust(size: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)

    # Three scales of blotching. A single Worley layer leaves its cell
    # boundaries visible as a polygonal web — the first attempt looked like
    # cracked mud rather than corrosion.
    coarse = 1.0 - worley(size, 7, rng)
    mid = 1.0 - worley(size, 22, rng)
    fine_cell = 1.0 - worley(size, 70, rng)
    fine = fbm(size, rng, octaves=7, base_freq=6)
    pitting = fbm(size, rng, octaves=5, base_freq=40)
    run = streaks(size, rng, strength=1.0)

    # How rusted each texel is. Rust spreads from blotch centres and runs down.
    rust_mask = (
        coarse * 0.55 + mid * 0.28 + fine_cell * 0.17
    ) * 1.15 + fine * 0.45 + run * 0.6 - 0.62
    rust_mask = np.clip(rust_mask * 1.7, 0, 1)
    # Ragged the boundary: a smooth edge between paint and rust looks airbrushed.
    rust_mask = np.clip(rust_mask * (0.75 + 0.5 * pitting) * 1.25, 0, 1)

    height = normalise(fine * 0.42 + pitting * 0.2 + rust_mask * 0.28 + run * 0.1)

    steel_base = np.stack([np.full((size, size), 0.23)] * 3, axis=-1)
    steel_base[..., 2] *= 1.08
    # Rust runs from dark red-brown in the pits to warm orange on the crust.
    rust_col = np.stack(
        [0.30 + fine * 0.22, 0.135 + fine * 0.10, 0.065 + fine * 0.04], axis=-1
    )

    m = rust_mask[..., None]
    albedo = np.clip(steel_base * (1 - m) + rust_col * m, 0, 1)

    roughness = np.clip(0.35 * (1 - rust_mask) + 0.93 * rust_mask + fine * 0.05, 0.2, 1.0)
    # Rust is an oxide: it is not metallic, which is the main visual cue.
    metallic = np.clip(0.9 * (1 - rust_mask), 0, 1)
    ao = cavity_ao(height, radius=5)

    return {
        "albedo": albedo,
        "normal": height_to_normal(height, strength=1.5),
        "orm": np.stack([ao, roughness, metallic], axis=-1),
    }


def _painted_metal(size: int, seed: int, colour: tuple[float, float, float]) -> dict:
    """Painted corrugated steel with chipping, chalking and dirt runoff."""
    rng = np.random.default_rng(seed)

    fine = fbm(size, rng, octaves=6, base_freq=5)
    run = streaks(size, rng, strength=0.9)
    scratch = np.clip(ridged(size, rng, octaves=3, base_freq=40) - 0.78, 0, 1) * 3.0

    # Paint failure is clustered and irregular, not evenly scattered. Thresholding
    # a single Worley layer (the first attempt) gave every chip the same round
    # shape at the same spacing, which read as a leopard print rather than wear.
    #
    # Instead: a low-frequency "wear zone" decides *where* paint is failing at
    # all, and high-frequency detail decides the ragged shape of each chip.
    wear_zone = np.clip(fbm(size, rng, octaves=4, base_freq=3) * 1.7 - 0.55, 0, 1)
    chip_edge = np.clip(ridged(size, rng, octaves=4, base_freq=16) - 0.62, 0, 1) * 2.6
    speck = np.clip(fbm(size, rng, octaves=6, base_freq=26) - 0.57, 0, 1) * 3.2

    bare = (speck * 0.75 + chip_edge * 0.45) * (0.25 + wear_zone * 1.5)
    bare = np.clip(bare * 1.3 + scratch * 0.55, 0, 1)

    height = normalise(fine * 0.55 + bare * 0.25) + scratch * 0.1

    paint = np.stack(
        [
            colour[0] * (0.86 + fine * 0.28),
            colour[1] * (0.86 + fine * 0.28),
            colour[2] * (0.86 + fine * 0.28),
        ],
        axis=-1,
    )
    # Chalking: sun-bleached paint loses saturation before it loses adhesion.
    chalk = fbm(size, rng, octaves=3, base_freq=3)[..., None]
    paint = paint * (1 - chalk * 0.22) + chalk * 0.10

    rust_col = np.stack(
        [0.26 + fine * 0.16, 0.12 + fine * 0.07, np.full_like(fine, 0.06)], axis=-1
    )
    b = bare[..., None]
    albedo = paint * (1 - b) + rust_col * b
    albedo = np.clip(albedo - run[..., None] * 0.10, 0, 1)

    roughness = np.clip(0.58 + fine * 0.14 + bare * 0.3 + run * 0.08, 0.25, 1.0)
    metallic = np.clip(0.06 + bare * 0.35, 0, 1)
    ao = cavity_ao(height, radius=5)

    return {
        "albedo": albedo,
        "normal": height_to_normal(height, strength=1.2),
        "orm": np.stack([ao, roughness, metallic], axis=-1),
    }


def mat_paint_red(size: int, seed: int) -> dict:
    return _painted_metal(size, seed, (0.62, 0.17, 0.18))


def mat_paint_cyan(size: int, seed: int) -> dict:
    return _painted_metal(size, seed, (0.16, 0.44, 0.47))


def mat_grating(size: int, seed: int) -> dict:
    """Industrial bar grating: strong directional bars with cross-ties."""
    rng = np.random.default_rng(seed)

    x = np.linspace(0, 1, size, endpoint=False)
    bars = ((x * 32) % 1.0 < 0.62).astype(np.float64)[None, :].repeat(size, axis=0)
    ties = ((np.linspace(0, 1, size, endpoint=False) * 8) % 1.0 < 0.16).astype(np.float64)[
        :, None
    ].repeat(size, axis=1)
    solid = np.clip(bars + ties, 0, 1)

    grime = fbm(size, rng, octaves=5, base_freq=6)
    height = solid * 0.85 + grime * 0.15

    base = (0.18 + grime * 0.06) * solid + 0.02 * (1 - solid)
    albedo = np.stack([base * 0.98, base, base * 1.05], axis=-1)

    roughness = np.clip(0.45 + grime * 0.2 + (1 - solid) * 0.3, 0.2, 1.0)
    metallic = np.clip(0.85 * solid, 0, 1)
    # The gaps between bars are holes: force them dark and fully occluded.
    ao = np.clip(cavity_ao(height, radius=3) * (0.25 + 0.75 * solid), 0, 1)

    return {
        "albedo": np.clip(albedo, 0, 1),
        "normal": height_to_normal(height, strength=2.2),
        "orm": np.stack([ao, roughness, metallic], axis=-1),
    }


def mat_rubber(size: int, seed: int) -> dict:
    """
    Dark polymer: weapon furniture, webbing, boots.

    Albedo sits around 0.12, not the 0.045 of true rubber. Physically 0.045 is
    correct, but this is a night scene lit mostly by distant sodium lamps, and
    at that exposure a 4.5% surface renders as a pure black silhouette — the
    weapon viewmodel and the whole character read as cut-out shapes. 0.12 is
    still unmistakably "black gear" while keeping form readable.
    """
    rng = np.random.default_rng(seed)
    fine = fbm(size, rng, octaves=6, base_freq=16)
    coarse = fbm(size, rng, octaves=4, base_freq=4)
    height = fine * 0.7 + coarse * 0.3
    base = 0.105 + fine * 0.05 + coarse * 0.025
    albedo = np.stack([base, base, base * 1.06], axis=-1)
    return {
        "albedo": np.clip(albedo, 0, 1),
        "normal": height_to_normal(height, strength=0.8),
        "orm": np.stack(
            [
                cavity_ao(height, radius=3),
                # Not uniformly matte: moulded polymer has a faint sheen, and
                # the specular roll-off is most of what separates it from a
                # flat black shape in low light.
                np.clip(0.66 + fine * 0.2 + coarse * 0.08, 0, 1),
                np.zeros((size, size)),
            ],
            axis=-1,
        ),
    }


def env_sky(size: int, seed: int) -> dict:
    """
    Equirectangular environment map for image-based lighting.

    This is not decoration. Every metal in the yard (steel at 0.94 metallic,
    grating, rust) reflects its environment and *nothing else* — with no
    `scene.environmentTexture` a physically-based metal has nothing to reflect
    and renders pure black, which is exactly how the first integration looked.

    The content mirrors the in-game sky: near-black zenith, a warm false-dawn
    lobe on the northern horizon, and a dim ground bounce below. Matching them
    matters — if the reflections disagree with the visible sky, metal reads as
    if it belongs to a different scene.

    Width is 2:1 as equirectangular projection requires; v = 0 is the zenith.
    """
    rng = np.random.default_rng(seed)
    width, height = size, size // 2

    v = np.linspace(0.0, 1.0, height)[:, None]
    u = np.linspace(0.0, 1.0, width)[None, :]

    # Elevation ramp: 0 at zenith, 0.5 at horizon, 1 at nadir.
    horizon = np.clip(1.0 - np.abs(v - 0.5) * 2.0, 0, 1)

    sky = np.zeros((height, width, 3))
    # Cold night sky above the horizon.
    above = (v < 0.5).astype(float)
    sky[..., 0] = (0.012 + 0.05 * horizon**3) * above
    sky[..., 1] = (0.018 + 0.06 * horizon**3) * above
    sky[..., 2] = (0.035 + 0.08 * horizon**3) * above

    # The false dawn: a warm lobe centred a quarter of the way round, falling
    # off in both azimuth and elevation.
    azimuth = np.cos((u - 0.25) * 2.0 * np.pi)
    lobe = np.clip(azimuth, 0, 1) ** 2.0
    band = np.clip(1.0 - np.abs(v - 0.5) * 5.0, 0, 1) ** 2.0
    dawn = lobe * band * above
    sky[..., 0] += dawn * 0.95
    sky[..., 1] += dawn * 0.52
    sky[..., 2] += dawn * 0.20

    # Ground bounce below the horizon: dim, warm, and flat.
    below = (v >= 0.5).astype(float)
    fade = np.clip(1.0 - (v - 0.5) * 1.6, 0, 1)
    sky[..., 0] += below * (0.035 + 0.05 * fade)
    sky[..., 1] += below * (0.030 + 0.04 * fade)
    sky[..., 2] += below * (0.028 + 0.035 * fade)

    # A little noise stops large flat regions banding once mip-mapped.
    sky += (rng.random((height, width, 1)) - 0.5) * 0.004

    return {"sky": np.clip(sky, 0, 1)}


MATERIALS = {
    "concrete": (mat_concrete, 1101),
    "steel": (mat_steel, 1202),
    "rust": (mat_rust, 1303),
    "paint_red": (mat_paint_red, 1404),
    "paint_cyan": (mat_paint_cyan, 1505),
    "grating": (mat_grating, 1606),
    "rubber": (mat_rubber, 1707),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=RES)
    parser.add_argument("--only", default=None, help="comma-separated material names")
    args = parser.parse_args()

    wanted = set(args.only.split(",")) if args.only else set(MATERIALS) | {"env"}

    for name, (fn, seed) in MATERIALS.items():
        if name not in wanted:
            continue
        maps = fn(args.size, seed)
        for kind, data in maps.items():
            path = os.path.join(args.out, f"{name}_{kind}.png")
            write_png(path, data)
            print(f"TEXTURE {name}_{kind}.png {os.path.getsize(path)}")

    if "env" in wanted:
        # Half resolution: an environment map is only ever sampled blurred, so
        # detail here is wasted bytes.
        for kind, data in env_sky(max(512, args.size // 2), 1808).items():
            path = os.path.join(args.out, f"env_{kind}.png")
            write_png(path, data)
            print(f"TEXTURE env_{kind}.png {os.path.getsize(path)}")


if __name__ == "__main__":
    main()
