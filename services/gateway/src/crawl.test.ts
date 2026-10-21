import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthReporter, createLogger } from "@nightcell7/observability";
import { createCrawlGate } from "./crawl";
import { createGatewayServer } from "./server";

const env = {
  COINPAY_X402_KEY: "cp_live_test",
  CRAWL_PAY_TO: "0xCC3b072391AE7A8d10cF00DdC5F61DB2cA5541E5",
} as NodeJS.ProcessEnv;

const GPTBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const HUMAN = {
  "user-agent": CHROME,
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-dest": "document",
  "x-real-ip": "198.51.100.7",
};

let upstream: http.Server;
let gateway: http.Server;
let origin = "";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

beforeAll(async () => {
  upstream = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>site</h1>");
  });
  const port = await listen(upstream);
  const target = new URL(`http://127.0.0.1:${port}`);
  gateway = createGatewayServer({
    upstreams: { site: target, game: target, api: target, multiplayer: target },
    isProduction: false,
    maintenance: false,
    logger: createLogger({ service: "test", level: "error", sink: () => {} }),
    health: new HealthReporter("gateway", "test"),
    crawlGate: createCrawlGate(env),
  });
  origin = `http://127.0.0.1:${await listen(gateway)}`;
});

afterAll(async () => {
  await new Promise((resolve) => gateway.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});

describe("crawl gate", () => {
  it("is off without a key", () => {
    expect(createCrawlGate({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("answers a training crawler 402 with PAYMENT-REQUIRED", async () => {
    const res = await fetch(`${origin}/`, {
      headers: { "user-agent": GPTBOT, accept: "application/json", "x-real-ip": "203.0.113.9" },
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-required")).toBeTruthy();
  });

  it("sells a day pass at /crawl", async () => {
    const res = await fetch(`${origin}/crawl`, {
      headers: { "user-agent": "x402-test/1.0", accept: "application/json" },
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-required")).toBeTruthy();
    const body = (await res.json()) as { accepts: { amount: string }[] };
    expect(String(body.accepts[0]?.amount)).toBe("1000000");
  });

  it("lets a browser through to the site", async () => {
    const res = await fetch(`${origin}/`, { headers: HUMAN });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("site");
  });

  it("never charges the health checks or the API", async () => {
    const ready = await fetch(`${origin}/health/ready`, { headers: { "user-agent": GPTBOT } });
    expect(ready.status).not.toBe(402);
    const api = await fetch(`${origin}/api/v1/catalog`, { headers: { "user-agent": GPTBOT } });
    expect(api.status).toBe(200);
  });
});
