# 散户理性习惯培养功能 - 完成总结

## 交付物

四项功能端到端落地（领域 → 持久化 → API → 界面 → 样式 → 测试），并顺带补齐 `docs/PRODUCT_REVIEW.md` 列出的三个行动项。

| 功能 | 主要落点 |
|---|---|
| 建仓纪律 | `app/lib/product-domain.ts` 的 `entryBasisSchema` 与 `superRefine`；`ThesisKeeperApp.tsx` 的 `NewThesisView` / `DraftEditor` |
| 计划外行动记录 | `app/lib/demo-store.ts:recordUnplannedAction` + 共享 `writeDecisionRecord`；`drizzle/0002_grey_bruce_banner.sql` 两列；`unplanned-action` API 分支；`UnplannedActionPanel` |
| 行为镜子 | `app/lib/demo-domain.ts:summarizeBehavior` + `BEHAVIOR_MIRROR_MIN_SAMPLE`；`BehaviorMirrorPanel` |
| 证据时效扣分 | `calculateStalenessPenalty` 接入 `calculateHealth`，空基金模板强制为 0 |
| Bridge 财务指标 | `services/rqdata_bridge/server.py` 的 `METRIC_SPECS` / `FINANCIAL_FIELDS` 及六个新序列方法 |
| 问题陈述与边界 | `docs/PROBLEM.md`；`README.md` 首屏「这个 agent 做什么，不做什么」 |

## 改动范围

新增：`drizzle/0002_grey_bruce_banner.sql`、`drizzle/meta/0002_snapshot.json`、`docs/PROBLEM.md`、`tests/test_rqdata_bridge.py`、本 spec 三件套。

修改：`app/lib/demo-domain.ts`、`app/lib/product-domain.ts`、`app/lib/demo-store.ts`、`app/api/v1/demo/route.ts`、`app/components/ThesisKeeperApp.tsx`、`app/globals.css`、`app/providers/market/RicequantMarketDataProvider.ts`、`db/schema.ts`、`services/rqdata_bridge/server.py`、`scripts/rqdata.mjs`、`package.json`、`tests/domain.test.mjs`、`tests/migration.test.mjs`、`README.md`、`docs/RELEASE_GATE.md`、`docs/PRODUCT_REVIEW.md`。

## 关键决策

**追加式迁移，不碰快照不可变性。** `decision_snapshots` 的 UPDATE / DELETE 被数据库 Trigger 无条件拒绝，所以两个新字段只能是 INSERT 时一次写入的追加列。`record_type` 带默认值 `PLANNED_REVIEW`，旧的 10 列 INSERT 无需改动即可继续工作。迁移后表数 16、Trigger 数 12 均未变化。

**新字段进哈希载荷。** `record_type` / `trigger_source` / `assumptionStatus` 写在 `frozen_payload` 内而不是仅落列，SHA-256 验签范围自动覆盖它们，不需要改验签逻辑。

**计划外行动不推进状态机。** 它只写快照并更新 `updated_at`，不置 `current_point = 6`、不置 `review_status = 'COMPLETED'`，也不使用 Review 冻结的 THEN 版本而用当前论点。否则一次随手记录会把复盘流程判为已完成。

**不阻止、不评价。** 只把用户声明的推动因素与「当时你自己写下的条件还有几条成立」放在同一屏。一旦阻止或评分，产品就变成了交易建议，与发布边界冲突。唯一的强约束是弱依据必须先写下判错条件才能编译草稿。

**样本门槛写进界面文案。** 少于 3 笔时显式说明任何比例都不能说明习惯，而不是静默隐藏。小样本比例会制造新的错误叙事。

**Bridge 缺数据就不产生观测。** 上年同期为零或为负时同比没有可比口径，宁可让应用显示 `DATA_MISSING` 也不填 0 或前值。财务序列把 point-in-time 查询日锚定在窗口右端，避免未来函数。`/metrics` 的 `period` 与 `METRIC_SPECS` 不一致时返回 422，防止周期错位算出假触发。

## 校验结果

| 项 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npx tsc --noEmit` | 通过 |
| `npm test` | 生产构建通过，应用测试 24/24 通过 |
| `npm run rqdata:test` | 14/14 通过（假 rqdatac 注入，不需许可证） |

## 已知未验证项

Bridge 的真实连通性未验证——当前没有可用的 RQData 许可证。已验证注入路径、全部口径换算与缺失处理逻辑。填入许可证后需用 `curl http://127.0.0.1:8765/health` 确认真实连通，返回体应包含 `metricKeys` 列表。

## 遗留

暂无影响本次交付的已知工程遗留。
