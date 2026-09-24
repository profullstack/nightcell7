# Audio provenance

Every effect and ambience clip here is **synthesised** by
`tools/art/audio/generate.py`. Nothing is sampled, recorded, downloaded or
licensed, so the set satisfies CLAUDE.md's provenance rule: the provenance of
any clip is a commit, a script and a seed. The squad radio in `comms/` is the
one exception, and has its own section at the end.

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
first album's style: drop-D Viking metal crossed with hip-hop. Like the first
album, the audio is our own custom music **made with Suno** by the project
owner and delivered on 2026-09-23, so each MP3's comment tag says
"made with suno" and its `lyrics-eng` tag holds the lyrics. Not licensed from a
third party, so there is no external licence and no attribution obligation.

The lyrics and a style direction per section come from the lyric sheet
`docs/music/when-the-ravens-lied/album.md`. The paste-ready Suno sheets it was
made from are in `docs/music/when-the-ravens-lied/suno/`, written by
`tools/music/synth_album.py --suno`.

A first cut of the album, synthesised entirely by that script (numpy, formant
voice), shipped briefly in #75 and was replaced by these Suno recordings the
same day. The script can still render a code-only version:

```sh
python3 tools/music/synth_album.py docs/music/when-the-ravens-lied/album.md --jobs 3
```

The game plays both albums as one shuffle bag (`shuffledOrder` in
`src/audio.ts`): a random song from either album, every track once before any
repeats, never the same song twice in a row.

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

## `comms/<side>/*.mp3`: the squad radio

Callouts, orders and chatter on each side's radio net, played by
`apps/game/src/comms.ts` (what is said and when) through `GameAudio.transmit`.

- **Script:** `apps/game/src/comms-lines.json`, written for this game. Every
  unit, callsign and place is fictional; the areas are Ardavan Yard's own.
  English only on both sides: Farsi voice lines wait for native review
  (`docs/content-and-culture.md`), so the Directorate net is heard in English
  by convention, with no put-on accent.
- **Voices:** AI speech from OpenAI's text-to-speech API (`gpt-4o-mini-tts`,
  stock voices with a written direction per speaker, recorded in the
  catalogue). No real person's voice is cloned or imitated. OpenAI's usage
  policies require that listeners are told the voices are AI-generated; the
  credits page says so.
- **Masters:** `docs/audio/comms/raw/<side>/<id>.flac`, exactly as delivered
  and never overwritten. Unlike the synthesised effects these cannot be
  regenerated bit for bit, so the master is committed and is the record.
  `docs/audio/comms/manifest.json` holds the model, voice, direction, text,
  date and sha256 of each.
- **Radio treatment:** `tools/audio/comms/generate.mjs` runs each master
  through ffmpeg: silence trimmed, band-limited to 350 Hz to 3.2 kHz,
  compressed, soft-clipped, with channel hiss under the voice, a key-up click
  before it and a squelch tail after. Callsigns have no tail and addressed
  orders no key-up, so "Rook," and "push the hardpoint" play as one
  transmission. Output is 24 kHz mono MP3 at 48 kbps: 232 clips (116 a side),
  about 4.6 MB for both sides, and only the player's side (about 2.3 MB) is
  loaded, after the first deploy rather than in the boot budget.
- **Takes:** every area callout has four takes, every combat reaction four to
  six, every order two, and there are 28 chatter lines a side. `comms.ts` draws
  takes from a shuffle bag, so each plays once before any repeats and none plays
  twice running.
- **Checked by transcription:** `node tools/audio/comms/check.mjs --transcribe`
  runs every processed clip back through speech-to-text and compares it with the
  script. Two lines that did not survive the radio treatment ("They're at our
  gate" heard as "Bear at our gate") were reworded and regenerated.
- **Captions:** every order and callout is also captioned on screen
  (accessibility is P0), with the speaker's role.
- **Licence:** OpenAI's terms assign the output to us, with commercial use
  permitted.
