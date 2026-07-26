import type { AssetContainer, Mesh, Scene } from "@babylonjs/core";
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

  // Materials that came in from the GLB are now unreferenced.
  for (const material of [...container.materials]) {
    if (!materials.has(material.name)) {
      container.materials.splice(container.materials.indexOf(material), 1);
      material.dispose();
    }
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
export function placeAll(
  container: AssetContainer,
  name: string,
  placements: readonly Placement[],
): TransformNode[] {
  const roots: TransformNode[] = [];

  placements.forEach((placement, index) => {
    const entry = container.instantiateModelsToScene(
      (source) => `${name}_${index}_${source}`,
      false,
      { doNotInstantiate: false },
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
