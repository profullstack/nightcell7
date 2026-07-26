import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Durable application data (PRD §25) on Turso/libSQL.
 *
 * What is NOT here matters as much as what is: per-tick match state, matchmaking
 * queues, presence and ticket replay guards live in Redis and are discarded
 * after the durable match summary is accepted. Never write per-tick state here.
 */

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
};

/**
 * Timestamps for the Better Auth-managed tables.
 *
 * Better Auth writes epoch milliseconds, not ISO strings. Stored in a text
 * column those read back as "1785045862563.0", and `new Date(...)` on that is
 * Invalid Date — which silently turned the session-expiry comparison into
 * `NaN <= now`, i.e. false, i.e. expired sessions accepted forever. Integer
 * timestamp columns make Drizzle hand back real Date objects instead.
 */
const authTimestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

// --------------------------------------------------------------------------
// Accounts
// --------------------------------------------------------------------------

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    /**
     * Better Auth owns this flag. It is the single source of truth for
     * "verified" everywhere, including multiplayer eligibility — a second
     * timestamp column would eventually disagree with it.
     */
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    /** Better Auth requires `name`; the game shows `displayName`. */
    name: text("name"),
    image: text("image"),
    displayName: text("display_name").notNull(),
    displayNameChangedAt: text("display_name_changed_at"),
    /** active | restricted | banned | deleted */
    status: text("status").notNull().default("active"),
    ...authTimestamps,
  },
  (table) => ({
    emailIdx: unique("users_email_unique").on(table.email),
    // Display names are not authorization identifiers (PRD §23.3), but they
    // still must be unique enough to report and block by.
    displayNameIdx: unique("users_display_name_unique").on(table.displayName),
  }),
);

/**
 * Sessions, written by Better Auth.
 *
 * Field names match what the Drizzle adapter expects so no mapping layer is
 * needed; `revokedAt` is ours, for the device-revocation flow.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    revokedAt: text("revoked_at"),
    ...authTimestamps,
  },
  (table) => ({
    tokenIdx: unique("sessions_token_unique").on(table.token),
    userIdx: index("sessions_user_idx").on(table.userId),
  }),
);

/**
 * Credential and OAuth records, written by Better Auth.
 * Password hashes live here, never on `users`.
 */
export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    ...authTimestamps,
  },
  (table) => ({
    providerIdx: unique("accounts_provider_account_unique").on(table.providerId, table.accountId),
    userIdx: index("accounts_user_idx").on(table.userId),
  }),
);

/** Email-verification and password-reset tokens, written by Better Auth. */
export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ...authTimestamps,
  },
  (table) => ({
    identifierIdx: index("verifications_identifier_idx").on(table.identifier),
  }),
);

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** web | pwa | windows | macos | linux */
    platform: text("platform").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => ({ userIdx: index("devices_user_idx").on(table.userId) }),
);

// --------------------------------------------------------------------------
// Catalog
// --------------------------------------------------------------------------

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  theater: text("theater").notNull(),
  description: text("description"),
  /** draft | available | coming_soon | unavailable */
  status: text("status").notNull().default("draft"),
  releaseAt: text("release_at"),
  coverAssetId: text("cover_asset_id"),
  trailerUrl: text("trailer_url"),
  currentVersionId: text("current_version_id"),
  ...timestamps,
});

export const episodeVersions = sqliteTable(
  "episode_versions",
  {
    id: text("id").primaryKey(),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id),
    version: text("version").notNull(),
    /** R2 key of the content manifest for this version. */
    manifestKey: text("manifest_key").notNull(),
    minimumGameVersion: text("minimum_game_version").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").notNull().default("draft"),
    publishedAt: text("published_at"),
  },
  (table) => ({
    episodeVersionIdx: unique("episode_versions_unique").on(table.episodeId, table.version),
  }),
);

export const prices = sqliteTable(
  "prices",
  {
    id: text("id").primaryKey(),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id),
    currency: text("currency").notNull(),
    /** Minor units. The server catalog is the price authority (PRD §24.6). */
    unitAmount: integer("unit_amount").notNull(),
    coinpayProductId: text("coinpay_product_id").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    taxCode: text("tax_code").notNull(),
  },
  (table) => ({ episodeIdx: index("prices_episode_idx").on(table.episodeId) }),
);

// --------------------------------------------------------------------------
// Commerce — CoinPayPortal only (PRD §24)
// --------------------------------------------------------------------------

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    /** Null for guest checkout until the claim link is used (PRD §23.4). */
    userId: text("user_id").references(() => users.id),
    email: text("email"),
    /** Fixed to "coinpay". A second processor is a product decision, not a row. */
    provider: text("provider").notNull().default("coinpay"),
    coinpayOrderId: text("coinpay_order_id"),
    coinpayPaymentId: text("coinpay_payment_id"),
    currency: text("currency").notNull(),
    subtotal: integer("subtotal").notNull(),
    tax: integer("tax").notNull().default(0),
    total: integer("total").notNull(),
    status: text("status").notNull().default("created"),
    idempotencyKey: text("idempotency_key").notNull(),
    paidAt: text("paid_at"),
    fulfilledAt: text("fulfilled_at"),
    refundedAt: text("refunded_at"),
    ...timestamps,
  },
  (table) => ({
    idempotencyIdx: unique("orders_idempotency_unique").on(table.idempotencyKey),
    userIdx: index("orders_user_idx").on(table.userId),
    statusIdx: index("orders_status_idx").on(table.status),
  }),
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id),
    unitAmount: integer("unit_amount").notNull(),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => ({ orderIdx: index("order_items_order_idx").on(table.orderId) }),
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("coinpay"),
    /** Unique constraint IS the webhook idempotency guard (PRD §24.4). */
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    orderId: text("order_id").references(() => orders.id),
    /** Hash only — raw provider payloads may contain payer detail. */
    payloadHash: text("payload_hash").notNull(),
    processingStatus: text("processing_status").notNull().default("received"),
    receivedAt: text("received_at").notNull(),
    processedAt: text("processed_at"),
  },
  (table) => ({
    providerEventIdx: unique("payment_events_provider_event_unique").on(table.providerEventId),
    statusIdx: index("payment_events_status_idx").on(table.processingStatus),
  }),
);

export const entitlements = sqliteTable(
  "entitlements",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id),
    sourceOrderId: text("source_order_id").references(() => orders.id),
    status: text("status").notNull().default("active"),
    grantedAt: text("granted_at").notNull(),
    revokedAt: text("revoked_at"),
    reason: text("reason"),
  },
  (table) => ({
    // One entitlement per user per episode — the "grant exactly once" guarantee
    // is enforced by the database, not only by application logic.
    userEpisodeIdx: unique("entitlements_user_episode_unique").on(table.userId, table.episodeId),
  }),
);

/** Append-only audit trail. Support tooling writes here; it never edits above. */
export const entitlementEvents = sqliteTable(
  "entitlement_events",
  {
    id: text("id").primaryKey(),
    entitlementId: text("entitlement_id")
      .notNull()
      .references(() => entitlements.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    metadata: text("metadata", { mode: "json" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => ({ entitlementIdx: index("entitlement_events_idx").on(table.entitlementId) }),
);

export const offlineLicenses = sqliteTable(
  "offline_licenses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id),
    deviceId: text("device_id").notNull(),
    tokenId: text("token_id").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => ({
    tokenIdx: unique("offline_licenses_token_unique").on(table.tokenId),
    userIdx: index("offline_licenses_user_idx").on(table.userId),
  }),
);

export const downloads = sqliteTable(
  "downloads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    episodeId: text("episode_id").references(() => episodes.id),
    versionId: text("version_id").references(() => episodeVersions.id),
    platform: text("platform").notNull(),
    bytes: integer("bytes"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    result: text("result"),
  },
  (table) => ({ userIdx: index("downloads_user_idx").on(table.userId) }),
);

// --------------------------------------------------------------------------
// Multiplayer (PRD §25)
// --------------------------------------------------------------------------

export const multiplayerProfiles = sqliteTable("multiplayer_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayNameSnapshot: text("display_name_snapshot").notNull(),
  matchesPlayed: integer("matches_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  deaths: integer("deaths").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  lastMatchAt: text("last_match_at"),
  matchmakingRestrictedUntil: text("matchmaking_restricted_until"),
  ...timestamps,
});

export const multiplayerMatches = sqliteTable(
  "multiplayer_matches",
  {
    id: text("id").primaryKey(),
    mode: text("mode").notNull(),
    mapId: text("map_id").notNull(),
    regionId: text("region_id").notNull(),
    shardId: text("shard_id").notNull(),
    roomId: text("room_id").notNull(),
    protocolVersion: integer("protocol_version").notNull(),
    buildVersion: text("build_version").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    durationMs: integer("duration_ms"),
    winningTeam: integer("winning_team"),
    terminationReason: text("termination_reason"),
    /** Idempotency key for result persistence (PRD §33.3). */
    resultHash: text("result_hash").notNull(),
  },
  (table) => ({
    resultHashIdx: unique("multiplayer_matches_result_hash_unique").on(table.resultHash),
    startedIdx: index("multiplayer_matches_started_idx").on(table.startedAt),
  }),
);

export const multiplayerMatchPlayers = sqliteTable(
  "multiplayer_match_players",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => multiplayerMatches.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    team: integer("team").notNull(),
    isBot: integer("is_bot", { mode: "boolean" }).notNull().default(false),
    joinedAt: text("joined_at").notNull(),
    leftAt: text("left_at"),
    reconnectCount: integer("reconnect_count").notNull().default(0),
    kills: integer("kills").notNull().default(0),
    deaths: integer("deaths").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    score: integer("score").notNull().default(0),
    result: text("result").notNull(),
    reportableSessionId: text("reportable_session_id").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.matchId, table.userId] }),
    userIdx: index("multiplayer_match_players_user_idx").on(table.userId),
  }),
);

export const multiplayerReports = sqliteTable(
  "multiplayer_reports",
  {
    id: text("id").primaryKey(),
    reporterUserId: text("reporter_user_id")
      .notNull()
      .references(() => users.id),
    reportedUserId: text("reported_user_id")
      .notNull()
      .references(() => users.id),
    matchId: text("match_id").references(() => multiplayerMatches.id),
    category: text("category").notNull(),
    description: text("description"),
    /** Server-known session metadata only — never uploads from the client. */
    evidenceMetadata: text("evidence_metadata", { mode: "json" }),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    reviewedAt: text("reviewed_at"),
    reviewedBy: text("reviewed_by"),
  },
  (table) => ({
    reportedIdx: index("multiplayer_reports_reported_idx").on(table.reportedUserId),
    // One open report per reporter/reported/match keeps report spam bounded.
    dedupeIdx: unique("multiplayer_reports_dedupe").on(
      table.reporterUserId,
      table.reportedUserId,
      table.matchId,
    ),
  }),
);

export const multiplayerBlocks = sqliteTable(
  "multiplayer_blocks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: text("blocked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => ({ pk: primaryKey({ columns: [table.userId, table.blockedUserId] }) }),
);

export const multiplayerBans = sqliteTable(
  "multiplayer_bans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** multiplayer | account */
    scope: text("scope").notNull().default("multiplayer"),
    reasonCode: text("reason_code").notNull(),
    notes: text("notes"),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at"),
    createdBy: text("created_by").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => ({ userIdx: index("multiplayer_bans_user_idx").on(table.userId) }),
);

// --------------------------------------------------------------------------
// Marketing and feedback
// --------------------------------------------------------------------------

export const newsletterSubscribers = sqliteTable("newsletter_subscribers", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  verifiedAt: text("verified_at"),
  source: text("source"),
  unsubscribedAt: text("unsubscribed_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  buildVersion: text("build_version").notNull(),
  episodeId: text("episode_id"),
  side: text("side"),
  multiplayerMatchId: text("multiplayer_match_id"),
  category: text("category").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});
