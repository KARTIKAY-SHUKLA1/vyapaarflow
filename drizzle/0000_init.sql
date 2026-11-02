CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_name_unique` ON `brands` (`name`);--> statement-breakpoint
CREATE TABLE `capture_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`capture_id` text NOT NULL,
	`position` integer NOT NULL,
	`original_text` text NOT NULL,
	`sku_id` text,
	`alt1_sku_id` text,
	`alt2_sku_id` text,
	`quantity` integer,
	`unit` text NOT NULL,
	`confidence` integer NOT NULL,
	`matched_by` text NOT NULL,
	`issues` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capture_lines_capture_idx` ON `capture_lines` (`capture_id`);--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`engine` text NOT NULL,
	`model` text,
	`fallback_reason` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `inbound_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`retailer_id` text,
	`from_phone` text NOT NULL,
	`channel` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`received_at` integer NOT NULL,
	`order_id` text,
	FOREIGN KEY (`retailer_id`) REFERENCES `retailers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inbound_status_idx` ON `inbound_messages` (`status`,`received_at`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`sku_id` text NOT NULL,
	`cases` integer NOT NULL,
	`free_cases` integer DEFAULT 0 NOT NULL,
	`pack_size` integer NOT NULL,
	`price_per_piece_paise` integer NOT NULL,
	`gross_paise` integer NOT NULL,
	`discount_paise` integer NOT NULL,
	`gst_rate_bp` integer NOT NULL,
	`gst_paise` integer NOT NULL,
	`total_paise` integer NOT NULL,
	`scheme_id` text,
	`scheme_note` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_lines_order_idx` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`retailer_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`gross_paise` integer NOT NULL,
	`discount_paise` integer NOT NULL,
	`taxable_paise` integer NOT NULL,
	`gst_paise` integer NOT NULL,
	`total_paise` integer NOT NULL,
	`capture_id` text,
	`note` text,
	`hold_reason` text,
	`created_by_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`retailer_id`) REFERENCES `retailers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_unique` ON `orders` (`number`);--> statement-breakpoint
CREATE INDEX `orders_retailer_idx` ON `orders` (`retailer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `otp_phone_idx` ON `otp_codes` (`phone`,`created_at`);--> statement-breakpoint
CREATE TABLE `prices` (
	`sku_id` text NOT NULL,
	`price_tier` text NOT NULL,
	`price_per_piece_paise` integer NOT NULL,
	FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prices_sku_tier_uq` ON `prices` (`sku_id`,`price_tier`);--> statement-breakpoint
CREATE TABLE `retailer_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`retailer_id` text NOT NULL,
	`phrase` text NOT NULL,
	`sku_id` text NOT NULL,
	`unit` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`retailer_id`) REFERENCES `retailers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aliases_retailer_phrase_uq` ON `retailer_aliases` (`retailer_id`,`phrase`);--> statement-breakpoint
CREATE TABLE `retailers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`shop_name` text NOT NULL,
	`owner_name` text NOT NULL,
	`area` text NOT NULL,
	`phone` text NOT NULL,
	`salesman_id` text,
	`price_tier` text DEFAULT 'standard' NOT NULL,
	`credit_limit_paise` integer NOT NULL,
	`outstanding_paise` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retailers_code_unique` ON `retailers` (`code`);--> statement-breakpoint
CREATE INDEX `retailers_salesman_idx` ON `retailers` (`salesman_id`);--> statement-breakpoint
CREATE TABLE `schemes` (
	`id` text PRIMARY KEY NOT NULL,
	`sku_id` text NOT NULL,
	`type` text NOT NULL,
	`buy_qty` integer,
	`free_qty` integer,
	`min_qty` integer,
	`percent_bp` integer,
	`label` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `schemes_sku_idx` ON `schemes` (`sku_id`);--> statement-breakpoint
CREATE TABLE `skus` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`name_hi` text NOT NULL,
	`brand_id` text NOT NULL,
	`category` text NOT NULL,
	`pack_size` integer NOT NULL,
	`gst_rate_bp` integer NOT NULL,
	`image_key` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skus_code_unique` ON `skus` (`code`);--> statement-breakpoint
CREATE TABLE `sms_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`to_phone` text NOT NULL,
	`body` text NOT NULL,
	`purpose` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock` (
	`sku_id` text PRIMARY KEY NOT NULL,
	`cases` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tally_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`format` text NOT NULL,
	`order_ids` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`retailer_id` text,
	`language` text DEFAULT 'en' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`retailer_id`) REFERENCES `retailers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);