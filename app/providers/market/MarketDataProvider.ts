export type AssetType = "EQUITY" | "ETF" | "LOF";

export type ProviderInstrument = {
  providerSymbol: string;
  canonicalCode: string;
  name: string;
  assetType: AssetType;
  exchange: "XSHG" | "XSHE";
  currency: "CNY";
};

export type ProviderMetricObservation = {
  providerRecordId: string;
  metricKey: string;
  value: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  publishedAt: string;
};

export interface MarketDataProvider {
  readonly providerName: string;
  searchInstruments(query: string): Promise<ProviderInstrument[]>;
  getInstrument(providerSymbol: string): Promise<ProviderInstrument | null>;
  getMetricSeries(input: {
    providerSymbol: string;
    metricKey: string;
    period: "DAY" | "MONTH" | "QUARTER" | "YEAR";
    from: string;
    to: string;
  }): Promise<ProviderMetricObservation[]>;
  getCapabilities(): Promise<{
    assetTypes: AssetType[];
    metricKeys: string[];
    supportsPointInTime: boolean;
  }>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider.toUpperCase()}_NOT_CONFIGURED`);
    this.name = "ProviderNotConfiguredError";
  }
}
