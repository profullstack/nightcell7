import { z } from "zod";

/**
 * @nightcell7/observability
 *
 * Structured JSON logging, environment validation and health reporting — the
 * three things PRD §17.6 requires of every long-running Railway service.
 */

// --------------------------------------------------------------------------
// Logging
// --------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Keys whose values are never written to the log stream.
 * PRD §33.3 specifically requires WebSocket query tickets to be redacted, and
 * §24.4 requires provider secrets and payer data to be kept out.
 */
const REDACTED_KEYS = new Set([
  "ticket",
  "token",
  "password",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "webhooksecret",
  "webhook_secret",
  "payeremail",
  "payer_email",
  "email",
]);

export const REDACTED = "[redacted]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    // Strip a ticket out of any URL-shaped string, wherever it appears.
    return value.replace(/([?&](?:ticket|token)=)[^&\s]+/gi, `$1${REDACTED}`);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(item, depth + 1);
  }
  return output;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  buildVersion?: string;
  /** Injected for tests. */
  sink?: (line: string) => void;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Derive a logger that stamps every line with the same correlation id. */
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(options: LoggerOptions): Logger {
  const minimum = LEVEL_ORDER[options.level ?? "info"];
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));

  function make(bound: Record<string, unknown>): Logger {
    function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
      if (LEVEL_ORDER[level] < minimum) return;
      const line = {
        level,
        time: new Date().toISOString(),
        service: options.service,
        build: options.buildVersion,
        msg,
        ...(redact({ ...bound, ...fields }) as Record<string, unknown>),
      };
      sink(JSON.stringify(line));
    }

    return {
      debug: (msg, fields) => emit("debug", msg, fields),
      info: (msg, fields) => emit("info", msg, fields),
      warn: (msg, fields) => emit("warn", msg, fields),
      error: (msg, fields) => emit("error", msg, fields),
      child: (fields) => make({ ...bound, ...fields }),
    };
  }

  return make({});
}

// --------------------------------------------------------------------------
// Correlation ids
// --------------------------------------------------------------------------

export const CORRELATION_HEADER = "x-nightcell-correlation-id";

export function newCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}

// --------------------------------------------------------------------------
// Environment validation
// --------------------------------------------------------------------------

/**
 * Validate a service's environment at boot.
 *
 * PRD §17.6: "no production startup with missing secrets". This throws rather
 * than warning, so a misconfigured deploy fails its health check instead of
 * serving broken behaviour.
 */
export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid environment: ${problems}`);
  }
  return result.data;
}

/** Shared base every service extends. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:8080"),
  BUILD_VERSION: z.string().default("0.0.0-dev"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

// --------------------------------------------------------------------------
// Health
// --------------------------------------------------------------------------

export interface HealthState {
  /** Process is up. Fails only when the runtime is broken. */
  live: boolean;
  /** Dependencies are usable and the service should receive traffic. */
  ready: boolean;
  /** Set during SIGTERM so the platform stops routing new work here. */
  draining: boolean;
  details: Record<string, unknown>;
}

export class HealthReporter {
  private state: HealthState = { live: true, ready: false, draining: false, details: {} };

  constructor(
    readonly service: string,
    readonly buildVersion: string,
    readonly protocolVersion?: number,
  ) {}

  setReady(ready: boolean, details: Record<string, unknown> = {}): void {
    this.state = { ...this.state, ready, details: { ...this.state.details, ...details } };
  }

  beginDraining(): void {
    this.state = { ...this.state, draining: true, ready: false };
  }

  get draining(): boolean {
    return this.state.draining;
  }

  live(): { status: string; service: string; build: string } {
    return {
      status: this.state.live ? "ok" : "down",
      service: this.service,
      build: this.buildVersion,
    };
  }

  ready(): {
    status: string;
    service: string;
    build: string;
    protocolVersion?: number;
    details: Record<string, unknown>;
  } {
    return {
      status: this.state.draining ? "draining" : this.state.ready ? "ok" : "starting",
      service: this.service,
      build: this.buildVersion,
      protocolVersion: this.protocolVersion,
      details: this.state.details,
    };
  }
}

// --------------------------------------------------------------------------
// Graceful shutdown (PRD §17.6, §30.5)
// --------------------------------------------------------------------------

export interface ShutdownOptions {
  logger: Logger;
  health: HealthReporter;
  /** Hard deadline; the process exits even if a handler hangs. */
  timeoutMs?: number;
  onShutdown: () => Promise<void> | void;
}

export function installGracefulShutdown(options: ShutdownOptions): void {
  const timeoutMs = options.timeoutMs ?? 15_000;
  let shuttingDown = false;

  const handler = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    options.logger.info("shutdown signal received", { signal });
    options.health.beginDraining();

    const timer = setTimeout(() => {
      options.logger.error("shutdown timed out; forcing exit", { timeoutMs });
      process.exit(1);
    }, timeoutMs);
    timer.unref?.();

    void (async () => {
      try {
        await options.onShutdown();
        options.logger.info("shutdown complete");
        process.exit(0);
      } catch (error) {
        options.logger.error("shutdown failed", { error: String(error) });
        process.exit(1);
      }
    })();
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}
