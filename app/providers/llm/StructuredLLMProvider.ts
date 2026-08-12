export type LLMModule = "THESIS_COMPILER" | "EVIDENCE_EXTRACTOR" | "RELEVANCE_JUDGE" | "REVIEW_CHALLENGER";

export interface StructuredLLMProvider {
  readonly providerName: string;
  generate<TInput, TOutput>(request: {
    module: LLMModule;
    promptVersion: string;
    schemaVersion: string;
    input: TInput;
    idempotencyKey: string;
  }): Promise<{
    output: TOutput;
    provider: string;
    model: string;
    latencyMs: number;
    usage?: { inputTokens: number; outputTokens: number; estimatedCostCny?: number };
  }>;
}

export class LLMNotConfiguredError extends Error {
  constructor() {
    super("LLM_NOT_CONFIGURED");
    this.name = "LLMNotConfiguredError";
  }
}
