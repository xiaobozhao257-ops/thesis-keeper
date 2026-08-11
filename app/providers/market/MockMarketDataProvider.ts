import type { AssetType, MarketDataProvider, ProviderInstrument, ProviderMetricObservation } from "./MarketDataProvider";

const instruments: ProviderInstrument[] = [
  {
    providerSymbol: "DEMO-CN-01",
    canonicalCode: "CN.DEMO.HXZS",
    name: "华星智算（虚构）",
    assetType: "EQUITY",
    exchange: "XSHG",
    currency: "CNY",
  },
  {
    providerSymbol: "DEMO-FUND-01",
    canonicalCode: "CN.DEMO.ETF01",
    name: "示例指数 ETF（待接数据）",
    assetType: "ETF",
    exchange: "XSHG",
    currency: "CNY",
  },
];

export class MockMarketDataProvider implements MarketDataProvider {
  readonly providerName = "mock";

  async searchInstruments(query: string) {
    const normalized = query.trim().toLowerCase();
    return instruments.filter((item) => `${item.name}${item.providerSymbol}${item.canonicalCode}`.toLowerCase().includes(normalized));
  }

  async getInstrument(providerSymbol: string) {
    return instruments.find((item) => item.providerSymbol === providerSymbol) ?? null;
  }

  async getMetricSeries(input: { providerSymbol: string; metricKey: string }) {
    if (input.providerSymbol !== "DEMO-CN-01" || input.metricKey !== "revenue_yoy") return [];
    const rows: ProviderMetricObservation[] = [
      { providerRecordId: "mock-t1", metricKey: "revenue_yoy", value: 31, unit: "PERCENT", periodStart: "2025-10-01", periodEnd: "2025-12-31", publishedAt: "2026-02-12" },
      { providerRecordId: "mock-t4", metricKey: "revenue_yoy", value: 19, unit: "PERCENT", periodStart: "2026-01-01", periodEnd: "2026-03-31", publishedAt: "2026-04-30" },
      { providerRecordId: "mock-t5", metricKey: "revenue_yoy", value: 17, unit: "PERCENT", periodStart: "2026-04-01", periodEnd: "2026-06-30", publishedAt: "2026-08-11" },
    ];
    return rows;
  }

  async getCapabilities() {
    return {
      assetTypes: ["EQUITY", "ETF", "LOF"] as AssetType[],
      metricKeys: ["revenue_yoy", "net_profit_yoy", "gross_margin", "nav", "premium_discount", "tracking_error", "aum", "turnover"],
      supportsPointInTime: true,
    };
  }
}
