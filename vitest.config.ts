import { defineConfig } from "vitest/config";

/**
 * One test runner for the whole repository. Package-local `vitest.config.ts`
 * files are intentionally avoided so a protocol change and its client/server
 * tests always run together in a single command (PRD §17.2).
 */
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "services/**/*.test.ts",
      "apps/**/*.test.ts",
      "tools/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
    reporters: "default",
  },
});
