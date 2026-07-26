#!/usr/bin/env node
/**
 * Asset build.
 *
 * Regenerates every model and texture in the game from the generator scripts
 * in this directory. Nothing here is hand-authored and nothing is downloaded,
 * which is what makes the whole asset set satisfy CLAUDE.md's provenance rule:
 * the provenance of any file is "this commit, this script, this seed".
 *
 * The build is deterministic. Running it twice on the same commit produces the
 * same bytes, so `git status` after a rebuild is the regression test — if the
 * tree is dirty, a generator picked up an unseeded source of randomness.
 *
 * Usage:
 *   node tools/art/build-assets.mjs                # models + textures
 *   node tools/art/build-assets.mjs --previews     # ...and render preview PNGs
 *   node tools/art/build-assets.mjs --textures-only
 *   node tools/art/build-assets.mjs --models-only
 *
 * Requires Blender 4.5+ on PATH or in $BLENDER. Blender's bundled Python
 * provides numpy for the texture generator, so there is no pip dependency.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "../..");
const OUT = join(ROOT, "apps/game/public/assets");
const MODELS_OUT = join(OUT, "models");
const TEXTURES_OUT = join(OUT, "textures");
const PREVIEWS_OUT = join(ROOT, "build/asset-previews");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

/** Model generators, in the order they are built. */
const MODEL_SCRIPTS = ["yard.py", "container.py", "character.py", "weapon.py"];

/** Texture resolution. 1024 keeps the whole set near 2 MB as WebP. */
const TEXTURE_SIZE = 1024;
/** WebP quality. 88 is where this palette stops showing banding in the sky. */
const WEBP_QUALITY = 88;

function blenderBinary() {
  const explicit = process.env.BLENDER;
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of [
    "blender",
    `${process.env.HOME}/.local/bin/blender`,
    "/usr/bin/blender",
    "/snap/bin/blender",
  ]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "pipe" });
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(
    "Blender 4.5+ not found. Install it or set $BLENDER.\n" +
      "  https://download.blender.org/release/Blender4.5/",
  );
}

function blenderPython(binary) {
  // Blender ships its own Python with numpy. Locating it avoids a pip install
  // and guarantees the texture generator runs against the same numpy that
  // Blender itself uses.
  const root = execFileSync(
    binary,
    [
      "--background",
      "--factory-startup",
      "--python-expr",
      "import sys;print('PYBIN', sys.executable)",
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  const match = root.match(/^PYBIN (.+)$/m);
  if (!match) throw new Error("could not locate Blender's bundled Python");
  return match[1].trim();
}

function run(binary, argv, label) {
  process.stdout.write(`  ${label}\n`);
  const output = execFileSync(binary, argv, { encoding: "utf8", stdio: "pipe", cwd: HERE });
  for (const line of output.split("\n")) {
    if (/^(EXPORTED|TEXTURE|PREVIEW)/.test(line)) process.stdout.write(`    ${line}\n`);
  }
  return output;
}

function toWebp(pngDir, outDir) {
  mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const file of readdirSync(pngDir).sort()) {
    if (!file.endsWith(".png")) continue;
    const target = join(outDir, file.replace(/\.png$/, ".webp"));
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        join(pngDir, file),
        "-quality",
        String(WEBP_QUALITY),
        target,
      ],
      { stdio: "pipe" },
    );
    total += statSync(target).size;
  }
  return total;
}

function directoryBytes(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
}

function main() {
  const blender = blenderBinary();
  const version = execFileSync(blender, ["--version"], { encoding: "utf8" }).split("\n")[0].trim();
  console.log(`NIGHTCELL 7 asset build\n  ${version}\n`);

  const doModels = !has("--textures-only");
  const doTextures = !has("--models-only");

  if (doModels) {
    console.log("models");
    mkdirSync(MODELS_OUT, { recursive: true });
    for (const script of MODEL_SCRIPTS) {
      run(
        blender,
        [
          "--background",
          "--factory-startup",
          "--python",
          join(HERE, "blender", script),
          "--",
          "--output",
          MODELS_OUT,
        ],
        script,
      );
    }
  }

  if (doTextures) {
    console.log("\ntextures");
    const python = blenderPython(blender);
    const staging = join(ROOT, "build/texture-png");
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });

    run(
      python,
      [join(HERE, "textures/generate.py"), "--out", staging, "--size", String(TEXTURE_SIZE)],
      `generate.py (${TEXTURE_SIZE}px)`,
    );

    process.stdout.write("  encoding webp\n");
    const bytes = toWebp(staging, TEXTURES_OUT);
    rmSync(staging, { recursive: true, force: true });
    process.stdout.write(`    ${(bytes / 1048576).toFixed(2)} MB of WebP\n`);
  }

  if (has("--previews")) {
    console.log("\npreviews");
    mkdirSync(PREVIEWS_OUT, { recursive: true });
    for (const file of readdirSync(MODELS_OUT).sort()) {
      if (!file.endsWith(".glb")) continue;
      run(
        blender,
        [
          "--background",
          "--factory-startup",
          "--python",
          join(HERE, "blender/preview.py"),
          "--",
          "--glb",
          join(MODELS_OUT, file),
          "--out",
          join(PREVIEWS_OUT, file.replace(/\.glb$/, ".png")),
          "--samples",
          "40",
        ],
        file,
      );
    }
  }

  // -------------------------------------------------------------- manifest
  const models = existsSync(MODELS_OUT)
    ? readdirSync(MODELS_OUT)
        .filter((f) => f.endsWith(".glb"))
        .sort()
    : [];
  const textures = existsSync(TEXTURES_OUT)
    ? readdirSync(TEXTURES_OUT)
        .filter((f) => f.endsWith(".webp"))
        .sort()
    : [];

  const modelBytes = directoryBytes(MODELS_OUT);
  const textureBytes = directoryBytes(TEXTURES_OUT);

  const commit = (() => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  })();

  writeFileSync(
    join(OUT, "manifest.json"),
    `${JSON.stringify(
      {
        generator: "tools/art/build-assets.mjs",
        blender: version,
        commit,
        license: "Original work, © NIGHTCELL 7. No third-party assets.",
        source:
          "Generated procedurally from the scripts in tools/art. No asset is " +
          "downloaded, photographed, traced, or derived from another game.",
        textureSize: TEXTURE_SIZE,
        webpQuality: WEBP_QUALITY,
        models,
        textures,
        bytes: { models: modelBytes, textures: textureBytes, total: modelBytes + textureBytes },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const total = modelBytes + textureBytes;
  console.log(
    `\n${models.length} models (${(modelBytes / 1048576).toFixed(2)} MB) + ` +
      `${textures.length} textures (${(textureBytes / 1048576).toFixed(2)} MB) ` +
      `= ${(total / 1048576).toFixed(2)} MB uncompressed`,
  );
  console.log(`manifest -> ${join(OUT, "manifest.json")}`);
}

main();
