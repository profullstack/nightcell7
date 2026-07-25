import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_URL_TTL_SECONDS,
  compareSemver,
  episodeObjectKey,
  isManifestCompatible,
  signManifest,
  verifyDownloadedAsset,
  type ContentManifest,
} from "@nightcell7/content-schema";
import {
  CLAIM_TOKEN_TTL_SECONDS,
  createClaimToken,
  createOfflineLicense,
  evaluateClaim,
  isOfflineLicenseUsable,
  verifyClaimToken,
  verifyOfflineLicense,
} from "./server";
import { OFFLINE_GRACE_DAYS } from "./index";

const SECRET = "entitlement-secret-for-tests-000";
const NOW = 1_800_000_000;

const MANIFEST: ContentManifest = {
  schemaVersion: 1,
  episodeId: "false-dawn",
  version: "1.0.0",
  minimumGameVersion: "0.2.0",
  contentVersion: "1.0.0",
  generatedAt: new Date(NOW * 1000).toISOString(),
  packs: [
    {
      id: "common",
      scope: "common",
      sizeBytes: 1000,
      requiresEntitlement: false,
      assets: [
        {
          id: "shell",
          kind: "data",
          path: "shell.bin",
          sizeBytes: 1000,
          hash: "a".repeat(64),
          provenanceId: "prov-1",
        },
      ],
    },
    {
      id: "rook",
      scope: "rook",
      sizeBytes: 5000,
      requiresEntitlement: true,
      assets: [
        {
          id: "rook-map",
          kind: "map",
          path: "kaviran.glb",
          sizeBytes: 5000,
          hash: "b".repeat(64),
          provenanceId: "prov-2",
        },
      ],
    },
  ],
};

const sign = async (key: string, ttl: number) => `https://r2.test/${key}?X-Expires=${ttl}`;

describe("guest purchase claim", () => {
  const fulfilledGuestOrder = {
    id: "ord_1",
    status: "fulfilled",
    userId: null,
    email: "buyer@example.com",
  };

  function tokenFor(orderId = "ord_1") {
    return createClaimToken({ orderId, email: "buyer@example.com" }, SECRET, NOW).token;
  }

  it("issues a token that verifies and carries the order", () => {
    const { token, expiresAt } = createClaimToken(
      { orderId: "ord_1", email: "Buyer@Example.com" },
      SECRET,
      NOW,
    );
    const verified = verifyClaimToken(token, SECRET, NOW);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.orderId).toBe("ord_1");
    // Email is normalised so a case difference cannot cause a false mismatch.
    expect(verified.claims.email).toBe("buyer@example.com");
    expect(expiresAt).toBe(NOW + CLAIM_TOKEN_TTL_SECONDS);
  });

  it("accepts a valid claim on a fulfilled, unowned order", () => {
    const result = evaluateClaim(tokenFor(), SECRET, NOW, {
      order: fulfilledGuestOrder,
      alreadyConsumed: false,
    });
    expect(result).toEqual({ ok: true, orderId: "ord_1", email: "buyer@example.com" });
  });

  it("refuses a token signed with a different secret", () => {
    const result = evaluateClaim(tokenFor(), "some-other-secret-value-00000000", NOW, {
      order: fulfilledGuestOrder,
      alreadyConsumed: false,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("refuses an expired token", () => {
    const result = evaluateClaim(tokenFor(), SECRET, NOW + CLAIM_TOKEN_TTL_SECONDS + 1, {
      order: fulfilledGuestOrder,
      alreadyConsumed: false,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a second use of the same link", () => {
    const result = evaluateClaim(tokenFor(), SECRET, NOW, {
      order: fulfilledGuestOrder,
      alreadyConsumed: true,
    });
    expect(result).toEqual({ ok: false, reason: "already_claimed" });
  });

  it("refuses an order that already belongs to an account", () => {
    const result = evaluateClaim(tokenFor(), SECRET, NOW, {
      order: { ...fulfilledGuestOrder, userId: "u_someone" },
      alreadyConsumed: false,
    });
    expect(result).toEqual({ ok: false, reason: "already_claimed" });
  });

  it("refuses to hand over content for an order that is not fulfilled", () => {
    // The whole point: holding the link must not be enough if nobody paid.
    for (const status of ["created", "pending", "confirming", "paid", "refunded", "expired"]) {
      const result = evaluateClaim(tokenFor(), SECRET, NOW, {
        order: { ...fulfilledGuestOrder, status },
        alreadyConsumed: false,
      });
      expect(result, status).toEqual({ ok: false, reason: "order_not_fulfilled" });
    }
  });

  it("refuses a token whose order id does not match the loaded order", () => {
    const result = evaluateClaim(tokenFor("ord_other"), SECRET, NOW, {
      order: fulfilledGuestOrder,
      alreadyConsumed: false,
    });
    expect(result).toEqual({ ok: false, reason: "order_not_found" });
  });

  it("can require the claiming account to match the payment email", () => {
    const mismatch = evaluateClaim(tokenFor(), SECRET, NOW, {
      order: fulfilledGuestOrder,
      alreadyConsumed: false,
      requireEmailMatch: true,
      claimantEmail: "someone.else@example.com",
    });
    expect(mismatch).toEqual({ ok: false, reason: "email_mismatch" });

    const match = evaluateClaim(tokenFor(), SECRET, NOW, {
      order: fulfilledGuestOrder,
      alreadyConsumed: false,
      requireEmailMatch: true,
      claimantEmail: "BUYER@example.com",
    });
    expect(match.ok).toBe(true);
  });
});

describe("offline licences", () => {
  const input = {
    userId: "u1",
    episodeId: "false-dawn",
    deviceId: "device-abc",
    contentVersion: "1.0.0",
  };

  it("issues a licence for the configured grace period", () => {
    const license = createOfflineLicense(input, SECRET, NOW, OFFLINE_GRACE_DAYS);
    expect(license.expiresAt).toBe(NOW + OFFLINE_GRACE_DAYS * 86400);

    const verified = verifyOfflineLicense(license.token, SECRET, NOW);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.sub).toBe("u1");
    expect(verified.claims.deviceId).toBe("device-abc");
  });

  it("stops working after the grace period", () => {
    const license = createOfflineLicense(input, SECRET, NOW, OFFLINE_GRACE_DAYS);
    const later = NOW + OFFLINE_GRACE_DAYS * 86400 + 1;
    expect(verifyOfflineLicense(license.token, SECRET, later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("is bound to the device it was issued for", () => {
    const license = createOfflineLicense(input, SECRET, NOW, OFFLINE_GRACE_DAYS);
    const verified = verifyOfflineLicense(license.token, SECRET, NOW);
    if (!verified.ok) throw new Error("expected a valid licence");

    expect(
      isOfflineLicenseUsable(verified.claims, {
        deviceId: "a-different-device",
        revoked: false,
        nowSeconds: NOW,
      }),
    ).toEqual({ usable: false, reason: "wrong_device" });
  });

  it("fails closed once revoked, even while the signature is still valid", () => {
    // This is the refund path: the token is cryptographically fine, but the
    // entitlement behind it is gone (PRD §5.6).
    const license = createOfflineLicense(input, SECRET, NOW, OFFLINE_GRACE_DAYS);
    const verified = verifyOfflineLicense(license.token, SECRET, NOW);
    if (!verified.ok) throw new Error("expected a valid licence");

    expect(
      isOfflineLicenseUsable(verified.claims, {
        deviceId: "device-abc",
        revoked: true,
        nowSeconds: NOW,
      }),
    ).toEqual({ usable: false, reason: "revoked" });
  });

  it("cannot be forged with a different secret", () => {
    const license = createOfflineLicense(input, SECRET, NOW, OFFLINE_GRACE_DAYS);
    expect(verifyOfflineLicense(license.token, "another-secret-000000000000", NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});

describe("content delivery", () => {
  it("omits entitlement-gated packs entirely for an unentitled caller", async () => {
    const signed = await signManifest({ manifest: MANIFEST, hasEntitlement: false, sign });
    expect(signed.packs.map((p) => p.id)).toEqual(["common"]);
    // Not merely URL-less — the paid pack's existence and size are not disclosed.
    expect(JSON.stringify(signed)).not.toContain("kaviran.glb");
  });

  it("includes paid packs with signed URLs for an owner", async () => {
    const signed = await signManifest({ manifest: MANIFEST, hasEntitlement: true, sign });
    expect(signed.packs.map((p) => p.id)).toEqual(["common", "rook"]);
    const asset = signed.packs.find((p) => p.id === "rook")!.assets[0]!;
    expect(asset.url).toContain("private/episodes/false-dawn/1.0.0/rook/kaviran.glb");
    expect(asset.hash).toBe("b".repeat(64));
  });

  it("keeps private objects under the private prefix", () => {
    const key = episodeObjectKey("false-dawn", "1.0.0", "rook", "kaviran.glb");
    expect(key.startsWith("private/episodes/")).toBe(true);
  });

  it("refuses traversal in a content path", () => {
    expect(() => episodeObjectKey("false-dawn", "1.0.0", "rook", "../../secrets")).toThrow(
      /unsafe content path/,
    );
    expect(() => episodeObjectKey("false-dawn", "1.0.0", "rook", "/etc/passwd")).toThrow();
  });

  it("issues short-lived URLs", async () => {
    const signed = await signManifest({
      manifest: MANIFEST,
      hasEntitlement: true,
      sign,
      now: new Date(NOW * 1000),
    });
    const ttlMs = new Date(signed.expiresAt).getTime() - NOW * 1000;
    expect(ttlMs / 1000).toBe(DOWNLOAD_URL_TTL_SECONDS);
    expect(DOWNLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(900);
  });

  it("rejects a truncated or swapped download", () => {
    const expected = { sizeBytes: 5000, hash: "b".repeat(64) };
    expect(verifyDownloadedAsset(expected, expected)).toEqual({ valid: true });
    expect(verifyDownloadedAsset(expected, { ...expected, sizeBytes: 4999 })).toEqual({
      valid: false,
      reason: "size_mismatch",
    });
    expect(verifyDownloadedAsset(expected, { ...expected, hash: "c".repeat(64) })).toEqual({
      valid: false,
      reason: "hash_mismatch",
    });
  });

  it("blocks a pack whose content version does not match the client", () => {
    expect(
      isManifestCompatible(MANIFEST, { buildVersion: "0.2.0", contentVersion: "0.9.0" }),
    ).toEqual({ compatible: false, reason: "content_mismatch" });
  });

  it("blocks a client older than the pack's minimum build", () => {
    expect(
      isManifestCompatible(MANIFEST, { buildVersion: "0.1.9", contentVersion: "1.0.0" }),
    ).toEqual({ compatible: false, reason: "update_required" });

    expect(
      isManifestCompatible(MANIFEST, { buildVersion: "0.2.0", contentVersion: "1.0.0" }),
    ).toEqual({ compatible: true });
  });

  it("compares versions numerically, not lexically", () => {
    expect(compareSemver("0.10.0", "0.9.0")).toBe(1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("0.2.0-beta.1", "0.2.0")).toBe(0);
  });
});
