CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`platform` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `devices_user_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`episode_id` text,
	`version_id` text,
	`platform` text NOT NULL,
	`bytes` integer,
	`started_at` text NOT NULL,
	`completed_at` text,
	`result` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `episode_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `downloads_user_idx` ON `downloads` (`user_id`);--> statement-breakpoint
CREATE TABLE `entitlement_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entitlement_id` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`entitlement_id`) REFERENCES `entitlements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entitlement_events_idx` ON `entitlement_events` (`entitlement_id`);--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`source_order_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`granted_at` text NOT NULL,
	`revoked_at` text,
	`reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlements_user_episode_unique` ON `entitlements` (`user_id`,`episode_id`);--> statement-breakpoint
CREATE TABLE `episode_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`version` text NOT NULL,
	`manifest_key` text NOT NULL,
	`minimum_game_version` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` text,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episode_versions_unique` ON `episode_versions` (`episode_id`,`version`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`theater` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`release_at` text,
	`cover_asset_id` text,
	`trailer_url` text,
	`current_version_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_slug_unique` ON `episodes` (`slug`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`build_version` text NOT NULL,
	`episode_id` text,
	`side` text,
	`multiplayer_match_id` text,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `multiplayer_bans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text DEFAULT 'multiplayer' NOT NULL,
	`reason_code` text NOT NULL,
	`notes` text,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`created_by` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `multiplayer_bans_user_idx` ON `multiplayer_bans` (`user_id`);--> statement-breakpoint
CREATE TABLE `multiplayer_blocks` (
	`user_id` text NOT NULL,
	`blocked_user_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`user_id`, `blocked_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `multiplayer_match_players` (
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`team` integer NOT NULL,
	`is_bot` integer DEFAULT false NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	`reconnect_count` integer DEFAULT 0 NOT NULL,
	`kills` integer DEFAULT 0 NOT NULL,
	`deaths` integer DEFAULT 0 NOT NULL,
	`assists` integer DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`result` text NOT NULL,
	`reportable_session_id` text NOT NULL,
	PRIMARY KEY(`match_id`, `user_id`),
	FOREIGN KEY (`match_id`) REFERENCES `multiplayer_matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `multiplayer_match_players_user_idx` ON `multiplayer_match_players` (`user_id`);--> statement-breakpoint
CREATE TABLE `multiplayer_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`map_id` text NOT NULL,
	`region_id` text NOT NULL,
	`shard_id` text NOT NULL,
	`room_id` text NOT NULL,
	`protocol_version` integer NOT NULL,
	`build_version` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	`winning_team` integer,
	`termination_reason` text,
	`result_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `multiplayer_matches_started_idx` ON `multiplayer_matches` (`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `multiplayer_matches_result_hash_unique` ON `multiplayer_matches` (`result_hash`);--> statement-breakpoint
CREATE TABLE `multiplayer_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name_snapshot` text NOT NULL,
	`matches_played` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`kills` integer DEFAULT 0 NOT NULL,
	`deaths` integer DEFAULT 0 NOT NULL,
	`assists` integer DEFAULT 0 NOT NULL,
	`last_match_at` text,
	`matchmaking_restricted_until` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `multiplayer_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_user_id` text NOT NULL,
	`reported_user_id` text NOT NULL,
	`match_id` text,
	`category` text NOT NULL,
	`description` text,
	`evidence_metadata` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_id`) REFERENCES `multiplayer_matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `multiplayer_reports_reported_idx` ON `multiplayer_reports` (`reported_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `multiplayer_reports_dedupe` ON `multiplayer_reports` (`reporter_user_id`,`reported_user_id`,`match_id`);--> statement-breakpoint
CREATE TABLE `newsletter_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`verified_at` text,
	`source` text,
	`unsubscribed_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `newsletter_subscribers_email_unique` ON `newsletter_subscribers` (`email`);--> statement-breakpoint
CREATE TABLE `offline_licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`device_id` text NOT NULL,
	`token_id` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offline_licenses_user_idx` ON `offline_licenses` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `offline_licenses_token_unique` ON `offline_licenses` (`token_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`unit_amount` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`provider` text DEFAULT 'coinpay' NOT NULL,
	`coinpay_order_id` text,
	`coinpay_payment_id` text,
	`currency` text NOT NULL,
	`subtotal` integer NOT NULL,
	`tax` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`idempotency_key` text NOT NULL,
	`paid_at` text,
	`fulfilled_at` text,
	`refunded_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'coinpay' NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`order_id` text,
	`payload_hash` text NOT NULL,
	`processing_status` text DEFAULT 'received' NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_events_status_idx` ON `payment_events` (`processing_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_provider_event_unique` ON `payment_events` (`provider_event_id`);--> statement-breakpoint
CREATE TABLE `prices` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`currency` text NOT NULL,
	`unit_amount` integer NOT NULL,
	`coinpay_product_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`tax_code` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prices_episode_idx` ON `prices` (`episode_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip_hash` text,
	`user_agent` text,
	`revoked_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`verified_at` text,
	`display_name` text NOT NULL,
	`display_name_changed_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_display_name_unique` ON `users` (`display_name`);