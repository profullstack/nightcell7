import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectSigner } from "@nightcell7/content-schema";

/**
 * Cloudflare R2 access (PRD §26.4).
 *
 * Only short-lived presigned GETs for specific objects leave this module.
 * No R2 credential ever reaches a client, and there is deliberately no
 * bucket-wide or prefix-wide token: authorization is per object, so a URL for
 * one pack cannot be edited into a URL for another.
 */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function createR2Signer(config: R2Config): ObjectSigner {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
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
 * Development signer used when R2 is not configured.
 *
 * Returns an obviously non-functional URL rather than a plausible one, so a
 * missing configuration surfaces immediately in testing instead of looking
 * like a broken CDN later.
 */
export function createUnconfiguredSigner(): ObjectSigner {
  return async (key: string) => `r2-not-configured:///${key}`;
}
