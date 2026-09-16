import type {
  AnimationGroup,
  AssetContainer,
  Mesh,
  Scene,
  Vector3,
  PBRMaterial,
} from "@babylonjs/core";
import {
  Color3,
  EquiRectangularCubeTexture,
  LoadAssetContainerAsync,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { bindTacticalMaterials, TACTICAL_WORLD_ALBEDO_SCALE } from "./tactical-materials";

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
 *  2. **IRON RAIN UVs are packed per component.** The material adapter samples
 *     one atlas tile. The approved C7 keeps its own material pipeline.
 */

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

/** Material slot names shared with `tools/art/blender/_lib.py`. */
export const MATERIALS = [] as const;

export type MaterialName = (typeof MATERIALS)[number] | "lamp_glass";

/** Models built by the asset pipeline. */
/** IRON RAIN runtime inventory, plus the approved C7. Legacy GLBs are retired, including fallback characters. */
export const MODELS = [
  "m3_cargo_module",
  "m3_fuel_reservoir",
  "m3_catwalk",
  "m3_pipe_plant",
  "m3_security_wall",
  "m3_command_bunker",
  "m3_access_stair",
  "m3_floodlight",
  "m3_operator_directorate",
  "m3_operator_nightcell",
  "m3_patrol_vehicle",
  "m3_utility_vehicle",
  "m3_fuel_drum",
  "m3_drum_pallet",
  "m3_blast_wall",
  "m3_water_unit",
  "m3_rifle",
  "m3_smg",
  "m3_marksman",
  "m3_grenade",
  "m3_control_tower",
  "m3_refinery",
  "m3_maintenance_hangar",
  "m3_guard_post",
  "m3_field_shelter",
  "m2_carbine_fp",
  "m3_field_case",
  "m3_low_cover",
] as const;

export type ModelName = (typeof MODELS)[number];

export interface AssetSet {
  readonly materials: ReadonlyMap<string, PBRMaterial | StandardMaterial>;
  readonly models: ReadonlyMap<ModelName, AssetContainer>;
}

// ---------------------------------------------------------------- materials

/**
 * Build the shared PBR materials.
 *
 * One material per name, reused by every mesh that asks for it, so the whole
 * yard draws from a handful of texture bindings.
 */
export function createMaterials(scene: Scene): Map<string, PBRMaterial | StandardMaterial> {
  const materials = new Map<string, PBRMaterial | StandardMaterial>();

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
    `${ASSET_BASE}textures/ir_env_sky.webp`,
    scene,
    256,
  );
  scene.environmentTexture = environment;
  // The yard is lit by its own lamps and the dawn; the environment supplies
  // reflection and a little fill, and overpowering it flattens the scene.
  scene.environmentIntensity = 1.1;
  return environment;
}

async function loadModel(
  scene: Scene,
  name: ModelName,
  materials: ReadonlyMap<string, PBRMaterial | StandardMaterial>,
): Promise<AssetContainer> {
  const container = await LoadAssetContainerAsync(`${ASSET_BASE}models/${name}.glb`, scene);
  {
    bindTacticalMaterials(container, scene, ASSET_BASE, {
      albedoScale: TACTICAL_WORLD_ALBEDO_SCALE,
      environmentIntensity: 0.35,
    });
  }

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

  const importedRoots = entry.rootNodes.filter(
    (n): n is TransformNode => n instanceof TransformNode,
  );
  if (!importedRoots.length) return null;
  const root = placementRoot(importedRoots, name, placement);

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

    const importedRoots = entry.rootNodes.filter(
      (n): n is TransformNode => n instanceof TransformNode,
    );
    if (importedRoots.length)
      roots.push(placementRoot(importedRoots, `${name}_${index}`, placement));
  });

  return roots;
}

/** Keep glTF handedness and quantization transforms below an editable placement node. */
function placementRoot(
  imported: TransformNode[],
  name: string,
  placement: Placement,
): TransformNode {
  const root = new TransformNode(`${name}_placement`, imported[0]!.getScene());
  for (const node of imported) node.parent = root;
  root.position.copyFrom(placement.position);
  root.rotation.y = placement.rotationY ?? 0;
  if (placement.scaling) root.scaling.copyFrom(placement.scaling);
  return root;
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
