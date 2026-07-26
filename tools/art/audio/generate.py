#!/usr/bin/env python3
"""
Procedural audio generator for NIGHTCELL 7.

The game shipped completely silent — no audio files, no audio code. This
synthesises the V1 sound set from first principles so it carries the same
provenance guarantee as the art: nothing sampled, nothing downloaded, nothing
licensed. The provenance of any clip is this script plus a seed (CLAUDE.md).

Two project rules shape the output:

  * **WAV masters, compressed runtime audio.** Masters are written as 48 kHz
    16-bit WAV; `build-audio.mjs` encodes the shipped MP3s. MP3 rather than
    Opus-in-WebM because `decodeAudioData` handles it identically on every
    browser we support, and these clips are small enough that the codec
    difference is a few kilobytes.
  * **Repeated sounds require variations.** Anything the player triggers more
    than once a second — gunshots, footsteps, impacts — is generated in several
    seeded variants. A single footstep sample looped at running pace is the
    most fatiguing sound a game can make.

Run with Blender's bundled Python (it already has numpy):
  <blender>/python/bin/python3.11 generate.py --out <dir>
"""

from __future__ import annotations

import argparse
import math
import os
import struct
import wave

import numpy as np

RATE = 48_000


# ------------------------------------------------------------------ helpers


def noise(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.uniform(-1.0, 1.0, n)


def envelope(n: int, attack: float, decay: float, power: float = 1.0) -> np.ndarray:
    """Percussive envelope: near-instant attack, exponential decay."""
    t = np.arange(n) / RATE
    a = np.clip(t / max(attack, 1e-6), 0, 1)
    d = np.exp(-t / max(decay, 1e-6)) ** power
    return a * d


def one_pole_lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """
    Single-pole IIR low-pass.

    Written as an explicit loop-free recursion via `np.frompyfunc` would be
    slower than this; the clips are short enough that a plain loop over a few
    thousand samples is instant, and the intent stays readable.
    """
    alpha = 1.0 - math.exp(-2.0 * math.pi * cutoff / RATE)
    out = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += alpha * (v - acc)
        out[i] = acc
    return out


def one_pole_highpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - one_pole_lowpass(x, cutoff)


def bandpass(x: np.ndarray, low: float, high: float) -> np.ndarray:
    return one_pole_highpass(one_pole_lowpass(x, high), low)


def resonator(n: int, freq: float, decay: float, rng: np.random.Generator) -> np.ndarray:
    """A decaying sine — used for the metallic ring in grating and hardware."""
    t = np.arange(n) / RATE
    phase = rng.uniform(0, 2 * math.pi)
    return np.sin(2 * math.pi * freq * t + phase) * np.exp(-t / max(decay, 1e-6))


def normalise(x: np.ndarray, peak: float = 0.89) -> np.ndarray:
    m = float(np.max(np.abs(x))) if x.size else 0.0
    return x * (peak / m) if m > 1e-9 else x


def soft_clip(x: np.ndarray) -> np.ndarray:
    """Gentle saturation — keeps transients loud without square-wave clipping."""
    return np.tanh(x * 1.15)


def fade(x: np.ndarray, ms: float = 3.0, in_ms: float = 0.2) -> np.ndarray:
    """
    Short fades top and tail so a clip cannot click when it starts or stops.

    The fade-in is separately (and much more briefly) specified than the
    fade-out on purpose. Every percussive sound here peaks within the first
    fraction of a millisecond, so a symmetric 3 ms fade-in lands directly on
    the transient and flattens it — measurably, the gunshots normalised to 0.89
    but left this function peaking at 0.72. The attack *is* the gunshot; the
    envelopes already start from silence, so a 0.2 ms ramp is all that is
    needed to guarantee no discontinuity at sample zero.
    """
    out = x.copy()

    n_in = max(1, int(RATE * in_ms / 1000))
    n_out = int(RATE * ms / 1000)
    if n_in + n_out >= x.size:
        return out

    out[:n_in] *= np.linspace(0, 1, n_in)
    out[-n_out:] *= np.linspace(1, 0, n_out)
    return out


def seamless(x: np.ndarray, ms: float = 400.0) -> np.ndarray:
    """
    Crossfade a loop's tail over its head so it repeats without a seam.

    An ambience bed with an audible click every few seconds is worse than no
    ambience at all.
    """
    n = int(RATE * ms / 1000)
    if n * 2 >= x.size:
        return x
    head, tail = x[:n], x[-n:]
    ramp = np.linspace(0, 1, n)
    x = x[:-n].copy()
    x[:n] = tail * (1 - ramp) + head * ramp
    return x


def write_wav(path: str, samples: np.ndarray) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    pcm = np.clip(samples, -1.0, 1.0)
    data = (pcm * 32767.0).astype("<i2")
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(data.tobytes())
    _ = struct


# ------------------------------------------------------------------- sounds


def carbine_fire(seed: int) -> np.ndarray:
    """
    A 5.56-class carbine report.

    Four layers, which is roughly how a real report is built: the muzzle blast
    transient, the sharp supersonic crack, a low body thump you feel more than
    hear, and the tail bouncing off the yard.
    """
    rng = np.random.default_rng(seed)
    n = int(RATE * 0.55)

    blast = noise(n, rng) * envelope(n, 0.0002, 0.010)
    blast = bandpass(blast, 400, 9000) * 1.0

    crack = noise(n, rng) * envelope(n, 0.0001, 0.0035)
    crack = one_pole_highpass(crack, 3500) * 0.85

    body = noise(n, rng) * envelope(n, 0.001, 0.055)
    body = bandpass(body, 90, 700) * 0.9

    # Tail: the yard is concrete and steel, so the reflection is bright and
    # gated rather than a smooth hall reverb.
    tail = noise(n, rng) * envelope(n, 0.012, 0.20, power=1.4)
    tail = bandpass(tail, 250, 3200) * 0.30
    # Slap-back off the perimeter wall.
    slap = np.zeros(n)
    delay = int(RATE * 0.045)
    slap[delay:] = tail[: n - delay] * 0.5

    mix = blast + crack + body + tail + slap
    return fade(normalise(soft_clip(mix)))


def footstep(seed: int, surface: str) -> np.ndarray:
    """
    One footstep.

    Concrete is a short, dry, mid-heavy scuff. Grating adds decaying metallic
    partials — the same boot on steel mesh rings, and that difference is a real
    gameplay cue about which level someone is on.
    """
    rng = np.random.default_rng(seed)
    n = int(RATE * (0.34 if surface == "grating" else 0.20))

    impact = noise(n, rng) * envelope(n, 0.0006, 0.022)
    if surface == "grating":
        body = bandpass(impact, 300, 6000) * 0.7
        ring = np.zeros(n)
        for freq, amp in ((1180.0, 0.30), (1870.0, 0.20), (2640.0, 0.12), (3910.0, 0.07)):
            ring += resonator(n, freq * rng.uniform(0.96, 1.04), 0.085, rng) * amp
        ring *= envelope(n, 0.0008, 0.10)
        mix = body + ring
    else:
        body = bandpass(impact, 120, 2600) * 0.85
        grit = noise(n, rng) * envelope(n, 0.002, 0.035) * 0.25
        grit = bandpass(grit, 1800, 7000)
        mix = body + grit

    return fade(normalise(soft_clip(mix), peak=0.55))


def impact_concrete(seed: int) -> np.ndarray:
    """A round striking concrete: sharp tick, dust, small debris tail."""
    rng = np.random.default_rng(seed)
    n = int(RATE * 0.30)

    tick = noise(n, rng) * envelope(n, 0.0001, 0.004)
    tick = one_pole_highpass(tick, 2500)
    puff = noise(n, rng) * envelope(n, 0.001, 0.045)
    puff = bandpass(puff, 200, 2200) * 0.6
    debris = noise(n, rng) * envelope(n, 0.02, 0.09) * 0.18
    debris = bandpass(debris, 1500, 8000)

    return fade(normalise(soft_clip(tick + puff + debris), peak=0.7))


def grenade_blast(seed: int) -> np.ndarray:
    """
    A frag detonation: crack, body, and a tail that outlasts both.

    Three layers, because a single enveloped noise burst reads as a door
    slamming rather than as an explosion:

      * a very short high crack, which is what makes it read as *sharp* rather
        than merely loud;
      * a low body around 55 Hz, carrying the weight — this is the layer a
        laptop speaker mostly cannot reproduce, so the blast must still work
        without it;
      * a long, dark tail of debris and yard reverberation. The tail is what
        distinguishes an explosion from an impact, and it is deliberately most
        of the clip's length.

    Deliberately not normalised to the same peak as a gunshot. A grenade that
    merely matches the rifle in level does not feel bigger than one, so the
    weight comes from spectrum and duration instead of clipping harder.
    """
    rng = np.random.default_rng(seed)
    n = int(RATE * 1.60)

    crack = noise(n, rng) * envelope(n, 0.0002, 0.010, power=1.6)
    crack = one_pole_highpass(crack, 1800) * 0.85

    body = noise(n, rng) * envelope(n, 0.002, 0.16, power=1.3)
    body = one_pole_lowpass(body, 420)
    # A falling sine under the noise gives the blast a pitch to drop, which is
    # most of what "big" sounds like.
    t = np.arange(n) / RATE
    sweep = np.sin(2 * np.pi * (58 * np.exp(-t * 3.4)) * t)
    body = body + sweep * envelope(n, 0.001, 0.22, power=1.5) * 0.8

    tail = noise(n, rng) * envelope(n, 0.03, 0.85, power=0.75) * 0.42
    tail = bandpass(tail, 90, 2600)

    debris = np.zeros(n)
    for _ in range(14):
        at = rng.uniform(0.06, 0.9)
        start = int(at * RATE)
        length = min(n - start, int(RATE * 0.05))
        if length <= 0:
            continue
        piece = noise(length, rng) * envelope(length, 0.001, 0.02)
        debris[start : start + length] += bandpass(piece, 900, 6500) * rng.uniform(0.05, 0.16)

    return fade(normalise(soft_clip(crack + body + tail + debris), peak=0.94), ms=40.0)


def reload_clack(seed: int) -> np.ndarray:
    """Magazine out, magazine in, bolt release — three mechanical events."""
    rng = np.random.default_rng(seed)
    n = int(RATE * 1.05)
    out = np.zeros(n)

    for at, decay, freq, amp in (
        (0.00, 0.030, 520.0, 0.75),  # magazine release
        (0.34, 0.038, 380.0, 0.85),  # magazine seated
        (0.72, 0.026, 900.0, 0.95),  # bolt forward
    ):
        start = int(RATE * at)
        length = min(int(RATE * 0.22), n - start)
        seg = noise(length, rng) * envelope(length, 0.0004, decay)
        seg = bandpass(seg, 200, 6500)
        seg += resonator(length, freq, decay * 0.8, rng) * 0.35 * envelope(length, 0.0004, decay)
        out[start : start + length] += seg * amp

    return fade(normalise(soft_clip(out), peak=0.62))


def ui_blip(seed: int, kind: str) -> np.ndarray:
    """
    Interface feedback.

    Deliberately quiet and short. The palette is cold and mechanical to match
    the DIVIDED SIGNAL identity — nothing musical, nothing cheerful.
    """
    rng = np.random.default_rng(seed)
    n = int(RATE * (0.09 if kind == "hover" else 0.16))
    base = {"hover": 1650.0, "click": 880.0, "error": 320.0}[kind]

    tone = resonator(n, base, 0.020 if kind == "hover" else 0.045, rng)
    tone += resonator(n, base * 1.5, 0.014, rng) * 0.3
    tone *= envelope(n, 0.0008, 0.030 if kind == "hover" else 0.055)

    tick = noise(n, rng) * envelope(n, 0.0002, 0.004) * 0.25
    tick = one_pole_highpass(tick, 2000)

    peak = 0.22 if kind == "hover" else 0.34
    return fade(normalise(tone + tick, peak=peak))


def yard_ambience(seed: int, seconds: float = 12.0) -> np.ndarray:
    """
    Looping bed for Ardavan Yard.

    Wind over open ground, the mains hum of the lamp masts, and a distant plant
    drone. Kept low and wide-band: this sits under everything and its job is to
    stop silence reading as a bug, not to be noticed.
    """
    rng = np.random.default_rng(seed)
    n = int(RATE * seconds)

    # Wind: brown-ish noise with a slowly wandering filter.
    wind = np.cumsum(noise(n, rng))
    wind = wind - one_pole_lowpass(wind, 0.5)  # remove DC drift
    wind = one_pole_lowpass(wind, 520)
    wind = normalise(wind, 0.5)
    # Gusts.
    t = np.arange(n) / RATE
    gust = 0.62 + 0.38 * (
        0.5 * np.sin(2 * math.pi * 0.043 * t + rng.uniform(0, 6))
        + 0.5 * np.sin(2 * math.pi * 0.017 * t + rng.uniform(0, 6))
    )
    wind *= gust

    # Sodium lamp hum: 50 Hz mains and its harmonics, very quiet.
    hum = np.zeros(n)
    for harmonic, amp in ((50.0, 0.030), (100.0, 0.020), (150.0, 0.009)):
        hum += np.sin(2 * math.pi * harmonic * t + rng.uniform(0, 6)) * amp

    # Distant plant drone.
    drone = np.zeros(n)
    for freq, amp in ((72.0, 0.020), (108.0, 0.012), (181.0, 0.006)):
        drone += np.sin(2 * math.pi * freq * t + rng.uniform(0, 6)) * amp
    drone *= 0.8 + 0.2 * np.sin(2 * math.pi * 0.03 * t)

    mix = wind * 0.42 + hum + drone
    return seamless(normalise(mix, peak=0.34))


# --------------------------------------------------------------------- main

# Variation counts. Anything triggered repeatedly needs several takes
# (CLAUDE.md); one-shots that fire rarely do not.
SOUNDS: dict[str, tuple] = {
    "fire": (carbine_fire, 4, 3100),
    "step_concrete": (lambda s: footstep(s, "concrete"), 5, 3200),
    "step_grating": (lambda s: footstep(s, "grating"), 4, 3300),
    "impact_concrete": (impact_concrete, 4, 3400),
    # Explosions are rare per match but very recognisable, so a repeat inside
    # one firefight is obvious — three takes (CLAUDE.md: repeated sounds need
    # variations).
    "explosion": (grenade_blast, 3, 3800),
}

SINGLES = {
    "reload": (reload_clack, 3500),
    "ui_hover": (lambda s: ui_blip(s, "hover"), 3600),
    "ui_click": (lambda s: ui_blip(s, "click"), 3610),
    "ui_error": (lambda s: ui_blip(s, "error"), 3620),
    "ambience_yard": (yard_ambience, 3700),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", default=None)
    args = parser.parse_args()

    wanted = set(args.only.split(",")) if args.only else None

    for name, (fn, count, seed) in SOUNDS.items():
        if wanted and name not in wanted:
            continue
        for i in range(count):
            path = os.path.join(args.out, f"{name}_{i + 1:02d}.wav")
            write_wav(path, fn(seed + i))
            print(f"AUDIO {os.path.basename(path)} {os.path.getsize(path)}")

    for name, (fn, seed) in SINGLES.items():
        if wanted and name not in wanted:
            continue
        path = os.path.join(args.out, f"{name}.wav")
        write_wav(path, fn(seed))
        print(f"AUDIO {os.path.basename(path)} {os.path.getsize(path)}")


if __name__ == "__main__":
    main()
