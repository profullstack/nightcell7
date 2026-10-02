import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CONTENT_VERSION, PROTOCOL_VERSION } from "@nightcell7/multiplayer-protocol";
import { TDM_RULES } from "@nightcell7/game-core";
import { HealthReporter, createLogger } from "@nightcell7/observability";
import { MatchRoom } from "./match-room";
import { createMemoryRoomServices } from "./services";
import { createApp, type Dependencies } from "../../api/src/app";
import { MemoryRateLimiter } from "../../api/src/rate-limit";
import type { Repositories } from "../../api/src/repository";
import type { ApiEnv } from "../../api/src/env";
import { createGatewayServer } from "../../gateway/src/server";
import { NetClient } from "../../../apps/game/src/net/client";
import { OnlineSession, type OnlineStatus } from "../../../apps/game/src/net/session";

/**
 * The real public path, end to end, with two players:
 *
 *   game NetClient -> gateway -> api   POST /api/v1/multiplayer/tickets
 *   game NetClient -> gateway -> multiplayer  POST .../sync/matchmake/joinOrCreate/tdm
 *   game NetClient -> gateway -> multiplayer  WS   .../sync/<processId>/<roomId>
 *
 * Before the fix the client rooted Colyseus at the bare origin, so matchmaking
 * went to `/matchmake/...` (the site), and the ticket named a random room id
 * that no room ever had.
 */

const TICKET_SECRET = "e2e-ticket-secret-0123456789abc";
const silent = createLogger({ service: "e2e", level: "error", sink: () => {} });

let gameServer: Server;
let apiServer: http.Server;
let gateway: http.Server;
let gatewayOrigin = "";
const tickets = new Set<string>();

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

/** Serve the Hono API app over plain node:http, as `@hono/node-server` does. */
function serveApi(app: ReturnType<typeof createApp>): http.Server {
  return http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const response = await app.fetch(
      new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
}

beforeAll(async () => {
  // See match-room.test.ts: keep @pm2/io's IPC messages away from vitest.
  const send = process.send?.bind(process);
  if (send) {
    process.send = ((message: unknown, ...rest: never[]) =>
      Buffer.isBuffer(message) ? send(message, ...rest) : true) as typeof process.send;
  }

  // multiplayer
  const mpHttp = http.createServer();
  gameServer = new Server({ transport: new WebSocketTransport({ server: mpHttp }) });
  gameServer
    .define(TDM_RULES.mode, MatchRoom, {
      services: createMemoryRoomServices({ tickets }),
      logger: silent,
      region: "us-west",
      shard: "1",
      buildVersion: "test",
      ticketSecret: TICKET_SECRET,
      matchResultSecret: "e2e-result-secret-0123456789abc",
      botFill: true,
    })
    .filterBy(["region", "shard", "lobby"]);
  await gameServer.listen(0, "127.0.0.1");
  const mpPort = (mpHttp.address() as AddressInfo).port;

  // gateway (port first, so the API can hand out its public origin)
  const health = new HealthReporter("gateway", "test");
  const placeholder = new URL("http://127.0.0.1:9");
  let apiPort = 0;
  gateway = createGatewayServer({
    upstreams: {
      site: placeholder,
      game: placeholder,
      get api() {
        return new URL(`http://127.0.0.1:${apiPort}`);
      },
      multiplayer: new URL(`http://127.0.0.1:${mpPort}`),
    },
    isProduction: false,
    maintenance: false,
    logger: silent,
    health,
  });
  gatewayOrigin = `http://127.0.0.1:${await listen(gateway)}`;

  // api
  const env = {
    NODE_ENV: "test",
    PUBLIC_ORIGIN: gatewayOrigin,
    BUILD_VERSION: "test",
    LOG_LEVEL: "error",
    API_PORT: 0,
    AUTH_SECRET: "e2e-auth-secret-0123456789abcdef",
    TICKET_SECRET,
    TICKET_TTL_SECONDS: 45,
    MATCH_RESULT_SECRET: "e2e-result-secret-0123456789abc",
    REDIS_URL: "redis://unused",
    DATABASE_URL: "postgres://unused",
    COINPAY_API_BASE: "https://coinpay.test",
    COINPAY_API_KEY: "key",
    COINPAY_WEBHOOK_SECRET: "e2e-webhook-secret-0123456789abc",
    R2_BUCKET: "unused",
    MULTIPLAYER_REGION: "us-west",
    MULTIPLAYER_SHARD: "1",
  } as ApiEnv;
  const repos = {
    findAccountById: async (userId: string) => ({ userId, verified: true, status: "active" }),
    getMultiplayerProfile: async () => null,
  } as unknown as Repositories;
  const app = createApp({
    env,
    logger: silent,
    health: new HealthReporter("api", "test", PROTOCOL_VERSION),
    repos,
    rateLimiter: new MemoryRateLimiter(),
    coinpay: {} as Dependencies["coinpay"],
    enqueue: async () => {},
    registerTicket: async (ticketId) => {
      tickets.add(ticketId);
    },
    content: { loadManifest: async () => null, sign: async () => "" },
    auth: {
      handler: async () => new Response("auth"),
      // The cookie value is the user id; enough to give each player a session.
      getSession: async (headers) => {
        const user = /session=(u_\w+)/.exec(headers.get("cookie") ?? "")?.[1];
        return user ? { userId: user, verified: true } : null;
      },
    },
  });
  apiServer = serveApi(app);
  apiPort = await listen(apiServer);
});

afterAll(async () => {
  gateway?.close();
  apiServer?.close();
  await gameServer?.gracefullyShutdown(false);
});

async function mintTicket(userId: string): Promise<string> {
  const res = await fetch(`${gatewayOrigin}/api/v1/multiplayer/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `session=${userId}` },
    body: JSON.stringify({
      mode: TDM_RULES.mode,
      buildVersion: "test",
      protocolVersion: PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { websocketUrl: string }).websocketUrl;
}

describe("client -> ticket -> gateway -> match", () => {
  it("puts two players with API tickets into the same room through the gateway", async () => {
    const welcomes: string[] = [];
    const a = new NetClient({ onWelcome: (w) => welcomes.push(w.roomId) });
    const b = new NetClient({ onWelcome: (w) => welcomes.push(w.roomId) });

    const urlA = await mintTicket("u_alpha");
    expect(urlA.startsWith(`${gatewayOrigin.replace("http", "ws")}/api/v1/multiplayer/sync/`)).toBe(
      true,
    );
    await a.join({ websocketUrl: urlA, buildVersion: "test", platform: "web" });
    await b.join({
      websocketUrl: await mintTicket("u_bravo"),
      buildVersion: "test",
      platform: "web",
    });

    // Let the welcome and several state patches arrive.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(welcomes).toHaveLength(2);
    expect(welcomes[0]).toBe(welcomes[1]);
    for (const client of [a, b]) {
      const humans = [...client.state!.players.values()].filter((p) =>
        p.displayName.startsWith("Operative-u_"),
      );
      expect(humans).toHaveLength(2);
    }

    await a.leave();
    await b.leave();
  }, 20_000);

  it("answers the matchmaking path itself, refusing a request without a ticket", async () => {
    const res = await fetch(
      `${gatewayOrigin}/api/v1/multiplayer/sync/matchmake/joinOrCreate/${TDM_RULES.mode}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ region: "us-west", shard: "1", lobby: "quick" }),
      },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { code: string }).code).toBe("ticket_invalid");
  });
});

/**
 * The game's Quick match / Private match buttons drive `OnlineSession`; this
 * runs that same flow through the real API, gateway and match server, so the
 * button path cannot drift from the transport path above.
 */
function sessionFor(userId: string, seen: OnlineStatus["kind"][]): OnlineSession {
  const session = new OnlineSession({
    apiBase: gatewayOrigin,
    buildVersion: "test",
    platform: "web",
    // A browser sends the cookie itself; node's fetch needs it spelled out.
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), cookie: `session=${userId}` },
      }),
  });
  session.onStatus((status) => seen.push(status.kind));
  return session;
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("quick match from the game's online session", () => {
  it("takes two players from the button to the same room, with bots filling seats", async () => {
    const seenA: OnlineStatus["kind"][] = [];
    const seenB: OnlineStatus["kind"][] = [];
    const a = sessionFor("u_charlie", seenA);
    const b = sessionFor("u_delta", seenB);

    await a.quickMatch();
    await b.quickMatch();
    await until(() => {
      a.refresh();
      b.refresh();
      const humans = (s: OnlineSession) =>
        s.status.kind === "waiting" || s.status.kind === "live" ? s.status.humans : 0;
      return humans(a) === 2 && humans(b) === 2;
    });

    expect(seenA.slice(0, 3)).toEqual(["ticket", "connecting", "waiting"]);
    expect(a.status).toMatchObject({ kind: "waiting", lobby: "quick", humans: 2 });
    // Bots hold the remaining seats of the 6v6 until humans take them.
    if (a.status.kind === "waiting") expect(a.status.bots).toBe(TDM_RULES.maxPlayers - 2);
    expect(a.net!.state!.players.get(b.sessionId)).toBeDefined();
    expect(b.net!.state!.players.get(a.sessionId)).toBeDefined();

    await a.leave();
    await b.leave();
    expect(a.status.kind).toBe("idle");
  }, 20_000);

  it("puts a private host and a guest with the code in their own room", async () => {
    const host = sessionFor("u_echo", []);
    const guest = sessionFor("u_foxtrot", []);
    const stranger = sessionFor("u_golf", []);

    // The memory API mints a code like the real one; the guest types it.
    const code = await host.createPrivate();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    await guest.joinPrivate(code!.toLowerCase());
    await stranger.quickMatch();
    await until(() => {
      host.refresh();
      return host.status.kind === "waiting" && host.status.humans === 2;
    });

    expect(host.status).toMatchObject({ lobby: `private_${code}` });
    expect(host.net!.state!.players.get(guest.sessionId)).toBeDefined();
    expect(host.net!.state!.players.get(stranger.sessionId)).toBeUndefined();

    await Promise.all([host.leave(), guest.leave(), stranger.leave()]);
  }, 20_000);

  it("reports a signed-out ticket request as a sign-in prompt", async () => {
    const session = new OnlineSession({
      apiBase: gatewayOrigin,
      buildVersion: "test",
      platform: "web",
    });
    await session.quickMatch();
    expect(session.status).toMatchObject({ kind: "error", code: "unauthorized", signIn: true });
  });
});
