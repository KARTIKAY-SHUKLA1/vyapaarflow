ALTER TABLE `capture_lines` ADD `final_sku_id` text;--> statement-breakpoint
ALTER TABLE `capture_lines` ADD `final_quantity` integer;--> statement-breakpoint
ALTER TABLE `capture_lines` ADD `final_unit` text;--> statement-breakpoint
ALTER TABLE `capture_lines` ADD `excluded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `capture_lines` ADD `corrected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `captures` ADD `confirmed_by_id` text;--> statement-breakpoint
ALTER TABLE `captures` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `captures` ADD `order_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `cancel_reason` text;