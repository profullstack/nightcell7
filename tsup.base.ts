import type { Options } from "tsup";

/**
 * Shared bundling config for the Node services.
 *
 * Workspace packages ship TypeScript source, so they must be bundled INTO each
 * service rather than left as runtime imports — that is what lets a Railway
 * image be a single self-contained `dist/index.js` (PRD §17.2, §33.4).
 */
export const serviceBuild: Options = {
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  splitting: false,
  sourcemap: true,
  // Everything under the workspace scope is inlined; third-party deps stay
  // external and are installed from the lockfile.
  noExternal: [/^@nightcell7\//],
};
