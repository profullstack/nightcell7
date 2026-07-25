import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * Turso/libSQL connection (PRD §17.1).
 *
 * A single shared client per process. Services import `getDatabase()` rather
 * than constructing their own so connection settings cannot drift between the
 * API, the worker and the cron commands.
 */

export type Database = LibSQLDatabase<typeof schema>;

let client: Client | undefined;
let database: Database | undefined;

export interface DatabaseConfig {
  url: string;
  authToken?: string;
}

export function getDatabase(config?: DatabaseConfig): Database {
  if (database) return database;

  const url = config?.url ?? process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is required");
  const authToken = config?.authToken ?? process.env.TURSO_AUTH_TOKEN;

  client = createClient(authToken ? { url, authToken } : { url });
  database = drizzle(client, { schema });
  return database;
}

/** Graceful shutdown hook for SIGTERM handling (PRD §17.6). */
export async function closeDatabase(): Promise<void> {
  client?.close();
  client = undefined;
  database = undefined;
}

export { schema };
