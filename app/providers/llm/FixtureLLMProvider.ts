import type { StructuredLLMProvider } from "./StructuredLLMProvider";

export class FixtureLLMProvider implements StructuredLLMProvider {
  readonly providerName = "fixture";
  private readonly resolver: (module: string, input: unknown) => unknown;

  constructor(resolver: (module: string, input: unknown) => unknown) { this.resolver = resolver; }

  async generate<TInput, TOutput>(request: {
    module: "THESIS_COMPILER" | "EVIDENCE_EXTRACTOR" | "RELEVANCE_JUDGE" | "REVIEW_CHALLENGER";
    promptVersion: string;
    schemaVersion: string;
    input: TInput;
    idempotencyKey: string;
  }) {
    const startedAt = Date.now();
    return {
      output: this.resolver(request.module, request.input) as TOutput,
      provider: this.providerName,
      model: "fixture-v1",
      latencyMs: Date.now() - startedAt,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
