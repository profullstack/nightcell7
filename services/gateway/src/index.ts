import { z } from "zod";
import {
  HealthReporter,
  baseEnvSchema,
  createLogger,
  installGracefulShutdown,
  parseEnv,
} from "@nightcell7/observability";
import { UPSTREAM } from "./routes";
import { createGatewayServer } from "./server";

/**
 * Public gateway daemon (PRD §18.7).
 *
 * The only service with a public Railway domain. It terminates HTTPS/WSS at the
 * platform edge, routes to private services, and — critically — never lets an
 * internal Railway hostname reach a browser as a stable contract.
 *
 * Implemented as a small auditable proxy rather than pulling in a general
 * proxy library: the surface that forwards WebSocket upgrades and rewrites
 * client-controlled headers is exactly the surface worth reading in full.
 */

const envSchema = baseEnvSchema.extend({
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  SITE_UPSTREAM: z.string().url(),
  GAME_UPSTREAM: z.string().url(),
  API_UPSTREAM: z.string().url(),
  MULTIPLAYER_UPSTREAM: z.string().url(),
  MAINTENANCE_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Bodies larger than this are refused before reaching a service. */
  MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024),
});

const env = parseEnv(envSchema);
const isProduction = env.NODE_ENV === "production";

const logger = createLogger({
  service: "gateway",
  level: env.LOG_LEVEL,
  buildVersion: env.BUILD_VERSION,
});
const health = new HealthReporter("gateway", env.BUILD_VERSION);

const server = createGatewayServer({
  upstreams: {
    [UPSTREAM.SITE]: new URL(env.SITE_UPSTREAM),
    [UPSTREAM.GAME]: new URL(env.GAME_UPSTREAM),
    [UPSTREAM.API]: new URL(env.API_UPSTREAM),
    [UPSTREAM.MULTIPLAYER]: new URL(env.MULTIPLAYER_UPSTREAM),
  },
  isProduction,
  maintenance: env.MAINTENANCE_MODE,
  logger,
  health,
});

server.listen(env.GATEWAY_PORT, () => {
  health.setReady(true, { port: env.GATEWAY_PORT });
  logger.info("gateway listening", {
    port: env.GATEWAY_PORT,
    publicOrigin: env.PUBLIC_ORIGIN,
    maintenance: env.MAINTENANCE_MODE,
  });
});

installGracefulShutdown({
  logger,
  health,
  onShutdown: async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  },
});
