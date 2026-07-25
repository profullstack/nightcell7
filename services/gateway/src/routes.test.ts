import { describe, expect, it } from "vitest";
import {
  CLIENT_SPOOFABLE_HEADERS,
  UPSTREAM,
  isGatewayLocal,
  normalizePath,
  resolveRoute,
  sanitizeInboundHeaders,
  securityHeaders,
} from "./routes";

describe("gateway route precedence", () => {
  it("routes the multiplayer sync path before the general API path", () => {
    const route = resolveRoute("/api/v1/multiplayer/sync/us-west/1/room_abc");
    expect(route.upstream).toBe(UPSTREAM.MULTIPLAYER);
    expect(route.websocket).toBe(true);
  });

  it("still routes other multiplayer API paths to the API service", () => {
    for (const path of [
      "/api/v1/multiplayer/status",
      "/api/v1/multiplayer/tickets",
      "/api/v1/multiplayer/matchmaking/join",
      "/api/v1/multiplayer/profile",
    ]) {
      const route = resolveRoute(path);
      expect(route.upstream, path).toBe(UPSTREAM.API);
      expect(route.websocket, path).toBe(false);
    }
  });

  it("routes the rest of the API surface to the API service", () => {
    for (const path of [
      "/api/v1/catalog",
      "/api/v1/me/entitlements",
      "/api/v1/checkout/coinpay",
      "/api/v1/webhooks/coinpay",
    ]) {
      expect(resolveRoute(path).upstream, path).toBe(UPSTREAM.API);
    }
  });

  it("routes /play to the game build and everything else to the site", () => {
    expect(resolveRoute("/play").upstream).toBe(UPSTREAM.GAME);
    expect(resolveRoute("/play/assets/shell.js").upstream).toBe(UPSTREAM.GAME);
    expect(resolveRoute("/").upstream).toBe(UPSTREAM.SITE);
    expect(resolveRoute("/episodes/false-dawn").upstream).toBe(UPSTREAM.SITE);
    expect(resolveRoute("/multiplayer").upstream).toBe(UPSTREAM.SITE);
  });

  it("does not treat a lookalike prefix as the game route", () => {
    expect(resolveRoute("/players").upstream).toBe(UPSTREAM.SITE);
    expect(resolveRoute("/playground").upstream).toBe(UPSTREAM.SITE);
  });

  it("never marks API or multiplayer responses as cacheable", () => {
    expect(resolveRoute("/api/v1/me").cacheable).toBe(false);
    expect(resolveRoute("/api/v1/multiplayer/sync/us-west/1/r").cacheable).toBe(false);
    expect(resolveRoute("/").cacheable).toBe(true);
  });

  it("only permits a WebSocket upgrade on the sync route", () => {
    expect(resolveRoute("/api/v1/multiplayer/sync/a/b/c").websocket).toBe(true);
    expect(resolveRoute("/api/v1/catalog").websocket).toBe(false);
    expect(resolveRoute("/play").websocket).toBe(false);
    expect(resolveRoute("/").websocket).toBe(false);
  });
});

describe("path normalisation", () => {
  it("collapses traversal so a URL cannot reach an unintended upstream", () => {
    expect(normalizePath("/api/v1/../../play")).toBe("/play");
    expect(normalizePath("/api/v1/../play")).toBe("/api/play");
    expect(normalizePath("/play/../api/v1/me")).toBe("/api/v1/me");
    expect(normalizePath("//api//v1//catalog")).toBe("/api/v1/catalog");
    expect(normalizePath("/./")).toBe("/");
  });

  it("cannot escape above the root", () => {
    expect(normalizePath("/../../../etc/passwd")).toBe("/etc/passwd");
  });

  it("decodes percent-encoded traversal before routing", () => {
    // %2e%2e is ".." — routing must see the real path, not the disguised one.
    expect(normalizePath("/api/v1/%2e%2e/%2e%2e/play")).toBe("/play");
  });

  it("drops the query string and survives malformed encoding", () => {
    expect(normalizePath("/api/v1/multiplayer/sync/a/b/c?ticket=abc")).toBe(
      "/api/v1/multiplayer/sync/a/b/c",
    );
    expect(() => normalizePath("/%E0%A4%A")).not.toThrow();
  });

  it("routes a normalised traversal path consistently", () => {
    // Walking out of the sync route lands on /api/play, which is NOT under
    // /api/v1/ and therefore must not reach the multiplayer or API upstream.
    const escaped = normalizePath("/api/v1/multiplayer/sync/../../../play");
    expect(escaped).toBe("/api/play");
    expect(resolveRoute(escaped).upstream).toBe(UPSTREAM.SITE);

    // And a path that normalises back into the API surface still routes there.
    const backIn = normalizePath("/play/../api/v1/me");
    expect(backIn).toBe("/api/v1/me");
    expect(resolveRoute(backIn).upstream).toBe(UPSTREAM.API);
  });
});

describe("header handling", () => {
  it("strips headers a client could use to impersonate the gateway", () => {
    const sanitized = sanitizeInboundHeaders({
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "1.2.3.4",
      "x-nightcell-internal": "yes",
      cookie: "nc7_session=abc",
      "user-agent": "test",
    });

    for (const header of CLIENT_SPOOFABLE_HEADERS) {
      expect(sanitized[header], header).toBeUndefined();
    }
    // Legitimate client headers survive.
    expect(sanitized["user-agent"]).toBe("test");
    expect(sanitized["cookie"]).toBe("nc7_session=abc");
  });

  it("strips hop-by-hop headers", () => {
    const sanitized = sanitizeInboundHeaders({
      connection: "keep-alive",
      upgrade: "websocket",
      "transfer-encoding": "chunked",
      accept: "text/html",
    });
    expect(sanitized["connection"]).toBeUndefined();
    expect(sanitized["upgrade"]).toBeUndefined();
    expect(sanitized["transfer-encoding"]).toBeUndefined();
    expect(sanitized["accept"]).toBe("text/html");
  });

  it("adds HSTS only in production", () => {
    expect(securityHeaders(true)["strict-transport-security"]).toBeDefined();
    expect(securityHeaders(false)["strict-transport-security"]).toBeUndefined();
    expect(securityHeaders(false)["x-content-type-options"]).toBe("nosniff");
  });
});

describe("gateway-local paths", () => {
  it("answers its own health checks rather than proxying them", () => {
    expect(isGatewayLocal("/health/live")).toBe(true);
    expect(isGatewayLocal("/health/ready")).toBe(true);
    expect(isGatewayLocal("/api/v1/health/live")).toBe(false);
  });
});
