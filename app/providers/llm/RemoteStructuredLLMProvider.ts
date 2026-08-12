import { LLMNotConfiguredError, type StructuredLLMProvider } from "./StructuredLLMProvider.ts";

export type RemoteLLMConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export class RemoteStructuredLLMProvider implements StructuredLLMProvider {
  readonly providerName = "deepseek";
  private readonly config: RemoteLLMConfig;

  constructor(config: RemoteLLMConfig) { this.config = config; }

  async generate<TInput, TOutput>(request: {
    module: "THESIS_COMPILER" | "EVIDENCE_EXTRACTOR" | "RELEVANCE_JUDGE" | "REVIEW_CHALLENGER";
    promptVersion: string;
    schemaVersion: string;
    input: TInput;
    idempotencyKey: string;
  }): Promise<{
    output: TOutput; provider: string; model: string; latencyMs: number;
    usage?: { inputTokens: number; outputTokens: number; estimatedCostCny?: number };
  }> {
    if (!this.config.apiKey || !this.config.baseUrl || !this.config.model) throw new LLMNotConfiguredError();
    const startedAt = Date.now();
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const outputContract = request.module === "THESIS_COMPILER"
      ? "输出必须包含 instrumentName、canonicalCode、assetType、inputText、coreThesis、horizonMinMonths、horizonMaxMonths、confidence、assumptions、metrics、risks、rules、clarificationQuestions、fuzzyExpressions。assetType 只能是 EQUITY、ETF 或 LOF。assumptions 每项包含 code/title/description/weight，所有 weight 之和严格等于 1。metrics 每项包含 key/name/unit/period/assumptionCode，并严格从以下 Catalog 选取，禁止创造或改写 key：EQUITY 可用 revenue_yoy(PERCENT,QUARTER)、net_profit_yoy(PERCENT,QUARTER)、gross_margin(PERCENT,QUARTER)、operating_cash_flow(CNY,QUARTER)；ETF 可用 nav(CNY,DAY)、premium_discount(PERCENT,DAY)、tracking_error(PERCENT,MONTH)、aum(CNY,MONTH)、turnover(CNY,DAY)；LOF 可用 nav(CNY,DAY)、premium_discount(PERCENT,DAY)、aum(CNY,MONTH)、turnover(CNY,DAY)。rules 每项包含 type/name/action：type 只能是 METRIC_RULE 或 EVIDENCE_RULE；action 只能是 MUST_REVIEW 或 ATTENTION_ONLY；METRIC_RULE 还必须包含 metricKey、operator、threshold、unit、requiredConsecutivePeriods，其中 operator 只能是 LT、LTE、GT、GTE，metricKey 和 unit 必须与 metrics 中的条目完全一致；EVIDENCE_RULE 的 action 必须是 ATTENTION_ONLY。不要翻译任何枚举值或 Catalog key。"
      : "输出必须是与当前模块相符的结构化 JSON 对象。";
    let lastError: Error = new Error("LLM_REQUEST_FAILED");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.config.apiKey}`,
            "idempotency-key": `${request.idempotencyKey}:${attempt + 1}`,
          },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              {
                role: "system",
                content: `你是投资决策结构化引擎。模块=${request.module}，Prompt=${request.promptVersion}，Schema=${request.schemaVersion}。${outputContract}只返回一个 JSON 对象，不要使用 Markdown。`,
              },
              { role: "user", content: JSON.stringify(request.input) },
            ],
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
            stream: false,
          }),
        });
        if (!response.ok) throw new Error(`LLM_HTTP_${response.status}`);
        const body = await response.json() as {
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = body.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error("LLM_EMPTY_OUTPUT");
        let output: TOutput;
        try { output = JSON.parse(content) as TOutput; } catch { throw new Error("LLM_INVALID_JSON"); }
        return {
          output,
          provider: this.providerName,
          model: body.model || this.config.model,
          latencyMs: Date.now() - startedAt,
          usage: {
            inputTokens: Number(body.usage?.prompt_tokens ?? 0),
            outputTokens: Number(body.usage?.completion_tokens ?? 0),
          },
        };
      } catch (error) {
        lastError = error instanceof DOMException && error.name === "TimeoutError"
          ? new Error("LLM_TIMEOUT")
          : error instanceof Error ? error : new Error("LLM_REQUEST_FAILED");
        const retryable = /^(LLM_INVALID_JSON|LLM_EMPTY_OUTPUT|LLM_TIMEOUT|LLM_HTTP_(429|5\d\d))$/.test(lastError.message);
        if (!retryable || attempt === 1) throw lastError;
      }
    }
    throw lastError;
  }
}
