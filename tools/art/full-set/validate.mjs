import { validateBytes } from "gltf-validator";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const assets = resolve(process.argv[2] ?? "apps/game/public/assets");
const manifest = JSON.parse(await readFile(join(assets, "art-manifest.json"), "utf8"));
const result = [];
for (const [name, entry] of Object.entries(manifest.models)) {
  const bytes = await readFile(join(assets, "models", `${name}.glb`));
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const report = await validateBytes(bytes, { uri: `${name}.glb`, maxIssues: 100 });
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `${name} hash`);
  assert.ok(name.startsWith("m3_") || name === "m2_carbine_fp", `${name} is a retired asset`);
  assert.equal(doc.images?.length ?? 0, 0, `${name} embeds textures`);
  assert.equal(report.issues.numErrors, 0, `${name}: ${JSON.stringify(report.issues)}`);
  for (const mesh of doc.meshes)
    for (const prim of mesh.primitives) {
      if (mesh.name?.startsWith("COL_")) continue;
      assert.ok(prim.attributes.NORMAL !== undefined, `${name} normals`);
      assert.ok(prim.attributes.TEXCOORD_0 !== undefined, `${name} UVs`);
      assert.equal(prim.attributes.TEXCOORD_1, undefined, `${name} duplicate UVs`);
    }
  result.push({
    name,
    bytes: bytes.length,
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    issues: report.issues.messages,
  });
}
assert.equal(result.length, 28);
assert.equal(manifest.legacyGeometry, false);
await writeFile(resolve("build/iron-rain/validation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({
    models: result.length,
    errors: result.reduce((n, r) => n + r.errors, 0),
    warnings: result.reduce((n, r) => n + r.warnings, 0),
    bytes: result.reduce((n, r) => n + r.bytes, 0),
  }),
);
