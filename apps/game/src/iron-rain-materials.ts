import { Texture, type PBRMaterial, type Scene } from "@babylonjs/core";
export function surfaceTexture(scene: Scene, baseUrl: string, tile: number): Texture {
  const t = new Texture(`${baseUrl}textures/ir_surface_atlas.webp`, scene, false, false);
  t.gammaSpace = true;
  t.uScale = t.vScale = 0.48;
  t.uOffset = 0.01 + (tile % 2) * 0.5;
  t.vOffset = 0.01 + Math.floor(tile / 2) * 0.5;
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  return t;
}
export function bindIronRainMaterial(m: PBRMaterial, scene: Scene, base: string): void {
  const tiles: Record<string, number> = { ir_plaster: 0, ir_blue: 1, ir_canvas: 3, ir_uniform: 3 };
  const tile = tiles[m.name];
  if (tile !== undefined) m.albedoTexture = surfaceTexture(scene, base, tile);
  m.environmentIntensity = 0.65;
  m.maxSimultaneousLights = 6;
  m.enableSpecularAntiAliasing = true;
}
