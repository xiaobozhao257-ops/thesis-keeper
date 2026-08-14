import type { AssetType } from "../providers/market/MarketDataProvider";
import { entryBasisTypes, isWeakEntryBasis } from "./demo-domain.ts";
import { z } from "zod";

export type EntryBasisCode = (typeof entryBasisTypes)[number]["code"];

export type ThesisDraftPayload = {
  instrumentName: string;
  canonicalCode: string;
  assetType: AssetType;
  inputText: string;
  coreThesis: string;
  horizonMinMonths: number;
  horizonMaxMonths: number;
  confidence: number;
  /**
   * 建仓纪律。基本面变化和估值属于可论证依据；价格动量、消息、他人推荐属于弱依据，
   * 必须同时写下可被证伪的表述（「若 X 到 Y 时点仍未发生，说明我判断错了」）。
   */
  entryBasis?: { type: EntryBasisCode; falsifier: string };
  /** 用户自己写下的退出计划，不是系统给出的交易建议。 */
  exitPlan?: string;
  assumptions: Array<{ code: string; title: string; description: string; weight: number }>;
  metrics: Array<{ key: string; name: string; unit: string; period: string; assumptionCode: string }>;
  risks: Array<{ title: string; description: string; assumptionCode?: string }>;
  rules: Array<{
    type: "METRIC_RULE" | "EVIDENCE_RULE";
    name: string;
    metricKey?: string;
    operator?: "LT" | "LTE" | "GT" | "GTE";
    threshold?: number;
    unit?: string;
    requiredConsecutivePeriods?: number;
    action: "MUST_REVIEW" | "ATTENTION_ONLY";
  }>;
  clarificationQuestions: string[];
  fuzzyExpressions: string[];
};

export const entryBasisCodes = entryBasisTypes.map((item) => item.code) as [EntryBasisCode, ...EntryBasisCode[]];

const assumptionSchema = z.object({
  code: z.string().trim().min(1).max(20),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  weight: z.number().min(0).max(1),
});

const metricSchema = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(40),
  period: z.string().trim().min(1).max(40),
  assumptionCode: z.string().trim().min(1).max(20),
});

const ruleSchema = z.object({
  type: z.enum(["METRIC_RULE", "EVIDENCE_RULE"]),
  name: z.string().trim().min(1).max(240),
  metricKey: z.string().trim().min(1).max(80).optional(),
  operator: z.enum(["LT", "LTE", "GT", "GTE"]).optional(),
  threshold: z.number().finite().optional(),
  unit: z.string().trim().min(1).max(40).optional(),
  requiredConsecutivePeriods: z.number().int().min(1).max(12).optional(),
  action: z.enum(["MUST_REVIEW", "ATTENTION_ONLY"]),
});

export const entryBasisSchema = z.object({
  type: z.enum(entryBasisCodes),
  falsifier: z.string().trim().max(600),
});

export const thesisDraftSchema = z.object({
  instrumentName: z.string().trim().min(1).max(80),
  canonicalCode: z.string().trim().min(2).max(24),
  assetType: z.enum(["EQUITY", "ETF", "LOF"]),
  inputText: z.string().trim().min(12).max(6000),
  coreThesis: z.string().trim().min(8).max(1200),
  horizonMinMonths: z.number().int().min(1).max(120),
  horizonMaxMonths: z.number().int().min(1).max(240),
  confidence: z.number().int().min(0).max(100),
  entryBasis: entryBasisSchema.optional(),
  exitPlan: z.string().trim().max(1000).optional(),
  assumptions: z.array(assumptionSchema).min(1).max(10),
  metrics: z.array(metricSchema).max(20),
  risks: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(1000),
    assumptionCode: z.string().trim().min(1).max(20).optional(),
  })).max(20),
  rules: z.array(ruleSchema).max(20),
  clarificationQuestions: z.array(z.string().trim().min(1).max(500)).max(10),
  fuzzyExpressions: z.array(z.string().trim().min(1).max(40)).max(20),
}).superRefine((draft, context) => {
  if (draft.canonicalCode !== "CN.DEMO.HXZS" && !/^\d{6}\.(XSHG|XSHE)$/.test(draft.canonicalCode)) {
    context.addIssue({ code: "custom", path: ["canonicalCode"], message: "P0 仅支持 XSHG/XSHE 境内交易所六位代码" });
  }
  if (draft.entryBasis && isWeakEntryBasis(draft.entryBasis.type) && draft.entryBasis.falsifier.trim().length < 8) {
    context.addIssue({
      code: "custom",
      path: ["entryBasis", "falsifier"],
      message: "价格动量、消息或他人推荐属于弱依据，必须写出可被证伪的表述",
    });
  }
  if (draft.horizonMinMonths > draft.horizonMaxMonths) {
    context.addIssue({ code: "custom", path: ["horizonMaxMonths"], message: "最长投资周期不能短于最短周期" });
  }
  const assumptionCodes = new Set(draft.assumptions.map((item) => item.code));
  if (assumptionCodes.size !== draft.assumptions.length) {
    context.addIssue({ code: "custom", path: ["assumptions"], message: "假设代码不能重复" });
  }
  const totalWeight = draft.assumptions.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(totalWeight - 1) > 0.0001) {
    context.addIssue({ code: "custom", path: ["assumptions"], message: "假设权重之和必须等于 1" });
  }
  draft.metrics.forEach((metric, index) => {
    if (!assumptionCodes.has(metric.assumptionCode)) {
      context.addIssue({ code: "custom", path: ["metrics", index, "assumptionCode"], message: "指标必须关联有效假设" });
    }
    const catalogMetric = metricCatalog[draft.assetType].find((item) => item.key === metric.key);
    if (!catalogMetric || catalogMetric.unit !== metric.unit || catalogMetric.period !== metric.period) {
      context.addIssue({ code: "custom", path: ["metrics", index], message: `指标 ${metric.key} 不适用于当前资产类型` });
    }
  });
  draft.rules.forEach((rule, index) => {
    if (rule.type === "EVIDENCE_RULE" && rule.action !== "ATTENTION_ONLY") {
      context.addIssue({ code: "custom", path: ["rules", index, "action"], message: "证据规则只能触发关注" });
    }
    if (rule.type === "METRIC_RULE") {
      const metric = draft.metrics.find((item) => item.key === rule.metricKey);
      if (!metric || !rule.operator || rule.threshold === undefined || !rule.requiredConsecutivePeriods || rule.unit !== metric.unit) {
        context.addIssue({ code: "custom", path: ["rules", index], message: "数值规则缺少有效指标、单位、阈值或连续周期" });
      }
    }
  });
});

export function validateThesisDraft(input: unknown): ThesisDraftPayload {
  const result = thesisDraftSchema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "draft"}: ${issue.message}`).join("；");
    throw new Error(`THESIS_SCHEMA_INVALID:${message}`);
  }
  return result.data;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export const metricCatalog = {
  EQUITY: [
    { key: "revenue_yoy", name: "营业收入同比增速", unit: "PERCENT", period: "QUARTER" },
    { key: "net_profit_yoy", name: "归母净利润同比增速", unit: "PERCENT", period: "QUARTER" },
    { key: "gross_margin", name: "毛利率", unit: "PERCENT", period: "QUARTER" },
    { key: "operating_cash_flow", name: "经营现金流", unit: "CNY", period: "QUARTER" },
  ],
  ETF: [
    { key: "nav", name: "单位净值", unit: "CNY", period: "DAY" },
    { key: "premium_discount", name: "溢折价率", unit: "PERCENT", period: "DAY" },
    { key: "tracking_error", name: "跟踪误差", unit: "PERCENT", period: "MONTH" },
    { key: "aum", name: "基金规模", unit: "CNY", period: "MONTH" },
    { key: "turnover", name: "成交额", unit: "CNY", period: "DAY" },
  ],
  LOF: [
    { key: "nav", name: "单位净值", unit: "CNY", period: "DAY" },
    { key: "premium_discount", name: "溢折价率", unit: "PERCENT", period: "DAY" },
    { key: "aum", name: "基金规模", unit: "CNY", period: "MONTH" },
    { key: "turnover", name: "成交额", unit: "CNY", period: "DAY" },
  ],
} satisfies Record<AssetType, Array<{ key: string; name: string; unit: string; period: string }>>;

const fuzzyWords = ["明显", "持续", "大幅", "较高", "恶化", "很好", "稳定"];

export function compileThesisDraft(input: {
  instrumentName: string;
  canonicalCode: string;
  assetType: AssetType;
  inputText: string;
  horizonMinMonths: number;
  horizonMaxMonths: number;
  confidence: number;
  entryBasis?: { type: EntryBasisCode; falsifier: string };
  exitPlan?: string;
}): ThesisDraftPayload {
  const fuzzyExpressions = fuzzyWords.filter((word) => input.inputText.includes(word));
  const isFund = input.assetType !== "EQUITY";
  const assumptions = isFund
    ? [
        { code: "A1", title: "标的指数长期逻辑成立", description: "跟踪指数或资产的长期配置逻辑没有发生根本变化。", weight: 0.4 },
        { code: "A2", title: "基金跟踪质量可接受", description: "跟踪误差、溢折价与流动性保持在可接受范围。", weight: 0.35 },
        { code: "A3", title: "规模与流动性稳定", description: "基金规模和成交活跃度能够支持正常持有与退出。", weight: 0.25 },
      ]
    : [
        { code: "A1", title: "行业需求持续增长", description: "公司所在行业的核心需求保持扩张。", weight: 0.4 },
        { code: "A2", title: "竞争优势能够维持", description: "产品、客户或成本优势没有被显著削弱。", weight: 0.35 },
        { code: "A3", title: "盈利质量保持稳定", description: "增长没有以显著牺牲盈利能力和现金流为代价。", weight: 0.25 },
      ];
  const selectedMetrics = isFund ? metricCatalog[input.assetType].slice(0, 3) : metricCatalog.EQUITY.slice(0, 3);
  const metrics = selectedMetrics.map((metric, index) => ({ ...metric, assumptionCode: index === 1 ? "A2" : index === 2 ? "A3" : "A1" }));
  const primaryMetric = metrics[0];

  return {
    ...input,
    coreThesis: isFund
      ? `${input.instrumentName}所代表的资产配置逻辑仍然成立，且基金跟踪质量可接受`
      : `${input.instrumentName}的行业需求与竞争优势将在投资周期内继续支撑增长`,
    assumptions,
    metrics,
    risks: isFund
      ? [{ title: "跟踪质量下降", description: "跟踪误差、溢折价或流动性出现持续异常。", assumptionCode: "A2" }]
      : [{ title: "需求或竞争格局反转", description: "核心需求下降或替代方案加速渗透。", assumptionCode: "A1" }],
    rules: primaryMetric
      ? [{
          type: "METRIC_RULE",
          name: isFund ? `${primaryMetric.name}连续异常` : `${primaryMetric.name}连续两个季度低于阈值`,
          metricKey: primaryMetric.key,
          operator: isFund ? "GT" : "LT",
          threshold: isFund ? 1 : 20,
          unit: primaryMetric.unit,
          requiredConsecutivePeriods: 2,
          action: "MUST_REVIEW",
        }]
      : [],
    clarificationQuestions: [
      ...(input.entryBasis && isWeakEntryBasis(input.entryBasis.type) && input.entryBasis.falsifier.trim().length < 8
        ? [`你选择的买入依据是弱依据，请补一句“若某件事到某个时点仍未发生，说明我判断错了”。`]
        : []),
      ...(input.exitPlan && input.exitPlan.trim().length < 8 ? ["退出条件还没写清楚。这是你自己的计划，不是系统的建议。"] : []),
      ...fuzzyExpressions.map((word) => `你提到“${word}”，请给出可监控的数值阈值和连续周期。`),
    ].slice(0, 3),
    fuzzyExpressions,
  };
}

export type ImportedFact = {
  title: string;
  factText: string;
  sourceExcerpt: string;
  sourceLocator: string;
  assumptionCode: string;
  impact: "SUPPORT" | "WEAKEN" | "CONTRADICT" | "NEUTRAL";
  strength: "WEAK" | "MEDIUM" | "STRONG";
};

export function parseEvidenceInput(input: {
  format: "TEXT" | "JSON" | "CSV";
  content: string;
}): ImportedFact[] {
  if (input.format === "JSON") {
    const parsed = JSON.parse(input.content) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row, index) => normalizeImportedRow(row as Record<string, unknown>, `json[${index}]`));
  }
  if (input.format === "CSV") {
    const lines = input.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error("CSV 至少需要表头和一行数据");
    const headers = lines[0].split(",").map((item) => item.trim());
    return lines.slice(1).map((line, index) => {
      const values = line.split(",").map((item) => item.trim());
      const row = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
      return normalizeImportedRow(row, `csv:${index + 2}`);
    });
  }
  const content = input.content.trim();
  if (!content) throw new Error("导入内容不能为空");
  const sentences = content.split(/(?<=[。！？；;])/).map((item) => item.trim()).filter((item) => item.length >= 8);
  const facts = sentences.length ? sentences : [content];
  return facts.slice(0, 10).map((fact, index) => ({
    title: fact.slice(0, 32),
    factText: fact,
    sourceExcerpt: fact,
    sourceLocator: `text:${index + 1}`,
    assumptionCode: "A1",
    impact: inferImpact(fact),
    strength: "MEDIUM",
  }));
}

function normalizeImportedRow(row: Record<string, unknown>, locator: string): ImportedFact {
  const factText = String(row.factText ?? row.fact ?? row.content ?? row.事实 ?? "").trim();
  if (!factText) throw new Error(`${locator} 缺少 fact/factText/content 字段`);
  const rawImpact = String(row.impact ?? row.影响 ?? "NEUTRAL").toUpperCase();
  const impact = (["SUPPORT", "WEAKEN", "CONTRADICT", "NEUTRAL"] as const).find((item) => item === rawImpact) ?? inferImpact(factText);
  const rawStrength = String(row.strength ?? row.强度 ?? "MEDIUM").toUpperCase();
  const strength = (["WEAK", "MEDIUM", "STRONG"] as const).find((item) => item === rawStrength) ?? "MEDIUM";
  return {
    title: String(row.title ?? row.标题 ?? factText.slice(0, 32)),
    factText,
    sourceExcerpt: String(row.sourceExcerpt ?? row.原文 ?? factText),
    sourceLocator: String(row.sourceLocator ?? row.定位 ?? locator),
    assumptionCode: String(row.assumptionCode ?? row.假设 ?? "A1"),
    impact,
    strength,
  };
}

function inferImpact(text: string): ImportedFact["impact"] {
  if (/下降|减少|低于|风险|削弱|恶化|替代|亏损/.test(text)) return "WEAKEN";
  if (/增长|提高|高于|改善|支持|扩大/.test(text)) return "SUPPORT";
  return "NEUTRAL";
}
