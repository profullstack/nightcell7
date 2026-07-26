import { z } from "zod";
import {
  DEFAULT_DIFFICULTY,
  EPISODE,
  emptyEpisodeProgress,
  type EpisodeProgress,
} from "@nightcell7/game-core";

/**
 * @nightcell7/save-data
 *
 * Local save schema and migration (PRD §19).
 *
 * V1 keeps single-player progress on the device — cloud saves are P1 and must
 * not delay launch with conflict resolution. Demo progress carries into a
 * purchase without replaying anything (PRD §19.3).
 */

export const SAVE_SCHEMA_VERSION = 1;

export const settingsSchema = z.object({
  sensitivityX: z.number().min(0.01).max(20).default(1),
  sensitivityY: z.number().min(0.01).max(20).default(1),
  invertY: z.boolean().default(false),
  adsMultiplier: z.number().min(0.1).max(2).default(0.8),
  fov: z.number().min(60).max(120).default(90),
  holdToCrouch: z.boolean().default(false),
  holdToAds: z.boolean().default(true),
  subtitles: z.boolean().default(true),
  subtitleSize: z.enum(["small", "medium", "large"]).default("medium"),
  subtitleBackground: z.boolean().default(true),
  speakerLabels: z.boolean().default(true),
  reducedMotion: z.boolean().default(false),
  motionBlur: z.boolean().default(false),
  headBob: z.boolean().default(true),
  cameraShake: z.boolean().default(true),
  weaponSway: z.boolean().default(true),
  flashReduction: z.boolean().default(false),
  filmGrain: z.boolean().default(true),
  chromaticAberration: z.boolean().default(false),
  goreReduction: z.boolean().default(false),
  controllerAimAssist: z.boolean().default(true),
  volumes: z
    .object({
      master: z.number().min(0).max(1).default(0.8),
      music: z.number().min(0).max(1).default(0.7),
      voice: z.number().min(0).max(1).default(1),
      weapons: z.number().min(0).max(1).default(0.9),
      impacts: z.number().min(0).max(1).default(0.9),
      movement: z.number().min(0).max(1).default(0.8),
      ambience: z.number().min(0).max(1).default(0.7),
      ui: z.number().min(0).max(1).default(0.6),
    })
    .prefault({}),
  dynamicRange: z.enum(["full", "night", "headphones"]).default("full"),
});

export type Settings = z.infer<typeof settingsSchema>;

export const checkpointSchema = z.object({
  missionId: z.string(),
  checkpointId: z.string(),
  health: z.number(),
  armor: z.number(),
  weapons: z.array(z.object({ id: z.string(), magazine: z.number(), reserve: z.number() })),
  objectives: z.array(z.object({ id: z.string(), complete: z.boolean() })),
  encounterState: z.record(z.string(), z.unknown()).default({}),
  savedAt: z.string(),
});

export const saveFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  buildVersion: z.string(),
  difficulty: z.string().default(DEFAULT_DIFFICULTY),
  settings: settingsSchema,
  /** Keyed by episode id. Demo progress lives here too. */
  episodes: z.record(z.string(), z.unknown()),
  checkpoints: z.record(z.string(), checkpointSchema).default({}),
  offlineLicenses: z
    .array(z.object({ episodeId: z.string(), tokenId: z.string(), expiresAt: z.string() }))
    .default([]),
  updatedAt: z.string(),
});

export type SaveFile = z.infer<typeof saveFileSchema> & {
  episodes: Record<string, EpisodeProgress>;
};

export function createSaveFile(buildVersion: string, now = new Date()): SaveFile {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    buildVersion,
    difficulty: DEFAULT_DIFFICULTY,
    settings: settingsSchema.parse({}),
    episodes: { [EPISODE.FALSE_DAWN]: emptyEpisodeProgress(EPISODE.FALSE_DAWN) },
    checkpoints: {},
    offlineLicenses: [],
    updatedAt: now.toISOString(),
  };
}

export type MigrationResult =
  { ok: true; save: SaveFile; migrated: boolean } | { ok: false; reason: string };

/**
 * Migrate a save forward.
 *
 * A save from a newer build is refused rather than silently downgraded — losing
 * a player's campaign to a version rollback is not an acceptable failure.
 */
export function migrateSave(input: unknown, buildVersion: string): MigrationResult {
  const parsed = saveFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "corrupt_save" };

  if (parsed.data.schemaVersion > SAVE_SCHEMA_VERSION) {
    return { ok: false, reason: "save_from_newer_build" };
  }

  const migrated = parsed.data.schemaVersion < SAVE_SCHEMA_VERSION;
  const save = {
    ...parsed.data,
    schemaVersion: SAVE_SCHEMA_VERSION,
    buildVersion,
  } as SaveFile;

  return { ok: true, save, migrated };
}

/** Storage adapter so the browser (IndexedDB) and Electron can share callers. */
export interface SaveStore {
  load(): Promise<unknown | null>;
  save(file: SaveFile): Promise<void>;
  clear(): Promise<void>;
}

export class MemorySaveStore implements SaveStore {
  private data: unknown = null;
  async load(): Promise<unknown | null> {
    return this.data;
  }
  async save(file: SaveFile): Promise<void> {
    this.data = structuredClone(file);
  }
  async clear(): Promise<void> {
    this.data = null;
  }
}
