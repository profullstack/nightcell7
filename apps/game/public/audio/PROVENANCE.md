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

## Music

Original work by **Þrøngva**, written for this game by the project owner. Not
licensed from a third party, so there is no external licence to comply with and
no attribution obligation — the credit below is for the record.

Laid out as `music/<artist>/<song>.mp3`. The licence and attribution belong to
the artist rather than to each file, and a folder per artist is where a reader
looks for that. It also removed a real bug: the download-budget guard used to
exclude music by a `^music_` filename pattern, which silently under-counted the
moment a track arrived under its own name and put 22 MB of songs inside a 6 MB
guard. A directory cannot be misspelt into the wrong bucket.

| File                                             | Title                         |
| ------------------------------------------------ | ----------------------------- |
| `music/throngva/frost-on-the-oar.mp3`            | Frost on the Oar              |
| `music/throngva/runes-on-ice.mp3`                | Runes on Ice                  |
| `music/throngva/ironwood-oath.mp3`               | Ironwood Oath                 |
| `music/throngva/storm-crown-oath.mp3`            | Storm Crown Oath              |
| `music/throngva/the-wolf-called-want.mp3`        | The Wolf Called Want          |
| `music/throngva/the-wolf-called-want-part-2.mp3` | The Wolf Called Want (Part 2) |

Streamed by an `<audio>` element on demand and deliberately outside the 15 MB
shell budget (PRD §30): the game is playable before a note arrives.
