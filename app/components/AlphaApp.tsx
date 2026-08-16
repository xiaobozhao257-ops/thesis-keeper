"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { entryBasisTypes, isWeakEntryBasis } from "../lib/demo-domain";

type AlphaSummary = {
  id: string;
  instrumentName: string;
  canonicalCode: string;
  assetType: string;
  status: string;
  versionNo: number | null;
  versionStatus: string | null;
  coreThesis: string;
  confidence: number | null;
  updatedAt: string;
  health: { status: "DATA_MISSING"; score: null };
  pendingTaskCount: number;
};

type DraftPayload = {
  coreThesis: string;
  assumptions: Array<{ code: string; title: string; description: string; weight: number }>;
  metrics: Array<{ key: string; name: string; unit: string; period: string; assumptionCode: string }>;
  rules: Array<{ name: string; type: string; threshold?: number; unit?: string; requiredConsecutivePeriods?: number }>;
  clarificationQuestions: string[];
};

type AlphaDetail = {
  id: string;
  instrumentName: string;
  canonicalCode: string;
  assetType: string;
  status: string;
  activeVersion: { id: string; versionNo: number; coreThesis: string; confidence: number; payload: DraftPayload | null } | null;
  draft: { id: string; versionNo: number; coreThesis: string; confidence: number; payload: DraftPayload | null } | null;
  versions: Array<{ id: string; versionNo: number; status: string }>;
  health: { status: "DATA_MISSING"; score: null };
  rule: { status: "DATA_MISSING"; current: number; required: number };
};

type InstrumentSearchResult = {
  name: string;
  canonicalCode: string;
  assetType: "EQUITY" | "ETF" | "LOF";
};

function AlphaShell({ title, active, children }: { title: string; active: "portfolio" | "new" | "thesis"; children: ReactNode }) {
  return (
    <div className="app-frame alpha-frame">
      <aside className="side-rail">
        <Link className="brand" href="/portfolio" aria-label="Thesis Keeper 本地 Alpha 首页">
          <span className="brand-mark">TK</span>
          <span><strong>THESIS</strong><strong>KEEPER</strong></span>
        </Link>
        <div className="case-chip alpha-chip"><span className="case-dot" /><div><small>LOCAL ALPHA</small><strong>真实论点</strong><span>RQData 仅本地验证</span></div></div>
        <nav aria-label="Alpha 导航">
          <Link className={`nav-item ${active === "portfolio" ? "active" : ""}`} href="/portfolio"><span>01</span>投资组合</Link>
          <Link className={`nav-item ${active === "new" ? "active" : ""}`} href="/theses/new"><span>02</span>新建论点</Link>
          <Link className={`nav-item ${active === "thesis" ? "active" : ""}`} href="/portfolio"><span>03</span>论点详情</Link>
          <Link className="nav-item" href="/demo"><span>D</span>可重放 Demo</Link>
        </nav>
        <div className="rail-note"><span>Data boundary</span><strong>LOCAL ONLY</strong><small>真实数据不承诺云端同步</small></div>
      </aside>
      <main className="main-canvas">
        <header className="topbar"><div><span className="eyebrow">DECISION MEMORY / LOCAL ALPHA</span><h1>{title}</h1></div><div className="top-actions"><span className="status-pill attention"><i />本地验证</span></div></header>
        {children}
        <footer className="app-footer"><span>THESIS KEEPER / LOCAL ALPHA</span><p>用于记录和复盘用户自己的投资逻辑，不构成投资建议或交易指令。</p></footer>
      </main>
    </div>
  );
}

export function AlphaPortfolioApp() {
  const [items, setItems] = useState<AlphaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/v1/theses", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { data?: AlphaSummary[]; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? "加载失败");
        setItems(result.data ?? []);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AlphaShell title="投资组合" active="portfolio">
      <div className="page-stack">
        <section className="alpha-overview">
          <div><span className="section-number">M1 / REAL USAGE LOOP</span><h2>先让每个论点独立地活起来。</h2><p>真实论点与 T0–T6 Demo 已分开。当前健康度保持 DATA_MISSING，直到你确认第一条真实观测。</p></div>
          <Link className="primary-button link-button" href="/theses/new">新建真实论点</Link>
        </section>
        {error ? <div className="error-banner" role="alert"><strong>本地数据连接失败</strong><span>{error}</span></div> : null}
        {loading ? <div className="loading-line" role="status"><i />正在读取本地论点…</div> : null}
        {!loading && !error && items.length === 0 ? (
          <section className="alpha-empty"><span>EMPTY PORTFOLIO</span><h2>还没有真实论点。</h2><p>从一只你正在持有或跟踪的标的开始。60 秒内写下理由、周期和一条判错条件。</p><Link className="primary-button link-button" href="/theses/new">建立第一个论点</Link><Link className="text-link" href="/demo">先看可重放 Demo →</Link></section>
        ) : null}
        {items.length ? <section className="alpha-thesis-grid" aria-label="真实论点列表">{items.map((item) => (
          <Link className="alpha-thesis-card" href={`/theses/${encodeURIComponent(item.id)}`} key={item.id}>
            <div><span>{item.assetType} · {item.canonicalCode}</span><b>{item.versionStatus === "DRAFT" ? "草稿待确认" : `V${item.versionNo ?? 1}`}</b></div>
            <h2>{item.instrumentName}</h2><p>{item.coreThesis || "结构化论点待确认。"}</p>
            <footer><span className="data-missing">DATA_MISSING</span><span>{item.pendingTaskCount} 项待办 →</span></footer>
          </Link>
        ))}</section> : null}
      </div>
    </AlphaShell>
  );
}

export function AlphaNewThesisApp() {
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [instrumentResults, setInstrumentResults] = useState<InstrumentSearchResult[]>([]);
  const [instrumentName, setInstrumentName] = useState("");
  const [canonicalCode, setCanonicalCode] = useState("");
  const [assetType, setAssetType] = useState<"EQUITY" | "ETF" | "LOF">("EQUITY");
  const [reason, setReason] = useState("");
  const [basisType, setBasisType] = useState("FUNDAMENTAL_CHANGE");
  const [falsifier, setFalsifier] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (instrumentQuery.trim().length < 2) return;
    const response = await fetch(`/api/v1/instruments?query=${encodeURIComponent(instrumentQuery.trim())}`);
    const result = await response.json() as { data?: InstrumentSearchResult[] };
    setInstrumentResults(result.data ?? []);
  }

  async function create() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/theses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrumentName, canonicalCode, assetType, inputText: reason,
          horizonMinMonths: 12, horizonMaxMonths: 24, confidence: 70,
          entryBasis: { type: basisType, falsifier },
        }),
      });
      const result = await response.json() as { data?: { id: string }; error?: { message?: string } };
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? "创建失败");
      window.location.href = `/theses/${encodeURIComponent(result.data.id)}`;
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "创建失败");
    } finally {
      setPending(false);
    }
  }

  const weakBasis = isWeakEntryBasis(basisType);
  const blocked = !instrumentName || reason.trim().length < 12 || (weakBasis && falsifier.trim().length < 8);

  return (
    <AlphaShell title="新建论点" active="new">
      <div className="page-stack narrow-page">
        <section className="editor-intro"><span className="section-number">60 SECOND THESIS</span><h2>先冻结最小有效判断。</h2><p>本地 Alpha 第一步只要求标的、理由和判错条件。结构化草稿生成后由你确认。</p></section>
        <section className="editor-card alpha-form">
          <div className="instrument-search"><label>搜索 A 股 / ETF / LOF<input value={instrumentQuery} onChange={(event) => setInstrumentQuery(event.target.value)} placeholder="输入代码或名称" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} /></label><button className="secondary-button" type="button" onClick={() => void search()}>搜索</button></div>
          {instrumentResults.length ? <div className="instrument-results">{instrumentResults.map((item) => <button type="button" key={item.canonicalCode} onClick={() => { setInstrumentName(item.name); setCanonicalCode(item.canonicalCode); setAssetType(item.assetType); setInstrumentResults([]); }}><strong>{item.name}</strong><span>{item.canonicalCode} · {item.assetType}</span></button>)}</div> : null}
          <div className="selected-instrument"><span>已选标的</span><strong>{instrumentName || "请先搜索并选择"}</strong><small>{canonicalCode || "规范代码将显示在这里"}</small></div>
          <label>你为什么关注或持有它？<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：我认为公司的收入增长会在未来 12–24 个月继续，如果连续两个季度低于 20%，说明判断需要重新审视。" /></label>
          <fieldset><legend>主要依据</legend><div className="basis-grid">{entryBasisTypes.map((item) => <label className={basisType === item.code ? "selected" : ""} key={item.code}><input type="radio" name="basis" checked={basisType === item.code} onChange={() => setBasisType(item.code)} /><strong>{item.label}</strong><small>{item.note}</small></label>)}</div></fieldset>
          {weakBasis ? <label className="falsifier-field">什么情况下说明这个依据是错的？<textarea value={falsifier} onChange={(event) => setFalsifier(event.target.value)} placeholder="至少 8 个字，尽量包含时间或数值条件" /></label> : null}
          {error ? <div className="error-banner" role="alert"><strong>未能生成草稿</strong><span>{error}</span></div> : null}
          <button className="primary-button" type="button" disabled={blocked || pending} onClick={() => void create()}>{pending ? "正在结构化…" : "生成可确认草稿"}</button>
        </section>
      </div>
    </AlphaShell>
  );
}

export function AlphaThesisDetailApp({ thesisId }: { thesisId: string }) {
  const [data, setData] = useState<AlphaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/v1/theses/${encodeURIComponent(thesisId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { data?: AlphaDetail; error?: { message?: string } };
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? "加载失败");
        setData(result.data);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [thesisId]);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/theses/${encodeURIComponent(thesisId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm-draft" }) });
      const result = await response.json() as { data?: AlphaDetail; error?: { message?: string } };
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? "确认失败");
      setData(result.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "确认失败");
    } finally {
      setPending(false);
    }
  }

  const version = data?.draft ?? data?.activeVersion;
  const payload = version?.payload;

  return (
    <AlphaShell title="论点详情" active="thesis">
      <div className="page-stack">
        {loading ? <div className="loading-line" role="status"><i />正在读取论点…</div> : null}
        {error ? <div className="error-banner" role="alert"><strong>论点读取失败</strong><span>{error}</span><Link href="/portfolio">返回组合</Link></div> : null}
        {data && version ? <>
          <section className="alpha-detail-hero"><div><span>{data.assetType} · {data.canonicalCode}</span><h2>{data.instrumentName}</h2><p>{version.coreThesis}</p></div><div className="alpha-state"><strong>{data.draft ? "DRAFT" : `V${data.activeVersion?.versionNo}`}</strong><span>{data.draft ? "待人工确认" : "已冻结"}</span></div></section>
          <section className="metric-row"><div className="metric-stat"><span>健康度</span><strong>DATA_MISSING</strong><small>尚未确认真实观测</small></div><div className="metric-stat"><span>规则进度</span><strong>0/{data.rule.required}</strong><small>缺数据不推断</small></div><div className="metric-stat"><span>版本</span><strong>{data.draft ? "草稿" : `V${data.activeVersion?.versionNo}`}</strong><small>{data.versions.length} 条版本记录</small></div><div className="metric-stat"><span>待办</span><strong>0</strong><small>观测入口将在下一竖切片接入</small></div></section>
          {payload ? <section className="section-block"><div className="section-heading"><span>01</span><div><h2>结构化草稿</h2><p>确认后不可原地修改，后续只能创建新版本。</p></div></div><div className="assumption-grid">{payload.assumptions.map((item) => <article className="assumption-card" key={item.code}><div><span>{item.code}</span><i className="signal mixed" />待观测</div><h3>{item.title}</h3><p>{item.description}</p><small>权重 {Math.round(item.weight * 100)}%</small></article>)}</div></section> : null}
          {payload ? <section className="section-block"><div className="section-heading"><span>02</span><div><h2>确定性失效条件</h2><p>LLM 只生成草稿；观测确认后由确定性规则计算。</p></div></div><div className="alpha-rule-list">{payload.rules.map((rule) => <article key={rule.name}><span>{rule.type}</span><strong>{rule.name}</strong><small>{rule.threshold === undefined ? "证据提醒" : `阈值 ${rule.threshold} ${rule.unit ?? ""} · 连续 ${rule.requiredConsecutivePeriods ?? 1} 期`}</small></article>)}</div></section> : null}
          {data.draft ? <div className="confirm-bar"><div><strong>准备冻结第一版</strong><span>确认后不能静默改写。</span></div><button className="primary-button" disabled={pending} onClick={() => void confirm()}>{pending ? "正在冻结…" : "确认并冻结 V1"}</button></div> : <section className="alpha-next-step"><span>NEXT</span><h2>论点已冻结，等待真实观测。</h2><p>下一个竖切片将从本地 RQData Bridge 拉取候选观测，由你确认后才进入规则。</p></section>}
        </> : null}
      </div>
    </AlphaShell>
  );
}
