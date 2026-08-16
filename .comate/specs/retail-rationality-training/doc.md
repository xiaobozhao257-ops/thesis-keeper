# 散户理性习惯培养功能 - 设计文档

## 1. 背景

`docs/PRODUCT_REVIEW.md` 完成后，用户给出了产品的真实意图：用这个产品培养散户的投资习惯和理性思维，针对 A 股散户追涨杀跌的问题。

审视时的产品只覆盖「规则触发 → 复盘 → 冻结快照」这一条主线。追涨杀跌恰恰发生在这条主线之外：用户在没有任何规则触发的时点自己动手加仓或清仓，而系统对此完全无感。

## 2. 目标

在不引入交易建议的前提下，让产品能看见并如实呈现规则之外的真实操作。四项功能，按杠杆率排序：

1. **计划外行动记录**：任何时点都能记录一次操作，必须声明推动因素。系统不评价、不阻止，只把用户声明的理由与当时仍成立的假设条数并排冻结。
2. **建仓纪律**：建立论点时声明买入依据类型与退出条件。价格动量 / 消息 / 他人推荐属于弱依据，必须同时写下可被证伪的表述。
3. **行为镜子**：从历史快照统计计数与中位数，样本不足时不给结论。
4. **证据时效扣分**：把已存在但未接线的 `stalenessPenalty` 接入健康度。

## 3. 输入

- 计划外行动：`decisionAction`（HOLD/ADD/REDUCE/EXIT）、`triggerSource`（四选一）、`reason`（≥8 字）、`confidence`（0–100）。
- 建仓纪律：`entryBasis.type`（五选一）、`entryBasis.falsifier`、`exitPlan`（可空）。
- 行为镜子：`decision_snapshots` 全量历史 + 论点确认时间 + 声明的投资周期。
- 证据时效：距最近一条证据的天数。

## 4. 输出

- 一条不可变的 `record_type = 'UNPLANNED_ACTION'` 快照，`trigger_source` 非空。
- 界面上的并排呈现：用户声明的推动因素 vs 当时仍成立的假设条数。
- 行为镜子七项事实：论点驱动占比、计划外占比、决定间隔中位数、声明周期 vs 实际持有、触发后仍持有、平均置信度、推动因素分布。
- 健康度扣分项 `stalenessPenalty`（14 天扣 4、30 天以上扣 10）。

## 5. 处理逻辑

### 5.1 计划外行动的写入路径

`decision_snapshots` 的 UPDATE 与 DELETE 被数据库 Trigger 无条件拒绝（`RAISE(ABORT,'IMMUTABLE_SNAPSHOT')`），因此新数据只能以追加列 / 追加行的方式引入。

`createDecisionSnapshot` 与 `recordUnplannedAction` 共用 `writeDecisionRecord`，差别只在三处：

| | 计划内复盘 | 计划外行动 |
|---|---|---|
| `record_type` | `PLANNED_REVIEW` | `UNPLANNED_ACTION` |
| `trigger_source` | `null` | 四选一，必填 |
| 会话状态 | `current_point = 6`，`review_status = 'COMPLETED'` | 只更新 `updated_at` |
| 快照的论点版本 | `reviewThesis ?? thesis`（THEN 冻结版本） | `thesis`（当前版本） |

`record_type` / `trigger_source` / `assumptionStatus` 都写在被哈希的 `frozen_payload` 内，验签范围自动覆盖新字段。

### 5.2 为什么不阻止

产品不能替用户判断一次操作是否理性，一旦阻止就变成了交易建议。所以逻辑只做一件事：把用户声明的推动因素与「当时你自己写下的条件还有几条成立」放在同一屏，`triggerSource !== 'ASSUMPTION_CHANGE'` 时标记为非论点驱动，仅此而已。

### 5.3 弱依据的门槛

`isWeakEntryBasis` 覆盖价格动量、消息、他人推荐三类。弱依据不禁止，但 `falsifier` 少于 8 字时 `thesisDraftSchema.superRefine` 拒绝，前端同步禁用编译按钮。这是唯一一处「先写下判错条件才能继续」的强约束。

### 5.4 样本门槛

`BEHAVIOR_MIRROR_MIN_SAMPLE = 3`。低于该值时 `sampleSufficient = false`，界面显式说明「样本少于 3 笔时，任何比例都不能说明习惯」，不渲染任何比例。理由：小样本比例会制造出新的错误叙事，与产品目的相反。

### 5.5 时效扣分不改变状态

`calculateStalenessPenalty` 只扣分，不单独把状态推向 ATTENTION 或 MUST_REVIEW。负数与 NaN 输入一律归零，避免坏输入变成加分。空基金模板强制 `daysSinceLastEvidence = 0`，保证 `DATA_MISSING` 不被显示成业务恶化。

## 6. 不做

- 不判断、不阻止、不评分任何一次操作。
- 不新增数据库表和 Trigger（迁移后表数 16、Trigger 数 12 保持不变）。
- 不引入新的规则 `action` 取值。
- 退出条件不参与任何自动判定，只在条件命中时呈现给用户。
