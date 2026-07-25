import { z } from "zod";

/**
 * @nightcell7/content-schema
 *
 * Versioned content manifests (PRD §26.2). The game validates every downloaded
 * pack against these before it becomes playable, so a truncated or swapped
 * asset fails loudly instead of rendering a broken level.
 */

export const assetKindSchema = z.enum([
  "model",
  "texture",
  "audio",
  "map",
  "animation",
  "font",
  "data",
]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetEntrySchema = z.object({
  id: z.string().min(1).max(128),
  kind: assetKindSchema,
  /** Content-hashed path within the pack. */
  path: z.string().min(1).max(512),
  sizeBytes: z.number().int().nonnegative(),
  /** sha256 of the file; verified after download (PRD §26.2). */
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Provenance is mandatory — nothing ships public without it (PRD §15.7). */
  provenanceId: z.string().min(1).max(128),
});
export type AssetEntry = z.infer<typeof assetEntrySchema>;

export const contentPackSchema = z.object({
  id: z.string().min(1).max(128),
  /** common | rook | leila | complete-truth | multiplayer */
  scope: z.enum(["common", "rook", "leila", "complete-truth", "multiplayer"]),
  sizeBytes: z.number().int().nonnegative(),
  assets: z.array(assetEntrySchema),
  requiresEntitlement: z.boolean(),
});
export type ContentPack = z.infer<typeof contentPackSchema>;

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  episodeId: z.string().min(1),
  version: z.string().min(1),
  minimumGameVersion: z.string().min(1),
  /** Must match the client's map data for multiplayer packs (PRD §18.2). */
  contentVersion: z.string().min(1),
  packs: z.array(contentPackSchema),
  generatedAt: z.string(),
});
export type ContentManifest = z.infer<typeof manifestSchema>;

export function parseManifest(input: unknown): ContentManifest {
  return manifestSchema.parse(input);
}

export function totalSize(manifest: ContentManifest): number {
  return manifest.packs.reduce((sum, pack) => sum + pack.sizeBytes, 0);
}

/** Packs a player is allowed to download given their entitlement state. */
export function authorizedPacks(manifest: ContentManifest, hasEntitlement: boolean): ContentPack[] {
  return manifest.packs.filter((pack) => hasEntitlement || !pack.requiresEntitlement);
}

/**
 * Download budgets (PRD §30.2). Exported so the asset pipeline can fail a build
 * that blows the budget rather than discovering it at launch.
 */
export const DOWNLOAD_BUDGET_BYTES = {
  shell: 15 * 1024 * 1024,
  commonMenuBenchmark: 40 * 1024 * 1024,
  demoRoute: 150 * 1024 * 1024,
  firstUsableRoute: 200 * 1024 * 1024,
  paidEpisodePreferred: 1.2 * 1024 * 1024 * 1024,
  paidEpisodeHardGate: 1.5 * 1024 * 1024 * 1024,
  multiplayerIncremental: 250 * 1024 * 1024,
} as const;

export function exceedsBudget(bytes: number, budget: number): boolean {
  return bytes > budget;
}

export * from "./delivery";
