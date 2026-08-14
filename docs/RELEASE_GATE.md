# Thesis Keeper P0 发布验收

## 产品闭环

Thesis Keeper 的核心价值不是预测涨跌，而是让用户在信息变化时忠实面对自己当初的投资理由。P0 必须完整跑通：

1. 用自然语言建立论点并生成结构化草稿；
2. 人工校正假设、指标和失效规则后冻结版本；
3. 按时间点释放可追溯证据，避免未来函数；
4. 用确定性规则计算 Trigger 与可解释 Health；
5. 在 THEN vs NOW 中回应原规则，延期、质疑或作出决定；
6. 把版本、证据、反方证据、价格、健康度和用户理由冻结为可验签快照。

除了这条主线，P0 还要覆盖用户在规则之外的真实操作：建立论点时声明买入依据与退出条件，任何时点都能记录计划外行动并声明推动因素，以及用历史快照回放自己的行为事实。产品只负责把这些记录并排呈现，不评价、不阻止、不给交易建议。

## 强制不变量

- Active Thesis 不可原地修改，只能由 Draft 创建新版本。
- AI 输出在落库前必须通过 Thesis Schema、权重、Catalog、关联和规则单位校验。
- Evidence FACT、模型解读、规则结果和用户决定在界面上分层展示。
- 缺失指标返回 `DATA_MISSING`，不能被当作恶化或触发条件。
- Evidence Rule 只能产生 `ATTENTION_ONLY`，不能直接要求交易复盘。
- 已拒绝的错误 Evidence Link 不再计入健康度。
- Trigger 后仍选择 ADD 时必须记录新的反证回应，系统不输出交易指令。
- Decision Snapshot 使用 canonical JSON 与 SHA-256；读取时重新验签。
- Review Case 在打开时冻结 THEN Thesis Version；后续版本不能改写该上下文。
- 重置演示不得删除历史 Decision Snapshot。
- 空基金模板不得继承 A 股 Evidence、Health 或 Trigger。
- 迁移必须能从空数据库顺序执行，数据库 Trigger 必须拒绝已确认版本和快照的更新/删除。
- 买入依据为价格动量、消息或他人推荐时，必须先写下可被证伪的表述才能编译草稿；退出条件在代码与文案上均为用户自己的计划，不是系统建议。
- 计划外行动写入 `record_type = 'UNPLANNED_ACTION'` 的追加行，必须带 `trigger_source`；不推进 `current_point`，不把 `review_status` 置为 `COMPLETED`，也不复用 Review 冻结的 THEN 版本。
- `record_type` / `trigger_source` / `assumptionStatus` 属于被哈希的 `frozen_payload`，两列均为 INSERT 时一次写入，快照不可变性不因新增字段被绕过。
- 行为镜子只输出计数与中位数，样本少于 `BEHAVIOR_MIRROR_MIN_SAMPLE = 3` 时必须显式说明无法说明习惯，不给任何比例结论。
- 证据时效最多扣 10 分且不单独改变状态；空基金模板强制为 0，`DATA_MISSING` 不得表现为恶化。
- RQData Bridge 的 `METRIC_SPECS` 单位与周期必须与 `metricCatalog` 逐条一致；财务序列必须以查询窗口右端为 point-in-time 查询日；缺基期或上年同期非正时不产生观测，不得填 0 或前值。
- 所有写操作按服务端身份检查 `owner_id`。

## 自动化 Release Gate

```powershell
npm ci
npm run lint
npx tsc --noEmit
npm test
npm run rqdata:test
```

`npm test` 必须完成生产构建、领域/Provider/摄入测试、迁移与数据库不变量测试，以及六条主要路由的 SSR 验收。`npm run rqdata:test` 校验 RQData Bridge 的指标口径与 point-in-time 取数，用假 rqdatac 模块运行，不需要许可证。

## 三分钟人工验收

1. 打开 `/theses/new`，生成草稿，修改一个假设标题和规则阈值，保存并确认新版本。
2. 回到 `/portfolio`，依次推进到 T3；在 `/evidence` 质疑反方证据，确认健康度重新计算。
3. 继续推进到 T5，打开 `/reviews/demo-review`，验证 `31% → 19% → 17%` 与 `2/2`。
4. 选择 ADD，确认未填写“新证据”时不能冻结；填写后创建快照。
5. 在 `/decisions` 检查版本、证据、价格快照和 `SHA-256 验签有效`。
6. 点击“重置演示”，确认历史快照仍然存在。
7. 选择 ETF / LOF 空模板，确认数据缺失不会显示为业务恶化。
8. 在新建论点页搜索境内股票或场内基金，选择结果后确认名称、规范代码和资产类型同步填入。
9. 在新建论点页把买入依据改为“价格动量”，确认未写判错条件时无法编译；补写后可以正常生成草稿。
10. 在 `/portfolio` 的“计划外行动”记录一次 ADD，推动因素选“价格涨跌”，确认页面并排显示当时仍成立的假设条数且未提示“复盘已完成”，`current_point` 不变。
11. 在 `/decisions` 确认该行带 `UNPLANNED` 标记与“非论点驱动”提示；累计不足 3 笔时行为镜子显式说明样本不足。

## 明确不进入 P0

真实交易、账户/仓位同步、自动交易建议、实时新闻抓取、公开注册、邮件/短信推送、港美股和场外基金不属于本次发布范围。RQData Bridge 是本地可选集成；离线固定 Scenario 仍是可重复 Demo 的发布基线。
