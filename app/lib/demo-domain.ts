export type HealthStatus = "HEALTHY" | "ATTENTION" | "MUST_REVIEW";
export type EvidenceImpact = "SUPPORT" | "WEAKEN" | "CONTRADICT";
export type DecisionAction = "HOLD" | "ADD" | "REDUCE" | "EXIT" | "DEFER";

export type EvidenceItem = {
  id: string;
  eventIndex: number;
  title: string;
  factText: string;
  impact: EvidenceImpact;
  strength: "WEAK" | "MEDIUM" | "STRONG";
  sourceTitle: string;
  sourcePublisher: string;
  sourceLocator: string;
  publishedAt: string;
  assumptionCode: "A1" | "A2" | "A3";
};

export const scenarioEvents = [
  { point: "T0", kicker: "建立论点", title: "冻结 Thesis V1", detail: "把自然语言判断转换成三个可监控假设。" },
  { point: "T1", kicker: "首期财报", title: "核心指标 31%", detail: "收入增速仍高于 30% 的原始预期。" },
  { point: "T2", kicker: "行业证据", title: "需求侧继续扩张", detail: "行业算力基础设施订单保持增长。" },
  { point: "T3", kicker: "反方证据", title: "客户自研替代升温", detail: "一条强削弱证据命中竞争优势假设。" },
  { point: "T4", kicker: "第二期财报", title: "指标降至 19%", detail: "低于 20%，失效规则进度来到 1/2。" },
  { point: "T5", kicker: "第三期财报", title: "指标进一步降至 17%", detail: "连续两期低于 20%，正式进入必须复盘。" },
  { point: "T6", kicker: "决策快照", title: "记录今天的决定", detail: "冻结动作、理由、证据和当时的健康度。" },
] as const;

export const assumptions = [
  { code: "A1", title: "行业需求持续增长", detail: "国内算力基础设施投入保持扩张。", stateAt: ["支持", "支持", "支持", "支持", "混合", "削弱"] },
  { code: "A2", title: "产品竞争优势可维持", detail: "核心客户短期内不会大规模转向自研替代。", stateAt: ["支持", "支持", "支持", "削弱", "削弱", "削弱"] },
  { code: "A3", title: "盈利质量保持稳定", detail: "收入增长没有以显著牺牲盈利能力为代价。", stateAt: ["支持", "支持", "支持", "支持", "混合", "混合"] },
] as const;

export const metricSeries = [
  { label: "T1", value: 31 },
  { label: "T4", value: 19 },
  { label: "T5", value: 17 },
];

export type MetricObservation = { value: number; unit: string; periodEnd: string };
export type MetricRule = {
  operator: "LT" | "LTE" | "GT" | "GTE";
  threshold: number;
  unit: string;
  requiredConsecutivePeriods: number;
};

export function evaluateMetricRule(rule: MetricRule, observations: MetricObservation[]) {
  if (!observations.length) {
    return { status: "DATA_MISSING" as const, current: 0, required: rule.requiredConsecutivePeriods, label: "数据缺失" };
  }
  const ordered = [...observations].sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));
  if (ordered.some((item) => item.unit !== rule.unit)) throw new Error("RULE_UNIT_MISMATCH");
  const matches = (value: number) => rule.operator === "LT" ? value < rule.threshold
    : rule.operator === "LTE" ? value <= rule.threshold
      : rule.operator === "GT" ? value > rule.threshold
        : value >= rule.threshold;
  let current = 0;
  for (let index = ordered.length - 1; index >= 0 && matches(ordered[index].value); index -= 1) current += 1;
  const capped = Math.min(current, rule.requiredConsecutivePeriods);
  const status = capped >= rule.requiredConsecutivePeriods ? "TRIGGERED" as const : capped > 0 ? "APPROACHING" as const : "NO_MATCH" as const;
  const label = status === "TRIGGERED" ? `已触发 ${capped}/${rule.requiredConsecutivePeriods}`
    : status === "APPROACHING" ? `接近阈值 ${capped}/${rule.requiredConsecutivePeriods}`
      : `未触发 0/${rule.requiredConsecutivePeriods}`;
  return { status, current: capped, required: rule.requiredConsecutivePeriods, label };
}

export const seededEvidence: EvidenceItem[] = [
  {
    id: "ev-t2-demand",
    eventIndex: 2,
    title: "行业算力基础设施订单保持增长",
    factText: "演示数据包显示，样本期内相关基础设施订单同比增长 26%。",
    impact: "SUPPORT",
    strength: "MEDIUM",
    sourceTitle: "T2 行业跟踪数据（演示）",
    sourcePublisher: "Thesis Keeper 固定演示数据集",
    sourceLocator: "fixture://cn-equity-demo-v1/T2#industry-orders",
    publishedAt: "2026-04-18T00:00:00Z",
    assumptionCode: "A1",
  },
  {
    id: "ev-t3-substitution",
    eventIndex: 3,
    title: "头部客户自研替代方案进入量产验证",
    factText: "两家核心客户在演示期内扩大了自研替代方案的验证范围。",
    impact: "WEAKEN",
    strength: "STRONG",
    sourceTitle: "T3 客户供应链跟踪（演示）",
    sourcePublisher: "Thesis Keeper 固定演示数据集",
    sourceLocator: "fixture://cn-equity-demo-v1/T3#customer-substitution",
    publishedAt: "2026-05-22T00:00:00Z",
    assumptionCode: "A2",
  },
  {
    id: "ev-t4-growth",
    eventIndex: 4,
    title: "第二期收入增速降至 19%",
    factText: "演示公司本期数据中心业务收入同比增长 19%，首次低于 20% 阈值。",
    impact: "WEAKEN",
    strength: "MEDIUM",
    sourceTitle: "T4 季度经营数据（演示）",
    sourcePublisher: "Thesis Keeper 固定演示数据集",
    sourceLocator: "fixture://cn-equity-demo-v1/T4#revenue-growth",
    publishedAt: "2026-06-30T00:00:00Z",
    assumptionCode: "A1",
  },
  {
    id: "ev-t5-growth",
    eventIndex: 5,
    title: "第三期收入增速进一步降至 17%",
    factText: "演示公司本期数据中心业务收入同比增长 17%，连续第二期低于 20%。",
    impact: "CONTRADICT",
    strength: "STRONG",
    sourceTitle: "T5 季度经营数据（演示）",
    sourcePublisher: "Thesis Keeper 固定演示数据集",
    sourceLocator: "fixture://cn-equity-demo-v1/T5#revenue-growth",
    publishedAt: "2026-08-11T00:00:00Z",
    assumptionCode: "A1",
  },
];

export function calculateHealth(currentPoint: number) {
  const metricPenalty = currentPoint >= 5 ? 24 : currentPoint >= 4 ? 12 : 0;
  const evidencePenalty = currentPoint >= 3 ? 8 : 0;
  const triggerPenalty = currentPoint >= 5 ? 40 : currentPoint >= 4 ? 15 : 0;
  const stalenessPenalty = 0;
  const score = Math.max(0, 100 - metricPenalty - evidencePenalty - triggerPenalty - stalenessPenalty);
  const evidenceAttention = currentPoint >= 3;
  const status: HealthStatus = currentPoint >= 5 || score < 40
    ? "MUST_REVIEW"
    : score < 70 || evidenceAttention
      ? "ATTENTION"
      : "HEALTHY";

  return {
    score,
    status,
    breakdown: { metricPenalty, evidencePenalty, triggerPenalty, stalenessPenalty },
  };
}

export function getRuleState(currentPoint: number) {
  if (currentPoint >= 5) return { status: "TRIGGERED", current: 2, required: 2, label: "已触发 2/2" };
  if (currentPoint >= 4) return { status: "APPROACHING", current: 1, required: 2, label: "接近阈值 1/2" };
  return { status: "NO_MATCH", current: 0, required: 2, label: "未触发 0/2" };
}

export function isScenarioDataAvailable(scenarioId: string) {
  return scenarioId === "cn-equity-demo-v1";
}

export function getScenarioRuleState(scenarioId: string, currentPoint: number) {
  return isScenarioDataAvailable(scenarioId)
    ? getRuleState(currentPoint)
    : { status: "DATA_MISSING", current: 0, required: 2, label: "数据缺失" };
}

export function stateLabel(status: HealthStatus) {
  return status === "HEALTHY" ? "健康" : status === "ATTENTION" ? "需关注" : "必须复盘";
}

export function impactLabel(impact: EvidenceImpact) {
  return impact === "SUPPORT" ? "支持" : impact === "WEAKEN" ? "削弱" : "直接矛盾";
}
