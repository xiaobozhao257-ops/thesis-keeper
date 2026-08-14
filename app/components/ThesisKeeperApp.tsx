"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  assumptions,
  BEHAVIOR_MIRROR_MIN_SAMPLE,
  calculateHealth,
  entryBasisTypes,
  impactLabel,
  isWeakEntryBasis,
  metricSeries,
  scenarioEvents,
  stateLabel,
  summarizeBehavior,
  triggerSourceLabel,
  triggerSources,
  type BehaviorMirror,
  type DecisionAction,
  type EvidenceImpact,
} from "../lib/demo-domain";

type View = "portfolio" | "new-thesis" | "thesis" | "evidence" | "review" | "decisions";
type InstrumentSearchResult = { providerSymbol: string; canonicalCode: string; name: string; assetType: "EQUITY" | "ETF" | "LOF"; exchange: string; currency: string };

type ThesisPayload = {
  instrumentName: string;
  canonicalCode: string;
  assetType: "EQUITY" | "ETF" | "LOF";
  inputText: string;
  coreThesis: string;
  horizonMinMonths: number;
  horizonMaxMonths: number;
  confidence: number;
  entryBasis?: { type: string; falsifier: string };
  exitPlan?: string;
  assumptions: Array<{ code: string; title: string; description: string; weight: number }>;
  metrics: Array<{ key: string; name: string; unit: string; period: string; assumptionCode: string }>;
  rules: Array<{ name: string; type: "METRIC_RULE" | "EVIDENCE_RULE"; metricKey?: string; operator?: "LT" | "LTE" | "GT" | "GTE"; threshold?: number; unit?: string; requiredConsecutivePeriods?: number; action: "MUST_REVIEW" | "ATTENTION_ONLY" }>;
  risks: Array<{ title: string; description: string; assumptionCode?: string }>;
  clarificationQuestions: string[];
  fuzzyExpressions: string[];
};

type ThesisVersion = {
  id: string; versionNo: number; status: string; inputText: string; coreThesis: string;
  confidence: number; changeType: string; payload: ThesisPayload | null; createdAt: string; confirmedAt: string | null;
};

type DemoState = {
  session: {
    id: string;
    ownerId: string;
    scenarioId: string;
    currentPoint: number;
    thesisConfirmed: boolean;
    reviewStatus: string;
    updatedAt: string;
  };
  health: ReturnType<typeof calculateHealth>;
  rule: { status: string; current: number; required: number; label: string };
  evidence: Array<{
    id: string;
    eventIndex: number;
    title: string;
    factText: string;
    impact: EvidenceImpact;
    strength: string;
    sourceTitle: string;
    sourcePublisher: string;
    sourceUrl: string | null;
    sourceExcerpt: string;
    sourceLocator: string;
    contentHash: string;
    extractorVersion: string;
    publishedAt: string;
    assumptionCode: string;
    verification: string;
    imported: boolean;
    feedback: string;
  }>;
  snapshots: Array<{
    id: string;
    action: string;
    reason: string;
    confidence: number;
    healthScore: number;
    createdAt: string;
    contentHash: string;
    integrityValid: boolean;
    thesisVersionId: string;
    thesisVersionNo: number;
    evidenceCount: number;
    counterEvidenceCount: number;
    evidence: Array<{ id: string; title: string; impact: string; sourceTitle: string; publishedAt: string; verification: string }>;
    priceSnapshot: { value: number; currency: string; observedAt: string; source: string } | null;
    challengerEvidence: string | null;
    recordType: "PLANNED_REVIEW" | "UNPLANNED_ACTION";
    triggerSource: string | null;
    ruleStatus: string | null;
    assumptionStatus: { total: number; supporting: number; mixed: number; weakened: number } | null;
  }>;
  behavior: BehaviorMirror;
  staleness: { daysSinceLastEvidence: number; penalty: number };
  triggerSources: Array<{ code: string; label: string; note: string }>;
  thesis: ThesisVersion | null;
  reviewThesis: ThesisVersion | null;
  draft: ThesisVersion | null;
  versions: ThesisVersion[];
  reviewEvents: Array<{ id: string; type: string; payload: Record<string, unknown>; createdAt: string }>;
  workflows: Array<{ id: string; module: string; status: string; provider: string; outputSummary: string; errorCode: string | null; latencyMs: number; inputTokens: number; outputTokens: number; estimatedCostCny: number | null; createdAt: string }>;
  providers: {
    llm: { selected: string; configured: boolean };
    marketData: { selected: string; ricequantConfigured: boolean };
  };
};

const initialState: DemoState = {
  session: {
    id: "demo-session-cn-equity-v1",
    ownerId: "local-demo-user",
    scenarioId: "cn-equity-demo-v1",
    currentPoint: 0,
    thesisConfirmed: true,
    reviewStatus: "NONE",
    updatedAt: "2026-02-12T00:00:00Z",
  },
  health: calculateHealth(0),
  rule: { status: "NO_MATCH", current: 0, required: 2, label: "未触发 0/2" },
  evidence: [],
  snapshots: [],
  behavior: summarizeBehavior({ decisions: [], thesisConfirmedAt: null, horizonMinMonths: null, horizonMaxMonths: null }),
  staleness: { daysSinceLastEvidence: 0, penalty: 0 },
  triggerSources: triggerSources.map((item) => ({ ...item })),
  thesis: null,
  reviewThesis: null,
  draft: null,
  versions: [],
  reviewEvents: [],
  workflows: [],
  providers: { llm: { selected: "fixture", configured: false }, marketData: { selected: "mock", ricequantConfigured: false } },
};

const nav = [
  { view: "portfolio", href: "/demo", index: "01", label: "Demo 总览" },
  { view: "new-thesis", href: "/theses/new", index: "02", label: "新建论点" },
  { view: "thesis", href: "/theses/demo-thesis", index: "03", label: "论点详情" },
  { view: "evidence", href: "/evidence", index: "04", label: "证据中心" },
  { view: "review", href: "/reviews/demo-review", index: "05", label: "论点复盘" },
  { view: "decisions", href: "/decisions", index: "06", label: "决策记录" },
] as const;

const actionLabels: Record<Exclude<DecisionAction, "DEFER">, string> = {
  HOLD: "继续持有",
  ADD: "加仓",
  REDUCE: "减仓",
  EXIT: "退出",
};

export function ThesisKeeperApp({ view }: { view: View }) {
  const [data, setData] = useState<DemoState>(initialState);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadState();
  }, []);

  async function loadState() {
    try {
      const response = await fetch("/api/v1/demo", { cache: "no-store" });
      const payload = await response.json() as { data: DemoState; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "加载失败");
      setData(payload.data);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function mutate(body: Record<string, unknown>, label: string) {
    setPending(label);
    setError(null);
    try {
      const response = await fetch("/api/v1/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { data: DemoState; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
      setData(payload.data);
      return true;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "操作失败");
      return false;
    } finally {
      setPending(null);
    }
  }

  async function advance() {
    await mutate({ action: "advance", expectedCurrentPoint: data.session.currentPoint }, "advance");
  }

  async function reset() {
    await mutate({ action: "reset" }, "reset");
  }

  const statusClass = data.health.status.toLowerCase().replace("_", "-");
  const currentEvent = scenarioEvents[Math.min(data.session.currentPoint, 6)];

  return (
    <div className="app-frame">
      <aside className="side-rail">
        <Link className="brand" href="/demo" aria-label="Thesis Keeper Demo 首页">
          <span className="brand-mark">TK</span>
          <span><strong>THESIS</strong><strong>KEEPER</strong></span>
        </Link>

        <div className="case-chip">
          <span className="case-dot" />
          <div><small>{data.session.scenarioId === "cn-fund-empty-v1" ? "基金空模板" : "演示案例"}</small><strong>{data.session.scenarioId === "cn-fund-empty-v1" ? "ETF / LOF" : "华星智算"}</strong><span>{data.session.scenarioId === "cn-fund-empty-v1" ? "等待接入真实数据" : "虚构 A 股标的"}</span></div>
        </div>

        <nav aria-label="主要导航">
          {nav.map((item) => (
            <Link className={`nav-item ${view === item.view ? "active" : ""}`} href={item.href} key={item.view}>
              <span>{item.index}</span>{item.label}
              {item.view === "review" && data.health.status === "MUST_REVIEW" ? <i>1</i> : null}
            </Link>
          ))}
        </nav>

        <div className="rail-note">
          <span>Scenario</span>
          <strong>{currentEvent.point} / T6</strong>
          <div className="rail-progress"><i style={{ width: `${(data.session.currentPoint / 6) * 100}%` }} /></div>
          <small>数据固定 · 可重复演示</small>
        </div>
      </aside>

      <main className="main-canvas">
        <header className="topbar">
          <div>
            <span className="eyebrow">DECISION MEMORY / CN MARKET</span>
            <h1>{nav.find((item) => item.view === view)?.label}</h1>
          </div>
          <div className="top-actions">
            <span className={`status-pill ${statusClass}`}><i />{stateLabel(data.health.status)}</span>
            <button className="text-button" disabled={pending !== null} onClick={reset}>重置演示</button>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <strong>数据连接未完成</strong><span>{error}</span><button onClick={loadState}>重新加载</button>
          </div>
        ) : null}

        {loading ? <div className="loading-line" role="status"><i />正在读取决策记忆…</div> : null}

        {!error && view === "portfolio" ? <PortfolioView data={data} advance={advance} mutate={mutate} pending={pending} /> : null}
        {!error && view === "new-thesis" ? <NewThesisView data={data} mutate={mutate} pending={pending} /> : null}
        {!error && view === "thesis" ? <ThesisView data={data} mutate={mutate} pending={pending} /> : null}
        {!error && view === "evidence" ? <EvidenceView data={data} mutate={mutate} advance={advance} pending={pending} /> : null}
        {!error && view === "review" ? <ReviewView data={data} mutate={mutate} advance={advance} pending={pending} /> : null}
        {!error && view === "decisions" ? <DecisionsView data={data} /> : null}

        <footer className="app-footer">
          <span>THESIS KEEPER / V1 DEMO</span>
          <p>用于记录和复盘用户自己的投资逻辑，不构成证券分析、投资建议、收益承诺或交易指令。</p>
        </footer>
      </main>
    </div>
  );
}

function PortfolioView({ data, advance, mutate, pending }: { data: DemoState; advance: () => Promise<void>; mutate: (body: Record<string, unknown>, label: string) => Promise<boolean>; pending: string | null }) {
  const event = scenarioEvents[Math.min(data.session.currentPoint, 6)];
  const nextEvent = scenarioEvents[Math.min(data.session.currentPoint + 1, 6)];
  const health = data.health;
  const breakdown = [
    ["指标偏离", health.breakdown.metricPenalty, 30],
    ["反方证据", health.breakdown.evidencePenalty, 20],
    ["规则触发", health.breakdown.triggerPenalty, 40],
    ["数据时效", health.breakdown.stalenessPenalty, 10],
  ] as const;
  const integrationStrip = (
    <section className="integration-strip">
      <div><span>数据场景</span><button className={data.session.scenarioId === "cn-equity-demo-v1" ? "active" : ""} onClick={() => mutate({ action: "set-scenario", scenarioId: "cn-equity-demo-v1" }, "scenario")}>A 股离线样例</button><button className={data.session.scenarioId === "cn-fund-empty-v1" ? "active" : ""} onClick={() => mutate({ action: "set-scenario", scenarioId: "cn-fund-empty-v1" }, "scenario")}>ETF / LOF 空模板</button></div>
      <div className="provider-badges"><span>LLM {data.providers.llm.configured ? "已配置" : "Fixture"}</span><span>行情 {data.providers.marketData.ricequantConfigured ? "Ricequant" : "Mock / 待接入"}</span></div>
    </section>
  );

  if (data.session.scenarioId === "cn-fund-empty-v1") {
    return (
      <div className="page-stack">
        {integrationStrip}
        <EmptyState title="ETF / LOF 模板尚未建立论点" body="当前没有基金、指标或证据数据，因此不会沿用 A 股案例的 Health 与 Trigger。先创建基金论点，再接入适用的 NAV、溢折价、跟踪误差和流动性指标。" actionHref="/theses/new" actionLabel="创建基金论点" />
        <section className="metric-row">
          <MetricStat label="关键指标" value="DATA_MISSING" note="没有 Observation，不等同于恶化" />
          <MetricStat label="失效条件" value="未计算" note="空数据不能触发规则" />
          <MetricStat label="相关证据" value="0 条" note="未继承 A 股案例证据" />
          <MetricStat label="产品范围" value="ETF / LOF" note="仅支持场内基金" />
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      {integrationStrip}
      <section className="lead-grid">
        <article className="thesis-hero">
          <div className="hero-meta"><span>CN · DEMO 01</span><span>Thesis V1 · 2026/02/12</span></div>
          <div className="hero-title-row">
            <div><span className="instrument-type">{data.session.scenarioId === "cn-fund-empty-v1" ? "ETF / LOF · 空配置" : "A 股 · 虚构案例"}</span><h2>{data.session.scenarioId === "cn-fund-empty-v1" ? "等待选择基金" : "华星智算"}</h2><p>{data.thesis?.coreThesis ?? "国内算力基础设施投入将继续驱动公司的中期增长。"}</p></div>
            <div className={`health-orb ${health.status.toLowerCase()}`}><strong>{health.score}</strong><span>/ 100</span></div>
          </div>
          <div className="health-breakdown">
            {breakdown.map(([label, value, max]) => (
              <div key={label}><span>{label}<b>-{value}</b></span><div><i style={{ width: `${(value / max) * 100}%` }} /></div></div>
            ))}
          </div>
          <div className="hero-foot">
            <span>当前节点 <strong>{event.point}</strong> · {event.title}</span>
            <Link href="/theses/demo-thesis">查看论点全貌 →</Link>
          </div>
        </article>

        <aside className="next-action-card">
          <span className="section-number">NEXT / {nextEvent.point}</span>
          <h3>{data.session.currentPoint >= 6 ? "演示闭环已完成" : nextEvent.title}</h3>
          <p>{data.session.currentPoint >= 6 ? "你已经冻结了一次完整的决策环境。可前往决策记录复查，或重置后重新演示。" : nextEvent.detail}</p>
          {data.session.currentPoint < 6 ? (
            <button className="primary-button" onClick={advance} disabled={pending !== null}>
              {pending === "advance" ? "正在释放…" : `进入 ${nextEvent.point}`}
            </button>
          ) : <Link className="primary-button link-button" href="/decisions">查看决策快照</Link>}
          <small>只有到达当前节点的数据会被释放，避免未来函数。</small>
        </aside>
      </section>

      <section className="metric-row">
        <MetricStat label="关键指标" value={data.session.currentPoint >= 5 ? "17%" : data.session.currentPoint >= 4 ? "19%" : data.session.currentPoint >= 1 ? "31%" : "—"} note="收入同比增速" />
        <MetricStat label="失效条件" value={data.rule.label} note="连续两季度 <20%" tone={data.rule.status === "TRIGGERED" ? "danger" : ""} />
        <MetricStat label="相关证据" value={`${data.evidence.length} 条`} note={`${data.evidence.filter((item) => item.impact !== "SUPPORT").length} 条反方信号`} />
        <MetricStat
          label="证据时效"
          value={`${data.staleness.daysSinceLastEvidence} 天`}
          note={data.staleness.penalty ? `距上次新事实已久，健康度已扣 ${data.staleness.penalty} 分` : "距上次有新事实进入这个论点"}
          tone={data.staleness.penalty ? "danger" : ""}
        />
      </section>

      <section className="section-block">
        <SectionHeading index="01" title="假设树" subtitle="不是看涨跌，而是看支撑这项判断的条件是否仍成立。" />
        <div className="assumption-grid">
          {assumptions.map((item, index) => {
            const state = item.stateAt[Math.min(data.session.currentPoint, 5)];
            return (
              <article className="assumption-card" key={item.code}>
                <div><span>{item.code}</span><i className={`signal ${state === "支持" ? "positive" : state === "混合" ? "mixed" : "negative"}`} />{state}</div>
                <h3>{item.title}</h3><p>{item.detail}</p>
                <small>{index === 0 ? "权重 40%" : index === 1 ? "权重 35%" : "权重 25%"}</small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section-block">
        <SectionHeading index="02" title="情境时间线" subtitle="固定数据按时间点释放；规则结果可以被精确重放。" />
        <div className="scenario-timeline">
          {scenarioEvents.map((item, index) => (
            <div className={`${index <= data.session.currentPoint ? "reached" : ""} ${index === data.session.currentPoint ? "current" : ""}`} key={item.point}>
              <span>{item.point}</span><i /><small>{item.kicker}</small><strong>{item.title}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="section-block">
        <SectionHeading index="03" title="计划外行动" subtitle="不用等规则触发也能记录。系统不阻止任何操作，只把你声明的理由和真正推动这次操作的因素并排存下来。" />
        <UnplannedActionPanel data={data} mutate={mutate} pending={pending} />
      </section>
    </div>
  );
}

function NewThesisView({ data, mutate, pending }: { data: DemoState; mutate: (body: Record<string, unknown>, label: string) => Promise<boolean>; pending: string | null }) {
  const [reason, setReason] = useState(data.draft?.inputText || "我认为国内算力基础设施投入会持续增长，公司在核心客户中有较强的产品优势。只要收入增速和盈利质量没有明显恶化，我愿意持有 12 到 24 个月。");
  const [entryBasisType, setEntryBasisType] = useState<string>("FUNDAMENTAL_CHANGE");
  const [falsifier, setFalsifier] = useState("");
  const [exitPlan, setExitPlan] = useState("");
  const [instrumentName, setInstrumentName] = useState("华星智算");
  const [canonicalCode, setCanonicalCode] = useState("688888.XSHG");
  const [assetType, setAssetType] = useState<"EQUITY" | "ETF" | "LOF">("EQUITY");
  const [confidence, setConfidence] = useState(80);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [instrumentResults, setInstrumentResults] = useState<InstrumentSearchResult[]>([]);
  const [instrumentSearchState, setInstrumentSearchState] = useState<"IDLE" | "SEARCHING" | "DONE" | "ERROR">("IDLE");

  async function searchInstruments() {
    if (instrumentQuery.trim().length < 2) return;
    setInstrumentSearchState("SEARCHING");
    try {
      const response = await fetch(`/api/v1/instruments?query=${encodeURIComponent(instrumentQuery.trim())}`);
      const result = await response.json() as { data?: InstrumentSearchResult[]; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "搜索失败");
      setInstrumentResults(result.data ?? []);
      setInstrumentSearchState("DONE");
    } catch {
      setInstrumentResults([]);
      setInstrumentSearchState("ERROR");
    }
  }

  function chooseInstrument(instrument: InstrumentSearchResult) {
    setInstrumentName(instrument.name);
    setCanonicalCode(instrument.canonicalCode);
    setAssetType(instrument.assetType);
    setInstrumentResults([]);
    setInstrumentSearchState("IDLE");
  }

  async function compile() {
    await mutate({
      action: "compile-draft", instrumentName, canonicalCode, assetType, inputText: reason,
      horizonMinMonths: 12, horizonMaxMonths: 24, confidence,
      entryBasis: { type: entryBasisType, falsifier },
      exitPlan: exitPlan.trim() || undefined,
    }, "compile");
  }

  const weakBasis = isWeakEntryBasis(entryBasisType);
  const basisBlocked = weakBasis && falsifier.trim().length < 8;

  const payload = data.draft?.payload;

  return (
    <div className="page-stack narrow-page">
      <section className="editor-intro">
        <span className="section-number">THESIS COMPILER / DRAFT</span>
        <h2>先说人话，再建立规则。</h2>
        <p>不需要填写十几个金融表单。系统先理解你的判断，再指出哪些表达还不能被监控。</p>
      </section>

      <section className="editor-card">
        <div className="instrument-search">
          <label>搜索 A 股 / ETF / LOF<input value={instrumentQuery} onChange={(event) => setInstrumentQuery(event.target.value)} placeholder="输入代码、名称或拼音缩写" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchInstruments(); } }} /></label>
          <button className="secondary-button" type="button" onClick={searchInstruments} disabled={instrumentSearchState === "SEARCHING" || instrumentQuery.trim().length < 2}>{instrumentSearchState === "SEARCHING" ? "搜索中…" : "搜索标的"}</button>
          {instrumentSearchState === "ERROR" ? <small>数据源暂不可用，可继续手工填写下方字段。</small> : null}
          {instrumentSearchState === "DONE" && !instrumentResults.length ? <small>未找到 P0 支持的境内交易所标的。</small> : null}
          {instrumentResults.length ? <div>{instrumentResults.map((instrument) => <button type="button" onClick={() => chooseInstrument(instrument)} key={instrument.providerSymbol}><strong>{instrument.name}</strong><span>{instrument.canonicalCode} · {instrument.assetType}</span></button>)}</div> : null}
        </div>
        <div className="field-grid">
          <label>资产类型<select value={assetType} onChange={(event) => setAssetType(event.target.value as typeof assetType)}><option value="EQUITY">A 股</option><option value="ETF">ETF</option><option value="LOF">LOF</option></select></label>
          <label>标的名称<input value={instrumentName} onChange={(event) => setInstrumentName(event.target.value)} /></label>
          <label>规范代码<input value={canonicalCode} onChange={(event) => setCanonicalCode(event.target.value)} placeholder="如 510300.XSHG" /></label>
          <label>原始置信度<input type="number" min="0" max="100" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /></label>
        </div>
        <label htmlFor="thesis-reason">为什么你想投资这家公司？</label>
        <textarea id="thesis-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="entry-discipline">
          <span className="section-number">ENTRY DISCIPLINE</span>
          <label htmlFor="entry-basis">这次买入，最主要的依据是什么？</label>
          <select id="entry-basis" value={entryBasisType} onChange={(event) => setEntryBasisType(event.target.value)}>
            {entryBasisTypes.map((item) => <option value={item.code} key={item.code}>{item.label}{item.weak ? "（弱依据）" : ""}</option>)}
          </select>
          <small>{entryBasisTypes.find((item) => item.code === entryBasisType)?.note}</small>
          {weakBasis ? (
            <div className="challenger">
              <span>WEAK BASIS</span>
              <strong>价格动量、消息和他人推荐都无法被检验，所以必须先写下判错的条件。</strong>
              <p>补一句“若某件事到某个时点仍未发生，说明我判断错了”。这句话会和论点一起冻结，之后不能改。</p>
              <textarea aria-label="可被证伪的表述" value={falsifier} onChange={(event) => setFalsifier(event.target.value)} placeholder="例：若到 2026 年底该客户订单仍未落地，说明我判断错了" />
            </div>
          ) : null}
          <label htmlFor="exit-plan">你打算在什么情况下卖出？</label>
          <textarea id="exit-plan" value={exitPlan} onChange={(event) => setExitPlan(event.target.value)} placeholder="这是你自己写下的计划，不是系统给出的建议。可以留空。" />
        </div>
        <div className="editor-toolbar"><span>{reason.length} 字 · 预计周期 12–24 个月</span><button className="secondary-button" onClick={compile} disabled={pending !== null || basisBlocked}>{pending === "compile" ? "结构化中…" : basisBlocked ? "请先写下判错的条件" : "生成结构化草稿"}</button></div>
      </section>

      {payload ? (
        <>
          {payload.clarificationQuestions.length ? <div className="compiler-warning"><span>需要说清楚</span><strong>{payload.clarificationQuestions[0]}</strong><p>本期编译器采用可复现的离线规则；配置 LLM 后可替换为远程结构化输出。</p></div> : null}
          <DraftEditor key={data.draft?.id} payload={payload} versions={data.versions} mutate={mutate} pending={pending} />
        </>
      ) : <EmptyState title="还没有结构化草稿" body="填写标的与自然语言论点，然后生成可确认的草稿。" />}
    </div>
  );
}

function DraftEditor({ payload, versions, mutate, pending }: { payload: ThesisPayload; versions: ThesisVersion[]; mutate: (body: Record<string, unknown>, label: string) => Promise<boolean>; pending: string | null }) {
  const [draft, setDraft] = useState(payload);
  const weightTotal = draft.assumptions.reduce((sum, item) => sum + item.weight, 0);

  function patchAssumption(index: number, patch: Partial<ThesisPayload["assumptions"][number]>) {
    setDraft((current) => ({ ...current, assumptions: current.assumptions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  }

  function patchMetric(index: number, patch: Partial<ThesisPayload["metrics"][number]>) {
    setDraft((current) => ({ ...current, metrics: current.metrics.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  }

  function patchRule(index: number, patch: Partial<ThesisPayload["rules"][number]>) {
    setDraft((current) => ({ ...current, rules: current.rules.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  }

  async function save(confirmAfter = false) {
    const saved = await mutate({ action: "update-draft", payload: draft }, "save-draft");
    if (!saved || !confirmAfter) return;
    const confirmed = await mutate({ action: "confirm-draft" }, "confirm");
    if (confirmed) window.location.href = "/theses/demo-thesis";
  }

  return (
    <>
      <section className="draft-editor-panel">
        <div className="draft-editor-head"><div><span className="section-number">EDITABLE DRAFT</span><h2>校正结构化结果</h2><p>确认前可以修改核心论点、假设、监控指标和失效规则。</p></div><span className={Math.abs(weightTotal - 1) < 0.0001 ? "valid-weight" : "invalid-weight"}>假设权重 {(weightTotal * 100).toFixed(0)}%</span></div>
        <label>核心论点<textarea value={draft.coreThesis} onChange={(event) => setDraft({ ...draft, coreThesis: event.target.value })} /></label>
        {draft.entryBasis || draft.exitPlan ? (
          <div className="draft-list"><strong>建仓纪律</strong><article>
            {draft.entryBasis ? <label>买入依据<input value={`${entryBasisTypes.find((item) => item.code === draft.entryBasis?.type)?.label ?? draft.entryBasis.type}${isWeakEntryBasis(draft.entryBasis.type) ? "（弱依据）" : ""}`} readOnly title="买入依据在冻结前决定，之后不可改写" /></label> : null}
            {draft.entryBasis?.falsifier ? <label>判错条件<input value={draft.entryBasis.falsifier} onChange={(event) => setDraft({ ...draft, entryBasis: { type: draft.entryBasis!.type, falsifier: event.target.value } })} /></label> : null}
            {draft.exitPlan ? <label>退出计划<input value={draft.exitPlan} onChange={(event) => setDraft({ ...draft, exitPlan: event.target.value })} /></label> : null}
          </article></div>
        ) : null}
        <div className="draft-list"><strong>关键假设</strong>{draft.assumptions.map((item, index) => <article key={item.code}><span>{item.code}</span><label>标题<input value={item.title} onChange={(event) => patchAssumption(index, { title: event.target.value })} /></label><label>说明<input value={item.description} onChange={(event) => patchAssumption(index, { description: event.target.value })} /></label><label>权重<input type="number" min="0" max="1" step="0.05" value={item.weight} onChange={(event) => patchAssumption(index, { weight: Number(event.target.value) })} /></label></article>)}</div>
        <div className="draft-list"><strong>监控指标</strong>{draft.metrics.map((item, index) => <article key={item.key}><span>{item.key}</span><label>名称<input value={item.name} onChange={(event) => patchMetric(index, { name: event.target.value })} /></label><label>关联假设<select value={item.assumptionCode} onChange={(event) => patchMetric(index, { assumptionCode: event.target.value })}>{draft.assumptions.map((assumption) => <option key={assumption.code}>{assumption.code}</option>)}</select></label><label>周期<input value={item.period} readOnly title="指标周期由 Catalog 固定" /></label></article>)}</div>
        <div className="draft-list"><strong>失效规则</strong>{draft.rules.map((item, index) => <article key={`${item.type}-${index}`}><span>{item.type}</span><label>规则名称<input value={item.name} onChange={(event) => patchRule(index, { name: event.target.value })} /></label><label>阈值<input type="number" value={item.threshold ?? ""} onChange={(event) => patchRule(index, { threshold: Number(event.target.value) })} /></label><label>连续周期<input type="number" min="1" max="12" value={item.requiredConsecutivePeriods ?? 1} onChange={(event) => patchRule(index, { requiredConsecutivePeriods: Number(event.target.value) })} /></label></article>)}</div>
        <div className="draft-save-row"><span>保存时会校验资产指标 Catalog、假设关联、规则单位与权重总和。</span><button className="secondary-button" onClick={() => save(false)} disabled={pending !== null || Math.abs(weightTotal - 1) >= 0.0001}>{pending === "save-draft" ? "校验保存中…" : "保存草稿修改"}</button></div>
      </section>
      <div className="confirm-bar"><div><strong>确认后冻结为下一版本</strong><span>旧版本会保留为 SUPERSEDED，不能覆盖。</span></div><button className="primary-button" onClick={() => save(true)} disabled={pending !== null || Math.abs(weightTotal - 1) >= 0.0001}>{pending === "confirm" || pending === "save-draft" ? "正在校验并冻结…" : `确认并创建 V${Math.max(1, ...versions.map((item) => item.versionNo)) + 1}`}</button></div>
    </>
  );
}

function ThesisView({ data, mutate, pending }: { data: DemoState; mutate: (body: Record<string, unknown>, label: string) => Promise<boolean>; pending: string | null }) {
  const visibleMetrics = metricSeries.filter((_, index) => (index === 0 && data.session.currentPoint >= 1) || (index === 1 && data.session.currentPoint >= 4) || (index === 2 && data.session.currentPoint >= 5));
  const active = data.thesis;
  const activeAssumptions = active?.payload?.assumptions ?? assumptions.map((item, index) => ({ code: item.code, title: item.title, description: item.detail, weight: [40, 35, 25][index] }));
  async function createV2() {
    const ok = await mutate({ action: "create-version-draft" }, "version");
    if (ok) window.location.href = "/theses/new";
  }
  if (data.session.scenarioId === "cn-fund-empty-v1") {
    return <div className="page-stack"><EmptyState title="尚无基金论点详情" body="空模板不会展示 A 股的假设、收入指标或 Trigger。创建并确认 ETF / LOF 论点后，适用的基金指标才会出现在这里。" actionHref="/theses/new" actionLabel="创建基金论点" /></div>;
  }
  return (
    <div className="page-stack">
      <section className="detail-head">
        <div><span className="section-number">ACTIVE / VERSION {active?.versionNo ?? 1}</span><h2>{active?.coreThesis ?? "国内算力基础设施投入将继续驱动公司的中期增长"}</h2><p>当前版本 · 预期周期 12–24 个月 · {active?.confirmedAt ? new Date(active.confirmedAt).toLocaleDateString("zh-CN") : "离线样例"}</p></div>
        <div className={`score-lock ${data.health.status.toLowerCase()}`}><span>当前健康度</span><strong>{data.health.score}</strong><small>{stateLabel(data.health.status)}</small></div>
      </section>

      <section className="detail-columns">
        <div className="detail-main">
          <SectionHeading index="A" title="核心假设" subtitle="每条证据必须落到具体假设，而不是泛泛影响整只股票。" />
          <div className="assumption-list">
            {activeAssumptions.map((item, index) => {
              const fixture = assumptions[index] ?? assumptions[0];
              const state = fixture.stateAt[Math.min(data.session.currentPoint, 5)];
              return <article key={item.code}><span>{item.code}</span><div><h3>{item.title}</h3><p>{item.description}</p></div><b className={state === "支持" ? "positive-text" : state === "混合" ? "mixed-text" : "negative-text"}>{state}</b></article>;
            })}
          </div>

          <SectionHeading index="B" title="指标时间序列" subtitle="当前 Demo 仅释放到当前 Scenario 节点。" />
          <div className="metric-chart" aria-label="收入增速时间序列">
            <div className="threshold-line"><span>失效阈值 20%</span></div>
            {visibleMetrics.length ? visibleMetrics.map((item) => <div key={item.label}><i style={{ height: `${item.value * 4}px` }} className={item.value < 20 ? "below" : ""} /><strong>{item.value}%</strong><span>{item.label}</span></div>) : <p>推进到 T1 后显示首期指标。</p>}
          </div>
        </div>
        <aside className="detail-aside">
          <div className="rule-card"><span>CRITICAL METRIC RULE</span><h3>连续两个季度<br />收入增速 &lt;20%</h3><div className="rule-progress"><i style={{ width: `${(data.rule.current / data.rule.required) * 100}%` }} /></div><strong>{data.rule.label}</strong><p>由 TypeScript 规则引擎确定计算，LLM 不能改变正式状态。</p></div>
          <div className="version-card"><span>版本记录</span>{data.versions.filter((item) => item.versionNo > 0).map((item) => <details key={item.id}><summary><b>V{item.versionNo}</b><strong>{item.status === "ACTIVE" ? "当前版本" : "历史版本"}</strong></summary><small>{new Date(item.confirmedAt ?? item.createdAt).toLocaleDateString("zh-CN")} · {item.changeType}</small><p>{item.coreThesis}</p></details>)}<button className="secondary-button" onClick={createV2} disabled={pending !== null}>{pending === "version" ? "创建中…" : "创建下一版本草稿"}</button></div>
        </aside>
      </section>
      {data.versions.filter((item) => item.versionNo > 0).length > 1 ? <section className="version-compare"><SectionHeading index="Δ" title="版本对比" subtitle="冻结版本之间的核心判断与置信度差异。" />{data.versions.filter((item) => item.versionNo > 0).slice(0, 2).map((item) => <article key={item.id}><span>V{item.versionNo} · {item.status}</span><h3>{item.coreThesis}</h3><p>置信度 {item.confidence}% · 假设 {item.payload?.assumptions.length ?? 0} 条 · 规则 {item.payload?.rules.length ?? 0} 条</p></article>)}</section> : null}
    </div>
  );
}

function EvidenceView({ data, mutate, advance, pending }: { data: DemoState; mutate: (body: Record<string, unknown>, label: string) => Promise<boolean>; advance: () => Promise<void>; pending: string | null }) {
  const [filter, setFilter] = useState<"ALL" | EvidenceImpact>("ALL");
  const [assumptionFilter, setAssumptionFilter] = useState("ALL");
  const [verificationFilter, setVerificationFilter] = useState("ALL");
  const [format, setFormat] = useState<"TEXT" | "JSON" | "CSV">("TEXT");
  const [title, setTitle] = useState("手工调研记录");
  const [publisher, setPublisher] = useState("用户录入");
  const [publishedAt, setPublishedAt] = useState(new Date().toISOString().slice(0, 10));
  const [content, setContent] = useState("");
  const assumptionOptions = useMemo(() => Array.from(new Set([
    ...(data.thesis?.payload?.assumptions.map((item) => item.code) ?? []),
    ...data.evidence.map((item) => item.assumptionCode),
  ])), [data.thesis, data.evidence]);
  const visible = useMemo(() => data.evidence.filter((item) =>
    (filter === "ALL" || item.impact === filter)
    && (assumptionFilter === "ALL" || item.assumptionCode === assumptionFilter)
    && (verificationFilter === "ALL" || item.verification === verificationFilter)
  ), [data.evidence, filter, assumptionFilter, verificationFilter]);

  async function importFacts(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "import-evidence", format, title, publisher, publishedAt, sourceUrl: "", content }, "import");
    if (ok) setContent("");
  }

  async function feedback(evidenceId: string, value: "ACCEPTED" | "REJECTED" | "REASSIGNED", assumptionCode?: string) {
    const reason = value === "REJECTED"
      ? "用户认为该解读不足以影响当前论点"
      : value === "REASSIGNED" ? `用户确认该证据应映射至 ${assumptionCode}` : "用户确认当前证据映射";
    await mutate({ action: "evidence-feedback", evidenceId, feedback: value, assumptionCode, reason }, `feedback:${evidenceId}`);
  }
  if (data.session.scenarioId === "cn-fund-empty-v1") {
    return <div className="page-stack"><EmptyState title="尚无可映射的基金证据" body="请先创建并确认 ETF / LOF 论点。没有目标假设时，系统不会把资料错误映射到 A 股案例。" actionHref="/theses/new" actionLabel="创建基金论点" /></div>;
  }
  return (
    <div className="page-stack">
      <section className="evidence-lead"><div><span className="section-number">EVIDENCE, NOT NEWS</span><h2>{data.evidence.length ? `已从当前信息中筛出 ${data.evidence.length} 条论点相关事实。` : "当前还没有释放与论点相关的新事实。"}</h2><p>每条卡片严格分为可追溯的 FACT 和可以被质疑的 AI 解读。</p></div>{data.session.currentPoint < 5 ? <button className="primary-button" onClick={advance} disabled={pending !== null}>释放下一节点</button> : null}</section>
      <form className="import-panel" onSubmit={importFacts}>
        <div><span className="section-number">IMPORT / TEXT · JSON · CSV</span><h3>导入外部证据</h3><p>原文、来源元数据与内容哈希都会保存；自动抽取结果默认标记为未核验。</p></div>
        <div className="field-grid"><label>格式<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option>TEXT</option><option>JSON</option><option>CSV</option></select></label><label>资料标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>发布方<input value={publisher} onChange={(event) => setPublisher(event.target.value)} /></label><label>发布日期<input type="date" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /></label></div>
        <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder={format === "JSON" ? '[{"title":"事实标题","factText":"事实内容","assumptionCode":"A1"}]' : format === "CSV" ? "title,factText,assumptionCode,impact\n订单变化,订单同比下降,A1,WEAKEN" : "粘贴一条或多条事实，每行会成为一条候选证据。"} />
        <button className="secondary-button" disabled={pending !== null || content.trim().length < 3}>{pending === "import" ? "导入中…" : "导入并去重"}</button>
      </form>
      <div className="filter-row">
        {(["ALL", "SUPPORT", "WEAKEN", "CONTRADICT"] as const).map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item === "ALL" ? "全部" : impactLabel(item)}</button>)}
        <label>假设<select value={assumptionFilter} onChange={(event) => setAssumptionFilter(event.target.value)}><option value="ALL">全部</option>{assumptionOptions.map((code) => <option value={code} key={code}>{code}</option>)}</select></label>
        <label>核验<select value={verificationFilter} onChange={(event) => setVerificationFilter(event.target.value)}><option value="ALL">全部</option><option value="VERIFIED">已核验</option><option value="UNVERIFIED">待核验</option><option value="REJECTED">已拒绝</option></select></label>
      </div>
      <section className="evidence-list">
        {visible.length ? visible.map((item) => (
          <article className="evidence-card" key={item.id}>
            <div className="evidence-index">E{String(item.eventIndex).padStart(2, "0")}</div>
            <div className="fact-layer"><span>FACT / {item.verification === "VERIFIED" ? "已核验来源" : item.verification === "REJECTED" ? "已拒绝" : "待人工核验"}</span><h3>{item.title}</h3><p>{item.factText}</p><small>{item.sourcePublisher} · {item.sourceTitle} · {new Date(item.publishedAt).toLocaleDateString("zh-CN")}<br />定位：{item.sourceLocator} · 抽取：{item.extractorVersion}<br />SHA-256：{item.contentHash.slice(0, 16)}…{item.sourceUrl ? <><br />URL：{item.sourceUrl}</> : null}</small></div>
            <div className={`interpret-layer ${item.impact.toLowerCase()}`}><span>{item.imported ? "离线抽取解读" : "AI 解读"}</span><strong>{impactLabel(item.impact)} · {item.strength === "STRONG" ? "强" : "中等"}</strong><p>当前映射 {item.assumptionCode}；正式规则状态只由可验证指标计算。</p><div><button className={item.feedback === "ACCEPTED" ? "selected" : ""} onClick={() => feedback(item.id, "ACCEPTED")} disabled={pending !== null}>接受</button><button className={item.feedback === "REJECTED" ? "selected" : ""} onClick={() => feedback(item.id, "REJECTED")} disabled={pending !== null}>质疑</button>{(() => { const target = assumptionOptions.find((code) => code !== item.assumptionCode); return <button className={item.feedback === "REASSIGNED" ? "selected" : ""} onClick={() => feedback(item.id, "REASSIGNED", target)} disabled={pending !== null || !target}>改映射</button>; })()}</div></div>
          </article>
        )) : <EmptyState title="没有符合筛选条件的证据" body="推进情境时间线，或切换其他证据类型。" />}
      </section>
    </div>
  );
}

function ReviewView({ data, mutate, advance, pending }: { data: DemoState; mutate: (body: Record<string, unknown>, label: string) => Promise<boolean>; advance: () => Promise<void>; pending: string | null }) {
  const [action, setAction] = useState<Exclude<DecisionAction, "DEFER">>("HOLD");
  const [reason, setReason] = useState("行业总需求仍有支撑，但竞争风险和收入增速变化需要持续观察。");
  const [confidence, setConfidence] = useState(60);
  const [challengerEvidence, setChallengerEvidence] = useState("");
  const [deferText, setDeferText] = useState("等待下一期客户份额和毛利率数据");
  const [deferredUntil, setDeferredUntil] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 14); return date.toISOString().slice(0, 10); });
  const [disputeReason, setDisputeReason] = useState("当前指标口径与 T0 记录不一致，需要人工复核数据来源。");
  const canReview = data.session.currentPoint >= 5;
  const thenThesis = data.reviewThesis ?? data.thesis;
  const reviewNeedsEvidence = data.session.reviewStatus === "DEFERRED";

  async function submitDecision(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "decision", decisionAction: action, reason, confidence, challengerEvidence: action === "ADD" ? challengerEvidence : undefined }, "decision");
    if (ok) window.location.href = "/decisions";
  }

  async function defer() {
    await mutate({ action: "defer", requestedEvidence: deferText, deferredUntil }, "defer");
  }

  async function dispute() { await mutate({ action: "dispute-trigger", reason: disputeReason }, "dispute"); }
  async function dismiss() { await mutate({ action: "dismiss-review", reason: disputeReason }, "dismiss"); }

  if (data.session.scenarioId === "cn-fund-empty-v1") {
    return <div className="page-stack"><EmptyState title="没有待复盘的基金论点" body="空数据不会触发复盘。先创建基金论点并接入适用指标，系统才会根据确定性规则打开 Review。" actionHref="/theses/new" actionLabel="创建基金论点" /></div>;
  }

  if (!canReview) {
    return <div className="locked-review"><span>REVIEW LOCKED</span><h2>原始规则尚未正式触发。</h2><p>当前位于 {scenarioEvents[data.session.currentPoint].point}。推进到 T5 后，系统会用确定性规则打开复盘，而不是由 LLM 随意决定。</p><button className="primary-button" onClick={advance} disabled={pending !== null}>推进下一节点</button></div>;
  }

  return (
    <form className="page-stack" onSubmit={submitDecision}>
      <section className="review-alert"><span>{data.rule.status === "DISPUTED" ? "TRIGGER DISPUTED" : "MUST REVIEW / 2 OF 2"}</span><h2>{data.rule.status === "DISPUTED" ? "你已提出口径异议，规则保留但暂降为关注。" : "你的一个失效条件已经正式触发。"}</h2><p>收入增速连续两个季度低于 20%。系统不会替你做交易决定，但会要求你正面回应当时的规则。</p></section>
      {reviewNeedsEvidence ? <div className="compiler-warning"><span>REVIEW DEFERRED</span><strong>请先补充你要求的新证据</strong><p>补充证据并完成核验后，复盘会重新进入 OPEN；在此之前不能冻结最终决定。</p></div> : null}
      <section className="then-now">
        <article className="then"><span>THEN · Thesis V{thenThesis?.versionNo ?? 1}</span><h3>触发时冻结的你</h3><dl><div><dt>核心判断</dt><dd>{thenThesis?.coreThesis ?? "算力投入持续驱动增长"}</dd></div><div><dt>监控指标</dt><dd>{thenThesis?.payload?.metrics[0]?.name ?? "营业收入同比增速"}</dd></div><div><dt>失效规则</dt><dd>{thenThesis?.payload?.rules[0]?.name ?? "连续两季度低于 20%"}</dd></div><div><dt>置信度</dt><dd>{thenThesis?.confidence ?? 80}%</dd></div></dl></article>
        <div className="versus">VS</div>
        <article className="now"><span>NOW · T5</span><h3>今天的事实</h3><dl><div><dt>指标序列</dt><dd>31% → 19% → 17%</dd></div><div><dt>规则进度</dt><dd className="negative-text">已触发 2/2</dd></div><div><dt>竞争风险</dt><dd>强削弱证据 1 条</dd></div><div><dt>健康度</dt><dd>{data.health.score} / 100</dd></div></dl></article>
      </section>

      <section className="decision-panel">
        <SectionHeading index="DECIDE" title="今天你怎么决定？" subtitle="这是你的决定；系统只负责保存当时的信息环境。" />
        <div className="action-picker">{(Object.keys(actionLabels) as Array<Exclude<DecisionAction, "DEFER">>).map((item) => <button type="button" className={action === item ? "active" : ""} onClick={() => setAction(item)} key={item}>{actionLabels[item]}</button>)}</div>
        {action === "ADD" ? <div className="challenger"><span>DECISION CHALLENGER</span><strong>加仓与你在 T0 设定的“{data.thesis?.payload?.rules[0]?.name ?? "连续两个季度收入增速低于 20%"}”冲突。</strong><p>当前已有 {data.evidence.filter((item) => item.impact !== "SUPPORT").length} 条反方证据。请填写现在出现的、此前不存在的新证据；系统不会据此给出交易指令。</p><textarea aria-label="支持逆向决定的新证据" value={challengerEvidence} onChange={(event) => setChallengerEvidence(event.target.value)} placeholder="必填：来源、时间与它为何改变原规则的适用性" /></div> : null}
        <label htmlFor="decision-reason">最终理由</label><textarea id="decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <label htmlFor="confidence">当前置信度 <strong>{confidence}%</strong></label><input id="confidence" type="range" min="0" max="100" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} />
        <div className="decision-actions"><button className="primary-button" type="submit" disabled={pending !== null || reviewNeedsEvidence || (action === "ADD" && !challengerEvidence.trim())}>{pending === "decision" ? "正在冻结…" : "冻结决策快照"}</button><div><input aria-label="待补证据" value={deferText} onChange={(event) => setDeferText(event.target.value)} /><input aria-label="延期至" type="date" value={deferredUntil} onChange={(event) => setDeferredUntil(event.target.value)} /><button className="secondary-button" type="button" onClick={defer} disabled={pending !== null}>延期并记录待补证据</button></div></div>
        <div className="trigger-dispute"><label>Trigger 口径异议或关闭原因<input value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} /></label><div><button className="text-button" type="button" onClick={dispute} disabled={pending !== null}>{pending === "dispute" ? "记录中…" : "提出异议"}</button><button className="text-button" type="button" onClick={dismiss} disabled={pending !== null}>{pending === "dismiss" ? "关闭中…" : "确认不适用并关闭复盘"}</button></div></div>
      </section>
    </form>
  );
}

function DecisionsView({ data }: { data: DemoState }) {
  return (
    <div className="page-stack">
      <section className="decisions-head"><div><span className="section-number">APPEND-ONLY MEMORY</span><h2>每次重大决定，都保留当时的证据环境。</h2><p>历史快照不可编辑；后续只能创建新的决定。</p></div><span>{data.snapshots.length} 个快照</span></section>
      <section className="section-block">
        <SectionHeading index="MIRROR" title="行为镜子" subtitle="全部来自你自己冻结的记录。这里只做计数，不做评价——判断这样好不好是你的事。" />
        <BehaviorMirrorPanel behavior={data.behavior} />
      </section>
      <section className="snapshot-list">
        {data.snapshots.length ? data.snapshots.map((item, index) => (
          <article className="snapshot-card" key={item.id}>
            <div className="snapshot-date"><strong>{new Date(item.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</strong><span>{new Date(item.createdAt).getFullYear()}</span></div>
            <div className="snapshot-main"><span>{item.recordType === "UNPLANNED_ACTION" ? "UNPLANNED" : "DECISION"} #{String(data.snapshots.length - index).padStart(2, "0")}</span><h3>{actionLabels[item.action as keyof typeof actionLabels] ?? item.action}</h3>{item.triggerSource ? <p className={`trigger-tag ${item.triggerSource === "ASSUMPTION_CHANGE" ? "" : "off-thesis"}`}>推动因素：{triggerSourceLabel(item.triggerSource)}{item.triggerSource === "ASSUMPTION_CHANGE" ? "" : "（非论点驱动）"}{item.assumptionStatus ? ` · 当时 ${item.assumptionStatus.supporting}/${item.assumptionStatus.total} 条假设仍成立` : ""}</p> : null}<p>{item.reason}</p>{item.challengerEvidence ? <p><strong>逆向决定新证据：</strong>{item.challengerEvidence}</p> : null}<div><b>置信度 {item.confidence}%</b><b>健康度 {item.healthScore}</b><b>Thesis V{item.thesisVersionNo}</b><b>{item.evidenceCount} 条证据 / {item.counterEvidenceCount} 条反方</b>{item.priceSnapshot ? <b>价格快照 ¥{item.priceSnapshot.value.toFixed(2)}</b> : <b>旧快照未记录价格</b>}</div><details><summary>查看冻结证据</summary>{item.evidence.length ? <ul>{item.evidence.map((evidence) => <li key={evidence.id}><strong>{evidence.title}</strong> · {impactLabel(evidence.impact as EvidenceImpact)} · {evidence.sourceTitle} · {evidence.publishedAt.slice(0, 10)}</li>)}</ul> : <small>旧快照未保存证据明细。</small>}</details><details><summary>查看冻结环境与完整性信息</summary><small>版本 ID：{item.thesisVersionId}<br />内容哈希：{item.contentHash}<br />记录 ID：{item.id}<br />创建时间：{item.createdAt}{item.priceSnapshot ? <><br />价格时间：{item.priceSnapshot.observedAt}<br />价格来源：{item.priceSnapshot.source}</> : null}</small></details></div>
            <div className={`snapshot-lock ${item.integrityValid ? "" : "invalid"}`}><span>{item.integrityValid ? "LOCKED" : "INTEGRITY ALERT"}</span><strong>{item.integrityValid ? "SHA-256 验签有效" : "快照内容与哈希不一致"}</strong><small>{item.contentHash.slice(0, 12)}…</small></div>
          </article>
        )) : <EmptyState title="还没有决策快照" body="推进到 T5 完成一次复盘后，快照会永久出现在这里。" actionHref="/reviews/demo-review" actionLabel="前往论点复盘" />}
      </section>
      <section className="workflow-log"><SectionHeading index="OPS" title="工作流日志" subtitle="不记录原始敏感文本，只记录模块、Provider、状态、时延、用量与摘要。" />{data.workflows.length ? data.workflows.map((item) => <article key={item.id}><span>{item.module}</span><strong>{item.status}</strong><b>{item.provider}</b><p>{item.outputSummary || item.errorCode || "完成"}<br />{item.latencyMs}ms · {item.inputTokens} in / {item.outputTokens} out{item.estimatedCostCny === null ? "" : ` · ¥${item.estimatedCostCny.toFixed(4)}`}</p><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></article>) : <EmptyState title="暂无工作流记录" body="结构化论点、导入证据或推进场景后会生成日志。" />}</section>
    </div>
  );
}

/**
 * 计划外行动记录。刻意不设任何拦截：用户选完推动因素就能提交。
 * 唯一的产品动作是把「你声明的理由」和「你当初写下的条件现在成立几条」摆在一起。
 */
function UnplannedActionPanel({ data, mutate, pending }: { data: DemoState; mutate: (body: Record<string, unknown>, label: string) => Promise<boolean>; pending: string | null }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Exclude<DecisionAction, "DEFER">>("ADD");
  const [triggerSource, setTriggerSource] = useState<string>("");
  const [reason, setReason] = useState("");
  const [confidence, setConfidence] = useState(60);
  const states = assumptions.map((item) => item.stateAt[Math.min(data.session.currentPoint, 5)]);
  const supporting = states.filter((state) => state === "支持").length;
  const thesisDriven = triggerSource === "ASSUMPTION_CHANGE";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "unplanned-action", decisionAction: action, triggerSource, reason, confidence }, "unplanned");
    if (ok) { setOpen(false); setReason(""); setTriggerSource(""); }
  }

  if (!open) {
    return (
      <div className="unplanned-teaser">
        <div><strong>今天动手了吗？</strong><p>加仓、减仓或清仓，只要发生就记一笔。不记录的操作，半年后你不会记得当时在想什么。</p></div>
        <button className="secondary-button" type="button" onClick={() => setOpen(true)}>记录一次计划外行动</button>
      </div>
    );
  }

  return (
    <form className="unplanned-panel" onSubmit={submit}>
      <div className="action-picker">{(Object.keys(actionLabels) as Array<Exclude<DecisionAction, "DEFER">>).map((item) => <button type="button" className={action === item ? "active" : ""} onClick={() => setAction(item)} key={item}>{actionLabels[item]}</button>)}</div>
      <fieldset className="trigger-picker">
        <legend>是什么推动了这次操作？</legend>
        {data.triggerSources.map((item) => (
          <label className={triggerSource === item.code ? "active" : ""} key={item.code}>
            <input type="radio" name="trigger-source" value={item.code} checked={triggerSource === item.code} onChange={() => setTriggerSource(item.code)} />
            <span><strong>{item.label}</strong>{item.note}</span>
          </label>
        ))}
      </fieldset>
      {triggerSource ? (
        <div className={`mirror-note ${thesisDriven ? "" : "off-thesis"}`}>
          <span>你当初写下的条件</span>
          <strong>{supporting} / {states.length} 条假设仍然成立</strong>
          <p>{thesisDriven
            ? "你声明这次操作来自假设变化。记完之后可以顺手把对应证据补进证据中心，让这条判断有据可查。"
            : `你声明的推动因素是「${triggerSourceLabel(triggerSource)}」，它不属于你当初写下的任何一条假设。系统不阻止这次操作，只是把这两件事一起记下来。`}</p>
        </div>
      ) : null}
      <label htmlFor="unplanned-reason">你的理由</label>
      <textarea id="unplanned-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="至少写 8 个字。写给半年后的自己看。" />
      <label htmlFor="unplanned-confidence">此刻置信度 <strong>{confidence}%</strong></label>
      <input id="unplanned-confidence" type="range" min="0" max="100" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} />
      <div className="decision-actions">
        <button className="primary-button" type="submit" disabled={pending !== null || !triggerSource || reason.trim().length < 8}>{pending === "unplanned" ? "正在冻结…" : "冻结这次记录"}</button>
        <button className="text-button" type="button" onClick={() => setOpen(false)}>取消</button>
      </div>
      <small>这条记录同样不可编辑、不可删除，并计入行为镜子。</small>
    </form>
  );
}

/** 行为镜子。只呈现计数和中位数；样本不足时明确说不足，不给任何倾向性描述。 */
function BehaviorMirrorPanel({ behavior }: { behavior: BehaviorMirror }) {
  if (!behavior.decisionCount) {
    return <EmptyState title="行为镜子还没有数据" body={`记录第一笔决定后开始累积；满 ${BEHAVIOR_MIRROR_MIN_SAMPLE} 笔才会呈现分布。`} />;
  }
  if (!behavior.sampleSufficient) {
    return (
      <div className="mirror-insufficient">
        <strong>已记录 {behavior.decisionCount} 笔决定</strong>
        <p>样本少于 {BEHAVIOR_MIRROR_MIN_SAMPLE} 笔时，任何比例都不能说明习惯。这里暂不给出分布，只等你继续记录。</p>
      </div>
    );
  }
  const horizon = behavior.declaredHorizonMonths;
  return (
    <div className="mirror-grid">
      <article><span>论点驱动的决定</span><strong>{behavior.thesisDrivenCount} / {behavior.decisionCount}</strong><small>占 {behavior.thesisDrivenShare}%。其余由价格、大盘或消息推动。</small></article>
      <article><span>计划外行动</span><strong>{behavior.unplannedCount} 笔</strong><small>占 {behavior.unplannedShare}%，即未经规则触发就动手的次数。</small></article>
      <article><span>决定间隔中位数</span><strong>{behavior.medianDaysBetweenDecisions === null ? "—" : `${behavior.medianDaysBetweenDecisions} 天`}</strong><small>两次记录之间的典型间隔。</small></article>
      <article><span>声明周期 vs 实际持有</span><strong>{horizon ? `${horizon.min}–${horizon.max} 个月` : "未声明"}</strong><small>{behavior.holdingDays === null ? "缺少冻结时间，无法计算。" : `${behavior.exited ? "已退出" : "至今"}持有 ${behavior.holdingDays} 天${behavior.exitedBeforeHorizon === null ? "" : behavior.exitedBeforeHorizon ? "，短于你声明的最短周期" : "，未短于你声明的最短周期"}。`}</small></article>
      <article><span>规则触发后仍选择持有</span><strong>{behavior.holdAfterTriggerCount} / {behavior.afterTriggerCount}</strong><small>其中 {behavior.holdAfterTriggerWithCounterEvidence} 次当时已有反方证据在案。</small></article>
      <article><span>平均置信度</span><strong>{behavior.averageConfidence ?? "—"}%</strong><small>计划外 {behavior.averageConfidenceUnplanned ?? "—"}% · 计划内 {behavior.averageConfidencePlanned ?? "—"}%</small></article>
      <article className="mirror-breakdown">
        <span>计划外行动的推动因素</span>
        <ul>{behavior.triggerBreakdown.map((item) => <li key={item.code}><b>{item.label}</b><i>{item.count} 次</i><em>{item.thesisDriven ? "论点驱动" : "非论点驱动"}</em></li>)}</ul>
      </article>
    </div>
  );
}

function MetricStat({ label, value, note, tone = "" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`metric-stat ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function SectionHeading({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="section-heading"><span>{index}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function EmptyState({ title, body, actionHref, actionLabel }: { title: string; body: string; actionHref?: string; actionLabel?: string }) {
  return <div className="empty-state"><span>○</span><h3>{title}</h3><p>{body}</p>{actionHref ? <Link className="secondary-button" href={actionHref}>{actionLabel}</Link> : null}</div>;
}
