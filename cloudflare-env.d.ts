declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    ASSETS?: Fetcher;
    // 本地 .env 中的配置，由 wrangler 在 dev/preview 启动时注入为 Worker 绑定。
    LLM_PROVIDER?: string;
    LLM_BASE_URL?: string;
    LLM_API_KEY?: string;
    LLM_MODEL?: string;
    MARKET_DATA_PROVIDER?: string;
    RICEQUANT_BRIDGE_URL?: string;
  };
}
