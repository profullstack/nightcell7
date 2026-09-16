/* global window, document, localStorage, requestAnimationFrame, HTMLCanvasElement, MouseEvent */
/** Exercise the real browser demo, including a remembered empty-yard preference. */
import { chromium } from "playwright";
import { createServer } from "../../../apps/game/node_modules/vite/dist/node/index.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const server = await createServer({
  root: root + "apps/game",
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    hmr: false,
    watch: { ignored: ["**/*"] },
  },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.argv[2],
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGE_ERROR", e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE_ERROR", m.text());
  });
  const models = new Set();
  page.on("request", (r) => {
    if (r.url().endsWith(".glb")) models.add(r.url().split("/").at(-1));
  });
  const pointerLockAdapter = process.argv.includes("--pointer-lock-adapter");
  // Poll the page's main world: pointer-lock adapters and the dev inspector
  // are main-world properties, not isolated-world DOM bindings.
  async function until(check, timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await page.evaluate(check)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Browser condition timed out: ${check}`);
  }
  await page.addInitScript((adapter) => {
    localStorage.setItem("nc7.mode", "roam");
    if (adapter) {
      let locked = null;
      Object.defineProperty(document, "pointerLockElement", { get: () => locked });
      HTMLCanvasElement.prototype.requestPointerLock = function () {
        // The adapter must expose the exact canvas that requested the lock.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        locked = this;
        document.dispatchEvent(new Event("pointerlockchange"));
        return Promise.resolve();
      };
      document.exitPointerLock = () => {
        locked = null;
        document.dispatchEvent(new Event("pointerlockchange"));
      };
      document.addEventListener("keydown", (e) => {
        if (e.code === "Escape") document.exitPointerLock();
      });
    }
  }, pointerLockAdapter);
  await page.goto("http://127.0.0.1:5175/play/?mode=demo&inspect=1", {
    waitUntil: "domcontentloaded",
  });
  await until(() => Boolean(window.__NC7_DEV__?.opponents), 120000);
  const initial = await page.evaluate(() => {
    const { opponents } = window.__NC7_DEV__;
    return {
      tick: opponents.sim.tick,
      bots: [...opponents.views].map(([id, v]) => ({
        id,
        team: opponents.sim.players.get(id).team,
        position: v.root.position.asArray(),
      })),
      selected: document.querySelector("input:checked")?.value,
    };
  });
  console.log("INITIAL", JSON.stringify(initial));
  assert.equal(initial.bots.length, 7);
  assert.equal(initial.selected, "deathmatch");
  assert.equal(initial.tick, 0);
  const button = await page.evaluate(() => {
    const r = document.querySelector(".gate__button").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.bringToFront();
  if (pointerLockAdapter)
    await page.evaluate(() => document.querySelector(".gate__button").click());
  else await page.mouse.click(button.x, button.y);
  await until(() => document.pointerLockElement !== null);
  await until(() => window.__NC7_DEV__.opponents.sim.tick > 5);
  // Stage the existing opponents on an unobstructed firing lane so a real
  // mouse click tests the input -> hitscan -> damage path deterministically.
  await page.evaluate(() => {
    const d = window.__NC7_DEV__;
    const p = d.player;
    p.state.position = { x: -11, y: 0, z: 23 };
    p.state.velocity = { x: 0, y: 0, z: 0 };
    p.state.yaw = Math.PI;
    p.yaw = Math.PI;
    p.state.pitch = 0.07;
    p.pitch = 0.07;
    d.opponents.controllers.length = 0;
    for (const [id, b] of d.opponents.sim.players) {
      if (id === "local-player") continue;
      b.movement.position = { x: 30, y: 0, z: -40 };
      b.movement.velocity = { x: 0, y: 0, z: 0 };
      b.pendingInputs.length = 0;
    }
    const enemy = d.opponents.sim.players.get("bot-e0");
    enemy.movement.position = { x: -11, y: 0, z: 15 };
    enemy.health = 100;
    enemy.alive = true;
  });
  await until(
    () => Math.abs(window.__NC7_DEV__.opponents.views.get("bot-e0").root.position.z - 15) < 0.1,
  );
  await mkdir(root + "build/modern-art", { recursive: true });
  await page.screenshot({ path: root + "build/modern-art/demo-combat.png" });
  if (pointerLockAdapter)
    await page.evaluate(() =>
      window.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true })),
    );
  else await page.mouse.down();
  await until(() => window.__NC7_DEV__.opponents.sim.players.get("bot-e0").health < 100);
  if (pointerLockAdapter)
    await page.evaluate(() =>
      window.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true })),
    );
  else await page.mouse.up();
  const hit = await page.evaluate(() => {
    const p = window.__NC7_DEV__.opponents.sim.players.get("bot-e0");
    return { health: p.health, alive: p.alive };
  });
  assert.ok(hit.health < 100);
  if (pointerLockAdapter) await page.evaluate(() => document.exitPointerLock());
  else await page.keyboard.press("Escape");
  await until(() => document.pointerLockElement === null);
  const paused = await page.evaluate(() => window.__NC7_DEV__.opponents.sim.tick);
  // Rendering continues while paused; combat must not advance behind the gate.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.evaluate(() => window.__NC7_DEV__.opponents.sim.tick), paused);
  assert.equal(models.size, 28);
  assert.ok([...models].every((n) => n.startsWith("m2_")));
  assert.deepEqual(errors, []);
  const report = {
    input: pointerLockAdapter
      ? "headless pointer-lock and DOM input adapter"
      : "native mouse and pointer lock",
    initial,
    hit,
    paused,
    models: [...models].sort(),
    errors,
  };
  await writeFile(root + "build/modern-art/browser-smoke.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
