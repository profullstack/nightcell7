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
  // Native/dynamic-require modules must NOT be inlined. `libsql` ships a
  // native binding loaded via `require()`, which throws "Dynamic require is
  // not supported" the moment it lands in an ESM bundle. Bundling a workspace
  // package pulls its transitive deps in with it, so these have to be named
  // explicitly even though no service lists them directly.
  external: ["libsql", /^@libsql\//, /^@neon-rs\//, "better-sqlite3", "bufferutil", "utf-8-validate"],
};
