# Thesis Keeper

投资决策记忆与复盘系统本地 MVP。用户建立投资论点后，系统按固定的 A 股情境时间线释放证据，使用确定性规则检查失效条件，并冻结最终决策快照。真实数据与 API Key 当前刻意留空。

## 已实现

- 六个核心页面：投资组合、新建论点、论点详情、证据中心、论点复盘、决策记录。
- T0-T6 可重复 Scenario。
- 修正后的 `31% → 19% → 17%` 连续期 Trigger。
- 可解释 Health Score。
- FACT、AI 解读、规则结果和用户决定分层展示。
- D1 持久化、按登录身份隔离、幂等 Scenario 推进和不可更新的 SHA-256 决策快照。
- 自然语言论点编译、草稿确认、V1/V2 冻结版本与版本对比。
- TEXT / JSON / CSV 证据导入、内容哈希去重、来源元数据、人工接受/质疑/改映射。
- Trigger 口径异议、复盘延期日期、待补证据及完整审计事件。
- `StructuredLLMProvider` 的 fixture/远程适配器，以及 `MarketDataProvider` 的 Mock/Ricequant 预留实现。
- A 股可重复样例与 ETF/LOF 空数据模板。
- 工作流运行日志（模块、Provider、结果摘要；不写入原始用户文本）。

## 本地运行

```bash
npm install
npm run db:generate
npm run dev
```

访问 `http://localhost:3000`。

## 验证

```bash
npm run lint
npx tsc --noEmit
npm test
```

`npm test` 会完成生产构建，并检查领域规则和六条主要路由。

## 数据边界

当前使用虚构 A 股案例及固定 Mock 数据，不接入真实 Ricequant、行情、财报或交易账户。应用不提供证券推荐、目标价、收益预测或自动交易。

## 外部服务配置

复制 `.env.example` 后再填写。默认值会使用 `fixture` LLM 与 `mock` 行情，不需要任何密钥即可运行：

```dotenv
LLM_PROVIDER=fixture
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
MARKET_DATA_PROVIDER=mock
RICEQUANT_BASE_URL=
RICEQUANT_API_KEY=
```

当 `LLM_PROVIDER=remote` 时，远程端点需接受 JSON POST，并返回 `{ "output": ... }` 或直接返回结构化对象。Ricequant 的业务接口边界已固定，但在确认实际账号权限和端点协议前不会猜测具体 URL。
