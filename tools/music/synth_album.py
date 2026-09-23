#!/usr/bin/env python3
"""
Þrøngva album renderer: every note synthesised from code, nothing sampled.

    python3 tools/music/synth_album.py docs/music/when-the-ravens-lied/album.md [--only 3] [--jobs 3] [--suno] [--check]

Reads the lyric sheet (see its "Format" section) and arranges each section
from its name and style direction: tempo, key, chord progression, a drop-D
riff with the kick doubling it, boom-bap or bounce drums on the hip-hop
tracks, choir, strings, tagelharpa, throat-singing drone, horns and the sound
effects named in the sheet (wind, ravens, rain, bells, thunder...).

The voice is formant synthesis driven by the lyrics: one sung or rapped note
per syllable, the vowel of that syllable, a burst for its consonant, a hook
melody that repeats wherever the line repeats. It follows the words' rhythm
and vowels; it is not intelligible speech. The lyrics ride in the ID3 tags.

Provenance is the same as the game's SFX (tools/art/audio/generate.py): a
commit, this script and a seed. Output: a 48 kHz WAV master in
build/music-wav/<album>/ (not committed) and a 320 kbps MP3 in
apps/game/public/audio/music/Þrøngva/<album>/, plus playlist.m3u.

Needs numpy and ffmpeg. No other dependency.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import os
import re
import subprocess
import sys
import wave
from dataclasses import dataclass, field
from multiprocessing import Pool

import numpy as np

RATE = 48_000
ARTIST = "Þrøngva"
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
F32 = np.float32

# --------------------------------------------------------------------------
# Lyric sheet
# --------------------------------------------------------------------------


@dataclass
class Section:
    name: str
    style: str
    seconds: float
    lines: list[str]


@dataclass
class Track:
    number: int
    title: str
    style: str = ""
    avoid: str = ""
    sections: list[Section] = field(default_factory=list)


@dataclass
class Album:
    title: str = ""
    style: str = ""
    avoid: str = ""
    tracks: list[Track] = field(default_factory=list)


def parse_album(text: str) -> Album:
    album = Album()
    track: Track | None = None
    section: Section | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not album.title and line.startswith("# ") and track is None:
            album.title = line[2:].split(":", 1)[-1].strip()
            continue
        if line.startswith("ALBUM-STYLE:"):
            album.style = line[12:].strip()
            continue
        if line.startswith("ALBUM-AVOID:"):
            album.avoid = line[12:].strip()
            continue
        m = re.match(r"^# (\d+)\. (.+)$", line)
        if m:
            track = Track(int(m.group(1)), m.group(2).strip())
            album.tracks.append(track)
            section = None
            continue
        if track is None:
            continue
        if line.startswith("style:"):
            track.style = line[6:].strip()
        elif line.startswith("avoid:"):
            track.avoid = line[6:].strip()
        elif line.startswith("## "):
            parts = [p.strip() for p in line[3:].split("|")]
            section = Section(parts[0], parts[1] if len(parts) > 1 else "", float(parts[2]) if len(parts) > 2 else 16, [])
            track.sections.append(section)
        elif line and section is not None:
            section.lines.append(line)
    return album


def tagged_lyrics(track: Track) -> str:
    return "\n\n".join(
        "\n".join([f"[{s.name}{': ' + s.style if s.style else ''}]", *s.lines]) for s in track.sections
    )


def stem(track: Track) -> str:
    return f"{track.number:03d}. {track.title}"


# --------------------------------------------------------------------------
# DSP primitives
# --------------------------------------------------------------------------


def seed_of(*parts: object) -> int:
    return int.from_bytes(hashlib.sha256("|".join(map(str, parts)).encode()).digest()[:8], "little")


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def ramp_env(n: int, attack: float, release: float, sustain_to: float = 1.0) -> np.ndarray:
    """Attack, linear sustain slope to `sustain_to`, release. Seconds."""
    t = np.arange(n, dtype=np.float64) / RATE
    dur = n / RATE
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.clip((dur - t) / max(release, 1e-4), 0, 1)
    s = 1 + (sustain_to - 1) * (t / max(dur, 1e-4))
    return a * r * s


def perc_env(n: int, decay: float, attack: float = 0.001) -> np.ndarray:
    t = np.arange(n, dtype=np.float64) / RATE
    return np.clip(t / attack, 0, 1) * np.exp(-t / decay)


def spectral(x: np.ndarray, gain) -> np.ndarray:
    """Shape a short signal in the frequency domain; `gain(freqs) -> array`."""
    n = len(x)
    if n < 8:
        return x
    size = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, size)
    f = np.fft.rfftfreq(size, 1 / RATE)
    return np.fft.irfft(X * gain(f), size)[:n]


def bp_gain(lo: float, hi: float, order: float = 2.0):
    def g(f):
        f = np.maximum(f, 1e-3)
        h = 1 / np.sqrt(1 + (f / hi) ** (2 * order)) if hi else 1.0
        l = 1 / np.sqrt(1 + (lo / f) ** (2 * order)) if lo else 1.0
        return h * l
    return g


def fir(gain, taps: int = 4097) -> np.ndarray:
    """Linear-phase FIR from a gain curve (frequency sampling + window)."""
    size = 1 << 15
    f = np.fft.rfftfreq(size, 1 / RATE)
    h = np.fft.irfft(gain(f).astype(np.float64), size)
    h = np.roll(h, taps // 2)[:taps] * np.hanning(taps)
    return h


def convolve(x: np.ndarray, h: np.ndarray, block: int = 1 << 17) -> np.ndarray:
    """Overlap-add FFT convolution, output trimmed to len(x) (+ group delay removed for FIRs)."""
    n, m = len(x), len(h)
    size = 1 << (block + m - 1).bit_length()
    H = np.fft.rfft(h, size)
    out = np.zeros(n + m - 1, dtype=np.float64)
    for i in range(0, n, block):
        seg = x[i : i + block]
        y = np.fft.irfft(np.fft.rfft(seg, size) * H, size)[: len(seg) + m - 1]
        out[i : i + len(y)] += y
    return out


def fir_filter(x: np.ndarray, h: np.ndarray) -> np.ndarray:
    d = len(h) // 2
    return convolve(x, h)[d : d + len(x)]


def saw(phase: np.ndarray) -> np.ndarray:
    return 2.0 * (phase - np.floor(phase)) - 1.0


def phase_of(freq) -> np.ndarray:
    return np.cumsum(np.asarray(freq, dtype=np.float64)) / RATE


# --------------------------------------------------------------------------
# Instruments. Each returns a mono float64 array.
# --------------------------------------------------------------------------


def kick(rng, big=1.0) -> np.ndarray:
    n = int(0.45 * RATE)
    t = np.arange(n) / RATE
    f = 48 + 110 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * phase_of(f)) * perc_env(n, 0.13 * big)
    click = spectral(rng.uniform(-1, 1, n) * perc_env(n, 0.004), bp_gain(1500, 9000))
    return np.tanh(1.6 * (body + 0.5 * click))


def snare(rng) -> np.ndarray:
    n = int(0.35 * RATE)
    t = np.arange(n) / RATE
    tone = np.sin(2 * np.pi * phase_of(185 + 40 * np.exp(-t / 0.01))) * perc_env(n, 0.07)
    wires = spectral(rng.uniform(-1, 1, n), bp_gain(900, 9000)) * perc_env(n, 0.13)
    return np.tanh(1.4 * (0.7 * tone + 1.1 * wires))


def clap(rng) -> np.ndarray:
    n = int(0.3 * RATE)
    x = np.zeros(n)
    for k, off in enumerate((0, 0.011, 0.023)):
        i = int(off * RATE)
        x[i:] += rng.uniform(-1, 1, n - i) * perc_env(n - i, 0.012 if k < 2 else 0.12)
    return spectral(x, bp_gain(800, 4500))


def hat(rng, open_=False) -> np.ndarray:
    n = int((0.35 if open_ else 0.06) * RATE)
    return spectral(rng.uniform(-1, 1, n), bp_gain(7000, 16000)) * perc_env(n, 0.18 if open_ else 0.022)


def crash(rng) -> np.ndarray:
    n = int(2.2 * RATE)
    t = np.arange(n) / RATE
    partials = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) for f in (523, 811, 1177, 1633, 2311, 3217))
    x = spectral(rng.uniform(-1, 1, n), bp_gain(3000, 15000)) + 0.08 * partials
    return x * perc_env(n, 0.75, 0.002)


def tom(rng, hz=90.0, decay=0.35) -> np.ndarray:
    n = int(decay * 2.5 * RATE)
    t = np.arange(n) / RATE
    f = hz * (1 + 0.6 * np.exp(-t / 0.03))
    thud = spectral(rng.uniform(-1, 1, n) * perc_env(n, 0.02), bp_gain(80, 1200))
    return np.tanh(1.3 * (np.sin(2 * np.pi * phase_of(f)) * perc_env(n, decay) + 0.4 * thud))


def eight08(hz: float, length: float) -> np.ndarray:
    n = int(length * RATE)
    t = np.arange(n) / RATE
    f = hz * (1 + 1.2 * np.exp(-t / 0.025))
    x = np.sin(2 * np.pi * phase_of(f)) * ramp_env(n, 0.002, 0.08) * np.exp(-t / 0.9)
    return np.tanh(2.2 * x) * 0.8


def guitar(freqs: list[float], length: float, rng, mute=False, drive=10.0) -> np.ndarray:
    """Distorted power chord. Palm mute darkens before the drive and chokes the tail."""
    n = int(length * RATE)
    x = np.zeros(n)
    for f in freqs:
        cents = rng.normal(0, 3)
        ph = phase_of(np.full(n, f * 2 ** (cents / 1200))) + rng.uniform(0, 1)
        x += saw(ph)
    x /= len(freqs)
    if mute:
        x = spectral(x, bp_gain(0, 650, 1.5)) * 1.6
        env = perc_env(n, 0.09, 0.002)
    else:
        env = ramp_env(n, 0.003, 0.05, 0.75)
    return np.tanh(drive * x * env) * np.minimum(env * 4, 1)


def bass(hz: float, length: float, mute=False) -> np.ndarray:
    n = int(length * RATE)
    ph = phase_of(np.full(n, hz))
    x = 0.6 * saw(ph) + 0.8 * np.sin(2 * np.pi * ph)
    x = spectral(x, bp_gain(30, 900))
    env = perc_env(n, 0.12) if mute else ramp_env(n, 0.004, 0.05, 0.8)
    return np.tanh(1.8 * x * env)


def ensemble(midis: list[float], length: float, rng, voices=5, bright=2500.0, attack=0.6) -> np.ndarray:
    """String/pad section: detuned saws, soft attack, slow vibrato."""
    n = int(length * RATE)
    t = np.arange(n) / RATE
    x = np.zeros(n)
    for m in midis:
        for _ in range(voices):
            f = midi_hz(m) * 2 ** (rng.normal(0, 7) / 1200)
            vib = 1 + 0.004 * np.sin(2 * np.pi * rng.uniform(4.5, 5.8) * t + rng.uniform(0, 6))
            x += saw(phase_of(f * vib) + rng.uniform(0, 1))
    x = spectral(x / (len(midis) * voices), bp_gain(120, bright, 1.5))
    return x * ramp_env(n, attack, min(0.8, length / 3))


def horn(midi: float, length: float, rng) -> np.ndarray:
    n = int(length * RATE)
    t = np.arange(n) / RATE
    f = midi_hz(midi) * (1 + 0.003 * np.sin(2 * np.pi * 5 * t))
    x = sum(saw(phase_of(f * 2 ** (d / 1200))) for d in (-6, 0, 5))
    bright = 600 + 1800 * np.clip(t / 0.25, 0, 1)
    x = spectral(x, bp_gain(90, 2000, 1.2)) * (0.6 + 0.4 * bright / 2400)
    return np.tanh(1.5 * x) * ramp_env(n, 0.12, 0.3)


def bowed(midi: float, length: float, rng, gliss=0.0) -> np.ndarray:
    """Tagelharpa / nyckelharpa: bowed horsehair string, nasal, with bow noise."""
    n = int(length * RATE)
    t = np.arange(n) / RATE
    f = midi_hz(midi) * 2 ** (gliss * np.clip(1 - t / 0.12, 0, 1) / 12)
    f = f * (1 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t / 0.4, 0, 1))
    x = saw(phase_of(f))
    x = spectral(x, lambda fr: bp_gain(250, 3200, 1.2)(fr) * (1 + 1.5 * np.exp(-((fr - 1100) / 300) ** 2)))
    bow = spectral(rng.uniform(-1, 1, n), bp_gain(1500, 6000)) * 0.08
    return (x + bow) * ramp_env(n, 0.15, 0.2)


def throat_drone(midi: float, length: float, rng) -> np.ndarray:
    """Kargyraa-style drone: low fundamental, a whistled overtone that wanders."""
    n = int(length * RATE)
    t = np.arange(n) / RATE
    f0 = midi_hz(midi)
    ph = phase_of(np.full(n, f0))
    focus = 9 + 2.5 * np.sin(2 * np.pi * t / rng.uniform(5, 9))
    x = np.zeros(n)
    for k in range(1, 28):
        amp = (1 / k**0.8) * (0.15 + 1.8 * np.exp(-((k - focus) ** 2) / 0.6)) * (1 if k * f0 < 4000 else 0)
        x += amp * np.sin(2 * np.pi * k * ph)
    return x / 6 * ramp_env(n, 1.5, 1.5)


VOWELS = {  # F1, F2, F3 (adult male); female scales by 1.17
    "ah": (730, 1090, 2440), "eh": (530, 1840, 2480), "ee": (290, 2250, 3000),
    "oh": (570, 840, 2410), "oo": (310, 870, 2240), "uh": (640, 1190, 2390),
}


def formant_amps(f0: float, vowel: str, female: bool, kmax: int) -> np.ndarray:
    F = np.array(VOWELS[vowel]) * (1.17 if female else 1.0)
    bw = np.array([90, 120, 180]) * (1.2 if female else 1.0)
    a = np.array([1.0, 0.55, 0.3])
    k = np.arange(1, kmax + 1)
    fk = k * f0
    env = sum(a[i] / (1 + ((fk - F[i]) / bw[i]) ** 2) for i in range(3))
    return env / k**0.35 * (fk < 5500)


def voice_note(f_start: float, f_end: float, length: float, vowel: str, female: bool, rng,
               vibrato=True, breath=0.05, onset: str = "", whisper=False) -> np.ndarray:
    n = max(int(length * RATE), 64)
    t = np.arange(n) / RATE
    glide = np.clip(t / 0.06, 0, 1)
    f = f_start + (f_end - f_start) * glide
    if vibrato and length > 0.35:
        f = f * (1 + 0.012 * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.2) / 0.3, 0, 1))
    f = f * (1 + 0.003 * rng.normal(0, 1))
    f0 = float(np.mean(f))
    kmax = int(5500 / f0)
    ph = phase_of(f)
    if whisper:
        x = np.zeros(n)
    else:
        amps = formant_amps(f0, vowel, female, kmax)
        x = np.zeros(n)
        for k in range(1, kmax + 1):
            if amps[k - 1] > 1e-3:
                x += amps[k - 1] * np.sin(2 * np.pi * k * ph)
    F = np.array(VOWELS[vowel]) * (1.17 if female else 1.0)
    air = rng.uniform(-1, 1, n)
    air = sum(spectral(air, bp_gain(F[i] * 0.8, F[i] * 1.25, 2)) for i in range(3))
    x = x + (1.2 if whisper else breath) * air
    x *= ramp_env(n, 0.018, min(0.08, length / 3))
    if onset:
        m = min(int(0.07 * RATE), n)
        burst = rng.uniform(-1, 1, m)
        if onset == "s":
            burst = spectral(burst, bp_gain(4200, 11000)) * perc_env(m, 0.035, 0.01) * 0.9
        elif onset == "p":
            burst = spectral(burst, bp_gain(500, 5000)) * perc_env(m, 0.008) * 1.2
        else:
            burst = np.zeros(m)
        x[:m] += burst
    return x


def wind(length: float, rng) -> np.ndarray:
    n = int(length * RATE)
    t = np.arange(n) / RATE
    x = spectral(rng.uniform(-1, 1, n), bp_gain(180, 1400, 1.2))
    lfo = 0.55 + 0.45 * np.sin(2 * np.pi * t / rng.uniform(5, 8) + rng.uniform(0, 6)) * np.sin(2 * np.pi * t / 2.7)
    return x * lfo * ramp_env(n, 1.0, 1.5)


def rain(length: float, rng) -> np.ndarray:
    n = int(length * RATE)
    x = spectral(rng.uniform(-1, 1, n), bp_gain(1500, 9000)) * 0.35
    drops = np.zeros(n)
    idx = rng.integers(0, n - 2000, int(length * 40))
    for i in idx:
        drops[i : i + 600] += rng.uniform(0.2, 1) * np.sin(np.arange(600) * rng.uniform(0.3, 0.9)) * np.exp(-np.arange(600) / 90)
    return (x + 0.3 * drops) * ramp_env(n, 1.0, 1.5)


def raven(rng) -> np.ndarray:
    out = []
    for _ in range(rng.integers(1, 3)):
        n = int(rng.uniform(0.28, 0.4) * RATE)
        t = np.arange(n) / RATE
        f = 520 - 170 * t / (n / RATE)
        x = sum((1 / k**0.6) * np.sin(2 * np.pi * k * phase_of(f)) for k in range(1, 14))
        x = spectral(x * (1 + 0.7 * rng.uniform(-1, 1, n)), bp_gain(600, 3500))
        out.append(np.tanh(2 * x) * ramp_env(n, 0.02, 0.1))
        out.append(np.zeros(int(0.12 * RATE)))
    return np.concatenate(out)


def bell(hz: float, rng) -> np.ndarray:
    n = int(5 * RATE)
    t = np.arange(n) / RATE
    ratios = (0.5, 1.0, 1.19, 1.56, 2.0, 2.51, 2.66, 3.01, 4.1)
    return sum(np.sin(2 * np.pi * hz * r * t) * np.exp(-t / (2.8 / r**0.7)) / (1 + i * 0.3) for i, r in enumerate(ratios)) / 4


def coins(rng) -> np.ndarray:
    n = int(0.6 * RATE)
    x = np.zeros(n)
    for _ in range(5):
        i = rng.integers(0, n // 2)
        m = n - i
        t = np.arange(m) / RATE
        x[i:] += sum(np.sin(2 * np.pi * f * t) for f in rng.uniform(3000, 7500, 3)) * np.exp(-t / 0.06)
    return x / 6


def thunder(rng) -> np.ndarray:
    n = int(4 * RATE)
    x = spectral(rng.uniform(-1, 1, n), bp_gain(25, 260, 1.5))
    env = perc_env(n, 1.1, 0.08) * (1 + 0.6 * np.abs(spectral(rng.uniform(-1, 1, n), bp_gain(0, 6))))
    return np.tanh(3 * x * env)


def birds(length: float, rng) -> np.ndarray:
    n = int(length * RATE)
    x = np.zeros(n)
    for _ in range(int(length * 1.2)):
        i = int(rng.uniform(0, max(n - RATE, 1)))
        for c in range(rng.integers(2, 6)):
            m = int(rng.uniform(0.04, 0.09) * RATE)
            t = np.arange(m) / RATE
            f0 = rng.uniform(2500, 4500)
            chirp = np.sin(2 * np.pi * phase_of(f0 + rng.uniform(-1500, 1500) * t / t[-1])) * np.sin(np.pi * t / t[-1])
            j = i + int(c * 0.11 * RATE)
            if j + m < n:
                x[j : j + m] += chirp
    return x * 0.25


def pages(rng) -> np.ndarray:
    n = int(0.5 * RATE)
    return spectral(rng.uniform(-1, 1, n), bp_gain(1200, 6000)) * perc_env(n, 0.09, 0.03) * 0.6


def shatter(rng) -> np.ndarray:
    n = int(1.2 * RATE)
    x = spectral(rng.uniform(-1, 1, n), bp_gain(2500, 14000)) * perc_env(n, 0.25)
    t = np.arange(n) / RATE
    for f in rng.uniform(2500, 9000, 12):
        d = int(rng.uniform(0, 0.4) * RATE)
        x[d:] += 0.25 * np.sin(2 * np.pi * f * t[: n - d]) * np.exp(-t[: n - d] / 0.15)
    return x


def riser(length: float, rng) -> np.ndarray:
    n = int(length * RATE)
    t = np.arange(n) / RATE
    x = rng.uniform(-1, 1, n)
    out = np.zeros(n)
    for k in range(8):
        a, b = k * n // 8, (k + 1) * n // 8
        c = 400 * 2 ** (k * 0.6)
        out[a:b] = spectral(x[a:b], bp_gain(c, c * 4))
    return out * (t / t[-1]) ** 2


# --------------------------------------------------------------------------
# Lyrics to notes
# --------------------------------------------------------------------------

VOWEL_MAP = {"a": "ah", "e": "eh", "i": "ee", "o": "oh", "u": "oo", "y": "ee"}


def syllables(line: str) -> list[tuple[str, str]]:
    """[(vowel, onset)] per syllable; onset is 's' (fricative), 'p' (plosive) or ''."""
    out = []
    for word in re.findall(r"[A-Za-zÀ-ÿ']+", line.lower()):
        word = word.replace("ö", "o").replace("þ", "th").replace("ø", "o")
        groups = list(re.finditer(r"[aeiouy]+", word))
        if len(groups) > 1 and word.endswith("e") and not word.endswith("le") and groups[-1].group() == "e":
            groups = groups[:-1]
        if not groups:
            out.append(("uh", ""))
            continue
        prev = 0
        for g in groups:
            cons = word[prev : g.start()]
            onset = "s" if re.search(r"(s|z|f|sh|ch|th|x|c(?=[ei]))", cons) else ("p" if re.search(r"[ptkbdgq]", cons) else "")
            v = g.group()
            vowel = "oo" if v in ("oo", "ou", "ew") else ("ee" if v in ("ee", "ea", "ie") else ("oh" if v in ("oa", "ow") else VOWEL_MAP[v[0]]))
            out.append((vowel, onset))
            prev = g.end()
    return out or [("uh", "")]


# --------------------------------------------------------------------------
# Arranger
# --------------------------------------------------------------------------

MINOR = [0, 2, 3, 5, 7, 8, 10]
MAJOR = [0, 2, 4, 5, 7, 9, 11]
PROGRESSIONS = {
    "verse": [[0, 0, 8, 10], [0, 8, 3, 10], [0, 5, 8, 10], [0, 0, 5, 8]],
    "pre": [[5, 8, 10, 10], [8, 10, 5, 7], [8, 8, 10, 10]],
    "chorus": [[0, 8, 3, 10], [8, 10, 0, 0], [0, 10, 8, 10], [3, 10, 0, 8]],
    "bridge": [[8, 3, 10, 0], [5, 8, 10, 7]],
    "major": [[0, 7, 9, 5], [5, 7, 0, 0]],
}
RIFFS = ["x-x-P--xx-x-P-x-", "xx-xP-x-xx-xP-P-", "x--xx-P-x--xx-P-", "xxxxP-xxxxP-P-x-", "x-xxP-x-x-xxP---"]
ROOT = 38  # D2, the drop-D open string


def triad(root_pc: int, scale: list[int], base: int) -> list[int]:
    """Diatonic triad on a scale degree, as MIDI notes near `base`."""
    deg = min(range(7), key=lambda i: (scale[i] - root_pc) % 12)
    notes = [scale[(deg + s) % 7] + 12 * ((deg + s) // 7) for s in (0, 2, 4)]
    return [base + n for n in notes]


@dataclass
class Plan:
    kind: str
    energy: float
    drums: str  # none, war, metal, drive, half, hiphop, bounce, stomp, folk
    guitar: str  # none, riff, chords, halfchug
    vocal: str  # none, rap, sing, both, trade, gang
    female: bool
    whisper: bool
    choir: bool
    strings: bool
    tagel: bool
    drone: bool
    horn: bool
    lift: int
    major: bool
    fx: list[str]


def plan_section(track: Track, s: Section, idx: int, count: int) -> Plan:
    st = s.style.lower()
    tst = track.style.lower()
    name = s.name.lower()
    has = lambda *w: any(x in st for x in w)
    hiphop = any(x in tst for x in ("hip-hop", "boom-bap", "trap"))
    bounce = "bounce" in tst or "808" in tst
    doom = "doom" in tst or "crushing slow" in tst
    folk_track = "ballad" in tst or "folk" in tst
    no_lines = not s.lines or has("instrumental")

    if name.startswith("stop") or has("all instruments stop"):
        kind = "stop"
    elif ("hits" in st and name.startswith(("cold open", "outro"))) or (name.startswith("cold open") and not has("a cappella")):
        kind = "hits"
    elif (has("a cappella") or name.startswith("outro")) and has("stomp", "clap") and has("chant"):
        kind = "chant"
    elif "breakdown" in name:
        kind = "breakdown"
    elif "chorus" in name and "pre" not in name or "post-chorus" in name:
        kind = "chorus"
    elif "pre" in name:
        kind = "pre"
    elif "bridge" in name:
        kind = "bridge"
    elif "riff" in name:
        kind = "riff"
    elif "verse" in name:
        kind = "verse"
    elif "outro" in name and has("full band", "slam", "final riff", "hits", "gang shout", "stomps"):
        kind = "chorus" if s.lines else "riff"
    else:
        kind = "ambient"

    energy = {"ambient": 0.25, "verse": 0.65, "pre": 0.6, "chorus": 0.95, "breakdown": 0.9,
              "bridge": 0.45, "riff": 0.8, "hits": 1.0, "stop": 0.0, "chant": 0.6}[kind]
    if has("restrained", "sparse", "soft", "quiet", "intimate", "haunting", "tender", "warm"):
        energy -= 0.2
    if has("bigger", "biggest", "massive", "huge", "full impact", "crushing", "climactic", "heavier"):
        energy += 0.1
    energy = float(np.clip(energy, 0, 1))

    folky = (folk_track and has("folk", "intimate", "sparse", "soft")) or has("folk accompaniment")
    band = has("full band", "band enters", "full impact", "slam", "full ensemble")
    drops = has("drops to", "band drops out", "a cappella", "drops,", "music drops", "fades to", "thins to", "nearly a cappella")

    drums = "none"
    guitar = "none"
    if kind in ("verse", "riff"):
        drums = "bounce" if bounce else ("hiphop" if hiphop and "rap" in st else ("half" if doom else ("drive" if has("double-kick", "galloping") else "metal")))
        guitar = "riff"
    elif kind == "chorus":
        drums = "bounce" if bounce else ("half" if doom or has("slow") else "drive")
        guitar = "chords"
    elif kind == "pre":
        drums = "war" if not has("drums thin", "groove drops") else "none"
        guitar = "chords" if not has("drums thin", "groove drops") else "none"
    elif kind == "breakdown":
        drums, guitar = "half", "halfchug"
    elif kind == "bridge":
        drums, guitar = ("none", "none") if drops or has("alone") else ("war", "chords")
    elif kind == "hits":
        drums, guitar = "hits", "hits"
    elif kind == "chant":
        drums = "stomp"
    elif kind == "ambient":
        drums = "war" if has("drum", "toms") and not drops else "none"
    if folky and not band:
        drums, guitar = ("folk" if has("drum", "folk", "heartbeat", "building") else "none"), "none"
    if drops and kind not in ("hits",):
        drums, guitar = "none", "none"
        energy = min(energy, 0.35)
    if band and guitar == "none":
        guitar, drums = "chords", ("drive" if drums in ("none", "folk") else drums)
    if has("heartbeat"):
        drums = "folk"

    female = has("female") and not has("male baritone", "male lead", "male call")
    if has("male baritone", "male lead") and not has("female"):
        female = False
    if no_lines:
        vocal = "none"
    elif kind in ("hits", "chant") or (kind == "breakdown" and has("gang", "shout", "call")):
        vocal = "gang"
    elif has("trading", "alternating", "then male", "then both", "male and female", "then male joins"):
        vocal = "trade"
    elif kind == "chorus" or has("duet", "both voices", "harmony"):
        vocal = "both"
    elif has("rap", "half-rap"):
        vocal = "rap"
    else:
        vocal = "sing"

    fx = [w for w in ("wind", "raven", "rain", "bell", "coins", "thunder", "birdsong", "pages", "glass", "horn blast", "shatter", "pen") if w in st]
    return Plan(
        kind=kind, energy=energy, drums=drums, guitar=guitar, vocal=vocal, female=female,
        whisper=has("whisper"),
        choir=kind == "chorus" or has("choir", "hum"),
        strings=has("strings", "orchestra", "cinematic") or kind in ("pre", "chorus") and "strings" in (album_style_cache or ""),
        tagel=has("tagelharpa", "nyckelharpa", "bone flute") or (kind == "ambient" and not drops),
        drone=has("drone", "throat") or kind == "ambient",
        horn=has("horn") or (kind == "chorus" and ("horns" in tst or "orchestra" in tst or "cinematic" in tst)),
        lift=2 if has("key lift") else 0,
        major=has("major") or ("major" in tst and kind in ("chorus",)),
        fx=fx,
    )


album_style_cache = ""


class Mix:
    BUSES = ("drums", "gtrL", "gtrR", "bass", "keys", "vox", "fx")

    def __init__(self, seconds: float):
        self.n = int(seconds * RATE) + 6 * RATE
        self.bus = {b: np.zeros((self.n, 2), dtype=F32) for b in self.BUSES}

    def add(self, bus: str, at: float, x: np.ndarray, gain=1.0, pan=0.0):
        i = int(at * RATE)
        if i >= self.n or len(x) == 0:
            return
        x = x[: self.n - i] * gain
        l, r = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
        self.bus[bus][i : i + len(x), 0] += (x * l).astype(F32)
        self.bus[bus][i : i + len(x), 1] += (x * r).astype(F32)


def render_track(album: Album, track: Track) -> np.ndarray:
    global album_style_cache
    album_style_cache = album.style.lower()
    rng = np.random.default_rng(seed_of(album.title, track.number, track.title))
    m = re.search(r"(\d+)\s*BPM", track.style)
    bpm = float(m.group(1)) if m else 90.0
    beat = 60 / bpm
    bar = 4 * beat
    step = bar / 16
    riff = RIFFS[rng.integers(len(RIFFS))]
    prog = {k: v[rng.integers(len(v))] for k, v in PROGRESSIONS.items()}
    kit = {
        "kick": [kick(rng) for _ in range(3)], "snare": [snare(rng) for _ in range(3)],
        "hat": [hat(rng) for _ in range(4)], "ohat": hat(rng, True), "crash": crash(rng),
        "clap": clap(rng), "toms": [tom(rng, h) for h in (140, 105, 82, 64)],
        "war": [tom(rng, 52, 0.9) for _ in range(2)],
    }
    pick = lambda xs: xs[rng.integers(len(xs))]

    sections = []
    t = 0.0
    for i, s in enumerate(track.sections):
        bars = max(1, round(s.seconds / bar))
        if s.name.lower().startswith("stop"):
            bars = 1
        sections.append((t, bars, s, plan_section(track, s, i, len(track.sections))))
        t += bars * bar
    total = t
    mix = Mix(total)
    hooks: dict[str, list[int]] = {}

    for si, (t0, bars, s, p) in enumerate(sections):
        nxt = sections[si + 1][3] if si + 1 < len(sections) else None
        scale = MAJOR if p.major else MINOR
        key = ROOT + p.lift
        progression = prog["major"] if p.major else prog.get(p.kind if p.kind in prog else "verse", prog["verse"])
        chord_bars = 2 if bpm < 82 else 1
        chords = [progression[(b // chord_bars) % len(progression)] for b in range(bars)]
        e = p.energy
        dur = bars * bar

        # ---- ambience and colour
        if p.drone and p.kind != "stop":
            mix.add("keys", t0, throat_drone(key + 12, dur + 1.5, rng), 0.1 * (0.6 + e))
        for fx in p.fx:
            if fx == "wind":
                mix.add("fx", t0, wind(dur + 1, rng), 0.35, rng.uniform(-0.3, 0.3))
            elif fx == "rain":
                mix.add("fx", t0, rain(dur + 1, rng), 0.3)
            elif fx == "raven":
                for k in range(max(1, bars // 3)):
                    mix.add("fx", t0 + rng.uniform(0.3, dur - 0.5), raven(rng), 0.28, rng.uniform(-0.8, 0.8))
            elif fx == "bell":
                for b in range(0, bars, 2):
                    mix.add("fx", t0 + b * bar, bell(midi_hz(key + 24 + 12), rng), 0.3, -0.2)
            elif fx == "coins":
                for b in range(bars):
                    mix.add("fx", t0 + b * bar + rng.uniform(0, bar), coins(rng), 0.35, rng.uniform(-0.6, 0.6))
            elif fx in ("thunder", "horn blast"):
                mix.add("fx", t0, thunder(rng), 0.6)
                if fx == "horn blast" or "horn" in s.style.lower():
                    mix.add("keys", t0, horn(key + 12, bar * 1.5, rng), 0.35)
            elif fx == "birdsong":
                mix.add("fx", t0, birds(dur, rng), 0.4, 0.3)
            elif fx in ("pages", "pen"):
                for b in range(bars * 2):
                    mix.add("fx", t0 + b * beat * 2 + rng.uniform(0, beat), pages(rng), 0.35, rng.uniform(-0.5, 0.5))
            elif fx in ("glass", "shatter"):
                mix.add("fx", t0 + dur - bar, shatter(rng), 0.5)
        if "horn" in s.style.lower() and "horn blast" not in p.fx and p.kind in ("ambient",):
            mix.add("keys", t0 + bar * 0.5, horn(key + 12, bar * 2, rng), 0.3)
            mix.add("keys", t0 + bar * 0.5, horn(key + 19, bar * 2, rng), 0.2)

        if p.tagel and p.kind in ("ambient", "bridge", "verse", "pre") and not (p.kind == "verse" and p.guitar == "riff"):
            pent = [0, 3, 5, 7, 10, 12, 15]
            n_notes = bars * 2
            for k in range(n_notes):
                note = key + 24 + pent[int(abs(rng.normal(2, 1.8))) % len(pent)]
                mix.add("keys", t0 + k * bar / 2, bowed(note, bar / 2 + 0.2, rng, gliss=rng.choice([0, 0, -2, 2])), 0.16, 0.25)
            mix.add("keys", t0, bowed(key + 12, dur, rng), 0.08, -0.25)

        chord_gain = 0.6 + 0.5 * e
        if p.strings or p.kind in ("chorus", "pre", "bridge") or (p.kind == "ambient" and "choir" not in s.style.lower() and "strings" in s.style.lower()):
            for b in range(0, bars, chord_bars):
                notes = triad(chords[b] % 12, scale, key + 24)
                mix.add("keys", t0 + b * bar, ensemble(notes + [notes[0] - 12], bar * chord_bars + 0.3, rng, attack=0.3 if p.kind == "chorus" else 0.8), 0.13 * chord_gain)
        if p.choir and p.kind != "stop":
            for b in range(0, bars, chord_bars):
                notes = triad(chords[b] % 12, scale, key + 24)
                vowel = "oo" if p.kind == "ambient" or "hum" in s.style.lower() else ("ah" if b % 4 < 2 else "oh")
                for ni, nt in enumerate(notes + [notes[0] + 12]):
                    fem = ni >= 2
                    for v in range(2):
                        x = voice_note(midi_hz(nt), midi_hz(nt), bar * chord_bars + 0.2, vowel, fem, rng, breath=0.08)
                        mix.add("keys", t0 + b * bar + rng.uniform(0, 0.03), x * ramp_env(len(x), 0.25, 0.3), 0.05 * chord_gain, rng.uniform(-0.7, 0.7))
        if p.horn and p.kind == "chorus":
            for b in range(0, bars, 2):
                r = chords[b] % 12
                mix.add("keys", t0 + b * bar, horn(key + 12 + r, bar * 2, rng), 0.16)

        # ---- guitars and bass
        def gchord(at, pc, length, mute, g=1.0, pedal=False):
            root = key + (0 if pedal else (pc if pc < 7 else pc - 12))
            if not pedal and root < key:
                root += 12
            fr = [midi_hz(root), midi_hz(root + 7), midi_hz(root + 12)]
            for side, pan in (("gtrL", -0.85), ("gtrR", 0.85)):
                jitter = abs(rng.normal(0, 0.004))
                mix.add(side, at + jitter, guitar(fr, length, rng, mute), 0.23 * g, pan)
            mix.add("bass", at, bass(midi_hz(root - 12), length, mute), 0.16 * g)

        if p.guitar == "riff":
            for b in range(bars):
                for i, c in enumerate(riff):
                    if c == "-":
                        continue
                    at = t0 + b * bar + i * step
                    if c == "x":
                        gchord(at, 0, step * 0.95, True, 0.8 + 0.3 * e, pedal=True)
                    else:
                        gap = next((j for j, ch in enumerate(riff[i + 1 :] + "x") if ch != "-"), 0) + 1
                        gchord(at, chords[b], max(gap, 2) * step, False, 0.9 + 0.2 * e)
        elif p.guitar == "chords":
            for b in range(bars):
                if p.kind == "pre" or e < 0.6:
                    gchord(t0 + b * bar, chords[b], bar, False, 0.7 + 0.3 * e)
                else:
                    for k in range(8):
                        gchord(t0 + b * bar + k * bar / 8, chords[b], bar / 8, k % 2 == 1, 0.9 + 0.2 * e)
        elif p.guitar == "halfchug":
            for b in range(bars):
                for i in (0, 1, 3, 6, 7, 10, 12, 13):
                    gchord(t0 + b * bar + i * step, 0, step * 0.9, True, 1.1, pedal=True)
                gchord(t0 + b * bar + 14 * step, chords[b], step * 2, False, 1.0)
        elif p.guitar == "hits":
            pass  # handled with the vocal hits below

        # ---- drums
        def hit(name, at, g, pan=0.0):
            src = kit[name]
            x = src[rng.integers(len(src))] if isinstance(src, list) else src
            mix.add("drums", at, x, g * rng.uniform(0.85, 1.0), pan)

        for b in range(bars):
            bt = t0 + b * bar
            last = b == bars - 1
            fill = last and nxt is not None and nxt.energy > e and p.drums not in ("none", "folk", "stomp", "hits")
            if p.drums in ("metal", "drive", "half", "hiphop", "bounce") and b % 4 == 0 and e > 0.55:
                hit("crash", bt, 0.35)
            if p.drums == "metal":
                for i, c in enumerate(riff):
                    if c != "-":
                        hit("kick", bt + i * step, 0.9)
                for i in (4, 12):
                    hit("snare", bt + i * step, 0.75)
                for i in range(0, 16, 2):
                    hit("hat", bt + i * step, 0.18, 0.3)
            elif p.drums == "drive":
                for i in range(0, 16, 1 if e > 0.9 else 2):
                    hit("kick", bt + i * step, 0.75)
                for i in (4, 12):
                    hit("snare", bt + i * step, 0.8)
                for i in range(0, 16, 2):
                    hit("ohat" if i % 4 == 2 else "hat", bt + i * step, 0.16, 0.3)
            elif p.drums == "half":
                for i in (0, 3, 10):
                    hit("kick", bt + i * step, 0.95)
                hit("snare", bt + 8 * step, 0.9)
                for i in range(0, 16, 4):
                    hit("ohat", bt + i * step, 0.14, 0.3)
            elif p.drums == "hiphop":
                for i in (0, 7, 10):
                    hit("kick", bt + i * step, 0.9)
                    mix.add("drums", bt + i * step, eight08(midi_hz(key - 12 + (chords[b] if chords[b] < 7 else chords[b] - 12)), step * 3), 0.2)
                for i in (4, 12):
                    hit("snare", bt + i * step, 0.8)
                for i in range(16):
                    hit("hat", bt + i * step, 0.13 if i % 2 else 0.18, 0.35)
                if b % 2 == 1:
                    for k in range(6):
                        hit("hat", bt + 14 * step + k * step / 3, 0.1, 0.35)
            elif p.drums == "bounce":
                for i in (0, 3, 6, 10, 13):
                    mix.add("drums", bt + i * step, eight08(midi_hz(key - 12 + (chords[b] if chords[b] < 7 else chords[b] - 12)), step * 2.8), 0.28)
                    hit("kick", bt + i * step, 0.55)
                for i in (4, 12):
                    hit("clap", bt + i * step, 0.55)
                    hit("snare", bt + i * step, 0.4)
                for i in range(0, 16, 2):
                    hit("hat", bt + i * step, 0.16, 0.3)
            elif p.drums == "war":
                for i in (0, 6, 8, 12) if e > 0.3 else (0, 8):
                    hit("war", bt + i * step, 0.8)
                if p.kind == "pre":
                    for i in (4, 12):
                        hit("toms", bt + i * step, 0.4, -0.3)
            elif p.drums == "folk":
                for i in (0, 8) if b % 2 else (0, 6, 8):
                    hit("war", bt + i * step, 0.45)
            elif p.drums == "stomp":
                for half in (0, 8):
                    hit("war", bt + half * step, 0.8)
                    hit("war", bt + (half + 2) * step, 0.8)
                    hit("clap", bt + (half + 4) * step, 0.8)
            if fill:
                for k in range(8):
                    mix.add("drums", bt + (8 + k) * step, kit["toms"][min(k // 2, 3)], 0.6, -0.4 + k * 0.1)
            if p.kind == "ambient" and "one by one" in s.style.lower():
                for i in range(0, 16, max(1, 8 >> min(b, 3))):
                    hit("war", bt + i * step, 0.25 + 0.5 * b / bars)
        if nxt is not None and p.kind == "pre" and nxt.kind == "chorus":
            mix.add("fx", t0 + dur - bar, riser(bar, rng), 0.3)

        # ---- voice
        if p.vocal == "none" or not s.lines:
            continue
        lines = s.lines
        slot = dur / len(lines)
        if p.kind in ("hits",):
            # one full-band stab per line on syncopated steps
            spots = [0, 3, 6, 10, 12, 14, 16 + 2, 16 + 6]
            for li, line in enumerate(lines):
                at = t0 + spots[li % len(spots)] * step * (bars * 16 / 16 if bars > 1 else 1)
                gchord(at, 0, beat * 0.9, False, 1.2, pedal=True)
                hit("kick", at, 1.0)
                hit("crash", at, 0.45)
                gang(mix, at, line, beat * 0.8, key, rng, female_too=True)
            continue
        for li, line in enumerate(lines):
            at = t0 + li * slot
            syl = syllables(line)
            shout = line.isupper() or (line.endswith("!") and len(line.split()) <= 6)
            if p.vocal == "gang" or (shout and p.kind in ("chorus", "breakdown", "chant")):
                gang(mix, at, line, slot * 0.9, key, rng, female_too=True, step=max(step * 2, min(beat, slot * 0.8 / len(syl))))
                if p.vocal == "gang":
                    continue
            female = p.female
            if p.vocal == "trade":
                female = li % 2 == 0 if "female" in s.style.lower().split("male")[0] else li % 2 == 1
            if p.vocal == "rap":
                sing_line(mix, at, line, syl, slot, "rap", female, key, chords, t0, bar, scale, rng, hooks, p.whisper, step)
            else:
                mode = "sing"
                sing_line(mix, at, line, syl, slot, mode, female, key, chords, t0, bar, scale, rng, hooks, p.whisper, step)
                if p.vocal == "both":
                    sing_line(mix, at, line, syl, slot, mode, not female, key, chords, t0, bar, scale, rng, hooks, p.whisper, step, gain=0.6)

    return master(mix, total)


def gang(mix: Mix, at: float, line: str, length: float, key: int, rng, female_too=True, step=None):
    syl = syllables(line)
    stp = step or length / max(len(syl), 1)
    for k, (vowel, onset) in enumerate(syl):
        for v in range(8):
            fem = female_too and v % 3 == 0
            base = midi_hz(key + (19 if fem else 7) + rng.normal(0, 0.6))
            x = voice_note(base * 1.08, base, stp * 0.8, vowel, fem, rng, vibrato=False, breath=0.35, onset=onset)
            x = np.tanh(3 * x)
            mix.add("vox", at + k * stp + rng.uniform(0, 0.02), x, 0.1, rng.uniform(-0.8, 0.8))


def sing_line(mix, at, line, syl, slot, mode, female, key, chords, t0, bar, scale, rng, hooks, whisper, step, gain=1.0):
    n = len(syl)
    if mode == "rap":
        stp = min(step, slot * 0.92 / n)
        lens = [stp * 0.85] * n
    else:
        base = max(step * 2, min(bar / 4, slot * 0.8 / n))
        stp = min(base, slot * 0.85 / n)
        lens = [stp * 0.95] * n
        lens[-1] = max(stp, slot * 0.9 - stp * (n - 1))
    reg = key + (24 if female else 12)  # D4 / D3
    # The melody is keyed on the line's text so a repeated line repeats its tune.
    key_ = line.lower().strip(" !.,")
    if key_ not in hooks:
        lrng = np.random.default_rng(seed_of(key_))
        if mode == "rap":
            degrees = [int(lrng.choice([0, 0, 1, 2, -1])) for _ in range(n)]
        else:
            shape = lrng.choice(["arch", "rise", "fall", "wave"])
            steps = []
            d = int(lrng.choice([0, 2, 4]))
            for i in range(n):
                if shape == "arch":
                    d += 1 if i < n / 2 else -1
                elif shape == "rise":
                    d += int(lrng.choice([0, 1, 1]))
                elif shape == "fall":
                    d -= int(lrng.choice([0, 1, 1]))
                else:
                    d += int(lrng.choice([-1, 1, 2, -2]))
                d = max(-2, min(9, d))
                steps.append(d)
            degrees = steps
        hooks[key_] = degrees
    degrees = hooks[key_]
    prev = None
    for k, ((vowel, onset), ln) in enumerate(zip(syl, lens)):
        tt = at + k * stp
        d = degrees[k % len(degrees)]
        midi = reg + scale[d % 7] + 12 * (d // 7)
        if mode == "rap":
            midi = reg - 2 + [0, 2, 3, 5, -2][d % 5] * 0.5
            if k == n - 1:
                midi -= 2
        f = midi_hz(midi)
        x = voice_note(prev or f, f, ln, vowel, female, rng, vibrato=mode != "rap", breath=0.12 if mode == "rap" else 0.05,
                       onset=onset, whisper=whisper)
        if mode == "rap":
            x = np.tanh(2.2 * x)
        mix.add("vox", tt, x, (0.34 if mode == "rap" else 0.28) * gain, -0.1 if female else 0.1)
        prev = f if mode != "rap" else None


def master(mix: Mix, total: float) -> np.ndarray:
    b = {k: v.astype(np.float64) for k, v in mix.bus.items()}
    cab = fir(lambda f: bp_gain(120, 6500, 2)(f) * (1 - 0.4 * np.exp(-((f - 400) / 200) ** 2)) * (1 + 1.2 * np.exp(-((f - 2400) / 1100) ** 2)))
    for g in ("gtrL", "gtrR"):
        for c in range(2):
            b[g][:, c] = fir_filter(b[g][:, c], cab)
    lowcut = fir(lambda f: bp_gain(38, 0, 2)(f) * (0.55 + 0.45 * np.clip((f - 60) / 140, 0, 1)) * (1 + 0.6 * np.exp(-((f - 3000) / 1800) ** 2)))
    dry = b["drums"] + b["gtrL"] + b["gtrR"] + b["bass"] + b["keys"] + b["vox"] + b["fx"]
    # One hall: stereo exponential-noise tail, darker as it decays.
    rng = np.random.default_rng(7)
    ir_n = int(2.6 * RATE)
    tt = np.arange(ir_n) / RATE
    send = 0.10 * b["drums"] + 0.05 * (b["gtrL"] + b["gtrR"]) + 0.5 * b["keys"] + 0.3 * b["vox"] + 0.4 * b["fx"]
    wet = np.zeros_like(dry)
    for c in range(2):
        ir = spectral(rng.uniform(-1, 1, ir_n), bp_gain(150, 5000)) * np.exp(-tt / 0.55)
        ir[: int(0.02 * RATE)] = 0
        ir /= np.sqrt(np.sum(ir**2))
        wet[:, c] = convolve(send[:, c], ir)[: len(dry)]
    x = dry + 0.35 * wet
    for c in range(2):
        x[:, c] = fir_filter(x[:, c], lowcut)
    # Bus compressor: 10 ms RMS, 4:1 over threshold, 5 ms attack / 150 ms release.
    blk = 480
    nb = len(x) // blk
    mono = np.abs(x[: nb * blk]).mean(axis=1).reshape(nb, blk)
    rms = np.sqrt((mono**2).mean(axis=1)) + 1e-9
    thr = np.percentile(rms, 70) * 0.9
    target = np.minimum(1.0, (thr / rms) ** 0.75)
    g = np.empty(nb)
    acc = 1.0
    for i in range(nb):
        coef = 0.6 if target[i] < acc else 0.06
        acc += coef * (target[i] - acc)
        g[i] = acc
    gain = np.interp(np.arange(len(x)), np.arange(nb) * blk + blk / 2, g)
    x *= gain[:, None]
    end = int(total * RATE + 2.5 * RATE)
    x = x[:end]
    tail = int(2.5 * RATE)
    x[-tail:] *= np.linspace(1, 0, tail)[:, None] ** 2
    x /= np.max(np.abs(x)) + 1e-9
    return np.tanh(1.6 * x) / np.tanh(1.6) * 0.97


def write_wav(path: str, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def encode(album: Album, track: Track, wav: str, mp3: str, year: int) -> None:
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-i", wav,
        "-af", "loudnorm=I=-11:TP=-1.0:LRA=9", "-ar", str(RATE),
        "-c:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "3",
        "-metadata", f"title={track.title}", "-metadata", f"artist={ARTIST}",
        "-metadata", f"album_artist={ARTIST}", "-metadata", f"album={album.title}",
        "-metadata", f"track={track.number}/{len(album.tracks)}", "-metadata", "genre=Viking Metal / Hip-Hop",
        "-metadata", f"date={year}", "-metadata", f"lyrics-eng={tagged_lyrics(track)}",
        "-metadata", f"comment=synthesised by tools/music/synth_album.py, seed {seed_of(album.title, track.number, track.title)}",
        mp3,
    ], check=True)


def job(args):
    sheet, number, year = args
    album = parse_album(open(sheet, encoding="utf-8").read())
    track = next(t for t in album.tracks if t.number == number)
    masters = os.path.join(REPO, "build", "music-wav", album.title)
    out = os.path.join(REPO, "apps", "game", "public", "audio", "music", ARTIST, album.title)
    os.makedirs(masters, exist_ok=True)
    os.makedirs(out, exist_ok=True)
    x = render_track(album, track)
    wav = os.path.join(masters, stem(track) + ".wav")
    write_wav(wav, x)
    encode(album, track, wav, os.path.join(out, stem(track) + ".mp3"), year)
    return f"{stem(track)}  {len(x) / RATE:.0f}s"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--only", type=int, action="append")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--suno", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--year", type=int, default=2026)
    a = ap.parse_args()
    album = parse_album(open(a.sheet, encoding="utf-8").read())
    assert album.tracks and [t.number for t in album.tracks] == list(range(1, len(album.tracks) + 1)), "tracks must be numbered 1..N"
    for t in album.tracks:
        plans = [plan_section(t, s, i, len(t.sections)).kind for i, s in enumerate(t.sections)]
        print(f"{stem(t)}: {' '.join(plans)}")
    if a.suno:
        d = os.path.join(os.path.dirname(a.sheet), "suno")
        os.makedirs(d, exist_ok=True)
        for t in album.tracks:
            with open(os.path.join(d, stem(t) + ".txt"), "w", encoding="utf-8") as f:
                f.write(f"STYLE:\n{album.style}, {t.style}\n\nEXCLUDE:\n{album.avoid}\n\nLYRICS:\n{tagged_lyrics(t)}\n")
    if a.check:
        return
    numbers = a.only or [t.number for t in album.tracks]
    with Pool(a.jobs) as pool:
        for msg in pool.imap_unordered(job, [(a.sheet, n, a.year) for n in numbers]):
            print(msg, flush=True)
    out = os.path.join(REPO, "apps", "game", "public", "audio", "music", ARTIST, album.title)
    present = [stem(t) + ".mp3" for t in album.tracks if os.path.exists(os.path.join(out, stem(t) + ".mp3"))]
    with open(os.path.join(out, "playlist.m3u"), "w", encoding="utf-8") as f:
        f.writelines(f"./{p}\n" for p in present)
    print(f"{len(present)}/{len(album.tracks)} tracks in {out}")


if __name__ == "__main__":
    main()
