import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDatabase, closeDatabase } from "./client";

/**
 * Migration runner.
 *
 * PRD §17.6: migrations run as an explicit pre-deploy or controlled release
 * step, never concurrently from every replica. This is invoked by the release
 * pipeline, not by a service at boot.
 *
 * Applies the Postgres migrations in ../drizzle-pg. The ../drizzle folder is
 * the libSQL history kept for reference until the cutover is proven.
 */
async function main(): Promise<void> {
  const database = getDatabase();
  await migrate(database, { migrationsFolder: new URL("../drizzle-pg", import.meta.url).pathname });
  console.log(JSON.stringify({ level: "info", msg: "migrations applied" }));
  await closeDatabase();
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", msg: "migration failed", error: String(error) }));
  process.exit(1);
});
