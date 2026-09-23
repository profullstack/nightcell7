import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * The soundtrack, discovered by scanning rather than listed by hand.
 *
 * Music lives in `public/`, which Vite copies verbatim and therefore does not
 * expose to `import.meta.glob` — so the glob has to happen on the Node side and
 * reach the client as a virtual module.
 *
 * The alternative was a hard-coded array in `src/audio.ts`, which made every
 * new track a code change, or `manifest.json`, which is only rewritten by
 * `pnpm assets:build` — a Blender-dependent step no one should have to run to
 * add a song. Dropping an `.mp3` into `public/audio/music/<artist>/`, or an
 * album folder beneath it, is now the whole procedure.
 *
 * Only paths are emitted. Turning them into titles and artist names is
 * `audio.ts`'s job, so those rules stay unit-testable without a build.
 *
 * Lives in its own file because the test runner needs it too: `audio.ts`
 * imports the virtual module, so a config that cannot resolve it cannot import
 * the module under test.
 */
export function soundtrack(): Plugin {
  const VIRTUAL = "virtual:soundtrack";
  const RESOLVED = `\0${VIRTUAL}`;
  const root = fileURLToPath(new URL("./public/audio/music", import.meta.url));

  /**
   * `<artist>/<song>.mp3` or `<artist>/<album>/<song>.mp3`, sorted, so a build
   * is reproducible. An album folder is walked like any other: the artist is
   * always the first segment and the song the last.
   */
  const scan = (): string[] => {
    if (!existsSync(root)) return [];
    const walk = (dir: string, prefix: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return walk(join(dir, entry.name), relative);
        // Loose files at the top level have no artist folder, so they are skipped.
        return prefix && entry.name.toLowerCase().endsWith(".mp3") ? [relative] : [];
      });
    return walk(root, "").sort();
  };

  return {
    name: "nc7-soundtrack",
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
    load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(scan())};` : undefined),
    configureServer(server) {
      // Adding a track during `pnpm dev` should not need a restart.
      const invalidate = (path: string) => {
        if (!path.startsWith(root)) return;
        const module = server.moduleGraph.getModuleById(RESOLVED);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.add(root);
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);
    },
  };
}
