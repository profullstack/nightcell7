# Content, culture and provenance standards

Episode 1 is set during a fictional near-future crisis in Iran. The standards
below are **P0** (PRD §32) — not polish, not launch-blocking-in-theory.

## Non-negotiable

- An Iranian or Iranian-diaspora cultural consultant reviews the theater.
- Native Farsi review of all dialogue, subtitles and signage, including writing
  direction, shaping, line height and punctuation.
- All sites, institutions, units and operations are fictional.
- No current real-world leaders, no direct recreation of a current conflict, no
  real terrorist organizations, no religious caricature.
- No combat in sacred sites. No exact replicas of real sensitive facilities.
- Civilians are never targets or spectacle.
- Nationality never equals enemy. Both sides have competent, sympathetic
  characters and defensible motives.
- Ethnicity, language or skin tone can never be the sole target-identification
  cue in gameplay.
- No technical detail that functions as a real operational tutorial. MIRAGE is
  deliberately fictional.
- Marketing art is tested for propaganda-like framing before publication.
- The fiction disclaimer appears in-game and on the site.

## Farsi content status

**Pending native review.** Do not ship Farsi strings, signage textures or voice
lines to a public build before that review completes (CLAUDE.md).

## Asset provenance gate

Nothing enters public content without a provenance record capturing: source,
provider, URL, date, license snapshot, commercial rights, modification rights,
**browser distribution rights**, attribution requirements, AI restrictions,
prompt/reference ownership, the raw and production files, the reviewer and the
approval.

Browser files are inherently obtainable by users. Compression and obfuscation
do not create distribution rights — if a license does not permit web
distribution, the asset cannot ship, regardless of packaging.

### Production flow

```
brief -> acquire or generate raw source -> preserve raw file + license
      -> Blender import, repair scale/transforms/normals/topology
      -> UV + PBR materials -> collision, LODs, sockets
      -> contact sheet -> HUMAN APPROVAL
      -> GLB export -> KTX2 compression -> validation -> manifest
```

Conventions (CLAUDE.md): one Blender metre equals one game metre; colliders are
`COL_`; sockets are `SOCKET_`; every weapon has `SOCKET_MUZZLE`; raw assets are
never overwritten.

### Audio

WAV masters at 48 kHz/24-bit, compressed WebM/Opus at runtime with MP3 fallback,
no public WAV masters. High-frequency events need six variations, lower-frequency
at least three. Never clone a real voice without permission. Do not train on
licensed libraries where the license forbids it.

## MCP safety

Treat MCP servers as executable code: pin versions, prefer provider-maintained
or audited servers, restrict the filesystem, keep release secrets unavailable,
use a dedicated workspace, snapshot before bulk edits, and convert successful
MCP operations into deterministic scripts. Never allow automated purchasing or
publishing without explicit human approval.
