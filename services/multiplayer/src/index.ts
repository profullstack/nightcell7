import http from "node:http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RedisPresence } from "@colyseus/redis-presence";
import { RedisDriver } from "@colyseus/redis-driver";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { HealthReporter, createLogger, installGracefulShutdown } from "@nightcell7/observability";
import { CONTENT_VERSION, PROTOCOL_VERSION } from "@nightcell7/multiplayer-protocol";
import { ARDAVAN_YARD, mapChecksum } from "@nightcell7/multiplayer-sim";
import { TDM_RULES } from "@nightcell7/game-core";
import { MatchRoom } from "./match-room";
import { createRoomServices } from "./services";
import { loadEnv } from "./env";

/**
 * Multiplayer daemon (PRD §18.7).
 *
 * Matchmaker and authoritative room hosts in one process per shard, which is
 * the V1 shape. Redis carries presence and the room directory so additional
 * shards can be added at the gateway without any client change (PRD §18.8).
 *
 * The public path is `wss://nightcell7.com/api/v1/multiplayer/sync/...`; this
 * process only ever sees the proxied request from the gateway.
 */

const env = loadEnv();
const logger = createLogger({
  service: "multiplayer",
  level: env.LOG_LEVEL,
  buildVersion: env.BUILD_VERSION,
});
const health = new HealthReporter("multiplayer", env.BUILD_VERSION, PROTOCOL_VERSION);

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const resultsQueue = new Queue("match-results", { connection: redis });

const httpServer = http.createServer((req, res) => {
  // Health endpoints are answered here so the platform can probe the process
  // without opening a WebSocket.
  if (req.url === "/health/live") {
    return json(res, 200, health.live());
  }
  if (req.url === "/health/ready") {
    const body = health.ready();
    return json(res, body.status === "ok" ? 200 : 503, body);
  }
  if (req.url === "/health/capacity") {
    return json(res, 200, {
      region: env.MULTIPLAYER_REGION,
      shard: env.MULTIPLAYER_SHARD,
      maxRooms: env.MULTIPLAYER_MAX_ROOMS,
      draining: health.draining,
      observedAt: new Date().toISOString(),
    });
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  presence: new RedisPresence(env.REDIS_URL),
  driver: new RedisDriver(env.REDIS_URL),
});

const services = createRoomServices(redis, resultsQueue);

gameServer
  .define(TDM_RULES.mode, MatchRoom, {
    services,
    logger,
    region: env.MULTIPLAYER_REGION,
    shard: env.MULTIPLAYER_SHARD,
    buildVersion: env.BUILD_VERSION,
    ticketSecret: env.TICKET_SECRET,
    matchResultSecret: env.MATCH_RESULT_SECRET,
    botFill: env.BOT_FILL,
  })
  .filterBy(["region", "shard"]);

void gameServer.listen(env.MULTIPLAYER_PORT).then(() => {
  health.setReady(true, {
    region: env.MULTIPLAYER_REGION,
    shard: env.MULTIPLAYER_SHARD,
    mapChecksum: mapChecksum(ARDAVAN_YARD),
  });
  logger.info("multiplayer listening", {
    port: env.MULTIPLAYER_PORT,
    region: env.MULTIPLAYER_REGION,
    shard: env.MULTIPLAYER_SHARD,
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
    mapChecksum: mapChecksum(ARDAVAN_YARD),
    maxRooms: env.MULTIPLAYER_MAX_ROOMS,
  });
});

/**
 * Drain on SIGTERM (PRD §18.8).
 *
 * New rooms are refused immediately; existing matches get a bounded window to
 * finish. Anything still running when the window closes ends with an explicit
 * service-restart reason, which is not counted as a normal win or loss.
 */
const DRAIN_WINDOW_MS = 90_000;

installGracefulShutdown({
  logger,
  health,
  timeoutMs: DRAIN_WINDOW_MS + 15_000,
  onShutdown: async () => {
    logger.info("draining shard", { drainWindowMs: DRAIN_WINDOW_MS });

    const rooms = await matchMaker.query({});
    for (const room of rooms) {
      const local = matchMaker.getLocalRoomById(room.roomId);
      if (local instanceof MatchRoom) local.beginDrain();
    }

    const deadline = Date.now() + DRAIN_WINDOW_MS;
    while (Date.now() < deadline) {
      const remaining = await matchMaker.query({});
      if (remaining.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    await gameServer.gracefullyShutdown(false);
    await resultsQueue.close();
    redis.disconnect();
  },
});
