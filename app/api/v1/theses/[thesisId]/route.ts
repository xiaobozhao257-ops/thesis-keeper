import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmAlphaDraft, readAlphaThesis } from "../../../../lib/alpha-store";

const actionSchema = z.object({ action: z.literal("confirm-draft") });

function ownerId(request: NextRequest) {
  return request.headers.get("oai-authenticated-user-id")?.trim() || "local-alpha-user";
}

export async function GET(request: NextRequest, context: { params: Promise<{ thesisId: string }> }) {
  try {
    const { thesisId } = await context.params;
    return NextResponse.json({ data: await readAlphaThesis(ownerId(request), thesisId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ thesisId: string }> }) {
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "不支持的论点操作。" } }, { status: 400 });
    }
    const { thesisId } = await context.params;
    return NextResponse.json({ data: await confirmAlphaDraft(ownerId(request), thesisId) });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  console.error("alpha-thesis-api-error", code);
  const status = code === "THESIS_NOT_FOUND" ? 404 : code === "DRAFT_NOT_FOUND" ? 422 : 500;
  const message = code === "THESIS_NOT_FOUND"
    ? "论点不存在或不属于当前用户。"
    : code === "DRAFT_NOT_FOUND"
      ? "当前没有待确认的论点草稿。"
      : "本地论点操作失败，请检查开发日志。";
  return NextResponse.json({ error: { code: status === 500 ? "INTERNAL_ERROR" : code, message } }, { status });
}
