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
| `explosion_01..03`                 | 3        | Grenade detonation: high crack, a 58 Hz body that falls in pitch, and a long dark debris tail                |
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

The album **_After the Winter of Want_** by **Þrøngva**: our own custom music,
made for this game and committed by the project owner on 2026-09-23 (commit
`1356cc1`). Not licensed from a third party, so there is no external licence
to comply with and no attribution obligation; the credit is for the record.

Laid out as `music/<artist>/<album>/<song>.mp3`, exactly as delivered, with the
album's own `playlist.m3u` beside it. The licence and attribution belong to the
artist, and a folder per artist is where a reader looks for that. It also keeps
music out of the download-budget guard by directory rather than by a filename
pattern, which once silently under-counted.

| #   | Title                             |
| --- | --------------------------------- |
| 001 | Frost on the Oar                  |
| 002 | Runes On Ice                      |
| 003 | Ironwood Oath                     |
| 004 | Storm Crown Oath                  |
| 005 | Wake the Sun                      |
| 006 | Hammer the Dawn                   |
| 007 | Fire in Every Hall                |
| 008 | Raise the Floor                   |
| 009 | Cut the Clock                     |
| 010 | Good as New                       |
| 011 | Dawn Without Masters              |
| 012 | Let the Morning In                |
| 013 | More Than Enough                  |
| 014 | The Wolf Called Want              |
| 015 | The Wolf Called Want (Part 2)     |
| 016 | When the Last Coin Falls          |
| 017 | Storm Crown Oath (second version) |
| 018 | When the Last Coin Falls (Part 2) |
| 019 | Valhalla Bounce                   |
| 20  | Valhalla on Loop                  |

The table is a record, not a registry: the playlist is discovered by walking
this directory (`apps/game/vite-plugin-soundtrack.ts`), album folders included,
so adding a track is dropping the file in. The title is the filename as
authored with the album's track number (`001. `) removed; both rules are
covered by `apps/game/src/audio.test.ts`, which also checks that all 20 tracks
are found.

Streamed by an `<audio>` element on demand and deliberately outside the 15 MB
shell budget (PRD §30): the game is playable before a note arrives. The PWA
service worker does not precache it.

### Second album: _When the Ravens Lied_

Twelve tracks by **Þrøngva** in `music/Þrøngva/When the Ravens Lied/`, in the
first album's style: drop-D Viking metal crossed with hip-hop. Unlike the first
album, every note is **synthesised by code**, the same way as the effects
above: `tools/music/synth_album.py` (numpy and ffmpeg, nothing sampled, no
generative audio model). Its provenance is a commit, the script and a seed per
track, and the seed is written into each file's comment tag.

The source is the lyric sheet `docs/music/when-the-ravens-lied/album.md`,
which holds the concept, every lyric, and a tempo and style direction for each
section. The script arranges each section from that direction. It plays a
drop-D riff with the kick doubling it, boom-bap or 808 bounce drums on the
hip-hop tracks, choir, strings, tagelharpa, a throat-singing drone, horns, and
the effects the sheet names. The voice is formant synthesis driven by the
lyrics, one note per syllable on that syllable's vowel. It follows the words'
rhythm but is not intelligible speech, so the lyrics also ride in each MP3's
`lyrics-eng` tag.

Output is a 48 kHz WAV master in `build/music-wav/`, which is not committed,
and a 320 kbps, 48 kHz MP3 at about -10 LUFS. To rebuild:

```sh
python3 tools/music/synth_album.py docs/music/when-the-ravens-lied/album.md --jobs 3
```

The `--suno` flag writes paste-ready Suno sheets to
`docs/music/when-the-ravens-lied/suno/`, the path the first album took, for a
sung version later.

| #   | Title                      |
| --- | -------------------------- |
| 001 | Huginn Brings the Word     |
| 002 | Who Fired First            |
| 003 | Loki's Mirror              |
| 004 | Merchant of the Long Knife |
| 005 | Ledger of Ash              |
| 006 | Heimdall Does Not Sleep    |
| 007 | Same Rain on Both Shields  |
| 008 | Lower the Spear            |
| 009 | Muninn Remembers           |
| 010 | Longship Bounce            |
| 011 | Not Our Ragnarök           |
| 012 | True Dawn                  |

### Removed: the earlier `music/throngva/` set

Seven earlier files in `music/throngva/` were deleted on 2026-09-23 at the
project owner's instruction, because they were not our music. Four of them
(`frost-on-the-oar`, `runes-on-ice`, `ironwood-oath`, `storm-crown-oath`) were
byte-identical to album tracks 001 to 004, so those songs remain, from the
album. The other three (`More Than Enough`, `the-wolf-called-want`,
`the-wolf-called-want-part-2`) differed from the album's versions and are gone.

The published trailer's soundtrack is Ironwood Oath. Its source file was one of
the byte-identical four, so the film already carries album track 003 and was
not re-rendered; `tools/art/trailer.mjs` now reads it from the album.
