#!/usr/bin/env node
/**
 * Gameplay capture.
 *
 * Renders each vantage in `apps/game/src/photo.ts` from a built game bundle and
 * writes PNGs plus a provenance manifest. Every published screenshot is
 * therefore reproducible from a commit — CLAUDE.md requires provenance for any
 * public asset, and "someone flew a camera around once" is not provenance.
 *
 * Usage:
 *   pnpm --filter @nightcell7/game build
 *   node tools/art/capture.mjs --out apps/site/public/media/yard
 *
 * Options:
 *   --out <dir>     Output directory (default apps/site/public/media/yard)
 *   --width <px>    Capture width  (default 2560)
 *   --height <px>   Capture height (default 1440)
 *   --port <n>      Local static port (default 8901)
 *   --chrome <path> Explicit Chromium/Chrome binary
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIST = join(ROOT, "apps/game/dist");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const OUT = resolve(ROOT, opt("out", "apps/site/public/media/yard"));
const WIDTH = Number(opt("width", 2560));
const HEIGHT = Number(opt("height", 1440));
const PORT = Number(opt("port", 8901));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

/** Serves the built bundle under /play/ so `base` resolves exactly as in prod. */
function serveDist(port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (!path.startsWith("/play/")) {
      res.writeHead(404).end("not found");
      return;
    }
    path = path.slice("/play/".length) || "index.html";
    let file = join(DIST, path);
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = join(file, "index.html");
    } catch {
      // Vite SPA fallback.
      file = join(DIST, "index.html");
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

/** Reads the vantage list straight from the game source — one source of truth. */
async function loadVantages() {
  const source = await import(join(ROOT, "apps/game/src/photo.ts")).catch(() => null);
  if (source?.VANTAGES) return source.VANTAGES;

  // photo.ts is TypeScript; when it cannot be imported directly, parse the
  // names and captions out of it rather than duplicating the list here.
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(join(ROOT, "apps/game/src/photo.ts"), "utf8");
  const out = [];
  const re = /name:\s*"([^"]+)",\s*caption:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) {
    out.push({ name: m[1], caption: m[2].replace(/\s+/g, " ") });
  }
  return out;
}

/**
 * PNG -> WebP via ffmpeg, removing the intermediate. Falls back to keeping the
 * PNG when ffmpeg is unavailable rather than failing the whole capture.
 */
async function toWebp(png, name) {
  const webp = join(OUT, `${name}.webp`);
  try {
    execSync(
      `ffmpeg -y -loglevel error -i ${JSON.stringify(png)} ` +
        `-quality 90 -compression_level 6 ${JSON.stringify(webp)}`,
    );
  } catch {
    console.warn(`ffmpeg unavailable — keeping ${name}.png`);
    return `${name}.png`;
  }
  const { unlink } = await import("node:fs/promises");
  await unlink(png);
  return `${name}.webp`;
}

function chromePath() {
  const explicit = opt("chrome");
  if (explicit) return explicit;
  for (const candidate of [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ]) {
    try {
      execSync(`test -x ${candidate}`);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

async function main() {
  const vantages = await loadVantages();
  if (!vantages.length) throw new Error("no vantages found in apps/game/src/photo.ts");

  await stat(join(DIST, "index.html")).catch(() => {
    throw new Error("apps/game/dist missing — run: pnpm --filter @nightcell7/game build");
  });

  await mkdir(OUT, { recursive: true });
  const server = await serveDist(PORT);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: [
      // SwiftShader keeps this runnable on a headless CI box with no GPU.
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
    ],
  });

  const captured = [];
  for (const vantage of vantages) {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const url = `http://127.0.0.1:${PORT}/play/?photo=${vantage.name}`;
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    // Passed as a string: this expression is evaluated in the page, not in
    // Node, so a closure here would reference a `window` that does not exist
    // in this file's scope.
    await page.waitForFunction("window.__NC7_PHOTO_READY === true", null, { timeout: 60_000 });
    // A few extra frames so the animated grain and bloom settle.
    await page.waitForTimeout(600);

    const png = join(OUT, `${vantage.name}.png`);
    await page.screenshot({ path: png, type: "png" });
    await page.close();

    if (errors.length) {
      throw new Error(`${vantage.name} produced page errors:\n${errors.join("\n")}`);
    }

    // Ship WebP, not PNG: a 1920x1080 capture is ~1.5 MB as PNG and ~120 KB as
    // WebP at a quality that survives this palette. The PNG is not a master
    // worth keeping — the scene is deterministic, so `git checkout && capture`
    // reproduces it exactly.
    const file = await toWebp(png, vantage.name);
    captured.push({ ...vantage, file });
    console.log(`captured ${vantage.name} -> ${join(OUT, file)}`);
  }

  const commit = (() => {
    try {
      return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
    } catch {
      return "unknown";
    }
  })();

  await writeFile(
    join(OUT, "manifest.json"),
    `${JSON.stringify(
      {
        generator: "tools/art/capture.mjs",
        source: "In-engine capture of ARDAVAN_YARD from apps/game (Babylon.js).",
        license: "Original work, © NIGHTCELL 7. No third-party assets.",
        commit,
        capturedAt: new Date().toISOString(),
        viewport: { width: WIDTH, height: HEIGHT },
        shots: captured,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await browser.close();
  server.close();
  console.log(`\n${captured.length} shots -> ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
