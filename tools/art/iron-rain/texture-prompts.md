# IRON RAIN surface provenance

Created 2026-09-16 with the built-in image-generation tool for this repository. Original generated surface art, not sourced from a game or third-party asset pack. `textures/ir_surface_atlas.webp` is the reusable source and shipped atlas. Quadrants are independent square material swatches: pale concrete (top left), slate-blue painted metal (top right), dark asphalt (bottom left), neutral ripstop (bottom right). Runtime sampling stays inside each quadrant.

Initial direction: a square 2×2 physically based surface atlas, perfectly orthographic flat material scans with even illumination, no objects, text, borders, shadows or perspective; pale gray fine concrete, desaturated slate-blue painted steel, dark fine asphalt and neutral gray woven ripstop; restrained small-scale wear and consistent modern industrial military art direction.

Refinement direction: retain the other three quadrants and replace the bottom-left asphalt with a much darker, finer, low-contrast surface without conspicuous stones or large mottled patches. The final image was encoded to WebP quality 88 using ffmpeg. These are albedo swatches, not generated normal or roughness maps.

`textures/ir_env_sky.webp` comes from the deterministic original gradient in `environment.py` (1024×512 equirectangular environment, ffmpeg quality 95). The scene sky and effects are authored in runtime canvas code. The retained C7 coating and steel/rubber normal maps retain their prior provenance in `tools/art/modern/texture-prompts.md` and `tools/art/textures/generate.py`.
