#!/usr/bin/env node
/**
 * Step two of the cast art: finish each Blender render into the published image.
 *
 *   node tools/art/characters/refine.mjs [--only rook,leila] [--derive-only]
 *
 * Input is `build/characters/renders/<id>-portrait.png` from `build.py` (the 3D
 * character, its pose, gear, framing and lights). The OpenAI image edit endpoint
 * re-renders it at higher fidelity with the brief in `refine.json`, keeping the
 * person, pose, framing and lighting. Both files are kept:
 *
 *   docs/art/characters/blender/<id>.png  the Blender render it started from
 *   docs/art/characters/raw/<id>.png      the refined master (never overwritten)
 *
 * and the web copies are derived from the master with ffmpeg:
 *
 *   apps/site/public/media/characters/<id>.webp     600 x 900
 *   apps/game/public/assets/portraits/<id>.webp     214 x 320
 *
 * docs/art/characters/manifest.json records the model, prompt, date and the
 * sha256 of both the Blender render and the master.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RENDERS = join(ROOT, "build/characters/renders");
const BLENDER = join(ROOT, "docs/art/characters/blender");
const RAW = join(ROOT, "docs/art/characters/raw");
const SITE = join(ROOT, "apps/site/public/media/characters");
const GAME = join(ROOT, "apps/game/public/assets/portraits");
const MANIFEST = join(ROOT, "docs/art/characters/manifest.json");
const MODEL = process.env.NC7_IMAGE_MODEL ?? "gpt-image-2";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const deriveOnly = args.includes("--derive-only");

const brief = JSON.parse(readFileSync(join(ROOT, "tools/art/characters/refine.json"), "utf8"));
const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : { portraits: {} };
for (const dir of [BLENDER, RAW, SITE, GAME]) mkdirSync(dir, { recursive: true });

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function refine(id, image, prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("size", "1024x1536");
  form.append("quality", "high");
  form.append("image", new Blob([readFileSync(image)], { type: "image/png" }), `${id}.png`);
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${id}: ${response.status} ${JSON.stringify(body.error ?? body)}`);
  }
  return Buffer.from(body.data[0].b64_json, "base64");
}

function derive(src, out, height, quality) {
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    src,
    "-vf",
    `scale=-2:${height}:flags=lanczos`,
    "-c:v",
    "libwebp",
    "-quality",
    String(quality),
    out,
  ]);
}

const ids = Object.keys(brief.characters).filter((id) => !only || only.includes(id));
await Promise.all(
  ids.map(async (id) => {
    const raw = join(RAW, `${id}.png`);
    const base = join(BLENDER, `${id}.png`);
    const prompt = `${brief.style}\n\n${brief.characters[id]}`;
    if (!existsSync(raw)) {
      if (deriveOnly) throw new Error(`${id}: no refined master to derive from`);
      const render = join(RENDERS, `${id}-portrait.png`);
      if (!existsSync(render)) throw new Error(`${id}: run build.py first (${render})`);
      copyFileSync(render, base);
      console.log(`refining ${id} with ${MODEL}`);
      writeFileSync(raw, await refine(id, base, prompt));
      manifest.portraits[id] = {
        model: MODEL,
        refined: new Date().toISOString(),
        prompt,
        blender: { file: `blender/${id}.png`, sha256: sha(base) },
      };
    }
    derive(raw, join(SITE, `${id}.webp`), 900, 86);
    derive(raw, join(GAME, `${id}.webp`), 320, 82);
    manifest.portraits[id].sha256 = sha(raw);
    console.log(`derived ${id}`);
  }),
);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
