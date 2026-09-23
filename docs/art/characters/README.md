# Cast portraits: provenance

Painted head-and-shoulders portraits of the six named characters in
`packages/game-core/src/cast.ts` plus the two protagonists: Rook, Leila Farzan,
Jonas Vale, Director Mara Vey, Colonel Arman Daryan and Silas Kade.

| Field                     | Record                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                    | Generated for this project. Not traced, not sourced from another game, not a photograph of a real person.                                                                        |
| Provider                  | OpenAI Images API, model `gpt-image-2`, 1024 × 1536, quality `high`.                                                                                                             |
| Date                      | 2026-09-23 (per-image timestamps in `manifest.json`).                                                                                                                            |
| Prompts                   | `tools/art/portraits/prompts.json`: one shared style block plus one line per person. The exact prompt each image was made from is stored beside its hash in `manifest.json`.     |
| Generator                 | `node tools/art/portraits/generate.mjs [--only id,id] [--derive-only]`. Needs `OPENAI_API_KEY` and ffmpeg.                                                                       |
| Raw files                 | `docs/art/characters/raw/<id>.png`, never overwritten by the script. To remake one, move its master aside and rerun with `--only`.                                               |
| Production files          | `apps/site/public/media/characters/<id>.webp` (600 × 900, q86) and `apps/game/public/assets/portraits/<id>.webp` (214 × 320, q82), both derived from the raw master with ffmpeg. |
| Commercial / modification | OpenAI's terms assign output to the user, with commercial use and modification permitted. No third-party reference images were supplied.                                         |
| Browser distribution      | Permitted: original output, no licence restricts web distribution.                                                                                                               |
| Attribution               | None required.                                                                                                                                                                   |
| AI disclosure             | These are AI-generated images. Any storefront that asks (Steam does) must disclose them.                                                                                         |

## Review

- **Real-person likeness.** The first Daryan render closely resembled a
  well-known real Iranian general. CLAUDE.md and `docs/content-and-culture.md`
  forbid depicting current real-world figures, so it was rejected and not kept
  in the repository. His prompt now describes a different face (clean-shaven,
  glasses, a staff officer) and says he must not resemble a public figure. The
  second attempt drifted away from an Iranian appearance and was also
  rejected. The shipped image is the third.
- **Propaganda framing.** Every prompt asks for a calm, dignified, un-heroic
  portrait, with no flags, insignia, religious symbols, text or weapons aimed at
  the viewer. The two protagonists share one composition and lighting recipe,
  so neither side is shown as the richer or more heroic one (PRD §14.3).
- **Cultural review: pending.** Leila's and Daryan's portraits depict Iranian
  characters and go to the Iranian cultural consultant with the rest of the
  theatre (`docs/content-and-culture.md`). Leila wears a plain headscarf, which
  is accurate for an officer on duty; the consultant has the final word.

## Why not Blender

A realistic 3D cast was prototyped in Blender 5.2 with MPFB 2.0.17 and the CC0
MakeHuman system assets, rendered in Cycles. The result was a generic mannequin
in civilian clothes: well below the quality of these paintings. The in-game
operator figures stay the existing IRON RAIN models until real character models
exist.
