import assert from "node:assert/strict";
import test from "node:test";
import { calculateHealth, getRuleState } from "../app/lib/demo-domain.ts";

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
