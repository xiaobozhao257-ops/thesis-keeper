# Thesis Keeper

投资决策记忆与复盘系统本地 MVP。用户建立投资论点后，系统按固定的 A 股情境时间线释放证据，使用确定性规则检查失效条件，并冻结最终决策快照。真实密钥仅保存在本地 `.env`，不纳入仓库。

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

## 环境依赖安装

### 1. 基础环境

Windows 本地开发需要：

- Node.js `>= 22.13.0`，安装后用 `node --version` 和 `npm --version` 检查。
- Git，用于克隆和更新代码。
- 64 位 Anaconda 或 Miniconda；安装完成后重新打开 PowerShell，并确认 `conda --version` 可执行。

### 2. 安装前端与服务端依赖

在项目目录执行：

```powershell
npm ci
```

`npm ci` 会严格按照 `package-lock.json` 安装依赖，适合首次安装和可重复构建。如果正在主动升级依赖，再使用 `npm install`。

### 3. 创建本地环境变量

首次克隆项目时复制模板：

```powershell
Copy-Item .env.example .env
```

然后在 `.env` 中填写 DeepSeek API Key 和 RQSDK License Key。`.env` 已被 Git 忽略，不得提交到仓库。

### 4. 安装 RQSDK / RQData

项目使用独立的 Conda 环境 `thesis-keeper-rqdata`，Python 版本为 3.10。执行：

```powershell
npm run rqdata:setup
```

该命令会：

1. 根据 `environment.rqdata.yml` 创建或更新独立 Conda 环境；
2. 安装 RQSDK，RQData 的 `rqdatac` 组件会随 RQSDK 安装；
3. 读取 `.env` 中的 `RQSDK_LICENSE_KEY` 并配置许可证；
4. 运行 `rqdatac` 导入检查。

如果希望由官方命令交互式录入许可证，可改为：

```powershell
conda run -n thesis-keeper-rqdata rqsdk license
conda run -n thesis-keeper-rqdata rqsdk license info
```

### 5. 初始化本地数据库

```powershell
npm run db:generate
```

开发运行时会通过 D1 创建必要表结构；迁移文件用于记录和审查 Schema 变化。

## 本地启动

需要两个 PowerShell 窗口。

窗口一启动 RQData Bridge：

```powershell
npm run rqdata:start
```

窗口二启动 Thesis Keeper：

```powershell
npm run dev
```

访问 `http://localhost:3000`。

可通过下面的命令检查 RQData Bridge：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

## 验证

```powershell
npm run lint
npx tsc --noEmit
npm test
```

`npm test` 会完成生产构建，并检查领域规则和六条主要路由。

完整 P0 不变量、自动化 Gate 和三分钟人工验收见 [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md)。

## 数据边界

未配置密钥时仍可使用虚构 A 股案例及固定 Mock 数据。应用不提供证券推荐、目标价、收益预测或自动交易。

## 外部服务配置

本地 `.env` 已创建并被 Git 忽略。配置项如下，README 和 `.env.example` 中不得出现真实密钥：

```dotenv
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=
LLM_MODEL=deepseek-v4-flash
MARKET_DATA_PROVIDER=ricequant
RICEQUANT_BRIDGE_URL=http://127.0.0.1:8765
RQDATA_CONDA_ENV=thesis-keeper-rqdata
RQSDK_LICENSE_KEY=
```

DeepSeek 适配器会在 `LLM_BASE_URL` 后拼接 `/chat/completions`，并使用官方模型 `deepseek-v4-flash`。
未填写完整的 LLM 配置时，Thesis Compiler 自动使用确定性的 Fixture Provider，保证离线闭环可运行；配置完整后才调用远程模型。

## RQSDK / RQData 架构边界

本项目通过独立 Python 环境运行 RQSDK，再由本地 Bridge 提供给 TypeScript 应用。Cloudflare 线上环境不能访问你电脑上的 Bridge，因此本期仅用于本地运行。

Bridge 当前提供 A 股、ETF、LOF 标的搜索，以及收盘价、成交额和基金净值序列。许可证仍由官方 `rqsdk license` 机制保存和校验。
