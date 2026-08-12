import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, compileThesisDraft, parseEvidenceInput, validateThesisDraft } from "../app/lib/product-domain.ts";
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

test("thesis schema rejects invalid weights, catalog mismatches and unsafe evidence rules", () => {
  const valid = compileThesisDraft({ instrumentName: "样例股票", canonicalCode: "600000.XSHG", assetType: "EQUITY", inputText: "行业持续增长但明显恶化时复盘", horizonMinMonths: 12, horizonMaxMonths: 24, confidence: 70 });
  assert.equal(validateThesisDraft(valid).assetType, "EQUITY");
  assert.throws(() => validateThesisDraft({ ...valid, assumptions: valid.assumptions.map((item) => ({ ...item, weight: 0.5 })) }), /权重之和必须等于 1/);
  assert.throws(() => validateThesisDraft({ ...valid, metrics: [{ ...valid.metrics[0], key: "nav" }] }), /不适用于当前资产类型/);
  assert.throws(() => validateThesisDraft({ ...valid, rules: [{ type: "EVIDENCE_RULE", name: "新闻触发交易复盘", action: "MUST_REVIEW" }] }), /证据规则只能触发关注/);
  assert.throws(() => validateThesisDraft({ ...valid, canonicalCode: "00700.XHKG" }), /仅支持 XSHG\/XSHE/);
});

test("canonical JSON is stable across object key order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: [3, 4] } }), canonicalJson({ a: { x: [3, 4], y: 2 }, z: 1 }));
});

test("evidence ingestion accepts text, JSON and CSV and preserves locators", () => {
  assert.equal(parseEvidenceInput({ format: "TEXT", content: "季度订单同比下降，需求风险提高。" })[0].impact, "WEAKEN");
  assert.equal(parseEvidenceInput({ format: "JSON", content: JSON.stringify({ title: "份额", factText: "市场份额提高", assumptionCode: "A2" }) })[0].assumptionCode, "A2");
  assert.equal(parseEvidenceInput({ format: "CSV", content: "title,factText,assumptionCode,impact\n毛利率,毛利率下降,A3,WEAKEN" })[0].sourceLocator, "csv:2");
});

test("market provider contract supports fixture and rejects blank Ricequant config", async () => {
  const mock = new MockMarketDataProvider();
  assert.equal((await mock.searchInstruments("华星")).length, 1);
  assert.equal((await mock.searchInstruments("ETF")).length, 1);
  assert.equal((await mock.searchInstruments("港股")).length, 0);
  assert.equal((await mock.getMetricSeries({ providerSymbol: "DEMO-CN-01", metricKey: "revenue_yoy", period: "QUARTER", from: "2025-01-01", to: "2026-12-31" })).length, 3);
  assert.deepEqual(await mock.getMetricSeries({ providerSymbol: "DEMO-CN-01", metricKey: "price_close", period: "DAY", from: "2026-08-11", to: "2026-08-11" }), [{
    providerRecordId: "mock-price-t5", metricKey: "price_close", value: 42.8, unit: "CNY", periodStart: "2026-08-11", periodEnd: "2026-08-11", publishedAt: "2026-08-11",
  }]);
  await assert.rejects(() => new RicequantMarketDataProvider({ bridgeUrl: "" }).searchInstruments("510300"), /RICEQUANT_NOT_CONFIGURED/);
});

test("remote LLM provider keeps credentials blank and fails explicitly", async () => {
  const provider = new RemoteStructuredLLMProvider({ apiKey: "", baseUrl: "", model: "" });
  await assert.rejects(() => provider.generate({ module: "THESIS_COMPILER", promptVersion: "v1", schemaVersion: "v1", input: {}, idempotencyKey: "test" }), /LLM_NOT_CONFIGURED/);
});

test("DeepSeek adapter appends Chat Completions to the official base URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    const body = JSON.parse(String(options.body));
    assert.equal(body.model, "deepseek-v4-flash");
    assert.equal(body.thinking.type, "disabled");
    assert.match(body.messages[0].content, /METRIC_RULE.*EVIDENCE_RULE/);
    assert.match(body.messages[0].content, /MUST_REVIEW.*ATTENTION_ONLY/);
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 7 } }), { status: 200 });
  };
  try {
    const provider = new RemoteStructuredLLMProvider({ apiKey: "test-only", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" });
    const result = await provider.generate({ module: "THESIS_COMPILER", promptVersion: "v1", schemaVersion: "v1", input: {}, idempotencyKey: "test" });
    assert.equal(requestedUrl, "https://api.deepseek.com/chat/completions");
    assert.deepEqual(result.output, { ok: true });
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepSeek adapter rejects malformed model output instead of persisting it", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 });
  };
  try {
    const provider = new RemoteStructuredLLMProvider({ apiKey: "test-only", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" });
    await assert.rejects(() => provider.generate({ module: "THESIS_COMPILER", promptVersion: "v1", schemaVersion: "v1", input: {}, idempotencyKey: "test" }), /LLM_INVALID_JSON/);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
