#!/usr/bin/env node
/**
 * Single-container supervisor.
 *
 * Runs the whole NIGHTCELL 7 stack inside one Railway service: the gateway
 * binds Railway's $PORT and proxies to every other process on localhost.
 *
 * This is a deployment-shape choice, not an architecture change. The gateway
 * still routes by the same rules and the services still talk over the same
 * contracts — the upstream URLs simply point at 127.0.0.1. Splitting into
 * separate Railway services later means changing four environment variables,
 * not restructuring code (PRD §17.5 remains the target topology).
 *
 * Deliberately strict: if any child dies, the whole container exits so Railway
 * restarts it. A half-running stack that answers health checks while the match
 * server is dead is worse than an honest restart.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PUBLIC_PORT = Number(process.env.PORT ?? 8080);

// Internal ports. Never exposed; only the gateway binds a public port.
const PORTS = {
  site: 3000,
  api: 3001,
  multiplayer: 3002,
  worker: 3003,
  game: 3005,
};

const children = [];
let shuttingDown = false;

function log(service, message) {
  process.stdout.write(
    `${JSON.stringify({ level: "info", service: "supervisor", child: service, msg: message })}\n`,
  );
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(name, `exited unexpectedly (code=${code} signal=${signal}); stopping container`);
    shutdown(1);
  });

  children.push({ name, child });
  log(name, "started");
  return child;
}

/**
 * Minimal static server for the built game.
 *
 * A dependency-free replacement for the separate `game-web` Caddy service.
 * Content-hashed assets are cached hard; the shell must revalidate so an
 * update is actually picked up (PRD §27.4).
 */
function startGameStatic() {
  const dist = path.join(ROOT, "apps/game/dist");
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".ktx2": "image/ktx2",
    ".glb": "model/gltf-binary",
    ".webm": "audio/webm",
    ".mp3": "audio/mpeg",
    ".wasm": "application/wasm",
  };

  const server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];

    if (url === "/health/live" || url === "/health/ready") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "game-web" }));
      return;
    }

    // Strip the /play prefix the gateway forwards.
    let relative = url.replace(/^\/play/, "") || "/";
    if (relative.endsWith("/")) relative += "index.html";

    // Resolve and confirm the result stays inside dist — a static server is a
    // classic path-traversal surface.
    const resolved = path.resolve(dist, `.${relative}`);
    if (!resolved.startsWith(dist)) {
      res.writeHead(403).end();
      return;
    }

    fs.readFile(resolved, (error, data) => {
      if (error) {
        // SPA fallback so client-side routes work on reload.
        fs.readFile(path.join(dist, "index.html"), (fallbackError, html) => {
          if (fallbackError) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "not_found" }));
            return;
          }
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          });
          res.end(html);
        });
        return;
      }

      const ext = path.extname(resolved);
      const hashed = /\.[a-f0-9]{8,}\./.test(path.basename(resolved));
      res.writeHead(200, {
        "content-type": types[ext] ?? "application/octet-stream",
        "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      });
      res.end(data);
    });
  });

  server.listen(PORTS.game, () => log("game-web", `listening on ${PORTS.game}`));
  children.push({ name: "game-web", child: { kill: () => server.close() } });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("supervisor", "shutting down");
  for (const { child } of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  // Give the multiplayer drain window room before forcing exit.
  setTimeout(() => process.exit(code), 15_000).unref();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

// --- start order: dependencies first, gateway last ------------------------

startGameStatic();

start("api", "node", ["services/api/dist/index.js"], { API_PORT: String(PORTS.api) });
start("multiplayer", "node", ["services/multiplayer/dist/index.js"], {
  MULTIPLAYER_PORT: String(PORTS.multiplayer),
});
start("worker", "node", ["services/worker/dist/index.js"], { WORKER_PORT: String(PORTS.worker) });
start("site", "pnpm", ["--filter", "@nightcell7/site", "start"], { PORT: String(PORTS.site) });

// The gateway binds the public port and is what Railway health-checks.
start("gateway", "node", ["services/gateway/dist/index.js"], {
  GATEWAY_PORT: String(PUBLIC_PORT),
  SITE_UPSTREAM: `http://127.0.0.1:${PORTS.site}`,
  GAME_UPSTREAM: `http://127.0.0.1:${PORTS.game}`,
  API_UPSTREAM: `http://127.0.0.1:${PORTS.api}`,
  MULTIPLAYER_UPSTREAM: `http://127.0.0.1:${PORTS.multiplayer}`,
});

log("supervisor", `stack starting; gateway will bind ${PUBLIC_PORT}`);
