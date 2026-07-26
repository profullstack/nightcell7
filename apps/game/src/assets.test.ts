import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MATERIALS, MODELS } from "./assets";

/**
 * Guards for the generated art set.
 *
 * These check the *built* assets in `apps/game/public/assets`, not the
 * generator scripts, because the failure modes that matter all happen at the
 * boundary between Blender and the engine:
 *
 *  - a material slot renamed in `_lib.py` un-skins every mesh that used it,
 *    and the game still loads — just untextured;
 *  - a model dropped from the build leaves a hole in the yard;
 *  - textures creep upward in size until the shell blows its download budget.
 *
 * None of those throw at runtime, so nothing else would catch them.
 */

const ASSETS = join(__dirname, "../public/assets");
const MODELS_DIR = join(ASSETS, "models");
const TEXTURES_DIR = join(ASSETS, "textures");

/**
 * Total bytes the generated art may occupy, uncompressed.
 *
 * The hard limit is the 15 MB shell download budget (PRD §30,
 * `DOWNLOAD_BUDGET_BYTES`), which also has to fit the engine, the code and the
 * fonts. 6 MB leaves room for all of that and is roughly double what the
 * current set uses, so it catches a runaway without failing on every addition.
 */
const ASSET_BUDGET_BYTES = 6 * 1024 * 1024;

/** Read the JSON chunk out of a GLB container. */
function glbJson(file: string): {
  nodes?: { name?: string }[];
  materials?: { name?: string }[];
  meshes?: { name?: string }[];
} {
  const buffer = readFileSync(file);
  expect(buffer.toString("utf8", 0, 4), `${file} is not a GLB`).toBe("glTF");

  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  // 0x4E4F534A === "JSON"
  expect(chunkType, `${file} first chunk is not JSON`).toBe(0x4e4f534a);

  return JSON.parse(buffer.toString("utf8", 20, 20 + chunkLength));
}

function names(entries: { name?: string }[] | undefined): string[] {
  return (entries ?? []).map((e) => e.name ?? "");
}

describe("generated models", () => {
  it("every model the engine loads exists on disk", () => {
    for (const model of MODELS) {
      const file = join(MODELS_DIR, `${model}.glb`);
      expect(() => statSync(file), `missing ${model}.glb — run pnpm assets:build`).not.toThrow();
    }
  });

  it("only uses material slots the engine can bind", () => {
    // A slot the engine does not know about is not an error at load time: the
    // mesh simply keeps its untextured placeholder material and renders flat.
    const known = new Set<string>([...MATERIALS, "lamp_glass"]);

    for (const model of MODELS) {
      for (const material of names(glbJson(join(MODELS_DIR, `${model}.glb`)).materials)) {
        expect(known, `${model}.glb uses unknown material slot "${material}"`).toContain(material);
      }
    }
  });

  it("ships a collision proxy with every prop", () => {
    // The carbine is exempt: it is a viewmodel held at the camera and a world
    // model on a character's back. It never collides with anything, so a
    // COL_ hull on it would be geometry that exists only to satisfy a rule.
    const NO_COLLIDER = new Set(["carbine"]);

    for (const model of MODELS) {
      if (NO_COLLIDER.has(model)) continue;
      const meshes = names(glbJson(join(MODELS_DIR, `${model}.glb`)).meshes);
      expect(
        meshes.some((n) => n.startsWith("COL_")),
        `${model}.glb has no COL_ collision proxy (CLAUDE.md)`,
      ).toBe(true);
    }
  });

  it("gives every weapon a SOCKET_MUZZLE", () => {
    // CLAUDE.md: "Every weapon has SOCKET_MUZZLE." The engine spawns muzzle
    // flash and tracer origins there.
    const nodes = names(glbJson(join(MODELS_DIR, "carbine.glb")).nodes);
    expect(nodes.some((n) => n.startsWith("SOCKET_MUZZLE"))).toBe(true);
  });

  it("keeps the character's weapon and head sockets", () => {
    const nodes = names(glbJson(join(MODELS_DIR, "character.glb")).nodes);
    expect(nodes.some((n) => n.startsWith("SOCKET_WEAPON"))).toBe(true);
    expect(nodes.some((n) => n.startsWith("SOCKET_HEAD"))).toBe(true);
  });
});

describe("generated textures", () => {
  it("ships a full PBR set for every material", () => {
    for (const material of MATERIALS) {
      for (const map of ["albedo", "normal", "orm"]) {
        const file = join(TEXTURES_DIR, `${material}_${map}.webp`);
        expect(() => statSync(file), `missing ${material}_${map}.webp`).not.toThrow();
      }
    }
  });

  it("ships the IBL environment", () => {
    // Without this every metal in the yard renders black, and nothing throws.
    expect(() => statSync(join(TEXTURES_DIR, "env_sky.webp"))).not.toThrow();
  });
});

describe("download budget", () => {
  it("stays well inside the shell budget", () => {
    const manifest = JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8")) as {
      bytes: { total: number };
    };

    expect(
      manifest.bytes.total,
      `generated assets are ${(manifest.bytes.total / 1048576).toFixed(2)} MB, ` +
        `over the ${(ASSET_BUDGET_BYTES / 1048576).toFixed(0)} MB guard`,
    ).toBeLessThan(ASSET_BUDGET_BYTES);
  });

  it("manifest lists exactly what is on disk", () => {
    const manifest = JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8")) as {
      models: string[];
      textures: string[];
    };
    for (const model of MODELS) {
      expect(manifest.models, `manifest missing ${model}`).toContain(`${model}.glb`);
    }
    expect(manifest.textures).toContain("env_sky.webp");
  });
});
