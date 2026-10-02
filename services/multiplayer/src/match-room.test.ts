import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import {
  CONTENT_VERSION,
  PROTOCOL_VERSION,
  SERVER_MESSAGE,
  type MatchState,
} from "@nightcell7/multiplayer-protocol";
import { createTicketId, signTicket } from "@nightcell7/multiplayer-protocol/ticket";
import { TDM_RULES } from "@nightcell7/game-core";
import { createLogger } from "@nightcell7/observability";
import { MatchRoom } from "./match-room";
import { createMemoryRoomServices } from "./services";

/**
 * Two real clients join one room over a real socket. The room encodes its
 * full state for each joiner and broadcasts patches every tick, which is
 * exactly where the process used to die (`type[Symbol.metadata]`).
 */

const TICKET_SECRET = "test-ticket-secret-0123456789";
const REGION = "test";
const SHARD = "1";

let gameServer: Server;
let endpoint: string;
const tickets = new Set<string>();

function mintTicket(lobby: string, sub: string, team: number): string {
  const jti = createTicketId();
  tickets.add(jti);
  const now = Math.floor(Date.now() / 1000);
  return signTicket(
    {
      jti,
      sub,
      displayName: sub,
      matchId: `match_${sub}`,
      roomId: lobby,
      region: REGION,
      shard: SHARD,
      mode: TDM_RULES.mode,
      team,
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      iat: now,
      exp: now + 60,
    },
    TICKET_SECRET,
  );
}

function joinOptions(lobby: string, ticket: string) {
  return {
    region: REGION,
    shard: SHARD,
    lobby,
    ticket,
    buildVersion: "test",
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
    platform: "web",
  };
}

async function join(lobby: string, sub: string, team: number): Promise<Room<MatchState>> {
  const client = new Client(endpoint);
  const room = await client.joinOrCreate<MatchState>(
    TDM_RULES.mode,
    joinOptions(lobby, mintTicket(lobby, sub, team)),
  );
  // Swallow the server's welcome; the assertion is on synced state.
  room.onMessage(SERVER_MESSAGE.WELCOME, () => {});
  room.onMessage("*", () => {});
  return room;
}

beforeAll(async () => {
  // Colyseus loads @pm2/io, which reports metrics with `process.send({ type,
  // data })` whenever an IPC channel exists. Inside vitest's forked worker that
  // channel belongs to vitest, which only understands serialised Buffers and
  // fails the run on anything else, so drop pm2's messages here.
  const send = process.send?.bind(process);
  if (send) {
    process.send = ((message: unknown, ...rest: never[]) =>
      Buffer.isBuffer(message) ? send(message, ...rest) : true) as typeof process.send;
  }

  const httpServer = http.createServer();
  gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer
    .define(TDM_RULES.mode, MatchRoom, {
      services: createMemoryRoomServices({ tickets }),
      logger: createLogger({ service: "multiplayer-test", level: "error", buildVersion: "test" }),
      region: REGION,
      shard: SHARD,
      buildVersion: "test",
      ticketSecret: TICKET_SECRET,
      matchResultSecret: "test-result-secret-0123456789",
      botFill: true,
    })
    .filterBy(["region", "shard"]);
  await gameServer.listen(0);
  endpoint = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await gameServer.gracefullyShutdown(false);
});

describe("MatchRoom join", () => {
  it("lets two players join a match and receive synced state", async () => {
    // No pre-created room: the first ticket holder creates it, the second
    // finds it through the region/shard/lobby filter.
    const a = await join("quick", "player-a", 0);
    const b = await join("quick", "player-b", 1);
    expect(b.roomId).toBe(a.roomId);

    // Let several ticks and patches go out to both clients.
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (const room of [a, b]) {
      expect(room.state.players.get(a.sessionId)?.displayName).toBe("player-a");
      expect(room.state.players.get(b.sessionId)?.displayName).toBe("player-b");
      expect(room.state.teams.length).toBe(2);
      expect(room.connection.isOpen).toBe(true);
    }

    // A ticket for another lobby cannot be used to enter this room by id.
    await expect(
      new Client(endpoint).joinById(
        a.roomId,
        joinOptions("quick", mintTicket("private_ABCD", "player-c", 0)),
      ),
    ).rejects.toThrow(/ticket_invalid/);

    await a.leave(true);
    await b.leave(true);
  }, 20_000);

  it("refuses to create a room without a valid ticket", async () => {
    await expect(
      new Client(endpoint).joinOrCreate(
        TDM_RULES.mode,
        joinOptions("private_NOPE", "x".repeat(32)),
      ),
    ).rejects.toThrow(/ticket_invalid/);
    expect(await matchMaker.query({ lobby: "private_NOPE" })).toHaveLength(0);
  });
});
