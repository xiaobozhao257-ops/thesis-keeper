import assert from "node:assert/strict";
import test from "node:test";
import { calculateHealth, evaluateMetricRule, getRuleState, getScenarioRuleState, isScenarioDataAvailable, seededEvidence } from "../app/lib/demo-domain.ts";

test("the corrected 31 → 19 → 17 scenario produces deterministic trigger progress", () => {
  assert.deepEqual(getRuleState(1), {
    status: "NO_MATCH",
    current: 0,
    required: 2,
    label: "未触发 0/2",
  });
  assert.deepEqual(getRuleState(4), {
    status: "APPROACHING",
    current: 1,
    required: 2,
    label: "接近阈值 1/2",
  });
  assert.deepEqual(getRuleState(5), {
    status: "TRIGGERED",
    current: 2,
    required: 2,
    label: "已触发 2/2",
  });
});

test("health is explainable and a critical trigger wins over the numeric band", () => {
  const t3 = calculateHealth(3);
  assert.equal(t3.score, 92);
  assert.equal(t3.status, "ATTENTION");
  assert.equal(t3.breakdown.evidencePenalty, 8);

  const t5 = calculateHealth(5);
  assert.equal(t5.score, 28);
  assert.equal(t5.status, "MUST_REVIEW");
  assert.deepEqual(t5.breakdown, {
    metricPenalty: 24,
    evidencePenalty: 8,
    triggerPenalty: 40,
    stalenessPenalty: 0,
  });
});

test("metric rule handles missing data, ordering, consecutive periods and units", () => {
  const rule = { operator: "LT", threshold: 20, unit: "PERCENT", requiredConsecutivePeriods: 2 };
  assert.deepEqual(evaluateMetricRule(rule, []), { status: "DATA_MISSING", current: 0, required: 2, label: "数据缺失" });
  assert.equal(evaluateMetricRule(rule, [
    { value: 17, unit: "PERCENT", periodEnd: "2026-06-30" },
    { value: 31, unit: "PERCENT", periodEnd: "2025-12-31" },
    { value: 19, unit: "PERCENT", periodEnd: "2026-03-31" },
  ]).status, "TRIGGERED");
  assert.equal(evaluateMetricRule(rule, [
    { value: 19, unit: "PERCENT", periodEnd: "2026-03-31" },
  ]).status, "APPROACHING");
  assert.throws(() => evaluateMetricRule(rule, [{ value: 19, unit: "CNY", periodEnd: "2026-03-31" }]), /RULE_UNIT_MISMATCH/);
});

test("ETF and LOF empty template never inherits the equity trigger", () => {
  assert.equal(isScenarioDataAvailable("cn-fund-empty-v1"), false);
  assert.deepEqual(getScenarioRuleState("cn-fund-empty-v1", 5), {
    status: "DATA_MISSING", current: 0, required: 2, label: "数据缺失",
  });
  assert.equal(getScenarioRuleState("cn-equity-demo-v1", 5).status, "TRIGGERED");
});

test("fixture evidence carries complete source provenance", () => {
  for (const evidence of seededEvidence) {
    assert.ok(evidence.sourcePublisher);
    assert.ok(evidence.sourceTitle);
    assert.ok(evidence.sourceLocator.startsWith("fixture://"));
    assert.match(evidence.publishedAt, /^\d{4}-\d{2}-\d{2}/);
    assert.ok(evidence.factText.length > 10);
  }
});
