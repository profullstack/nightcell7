/**
 * Convert the purchased Synty POLYGON Military pack into shipped game assets.
 *
 * This is deliberately separate from `build-assets.mjs`. That script generates
 * art from nothing and runs in CI; this one needs a 406 MB commercial pack that
 * is not in the repository and never will be, so it cannot. What it *can* do is
 * make the conversion reproducible: before this existed, the exact source file,
 * material slot, decimation ratio and atlas for each shipped asset lived only in
 * one session's shell history, and "regenerate the licensed assets" meant
 * reading the diff and guessing.
 *
 * The table below is the record. Re-running this against the same pack version
 * reproduces every licensed GLB and texture the game ships.
 *
 *   node tools/art/import-synty.mjs                      # everything
 *   node tools/art/import-synty.mjs --only weapons       # one group
 *   node tools/art/import-synty.mjs --pack /path/to/pack
 *
 * Outputs land directly in `apps/game/public/assets`, and the results are
 * committed — CI and Railway never run this.
 *
 * Characters are listed but **skipped by default**: their animation retarget is
 * unresolved (see docs/HANDOFF-synty.md), so re-running them would overwrite
 * two working-but-unshipped GLBs with the same broken clips. `--with-characters`
 * opts in.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "apps/game/public/assets");
const MODELS_OUT = join(OUT, "models");
const TEXTURES_OUT = join(OUT, "textures");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);

const PACK = value("--pack", join(homedir(), "src/nightcell7-assets/SourceFiles"));
const WEBP_QUALITY = 88;

/**
 * Shared texture atlases.
 *
 * Synty puts the whole pack on a handful of atlases, so binding one by material
 * name costs a single texture for every model that uses it. The alternative —
 * letting the glTF exporter embed what each mesh samples — duplicated the same
 * 4096 image into every GLB and cost 2.48 MB per character.
 *
 * `Land_Vehicles` and `Weapons` each ship ten recolours over one shared UV
 * layout, so exactly one variant is chosen and bound to everything.
 */
const TEXTURES = [
  { slot: "synty_atlas", src: "PolygonMilitary_Texture_01_A.png", out: "synty_atlas.webp" },
  // Desert recolour, for the Kaviran setting.
  {
    slot: "synty_vehicles",
    src: "PolygonMilitary_Land_Vehicles_03.png",
    out: "synty_vehicles.webp",
  },
  // Neutral gunmetal. The other nine are camo and tiger-stripe finishes that
  // would date the weapons to one faction.
  { slot: "synty_weapons", src: "PolygonMilitary_Weapons_01.png", out: "synty_weapons.webp" },
];

/** Source PNG backing each material slot, for the converters' preview renders. */
const SLOT_SOURCE = Object.fromEntries(TEXTURES.map((t) => [t.slot, `Textures/${t.src}`]));

/**
 * Static meshes: vehicles and props.
 *
 * `decimate` is a ratio, applied only where the source is denser than
 * set-dressing needs. The vehicles import at 24k triangles; the props are
 * already 12–143 KB and are left alone.
 */
const PROPS = [
  {
    fbx: "Fbx/SM_Veh_Light_Armored_Car_01",
    out: "veh_armored_car",
    slot: "synty_vehicles",
    decimate: 0.4,
  },
  {
    fbx: "Fbx/SM_Veh_Pickup_Technical_01",
    out: "veh_technical",
    slot: "synty_vehicles",
    decimate: 0.5,
  },
  { fbx: "Fbx/SM_Prop_Barrel_01", out: "prop_barrel", slot: "synty_atlas" },
  { fbx: "Fbx/SM_Prop_Barrel_Stack_01", out: "prop_barrel_stack", slot: "synty_atlas" },
  { fbx: "Fbx/SM_Prop_AmmoBox_01", out: "prop_ammo_box", slot: "synty_atlas" },
  { fbx: "Fbx/SM_Prop_Barrier_Tall_01", out: "prop_barrier", slot: "synty_atlas" },
  { fbx: "Fbx/SM_Prop_WaterTank_02", out: "prop_water_tank", slot: "synty_atlas" },
  // The frag grenade goes through the prop path, not the weapon one: it is a
  // single mesh with nothing to assemble and no muzzle to find.
  { fbx: "Fbx/SM_Wep_Grenade_01", out: "wep_grenade", slot: "synty_weapons" },
];

/**
 * Weapons.
 *
 * `base` is a prefix, not a file: Synty ships a weapon as a receiver plus
 * separate magazine, sight, trigger, slide and charging-handle FBXs sharing one
 * origin. `import_synty_weapon.py` globs them, joins them and places
 * `SOCKET_MUZZLE` (CLAUDE.md requires one on every weapon).
 */
const WEAPONS = [
  { base: "Fbx/SM_Wep_Preset_A_Rifle_01", out: "wep_rifle" },
  { base: "Fbx/SM_Wep_Preset_A_SMG_01", out: "wep_smg" },
  { base: "Fbx/SM_Wep_Preset_B_Sniper_01", out: "wep_sniper" },
];

/** Characters — see the header; skipped unless `--with-characters`. */
const CHARACTERS = [
  { fbx: "Chr/SK_Chr_Insurgent_Male_01", out: "fighter_insurgent" },
  { fbx: "Chr/SK_Chr_Soldier_Male_01", out: "fighter_soldier" },
];

function blenderBinary() {
  const candidate = process.env.BLENDER ?? "blender";
  try {
    execFileSync(candidate, ["--version"], { stdio: "pipe" });
    return candidate;
  } catch {
    throw new Error(`Blender not found (tried "${candidate}"). Set $BLENDER.`);
  }
}

function blender(script, args, label) {
  process.stdout.write(`  ${label}`);
  const output = execFileSync(
    blenderBinary(),
    ["--background", "--factory-startup", "--python", join(HERE, "blender", script), "--", ...args],
    { encoding: "utf8", stdio: "pipe" },
  );
  // The converters print one summary line each; surface it rather than the
  // several hundred lines Blender emits around it.
  const summary = output
    .split("\n")
    .filter((line) => /^(WEAPON|PROP|CHARACTER) /.test(line))
    .join("\n    ");
  process.stdout.write(summary ? `\n    ${summary}\n` : " done\n");
}

function packFile(relative) {
  const file = join(PACK, relative);
  if (!existsSync(file)) {
    throw new Error(
      `missing ${file}\nThe Synty pack is not in the repository. Unpack it and pass --pack.`,
    );
  }
  return file;
}

/**
 * Resolve a weapon's part prefix.
 *
 * Unlike every other entry this is not a file: the converter globs `<prefix>*`
 * to collect the receiver and its attachments. So the check is "does anything
 * match", not "does this exist".
 */
function packPrefix(relative) {
  const prefix = join(PACK, relative);
  const dir = dirname(prefix);
  const stem = prefix.slice(dir.length + 1);
  const matched = existsSync(dir) && readdirSync(dir).some((f) => f.startsWith(stem));
  if (!matched) {
    throw new Error(
      `nothing matches ${prefix}*.fbx\nThe Synty pack is not in the repository. Unpack it and pass --pack.`,
    );
  }
  return prefix;
}

function main() {
  const only = value("--only", null);
  const wants = (group) => only === null || only === group;

  if (!existsSync(PACK)) {
    throw new Error(`Synty pack not found at ${PACK}. Pass --pack <dir>.`);
  }
  console.log(`Synty POLYGON Military -> ${OUT}\n  pack: ${PACK}\n`);
  mkdirSync(MODELS_OUT, { recursive: true });
  mkdirSync(TEXTURES_OUT, { recursive: true });

  if (wants("textures")) {
    console.log("textures");
    for (const texture of TEXTURES) {
      const target = join(TEXTURES_OUT, texture.out);
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-loglevel",
          "error",
          "-i",
          packFile(join("Textures", texture.src)),
          "-quality",
          String(WEBP_QUALITY),
          target,
        ],
        { stdio: "pipe" },
      );
      console.log(`  ${texture.out} (${(statSync(target).size / 1024).toFixed(0)} KB)`);
    }
    console.log();
  }

  if (wants("props")) {
    console.log("props and vehicles");
    for (const prop of PROPS) {
      blender(
        "import_synty_prop.py",
        [
          "--fbx",
          packFile(`${prop.fbx}.fbx`),
          "--out",
          join(MODELS_OUT, `${prop.out}.glb`),
          "--primary-slot",
          prop.slot,
          // The atlases are for the preview render, not the GLB — the export
          // strips images. Omitting them silently skips the converter's
          // material setup, which also leaves roughness at Blender's default
          // instead of the 0.75 these surfaces are authored for.
          "--primary-atlas",
          packFile(SLOT_SOURCE[prop.slot]),
          "--glass-atlas",
          packFile(SLOT_SOURCE.synty_atlas),
          ...(prop.decimate ? ["--decimate", String(prop.decimate)] : []),
        ],
        prop.out,
      );
    }
    console.log();
  }

  if (wants("weapons")) {
    console.log("weapons");
    for (const weapon of WEAPONS) {
      blender(
        "import_synty_weapon.py",
        [
          "--base",
          packPrefix(weapon.base),
          "--out",
          join(MODELS_OUT, `${weapon.out}.glb`),
          "--slot",
          "synty_weapons",
        ],
        weapon.out,
      );
    }
    console.log();
  }

  if (wants("characters")) {
    if (!has("--with-characters")) {
      console.log(
        "characters: skipped (animation retarget unresolved — see docs/HANDOFF-synty.md)",
      );
      console.log("  pass --with-characters to run anyway\n");
    } else {
      console.log("characters");
      for (const character of CHARACTERS) {
        blender(
          "import_synty.py",
          [
            "--fbx",
            packFile(`${character.fbx}.fbx`),
            "--anims",
            join(MODELS_OUT, "character.glb"),
            "--out",
            join(MODELS_OUT, `${character.out}.glb`),
          ],
          character.out,
        );
      }
      console.log();
    }
  }

  console.log("Licensed assets are committed. Update PROVENANCE.md if this table changed.");
}

main();
