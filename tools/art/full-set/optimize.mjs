/** Compact vertex storage without a runtime decoder or texture duplication. */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, weld, quantize } from "@gltf-transform/functions";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const input = resolve(process.argv[2] ?? "build/full-art/output");
const output = resolve(process.argv[3] ?? "apps/game/public/assets/models");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest = JSON.parse(await readFile(join(input, "overhaul-manifest.json"), "utf8"));
await mkdir(output, { recursive: true });
for (const file of (await readdir(join(input, "models")))
  .filter((f) => f.endsWith(".glb"))
  .sort()) {
  const doc = await io.read(join(input, "models", file));
  await doc.transform(
    dedup(),
    weld(),
    quantize({
      quantizePosition: 16,
      quantizeNormal: 12,
      quantizeTexcoord: 16,
      quantizeWeight: 16,
      cleanup: true,
    }),
  );
  const bytes = await io.writeBinary(doc);
  await writeFile(join(output, file), bytes);
  const entry = manifest.models[file.replace(".glb", "")];
  entry.bytes = bytes.byteLength;
  entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`OPTIMIZED ${file} ${bytes.byteLength}`);
}
manifest.optimization =
  "glTF Transform 4.5.0: dedup, weld, 16-bit positions/weights, 12-bit normals; UVs retain full precision outside 0-1; KHR_mesh_quantization";
await writeFile(join(input, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  "TOTAL",
  Object.values(manifest.models).reduce((n, m) => n + m.bytes, 0),
);
