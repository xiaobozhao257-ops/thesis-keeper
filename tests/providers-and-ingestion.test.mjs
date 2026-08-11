import assert from "node:assert/strict";
import test from "node:test";
import { compileThesisDraft, parseEvidenceInput } from "../app/lib/product-domain.ts";
import { MockMarketDataProvider } from "../app/providers/market/MockMarketDataProvider.ts";
import { RicequantMarketDataProvider } from "../app/providers/market/RicequantMarketDataProvider.ts";
import { RemoteStructuredLLMProvider } from "../app/providers/llm/RemoteStructuredLLMProvider.ts";

test("offline compiler emits different monitor models for equity and ETF", () => {
  const equity = compileThesisDraft({ instrumentName: "样例股票", canonicalCode: "600000.XSHG", assetType: "EQUITY", inputText: "行业持续增长但明显恶化时复盘", horizonMinMonths: 12, horizonMaxMonths: 24, confidence: 70 });
  const etf = compileThesisDraft({ instrumentName: "样例 ETF", canonicalCode: "510300.XSHG", assetType: "ETF", inputText: "指数配置逻辑成立并关注跟踪质量", horizonMinMonths: 24, horizonMaxMonths: 60, confidence: 65 });
  assert.equal(equity.metrics[0].key, "revenue_yoy");
  assert.equal(etf.metrics[0].key, "nav");
  assert.equal(etf.assumptions[1].title, "基金跟踪质量可接受");
  assert.ok(equity.clarificationQuestions.length >= 1);
});

test("evidence ingestion accepts text, JSON and CSV and preserves locators", () => {
  assert.equal(parseEvidenceInput({ format: "TEXT", content: "季度订单同比下降，需求风险提高。" })[0].impact, "WEAKEN");
  assert.equal(parseEvidenceInput({ format: "JSON", content: JSON.stringify({ title: "份额", factText: "市场份额提高", assumptionCode: "A2" }) })[0].assumptionCode, "A2");
  assert.equal(parseEvidenceInput({ format: "CSV", content: "title,factText,assumptionCode,impact\n毛利率,毛利率下降,A3,WEAKEN" })[0].sourceLocator, "csv:2");
});

test("market provider contract supports fixture and rejects blank Ricequant config", async () => {
  const mock = new MockMarketDataProvider();
  assert.equal((await mock.getMetricSeries({ providerSymbol: "DEMO-CN-01", metricKey: "revenue_yoy", period: "QUARTER", from: "2025-01-01", to: "2026-12-31" })).length, 3);
  await assert.rejects(() => new RicequantMarketDataProvider({ apiKey: "", baseUrl: "" }).searchInstruments("510300"), /RICEQUANT_NOT_CONFIGURED/);
});

test("remote LLM provider keeps credentials blank and fails explicitly", async () => {
  const provider = new RemoteStructuredLLMProvider({ apiKey: "", baseUrl: "", model: "" });
  await assert.rejects(() => provider.generate({ module: "THESIS_COMPILER", promptVersion: "v1", schemaVersion: "v1", input: {}, idempotencyKey: "test" }), /LLM_NOT_CONFIGURED/);
});
