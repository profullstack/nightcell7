import type http from "node:http";
import { createGateway } from "@profullstack/x402-gateway";

/**
 * The crawl door: training crawlers (GPTBot, CCBot, ...) are answered 402 with
 * an x402 offer for a $1 day pass, and /crawl sells that pass (USDC by x402 or
 * a CoinPay checkout for humans). Browsers, verified search crawlers and AI
 * chat fetchers pass straight through; that is the gateway's default.
 *
 * Off unless both COINPAY_X402_KEY and CRAWL_PAY_TO are set, so local dev and
 * tests that do not ask for it never see it.
 */
export interface CrawlGate {
  handle: (request: Request) => Promise<Response | null>;
}

const SESSION_COOKIE = /(?:^|;\s*)nc7_session=/;

export function createCrawlGate(env: NodeJS.ProcessEnv = process.env): CrawlGate | null {
  const apiKey = env["COINPAY_X402_KEY"] ?? "";
  const payTo = env["CRAWL_PAY_TO"] ?? "";
  if (!apiKey || !payTo) return null;
  const siteUrl = (env["SITE_URL"] || "https://nightcell7.com").replace(/\/+$/, "");
  return createGateway({
    siteUrl,
    siteName: "NIGHTCELL 7",
    coinpay: { apiKey },
    payTo,
    contact: "mailto:anthony@profullstack.com",
    // Health checks, the API (game clients, CoinPay webhooks, matchmaking),
    // static build assets and the crawl manifests are never charged.
    openPaths: [
      "/health/live",
      "/health/ready",
      "/api/v1",
      "/api/v1/",
      "/_next/",
      "/robots.txt",
      "/sitemap.xml",
      "/llms.txt",
      "/.well-known/",
      "/favicon.ico",
    ],
    exempt: (request: Request) => SESSION_COOKIE.test(request.headers.get("cookie") ?? ""),
  });
}

/** Does the gateway need the request body to answer this? Only the checkout POST. */
export function needsBody(method: string | undefined, pathname: string): boolean {
  return method === "POST" && pathname.startsWith("/crawl");
}

/** A fetch Request built from the raw inbound Node request (before header sanitising). */
export function requestFor(req: http.IncomingMessage, body?: Buffer): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  if (!headers.has("x-real-ip") && !headers.has("x-forwarded-for") && req.socket?.remoteAddress) {
    headers.set("x-forwarded-for", req.socket.remoteAddress);
  }
  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (body && method !== "GET" && method !== "HEAD") init.body = new Uint8Array(body);
  return new Request(`http://localhost${req.url ?? "/"}`, init);
}

export function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Write the gateway's answer back through the Node response. */
export async function answerWith(res: http.ServerResponse, answer: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  answer.headers.forEach((value, name) => {
    if (name === "set-cookie") return;
    headers[name] = value;
  });
  const cookies = answer.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(answer.status, headers);
  res.end(Buffer.from(await answer.arrayBuffer()));
}
