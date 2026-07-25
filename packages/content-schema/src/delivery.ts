import { manifestSchema, type ContentManifest, type ContentPack } from "./index.js";

/**
 * Authorized content delivery (PRD §26.3, §26.4).
 *
 * Rules encoded here:
 *   - private episode objects live under `private/episodes/{id}/{version}/...`
 *     and are never publicly readable;
 *   - authorization is bound to a specific episode + version + object, so a
 *     token for one pack cannot fetch another;
 *   - URLs are short-lived;
 *   - the manifest itself is entitlement-protected, not just the assets.
 *
 * The signing implementation is injected rather than imported, so this module
 * stays free of the AWS SDK and remains usable from tests and from the client
 * for validation.
 */

export const R2_PREFIX = {
  PUBLIC_SHELL: "public/game-shell",
  PUBLIC_DEMO: "public/demo",
  PUBLIC_MARKETING: "public/marketing",
  PRIVATE_EPISODES: "private/episodes",
} as const;

/** Presigned URLs are deliberately short-lived (PRD §26.4). */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

export function episodeObjectKey(
  episodeId: string,
  version: string,
  scope: string,
  path: string,
): string {
  // Reject traversal in content paths — a manifest is data, and data can be
  // wrong or hostile.
  if (path.includes("..") || path.startsWith("/")) {
    throw new Error(`unsafe content path: ${path}`);
  }
  return `${R2_PREFIX.PRIVATE_EPISODES}/${episodeId}/${version}/${scope}/${path}`;
}

export function manifestObjectKey(episodeId: string, version: string): string {
  return `${R2_PREFIX.PRIVATE_EPISODES}/${episodeId}/${version}/manifest.json`;
}

export interface SignedAsset {
  id: string;
  path: string;
  sizeBytes: number;
  hash: string;
  url: string;
  expiresAt: string;
}

export interface SignedPack {
  id: string;
  scope: ContentPack["scope"];
  sizeBytes: number;
  requiresEntitlement: boolean;
  assets: SignedAsset[];
}

export interface SignedManifest {
  episodeId: string;
  version: string;
  contentVersion: string;
  minimumGameVersion: string;
  totalBytes: number;
  packs: SignedPack[];
  expiresAt: string;
}

/** Signs one object key into a time-limited GET URL. */
export type ObjectSigner = (key: string, ttlSeconds: number) => Promise<string>;

export interface SignManifestOptions {
  manifest: ContentManifest;
  hasEntitlement: boolean;
  sign: ObjectSigner;
  ttlSeconds?: number;
  now?: Date;
}

/**
 * Turn a manifest into a downloadable, authorized manifest.
 *
 * Packs the caller is not entitled to are removed entirely rather than being
 * returned with a null URL — an unauthorized client should not even learn the
 * shape of what it cannot have.
 */
export async function signManifest(options: SignManifestOptions): Promise<SignedManifest> {
  const manifest = manifestSchema.parse(options.manifest);
  const ttl = options.ttlSeconds ?? DOWNLOAD_URL_TTL_SECONDS;
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

  const visible = manifest.packs.filter(
    (pack) => options.hasEntitlement || !pack.requiresEntitlement,
  );

  const packs: SignedPack[] = [];
  for (const pack of visible) {
    const assets: SignedAsset[] = [];
    for (const asset of pack.assets) {
      const key = episodeObjectKey(manifest.episodeId, manifest.version, pack.scope, asset.path);
      assets.push({
        id: asset.id,
        path: asset.path,
        sizeBytes: asset.sizeBytes,
        hash: asset.hash,
        url: await options.sign(key, ttl),
        expiresAt,
      });
    }
    packs.push({
      id: pack.id,
      scope: pack.scope,
      sizeBytes: pack.sizeBytes,
      requiresEntitlement: pack.requiresEntitlement,
      assets,
    });
  }

  return {
    episodeId: manifest.episodeId,
    version: manifest.version,
    contentVersion: manifest.contentVersion,
    minimumGameVersion: manifest.minimumGameVersion,
    totalBytes: packs.reduce((sum, pack) => sum + pack.sizeBytes, 0),
    packs,
    expiresAt,
  };
}

/**
 * Client-side verification after download (PRD §26.2 steps 8-9).
 *
 * Size and hash are both checked: a truncated download often has a plausible
 * size, and a swapped file often has a plausible hash for a *different* asset.
 */
export function verifyDownloadedAsset(
  expected: { sizeBytes: number; hash: string },
  actual: { sizeBytes: number; hash: string },
): { valid: true } | { valid: false; reason: "size_mismatch" | "hash_mismatch" } {
  if (expected.sizeBytes !== actual.sizeBytes) return { valid: false, reason: "size_mismatch" };
  if (expected.hash.toLowerCase() !== actual.hash.toLowerCase()) {
    return { valid: false, reason: "hash_mismatch" };
  }
  return { valid: true };
}

/** Compatibility gate before a pack is allowed to become playable. */
export function isManifestCompatible(
  manifest: Pick<ContentManifest, "minimumGameVersion" | "contentVersion">,
  client: { buildVersion: string; contentVersion: string },
): { compatible: true } | { compatible: false; reason: "update_required" | "content_mismatch" } {
  if (compareSemver(client.buildVersion, manifest.minimumGameVersion) < 0) {
    return { compatible: false, reason: "update_required" };
  }
  if (client.contentVersion !== manifest.contentVersion) {
    return { compatible: false, reason: "content_mismatch" };
  }
  return { compatible: true };
}

/** Minimal semver compare; build metadata after `+` or `-` is ignored. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split(/[+-]/)[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
