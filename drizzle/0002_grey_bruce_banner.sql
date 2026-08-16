ALTER TABLE `decision_snapshots` ADD `record_type` text DEFAULT 'PLANNED_REVIEW' NOT NULL;--> statement-breakpoint
ALTER TABLE `decision_snapshots` ADD `trigger_source` text;