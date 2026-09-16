import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { cp, mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsup"))("esbuild");
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = process.argv[2] ? resolve(process.argv[2]) : resolve(root, "build/tactical-sample");
await mkdir(out, { recursive: true });
await build({
  entryPoints: [resolve(here, "viewer.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: resolve(out, "viewer.js"),
  nodePaths: [resolve(root, "apps/game/node_modules")],
  logLevel: "info",
  legalComments: "eof",
});
await cp(resolve(here, "index.html"), resolve(out, "index.html"));
for (const material of ["steel", "rubber", "concrete", "rust"]) {
  await mkdir(resolve(out, "textures"), { recursive: true });
  for (const kind of ["normal"])
    await cp(
      resolve(root, `apps/game/public/assets/textures/${material}_${kind}.webp`),
      resolve(out, `textures/${material}_${kind}.webp`),
    );
}

await cp(
  resolve(root, "apps/game/public/assets/textures/env_sky.webp"),
  resolve(out, "textures/env_sky.webp"),
);
