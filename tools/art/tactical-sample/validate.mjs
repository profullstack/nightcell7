/** Structural acceptance checks for the exported pack. No external dependencies. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const pack = resolve(process.argv[2] ?? "build/tactical-sample");
const manifest = JSON.parse(readFileSync(`${pack}/manifest.json`, "utf8"));
const results = [];
for (const entry of manifest.models) {
  const file = `${entry.name}.glb`,
    bytes = readFileSync(`${pack}/models/${file}`);
  assert.equal(bytes.toString("utf8", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const data = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.equal(data.images?.length ?? 0, 0, "GLB must not embed images");
  for (const m of data.materials ?? [])
    assert.ok(manifest.materials[m.name], `Unknown material ${m.name}`);
  let triangles = 0,
    visiblePrimitives = 0;
  for (const m of data.meshes) {
    if (m.name.startsWith("COL_")) continue;
    for (const p of m.primitives) {
      assert.equal(p.mode ?? 4, 4);
      assert.ok(p.attributes.NORMAL !== undefined);
      assert.ok(p.attributes.TEXCOORD_0 !== undefined);
      assert.equal(p.attributes.TEXCOORD_1, undefined, "Unexpected duplicate UV channel");
      const pos = data.accessors[p.attributes.POSITION];
      assert.ok(pos.min.every(Number.isFinite) && pos.max.every(Number.isFinite));
      triangles += data.accessors[p.indices].count / 3;
      visiblePrimitives++;
    }
  }
  assert.equal(triangles, entry.triangles);
  assert.ok(triangles < 20000);
  const sockets = data.nodes.filter((n) => n.name?.startsWith("SOCKET_"));
  if (entry.name.includes("carbine")) {
    assert.equal(sockets.length, 5);
    const muzzle = sockets.find((n) => n.name === "SOCKET_MUZZLE");
    assert.ok(muzzle);
    assert.ok(Math.abs(muzzle.translation[2] - 0.612) < 0.0001);
  } else
    assert.ok(
      data.meshes.some((m) => m.name.startsWith("COL_")),
      "Prop collision proxy missing",
    );
  results.push({
    file,
    bytes: bytes.length,
    triangles,
    visiblePrimitives,
    sockets: sockets.map((s) => s.name),
    pass: true,
  });
}
const bytes = results.reduce((sum, r) => sum + r.bytes, 0);
assert.ok(bytes < 1.25 * 1024 * 1024, "Model sample exceeds 1.25 MiB");
writeFileSync(
  `${pack}/structure-check.json`,
  JSON.stringify({ pass: true, modelBytes: bytes, results }, null, 2),
);
console.log(JSON.stringify({ pass: true, modelBytes: bytes, results }, null, 2));
