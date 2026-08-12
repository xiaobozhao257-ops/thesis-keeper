import type { AssetType, MarketDataProvider, ProviderInstrument, ProviderMetricObservation } from "./MarketDataProvider";

const instruments: ProviderInstrument[] = [
  {
    providerSymbol: "DEMO-CN-01",
    canonicalCode: "688888.XSHG",
    name: "华星智算（虚构）",
    assetType: "EQUITY",
    exchange: "XSHG",
    currency: "CNY",
  },
  {
    providerSymbol: "DEMO-FUND-01",
    canonicalCode: "510300.XSHG",
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

  async getMetricSeries(input: {
    providerSymbol: string;
    metricKey: string;
    period: "DAY" | "MONTH" | "QUARTER" | "YEAR";
    from: string;
    to: string;
  }) {
    if (input.providerSymbol !== "DEMO-CN-01") return [];
    if (input.metricKey === "price_close") {
      return [
        { providerRecordId: "mock-price-t5", metricKey: "price_close", value: 42.8, unit: "CNY", periodStart: "2026-08-11", periodEnd: "2026-08-11", publishedAt: "2026-08-11" },
      ];
    }
    if (input.metricKey === "revenue_yoy") {
      const rows: ProviderMetricObservation[] = [
        { providerRecordId: "mock-t1", metricKey: "revenue_yoy", value: 31, unit: "PERCENT", periodStart: "2025-10-01", periodEnd: "2025-12-31", publishedAt: "2026-02-12" },
        { providerRecordId: "mock-t4", metricKey: "revenue_yoy", value: 19, unit: "PERCENT", periodStart: "2026-01-01", periodEnd: "2026-03-31", publishedAt: "2026-04-30" },
        { providerRecordId: "mock-t5", metricKey: "revenue_yoy", value: 17, unit: "PERCENT", periodStart: "2026-04-01", periodEnd: "2026-06-30", publishedAt: "2026-08-11" },
      ];
      return rows;
    }
    return [];
  }

  async getCapabilities() {
    return {
      assetTypes: ["EQUITY", "ETF", "LOF"] as AssetType[],
      metricKeys: ["price_close", "revenue_yoy", "net_profit_yoy", "gross_margin", "nav", "premium_discount", "tracking_error", "aum", "turnover"],
      supportsPointInTime: true,
    };
  }
}
