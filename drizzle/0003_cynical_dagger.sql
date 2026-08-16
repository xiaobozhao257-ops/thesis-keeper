ALTER TABLE `product_theses` ADD `data_mode` text DEFAULT 'REAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `product_theses` ADD `status` text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE `product_theses` ADD `predecessor_thesis_id` text;--> statement-breakpoint
ALTER TABLE `product_theses` ADD `closed_at` text;--> statement-breakpoint
UPDATE `product_theses` SET `data_mode` = 'DEMO';--> statement-breakpoint
CREATE INDEX `idx_product_theses_owner_mode_status` ON `product_theses` (`owner_id`,`data_mode`,`status`);
