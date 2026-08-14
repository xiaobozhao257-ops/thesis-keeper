import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compileAlphaDraft, listAlphaTheses } from "../../../lib/alpha-store";
import { entryBasisSchema } from "../../../lib/product-domain";

const createSchema = z.object({
  instrumentName: z.string().trim().min(1).max(80),
  canonicalCode: z.string().trim().min(2).max(24),
  assetType: z.enum(["EQUITY", "ETF", "LOF"]),
  inputText: z.string().trim().min(12).max(6000),
  horizonMinMonths: z.number().int().min(1).max(120),
  horizonMaxMonths: z.number().int().min(1).max(240),
  confidence: z.number().int().min(0).max(100),
  entryBasis: entryBasisSchema.optional(),
  exitPlan: z.string().trim().max(1000).optional(),
}).refine((value) => value.horizonMaxMonths >= value.horizonMinMonths, {
  path: ["horizonMaxMonths"],
  message: "最长持有周期不能短于最短周期",
});

function ownerId(request: NextRequest) {
  return request.headers.get("oai-authenticated-user-id")?.trim() || "local-alpha-user";
}

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ data: await listAlphaTheses(ownerId(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "论点输入不完整。", details: parsed.error.issues } }, { status: 400 });
    }
    return NextResponse.json({ data: await compileAlphaDraft(ownerId(request), parsed.data) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  console.error("alpha-theses-api-error", code);
  const schemaInvalid = code.startsWith("THESIS_SCHEMA_INVALID:");
  return NextResponse.json({
    error: {
      code: schemaInvalid ? "THESIS_SCHEMA_INVALID" : "INTERNAL_ERROR",
      message: schemaInvalid ? code.slice("THESIS_SCHEMA_INVALID:".length) : "本地论点操作失败，请检查开发日志。",
    },
  }, { status: schemaInvalid ? 422 : 500 });
}
