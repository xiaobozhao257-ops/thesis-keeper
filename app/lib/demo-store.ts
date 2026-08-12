import { env as workerEnv } from "cloudflare:workers";
import { calculateHealth, getRuleState, getScenarioRuleState, isScenarioDataAvailable, seededEvidence } from "./demo-domain";
import { canonicalJson, compileThesisDraft, parseEvidenceInput, validateThesisDraft, type ThesisDraftPayload } from "./product-domain";
import { FixtureLLMProvider } from "../providers/llm/FixtureLLMProvider";
import { RemoteStructuredLLMProvider } from "../providers/llm/RemoteStructuredLLMProvider";
import { MockMarketDataProvider } from "../providers/market/MockMarketDataProvider";
import { immutableDatabaseTriggers } from "./database-invariants";

type AppEnv = {
  DB: D1Database;
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  MARKET_DATA_PROVIDER?: string;
  RICEQUANT_BRIDGE_URL?: string;
};

const env = workerEnv as unknown as AppEnv;
const DEFAULT_OWNER = "demo-user";
const DEFAULT_SCENARIO = "cn-equity-demo-v1";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS demo_sessions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    current_point INTEGER NOT NULL DEFAULT 0,
    thesis_confirmed INTEGER NOT NULL DEFAULT 1,
    review_status TEXT NOT NULL DEFAULT 'NONE',
    decision_action TEXT,
    decision_reason TEXT,
    decision_confidence INTEGER,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS thesis_versions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    version_no INTEGER NOT NULL,
    status TEXT NOT NULL,
    core_thesis TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    UNIQUE(session_id, version_no)
  )`,
  `CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    fact_text TEXT NOT NULL,
    impact TEXT NOT NULL,
    strength TEXT NOT NULL,
    source_title TEXT NOT NULL,
    source_publisher TEXT NOT NULL DEFAULT '',
    source_url TEXT,
    source_excerpt TEXT NOT NULL DEFAULT '',
    source_locator TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    extractor_version TEXT NOT NULL DEFAULT 'fixture-evidence-v1',
    verification TEXT NOT NULL DEFAULT 'VERIFIED',
    published_at TEXT NOT NULL,
    canonical_event_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rule_evaluations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    progress_current INTEGER NOT NULL,
    progress_required INTEGER NOT NULL,
    explanation TEXT NOT NULL,
    UNIQUE(session_id, event_index)
  )`,
  `CREATE TABLE IF NOT EXISTS decision_snapshots (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    thesis_version_id TEXT NOT NULL,
    health_score INTEGER NOT NULL,
    frozen_payload TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS product_theses (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    instrument_name TEXT NOT NULL,
    canonical_code TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    current_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS product_thesis_versions (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    version_no INTEGER NOT NULL,
    status TEXT NOT NULL,
    input_text TEXT NOT NULL,
    core_thesis TEXT NOT NULL,
    horizon_min_months INTEGER NOT NULL,
    horizon_max_months INTEGER NOT NULL,
    confidence INTEGER NOT NULL,
    change_type TEXT NOT NULL,
    structured_payload TEXT NOT NULL,
    content_hash TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT,
    UNIQUE(thesis_id, version_no)
  )`,
  `CREATE TABLE IF NOT EXISTS product_assumptions (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    weight REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS product_metrics (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    assumption_code TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    period TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS product_risks (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    assumption_code TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS product_trigger_rules (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    name TEXT NOT NULL,
    definition TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS source_documents (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    publisher TEXT NOT NULL,
    document_type TEXT NOT NULL,
    source_url TEXT,
    published_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS imported_evidence (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    canonical_event_id TEXT NOT NULL,
    title TEXT NOT NULL,
    fact_text TEXT NOT NULL,
    source_excerpt TEXT NOT NULL,
    source_locator TEXT NOT NULL,
    assumption_code TEXT NOT NULL,
    impact TEXT NOT NULL,
    strength TEXT NOT NULL,
    verification TEXT NOT NULL DEFAULT 'UNVERIFIED',
    extractor_version TEXT NOT NULL DEFAULT 'local-parser-v1',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS evidence_feedback (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    feedback TEXT NOT NULL,
    assumption_code TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, evidence_id)
  )`,
  `CREATE TABLE IF NOT EXISTS review_events (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    module TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    output_summary TEXT,
    error_code TEXT,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_cny REAL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_demo_sessions_owner ON demo_sessions(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_session_event ON evidence(session_id, event_index)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_session_created ON decision_snapshots(session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_product_versions_owner_status ON product_thesis_versions(owner_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_imported_evidence_owner_created ON imported_evidence(owner_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_source_documents_owner_hash ON source_documents(owner_id, content_hash)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_evidence_owner_event ON imported_evidence(owner_id, canonical_event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_review_events_owner_session ON review_events(owner_id, session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_owner_created ON workflow_runs(owner_id, created_at)`,
  ...immutableDatabaseTriggers,
];

function getD1() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

function normalizeOwner(ownerId?: string) {
  return ownerId?.trim() || DEFAULT_OWNER;
}

function sessionIdFor(ownerId: string) {
  return `demo-session:${ownerId}`;
}

function thesisIdFor(ownerId: string) {
  return `product-thesis:${ownerId}`;
}

function fixtureVersionIdFor(ownerId: string) {
  return `product-thesis-v1:${ownerId}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fixturePayload(): ThesisDraftPayload {
  return compileThesisDraft({
    instrumentName: "华星智算（虚构）",
    canonicalCode: "CN.DEMO.HXZS",
    assetType: "EQUITY",
    inputText: "我认为国内算力基础设施投入会持续增长，公司在核心客户中有较强的产品优势。只要收入增速和盈利质量没有明显恶化，我愿意持有 12 到 24 个月。",
    horizonMinMonths: 12,
    horizonMaxMonths: 24,
    confidence: 80,
  });
}

export async function initializeDemoStore(ownerId = DEFAULT_OWNER) {
  const owner = normalizeOwner(ownerId);
  const sessionId = sessionIdFor(owner);
  const thesisId = thesisIdFor(owner);
  const versionId = fixtureVersionIdFor(owner);
  const db = getD1();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  await ensureProvenanceColumns(db);

  const now = new Date().toISOString();
  const payload = fixturePayload();
  const payloadJson = canonicalJson(payload);
  const payloadHash = await sha256(payloadJson);
  const fixtureEvidenceWithHashes = await Promise.all(seededEvidence.map(async (item) => ({
    ...item,
    contentHash: await sha256(canonicalJson({ title: item.sourceTitle, factText: item.factText, locator: item.sourceLocator })),
  })));
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO demo_sessions
      (id, owner_id, scenario_id, current_point, thesis_confirmed, review_status, updated_at)
      VALUES (?, ?, ?, 0, 1, 'NONE', ?)`)
      .bind(sessionId, owner, DEFAULT_SCENARIO, now),
    db.prepare(`INSERT OR IGNORE INTO thesis_versions
      (id, session_id, version_no, status, core_thesis, confidence, content_hash, confirmed_at)
      VALUES (?, ?, 1, 'ACTIVE', ?, 80, ?, ?)`)
      .bind(versionId, sessionId, payload.coreThesis, payloadHash, "2026-02-12T00:00:00Z"),
    db.prepare(`INSERT OR IGNORE INTO product_theses
      (id, owner_id, instrument_name, canonical_code, asset_type, current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(thesisId, owner, payload.instrumentName, payload.canonicalCode, payload.assetType, versionId, now, now),
    db.prepare(`INSERT OR IGNORE INTO product_thesis_versions
      (id, thesis_id, owner_id, version_no, status, input_text, core_thesis,
       horizon_min_months, horizon_max_months, confidence, change_type, structured_payload,
       content_hash, created_at, confirmed_at)
      VALUES (?, ?, ?, 1, 'ACTIVE', ?, ?, ?, ?, ?, 'INITIAL', ?, ?, ?, ?)`)
      .bind(versionId, thesisId, owner, payload.inputText, payload.coreThesis, payload.horizonMinMonths,
        payload.horizonMaxMonths, payload.confidence, payloadJson, payloadHash, now, "2026-02-12T00:00:00Z"),
    ...fixtureEvidenceWithHashes.map((item) => db.prepare(`INSERT INTO evidence
      (id, session_id, event_index, title, fact_text, impact, strength, source_title, source_publisher, source_url,
       source_excerpt, source_locator, content_hash, extractor_version, verification, published_at, canonical_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'fixture-evidence-v1', 'VERIFIED', ?, ?)
      ON CONFLICT(id) DO UPDATE SET source_publisher = excluded.source_publisher, source_excerpt = excluded.source_excerpt,
        content_hash = excluded.content_hash, extractor_version = excluded.extractor_version, verification = excluded.verification`)
      .bind(`${sessionId}:${item.id}`, sessionId, item.eventIndex, item.title, item.factText, item.impact,
        item.strength, item.sourceTitle, item.sourcePublisher, item.factText, item.sourceLocator, item.contentHash, item.publishedAt, item.id)),
  ]);

  const assumptionCount = await db.prepare("SELECT COUNT(*) AS count FROM product_assumptions WHERE version_id = ?").bind(versionId).first<{ count: number }>();
  if (!assumptionCount?.count) await persistVersionChildren(db, versionId, payload);
}

async function ensureProvenanceColumns(db: D1Database) {
  const evidenceColumns = await db.prepare("PRAGMA table_info(evidence)").all<{ name: string }>();
  const importedColumns = await db.prepare("PRAGMA table_info(imported_evidence)").all<{ name: string }>();
  const workflowColumns = await db.prepare("PRAGMA table_info(workflow_runs)").all<{ name: string }>();
  const existingEvidence = new Set(evidenceColumns.results.map((row) => row.name));
  const existingImported = new Set(importedColumns.results.map((row) => row.name));
  const existingWorkflow = new Set(workflowColumns.results.map((row) => row.name));
  const additions = [
    ...[
      ["source_publisher", "TEXT NOT NULL DEFAULT ''"],
      ["source_url", "TEXT"],
      ["source_excerpt", "TEXT NOT NULL DEFAULT ''"],
      ["content_hash", "TEXT NOT NULL DEFAULT ''"],
      ["extractor_version", "TEXT NOT NULL DEFAULT 'fixture-evidence-v1'"],
      ["verification", "TEXT NOT NULL DEFAULT 'VERIFIED'"],
    ].filter(([name]) => !existingEvidence.has(name)).map(([name, definition]) => db.prepare(`ALTER TABLE evidence ADD COLUMN ${name} ${definition}`)),
    ...(!existingImported.has("extractor_version")
      ? [db.prepare("ALTER TABLE imported_evidence ADD COLUMN extractor_version TEXT NOT NULL DEFAULT 'local-parser-v1'")]
      : []),
    ...[
      ["input_tokens", "INTEGER NOT NULL DEFAULT 0"],
      ["output_tokens", "INTEGER NOT NULL DEFAULT 0"],
      ["estimated_cost_cny", "REAL"],
    ].filter(([name]) => !existingWorkflow.has(name)).map(([name, definition]) => db.prepare(`ALTER TABLE workflow_runs ADD COLUMN ${name} ${definition}`)),
  ];
  if (additions.length) await db.batch(additions);
}

async function persistVersionChildren(db: D1Database, versionId: string, payload: ThesisDraftPayload) {
  const statements = [
    ...payload.assumptions.map((item) => db.prepare(`INSERT INTO product_assumptions
      (id, version_id, code, title, description, weight) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(`${versionId}:assumption:${item.code}`, versionId, item.code, item.title, item.description, item.weight)),
    ...payload.metrics.map((item) => db.prepare(`INSERT INTO product_metrics
      (id, version_id, assumption_code, metric_key, name, unit, period) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(`${versionId}:metric:${item.key}`, versionId, item.assumptionCode, item.key, item.name, item.unit, item.period)),
    ...payload.risks.map((item, index) => db.prepare(`INSERT INTO product_risks
      (id, version_id, assumption_code, title, description) VALUES (?, ?, ?, ?, ?)`)
      .bind(`${versionId}:risk:${index + 1}`, versionId, item.assumptionCode ?? null, item.title, item.description)),
    ...payload.rules.map((item, index) => db.prepare(`INSERT INTO product_trigger_rules
      (id, version_id, rule_type, name, definition, active) VALUES (?, ?, ?, ?, ?, 1)`)
      .bind(`${versionId}:rule:${index + 1}`, versionId, item.type, item.name, JSON.stringify(item))),
  ];
  if (statements.length) await db.batch(statements);
}

type DbRow = Record<string, unknown>;

export async function readDemoState(ownerId = DEFAULT_OWNER) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  const sessionId = sessionIdFor(owner);
  const session = await db.prepare("SELECT * FROM demo_sessions WHERE id = ? AND owner_id = ?")
    .bind(sessionId, owner).first<DbRow>();
  if (!session) throw new Error("Demo session not found");

  const currentPoint = Number(session.current_point ?? 0);
  const isEmptyFundScenario = !isScenarioDataAvailable(String(session.scenario_id));
  const [fixtureEvidence, importedEvidence, snapshotResult, activeVersion, draftVersion, versionHistory, feedbackRows, reviewRows, workflowRows] = await Promise.all([
    db.prepare("SELECT * FROM evidence WHERE session_id = ? AND event_index <= ? ORDER BY event_index DESC")
      .bind(sessionId, currentPoint).all<DbRow>(),
    db.prepare(`SELECT e.*, d.title AS source_title, d.publisher, d.published_at AS document_published_at,
      d.source_url, d.content_hash AS document_content_hash
      FROM imported_evidence e JOIN source_documents d ON d.id = e.source_document_id
      WHERE e.owner_id = ? ORDER BY e.created_at DESC`).bind(owner).all<DbRow>(),
    db.prepare("SELECT * FROM decision_snapshots WHERE session_id = ? ORDER BY created_at DESC").bind(sessionId).all<DbRow>(),
    db.prepare("SELECT * FROM product_thesis_versions WHERE owner_id = ? AND status = 'ACTIVE' ORDER BY version_no DESC LIMIT 1").bind(owner).first<DbRow>(),
    db.prepare("SELECT * FROM product_thesis_versions WHERE owner_id = ? AND status = 'DRAFT' ORDER BY created_at DESC LIMIT 1").bind(owner).first<DbRow>(),
    db.prepare("SELECT * FROM product_thesis_versions WHERE owner_id = ? ORDER BY version_no DESC, created_at DESC").bind(owner).all<DbRow>(),
    db.prepare("SELECT * FROM evidence_feedback WHERE owner_id = ?").bind(owner).all<DbRow>(),
    db.prepare("SELECT * FROM review_events WHERE owner_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 20").bind(owner, sessionId).all<DbRow>(),
    db.prepare("SELECT * FROM workflow_runs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 20").bind(owner).all<DbRow>(),
  ]);

  const feedback = new Map(feedbackRows.results.map((row) => [String(row.evidence_id), row]));
  const disputed = reviewRows.results.some((row) => row.event_type === "TRIGGER_DISPUTED");
  const fixtureCounterEvidenceId = `${sessionId}:ev-t3-substitution`;
  const counterEvidenceRejected = String(feedback.get(fixtureCounterEvidenceId)?.feedback ?? "") === "REJECTED";
  const calculatedHealth = calculateHealth(isEmptyFundScenario ? 0 : currentPoint);
  const baseHealth = counterEvidenceRejected && currentPoint >= 3
    ? {
        ...calculatedHealth,
        score: Math.min(100, calculatedHealth.score + calculatedHealth.breakdown.evidencePenalty),
        status: currentPoint >= 5 ? calculatedHealth.status : "HEALTHY" as const,
        breakdown: { ...calculatedHealth.breakdown, evidencePenalty: 0 },
      }
    : calculatedHealth;
  const health = disputed && baseHealth.status === "MUST_REVIEW"
    ? { ...baseHealth, score: Math.max(baseHealth.score, 48), status: "ATTENTION" as const, breakdown: { ...baseHealth.breakdown, triggerPenalty: 15 } }
    : baseHealth;
  const baseRule = getScenarioRuleState(String(session.scenario_id), currentPoint);
  const rule = !isEmptyFundScenario && disputed ? { ...baseRule, status: "DISPUTED", label: "已提出异议" } : baseRule;

  const mapEvidence = (row: DbRow, imported: boolean) => {
    const id = String(row.id);
    const itemFeedback = feedback.get(id);
    return {
      id,
      eventIndex: imported ? 99 : Number(row.event_index),
      title: String(row.title),
      factText: String(row.fact_text),
      impact: String(row.impact),
      strength: String(row.strength),
      sourceTitle: String(row.source_title),
      sourcePublisher: imported ? String(row.publisher) : String(row.source_publisher),
      sourceUrl: row.source_url ? String(row.source_url) : null,
      sourceExcerpt: imported ? String(row.source_excerpt) : String(row.source_excerpt || row.fact_text),
      sourceLocator: imported ? String(row.source_locator) : String(row.source_locator),
      contentHash: imported ? String(row.document_content_hash) : String(row.content_hash),
      extractorVersion: String(row.extractor_version),
      publishedAt: imported ? String(row.document_published_at) : String(row.published_at),
      assumptionCode: itemFeedback?.assumption_code
        ? String(itemFeedback.assumption_code)
        : imported ? String(row.assumption_code) : String(row.event_index) === "3" ? "A2" : "A1",
      verification: String(row.verification),
      imported,
      feedback: itemFeedback ? String(itemFeedback.feedback) : "NONE",
    };
  };

  const snapshots = await Promise.all(snapshotResult.results.map(async (row) => {
    const frozenPayload = String(row.frozen_payload ?? "");
    const frozen = safeJson(frozenPayload) as {
      thesis?: { versionNo?: number };
      thesisVersionId?: string;
      evidence?: Array<{ id?: string; title?: string; impact?: string; sourceTitle?: string; publishedAt?: string; verification?: string }>;
      priceSnapshot?: { value: number; currency: string; observedAt: string; source: string };
      challengerEvidence?: string;
    } | null;
    return {
      id: String(row.id), action: String(row.action), reason: String(row.reason),
      confidence: Number(row.confidence), healthScore: Number(row.health_score),
      createdAt: String(row.created_at), contentHash: String(row.content_hash),
      integrityValid: Boolean(frozenPayload) && await sha256(frozenPayload) === String(row.content_hash),
      thesisVersionId: String(row.thesis_version_id),
      thesisVersionNo: Number(frozen?.thesis?.versionNo ?? 1),
      evidenceCount: frozen?.evidence?.length ?? 0,
      counterEvidenceCount: frozen?.evidence?.filter((item) => item.impact === "WEAKEN" || item.impact === "CONTRADICT").length ?? 0,
      evidence: frozen?.evidence?.map((item) => ({
        id: String(item.id ?? ""), title: String(item.title ?? ""), impact: String(item.impact ?? "NEUTRAL"),
        sourceTitle: String(item.sourceTitle ?? ""), publishedAt: String(item.publishedAt ?? ""), verification: String(item.verification ?? "UNVERIFIED"),
      })) ?? [],
      priceSnapshot: frozen?.priceSnapshot ?? null,
      challengerEvidence: frozen?.challengerEvidence ?? null,
    };
  }));

  const reviewOpened = reviewRows.results.find((row) => row.event_type === "REVIEW_OPENED");
  const reviewOpenedPayload = reviewOpened ? safeJson(reviewOpened.payload) as { thesisVersionId?: string } | null : null;
  const reviewVersionRow = reviewOpenedPayload?.thesisVersionId
    ? versionHistory.results.find((row) => String(row.id) === reviewOpenedPayload.thesisVersionId)
    : undefined;

  return {
    session: {
      id: String(session.id),
      ownerId: owner,
      scenarioId: String(session.scenario_id),
      currentPoint,
      thesisConfirmed: Boolean(session.thesis_confirmed),
      reviewStatus: String(session.review_status),
      updatedAt: String(session.updated_at),
    },
    health,
    rule,
    evidence: isEmptyFundScenario ? [] : [
      ...importedEvidence.results.map((row) => mapEvidence(row, true)),
      ...fixtureEvidence.results.map((row) => mapEvidence(row, false)),
    ],
    snapshots,
    thesis: activeVersion ? mapVersion(activeVersion) : null,
    reviewThesis: reviewVersionRow ? mapVersion(reviewVersionRow) : activeVersion ? mapVersion(activeVersion) : null,
    draft: draftVersion ? mapVersion(draftVersion) : null,
    versions: versionHistory.results.map(mapVersion),
    reviewEvents: reviewRows.results.map((row) => ({ id: String(row.id), type: String(row.event_type), payload: safeJson(row.payload), createdAt: String(row.created_at) })),
    workflows: workflowRows.results.map((row) => ({
      id: String(row.id), module: String(row.module), status: String(row.status), provider: String(row.provider),
      outputSummary: String(row.output_summary ?? ""), errorCode: row.error_code ? String(row.error_code) : null,
      latencyMs: Number(row.latency_ms), createdAt: String(row.created_at),
      inputTokens: Number(row.input_tokens ?? 0), outputTokens: Number(row.output_tokens ?? 0),
      estimatedCostCny: row.estimated_cost_cny === null || row.estimated_cost_cny === undefined ? null : Number(row.estimated_cost_cny),
    })),
    providers: {
      llm: { selected: env.LLM_PROVIDER || "fixture", configured: Boolean(env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL) },
      marketData: { selected: env.MARKET_DATA_PROVIDER || "mock", ricequantConfigured: Boolean(env.RICEQUANT_BRIDGE_URL) },
    },
  };
}

function mapVersion(row: DbRow) {
  return {
    id: String(row.id), versionNo: Number(row.version_no), status: String(row.status),
    inputText: String(row.input_text ?? ""), coreThesis: String(row.core_thesis),
    confidence: Number(row.confidence), changeType: String(row.change_type ?? "INITIAL"),
    payload: safeJson(row.structured_payload) as ThesisDraftPayload | null,
    createdAt: String(row.created_at), confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
  };
}

function safeJson(value: unknown) {
  try { return JSON.parse(String(value ?? "{}")) as unknown; } catch { return null; }
}

async function logWorkflow(owner: string, module: string, status: string, provider: string, input: unknown, summary?: string, errorCode?: string, metrics?: {
  latencyMs?: number; inputTokens?: number; outputTokens?: number; estimatedCostCny?: number;
}) {
  const db = getD1();
  const inputHash = await sha256(JSON.stringify(input));
  await db.prepare(`INSERT INTO workflow_runs
    (id, owner_id, module, status, provider, input_hash, output_summary, error_code, latency_ms,
     input_tokens, output_tokens, estimated_cost_cny, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`workflow:${crypto.randomUUID()}`, owner, module, status, provider, inputHash, summary ?? null, errorCode ?? null,
      metrics?.latencyMs ?? 0, metrics?.inputTokens ?? 0, metrics?.outputTokens ?? 0,
      metrics?.estimatedCostCny ?? null, new Date().toISOString()).run();
}

export async function compileAndSaveDraft(ownerId: string, input: {
  instrumentName: string; canonicalCode: string; assetType: "EQUITY" | "ETF" | "LOF";
  inputText: string; horizonMinMonths: number; horizonMaxMonths: number; confidence: number;
}) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const startedAt = Date.now();
  try {
    const remoteConfigured = (env.LLM_PROVIDER === "deepseek" || env.LLM_PROVIDER === "remote")
      && Boolean(env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL);
    const llm = remoteConfigured
      ? new RemoteStructuredLLMProvider({ apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL })
      : new FixtureLLMProvider((_module, requestInput) => compileThesisDraft(requestInput as typeof input));
    let generated = await llm.generate<typeof input, ThesisDraftPayload>({
      module: "THESIS_COMPILER", promptVersion: "thesis-compiler-v1", schemaVersion: "thesis-draft-v1",
      input, idempotencyKey: await sha256(`${owner}:${JSON.stringify(input)}`),
    });
    let payload: ThesisDraftPayload;
    try {
      payload = validateThesisDraft(generated.output);
    } catch (validationError) {
      if (!(llm instanceof RemoteStructuredLLMProvider)) throw validationError;
      const repairInput = {
        ...input,
        invalidOutput: generated.output,
        validationErrors: validationError instanceof Error ? validationError.message : "THESIS_SCHEMA_INVALID",
        repairInstruction: "只修复不符合 Schema 的字段，不增加产品范围外内容。",
      };
      generated = await llm.generate<typeof repairInput, ThesisDraftPayload>({
        module: "THESIS_COMPILER", promptVersion: "thesis-compiler-v1-repair", schemaVersion: "thesis-draft-v1",
        input: repairInput, idempotencyKey: await sha256(`${owner}:repair:${JSON.stringify(repairInput)}`),
      });
      payload = validateThesisDraft(generated.output);
    }
    const db = getD1();
    const thesisId = thesisIdFor(owner);
    const now = new Date().toISOString();
    const draftId = `draft:${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("DELETE FROM product_thesis_versions WHERE owner_id = ? AND status = 'DRAFT'").bind(owner),
      db.prepare(`UPDATE product_theses SET instrument_name = ?, canonical_code = ?, asset_type = ?, updated_at = ? WHERE id = ? AND owner_id = ?`)
        .bind(input.instrumentName, input.canonicalCode, input.assetType, now, thesisId, owner),
      db.prepare(`INSERT INTO product_thesis_versions
        (id, thesis_id, owner_id, version_no, status, input_text, core_thesis, horizon_min_months,
         horizon_max_months, confidence, change_type, structured_payload, created_at)
        VALUES (?, ?, ?, 0, 'DRAFT', ?, ?, ?, ?, ?, 'UPDATE', ?, ?)`)
        .bind(draftId, thesisId, owner, input.inputText, payload.coreThesis, input.horizonMinMonths,
          input.horizonMaxMonths, input.confidence, canonicalJson(payload), now),
    ]);
    await logWorkflow(owner, "THESIS_COMPILER", "SUCCEEDED", generated.provider, input, `生成 ${payload.assumptions.length} 个假设，${Date.now() - startedAt}ms`, undefined, {
      latencyMs: generated.latencyMs,
      inputTokens: generated.usage?.inputTokens,
      outputTokens: generated.usage?.outputTokens,
      estimatedCostCny: generated.usage && "estimatedCostCny" in generated.usage ? generated.usage.estimatedCostCny : undefined,
    });
    return readDemoState(owner);
  } catch (error) {
    await logWorkflow(owner, "THESIS_COMPILER", "FAILED", env.LLM_PROVIDER || "fixture", input, undefined, error instanceof Error ? error.message : "UNKNOWN", { latencyMs: Date.now() - startedAt });
    throw error;
  }
}

export async function updateDraft(ownerId: string, payloadInput: ThesisDraftPayload) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const payload = validateThesisDraft(payloadInput);
  const db = getD1();
  const draft = await db.prepare("SELECT id FROM product_thesis_versions WHERE owner_id = ? AND status = 'DRAFT' ORDER BY created_at DESC LIMIT 1")
    .bind(owner).first<{ id: string }>();
  if (!draft) throw new Error("DRAFT_NOT_FOUND");
  await db.prepare(`UPDATE product_thesis_versions
    SET input_text = ?, core_thesis = ?, horizon_min_months = ?, horizon_max_months = ?, confidence = ?, structured_payload = ?
    WHERE id = ? AND owner_id = ? AND status = 'DRAFT'`)
    .bind(payload.inputText, payload.coreThesis, payload.horizonMinMonths, payload.horizonMaxMonths,
      payload.confidence, canonicalJson(payload), draft.id, owner).run();
  await logWorkflow(owner, "THESIS_DRAFT_EDIT", "SUCCEEDED", "user", { draftId: draft.id }, "用户已校验并保存草稿修改");
  return readDemoState(owner);
}

export async function createVersionDraft(ownerId: string) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  const active = await db.prepare("SELECT * FROM product_thesis_versions WHERE owner_id = ? AND status = 'ACTIVE' ORDER BY version_no DESC LIMIT 1").bind(owner).first<DbRow>();
  if (!active) throw new Error("ACTIVE_VERSION_NOT_FOUND");
  const draftId = `draft:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM product_thesis_versions WHERE owner_id = ? AND status = 'DRAFT'").bind(owner),
    db.prepare(`INSERT INTO product_thesis_versions
      (id, thesis_id, owner_id, version_no, status, input_text, core_thesis, horizon_min_months,
       horizon_max_months, confidence, change_type, structured_payload, created_at)
      VALUES (?, ?, ?, 0, 'DRAFT', ?, ?, ?, ?, ?, 'UPDATE', ?, ?)`)
      .bind(draftId, String(active.thesis_id), owner, String(active.input_text), String(active.core_thesis),
        Number(active.horizon_min_months), Number(active.horizon_max_months), Number(active.confidence),
        String(active.structured_payload), now),
  ]);
  await logWorkflow(owner, "THESIS_VERSION", "SUCCEEDED", "local", { sourceVersionId: active.id }, "已创建 V2 草稿");
  return readDemoState(owner);
}

export async function confirmDraft(ownerId: string) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  const draft = await db.prepare("SELECT * FROM product_thesis_versions WHERE owner_id = ? AND status = 'DRAFT' ORDER BY created_at DESC LIMIT 1").bind(owner).first<DbRow>();
  if (!draft) return readDemoState(owner);
  const maxVersion = await db.prepare("SELECT MAX(version_no) AS max_version FROM product_thesis_versions WHERE owner_id = ? AND status != 'DRAFT'").bind(owner).first<{ max_version: number | null }>();
  const versionNo = Number(maxVersion?.max_version ?? 0) + 1;
  const now = new Date().toISOString();
  const payload = validateThesisDraft(safeJson(draft.structured_payload));
  const canonicalPayload = canonicalJson(payload);
  const contentHash = await sha256(canonicalPayload);
  await db.batch([
    db.prepare("UPDATE product_thesis_versions SET status = 'SUPERSEDED' WHERE owner_id = ? AND status = 'ACTIVE'").bind(owner),
    db.prepare(`UPDATE product_thesis_versions SET version_no = ?, status = 'ACTIVE', structured_payload = ?, content_hash = ?, confirmed_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'DRAFT'`).bind(versionNo, canonicalPayload, contentHash, now, String(draft.id), owner),
    db.prepare("UPDATE product_theses SET current_version_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind(String(draft.id), now, String(draft.thesis_id), owner),
  ]);
  await persistVersionChildren(db, String(draft.id), payload);
  await logWorkflow(owner, "THESIS_CONFIRM", "SUCCEEDED", "local", { draftId: draft.id }, `冻结为 V${versionNo}`);
  return readDemoState(owner);
}

export async function importEvidence(ownerId: string, input: {
  format: "TEXT" | "JSON" | "CSV"; title: string; publisher: string; publishedAt: string;
  sourceUrl?: string; content: string;
}) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const facts = parseEvidenceInput({ format: input.format, content: input.content });
  const db = getD1();
  const documentId = `document:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const contentHash = await sha256(input.content);
  const existing = await db.prepare("SELECT id FROM source_documents WHERE owner_id = ? AND content_hash = ?")
    .bind(owner, contentHash).first<{ id: string }>();
  if (existing) {
    await logWorkflow(owner, "EVIDENCE_EXTRACTOR", "SUCCEEDED", env.LLM_PROVIDER || "fixture", { contentHash }, "检测到重复资料，未重复导入");
    return readDemoState(owner);
  }
  await db.batch([
    db.prepare(`INSERT INTO source_documents
      (id, owner_id, title, publisher, document_type, source_url, published_at, content_hash, raw_content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(documentId, owner, input.title, input.publisher, input.format, input.sourceUrl || null, input.publishedAt, contentHash, input.content, now),
    ...facts.map((fact, index) => {
      const id = `imported-evidence:${crypto.randomUUID()}`;
      return db.prepare(`INSERT INTO imported_evidence
        (id, owner_id, source_document_id, canonical_event_id, title, fact_text, source_excerpt,
         source_locator, assumption_code, impact, strength, verification, extractor_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', 'local-parser-v1', ?)`)
        .bind(id, owner, documentId, `${contentHash}:${index}`, fact.title, fact.factText, fact.sourceExcerpt,
          fact.sourceLocator, fact.assumptionCode, fact.impact, fact.strength, now);
    }),
    db.prepare(`UPDATE demo_sessions SET review_status = CASE WHEN review_status = 'DEFERRED' THEN 'OPEN' ELSE review_status END,
      updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, sessionIdFor(owner), owner),
  ]);
  await logWorkflow(owner, "EVIDENCE_EXTRACTOR", "SUCCEEDED", env.LLM_PROVIDER || "fixture", { documentId, format: input.format }, `导入 ${facts.length} 条事实`);
  return readDemoState(owner);
}

export async function saveEvidenceFeedback(ownerId: string, input: {
  evidenceId: string; feedback: "ACCEPTED" | "REJECTED" | "REASSIGNED"; assumptionCode?: string; reason?: string;
}) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  if (input.feedback === "REASSIGNED") {
    if (!input.assumptionCode || !input.reason?.trim()) throw new Error("REASSIGNMENT_DETAILS_REQUIRED");
    const active = await db.prepare("SELECT structured_payload FROM product_thesis_versions WHERE owner_id = ? AND status = 'ACTIVE' ORDER BY version_no DESC LIMIT 1")
      .bind(owner).first<{ structured_payload: string }>();
    const payload = active ? safeJson(active.structured_payload) as ThesisDraftPayload | null : null;
    if (!payload?.assumptions.some((item) => item.code === input.assumptionCode)) throw new Error("ASSUMPTION_NOT_FOUND");
  }
  const owned = await db.prepare(`SELECT id FROM imported_evidence WHERE id = ? AND owner_id = ?
    UNION ALL SELECT e.id FROM evidence e JOIN demo_sessions s ON s.id = e.session_id WHERE e.id = ? AND s.owner_id = ? LIMIT 1`)
    .bind(input.evidenceId, owner, input.evidenceId, owner).first<{ id: string }>();
  if (!owned) throw new Error("EVIDENCE_NOT_FOUND");
  await db.prepare(`INSERT INTO evidence_feedback
    (id, owner_id, evidence_id, feedback, assumption_code, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, evidence_id) DO UPDATE SET feedback = excluded.feedback,
      assumption_code = excluded.assumption_code, reason = excluded.reason, created_at = excluded.created_at`)
    .bind(`feedback:${owner}:${input.evidenceId}`, owner, input.evidenceId, input.feedback,
      input.assumptionCode ?? null, input.reason ?? null, new Date().toISOString()).run();
  const verification = input.feedback === "ACCEPTED" ? "VERIFIED" : input.feedback === "REJECTED" ? "REJECTED" : "UNVERIFIED";
  await db.prepare(`UPDATE imported_evidence SET verification = ?, assumption_code = COALESCE(?, assumption_code)
    WHERE id = ? AND owner_id = ?`)
    .bind(verification, input.assumptionCode ?? null, input.evidenceId, owner).run();
  await logWorkflow(owner, "EVIDENCE_FEEDBACK", "SUCCEEDED", "user", input, input.feedback);
  return readDemoState(owner);
}

export async function recordReviewEvent(ownerId: string, eventType: "TRIGGER_DISPUTED" | "REVIEW_DISMISSED", payload: Record<string, unknown>) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  const sessionId = sessionIdFor(owner);
  await db.batch([
    db.prepare(`INSERT INTO review_events (id, owner_id, session_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(`review-event:${crypto.randomUUID()}`, owner, sessionId, eventType, JSON.stringify(payload), new Date().toISOString()),
    db.prepare("UPDATE demo_sessions SET review_status = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind(eventType === "TRIGGER_DISPUTED" ? "DISPUTED" : "DISMISSED", new Date().toISOString(), sessionId, owner),
  ]);
  return readDemoState(owner);
}

export async function advanceScenario(ownerId: string, expectedCurrentPoint: number) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  const sessionId = sessionIdFor(owner);
  const session = await db.prepare("SELECT current_point, scenario_id FROM demo_sessions WHERE id = ? AND owner_id = ?").bind(sessionId, owner).first<{ current_point: number; scenario_id: string }>();
  if (!session) throw new Error("Demo session not found");
  if (session.scenario_id === "cn-fund-empty-v1") throw new Error("SCENARIO_DATA_MISSING");
  if (session.current_point !== expectedCurrentPoint) throw new Error("SCENARIO_POINT_CONFLICT");
  if (session.current_point >= 6) return readDemoState(owner);
  const nextPoint = session.current_point + 1;
  const rule = getRuleState(nextPoint);
  const reviewStatus = nextPoint >= 5 ? "OPEN" : "NONE";
  const now = new Date().toISOString();
  const activeVersion = nextPoint >= 5
    ? await db.prepare("SELECT id FROM product_thesis_versions WHERE owner_id = ? AND status = 'ACTIVE' ORDER BY version_no DESC LIMIT 1").bind(owner).first<{ id: string }>()
    : null;
  await db.batch([
    db.prepare("UPDATE demo_sessions SET current_point = ?, review_status = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind(nextPoint, reviewStatus, now, sessionId, owner),
    db.prepare(`INSERT OR IGNORE INTO rule_evaluations
      (id, session_id, event_index, status, progress_current, progress_required, explanation)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(`rule-eval:${sessionId}:${nextPoint}`, sessionId, nextPoint, rule.status, rule.current, rule.required,
        nextPoint >= 5 ? "收入增速连续两个季度低于 20%，正式触发复盘。" : nextPoint >= 4 ? "收入增速首次低于 20%，当前进度 1/2。" : "当前数据未满足失效条件。"),
    ...(nextPoint === 5 && activeVersion ? [
      db.prepare(`INSERT INTO review_events (id, owner_id, session_id, event_type, payload, created_at)
        VALUES (?, ?, ?, 'REVIEW_OPENED', ?, ?)`)
        .bind(`review-opened:${sessionId}:${nextPoint}`, owner, sessionId, JSON.stringify({ thesisVersionId: activeVersion.id, triggerPoint: nextPoint }), now),
    ] : []),
  ]);
  await logWorkflow(owner, "SCENARIO_ADVANCE", "SUCCEEDED", "mock", { nextPoint }, rule.label);
  return readDemoState(owner);
}

export async function resetScenario(ownerId: string) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  const sessionId = sessionIdFor(owner);
  await db.batch([
    db.prepare("DELETE FROM rule_evaluations WHERE session_id = ?").bind(sessionId),
    db.prepare("DELETE FROM review_events WHERE owner_id = ? AND session_id = ?").bind(owner, sessionId),
    db.prepare(`UPDATE demo_sessions SET current_point = 0, thesis_confirmed = 1, review_status = 'NONE',
      decision_action = NULL, decision_reason = NULL, decision_confidence = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ?`).bind(new Date().toISOString(), sessionId, owner),
  ]);
  return readDemoState(owner);
}

export async function setScenario(ownerId: string, scenarioId: "cn-equity-demo-v1" | "cn-fund-empty-v1") {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  const sessionId = sessionIdFor(owner);
  await db.batch([
    db.prepare("DELETE FROM rule_evaluations WHERE session_id = ?").bind(sessionId),
    db.prepare("DELETE FROM review_events WHERE owner_id = ? AND session_id = ?").bind(owner, sessionId),
    db.prepare("UPDATE demo_sessions SET scenario_id = ?, current_point = 0, review_status = 'NONE', updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind(scenarioId, new Date().toISOString(), sessionId, owner),
  ]);
  return readDemoState(owner);
}

export async function deferReview(ownerId: string, requestedEvidence: string, deferredUntil: string) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const db = getD1();
  const sessionId = sessionIdFor(owner);
  const deferredTimestamp = Date.parse(deferredUntil);
  if (!Number.isFinite(deferredTimestamp) || deferredTimestamp <= Date.now()) throw new Error("INVALID_DEFERRED_UNTIL");
  const payload = { requestedEvidence, deferredUntil };
  await db.batch([
    db.prepare("UPDATE demo_sessions SET review_status = 'DEFERRED', decision_reason = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind(requestedEvidence, new Date().toISOString(), sessionId, owner),
    db.prepare(`INSERT INTO review_events (id, owner_id, session_id, event_type, payload, created_at)
      VALUES (?, ?, ?, 'REVIEW_DEFERRED', ?, ?)`)
      .bind(`review-event:${crypto.randomUUID()}`, owner, sessionId, JSON.stringify(payload), new Date().toISOString()),
  ]);
  return readDemoState(owner);
}

export async function createDecisionSnapshot(ownerId: string, input: {
  action: "HOLD" | "ADD" | "REDUCE" | "EXIT"; reason: string; confidence: number; challengerEvidence?: string;
}) {
  const owner = normalizeOwner(ownerId);
  await initializeDemoStore(owner);
  const current = await readDemoState(owner);
  if (current.session.currentPoint < 5) throw new Error("INVALID_STATE_TRANSITION");
  if (current.session.currentPoint >= 6) return current;
  if (current.session.reviewStatus === "DEFERRED") throw new Error("REVIEW_DEFERRED");
  if (current.session.reviewStatus === "DISMISSED") throw new Error("INVALID_STATE_TRANSITION");
  if (input.action === "ADD" && current.rule.status === "TRIGGERED" && !input.challengerEvidence?.trim()) {
    throw new Error("CHALLENGER_EVIDENCE_REQUIRED");
  }
  const db = getD1();
  const createdAt = new Date().toISOString();
  const snapshotThesis = current.reviewThesis ?? current.thesis;
  const thesisVersionId = snapshotThesis?.id ?? fixtureVersionIdFor(owner);
  const market = new MockMarketDataProvider();
  const priceSeries = await market.getMetricSeries({
    providerSymbol: "DEMO-CN-01", metricKey: "price_close", period: "DAY", from: "2026-08-11", to: "2026-08-11",
  });
  const price = priceSeries.at(-1);
  if (!price) throw new Error("PRICE_SNAPSHOT_UNAVAILABLE");
  const priceSnapshot = {
    value: price.value,
    currency: price.unit,
    observedAt: price.periodEnd,
    source: `${market.providerName}:${price.providerRecordId}`,
  };
  const frozenPayload = canonicalJson({ thesisVersionId, thesis: snapshotThesis, action: input.action,
    reason: input.reason, confidence: input.confidence, health: current.health, rule: current.rule,
    evidence: current.evidence, priceSnapshot, challengerEvidence: input.challengerEvidence?.trim() || null, createdAt });
  const contentHash = await sha256(frozenPayload);
  const id = `snapshot:${crypto.randomUUID()}`;
  const sessionId = sessionIdFor(owner);
  await db.batch([
    db.prepare(`INSERT INTO decision_snapshots
      (id, session_id, action, reason, confidence, thesis_version_id, health_score, frozen_payload, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, sessionId, input.action, input.reason, input.confidence, thesisVersionId, current.health.score, frozenPayload, contentHash, createdAt),
    db.prepare(`UPDATE demo_sessions SET current_point = 6, review_status = 'COMPLETED', decision_action = ?,
      decision_reason = ?, decision_confidence = ?, updated_at = ? WHERE id = ? AND owner_id = ?`)
      .bind(input.action, input.reason, input.confidence, createdAt, sessionId, owner),
    db.prepare(`INSERT INTO review_events (id, owner_id, session_id, event_type, payload, created_at)
      VALUES (?, ?, ?, 'DECISION_COMPLETED', ?, ?)`)
      .bind(`review-event:${crypto.randomUUID()}`, owner, sessionId, JSON.stringify({ snapshotId: id, action: input.action }), createdAt),
  ]);
  await logWorkflow(owner, "DECISION_SNAPSHOT", "SUCCEEDED", "user", input, `Snapshot ${id}`);
  return readDemoState(owner);
}
