import { bindIronRainMaterial } from "./iron-rain-materials";
/** Bind shared tactical detail maps while preserving authored glTF base colors.
 * Call after LoadAssetContainerAsync and before instantiation.
 * baseUrl must contain the textures/ directory and end in '/'.
 */
import { PBRMaterial, Texture, type AssetContainer, type Scene } from "@babylonjs/core";

export const TACTICAL_WORLD_ALBEDO_SCALE = 0.6;
export const TACTICAL_VIEW_ALBEDO_SCALE = 0.55;

export const TACTICAL_MATERIALS = [
  "ir_plaster",
  "ir_blue",
  "ir_canvas",
  "ir_uniform",
  "ir_steel",
  "ir_rubber",
  "ir_glass",
  "ir_orange",
  "ir_white",
  "ir_light",
  "ir_skin",
  "ir_mark",
  "nc7_coating",
  "nc7_polymer",
  "nc7_alloy",
  "nc7_edge",
  "nc7_marking",
  "nc7_dark",
  "nc7_lens",
] as const;

const detail: Record<string, { source: string; scale: number; bump: number }> = {
  nc7_coating: { source: "steel", scale: 2, bump: 0.12 },
  nc7_polymer: { source: "rubber", scale: 6, bump: 0.12 },
  nc7_alloy: { source: "steel", scale: 3, bump: 0.12 },
  nc7_edge: { source: "steel", scale: 3, bump: 0.12 },
};

export function bindTacticalMaterials(
  container: AssetContainer,
  scene: Scene,
  baseUrl: string,
  options: { albedoScale?: number; environmentIntensity?: number } = {},
): void {
  for (const material of container.materials) {
    if (material instanceof PBRMaterial && material.name.startsWith("ir_")) {
      bindIronRainMaterial(material, scene, baseUrl);
      continue;
    }
    if (!(material instanceof PBRMaterial) || !material.name.startsWith("nc7_")) continue;
    material.albedoColor.scaleInPlace(options.albedoScale ?? 1);
    material.environmentIntensity = options.environmentIntensity ?? 1;
    material.maxSimultaneousLights = 6;
    material.enableSpecularAntiAliasing = true;
    const coated = ["nc7_coating", "nc7_alloy", "nc7_edge"].includes(material.name);
    if (coated) {
      const albedo = new Texture(`${baseUrl}textures/m2_coating_albedo.webp`, scene, false, false);
      albedo.gammaSpace = true;
      albedo.uScale = albedo.vScale = 3;
      albedo.anisotropicFilteringLevel = 8;
      material.albedoTexture = albedo;
      // Preserve the approved C7 coating and authored tint exactly.
      material.albedoColor.scaleInPlace(2.3);
    }
    const spec = detail[material.name];
    if (!spec) continue;
    const texture = (suffix: string): Texture => {
      const tex = new Texture(
        `${baseUrl}textures/m2_${spec.source}_${suffix}.webp`,
        scene,
        false,
        false,
      );
      tex.gammaSpace = false;
      tex.uScale = spec.scale;
      tex.vScale = spec.scale;
      tex.anisotropicFilteringLevel = 8;
      return tex;
    };
    material.bumpTexture = texture("normal");
    material.bumpTexture.level = spec.bump;
    // Roughness/metallic factors remain as authored in glTF.
  }
  for (const mesh of [...container.meshes]) {
    if (mesh.name.startsWith("COL_")) {
      container.meshes.splice(container.meshes.indexOf(mesh), 1);
      mesh.dispose();
    } else {
      mesh.receiveShadows = true;
      mesh.isPickable = false;
    }
  }
}
