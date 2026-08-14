import {
  ProviderNotConfiguredError,
  type AssetType,
  type MarketDataProvider,
  type ProviderInstrument,
  type ProviderMetricObservation,
} from "./MarketDataProvider.ts";

export type RicequantConfig = { bridgeUrl?: string };

export class RicequantMarketDataProvider implements MarketDataProvider {
  readonly providerName = "ricequant";
  private readonly config: RicequantConfig;

  constructor(config: RicequantConfig) { this.config = config; }

  private get baseUrl() {
    if (!this.config.bridgeUrl) throw new ProviderNotConfiguredError(this.providerName);
    return this.config.bridgeUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`RICEQUANT_BRIDGE_HTTP_${response.status}`);
    return response.json() as Promise<T>;
  }

  async searchInstruments(query: string): Promise<ProviderInstrument[]> {
    return this.request(`/instruments/search?q=${encodeURIComponent(query)}`);
  }

  async getInstrument(providerSymbol: string): Promise<ProviderInstrument | null> {
    return this.request(`/instruments/${encodeURIComponent(providerSymbol)}`);
  }

  async getMetricSeries(input: {
    providerSymbol: string;
    metricKey: string;
    period: "DAY" | "MONTH" | "QUARTER" | "YEAR";
    from: string;
    to: string;
  }): Promise<ProviderMetricObservation[]> {
    const params = new URLSearchParams({
      symbol: input.providerSymbol,
      metricKey: input.metricKey,
      period: input.period,
      from: input.from,
      to: input.to,
    });
    return this.request(`/metrics?${params.toString()}`);
  }

  async getCapabilities() {
    void this.baseUrl;
    return {
      assetTypes: ["EQUITY", "ETF", "LOF"] as AssetType[],
      // 与 services/rqdata_bridge/server.py 的 METRIC_SPECS 保持一致。
      metricKeys: [
        "price_close",
        "turnover",
        "nav",
        "premium_discount",
        "tracking_error",
        "aum",
        "revenue_yoy",
        "net_profit_yoy",
        "gross_margin",
        "operating_cash_flow",
      ],
      supportsPointInTime: true,
    };
  }
}
