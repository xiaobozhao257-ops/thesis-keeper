CREATE TABLE `decision_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`confidence` integer NOT NULL,
	`thesis_version_id` text NOT NULL,
	`health_score` integer NOT NULL,
	`frozen_payload` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_session_created` ON `decision_snapshots` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `demo_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`current_point` integer DEFAULT 0 NOT NULL,
	`thesis_confirmed` integer DEFAULT true NOT NULL,
	`review_status` text DEFAULT 'NONE' NOT NULL,
	`decision_action` text,
	`decision_reason` text,
	`decision_confidence` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_demo_sessions_owner` ON `demo_sessions` (`owner_id`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`event_index` integer NOT NULL,
	`title` text NOT NULL,
	`fact_text` text NOT NULL,
	`impact` text NOT NULL,
	`strength` text NOT NULL,
	`source_title` text NOT NULL,
	`source_locator` text NOT NULL,
	`source_publisher` text NOT NULL,
	`source_url` text,
	`source_excerpt` text NOT NULL,
	`content_hash` text NOT NULL,
	`extractor_version` text NOT NULL,
	`verification` text NOT NULL,
	`published_at` text NOT NULL,
	`canonical_event_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_session_event` ON `evidence` (`session_id`,`event_index`);--> statement-breakpoint
CREATE TABLE `evidence_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`feedback` text NOT NULL,
	`assumption_code` text,
	`reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_evidence_feedback_owner_evidence` ON `evidence_feedback` (`owner_id`,`evidence_id`);--> statement-breakpoint
CREATE TABLE `imported_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source_document_id` text NOT NULL,
	`canonical_event_id` text NOT NULL,
	`title` text NOT NULL,
	`fact_text` text NOT NULL,
	`source_excerpt` text NOT NULL,
	`source_locator` text NOT NULL,
	`assumption_code` text NOT NULL,
	`impact` text NOT NULL,
	`strength` text NOT NULL,
	`verification` text DEFAULT 'UNVERIFIED' NOT NULL,
	`extractor_version` text DEFAULT 'local-parser-v1' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_imported_evidence_owner_created` ON `imported_evidence` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_imported_evidence_owner_event` ON `imported_evidence` (`owner_id`,`canonical_event_id`);--> statement-breakpoint
CREATE TABLE `product_assumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`weight` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_product_assumptions_version` ON `product_assumptions` (`version_id`);--> statement-breakpoint
CREATE TABLE `product_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`assumption_code` text NOT NULL,
	`metric_key` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`period` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_product_metrics_version` ON `product_metrics` (`version_id`);--> statement-breakpoint
CREATE TABLE `product_risks` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`assumption_code` text,
	`title` text NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_product_risks_version` ON `product_risks` (`version_id`);--> statement-breakpoint
CREATE TABLE `product_theses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`instrument_name` text NOT NULL,
	`canonical_code` text NOT NULL,
	`asset_type` text NOT NULL,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_product_theses_owner` ON `product_theses` (`owner_id`);--> statement-breakpoint
CREATE TABLE `product_thesis_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`status` text NOT NULL,
	`input_text` text NOT NULL,
	`core_thesis` text NOT NULL,
	`horizon_min_months` integer NOT NULL,
	`horizon_max_months` integer NOT NULL,
	`confidence` integer NOT NULL,
	`change_type` text NOT NULL,
	`structured_payload` text NOT NULL,
	`content_hash` text,
	`created_at` text NOT NULL,
	`confirmed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_versions_thesis_version` ON `product_thesis_versions` (`thesis_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `idx_product_versions_owner_status` ON `product_thesis_versions` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `product_trigger_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`rule_type` text NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_product_rules_version` ON `product_trigger_rules` (`version_id`);--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_review_events_owner_session` ON `review_events` (`owner_id`,`session_id`);--> statement-breakpoint
CREATE TABLE `rule_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`event_index` integer NOT NULL,
	`status` text NOT NULL,
	`progress_current` integer NOT NULL,
	`progress_required` integer NOT NULL,
	`explanation` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rule_evaluations_session_event` ON `rule_evaluations` (`session_id`,`event_index`);--> statement-breakpoint
CREATE TABLE `source_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`publisher` text NOT NULL,
	`document_type` text NOT NULL,
	`source_url` text,
	`published_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`raw_content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_source_documents_owner_created` ON `source_documents` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_documents_owner_hash` ON `source_documents` (`owner_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `thesis_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`status` text NOT NULL,
	`core_thesis` text NOT NULL,
	`confidence` integer NOT NULL,
	`content_hash` text NOT NULL,
	`confirmed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_thesis_versions_session_version` ON `thesis_versions` (`session_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`module` text NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_summary` text,
	`error_code` text,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_owner_created` ON `workflow_runs` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `prevent_confirmed_version_content_update`
BEFORE UPDATE OF input_text, core_thesis, horizon_min_months, horizon_max_months, confidence, change_type, structured_payload, content_hash, created_at, confirmed_at
ON `product_thesis_versions`
WHEN OLD.status != 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_confirmed_version_status_update`
BEFORE UPDATE OF status ON `product_thesis_versions`
WHEN OLD.status != 'DRAFT' AND NOT (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_decision_snapshot_update`
BEFORE UPDATE ON `decision_snapshots`
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SNAPSHOT'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_decision_snapshot_delete`
BEFORE DELETE ON `decision_snapshots`
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SNAPSHOT'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_product_assumptions_confirmed_update`
BEFORE UPDATE ON `product_assumptions`
WHEN EXISTS (SELECT 1 FROM `product_thesis_versions` version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_product_assumptions_confirmed_delete`
BEFORE DELETE ON `product_assumptions`
WHEN EXISTS (SELECT 1 FROM `product_thesis_versions` version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_product_metrics_confirmed_update`
BEFORE UPDATE ON `product_metrics`
WHEN EXISTS (SELECT 1 FROM `product_thesis_versions` version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_product_metrics_confirmed_delete`
BEFORE DELETE ON `product_metrics`
WHEN EXISTS (SELECT 1 FROM `product_thesis_versions` version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_product_risks_confirmed_update`
BEFORE UPDATE ON `product_risks`
WHEN EXISTS (SELECT 1 FROM `product_thesis_versions` version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_product_risks_confirmed_delete`
BEFORE DELETE ON `product_risks`
WHEN EXISTS (SELECT 1 FROM `product_thesis_versions` version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_product_trigger_rules_confirmed_update`
BEFORE UPDATE ON `product_trigger_rules`
WHEN EXISTS (SELECT 1 FROM `product_thesis_versions` version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER `prevent_product_trigger_rules_confirmed_delete`
BEFORE DELETE ON `product_trigger_rules`
WHEN EXISTS (SELECT 1 FROM `product_thesis_versions` version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END;
