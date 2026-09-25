CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "accounts_provider_account_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"platform" text NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "downloads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"episode_id" text,
	"version_id" text,
	"platform" text NOT NULL,
	"bytes" bigint,
	"started_at" text NOT NULL,
	"completed_at" text,
	"result" text
);
--> statement-breakpoint
CREATE TABLE "entitlement_events" (
	"id" text PRIMARY KEY NOT NULL,
	"entitlement_id" text NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"metadata" jsonb,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"source_order_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"granted_at" text NOT NULL,
	"revoked_at" text,
	"reason" text,
	CONSTRAINT "entitlements_user_episode_unique" UNIQUE("user_id","episode_id")
);
--> statement-breakpoint
CREATE TABLE "episode_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest_key" text NOT NULL,
	"minimum_game_version" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" text,
	CONSTRAINT "episode_versions_unique" UNIQUE("episode_id","version")
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"theater" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"release_at" text,
	"cover_asset_id" text,
	"trailer_url" text,
	"current_version_id" text,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "episodes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"build_version" text NOT NULL,
	"episode_id" text,
	"side" text,
	"multiplayer_match_id" text,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multiplayer_bans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" text DEFAULT 'multiplayer' NOT NULL,
	"reason_code" text NOT NULL,
	"notes" text,
	"starts_at" text NOT NULL,
	"ends_at" text,
	"created_by" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "multiplayer_blocks" (
	"user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "multiplayer_blocks_user_id_blocked_user_id_pk" PRIMARY KEY("user_id","blocked_user_id")
);
--> statement-breakpoint
CREATE TABLE "multiplayer_match_players" (
	"match_id" text NOT NULL,
	"user_id" text NOT NULL,
	"team" integer NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"joined_at" text NOT NULL,
	"left_at" text,
	"reconnect_count" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"result" text NOT NULL,
	"reportable_session_id" text NOT NULL,
	CONSTRAINT "multiplayer_match_players_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "multiplayer_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"map_id" text NOT NULL,
	"region_id" text NOT NULL,
	"shard_id" text NOT NULL,
	"room_id" text NOT NULL,
	"protocol_version" integer NOT NULL,
	"build_version" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"ended_at" text,
	"duration_ms" integer,
	"winning_team" integer,
	"termination_reason" text,
	"result_hash" text NOT NULL,
	CONSTRAINT "multiplayer_matches_result_hash_unique" UNIQUE("result_hash")
);
--> statement-breakpoint
CREATE TABLE "multiplayer_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name_snapshot" text NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"last_match_at" text,
	"matchmaking_restricted_until" text,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multiplayer_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_user_id" text NOT NULL,
	"reported_user_id" text NOT NULL,
	"match_id" text,
	"category" text NOT NULL,
	"description" text,
	"evidence_metadata" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"reviewed_at" text,
	"reviewed_by" text,
	CONSTRAINT "multiplayer_reports_dedupe" UNIQUE("reporter_user_id","reported_user_id","match_id")
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"verified_at" text,
	"source" text,
	"unsubscribed_at" text,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "offline_licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"device_id" text NOT NULL,
	"token_id" text NOT NULL,
	"issued_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	CONSTRAINT "offline_licenses_token_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"unit_amount" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text,
	"provider" text DEFAULT 'coinpay' NOT NULL,
	"coinpay_order_id" text,
	"coinpay_payment_id" text,
	"currency" text NOT NULL,
	"subtotal" integer NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"idempotency_key" text NOT NULL,
	"paid_at" text,
	"fulfilled_at" text,
	"refunded_at" text,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "orders_idempotency_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'coinpay' NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"order_id" text,
	"payload_hash" text NOT NULL,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"received_at" text NOT NULL,
	"processed_at" text,
	CONSTRAINT "payment_events_provider_event_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"currency" text NOT NULL,
	"unit_amount" integer NOT NULL,
	"coinpay_product_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"tax_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"revoked_at" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"display_name" text NOT NULL,
	"display_name_changed_at" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_display_name_unique" UNIQUE("display_name")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_version_id_episode_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."episode_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_events" ADD CONSTRAINT "entitlement_events_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_versions" ADD CONSTRAINT "episode_versions_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multiplayer_bans" ADD CONSTRAINT "multiplayer_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multiplayer_blocks" ADD CONSTRAINT "multiplayer_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multiplayer_blocks" ADD CONSTRAINT "multiplayer_blocks_blocked_user_id_users_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multiplayer_match_players" ADD CONSTRAINT "multiplayer_match_players_match_id_multiplayer_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."multiplayer_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multiplayer_profiles" ADD CONSTRAINT "multiplayer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multiplayer_reports" ADD CONSTRAINT "multiplayer_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multiplayer_reports" ADD CONSTRAINT "multiplayer_reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multiplayer_reports" ADD CONSTRAINT "multiplayer_reports_match_id_multiplayer_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."multiplayer_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_licenses" ADD CONSTRAINT "offline_licenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_licenses" ADD CONSTRAINT "offline_licenses_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "downloads_user_idx" ON "downloads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entitlement_events_idx" ON "entitlement_events" USING btree ("entitlement_id");--> statement-breakpoint
CREATE INDEX "multiplayer_bans_user_idx" ON "multiplayer_bans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "multiplayer_match_players_user_idx" ON "multiplayer_match_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "multiplayer_matches_started_idx" ON "multiplayer_matches" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "multiplayer_reports_reported_idx" ON "multiplayer_reports" USING btree ("reported_user_id");--> statement-breakpoint
CREATE INDEX "offline_licenses_user_idx" ON "offline_licenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_events_status_idx" ON "payment_events" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "prices_episode_idx" ON "prices" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");