# Thesis Keeper

投资决策记忆与复盘系统本地 MVP。用户建立投资论点后，系统按固定的 A 股情境时间线释放证据，使用确定性规则检查失效条件，并冻结最终决策快照。真实密钥仅保存在本地 `.env`，不纳入仓库。

## 这个 agent 做什么，不做什么

LLM 只参与一件事：把用户说的自然语言翻译成可监控、可审计的结构化规则。这一步 Excel 做不到，正则做不到，也是散户写不出「连续两个季度低于 20%」这种阈值的根本原因。

规则生成之后全程没有模型参与——失效判定是确定性求值，论点版本不可变，决策快照 SHA-256 验签，缺失数据返回 `DATA_MISSING` 而不做任何推断。所以 `LLMModule` 声明的四个模块里只接了编译器一个：失效判定一旦可以被模型幻觉污染，这个产品的前提就没了。这是取舍，不是没做完。

系统不输出证券推荐、目标价、收益预测或交易指令。退出条件是用户自己写下的计划，系统只在条件命中时把它拿出来。

产品要解决的问题、目标用户的二选一，以及每条不变量的来源见 [`docs/PROBLEM.md`](docs/PROBLEM.md)。

## 已实现

- 六个核心页面：投资组合、新建论点、论点详情、证据中心、论点复盘、决策记录。
- T0-T6 可重复 Scenario。
- 修正后的 `31% → 19% → 17%` 连续期 Trigger。
- 可解释 Health Score。
- FACT、AI 解读、规则结果和用户决定分层展示。
- D1 持久化、可执行迁移、按登录身份隔离、幂等 Scenario 推进，以及由数据库 Trigger 保护的不可变版本和 SHA-256 决策快照。
- 自然语言论点编译、草稿确认、V1/V2 冻结版本与版本对比。
- TEXT / JSON / CSV 证据导入、内容哈希去重、来源元数据、人工接受/质疑/改映射。
- Trigger 口径异议、复盘延期日期、待补证据及完整审计事件。
- `StructuredLLMProvider` 的 fixture/DeepSeek 适配器，以及 `MarketDataProvider` 的 Mock/Ricequant 本地 Bridge 实现。
- A 股、ETF、LOF 标的搜索接口；数据源不可用时保留手工录入路径。
- A 股可重复样例与 ETF/LOF 空数据模板。
- 工作流运行日志（模块、Provider、时延、Token 用量、结果摘要；不写入原始用户文本）。
- 草稿人工编辑与落库前 Schema/Catalog/权重/规则单位校验。
- 证据按影响、假设和核验状态组合筛选，人工拒绝后重新计算健康度。
- 逆规则加仓的新证据约束，以及延期补证后重新打开复盘。
- canonical JSON + SHA-256 决策快照验签，并冻结版本、证据、反方证据与价格快照。
- Review 打开时冻结 THEN 版本；后续创建新版本不会改写既有 Review Context。
- ETF / LOF 空模板使用 `DATA_MISSING`，不会继承 A 股证据、Health 或 Trigger。
- 建仓纪律：建立论点时需声明买入依据类型；价格动量、消息、他人推荐属于弱依据，必须同时写下可被证伪的表述才能编译草稿。退出条件是用户自己写下的计划，不是系统给出的交易建议。
- 计划外行动记录：不依赖规则触发，任何时点都能写入不可变的 `UNPLANNED_ACTION` 快照，必须声明推动因素（假设变化 / 价格涨跌 / 大盘或板块 / 新闻或他人观点）。系统不评价、不阻止，只把用户声明的理由、推动因素和当时仍成立的假设条数并排冻结。
- 行为镜子：只从历史快照统计计数与中位数（论点驱动占比、计划外占比、决定间隔、声明周期 vs 实际持有、触发后仍持有、平均置信度、推动因素分布），样本少于 3 笔时不给出任何比例结论。
- 证据时效扣分：距最近一条证据 14 天扣 4 分、30 天以上扣 10 分，只影响分数不单独改变状态；空基金模板强制为 0，避免把 `DATA_MISSING` 显示成业务恶化。

## 环境依赖安装

### 1. 基础环境

- Node.js `>= 22.13.0`，用 `node --version` 检查。
- Git。
- Python。二选一：官方推荐的 Anaconda / Miniconda（`conda --version` 可执行），或系统自带的 `python3.10` – `python3.12`。RQSDK 1.7.4 依赖 scipy 1.10 / numpy 1.26，**Python 3.13+ 没有可用轮子**，脚本会拒绝使用。

### 2. 安装前端与服务端依赖

```bash
npm ci
```

`npm ci` 严格按 `package-lock.json` 安装，适合首次安装和可重复构建。主动升级依赖时才用 `npm install`。

### 3. 创建本地环境变量

```bash
cp .env.example .env
```

然后在 `.env` 中填写两个密钥，其余项模板已给好默认值：

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` | DeepSeek API Key，形如 `sk-...` |
| `RQSDK_LICENSE_KEY` | RQSDK 许可证。支持 license key 本身，或 `手机号:密码`（如 `13888888888:yourpassword`） |

`.env` 已被 Git 忽略。Wrangler 在 `npm run dev` 启动时把 `.env` 读成 Worker 绑定，**改完必须重启 dev server**。

### 4. 安装 RQSDK / RQData

```bash
npm run rqdata:setup
```

`scripts/rqdata.mjs` 跨平台，按以下优先级选运行环境：

1. `RQDATA_VENV` 指向的 venv（默认 `.venv-rqdata`，已存在则直接复用）；
2. conda 环境 `RQDATA_CONDA_ENV`（不存在时按 `environment.rqdata.yml` 创建）；
3. 两者都没有时，用系统 Python 现场创建 venv。

脚本会安装 `rqsdk==1.7.4`（RQData 的 `rqdatac` 组件随之安装），再读取 `.env` 中的 `RQSDK_LICENSE_KEY` 校验许可证并试连一次 RQData。许可证为空时只做 import 检查，填好后重跑即可。

许可证不写入任何 shell 配置文件：脚本按官方 uri 规则把 `RQSDK_LICENSE_KEY` 组装成 `RQDATAC2_CONF`，只注入子进程环境。若想用官方交互式命令，也可以直接执行：

```bash
.venv-rqdata/bin/rqsdk license
.venv-rqdata/bin/rqsdk license info
```

### 5. 初始化本地数据库

```bash
npm run db:generate
```

开发运行时会通过 D1 创建必要表结构；迁移文件用于记录和审查 Schema 变化。

## 本地启动

需要两个终端。

终端一启动 RQData Bridge：

```bash
npm run rqdata:start
```

终端二启动 Thesis Keeper：

```bash
npm run dev
```

访问 `http://localhost:3000`。首屏右上角的 Provider 徽标会显示 `LLM 已配置` / `行情 Ricequant`；若显示 `Fixture` / `Mock` 说明 `.env` 未生效或 dev server 未重启。

## 配置自检

```bash
npm run env:check
```

逐项检查 `.env` 是否存在且被 git 忽略、LLM 四个变量是否齐全并实发一次最小请求、RQData 许可证是否填写、Bridge 是否在监听。只报告可用性，不打印任何密钥原文。401 / 402 / 404 会分别提示 Key 无效、余额不足、模型名或 BASE_URL 错误。

也可以单独探一下 Bridge：

```bash
curl http://127.0.0.1:8765/health
```

## 验证

```bash
npm run lint
npx tsc --noEmit
npm test
npm run rqdata:test
```

`npm test` 会完成生产构建，并检查领域规则和六条主要路由。`npm run rqdata:test` 单独校验 RQData Bridge 的指标口径，用假 rqdatac 模块运行，不需要许可证也不联网。

完整 P0 不变量、自动化 Gate 和三分钟人工验收见 [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md)。

## 数据边界

未配置密钥时仍可使用虚构 A 股案例及固定 Mock 数据。应用不提供证券推荐、目标价、收益预测或自动交易。

## 外部服务配置

`.env` 全量配置项如下。README 和 `.env.example` 中不得出现真实密钥：

```dotenv
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=
LLM_MODEL=deepseek-v4-flash
MARKET_DATA_PROVIDER=ricequant
RICEQUANT_BRIDGE_URL=http://127.0.0.1:8765
RQSDK_LICENSE_KEY=
RQDATA_CONDA_ENV=thesis-keeper-rqdata
RQDATA_VENV=.venv-rqdata
```

DeepSeek 适配器在 `LLM_BASE_URL` 后拼接 `/chat/completions`，模型使用 `deepseek-v4-flash`。旧的 `deepseek-chat` / `deepseek-reasoner` 别名已于 2026-07-24 下线，不要再填。

两处回落规则要记住，它们决定了徽标显示什么：

- `LLM_PROVIDER` 不是 `deepseek`/`remote`，或四个 LLM 变量任一为空 → Thesis Compiler 使用确定性 Fixture Provider，离线闭环仍可跑通。
- `MARKET_DATA_PROVIDER` 不是 `ricequant`，或 `RICEQUANT_BRIDGE_URL` 为空 → 标的搜索使用 Mock Provider。

## RQSDK / RQData 架构边界

RQSDK 跑在独立 Python 环境里，再由本地 Bridge（`services/rqdata_bridge/server.py`）以 HTTP 提供给 TypeScript 应用。Cloudflare 线上环境访问不到你机器上的 Bridge，因此本期仅用于本地运行。

Bridge 覆盖 `metricCatalog` 的全部指标，口径由 `METRIC_SPECS` 声明，必须与 `app/lib/product-domain.ts` 一致：

| metricKey | 单位 | 周期 | RQData 取数 |
|---|---|---|---|
| price_close | CNY | DAY | `get_price(fields=["close"])` |
| turnover | CNY | DAY | `get_price(fields=["total_turnover"])` |
| nav | CNY | DAY | `fund.get_nav(fields="unit_net_value")` |
| premium_discount | PERCENT | DAY | `(收盘价 - 单位净值) / 单位净值`，两条序列按交易日对齐 |
| tracking_error | PERCENT | MONTH | `fund.get_indicators(fields=["y1_tracking_error"])`，按自然月取月末一条 |
| aum | CNY | MONTH | `fund.get_units_change()` 的 `net_asset`（定期报告口径，序列稀疏） |
| revenue_yoy | PERCENT | QUARTER | `get_pit_financials_ex(["revenue"])`，累计口径对上年同一报告期 |
| net_profit_yoy | PERCENT | QUARTER | 同上，字段 `net_profit_parent_company` |
| gross_margin | PERCENT | QUARTER | `gross_profit / revenue` |
| operating_cash_flow | CNY | QUARTER | `cash_flow_from_operating_activities` |

三条口径约定：

- 财务序列走 point-in-time 接口并把 `date` 锚定在查询窗口右端，只返回当时已公告的数据，不引入未来函数。
- 任一输入缺失、上年同期为零或为负时不产生该条观测，交由应用显示 `DATA_MISSING`，绝不填 0 或前值。
- `/metrics` 的 `period` 参数与 `METRIC_SPECS` 不一致时返回 422 `METRIC_PERIOD_MISMATCH`，避免周期错位让连续期规则算出假触发。

`fund` 命名空间由 `rqdatac_fund` 通过 `export_as_api(namespace="fund")` 注册，Bridge 在 `initialize()` 里显式 `import rqdatac_fund`，否则 `from rqdatac import fund` 会 ImportError。

口径测试不需要许可证也不联网（用假 rqdatac 模块注入）：

```bash
npm run rqdata:test
```
