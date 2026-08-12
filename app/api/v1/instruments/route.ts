import { env as workerEnv } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { MockMarketDataProvider } from "../../../providers/market/MockMarketDataProvider";
import { RicequantMarketDataProvider } from "../../../providers/market/RicequantMarketDataProvider";

type AppEnv = { MARKET_DATA_PROVIDER?: string; RICEQUANT_BRIDGE_URL?: string };
const env = workerEnv as unknown as AppEnv;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "请输入 2–80 个字符搜索标的。" } }, { status: 400 });
  }

  const provider = env.MARKET_DATA_PROVIDER === "ricequant" && env.RICEQUANT_BRIDGE_URL
    ? new RicequantMarketDataProvider({ bridgeUrl: env.RICEQUANT_BRIDGE_URL })
    : new MockMarketDataProvider();
  try {
    const instruments = await provider.searchInstruments(query);
    return NextResponse.json({ data: instruments, provider: provider.providerName });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MARKET_DATA_UNAVAILABLE";
    return NextResponse.json({
      error: { code, message: "标的数据源暂不可用；可稍后重试，或继续手工填写规范代码。" },
    }, { status: 503 });
  }
}
