import { migrate } from "drizzle-orm/libsql/migrator";
import { getDatabase } from "./client";

/**
 * Migration runner.
 *
 * PRD §17.6: migrations run as an explicit pre-deploy or controlled release
 * step, never concurrently from every replica. This is invoked by the release
 * pipeline, not by a service at boot.
 */
async function main(): Promise<void> {
  const database = getDatabase();
  await migrate(database, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log(JSON.stringify({ level: "info", msg: "migrations applied" }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", msg: "migration failed", error: String(error) }));
  process.exit(1);
});
