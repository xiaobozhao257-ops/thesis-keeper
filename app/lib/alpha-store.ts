import { env as workerEnv } from "cloudflare:workers";
import { FixtureLLMProvider } from "../providers/llm/FixtureLLMProvider";
import { RemoteStructuredLLMProvider } from "../providers/llm/RemoteStructuredLLMProvider";
import {
  canonicalJson,
  compileThesisDraft,
  validateThesisDraft,
  type EntryBasisCode,
  type ThesisDraftPayload,
} from "./product-domain";
import { initializeDemoStore } from "./demo-store";

type AppEnv = {
  DB: D1Database;
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
};

type DbRow = Record<string, unknown>;

export type AlphaThesisInput = {
  instrumentName: string;
  canonicalCode: string;
  assetType: "EQUITY" | "ETF" | "LOF";
  inputText: string;
  horizonMinMonths: number;
  horizonMaxMonths: number;
  confidence: number;
  entryBasis?: { type: EntryBasisCode; falsifier: string };
  exitPlan?: string;
};

const env = workerEnv as unknown as AppEnv;

function normalizeOwner(ownerId?: string) {
  return ownerId?.trim() || "local-alpha-user";
}

function getD1() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeJson(value: unknown) {
  try {
    return JSON.parse(String(value ?? "{}")) as unknown;
  } catch {
    return null;
  }
}

async function initializeAlphaStore(owner: string) {
  // P0 与 Alpha 暂时共用同一个 D1 schema 初始化入口；数据通过 data_mode 严格隔离。
  await initializeDemoStore(owner);
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

function mapVersion(row: DbRow | null | undefined) {
  if (!row) return null;
  return {
    id: String(row.id),
    versionNo: Number(row.version_no),
    status: String(row.status),
    coreThesis: String(row.core_thesis),
    confidence: Number(row.confidence),
    inputText: String(row.input_text),
    horizonMinMonths: Number(row.horizon_min_months),
    horizonMaxMonths: Number(row.horizon_max_months),
    payload: safeJson(row.structured_payload) as ThesisDraftPayload | null,
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    createdAt: String(row.created_at),
  };
}

export async function listAlphaTheses(ownerId: string) {
  const owner = normalizeOwner(ownerId);
  await initializeAlphaStore(owner);
  const db = getD1();
  const rows = await db.prepare(`SELECT t.*,
      v.id AS version_id, v.version_no, v.status AS version_status, v.core_thesis,
      v.confidence, v.confirmed_at, v.created_at AS version_created_at
    FROM product_theses t
    LEFT JOIN product_thesis_versions v ON v.id = COALESCE(
      t.current_version_id,
      (SELECT draft.id FROM product_thesis_versions draft
       WHERE draft.thesis_id = t.id AND draft.owner_id = t.owner_id AND draft.status = 'DRAFT'
       ORDER BY draft.created_at DESC LIMIT 1)
    )
    WHERE t.owner_id = ? AND t.data_mode = 'REAL'
    ORDER BY CASE t.status WHEN 'ACTIVE' THEN 0 ELSE 1 END, t.updated_at DESC`)
    .bind(owner).all<DbRow>();

  return rows.results.map((row) => ({
    id: String(row.id),
    instrumentName: String(row.instrument_name),
    canonicalCode: String(row.canonical_code),
    assetType: String(row.asset_type),
    status: String(row.status),
    versionNo: row.version_no === null || row.version_no === undefined ? null : Number(row.version_no),
    versionStatus: row.version_status ? String(row.version_status) : null,
    coreThesis: row.core_thesis ? String(row.core_thesis) : "",
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    updatedAt: String(row.updated_at),
    health: { status: "DATA_MISSING" as const, score: null },
    pendingTaskCount: 0,
  }));
}

export async function readAlphaThesis(ownerId: string, thesisId: string) {
  const owner = normalizeOwner(ownerId);
  await initializeAlphaStore(owner);
  const db = getD1();
  const thesis = await db.prepare(`SELECT * FROM product_theses
    WHERE id = ? AND owner_id = ? AND data_mode = 'REAL'`)
    .bind(thesisId, owner).first<DbRow>();
  if (!thesis) throw new Error("THESIS_NOT_FOUND");

  const versions = await db.prepare(`SELECT * FROM product_thesis_versions
    WHERE thesis_id = ? AND owner_id = ? ORDER BY CASE status WHEN 'DRAFT' THEN 0 ELSE 1 END, version_no DESC, created_at DESC`)
    .bind(thesisId, owner).all<DbRow>();
  const mappedVersions = versions.results.map(mapVersion).filter((item) => item !== null);
  const active = mappedVersions.find((item) => item.id === String(thesis.current_version_id)) ?? null;
  const draft = mappedVersions.find((item) => item.status === "DRAFT") ?? null;

  return {
    id: String(thesis.id),
    ownerId: owner,
    instrumentName: String(thesis.instrument_name),
    canonicalCode: String(thesis.canonical_code),
    assetType: String(thesis.asset_type),
    status: String(thesis.status),
    predecessorThesisId: thesis.predecessor_thesis_id ? String(thesis.predecessor_thesis_id) : null,
    closedAt: thesis.closed_at ? String(thesis.closed_at) : null,
    createdAt: String(thesis.created_at),
    updatedAt: String(thesis.updated_at),
    activeVersion: active,
    draft,
    versions: mappedVersions,
    health: { status: "DATA_MISSING" as const, score: null },
    rule: { status: "DATA_MISSING" as const, current: 0, required: draft?.payload?.rules[0]?.requiredConsecutivePeriods ?? active?.payload?.rules[0]?.requiredConsecutivePeriods ?? 0 },
    observations: [],
    tasks: [],
  };
}

export async function compileAlphaDraft(ownerId: string, input: AlphaThesisInput) {
  const owner = normalizeOwner(ownerId);
  await initializeAlphaStore(owner);
  const remoteConfigured = (env.LLM_PROVIDER === "deepseek" || env.LLM_PROVIDER === "remote")
    && Boolean(env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL);
  const llm = remoteConfigured
    ? new RemoteStructuredLLMProvider({ apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL })
    : new FixtureLLMProvider((_module, requestInput) => compileThesisDraft(requestInput as AlphaThesisInput));
  let generated = await llm.generate<AlphaThesisInput, ThesisDraftPayload>({
    module: "THESIS_COMPILER",
    promptVersion: "thesis-compiler-v1",
    schemaVersion: "thesis-draft-v1",
    input,
    idempotencyKey: await sha256(`${owner}:alpha:${JSON.stringify(input)}`),
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
      module: "THESIS_COMPILER",
      promptVersion: "thesis-compiler-v1-repair",
      schemaVersion: "thesis-draft-v1",
      input: repairInput,
      idempotencyKey: await sha256(`${owner}:alpha:repair:${JSON.stringify(repairInput)}`),
    });
    try {
      payload = validateThesisDraft(generated.output);
    } catch {
      // 本地 Alpha 不能因远程模型的 Schema 漂移丢失用户的首次输入。
      // 回落只重建结构化草稿，不参与任何后续判定。
      payload = validateThesisDraft(compileThesisDraft(input));
    }
  }
  const db = getD1();
  const thesisId = `thesis:${crypto.randomUUID()}`;
  const draftId = `draft:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO product_theses
      (id, owner_id, instrument_name, canonical_code, asset_type, current_version_id,
       data_mode, status, predecessor_thesis_id, closed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'REAL', 'ACTIVE', NULL, NULL, ?, ?)`)
      .bind(thesisId, owner, input.instrumentName, input.canonicalCode, input.assetType, now, now),
    db.prepare(`INSERT INTO product_thesis_versions
      (id, thesis_id, owner_id, version_no, status, input_text, core_thesis, horizon_min_months,
       horizon_max_months, confidence, change_type, structured_payload, created_at)
      VALUES (?, ?, ?, 0, 'DRAFT', ?, ?, ?, ?, ?, 'INITIAL', ?, ?)`)
      .bind(draftId, thesisId, owner, input.inputText, payload.coreThesis, input.horizonMinMonths,
        input.horizonMaxMonths, input.confidence, canonicalJson(payload), now),
  ]);
  return readAlphaThesis(owner, thesisId);
}

export async function confirmAlphaDraft(ownerId: string, thesisId: string) {
  const owner = normalizeOwner(ownerId);
  await initializeAlphaStore(owner);
  const db = getD1();
  const thesis = await db.prepare(`SELECT id, current_version_id FROM product_theses
    WHERE id = ? AND owner_id = ? AND data_mode = 'REAL' AND status = 'ACTIVE'`)
    .bind(thesisId, owner).first<{ id: string; current_version_id: string | null }>();
  if (!thesis) throw new Error("THESIS_NOT_FOUND");
  const draft = await db.prepare(`SELECT * FROM product_thesis_versions
    WHERE thesis_id = ? AND owner_id = ? AND status = 'DRAFT' ORDER BY created_at DESC LIMIT 1`)
    .bind(thesisId, owner).first<DbRow>();
  if (!draft) throw new Error("DRAFT_NOT_FOUND");

  const payload = validateThesisDraft(safeJson(draft.structured_payload));
  const canonicalPayload = canonicalJson(payload);
  const contentHash = await sha256(canonicalPayload);
  const maximum = await db.prepare(`SELECT MAX(version_no) AS max_version FROM product_thesis_versions
    WHERE thesis_id = ? AND owner_id = ? AND status != 'DRAFT'`)
    .bind(thesisId, owner).first<{ max_version: number | null }>();
  const versionNo = Number(maximum?.max_version ?? 0) + 1;
  const now = new Date().toISOString();
  await db.batch([
    ...(thesis.current_version_id ? [db.prepare(`UPDATE product_thesis_versions SET status = 'SUPERSEDED'
      WHERE id = ? AND thesis_id = ? AND owner_id = ? AND status = 'ACTIVE'`)
      .bind(thesis.current_version_id, thesisId, owner)] : []),
    db.prepare(`UPDATE product_thesis_versions
      SET version_no = ?, status = 'ACTIVE', structured_payload = ?, content_hash = ?, confirmed_at = ?
      WHERE id = ? AND thesis_id = ? AND owner_id = ? AND status = 'DRAFT'`)
      .bind(versionNo, canonicalPayload, contentHash, now, String(draft.id), thesisId, owner),
    db.prepare(`UPDATE product_theses SET current_version_id = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND data_mode = 'REAL'`)
      .bind(String(draft.id), now, thesisId, owner),
  ]);
  await persistVersionChildren(db, String(draft.id), payload);
  return readAlphaThesis(owner, thesisId);
}
