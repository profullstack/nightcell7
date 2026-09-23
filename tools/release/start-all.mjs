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
import path from "node:path";
import process from "node:process";
import { createGameServer } from "./game-static.mjs";

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

/** Serve the built game; see `game-static.mjs`. */
function startGameStatic() {
  const server = createGameServer(path.join(ROOT, "apps/game/dist"));
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
