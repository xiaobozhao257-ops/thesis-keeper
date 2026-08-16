# 散户理性习惯培养功能 - 任务计划

- [x] 任务 1：领域层新增四组纯函数与常量（`app/lib/demo-domain.ts`）
    - 1.1：`triggerSources` 四类推动因素 + `triggerSourceLabel` + `isThesisDrivenTrigger`
    - 1.2：`entryBasisTypes` 五类买入依据 + `isWeakEntryBasis`（价格动量 / 消息 / 他人推荐为弱）
    - 1.3：`calculateStalenessPenalty` 分档扣分，负数与 NaN 归零
    - 1.4：`assumptionStatusAt` 按时间点返回假设成立条数，越界输入夹到有效区间
    - 1.5：`summarizeBehavior` + `BEHAVIOR_MIRROR_MIN_SAMPLE = 3`，只输出计数与中位数

- [x] 任务 2：建仓纪律校验（`app/lib/product-domain.ts`）
    - 2.1：`ThesisDraftPayload` 增加 `entryBasis` 与 `exitPlan`
    - 2.2：`entryBasisSchema` + `superRefine` 拒绝弱依据缺失可证伪表述
    - 2.3：`compileThesisDraft` 在弱依据或退出条件过短时追加 `clarificationQuestions`

- [x] 任务 3：数据库追加列（`db/schema.ts` + `drizzle/`）
    - 3.1：`decisionSnapshots` 增加 `record_type`（默认 `PLANNED_REVIEW`）与 `trigger_source`
    - 3.2：`npm run db:generate` 生成 `0002_grey_bruce_banner.sql`
    - 3.3：确认不新增表与 Trigger（16 / 12 不变）

- [x] 任务 4：写入路径（`app/lib/demo-store.ts`）
    - 4.1：抽出共享 `writeDecisionRecord`，`createDecisionSnapshot` 退化为守卫 + 委托
    - 4.2：新增 `recordUnplannedAction`，校验场景可用性与推动因素合法性
    - 4.3：计划外记录不推进 `current_point`、不置 `COMPLETED`、使用当前论点而非 THEN 版本
    - 4.4：`record_type` / `trigger_source` / `assumptionStatus` 写入被哈希的 `frozen_payload`
    - 4.5：`review_events` 写 `UNPLANNED_ACTION_RECORDED`，`logWorkflow` 记 `UNPLANNED_ACTION`
    - 4.6：修正 `readDemoState` 中 `frozen.assumptionStatus` 缺少 `mixed` 的类型断言

- [x] 任务 5：API 面（`app/api/v1/demo/route.ts`）
    - 5.1：`compile-draft` 增加 `entryBasis` / `exitPlan`
    - 5.2：新增 `unplanned-action` 判别联合成员与 switch 分支
    - 5.3：`TRIGGER_SOURCE_REQUIRED` 映射到 422 与中文提示

- [x] 任务 6：界面（`app/components/ThesisKeeperApp.tsx` + `app/globals.css`）
    - 6.1：`NewThesisView` 增加买入依据选择、弱依据警示与可证伪表述、退出条件
    - 6.2：`DraftEditor` 增加建仓纪律区块
    - 6.3：`UnplannedActionPanel`：折叠入口 + 动作 + 推动因素单选 + 并排呈现
    - 6.4：`BehaviorMirrorPanel` 三态（零决定 / 样本不足 / 七项事实）
    - 6.5：`DecisionsView` 快照卡片增加 UNPLANNED 标记与推动因素标签
    - 6.6：`PortfolioView` 用时效统计替换静态置信度，追加计划外行动区块
    - 6.7：CSS 复用既有 token 与左侧强调边框写法，含 760px 断点

- [x] 任务 7：测试
    - 7.1：`tests/domain.test.mjs` 新增时效分档、假设状态夹取、论点驱动判定、行为镜子聚合与退出对比、空历史
    - 7.2：`tests/migration.test.mjs` 校验两列存在、旧 10 列 INSERT 落到 `PLANNED_REVIEW`、12 列 INSERT 回读、UPDATE 仍抛 `IMMUTABLE_SNAPSHOT`
    - 7.3：修复 `product-domain.ts` 导入缺 `.ts` 后缀导致 Node type-stripping `ERR_MODULE_NOT_FOUND`

- [x] 任务 8：文档
    - 8.1：`README.md` 已实现清单增补四项
    - 8.2：`docs/RELEASE_GATE.md` 增补产品闭环说明、5 条不变量、3 条人工验收步骤

- [x] 任务 9：补齐 PRODUCT_REVIEW 的三个行动项
    - 9.1：Bridge 接入 `revenue_yoy` / `net_profit_yoy` / `gross_margin` / `operating_cash_flow`，并补 `premium_discount` / `tracking_error` / `aum`
    - 9.2：`tests/test_rqdata_bridge.py` 14 个测试，用假 rqdatac 模块验证口径，`npm run rqdata:test`
    - 9.3：`docs/PROBLEM.md` 用具体失败案例锚定创意来源，目标用户二选一定为进阶个人投资者
    - 9.4：README 首屏说清 agent 边界

- [x] 任务 10：生成 summary.md
