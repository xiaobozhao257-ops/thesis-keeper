import assert from "node:assert/strict";
import test from "node:test";
import {
  BEHAVIOR_MIRROR_MIN_SAMPLE,
  assumptionStatusAt,
  calculateHealth,
  calculateStalenessPenalty,
  evaluateMetricRule,
  getRuleState,
  getScenarioRuleState,
  isScenarioDataAvailable,
  isThesisDrivenTrigger,
  seededEvidence,
  summarizeBehavior,
} from "../app/lib/demo-domain.ts";

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

test("evidence staleness deducts health in bands and never rewards bad input", () => {
  assert.equal(calculateStalenessPenalty(0), 0);
  assert.equal(calculateStalenessPenalty(13), 0);
  assert.equal(calculateStalenessPenalty(14), 4);
  assert.equal(calculateStalenessPenalty(29), 4);
  assert.equal(calculateStalenessPenalty(30), 10);
  assert.equal(calculateStalenessPenalty(400), 10);
  assert.equal(calculateStalenessPenalty(-5), 0);
  assert.equal(calculateStalenessPenalty(Number.NaN), 0);

  // 时效只扣分，不单独改变状态：T0 长期不补证据仍是 HEALTHY，只是分数下降。
  const stale = calculateHealth(0, 30);
  assert.equal(stale.score, 90);
  assert.equal(stale.status, "HEALTHY");
  assert.equal(stale.breakdown.stalenessPenalty, 10);
  assert.equal(calculateHealth(3, 14).score, 88);
});

test("assumption status freezes how many of the user's own conditions still hold", () => {
  assert.deepEqual(assumptionStatusAt(0), { total: 3, supporting: 3, mixed: 0, weakened: 0 });
  assert.deepEqual(assumptionStatusAt(5), { total: 3, supporting: 0, mixed: 1, weakened: 2 });
  // 越界输入被夹到有效区间，不抛错。
  assert.deepEqual(assumptionStatusAt(99), assumptionStatusAt(5));
  assert.deepEqual(assumptionStatusAt(-4), assumptionStatusAt(0));
});

test("only assumption changes count as thesis-driven triggers", () => {
  assert.equal(isThesisDrivenTrigger("ASSUMPTION_CHANGE"), true);
  assert.equal(isThesisDrivenTrigger("PRICE_MOVE"), false);
  assert.equal(isThesisDrivenTrigger("NEWS_OR_OPINION"), false);
  assert.equal(isThesisDrivenTrigger(null), false);
});

const behaviorFixture = [
  { id: "d1", action: "ADD", recordType: "UNPLANNED_ACTION", triggerSource: "PRICE_MOVE", confidence: 80, healthScore: 100, ruleStatus: "NO_MATCH", counterEvidenceCount: 0, createdAt: "2026-03-01T00:00:00Z" },
  { id: "d2", action: "REDUCE", recordType: "UNPLANNED_ACTION", triggerSource: "NEWS_OR_OPINION", confidence: 50, healthScore: 92, ruleStatus: "NO_MATCH", counterEvidenceCount: 1, createdAt: "2026-03-11T00:00:00Z" },
  { id: "d3", action: "ADD", recordType: "UNPLANNED_ACTION", triggerSource: "ASSUMPTION_CHANGE", confidence: 60, healthScore: 85, ruleStatus: "APPROACHING", counterEvidenceCount: 1, createdAt: "2026-04-01T00:00:00Z" },
  { id: "d4", action: "HOLD", recordType: "PLANNED_REVIEW", triggerSource: null, confidence: 40, healthScore: 28, ruleStatus: "TRIGGERED", counterEvidenceCount: 2, createdAt: "2026-05-01T00:00:00Z" },
];

test("behavior mirror only counts facts and stays silent below the minimum sample", () => {
  const thin = summarizeBehavior({
    decisions: behaviorFixture.slice(0, BEHAVIOR_MIRROR_MIN_SAMPLE - 1),
    thesisConfirmedAt: "2026-02-01T00:00:00Z", horizonMinMonths: 12, horizonMaxMonths: 24,
    now: "2026-05-15T00:00:00Z",
  });
  assert.equal(thin.decisionCount, BEHAVIOR_MIRROR_MIN_SAMPLE - 1);
  assert.equal(thin.sampleSufficient, false);

  const mirror = summarizeBehavior({
    decisions: behaviorFixture, thesisConfirmedAt: "2026-02-01T00:00:00Z",
    horizonMinMonths: 12, horizonMaxMonths: 24, now: "2026-05-15T00:00:00Z",
  });
  assert.equal(mirror.sampleSufficient, true);
  assert.equal(mirror.decisionCount, 4);
  assert.equal(mirror.unplannedCount, 3);
  assert.equal(mirror.unplannedShare, 75);
  assert.equal(mirror.positionChangeCount, 3);
  assert.equal(mirror.thesisDrivenCount, 2);
  assert.equal(mirror.thesisDrivenShare, 50);
  assert.equal(mirror.afterTriggerCount, 1);
  assert.equal(mirror.holdAfterTriggerCount, 1);
  assert.equal(mirror.holdAfterTriggerWithCounterEvidence, 1);
  assert.equal(mirror.averageConfidence, 58);
  assert.equal(mirror.averageConfidenceUnplanned, 63);
  assert.equal(mirror.averageConfidencePlanned, 40);
  assert.equal(mirror.medianDaysBetweenDecisions, 21);
  assert.deepEqual(mirror.declaredHorizonMonths, { min: 12, max: 24 });
  assert.equal(mirror.holdingDays, 103);
  assert.equal(mirror.exited, false);
  assert.equal(mirror.exitedBeforeHorizon, null);
  assert.deepEqual(mirror.triggerBreakdown.map((item) => [item.code, item.count, item.thesisDriven]), [
    ["ASSUMPTION_CHANGE", 1, true],
    ["PRICE_MOVE", 1, false],
    ["MARKET_OR_SECTOR", 0, false],
    ["NEWS_OR_OPINION", 1, false],
  ]);
});

test("behavior mirror compares the declared horizon with the actual exit, and handles an empty history", () => {
  const exited = summarizeBehavior({
    decisions: [...behaviorFixture, { id: "d5", action: "EXIT", recordType: "UNPLANNED_ACTION", triggerSource: "MARKET_OR_SECTOR", confidence: 30, healthScore: 28, ruleStatus: "TRIGGERED", counterEvidenceCount: 2, createdAt: "2026-05-11T00:00:00Z" }],
    thesisConfirmedAt: "2026-02-01T00:00:00Z", horizonMinMonths: 12, horizonMaxMonths: 24,
    now: "2026-05-15T00:00:00Z",
  });
  assert.equal(exited.exited, true);
  assert.equal(exited.holdingDays, 99);
  assert.equal(exited.exitedBeforeHorizon, true);

  const empty = summarizeBehavior({ decisions: [], thesisConfirmedAt: null, horizonMinMonths: null, horizonMaxMonths: null, now: "2026-05-15T00:00:00Z" });
  assert.equal(empty.decisionCount, 0);
  assert.equal(empty.sampleSufficient, false);
  assert.equal(empty.unplannedShare, 0);
  assert.equal(empty.medianDaysBetweenDecisions, null);
  assert.equal(empty.declaredHorizonMonths, null);
  assert.equal(empty.holdingDays, null);
  assert.equal(empty.exitedBeforeHorizon, null);
});
