import type { AnimationGroup, AssetContainer, Mesh, Scene } from "@babylonjs/core";
import {
  Color3,
  EquiRectangularCubeTexture,
  LoadAssetContainerAsync,
  PBRMaterial,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

/**
 * Runtime asset loading for the generated art set.
 *
 * Everything here is produced by `tools/art/build-assets.mjs` — see
 * `apps/game/public/assets/manifest.json` for provenance. Two conventions from
 * the build side are load-bearing:
 *
 *  1. **Models carry no textures.** A GLB ships geometry, UVs and a *named*
 *     material slot; this file binds the real PBR maps to that name. Embedding
 *     images per model would ship the same steel texture ten times and blow the
 *     15 MB shell budget (PRD §30), which would in turn force smaller, worse
 *     textures.
 *  2. **UVs are in world units.** The generators unwrap at a fixed texel
 *     density (one tile per 4 m), so tiling needs no per-object uScale and two
 *     adjacent props always agree on texture scale.
 */

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

/** Material slot names shared with `tools/art/blender/_lib.py`. */
export const MATERIALS = [
  "concrete",
  "steel",
  "rust",
  "paint_red",
  "paint_cyan",
  "grating",
  "rubber",
] as const;

export type MaterialName = (typeof MATERIALS)[number] | "lamp_glass";

/** Models built by the asset pipeline. */
export const MODELS = [
  "container",
  "tank",
  "deck",
  "pipe_rack",
  "wall",
  "hardpoint",
  "stair",
  "lamp_mast",
  "character",
  "carbine",
  // The licensed Synty characters are deliberately NOT here.
  //
  // They convert, load and texture correctly, but neither route to animating
  // them works yet — retargeting our clips onto Synty's skeleton leaves the
  // arms in its T-pose, and skinning the mesh to our rig loses the arms in the
  // bind (docs/HANDOFF-synty.md). Listing them anyway cost 1.24 MB of the shell
  // download, fetched and parsed at every boot, for two models nothing drew.
  // They are regenerated on demand by `tools/art/import-synty.mjs
  // --with-characters` when there is something to ship.
  // Licensed Synty POLYGON Military static meshes. Vehicles bind the shared
  // `synty_vehicles` atlas; props reuse the character atlas (`synty_atlas`),
  // since both were authored against Synty's Texture_01_A. No new texture ships
  // for the props at all — see apps/game/public/assets/PROVENANCE.md.
  "veh_armored_car",
  "veh_technical",
  "prop_barrel",
  "prop_barrel_stack",
  "prop_ammo_box",
  "prop_barrier",
  "prop_water_tank",
  // Licensed Synty weapons, bound to the shared `synty_weapons` atlas. The
  // rifle is the player's viewmodel and every fighter's world model; the SMG
  // and sniper distinguish opponents at a glance. The generated `carbine`
  // above is kept as a working fallback.
  "wep_rifle",
  "wep_smg",
  "wep_sniper",
  "wep_grenade",
] as const;

export type ModelName = (typeof MODELS)[number];

export interface AssetSet {
  readonly materials: ReadonlyMap<string, PBRMaterial | StandardMaterial>;
  readonly models: ReadonlyMap<ModelName, AssetContainer>;
}

// ---------------------------------------------------------------- materials

function loadTexture(scene: Scene, file: string, srgb: boolean): Texture {
  const texture = new Texture(
    `${ASSET_BASE}textures/${file}`,
    scene,
    // Mipmaps on, and NOT inverted in Y: the generator writes conventional
    // top-left-origin images.
    false,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  // Only base colour is authored in sRGB. Normal and ORM are data, and
  // gamma-decoding them would bend every roughness and normal value.
  texture.gammaSpace = srgb;
  // The yard is full of grazing angles down long lanes; without anisotropy the
  // ground turns to mush a few metres out.
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

/**
 * Build the shared PBR materials.
 *
 * One material per name, reused by every mesh that asks for it, so the whole
 * yard draws from a handful of texture bindings.
 */
export function createMaterials(scene: Scene): Map<string, PBRMaterial | StandardMaterial> {
  const materials = new Map<string, PBRMaterial | StandardMaterial>();

  for (const name of MATERIALS) {
    const material = new PBRMaterial(name, scene);
    material.albedoTexture = loadTexture(scene, `${name}_albedo.webp`, true);
    material.bumpTexture = loadTexture(scene, `${name}_normal.webp`, false);
    material.metallicTexture = loadTexture(scene, `${name}_orm.webp`, false);

    // ORM packing, matching the generator: R = occlusion, G = roughness,
    // B = metallic.
    material.useAmbientOcclusionFromMetallicTextureRed = true;
    material.useRoughnessFromMetallicTextureGreen = true;
    material.useMetallnessFromMetallicTextureBlue = true;
    // Factors stay at 1 so the texture values are used unmodified — Babylon
    // multiplies factor by texture.
    material.metallic = 1;
    material.roughness = 1;

    // The meshes ship without tangents to keep them small; Babylon then builds
    // a TBN from screen-space derivatives, which needs this flag.
    material.useParallax = false;
    material.forceIrradianceInFragment = true;
    // The yard runs eleven lamp masts plus two spawn markers and three
    // directionals. Babylon's default cap is four lights per mesh and it drops
    // the rest *silently*, which showed up as lamp pools vanishing depending
    // on where you stood. Six is the compromise: it covers any realistic
    // cluster without paying for sixteen light terms in the shader.
    material.maxSimultaneousLights = 6;

    materials.set(name, material);
  }

  // Synty characters share one 4096 atlas across every model in the pack, so
  // it is bound once here rather than embedded in each GLB.
  const synty = new PBRMaterial("synty_atlas", scene);
  synty.albedoTexture = loadTexture(scene, "synty_atlas.webp", true);
  synty.metallic = 0;
  synty.roughness = 0.9;
  // `albedoColor` multiplies the atlas. Synty authors for neutral lighting at
  // roughly 0.5 mid-tone; this yard runs hemispheric 4.05 at exposure 2.05, so
  // the unscaled atlas clips past the 0.62 bloom threshold and the characters
  // render white. 0.36 lands them near 0.18 effective, which is where the
  // yard's own concrete and steel sit.
  synty.albedoColor = new Color3(0.36, 0.36, 0.36);
  // Authored for neutral lighting; this yard runs a hot ambient, so the
  // contribution is trimmed the same way the weapon viewmodel's is.
  synty.environmentIntensity = 0.35;
  materials.set("synty_atlas", synty);

  // Synty vehicles share one Land_Vehicles atlas (a desert recolour that fits
  // the Kaviran setting), bound once here the same way the character atlas is.
  // The pack's vehicle glass was authored against Texture_01_A, so those meshes
  // are bound to `synty_atlas` at convert time rather than here.
  const vehicles = new PBRMaterial("synty_vehicles", scene);
  vehicles.albedoTexture = loadTexture(scene, "synty_vehicles.webp", true);
  // Painted sheet metal: matte, barely metallic. The camo reads as diffuse.
  vehicles.metallic = 0.05;
  vehicles.roughness = 0.8;
  // Same hot-yard correction as the character atlas: the unscaled tan would
  // clip past the 0.62 bloom threshold under hemispheric 4.05 / exposure 2.05.
  vehicles.albedoColor = new Color3(0.36, 0.36, 0.36);
  vehicles.environmentIntensity = 0.35;
  vehicles.maxSimultaneousLights = 6;
  materials.set("synty_vehicles", vehicles);

  // Synty weapons share one 512px atlas — the whole armoury costs 2 KB, because
  // the pack colours by UV region rather than by detail. The pack ships ten
  // recolours over that one layout; `Weapons_01` is the neutral gunmetal, since
  // the camo and tiger-stripe variants would tie every weapon to one faction.
  const weapons = new PBRMaterial("synty_weapons", scene);
  weapons.albedoTexture = loadTexture(scene, "synty_weapons.webp", true);
  // Barely metallic, on purpose.
  //
  // "Gun metal, so make it metallic" is the obvious reading and it renders the
  // weapon black. A metallic surface in Babylon is lit almost entirely by what
  // it reflects, and this atlas ships no metallic or roughness map — so a flat
  // 0.55 metallic over a flat colour, with the environment contribution turned
  // down for close-range work, leaves nothing to light it at all. Synty paint
  // their metal into the albedo instead; the other two atlases already sit at
  // 0 and 0.05 for the same reason.
  weapons.metallic = 0.15;
  weapons.roughness = 0.5;
  // Same hot-yard correction as the other two atlases — see `synty_atlas`.
  weapons.albedoColor = new Color3(0.36, 0.36, 0.36);
  // Lower than the other atlases: the viewmodel is held 30 cm from the camera,
  // where a metallic surface reflecting the yard's 2.9 environment blows out to
  // white across the bottom third of the screen.
  weapons.environmentIntensity = 0.25;
  weapons.maxSimultaneousLights = 6;
  materials.set("synty_weapons", weapons);

  // Lamp lenses are the one unlit surface: they are a light source, and
  // shading them would make the fitting darker than the pool of light it casts.
  const lens = new StandardMaterial("lamp_glass", scene);
  lens.disableLighting = true;
  lens.emissiveColor = new Color3(1.0, 0.71, 0.36);
  materials.set("lamp_glass", lens);

  return materials;
}

/**
 * Install the image-based lighting environment.
 *
 * Mandatory, not an enhancement. A physically-based metal is lit almost
 * entirely by what it reflects, so with no environment texture every steel,
 * rust and grating surface in the yard renders black — which is precisely how
 * the yard looked the first time the models went in.
 *
 * The map is a plain equirectangular image rather than a prefiltered `.env`.
 * Prefiltering would give more accurate roughness-dependent blur, but it is a
 * separate offline step and a much larger file; at this art direction — dark,
 * hazy, low-gloss — the difference is not visible, and Babylon still generates
 * mip levels to approximate rough reflections.
 */
export function createEnvironment(scene: Scene): EquiRectangularCubeTexture {
  const environment = new EquiRectangularCubeTexture(
    `${ASSET_BASE}textures/env_sky.webp`,
    scene,
    256,
  );
  scene.environmentTexture = environment;
  // The yard is lit by its own lamps and the dawn; the environment supplies
  // reflection and a little fill, and overpowering it flattens the scene.
  scene.environmentIntensity = 2.9;
  return environment;
}

/**
 * A variant of one of the shared materials with its own texture tiling.
 *
 * Generated meshes carry world-unit UVs and need no scaling, but Babylon
 * primitives (the ground slab) are unwrapped 0..1 across the whole face, so
 * they need the tiling applied on the texture itself. Babylon caches GPU
 * textures by URL, so these extra `Texture` wrappers cost almost no memory.
 */
export function createTiledMaterial(
  scene: Scene,
  base: (typeof MATERIALS)[number],
  uScale: number,
  vScale: number,
): PBRMaterial {
  const material = new PBRMaterial(`${base}_tiled`, scene);

  for (const [slot, file, srgb] of [
    ["albedoTexture", `${base}_albedo.webp`, true],
    ["bumpTexture", `${base}_normal.webp`, false],
    ["metallicTexture", `${base}_orm.webp`, false],
  ] as const) {
    const texture = loadTexture(scene, file, srgb);
    texture.uScale = uScale;
    texture.vScale = vScale;
    (material as unknown as Record<string, Texture>)[slot] = texture;
  }

  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.metallic = 1;
  material.roughness = 1;

  return material;
}

// ------------------------------------------------------------------- models

/**
 * Load one GLB into an AssetContainer, bind shared materials, and drop the
 * collision proxies.
 *
 * `COL_` meshes exist so the GLB is self-describing (CLAUDE.md) but the engine
 * collides against the server's map, not against art. Rendering them would
 * double every prop's triangle count and z-fight with the visible shell.
 */
async function loadModel(
  scene: Scene,
  name: ModelName,
  materials: ReadonlyMap<string, PBRMaterial | StandardMaterial>,
): Promise<AssetContainer> {
  const container = await LoadAssetContainerAsync(`${ASSET_BASE}models/${name}.glb`, scene);

  for (const mesh of [...container.meshes]) {
    if (mesh.name.startsWith("COL_")) {
      container.meshes.splice(container.meshes.indexOf(mesh), 1);
      mesh.dispose();
      continue;
    }

    const slot = mesh.material?.name;
    const shared = slot ? materials.get(slot) : undefined;
    if (shared) mesh.material = shared;

    mesh.receiveShadows = true;
    mesh.isPickable = false;
    // Static props never move once placed; skipping the frustum test on a
    // hundred instances is measurably cheaper than the culling it saves.
    mesh.alwaysSelectAsActiveMesh = false;
  }

  // Drop only materials nothing is actually using.
  //
  // This used to dispose every material whose name was not one of our
  // generated slots, on the assumption that a GLB's own materials are always
  // replaced by the loop above. That holds for the props we generate and is
  // catastrophically wrong for a licensed model: every Quaternius material
  // (DarkBrown, Grey, Black, Skin, Swat, Swat_Black, Visor) failed the name
  // test, all seven were destroyed, and the meshes were left with no material
  // at all — which Babylon renders as flat white.
  //
  // That cost three wrong diagnoses. It looked like an exposure problem, so it
  // was "fixed" by scaling albedo and clearing emissive, none of which can
  // help a mesh that has no material to scale. Checking actual usage is both
  // correct and impossible to get wrong for a model we did not author.
  const inUse = new Set(container.meshes.map((mesh) => mesh.material).filter(Boolean));
  for (const material of [...container.materials]) {
    if (inUse.has(material)) continue;
    container.materials.splice(container.materials.indexOf(material), 1);
    material.dispose();
  }

  return container;
}

export async function loadAssets(scene: Scene, only?: readonly ModelName[]): Promise<AssetSet> {
  // Before the materials, so nothing can be created against an empty
  // environment and render black.
  createEnvironment(scene);
  const materials = createMaterials(scene);
  const wanted = only ?? MODELS;

  const loaded = await Promise.all(
    wanted.map(async (name) => [name, await loadModel(scene, name, materials)] as const),
  );

  return { materials, models: new Map(loaded) };
}

// ---------------------------------------------------------------- placement

export interface Placement {
  readonly position: Vector3;
  /** Yaw in radians. */
  readonly rotationY?: number;
  readonly scaling?: Vector3;
}

/**
 * Instantiate `container` once per placement.
 *
 * `instantiateModelsToScene` produces real Babylon instances for repeated
 * meshes, so twenty wall panels are one draw call rather than twenty, and it
 * reproduces the glTF node hierarchy — which matters because the loader adds a
 * `__root__` node to convert glTF's right-handed space. Building the transform
 * by hand instead means getting that conversion right on every prop.
 */
/**
 * Instantiate once, keeping the animation groups.
 *
 * `placeAll` discards them, which is fine for static props but useless for a
 * character: the clips live on the instantiated copy, not the container, so
 * they have to be captured at instantiation or they cannot be played at all.
 */
export function placeAnimated(
  container: AssetContainer,
  name: string,
  placement: Placement,
): { root: TransformNode; clips: Map<string, AnimationGroup> } | null {
  const entry = container.instantiateModelsToScene((source) => `${name}_${source}`, false, {
    doNotInstantiate: true,
  });

  const root = entry.rootNodes.find((n): n is TransformNode => n instanceof TransformNode);
  if (!root) return null;

  root.position = placement.position.clone();
  if (placement.rotationY !== undefined) root.rotation = new Vector3(0, placement.rotationY, 0);
  if (placement.scaling) root.scaling = placement.scaling.clone();

  const clips = new Map<string, AnimationGroup>();
  for (const group of entry.animationGroups) {
    // Names come through as "<instance>_<clip>"; index by the clip.
    const clip = group.name.split("_").pop() ?? group.name;
    group.stop();
    clips.set(clip, group);
  }

  return { root, clips };
}

/**
 * `unique` gives real meshes instead of hardware instances.
 *
 * Instancing is what makes twenty wall panels one draw call, and it is the
 * right default — but an `InstancedMesh` shares its source's material, and
 * `mesh.material = x` on one is a *getter-backed no-op*: it neither applies nor
 * throws. A caller that needs its own material (the viewmodel dims the
 * environment contribution for close-range work) silently gets the shared one.
 * That cost a debugging round where forcing the weapon bright red changed
 * nothing on screen.
 */
export interface PlaceOptions {
  readonly unique?: boolean;
}

export function placeAll(
  container: AssetContainer,
  name: string,
  placements: readonly Placement[],
  options: PlaceOptions = {},
): TransformNode[] {
  const roots: TransformNode[] = [];

  placements.forEach((placement, index) => {
    const entry = container.instantiateModelsToScene(
      (source) => `${name}_${index}_${source}`,
      false,
      { doNotInstantiate: options.unique === true },
    );

    // `rootNodes` is typed as the base `Node`; only transform nodes can be
    // positioned, and in practice that is all a glTF import produces at the
    // root.
    for (const node of entry.rootNodes) {
      if (!(node instanceof TransformNode)) continue;
      node.position = placement.position.clone();
      if (placement.rotationY !== undefined) {
        node.rotation = new Vector3(0, placement.rotationY, 0);
      }
      if (placement.scaling) node.scaling = placement.scaling.clone();
      roots.push(node);
    }
  });

  return roots;
}

/** Every mesh under a set of instantiated roots, for shadow registration. */
export function meshesUnder(roots: readonly TransformNode[]): Mesh[] {
  const out: Mesh[] = [];
  for (const root of roots) {
    for (const child of root.getChildMeshes()) {
      out.push(child as Mesh);
    }
  }
  return out;
}
