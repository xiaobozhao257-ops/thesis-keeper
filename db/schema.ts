import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const demoSessions = sqliteTable("demo_sessions", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), scenarioId: text("scenario_id").notNull(),
  currentPoint: integer("current_point").notNull().default(0), thesisConfirmed: integer("thesis_confirmed", { mode: "boolean" }).notNull().default(true),
  reviewStatus: text("review_status").notNull().default("NONE"), decisionAction: text("decision_action"),
  decisionReason: text("decision_reason"), decisionConfidence: integer("decision_confidence"), updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_demo_sessions_owner").on(table.ownerId)]);

export const thesisVersions = sqliteTable("thesis_versions", {
  id: text("id").primaryKey(), sessionId: text("session_id").notNull(), versionNo: integer("version_no").notNull(),
  status: text("status").notNull(), coreThesis: text("core_thesis").notNull(), confidence: integer("confidence").notNull(),
  contentHash: text("content_hash").notNull(), confirmedAt: text("confirmed_at").notNull(),
}, (table) => [uniqueIndex("idx_thesis_versions_session_version").on(table.sessionId, table.versionNo)]);

export const evidence = sqliteTable("evidence", {
  id: text("id").primaryKey(), sessionId: text("session_id").notNull(), eventIndex: integer("event_index").notNull(),
  title: text("title").notNull(), factText: text("fact_text").notNull(), impact: text("impact").notNull(),
  strength: text("strength").notNull(), sourceTitle: text("source_title").notNull(), sourceLocator: text("source_locator").notNull(),
  sourcePublisher: text("source_publisher").notNull(), sourceUrl: text("source_url"), sourceExcerpt: text("source_excerpt").notNull(),
  contentHash: text("content_hash").notNull(), extractorVersion: text("extractor_version").notNull(), verification: text("verification").notNull(),
  publishedAt: text("published_at").notNull(), canonicalEventId: text("canonical_event_id").notNull(),
}, (table) => [index("idx_evidence_session_event").on(table.sessionId, table.eventIndex)]);

export const ruleEvaluations = sqliteTable("rule_evaluations", {
  id: text("id").primaryKey(), sessionId: text("session_id").notNull(), eventIndex: integer("event_index").notNull(),
  status: text("status").notNull(), progressCurrent: integer("progress_current").notNull(), progressRequired: integer("progress_required").notNull(),
  explanation: text("explanation").notNull(),
}, (table) => [uniqueIndex("idx_rule_evaluations_session_event").on(table.sessionId, table.eventIndex)]);

export const decisionSnapshots = sqliteTable("decision_snapshots", {
  id: text("id").primaryKey(), sessionId: text("session_id").notNull(), action: text("action").notNull(),
  reason: text("reason").notNull(), confidence: integer("confidence").notNull(), thesisVersionId: text("thesis_version_id").notNull(),
  healthScore: integer("health_score").notNull(), frozenPayload: text("frozen_payload").notNull(), contentHash: text("content_hash").notNull(),
  recordType: text("record_type").notNull().default("PLANNED_REVIEW"), triggerSource: text("trigger_source"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_snapshots_session_created").on(table.sessionId, table.createdAt)]);

export const productTheses = sqliteTable("product_theses", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), instrumentName: text("instrument_name").notNull(),
  canonicalCode: text("canonical_code").notNull(), assetType: text("asset_type").notNull(), currentVersionId: text("current_version_id"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_product_theses_owner").on(table.ownerId)]);

export const productThesisVersions = sqliteTable("product_thesis_versions", {
  id: text("id").primaryKey(), thesisId: text("thesis_id").notNull(), ownerId: text("owner_id").notNull(),
  versionNo: integer("version_no").notNull(), status: text("status").notNull(), inputText: text("input_text").notNull(),
  coreThesis: text("core_thesis").notNull(), horizonMinMonths: integer("horizon_min_months").notNull(),
  horizonMaxMonths: integer("horizon_max_months").notNull(), confidence: integer("confidence").notNull(),
  changeType: text("change_type").notNull(), structuredPayload: text("structured_payload").notNull(), contentHash: text("content_hash"),
  createdAt: text("created_at").notNull(), confirmedAt: text("confirmed_at"),
}, (table) => [
  uniqueIndex("idx_product_versions_thesis_version").on(table.thesisId, table.versionNo),
  index("idx_product_versions_owner_status").on(table.ownerId, table.status),
]);

export const productAssumptions = sqliteTable("product_assumptions", {
  id: text("id").primaryKey(), versionId: text("version_id").notNull(), code: text("code").notNull(),
  title: text("title").notNull(), description: text("description").notNull(), weight: real("weight").notNull(),
}, (table) => [index("idx_product_assumptions_version").on(table.versionId)]);

export const productMetrics = sqliteTable("product_metrics", {
  id: text("id").primaryKey(), versionId: text("version_id").notNull(), assumptionCode: text("assumption_code").notNull(),
  metricKey: text("metric_key").notNull(), name: text("name").notNull(), unit: text("unit").notNull(), period: text("period").notNull(),
}, (table) => [index("idx_product_metrics_version").on(table.versionId)]);

export const productRisks = sqliteTable("product_risks", {
  id: text("id").primaryKey(), versionId: text("version_id").notNull(), assumptionCode: text("assumption_code"),
  title: text("title").notNull(), description: text("description").notNull(),
}, (table) => [index("idx_product_risks_version").on(table.versionId)]);

export const productTriggerRules = sqliteTable("product_trigger_rules", {
  id: text("id").primaryKey(), versionId: text("version_id").notNull(), ruleType: text("rule_type").notNull(),
  name: text("name").notNull(), definition: text("definition").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true),
}, (table) => [index("idx_product_rules_version").on(table.versionId)]);

export const sourceDocuments = sqliteTable("source_documents", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), title: text("title").notNull(), publisher: text("publisher").notNull(),
  documentType: text("document_type").notNull(), sourceUrl: text("source_url"), publishedAt: text("published_at").notNull(),
  contentHash: text("content_hash").notNull(), rawContent: text("raw_content").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_source_documents_owner_created").on(table.ownerId, table.createdAt),
  uniqueIndex("idx_source_documents_owner_hash").on(table.ownerId, table.contentHash),
]);

export const importedEvidence = sqliteTable("imported_evidence", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), sourceDocumentId: text("source_document_id").notNull(),
  canonicalEventId: text("canonical_event_id").notNull(), title: text("title").notNull(), factText: text("fact_text").notNull(),
  sourceExcerpt: text("source_excerpt").notNull(), sourceLocator: text("source_locator").notNull(), assumptionCode: text("assumption_code").notNull(),
  impact: text("impact").notNull(), strength: text("strength").notNull(), verification: text("verification").notNull().default("UNVERIFIED"),
  extractorVersion: text("extractor_version").notNull().default("local-parser-v1"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_imported_evidence_owner_created").on(table.ownerId, table.createdAt),
  uniqueIndex("idx_imported_evidence_owner_event").on(table.ownerId, table.canonicalEventId),
]);

export const evidenceFeedback = sqliteTable("evidence_feedback", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), evidenceId: text("evidence_id").notNull(),
  feedback: text("feedback").notNull(), assumptionCode: text("assumption_code"), reason: text("reason"), createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_evidence_feedback_owner_evidence").on(table.ownerId, table.evidenceId)]);

export const reviewEvents = sqliteTable("review_events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), sessionId: text("session_id").notNull(),
  eventType: text("event_type").notNull(), payload: text("payload").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_review_events_owner_session").on(table.ownerId, table.sessionId)]);

export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), module: text("module").notNull(), status: text("status").notNull(),
  provider: text("provider").notNull(), inputHash: text("input_hash").notNull(), outputSummary: text("output_summary"), errorCode: text("error_code"),
  latencyMs: integer("latency_ms").notNull().default(0), inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0), estimatedCostCny: real("estimated_cost_cny"), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_workflow_runs_owner_created").on(table.ownerId, table.createdAt)]);
