import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  advanceScenario,
  compileAndSaveDraft,
  confirmDraft,
  createDecisionSnapshot,
  createVersionDraft,
  deferReview,
  importEvidence,
  readDemoState,
  recordReviewEvent,
  resetScenario,
  saveEvidenceFeedback,
  setScenario,
} from "../../../lib/demo-store";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("advance"), expectedCurrentPoint: z.number().int().min(0).max(6) }),
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("create-version-draft") }),
  z.object({ action: z.literal("confirm-draft") }),
  z.object({
    action: z.literal("compile-draft"),
    instrumentName: z.string().trim().min(1).max(80),
    canonicalCode: z.string().trim().min(2).max(24),
    assetType: z.enum(["EQUITY", "ETF", "LOF"]),
    inputText: z.string().trim().min(12).max(6000),
    horizonMinMonths: z.number().int().min(1).max(120),
    horizonMaxMonths: z.number().int().min(1).max(240),
    confidence: z.number().int().min(0).max(100),
  }),
  z.object({
    action: z.literal("import-evidence"),
    format: z.enum(["TEXT", "JSON", "CSV"]),
    title: z.string().trim().min(1).max(200),
    publisher: z.string().trim().min(1).max(120),
    publishedAt: z.string().trim().min(8).max(40),
    sourceUrl: z.string().trim().url().max(1000).optional().or(z.literal("")),
    content: z.string().trim().min(3).max(100000),
  }),
  z.object({
    action: z.literal("evidence-feedback"),
    evidenceId: z.string().trim().min(1).max(200),
    feedback: z.enum(["ACCEPTED", "REJECTED", "REASSIGNED"]),
    assumptionCode: z.string().trim().max(20).optional(),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("dispute-trigger"), reason: z.string().trim().min(4).max(1000) }),
  z.object({ action: z.literal("dismiss-review"), reason: z.string().trim().min(4).max(1000) }),
  z.object({ action: z.literal("set-scenario"), scenarioId: z.enum(["cn-equity-demo-v1", "cn-fund-empty-v1"]) }),
  z.object({
    action: z.literal("defer"),
    requestedEvidence: z.string().trim().min(4).max(500),
    deferredUntil: z.string().trim().min(8).max(40),
  }),
  z.object({
    action: z.literal("decision"),
    decisionAction: z.enum(["HOLD", "ADD", "REDUCE", "EXIT"]),
    reason: z.string().trim().min(8).max(1000),
    confidence: z.number().int().min(0).max(100),
  }),
]);

function ownerId(request: NextRequest) {
  return request.headers.get("oai-authenticated-user-id")?.trim() || "local-demo-user";
}

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ data: await readDemoState(ownerId(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "提交内容不完整。", details: parsed.error.issues } },
        { status: 400 },
      );
    }

    const owner = ownerId(request);
    const input = parsed.data;
    switch (input.action) {
      case "advance": return NextResponse.json({ data: await advanceScenario(owner, input.expectedCurrentPoint) });
      case "reset": return NextResponse.json({ data: await resetScenario(owner) });
      case "compile-draft": return NextResponse.json({ data: await compileAndSaveDraft(owner, input) });
      case "create-version-draft": return NextResponse.json({ data: await createVersionDraft(owner) });
      case "confirm-draft": return NextResponse.json({ data: await confirmDraft(owner) });
      case "import-evidence": return NextResponse.json({ data: await importEvidence(owner, input) });
      case "evidence-feedback": return NextResponse.json({ data: await saveEvidenceFeedback(owner, input) });
      case "dispute-trigger": return NextResponse.json({ data: await recordReviewEvent(owner, "TRIGGER_DISPUTED", { reason: input.reason }) });
      case "dismiss-review": return NextResponse.json({ data: await recordReviewEvent(owner, "REVIEW_DISMISSED", { reason: input.reason }) });
      case "set-scenario": return NextResponse.json({ data: await setScenario(owner, input.scenarioId) });
      case "defer": return NextResponse.json({ data: await deferReview(owner, input.requestedEvidence, input.deferredUntil) });
      case "decision": return NextResponse.json({
        data: await createDecisionSnapshot(owner, {
          action: input.decisionAction,
          reason: input.reason,
          confidence: input.confidence,
        }),
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const conflictCodes = new Set(["SCENARIO_POINT_CONFLICT", "INVALID_STATE_TRANSITION"]);
  const configCodes = new Set(["LLM_NOT_CONFIGURED", "RICEQUANT_NOT_CONFIGURED"]);
  const status = conflictCodes.has(code) ? 409 : configCodes.has(code) ? 503 : 500;
  const message = conflictCodes.has(code)
    ? "当前状态已变化，请刷新后重试。"
    : configCodes.has(code)
      ? "真实服务尚未配置；请填写环境变量，或继续使用离线 fixture。"
      : "本地数据操作失败，请检查开发日志。";
  return NextResponse.json({ error: { code: status === 500 ? "INTERNAL_ERROR" : code, message } }, { status });
}
