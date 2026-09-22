#!/usr/bin/env node
/**
 * Trailer — a short gameplay film, rendered offline, encoded for the web.
 *
 * A headless box with no GPU renders the yard at a few frames a second, which
 * would make a screen recording a slideshow. So the game is not recorded; it
 * is *stepped*. The page's clocks — requestAnimationFrame, performance.now,
 * Date.now, setTimeout — are put on a virtual timeline once the player is in
 * the yard, and each frame advances that timeline by exactly 1/30 s, renders,
 * and is captured. However long a frame takes to draw, the film plays at a
 * steady 30 fps and the simulation sees a steady 33 ms tick. Bots are seeded,
 * so the fight is the same every time the script runs.
 *
 * The frames are then assembled by ffmpeg into H.264 / AAC in an MP4 with
 * `faststart`, 4:2:0 chroma and the High profile — the combination every
 * browser and phone plays — under the game's own ambience and a track from
 * its soundtrack.
 *
 * Every published asset needs provenance (CLAUDE.md): this script plus the
 * manifest it writes is that provenance.
 *
 * Usage:
 *   pnpm --filter @nightcell7/game build
 *   node tools/art/trailer.mjs --out docs/trailer
 *
 * Options:
 *   --out <dir>       Output directory (default docs/trailer)
 *   --width <px>      Render width  (default 1280)
 *   --height <px>     Render height (default 720)
 *   --fps <n>         Frame rate (default 30)
 *   --music <path>    Soundtrack file (default ironwood-oath from the game)
 *   --port <n>        Local static port (default 8903)
 *   --chrome <path>   Explicit Chromium/Chrome binary
 *   --keep-frames     Leave the JPEG frames on disk after encoding
 */

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile, readFile, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIST = join(ROOT, "apps/game/dist");
const AUDIO = join(ROOT, "apps/game/public/audio");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const OUT = resolve(ROOT, opt("out", "docs/trailer"));
const WIDTH = Number(opt("width", 1280));
const HEIGHT = Number(opt("height", 720));
const FPS = Number(opt("fps", 30));
const PORT = Number(opt("port", 8903));
const MUSIC = resolve(ROOT, opt("music", join(AUDIO, "music/throngva/ironwood-oath.mp3")));
const AMBIENCE = join(AUDIO, "ambience_yard.mp3");
const FRAME_MS = 1000 / FPS;

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
 * The virtual clock, installed before any game script runs.
 *
 * Real time until `start()` is called, so asset loading and the deploy gate
 * behave normally; after that every clock the game reads is the virtual
 * one, and nothing advances until `step(ms)`. Deferred timers run when the
 * timeline passes them, and every queued animation frame runs once per step
 * — that single call is the game's whole frame: input, simulation, render.
 */
const VIRTUAL_CLOCK = `{
  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const epoch = realDateNow();
  let virtualMode = false;
  let virtual = 0;
  let frames = [];
  const timers = new Map();
  let nextId = 1_000_000;

  performance.now = () => (virtualMode ? virtual : realNow());
  Date.now = () => (virtualMode ? epoch + virtual : realDateNow());
  window.requestAnimationFrame = (callback) => {
    if (!virtualMode) return realRaf(callback);
    const id = nextId++;
    frames.push({ id, callback });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frames = frames.filter((frame) => frame.id !== id);
    realCaf(id);
  };
  window.setTimeout = (fn, ms = 0, ...rest) => {
    if (!virtualMode) return realSetTimeout(fn, ms, ...rest);
    const id = nextId++;
    timers.set(id, { at: virtual + Math.max(0, ms), fn: () => fn(...rest) });
    return id;
  };
  window.clearTimeout = (id) => {
    if (!timers.delete(id)) realClearTimeout(id);
  };

  window.__NC7_CLOCK = {
    start() {
      virtual = realNow();
      virtualMode = true;
    },
    step(ms) {
      virtual += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= virtual) {
          timers.delete(id);
          timer.fn();
        }
      }
      const due = frames;
      frames = [];
      for (const frame of due) frame.callback(virtual);
    },
    now: () => virtual,
  };
}`;

/**
 * The film, as a list of beats. Each beat runs for `frames` frames and may
 * hold keys or the trigger for its duration. The camera is steered with the
 * arrow keys — keyboard turning is deterministic, a synthetic mouse is not.
 */
const BEATS = [
  { name: "look-left", frames: 24, keys: ["ArrowLeft"] },
  { name: "look-right", frames: 40, keys: ["ArrowRight"] },
  { name: "settle", frames: 12 },
  { name: "open-fire", frames: 40, fire: true },
  { name: "advance", frames: 100, keys: ["KeyW"] },
  { name: "advance-turn", frames: 30, keys: ["KeyW", "ArrowRight"] },
  { name: "advance-fire", frames: 50, keys: ["KeyW"], fire: true },
  { name: "frag", frames: 8, press: "KeyG" },
  { name: "watch-the-frag", frames: 70 },
  { name: "sidearm", frames: 6, press: "Digit2" },
  { name: "sidearm-fire", frames: 45, fire: true },
  { name: "reload", frames: 6, press: "KeyR" },
  { name: "reloading", frames: 60, keys: ["ArrowLeft"] },
  { name: "rifle", frames: 6, press: "Digit1" },
  { name: "push", frames: 90, keys: ["KeyW"] },
  { name: "push-fire", frames: 60, keys: ["KeyW"], fire: true },
  { name: "hold", frames: 90 },
];

async function main() {
  await stat(join(DIST, "index.html")).catch(() => {
    throw new Error("apps/game/dist missing — run: pnpm --filter @nightcell7/game build");
  });
  await stat(MUSIC).catch(() => {
    throw new Error(`music not found: ${MUSIC}`);
  });

  const frameDir = join(OUT, "frames");
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });
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
  await page.addInitScript(VIRTUAL_CLOCK);

  await page.goto(`http://127.0.0.1:${PORT}/play/?mode=deathmatch&difficulty=easy`, {
    waitUntil: "load",
    timeout: 90_000,
  });
  await page.waitForSelector(".gate__button", { timeout: 90_000 });
  await page.waitForTimeout(6000);

  // Onto the virtual clock now, before the first capture. With the real
  // render loop running, every screenshot has to wait for a frame that the
  // software renderer takes seconds to finish; stepped, the loop is idle
  // between captures and a screenshot returns at once.
  await page.evaluate("window.__NC7_CLOCK.start()");

  let frameIndex = 0;
  const capture = async () => {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 92,
      captureBeyondViewport: false,
    });
    frameIndex += 1;
    await writeFile(
      join(frameDir, `${String(frameIndex).padStart(5, "0")}.jpg`),
      Buffer.from(data, "base64"),
    );
  };

  const step = async () => {
    await page.evaluate(`window.__NC7_CLOCK.step(${FRAME_MS})`);
    // One real tick so the compositor presents the frame just drawn.
    await page.waitForTimeout(20);
    await capture();
    if (frameIndex % 30 === 0) console.log(`frame ${frameIndex}`);
  };

  // Title: the deploy gate with the operator idling in the yard, held for
  // a second and a half.
  for (let i = 0; i < Math.round(FPS * 1.5); i += 1) await step();

  // Deploy with a real click (it focuses the page and takes pointer lock).
  // The lock wait polls on a real interval: animation frames are ours now.
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  await page.click(".gate__button");
  await page.waitForFunction('document.pointerLockElement?.id === "viewport"', null, {
    timeout: 30_000,
    polling: 100,
  });
  // The controller ignores mouse motion for its settle window after lock;
  // step past it so the film does not open on a frozen frame.
  for (let i = 0; i < 6; i += 1) await step();

  for (const beat of BEATS) {
    for (const key of beat.keys ?? []) await page.keyboard.down(key);
    if (beat.fire) await page.mouse.down();
    if (beat.press) await page.keyboard.down(beat.press);
    for (let i = 0; i < beat.frames; i += 1) {
      await step();
      if (beat.press && i === 1) await page.keyboard.up(beat.press);
    }
    if (beat.fire) await page.mouse.up();
    for (const key of beat.keys ?? []) await page.keyboard.up(key);
    console.log(`${beat.name}: ${beat.frames} frames (${frameIndex} total)`);
  }

  await browser.close();
  server.close();
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);

  // Encode. Video fades in and out; music and ambience sit under it, the
  // music trimmed to the film and faded at both ends.
  const seconds = frameIndex / FPS;
  const output = join(OUT, "nightcell7-trailer.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(FPS),
      "-i",
      join(frameDir, "%05d.jpg"),
      "-stream_loop",
      "-1",
      "-i",
      AMBIENCE,
      "-i",
      MUSIC,
      "-filter_complex",
      [
        // JPEG frames are full-range; video players expect limited range,
        // and a full-range flag leaves the film washed out in some of them.
        `[0:v]scale=in_range=jpeg:out_range=mpeg,format=yuv420p,fade=t=in:st=0:d=0.8,fade=t=out:st=${(seconds - 1).toFixed(2)}:d=1[v]`,
        `[1:a]atrim=0:${seconds.toFixed(2)},volume=0.9[amb]`,
        `[2:a]atrim=0:${seconds.toFixed(2)},afade=t=in:st=0:d=1,afade=t=out:st=${(seconds - 2.5).toFixed(2)}:d=2.5,volume=0.7[mus]`,
        `[amb][mus]amix=inputs=2:duration=first:normalize=0[a]`,
      ].join(";"),
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "23",
      "-profile:v",
      "high",
      "-level",
      "4.0",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-shortest",
      output,
    ],
    { stdio: "inherit" },
  );
  if (!flag("keep-frames")) await rm(frameDir, { recursive: true, force: true });

  const bytes = (await stat(output)).size;
  const hash = createHash("sha256")
    .update(await readFile(output))
    .digest("hex")
    .slice(0, 10);
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
        tool: "tools/art/trailer.mjs",
        file: "nightcell7-trailer.mp4",
        sha256: hash,
        bytes,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        seconds: Number(seconds.toFixed(2)),
        music: MUSIC.slice(ROOT.length + 1),
        beats: BEATS.map((beat) => ({ name: beat.name, frames: beat.frames })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${output} (${(bytes / 1_048_576).toFixed(1)} MB, ${seconds.toFixed(1)} s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
