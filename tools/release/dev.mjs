#!/usr/bin/env node
/**
 * Local development orchestrator.
 *
 * Starts every service behind the gateway so WebSocket upgrades, cookies, CORS
 * and route precedence are exercised the same way they will be in production
 * (PRD §17.7). If it works on http://localhost:8080 it works on nightcell7.com.
 */
import { spawn } from "node:child_process";
import process from "node:process";

const SERVICES = [
  {
    name: "site",
    cwd: "apps/site",
    args: ["--filter", "@nightcell7/site", "dev"],
    color: "\x1b[35m",
  },
  {
    name: "game",
    cwd: "apps/game",
    args: ["--filter", "@nightcell7/game", "dev"],
    color: "\x1b[36m",
  },
  {
    name: "api",
    cwd: "services/api",
    args: ["--filter", "@nightcell7/service-api", "dev"],
    color: "\x1b[32m",
  },
  {
    name: "multiplayer",
    cwd: "services/multiplayer",
    args: ["--filter", "@nightcell7/service-multiplayer", "dev"],
    color: "\x1b[33m",
  },
  {
    name: "worker",
    cwd: "services/worker",
    args: ["--filter", "@nightcell7/service-worker", "dev"],
    color: "\x1b[34m",
  },
  // The gateway starts last so its upstreams are already listening.
  {
    name: "gateway",
    cwd: "services/gateway",
    args: ["--filter", "@nightcell7/service-gateway", "dev"],
    color: "\x1b[31m",
  },
];

const RESET = "\x1b[0m";
const children = [];

function start({ name, args, color }) {
  const child = spawn("pnpm", args, { stdio: ["ignore", "pipe", "pipe"] });

  const prefix = `${color}[${name.padEnd(11)}]${RESET}`;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) console.log(`${prefix} ${line}`);
      }
    });
  }

  child.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code}`);
  });

  children.push(child);
}

console.log("NIGHTCELL 7 — starting local stack.");
console.log("Run `pnpm dev:deps` first if Redis is not already running.\n");

for (const service of SERVICES) start(service);

console.log("\nOnce the gateway is up, everything is behind one origin:");
console.log("  http://localhost:8080/                    marketing site");
console.log("  http://localhost:8080/play                game");
console.log("  http://localhost:8080/api/v1/catalog      api");
console.log("  ws://localhost:8080/api/v1/multiplayer/sync/...\n");

function shutdown() {
  console.log("\nStopping local stack.");
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
