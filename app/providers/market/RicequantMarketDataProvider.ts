import {
  ProviderNotConfiguredError,
  type AssetType,
  type MarketDataProvider,
  type ProviderInstrument,
  type ProviderMetricObservation,
} from "./MarketDataProvider.ts";

export type RicequantConfig = {
  apiKey?: string;
  baseUrl?: string;
};

export class RicequantMarketDataProvider implements MarketDataProvider {
  readonly providerName = "ricequant";
  private readonly config: RicequantConfig;

  constructor(config: RicequantConfig) { this.config = config; }

  private assertConfigured() {
    if (!this.config.apiKey || !this.config.baseUrl) throw new ProviderNotConfiguredError(this.providerName);
  }

  async searchInstruments(_query: string): Promise<ProviderInstrument[]> {
    void _query;
    this.assertConfigured();
    throw new Error("RICEQUANT_ADAPTER_NOT_IMPLEMENTED");
  }

  async getInstrument(_providerSymbol: string): Promise<ProviderInstrument | null> {
    void _providerSymbol;
    this.assertConfigured();
    throw new Error("RICEQUANT_ADAPTER_NOT_IMPLEMENTED");
  }

  async getMetricSeries(_input: {
    providerSymbol: string;
    metricKey: string;
    period: "DAY" | "MONTH" | "QUARTER" | "YEAR";
    from: string;
    to: string;
  }): Promise<ProviderMetricObservation[]> {
    void _input;
    this.assertConfigured();
    throw new Error("RICEQUANT_ADAPTER_NOT_IMPLEMENTED");
  }

  async getCapabilities() {
    this.assertConfigured();
    return { assetTypes: ["EQUITY", "ETF", "LOF"] as AssetType[], metricKeys: [], supportsPointInTime: false };
  }
}
