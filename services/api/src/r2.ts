import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { manifestSchema, type ContentManifest } from "@nightcell7/content-schema";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectSigner } from "@nightcell7/content-schema";

/**
 * Object storage for episode content (PRD §26.4).
 *
 * Only short-lived presigned GETs for specific objects leave this module.
 * No R2 credential ever reaches a client, and there is deliberately no
 * bucket-wide or prefix-wide token: authorization is per object, so a URL for
 * one pack cannot be edited into a URL for another.
 */

export interface R2Config {
  /** Cloudflare account id. Ignored when an explicit endpoint is given. */
  accountId?: string;
  /**
   * Full S3 endpoint. Set this to use any S3-compatible provider — Supabase
   * Storage, Backblaze B2, MinIO — instead of R2. The rest of the delivery
   * path is provider-agnostic, so the choice is one environment variable.
   */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function resolveEndpoint(config: R2Config): string {
  if (config.endpoint) return config.endpoint;
  if (config.accountId) return `https://${config.accountId}.r2.cloudflarestorage.com`;
  throw new Error("storage needs either S3_ENDPOINT or R2_ACCOUNT_ID");
}

export function createR2Signer(config: R2Config): ObjectSigner {
  const client = new S3Client({
    region: "auto",
    endpoint: resolveEndpoint(config),
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return async (key: string, ttlSeconds: number): Promise<string> => {
    const command = new GetObjectCommand({ Bucket: config.bucket, Key: key });
    return getSignedUrl(client, command, { expiresIn: ttlSeconds });
  };
}

/**
 * Read and validate a content manifest from R2.
 *
 * The manifest is parsed against the schema before it is trusted: it decides
 * which files a paying customer downloads, so a malformed or truncated object
 * must fail loudly rather than produce a half-manifest.
 */
export function createR2ManifestLoader(config: R2Config) {
  const client = new S3Client({
    region: "auto",
    endpoint: resolveEndpoint(config),
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return async (episodeId: string, version: string): Promise<ContentManifest | null> => {
    const key = `private/episodes/${episodeId}/${version}/manifest.json`;
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      const body = await result.Body?.transformToString();
      if (!body) return null;
      return manifestSchema.parse(JSON.parse(body));
    } catch (error) {
      // A missing manifest is a legitimate "not published yet"; anything else
      // is a real fault and must not be mistaken for one.
      const name = (error as { name?: string })?.name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw error;
    }
  };
}

/**
 * Development signer used when R2 is not configured.
 *
 * Returns an obviously non-functional URL rather than a plausible one, so a
 * missing configuration surfaces immediately in testing instead of looking
 * like a broken CDN later.
 */
export function createUnconfiguredSigner(): ObjectSigner {
  return async (key: string) => `r2-not-configured:///${key}`;
}
