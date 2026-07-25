import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@nightcell7/database";
import {
  devices,
  downloads,
  episodeVersions,
  offlineLicenses,
  entitlementEvents,
  entitlements,
  feedback,
  multiplayerBans,
  multiplayerBlocks,
  multiplayerMatchPlayers,
  multiplayerMatches,
  multiplayerProfiles,
  multiplayerReports,
  newsletterSubscribers,
  orderItems,
  orders,
  paymentEvents,
  sessions,
  users,
} from "@nightcell7/database";
import type { AccountContext } from "@nightcell7/auth";
import type { OrderStatus } from "@nightcell7/entitlements";

/**
 * Data access for the API service.
 *
 * Everything the HTTP layer needs from the database goes through here, which
 * keeps route handlers free of query building and makes them testable against
 * a fake implementation.
 */
export interface Repositories {
  findAccountBySessionToken(token: string): Promise<AccountContext | null>;
  listEntitlements(
    userId: string,
  ): Promise<{ episodeId: string; status: string; grantedAt: string }[]>;
  findEntitlement(userId: string, episodeId: string): Promise<{ status: string } | null>;

  findOrderByIdempotencyKey(key: string): Promise<{ id: string; status: string } | null>;
  createOrder(input: CreateOrderInput): Promise<void>;
  attachCoinpayInvoice(orderId: string, invoiceId: string): Promise<void>;
  listOrders(userId: string): Promise<OrderSummary[]>;

  recordPaymentEvent(input: RecordPaymentEventInput): Promise<{ duplicate: boolean }>;

  findCurrentEpisodeVersion(episodeId: string): Promise<EpisodeVersionRow | null>;
  recordOfflineLicense(input: RecordOfflineLicenseInput): Promise<void>;
  startDownload(input: StartDownloadInput): Promise<void>;

  listDevices(userId: string): Promise<DeviceRow[]>;
  revokeDevice(userId: string, deviceId: string): Promise<boolean>;

  getMultiplayerProfile(userId: string): Promise<MultiplayerProfileRow | null>;
  listMatchHistory(userId: string, limit: number): Promise<MatchHistoryRow[]>;
  getMatch(matchId: string): Promise<MatchHistoryRow | null>;
  wasInMatch(userId: string, matchId: string): Promise<boolean>;

  createReport(input: CreateReportInput): Promise<void>;
  addBlock(userId: string, blockedUserId: string): Promise<void>;
  removeBlock(userId: string, blockedUserId: string): Promise<void>;
  listBlocks(userId: string): Promise<string[]>;

  subscribeNewsletter(email: string, source: string): Promise<void>;
  createFeedback(input: CreateFeedbackInput): Promise<void>;
}

export interface CreateOrderInput {
  id: string;
  userId: string | null;
  email: string | null;
  episodeId: string;
  currency: string;
  unitAmount: number;
  idempotencyKey: string;
}

export interface RecordPaymentEventInput {
  id: string;
  providerEventId: string;
  eventType: string;
  orderId: string | null;
  payloadHash: string;
  receivedAt: string;
}

export interface EpisodeVersionRow {
  id: string;
  version: string;
  manifestKey: string;
  minimumGameVersion: string;
  sizeBytes: number;
}

export interface RecordOfflineLicenseInput {
  id: string;
  userId: string;
  episodeId: string;
  deviceId: string;
  tokenId: string;
  issuedAt: string;
  expiresAt: string;
  platform: string;
  label: string;
}

export interface StartDownloadInput {
  id: string;
  userId: string;
  episodeId: string;
  versionId: string;
  platform: string;
  startedAt: string;
}

export interface OrderSummary {
  id: string;
  status: string;
  currency: string;
  total: number;
  createdAt: string;
  paidAt: string | null;
}

export interface DeviceRow {
  id: string;
  label: string;
  platform: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface MultiplayerProfileRow {
  userId: string;
  displayName: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  lastMatchAt: string | null;
  restrictedUntil: string | null;
}

export interface MatchHistoryRow {
  matchId: string;
  mode: string;
  mapId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  winningTeam: number | null;
  terminationReason: string | null;
}

export interface CreateReportInput {
  id: string;
  reporterUserId: string;
  reportedUserId: string;
  matchId: string;
  category: string;
  description?: string;
}

export interface CreateFeedbackInput {
  id: string;
  userId: string | null;
  buildVersion: string;
  category: string;
  message: string;
  episodeId?: string;
  side?: string;
  multiplayerMatchId?: string;
}

export function createRepositories(db: Database): Repositories {
  return {
    async findAccountBySessionToken(token) {
      const rows = await db
        .select({
          userId: users.id,
          verifiedAt: users.verifiedAt,
          status: users.status,
          expiresAt: sessions.expiresAt,
          revokedAt: sessions.revokedAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.token, token))
        .limit(1);

      const row = rows[0];
      if (!row) return null;
      if (row.revokedAt) return null;
      if (new Date(row.expiresAt).getTime() <= Date.now()) return null;

      // An active ban makes the multiplayer ticket endpoint fail closed.
      const bans = await db
        .select({ endsAt: multiplayerBans.endsAt })
        .from(multiplayerBans)
        .where(
          and(eq(multiplayerBans.userId, row.userId), sql`${multiplayerBans.revokedAt} is null`),
        )
        .limit(1);

      return {
        userId: row.userId,
        verified: row.verifiedAt !== null,
        status: row.status as AccountContext["status"],
        multiplayerBannedUntil:
          bans[0]?.endsAt ?? (bans.length > 0 ? "9999-12-31T00:00:00.000Z" : null),
      };
    },

    async listEntitlements(userId) {
      const rows = await db
        .select({
          episodeId: entitlements.episodeId,
          status: entitlements.status,
          grantedAt: entitlements.grantedAt,
        })
        .from(entitlements)
        .where(eq(entitlements.userId, userId));
      return rows;
    },

    async findEntitlement(userId, episodeId) {
      const rows = await db
        .select({ status: entitlements.status })
        .from(entitlements)
        .where(and(eq(entitlements.userId, userId), eq(entitlements.episodeId, episodeId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findOrderByIdempotencyKey(key) {
      const rows = await db
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.idempotencyKey, key))
        .limit(1);
      return rows[0] ?? null;
    },

    async createOrder(input) {
      await db.insert(orders).values({
        id: input.id,
        userId: input.userId,
        email: input.email,
        provider: "coinpay",
        currency: input.currency,
        subtotal: input.unitAmount,
        tax: 0,
        total: input.unitAmount,
        status: "created",
        idempotencyKey: input.idempotencyKey,
      });
      await db.insert(orderItems).values({
        id: `oi_${input.id}`,
        orderId: input.id,
        episodeId: input.episodeId,
        unitAmount: input.unitAmount,
        quantity: 1,
      });
    },

    async attachCoinpayInvoice(orderId, invoiceId) {
      await db
        .update(orders)
        .set({ coinpayOrderId: invoiceId, status: "pending" satisfies OrderStatus })
        .where(eq(orders.id, orderId));
    },

    async listOrders(userId) {
      return db
        .select({
          id: orders.id,
          status: orders.status,
          currency: orders.currency,
          total: orders.total,
          createdAt: orders.createdAt,
          paidAt: orders.paidAt,
        })
        .from(orders)
        .where(eq(orders.userId, userId))
        .orderBy(desc(orders.createdAt));
    },

    async recordPaymentEvent(input) {
      try {
        await db.insert(paymentEvents).values({
          id: input.id,
          provider: "coinpay",
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          orderId: input.orderId,
          payloadHash: input.payloadHash,
          processingStatus: "received",
          receivedAt: input.receivedAt,
        });
        return { duplicate: false };
      } catch (error) {
        // The unique constraint on provider_event_id IS the idempotency guard.
        // A duplicate is an expected provider retry, not an error (PRD §24.4).
        if (isUniqueViolation(error)) return { duplicate: true };
        throw error;
      }
    },

    async findCurrentEpisodeVersion(episodeId) {
      // Only a published version is downloadable; a draft must never leak to a
      // player just because the row exists.
      const rows = await db
        .select({
          id: episodeVersions.id,
          version: episodeVersions.version,
          manifestKey: episodeVersions.manifestKey,
          minimumGameVersion: episodeVersions.minimumGameVersion,
          sizeBytes: episodeVersions.sizeBytes,
        })
        .from(episodeVersions)
        .where(
          and(eq(episodeVersions.episodeId, episodeId), eq(episodeVersions.status, "published")),
        )
        .orderBy(desc(episodeVersions.publishedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async recordOfflineLicense(input) {
      await db.insert(offlineLicenses).values({
        id: input.id,
        userId: input.userId,
        episodeId: input.episodeId,
        deviceId: input.deviceId,
        tokenId: input.tokenId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
      });

      // Issuing a licence also remembers the device, so the user can see and
      // revoke it from their account page (PRD §26.6).
      await db
        .insert(devices)
        .values({
          id: input.deviceId,
          userId: input.userId,
          label: input.label,
          platform: input.platform,
          firstSeenAt: input.issuedAt,
          lastSeenAt: input.issuedAt,
        })
        .onConflictDoUpdate({
          target: devices.id,
          set: { lastSeenAt: input.issuedAt, revokedAt: null },
        });
    },

    async startDownload(input) {
      await db.insert(downloads).values({
        id: input.id,
        userId: input.userId,
        episodeId: input.episodeId,
        versionId: input.versionId,
        platform: input.platform,
        startedAt: input.startedAt,
      });
    },

    async listDevices(userId) {
      return db
        .select({
          id: devices.id,
          label: devices.label,
          platform: devices.platform,
          lastSeenAt: devices.lastSeenAt,
          revokedAt: devices.revokedAt,
        })
        .from(devices)
        .where(eq(devices.userId, userId));
    },

    async revokeDevice(userId, deviceId) {
      const result = await db
        .update(devices)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)));
      return (result as unknown as { rowsAffected?: number }).rowsAffected !== 0;
    },

    async getMultiplayerProfile(userId) {
      const rows = await db
        .select()
        .from(multiplayerProfiles)
        .where(eq(multiplayerProfiles.userId, userId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        userId: row.userId,
        displayName: row.displayNameSnapshot,
        matchesPlayed: row.matchesPlayed,
        wins: row.wins,
        losses: row.losses,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        lastMatchAt: row.lastMatchAt,
        restrictedUntil: row.matchmakingRestrictedUntil,
      };
    },

    async listMatchHistory(userId, limit) {
      return db
        .select({
          matchId: multiplayerMatches.id,
          mode: multiplayerMatches.mode,
          mapId: multiplayerMatches.mapId,
          startedAt: multiplayerMatches.startedAt,
          endedAt: multiplayerMatches.endedAt,
          durationMs: multiplayerMatches.durationMs,
          winningTeam: multiplayerMatches.winningTeam,
          terminationReason: multiplayerMatches.terminationReason,
        })
        .from(multiplayerMatchPlayers)
        .innerJoin(multiplayerMatches, eq(multiplayerMatches.id, multiplayerMatchPlayers.matchId))
        .where(eq(multiplayerMatchPlayers.userId, userId))
        .orderBy(desc(multiplayerMatches.startedAt))
        .limit(limit);
    },

    async getMatch(matchId) {
      const rows = await db
        .select({
          matchId: multiplayerMatches.id,
          mode: multiplayerMatches.mode,
          mapId: multiplayerMatches.mapId,
          startedAt: multiplayerMatches.startedAt,
          endedAt: multiplayerMatches.endedAt,
          durationMs: multiplayerMatches.durationMs,
          winningTeam: multiplayerMatches.winningTeam,
          terminationReason: multiplayerMatches.terminationReason,
        })
        .from(multiplayerMatches)
        .where(eq(multiplayerMatches.id, matchId))
        .limit(1);
      return rows[0] ?? null;
    },

    async wasInMatch(userId, matchId) {
      const rows = await db
        .select({ userId: multiplayerMatchPlayers.userId })
        .from(multiplayerMatchPlayers)
        .where(
          and(
            eq(multiplayerMatchPlayers.userId, userId),
            eq(multiplayerMatchPlayers.matchId, matchId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async createReport(input) {
      await db.insert(multiplayerReports).values({
        id: input.id,
        reporterUserId: input.reporterUserId,
        reportedUserId: input.reportedUserId,
        matchId: input.matchId,
        category: input.category,
        description: input.description,
        status: "open",
      });
    },

    async addBlock(userId, blockedUserId) {
      await db.insert(multiplayerBlocks).values({ userId, blockedUserId }).onConflictDoNothing();
    },

    async removeBlock(userId, blockedUserId) {
      await db
        .delete(multiplayerBlocks)
        .where(
          and(
            eq(multiplayerBlocks.userId, userId),
            eq(multiplayerBlocks.blockedUserId, blockedUserId),
          ),
        );
    },

    async listBlocks(userId) {
      const rows = await db
        .select({ blockedUserId: multiplayerBlocks.blockedUserId })
        .from(multiplayerBlocks)
        .where(eq(multiplayerBlocks.userId, userId));
      return rows.map((r) => r.blockedUserId);
    },

    async subscribeNewsletter(email, source) {
      await db
        .insert(newsletterSubscribers)
        .values({ id: `nl_${crypto.randomUUID()}`, email, source })
        .onConflictDoNothing();
    },

    async createFeedback(input) {
      await db.insert(feedback).values({
        id: input.id,
        userId: input.userId,
        buildVersion: input.buildVersion,
        episodeId: input.episodeId,
        side: input.side,
        multiplayerMatchId: input.multiplayerMatchId,
        category: input.category,
        message: input.message,
      });
    },
  };
}

/** Audit helper — entitlement history is append-only (PRD §24.4). */
export async function appendEntitlementEvent(
  db: Database,
  entitlementId: string,
  type: string,
  actor: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(entitlementEvents).values({
    id: `ee_${crypto.randomUUID()}`,
    entitlementId,
    type,
    actor,
    metadata,
  });
}

function isUniqueViolation(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error).toUpperCase();
  return message.includes("UNIQUE") || message.includes("SQLITE_CONSTRAINT");
}
