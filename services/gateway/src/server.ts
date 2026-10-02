import http from "node:http";
import type net from "node:net";
import { CORRELATION_HEADER, newCorrelationId } from "@nightcell7/observability";
import type { HealthReporter, Logger } from "@nightcell7/observability";
import {
  UPSTREAM,
  isGatewayLocal,
  normalizePath,
  resolveRoute,
  sanitizeInboundHeaders,
  securityHeaders,
  type UpstreamName,
} from "./routes";

export interface GatewayOptions {
  upstreams: Record<UpstreamName, URL>;
  isProduction: boolean;
  maintenance: boolean;
  logger: Logger;
  health: HealthReporter;
}

/**
 * The gateway's HTTP + WebSocket-upgrade proxy, separated from env parsing and
 * `listen` so the whole public path (client -> gateway -> api/multiplayer) can
 * be exercised end to end in a test.
 */
export function createGatewayServer(options: GatewayOptions): http.Server {
  const { upstreams, isProduction, maintenance, logger, health } = options;

  const server = http.createServer((req, res) => {
    const correlationId = (req.headers[CORRELATION_HEADER] as string) || newCorrelationId();
    const pathname = normalizePath(req.url ?? "/");

    for (const [key, value] of Object.entries(securityHeaders(isProduction))) {
      res.setHeader(key, value);
    }
    res.setHeader(CORRELATION_HEADER, correlationId);

    if (isGatewayLocal(pathname)) {
      const body = pathname === "/health/live" ? health.live() : health.ready();
      res.writeHead(health.draining && pathname === "/health/ready" ? 503 : 200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
      return;
    }

    const route = resolveRoute(pathname);

    // Maintenance mode still serves the marketing site so players see a real
    // page rather than a platform error (PRD §18.7).
    if (maintenance && route.upstream !== UPSTREAM.SITE) {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "maintenance", message: "NIGHTCELL 7 is briefly offline." }));
      return;
    }

    if (!route.cacheable) res.setHeader("cache-control", "no-store");

    proxyHttp(req, res, route.upstream, correlationId);
  });

  function proxyHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    upstream: UpstreamName,
    correlationId: string,
  ): void {
    const target = upstreams[upstream];
    const headers = buildForwardHeaders(req, correlationId);

    const proxyReq = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        method: req.method,
        path: req.url,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.setTimeout(30_000, () => {
      proxyReq.destroy(new Error("upstream timeout"));
    });

    proxyReq.on("error", (error) => {
      logger.error("upstream request failed", {
        upstream,
        correlationId,
        // The upstream host is internal; log the name, never the hostname.
        error: error.message,
      });
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
      }
      res.end(JSON.stringify({ error: "upstream_unavailable", correlationId }));
    });

    req.pipe(proxyReq);
  }

  /**
   * WebSocket upgrade forwarding.
   *
   * The `Upgrade` and `Connection` headers must survive intact, and the ticket in
   * the query string must never be logged (PRD §33.3).
   */
  server.on("upgrade", (req, socket, head) => {
    const pathname = normalizePath(req.url ?? "/");
    const route = resolveRoute(pathname);
    const correlationId = (req.headers[CORRELATION_HEADER] as string) || newCorrelationId();

    if (!route.websocket) {
      // Only the multiplayer sync route accepts an upgrade. Anything else trying
      // to open a socket is refused rather than proxied.
      socket.destroy();
      return;
    }

    if (health.draining) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }

    const target = upstreams[route.upstream];
    const headers = buildForwardHeaders(req, correlationId);
    headers["connection"] = "Upgrade";
    headers["upgrade"] = (req.headers.upgrade as string) ?? "websocket";

    const proxyReq = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: req.url,
      headers,
    });

    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      const responseHeaders = Object.entries(proxyRes.headers)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join("\r\n");

      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders}\r\n\r\n`);
      if (proxyHead?.length) proxySocket.unshift(proxyHead);

      proxySocket.on("error", () => socket.destroy());
      socket.on("error", () => proxySocket.destroy());

      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on("error", () => {
      logger.warn("websocket upgrade failed", { upstream: route.upstream, correlationId });
      socket.destroy();
    });

    if (head?.length) proxyReq.write(head);
    proxyReq.end();
  });

  function buildForwardHeaders(
    req: http.IncomingMessage,
    correlationId: string,
  ): Record<string, string | string[] | undefined> {
    // Strip anything the client could use to impersonate the gateway, then
    // assert the forwarding facts ourselves.
    const headers = sanitizeInboundHeaders(
      req.headers as Record<string, string | string[] | undefined>,
    );

    const remote = req.socket.remoteAddress ?? "";
    headers["x-forwarded-for"] = remote;
    headers["x-forwarded-proto"] = isProduction ? "https" : "http";
    headers["x-forwarded-host"] = (req.headers.host as string) ?? "";
    headers[CORRELATION_HEADER] = correlationId;
    headers["host"] = req.headers.host ?? "";

    return headers;
  }

  server.on("clientError", (_error, socket: net.Socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return server;
}
