ALTER TABLE `orders` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `credit_exposure_paise` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_uq` ON `orders` (`retailer_id`,`idempotency_key`);