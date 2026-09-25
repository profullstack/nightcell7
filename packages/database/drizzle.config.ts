import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle-pg",
  dialect: "postgresql",
  dbCredentials: {
    // `generate` never connects; the URL only matters for push/studio.
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/nightcell7",
  },
} satisfies Config;
