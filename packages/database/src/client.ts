import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Postgres connection (PRD §17.1).
 *
 * A single shared pool per process. Services import `getDatabase()` rather
 * than constructing their own so connection settings cannot drift between the
 * API, the worker and the cron commands.
 */

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let database: Database | undefined;

export interface DatabaseConfig {
  /** postgres:// or postgresql:// connection string. */
  url: string;
  /** Upper bound on pooled connections; pg's default is 10. */
  maxConnections?: number;
}

/** Postgres and nothing else: no file fallback, no libSQL. */
function assertPostgresUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      "DATABASE_URL is required (postgres://host:5432/nightcell7). " +
        "The database moved from Turso to Postgres; TURSO_DATABASE_URL is no longer read.",
    );
  }
  const scheme = url.split(":")[0]?.toLowerCase();
  if (scheme !== "postgres" && scheme !== "postgresql") {
    throw new Error(
      `DATABASE_URL must be postgres:// or postgresql://, got "${scheme}:". ` +
        "Turso/libSQL and file databases are no longer supported; move the rows first with " +
        "`npx libsql-pg copy --from <libsql url> --token <token> --to <postgres url> --verify` " +
        "and point DATABASE_URL at Postgres.",
    );
  }
  return url;
}

export function getDatabase(config?: DatabaseConfig): Database {
  if (database) return database;

  const url = assertPostgresUrl(config?.url ?? process.env.DATABASE_URL);
  pool = new pg.Pool({
    connectionString: url,
    max: config?.maxConnections ?? 10,
    application_name: "nightcell7",
  });
  // An idle connection dropped by the server is not fatal; the next query
  // checks out a fresh one.
  pool.on("error", () => {});
  database = drizzle(pool, { schema });
  return database;
}

/** Graceful shutdown hook for SIGTERM handling (PRD §17.6). */
export async function closeDatabase(): Promise<void> {
  const closing = pool;
  pool = undefined;
  database = undefined;
  await closing?.end();
}

export { schema };
