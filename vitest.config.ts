import { defineConfig } from "vitest/config";
import { soundtrack } from "./apps/game/vite-plugin-soundtrack";

/**
 * One test runner for the whole repository. Package-local `vitest.config.ts`
 * files are intentionally avoided so a protocol change and its client/server
 * tests always run together in a single command (PRD §17.2).
 */
export default defineConfig({
  // `apps/game/src/audio.ts` imports the `virtual:soundtrack` glob, so the
  // runner has to resolve it too — otherwise importing the module under test
  // fails before a single assertion runs.
  plugins: [soundtrack()],
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
