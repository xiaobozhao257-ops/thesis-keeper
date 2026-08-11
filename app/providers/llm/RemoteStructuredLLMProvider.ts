import { LLMNotConfiguredError, type StructuredLLMProvider } from "./StructuredLLMProvider.ts";

export type RemoteLLMConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export class RemoteStructuredLLMProvider implements StructuredLLMProvider {
  readonly providerName = "remote";
  private readonly config: RemoteLLMConfig;

  constructor(config: RemoteLLMConfig) { this.config = config; }

  async generate<TInput, TOutput>(request: {
    module: "THESIS_COMPILER" | "EVIDENCE_EXTRACTOR" | "RELEVANCE_JUDGE" | "REVIEW_CHALLENGER";
    promptVersion: string;
    schemaVersion: string;
    input: TInput;
    idempotencyKey: string;
  }): Promise<{ output: TOutput; provider: string; model: string; latencyMs: number }> {
    if (!this.config.apiKey || !this.config.baseUrl || !this.config.model) throw new LLMNotConfiguredError();
    const startedAt = Date.now();
    const response = await fetch(this.config.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
        "idempotency-key": request.idempotencyKey,
      },
      body: JSON.stringify({ model: this.config.model, ...request }),
    });
    if (!response.ok) throw new Error(`LLM_HTTP_${response.status}`);
    const body = await response.json() as { output?: TOutput } | TOutput;
    const output = typeof body === "object" && body !== null && "output" in body
      ? (body as { output: TOutput }).output
      : body as TOutput;
    return { output, provider: this.providerName, model: this.config.model, latencyMs: Date.now() - startedAt };
  }
}
