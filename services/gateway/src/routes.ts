/**
 * Public route table for `nightcell7.com` (PRD §17.5).
 *
 * Precedence is the whole point of this file, and it is pure so it can be
 * tested without a socket:
 *
 *   /api/v1/multiplayer/sync/*  -> multiplayer   (evaluated FIRST)
 *   /api/v1/*                   -> api
 *   /play/*                     -> game-web
 *   /*                          -> site
 *
 * If the general `/api/v1/*` rule were evaluated first, every WebSocket
 * upgrade would be swallowed by ordinary API middleware — which is exactly the
 * failure PRD §29.2 calls out.
 */

export const UPSTREAM = {
  SITE: "site",
  GAME: "game",
  API: "api",
  MULTIPLAYER: "multiplayer",
} as const;

export type UpstreamName = (typeof UPSTREAM)[keyof typeof UPSTREAM];

export interface RouteMatch {
  upstream: UpstreamName;
  /** True when this route is expected to carry a WebSocket upgrade. */
  websocket: boolean;
  /** Immutable static content may be cached at the edge; APIs never are. */
  cacheable: boolean;
}

export const MULTIPLAYER_SYNC_PREFIX = "/api/v1/multiplayer/sync/";
export const API_PREFIX = "/api/v1/";
export const GAME_PREFIX = "/play";

/**
 * Resolve a request path to an upstream.
 *
 * The path must already be normalised (see `normalizePath`) — a request for
 * `/api/v1/../play` must not be able to pick a different upstream than the one
 * the URL appears to name.
 */
export function resolveRoute(pathname: string): RouteMatch {
  if (pathname === "/api/v1/multiplayer/sync" || pathname.startsWith(MULTIPLAYER_SYNC_PREFIX)) {
    return { upstream: UPSTREAM.MULTIPLAYER, websocket: true, cacheable: false };
  }

  if (pathname === "/api/v1" || pathname.startsWith(API_PREFIX)) {
    // Authenticated APIs, CoinPay webhooks and matchmaking responses are never
    // cached (PRD §22.5).
    return { upstream: UPSTREAM.API, websocket: false, cacheable: false };
  }

  if (pathname === GAME_PREFIX || pathname.startsWith(`${GAME_PREFIX}/`)) {
    return { upstream: UPSTREAM.GAME, websocket: false, cacheable: true };
  }

  return { upstream: UPSTREAM.SITE, websocket: false, cacheable: true };
}

/**
 * Normalise a request path before routing.
 *
 * Collapses `.` and `..` segments and duplicate slashes so path traversal
 * cannot be used to reach an upstream the visible URL does not name.
 */
export function normalizePath(rawPath: string): string {
  const [pathOnly] = rawPath.split("?");
  const decoded = safeDecode(pathOnly ?? "/");
  const segments: string[] = [];

  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Health endpoints the gateway answers itself, never proxied. */
export const GATEWAY_LOCAL_PATHS = new Set(["/health/live", "/health/ready"]);

export function isGatewayLocal(pathname: string): boolean {
  return GATEWAY_LOCAL_PATHS.has(pathname);
}

/**
 * Hop-by-hop headers that must not be forwarded verbatim.
 * `upgrade` and `connection` are handled explicitly by the upgrade path.
 */
export const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Headers a client is never allowed to set — the gateway is the only thing
 * permitted to assert them, and downstream services trust them (PRD §33.1).
 */
export const CLIENT_SPOOFABLE_HEADERS = new Set([
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "x-nightcell-internal",
]);

export function sanitizeInboundHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const output: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (CLIENT_SPOOFABLE_HEADERS.has(lower)) continue;
    output[lower] = value;
  }
  return output;
}

/** Security headers applied to every proxied response (PRD §33.1). */
export function securityHeaders(isProduction: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=()",
  };
  if (isProduction) {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}
