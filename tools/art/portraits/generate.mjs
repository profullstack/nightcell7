#!/usr/bin/env node
/**
 * Cast portraits: generate raw PNG masters, then derive the web copies.
 *
 *   node tools/art/portraits/generate.mjs [--only rook,leila] [--derive-only]
 *
 * Raw masters land in docs/art/characters/raw/<id>.png and are never
 * overwritten (CLAUDE.md: "never overwrite raw assets"); move one aside by
 * hand to regenerate it. The site copy (900 px tall) and the game's gate
 * thumbnail (320 px tall) are derived from the master with ffmpeg. Every
 * prompt, the model and the date go to docs/art/characters/manifest.json.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RAW = join(ROOT, "docs/art/characters/raw");
const SITE = join(ROOT, "apps/site/public/media/characters");
const GAME = join(ROOT, "apps/game/public/assets/portraits");
const MANIFEST = join(ROOT, "docs/art/characters/manifest.json");
const MODEL = process.env.NC7_IMAGE_MODEL ?? "gpt-image-2";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const deriveOnly = args.includes("--derive-only");

const spec = JSON.parse(readFileSync(join(ROOT, "tools/art/portraits/prompts.json"), "utf8"));
const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : { portraits: {} };
for (const dir of [RAW, SITE, GAME]) mkdirSync(dir, { recursive: true });

async function generate(id, prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, size: "1024x1536", quality: "high", n: 1 }),
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

const ids = Object.keys(spec.characters).filter((id) => !only || only.includes(id));
await Promise.all(
  ids.map(async (id) => {
    const character = spec.characters[id];
    const raw = join(RAW, `${id}.png`);
    const prompt = `${spec.style}\n\n${character.prompt}`;
    if (!existsSync(raw)) {
      if (deriveOnly) throw new Error(`${id}: no raw master to derive from`);
      console.log(`generating ${id} with ${MODEL}`);
      writeFileSync(raw, await generate(id, prompt));
      manifest.portraits[id] = {
        name: character.name,
        model: MODEL,
        generated: new Date().toISOString(),
        prompt,
      };
    }
    derive(raw, join(SITE, `${id}.webp`), 900, 86);
    derive(raw, join(GAME, `${id}.webp`), 320, 82);
    manifest.portraits[id].sha256 = createHash("sha256").update(readFileSync(raw)).digest("hex");
    console.log(`derived ${id}`);
  }),
);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
