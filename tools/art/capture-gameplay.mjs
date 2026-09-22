#!/usr/bin/env node
/**
 * Gameplay capture — the game as played, HUD and all.
 *
 * `capture.mjs` renders empty vantages for the marketing site. This one
 * deploys into the sandbox the way a player does, holds the trigger, walks,
 * and takes the frames a README needs: the deploy gate, contact, the yard,
 * the status bar under fire. Bots are seeded, so a build reproduces the same
 * fight; the software renderer's timing is not exact, so "reproducible"
 * means the same scene and beats, not the same pixels.
 *
 * Every published screenshot must have provenance (CLAUDE.md). This script
 * plus the manifest it writes is that provenance.
 *
 * Usage:
 *   pnpm --filter @nightcell7/game build
 *   node tools/art/capture-gameplay.mjs --out docs/screenshots
 *
 * Options:
 *   --out <dir>     Output directory (default docs/screenshots)
 *   --width <px>    Capture width  (default 1920)
 *   --height <px>   Capture height (default 1080)
 *   --port <n>      Local static port (default 8902)
 *   --chrome <path> Explicit Chromium/Chrome binary
 */

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile, readFile, rename, unlink } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIST = join(ROOT, "apps/game/dist");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const OUT = resolve(ROOT, opt("out", "docs/screenshots"));
const WIDTH = Number(opt("width", 1920));
const HEIGHT = Number(opt("height", 1080));
const PORT = Number(opt("port", 8902));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
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
      file = join(DIST, "index.html");
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

async function toWebp(png, name) {
  const webp = join(OUT, `${name}.webp`);
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      png,
      "-quality",
      "88",
      "-compression_level",
      "6",
      webp,
    ]);
  } catch {
    console.warn(`ffmpeg unavailable — keeping ${name}.png`);
    return `${name}.png`;
  }
  await unlink(png);
  const hash = createHash("sha256")
    .update(await readFile(webp))
    .digest("hex")
    .slice(0, 10);
  const file = `${name}-${hash}.webp`;
  await rename(webp, join(OUT, file));
  return file;
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

/**
 * The frames, in the order they are taken. Each beat is a small script run
 * against the page before its screenshot; the sequence is one continuous
 * session, so later frames show a fight that has had time to develop.
 */
const BEATS = [
  {
    name: "deploy-gate",
    caption: "The deploy gate: pick a mode, read the controls, enter the yard.",
    async run() {},
  },
  {
    name: "first-contact",
    caption: "First contact at the Nightcell spawn: the C9 Kestrel on a Directorate fighter.",
    async run({ hold }) {
      await hold(1600);
    },
  },
  {
    name: "into-the-yard",
    caption: "Moving up the centre lane between the containers, squad ahead.",
    async run({ walk }) {
      await walk(4000);
    },
  },
  {
    name: "under-fire",
    caption:
      "Holding the spawn exit: stamina, armour, magazine and reserve on the status bar, frag ready.",
    async run({ page, hold, walk }) {
      await walk(3000);
      await hold(1200);
      await page.waitForTimeout(6000);
    },
  },
];

async function main() {
  await stat(join(DIST, "index.html")).catch(() => {
    throw new Error("apps/game/dist missing — run: pnpm --filter @nightcell7/game build");
  });
  await mkdir(OUT, { recursive: true });
  const server = await serveDist(PORT);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
    ],
  });

  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await page.context().newCDPSession(page);

  // Wrap scheduling before Babylon can cache requestAnimationFrame, so the
  // loop can be held still for the readback. A continuous render loop
  // starves screenshot capture on SwiftShader (see capture.mjs).
  // Deferred rather than dropped: Babylon re-arms its loop from inside the
  // callback, so a skipped frame would end the loop for good and every later
  // capture would show the same frozen picture.
  await page.addInitScript(`{
    const schedule = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => schedule(function tick(time) {
      if (window.__NC7_CAPTURE_PAUSED) schedule(tick);
      else callback(time);
    });
  }`);

  await page.goto(`http://127.0.0.1:${PORT}/play/?mode=deathmatch`, {
    waitUntil: "load",
    timeout: 90_000,
  });
  await page.waitForSelector(".gate__button", { timeout: 90_000 });
  // Let the yard, the bots and the bloom settle behind the gate.
  await page.waitForTimeout(6000);

  // Park the automation cursor on the crosshair before the lock and never
  // move it again: under pointer lock every mouse event carries relative
  // motion. (The browser's own cursor warp on lock is a separate, real-world
  // problem that the controller guards against itself.)
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  const hold = async (ms) => {
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };
  const walk = async (ms) => {
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(ms);
    await page.keyboard.up("KeyW");
  };

  const captured = [];
  for (const [index, beat] of BEATS.entries()) {
    if (index === 1) {
      // Deploy: the click takes pointer lock, which starts the fight. A real
      // click, not a DOM one: only a real click focuses the page, and without
      // focus the later mouse button events never reach the game.
      await page.click(".gate__button");
      await page.waitForFunction('document.pointerLockElement?.id === "viewport"', null, {
        timeout: 30_000,
      });
      // The controller ignores the cursor warp on lock; the HUD fades in.
      await page.waitForTimeout(2500);
    }
    await beat.run({ page, hold, walk });
    // What state the game is in for this frame; printed so a wrong capture
    // (no HUD, no lock) is diagnosable from the log rather than the image.
    const state = await page.evaluate(`JSON.stringify({
      lock: document.pointerLockElement?.id ?? null,
      hud: document.querySelector(".hud")?.dataset.active ?? null,
      grid: document.querySelector(".hud__block--br .hud__value")?.textContent ?? null,
      health: document.querySelector(".status__health")?.textContent ?? null,
    })`);
    console.log(`${beat.name}: ${state}`);
    // Hold the render loop still for the readback, then let it run on.
    await page.waitForTimeout(400);
    await page.evaluate("window.__NC7_CAPTURE_PAUSED = true");
    await page.waitForTimeout(600);
    const png = join(OUT, `${beat.name}.png`);
    // Straight to the protocol. Playwright's page.screenshot adds a font wait
    // and a compositor round-trip that stall on SwiftShader with a WebGL
    // canvas this size; the raw CDP capture does not.
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(png, Buffer.from(data, "base64"));
    await page.evaluate("window.__NC7_CAPTURE_PAUSED = false");
    const file = await toWebp(png, beat.name);
    captured.push({ name: beat.name, caption: beat.caption, file });
    console.log(`captured ${beat.name} -> ${join(OUT, file)}`);
  }

  await browser.close();
  server.close();

  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);

  const commit = (() => {
    try {
      return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
    } catch {
      return null;
    }
  })();
  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commit,
        tool: "tools/art/capture-gameplay.mjs",
        width: WIDTH,
        height: HEIGHT,
        frames: captured,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${join(OUT, "manifest.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
