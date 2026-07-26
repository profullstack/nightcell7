# Audio provenance

Every clip here is **synthesised** by `tools/art/audio/generate.py`. Nothing is
sampled, recorded, downloaded or licensed, so the whole set satisfies
CLAUDE.md's provenance rule: the provenance of any clip is a commit, a script
and a seed.

## How to rebuild

```sh
pnpm assets:build --audio-only
```

Runs under Blender's bundled Python (it already has numpy), so there is no pip
dependency.

## WAV masters, compressed runtime audio

CLAUDE.md requires WAV masters. The generator writes 48 kHz 16-bit mono WAVs to
`build/audio-wav/`; the build encodes the shipped MP3s and deletes the masters.
They are **not committed** because they are exactly reproducible from the
generator — committing them would be storing a build artefact.

MP3 rather than Opus-in-WebM: `decodeAudioData` handles MP3 identically across
every browser we support, and at these clip lengths the codec difference is a
few kilobytes.

## Variations

CLAUDE.md: _repeated sounds require variations._ Anything the player can
trigger more than once a second is generated as several seeded variants, and
`GameAudio` never plays the same variant twice in a row — pure random repeats
about one time in `n`, and a repeated gunshot is precisely the artefact
variations exist to prevent.

| Clip                               | Variants | Notes                                                                                                        |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `fire_01..04`                      | 4        | Carbine report: muzzle blast, supersonic crack, low body, gated tail with a slap-back off the perimeter wall |
| `step_concrete_01..05`             | 5        | Short, dry, mid-heavy                                                                                        |
| `step_grating_01..04`              | 4        | Adds decaying metallic partials — a real gameplay cue that someone is on the catwalk or gantry               |
| `impact_concrete_01..04`           | 4        | Tick, dust, debris tail                                                                                      |
| `reload`                           | 1        | Three mechanical events: magazine out, magazine seated, bolt forward                                         |
| `ui_hover`, `ui_click`, `ui_error` | 1 each   | Cold and mechanical, matching DIVIDED SIGNAL. Nothing musical                                                |
| `ambience_yard`                    | 1        | 11.6 s seamless loop: wind, 50 Hz lamp hum, distant plant drone                                              |

## Notes on the synthesis

- A gunshot is built as four layers because that is roughly how a real report
  is structured. The **attack is the sound** — an early version applied a
  symmetric 3 ms fade to avoid clicks, which landed directly on the transient
  and cost 20 % of the peak. Fades are now asymmetric.
- `ambience_yard` is crossfaded tail-over-head so it loops without a seam
  (measured discontinuity: 0.0005). An ambience bed that clicks every few
  seconds is worse than no ambience.
- Levels are conservative. Footsteps peak around 0.55 and UI around 0.3
  against gunfire at 0.89, so the mix has headroom and nothing needs ducking.

## Licence

Original work, © NIGHTCELL 7. No third-party audio, no sampled material, and
nothing produced by a generative audio model.
