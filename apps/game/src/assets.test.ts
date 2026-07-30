import { createHash } from "node:crypto";
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
 * fonts.
 *
 * Raised from 6 MB to 9 MB when the two licensed characters landed: they are
 * 2.8 MB between them and pushed the set to 6.2 MB legitimately, rather than
 * through any runaway. 9 MB still leaves real headroom under the hard limit
 * and would catch a genuine mistake — an uncompressed texture set or a
 * forgotten master would blow straight past it.
 *
 * Streamed music is deliberately outside this: it is fetched on demand and the
 * game is playable before a note arrives.
 */
const ASSET_BUDGET_BYTES = 9 * 1024 * 1024;

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

  /**
   * Licensed third-party models.
   *
   * They ship their own rig, materials and animations, so the conventions the
   * generated props follow — our material slot names, a COL_ proxy — do not
   * apply. Their provenance is a licence recorded in PROVENANCE.md rather than
   * a generator script.
   */
  const LICENSED = new Set([
    // Licensed Synty characters. They carry their own rig, materials and
    // retargeted animation, so the generated material-slot and COL_ conventions
    // do not apply — see apps/game/public/assets/PROVENANCE.md.
    "fighter_insurgent",
    "fighter_soldier",
    // Synty POLYGON Military static meshes: licensed, and bound by their own
    // atlas slots (`synty_vehicles` / `synty_atlas`) rather than the generated
    // material set. Their provenance is the Synty licence in PROVENANCE.md, and
    // they are cosmetic set-dressing that never collides, so no COL_ proxy.
    "veh_armored_car",
    "veh_technical",
    "prop_barrel",
    "prop_barrel_stack",
    "prop_ammo_box",
    "prop_barrier",
    "prop_water_tank",
    "wep_rifle",
    "wep_smg",
    "wep_sniper",
    "wep_grenade",
    "env_control_tower",
    "env_oil_tower",
    "env_hangar",
    "env_guard_tower",
    "env_tent",
  ]);

  it("only uses material slots the engine can bind", () => {
    // A slot the engine does not know about is not an error at load time: the
    // mesh simply keeps its untextured placeholder material and renders flat.
    const known = new Set<string>([...MATERIALS, "lamp_glass"]);

    for (const model of MODELS) {
      if (LICENSED.has(model)) continue;
      for (const material of names(glbJson(join(MODELS_DIR, `${model}.glb`)).materials)) {
        expect(known, `${model}.glb uses unknown material slot "${material}"`).toContain(material);
      }
    }
  });

  it("ships a collision proxy with every prop", () => {
    // Weapons are exempt: they are held at the camera or in a fighter's hands
    // and never collide with anything, so a COL_ hull on one would be geometry
    // that exists only to satisfy a rule.
    const NO_COLLIDER = new Set(["carbine", ...LICENSED]);

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
    //
    // The licensed weapons are included even though they are otherwise exempt
    // from the model conventions: their sockets are *placed by a heuristic*
    // rather than modelled, so this is the one convention most likely to break
    // silently when a new weapon is converted.
    for (const weapon of ["carbine", "wep_rifle", "wep_smg", "wep_sniper"]) {
      const nodes = names(glbJson(join(MODELS_DIR, `${weapon}.glb`)).nodes);
      expect(
        nodes.some((n) => n.startsWith("SOCKET_MUZZLE")),
        `${weapon}.glb has no SOCKET_MUZZLE (CLAUDE.md)`,
      ).toBe(true);
    }
  });

  it("puts each weapon's muzzle at the barrel tip, not the stock", () => {
    // The muzzle socket is placed by detecting the barrel axis, because Synty
    // is not consistent about which way a weapon faces. An earlier heuristic
    // ("the muzzle end is thinner") put the SMG's socket on its folding stock,
    // which the numbers alone did not reveal — muzzle flash and tracers would
    // have spawned behind the shooter's shoulder.
    //
    // Every weapon is modelled barrel-along--Y, which glTF's Y-up conversion
    // maps to +Z, so the socket belongs at the far +Z end. Guarding the sign
    // catches a flipped weapon; guarding the distance catches a socket left at
    // the origin, which is what a mis-parented empty produces.
    const MUZZLES: Record<string, number> = {
      carbine: 0.492,
      wep_rifle: 0.72,
      wep_smg: 0.506,
      wep_sniper: 1.163,
    };

    for (const [weapon, expected] of Object.entries(MUZZLES)) {
      const gltf = glbJson(join(MODELS_DIR, `${weapon}.glb`)) as {
        nodes?: { name?: string; translation?: number[] }[];
      };
      const node = (gltf.nodes ?? []).find((n) => (n.name ?? "").startsWith("SOCKET_MUZZLE"));
      expect(node, `${weapon}.glb has no SOCKET_MUZZLE`).toBeDefined();

      const along = node?.translation?.[2] ?? 0;
      expect(along, `${weapon}.glb muzzle is on the wrong end`).toBeGreaterThan(0);
      expect(Math.abs(along - expected), `${weapon}.glb muzzle moved`).toBeLessThan(0.02);
    }
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

describe("generated audio", () => {
  const AUDIO = join(__dirname, "../public/audio");

  // Mirrors the VARIED table in audio.ts. If these drift apart the game asks
  // for a clip that was never generated and that sound is silently missing.
  const VARIED: Record<string, number> = {
    fire: 4,
    step_concrete: 5,
    step_grating: 4,
    impact_concrete: 4,
    explosion: 3,
  };
  const SINGLE = ["reload", "ui_hover", "ui_click", "ui_error", "ambience_yard"];

  it("ships every clip the engine asks for", () => {
    for (const [family, count] of Object.entries(VARIED)) {
      for (let i = 1; i <= count; i += 1) {
        const file = join(AUDIO, `${family}_${String(i).padStart(2, "0")}.mp3`);
        expect(() => statSync(file), `missing ${family} variant ${i}`).not.toThrow();
      }
    }
    for (const name of SINGLE) {
      expect(() => statSync(join(AUDIO, `${name}.mp3`)), `missing ${name}.mp3`).not.toThrow();
    }
  });

  it("gives repeated sounds real variations", () => {
    // CLAUDE.md requires variations for repeated sounds. Identical files would
    // pass the existence check above while defeating the entire point.
    //
    // Compare content, not file size: these are encoded at a constant bit
    // rate, so four different gunshots of the same duration produce four
    // identically sized files. Sizes made this test pass-by-accident in one
    // direction and fail-by-accident in the other.
    for (const [family, count] of Object.entries(VARIED)) {
      const digests = new Set<string>();
      for (let i = 1; i <= count; i += 1) {
        const bytes = readFileSync(join(AUDIO, `${family}_${String(i).padStart(2, "0")}.mp3`));
        digests.add(createHash("sha256").update(bytes).digest("hex"));
      }
      expect(digests.size, `${family} variants are not actually different`).toBe(count);
    }
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
