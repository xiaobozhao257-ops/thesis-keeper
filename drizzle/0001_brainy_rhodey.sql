ALTER TABLE `workflow_runs` ADD `input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `estimated_cost_cny` real;