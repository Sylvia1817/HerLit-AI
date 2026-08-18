"use client";

import { useMemo, useState } from "react";
import type { DailyEditorialPackage, EditorialSelectionResult, ResearchPack } from "../types/editorial.ts";
import type { ApiFailure, ApprovalResponse, CandidateApiMeta, ExportResponse, HumanReviewState, ProductionApiMeta, ResearchApiMeta, ReviewApiMeta } from "../lib/editorial-workbench/types.ts";
import { getEditorialDate } from "../lib/editorial-workbench/date.ts";

type BusyStage = "selection" | "research" | "production" | "review" | null;
const STYLES = ["克制 · 文学", "温柔 · 叙事", "锐利 · 评论", "轻盈 · 社交"];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as T | ApiFailure;
  if (!response.ok || !(payload as { ok?: boolean }).ok) {
    const error = (payload as ApiFailure).error;
    throw new Error(`${error.stage} · ${error.code} · ${error.message}`);
  }
  return payload as T;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export default function Home() {
  const [date, setDate] = useState(() => getEditorialDate());
  const [topic, setTopic] = useState("");
  const [candidateWriter, setCandidateWriter] = useState("");
  const [style, setStyle] = useState(STYLES[0]);
  const [excludeWriterIds, setExcludeWriterIds] = useState("");
  const [interventionOpen, setInterventionOpen] = useState(false);
  const [selection, setSelection] = useState<EditorialSelectionResult>();
  const [selectionMeta, setSelectionMeta] = useState<CandidateApiMeta>();
  const [confirmed, setConfirmed] = useState(false);
  const [research, setResearch] = useState<ResearchPack>();
  const [researchMeta, setResearchMeta] = useState<ResearchApiMeta>();
  const [editorialPackage, setEditorialPackage] = useState<DailyEditorialPackage>();
  const [productionMeta, setProductionMeta] = useState<ProductionApiMeta>();
  const [preferredTitle, setPreferredTitle] = useState(0);
  const [reviewStale, setReviewStale] = useState(false);
  const [humanReview, setHumanReview] = useState<HumanReviewState>({ status: "editing" });
  const [busy, setBusy] = useState<BusyStage>(null);
  const [error, setError] = useState("");
  const providerMode = selectionMeta?.providerMode ?? "mock";

  const sourceById = useMemo(() => new Map(research?.sources.map((source) => [source.id, source]) ?? []), [research]);
  const blockers = useMemo(() => {
    if (!research || research.readyForDraft) return [];
    const verified = research.claims.filter(({ verified }) => verified);
    return [...(!research.verifiedWhyHerToday ? ["Why Her Today 尚未核验"] : []), ...(!verified.some(({ category }) => category === "bio") ? ["缺少 verified bio claim"] : []), ...(!verified.some(({ category }) => category === "work") ? ["缺少 verified work claim"] : []), ...(verified.length < 4 ? [`仅有 ${verified.length} 条 verified claims，需要至少 4 条`] : [])];
  }, [research]);

  async function run(stage: BusyStage, action: () => Promise<void>) {
    setBusy(stage); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  }

  async function discoverCandidates() {
    await run("selection", async () => {
      const result = await postJson<{ ok: true; data: EditorialSelectionResult; meta: CandidateApiMeta }>("/api/editorial/candidates", { date, topic: topic || undefined, candidateWriter: candidateWriter || undefined, style, excludeWriterIds: excludeWriterIds.split(",").map((item) => item.trim()).filter(Boolean) });
      setSelection(result.data); setSelectionMeta(result.meta); setConfirmed(false); setResearch(undefined); setResearchMeta(undefined); setEditorialPackage(undefined); setProductionMeta(undefined); setHumanReview({ status: "editing" }); setReviewStale(false);
    });
  }

  async function startResearch() {
    if (!selection || !selectionMeta) return;
    await run("research", async () => {
      const result = await postJson<{ ok: true; data: ResearchPack; meta: ResearchApiMeta }>("/api/editorial/research", { selectionId: selectionMeta.selectionId, selection, candidateId: selection.selectedCandidate.id });
      setResearch(result.data); setResearchMeta(result.meta); setEditorialPackage(undefined);
    });
  }

  async function produceDraft() {
    if (!selection || !selectionMeta || !research || !researchMeta) return;
    await run("production", async () => {
      const result = await postJson<{ ok: true; data: DailyEditorialPackage; meta: ProductionApiMeta }>("/api/editorial/produce", { selectionId: selectionMeta.selectionId, researchId: researchMeta.researchId, selection, researchPack: research, style });
      setEditorialPackage(result.data); setProductionMeta(result.meta); setPreferredTitle(0); setReviewStale(false); setHumanReview({ status: "ready_for_review" });
    });
  }

  function editPackage(mutator: (draft: DailyEditorialPackage) => void) {
    if (!editorialPackage) return;
    const next = structuredClone(editorialPackage); mutator(next); setEditorialPackage(next); setReviewStale(true); setHumanReview({ status: "editing" });
  }

  async function rerunReview() {
    if (!editorialPackage || !productionMeta) return;
    await run("review", async () => {
      const result = await postJson<{ ok: true; data: DailyEditorialPackage; meta: ReviewApiMeta }>("/api/editorial/review", { packageId: productionMeta.packageId, valueModules: editorialPackage.valueModules, draft: editorialPackage.draft });
      setEditorialPackage(result.data); setReviewStale(false); setHumanReview({ status: "ready_for_review" });
    });
  }

  async function approve() {
    if (!editorialPackage || !productionMeta) return;
    await run("review", async () => {
      const result = await postJson<ApprovalResponse>("/api/editorial/approve", { packageId: productionMeta.packageId });
      setHumanReview(result.data);
    });
  }

  async function exportFile(format: "md" | "json", publishReady: boolean) {
    if (!editorialPackage || !productionMeta) return;
    await run("review", async () => {
      const result = await postJson<ExportResponse>("/api/editorial/export", {
        packageId: productionMeta.packageId,
        format: format === "md" ? "markdown" : "json",
        preferredTitleIndex: preferredTitle,
        publishReady,
      });
      download(result.data.fileName, result.data.content, result.data.contentType);
    });
  }

  return <main className="workbench-page">
    <header className="masthead"><div className="brand-lockup"><span>H</span><div><strong>HerLit</strong><small>LIVE EDITORIAL WORKBENCH</small></div></div><div className={`mode-ribbon ${providerMode}`}>{providerMode === "mock" ? "MOCK DATA" : "LIVE SOURCES"}</div></header>
    <section className="opening"><p className="folio">PHASE 2 · DAILY EDITION</p><h1>今天，写哪一位她？</h1><p>从日期出发，让候选、核验、写作与人工判断保持各自清晰。</p></section>

    <section className="date-desk paper-section"><div className="section-number">01</div><div className="date-primary"><label htmlFor="publication-date">Publication Date</label><input id="publication-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div><button className="text-button" type="button" onClick={() => setInterventionOpen((value) => !value)}>Editor Intervention {interventionOpen ? "−" : "+"}</button>
      {interventionOpen && <div className="intervention-grid"><label>指定人物<input value={candidateWriter} onChange={(event) => setCandidateWriter(event.target.value)} placeholder="可选" /></label><label>主题<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="可选" /></label><label>风格<select value={style} onChange={(event) => setStyle(event.target.value)}>{STYLES.map((item) => <option key={item}>{item}</option>)}</select></label><label>排除 writer IDs<input value={excludeWriterIds} onChange={(event) => setExcludeWriterIds(event.target.value)} placeholder="逗号分隔" /></label></div>}
      <button className="primary-action" type="button" onClick={discoverCandidates} disabled={busy !== null}>{busy === "selection" ? "正在发现候选…" : "生成今日候选"}<span>→</span></button>
    </section>
    {error && <aside className="error-note" role="alert"><strong>流程暂停</strong><span>{error}</span></aside>}

    {selection && selectionMeta && <section className="editorial-stage"><div className="stage-heading"><div><span>02 · SELECTION</span><h2>今日候选</h2></div><p>程序排名保留，先确认再研究。</p></div><div className="trace-line">{selectionMeta.discoveryTrace.map((entry) => <span key={entry.tier}>TIER {entry.tier} · {entry.discovered}</span>)}</div><div className="candidate-grid">{selection.candidateShortlist.map((candidate) => <article className={`candidate-card ${candidate.rank === 1 ? "pick" : ""}`} key={candidate.id}>{candidate.rank === 1 && <span className="pick-flag">TODAY&apos;S PICK</span>}<div className="candidate-rank">0{candidate.rank}</div><h3>{candidate.writer.name}</h3>{candidate.writer.originalName && <i>{candidate.writer.originalName}</i>}<p className="relation">{candidate.proposedWhyHerToday.shortReason}</p><dl><div><dt>Tier</dt><dd>{candidate.proposedWhyHerToday.tier}</dd></div><div><dt>Score</dt><dd>{candidate.score.weightedTotal}</dd></div><div><dt>Repeat</dt><dd>−{candidate.score.recentRepeatPenalty}</dd></div></dl><p>{candidate.editorialReason}</p><ul>{candidate.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul><small>{candidate.provenance.providerMode.toUpperCase()} · {candidate.provenance.providerId}</small></article>)}</div><div className="decision-note"><div><strong>为什么选她</strong><p>{selection.selectionDecision.whySelected}</p></div><div><strong>为什么不是其他人</strong>{selection.selectionDecision.whyNotOthers.map((item) => <p key={item.candidateId}>{item.reason}</p>)}</div></div>{!confirmed ? <button className="primary-action compact" type="button" onClick={() => setConfirmed(true)}>确认 Today&apos;s Pick</button> : <button className="primary-action compact" type="button" onClick={startResearch} disabled={busy !== null}>{busy === "research" ? "正在核验资料…" : "开始资料核验"}</button>}</section>}

    {research && <section className="editorial-stage research-stage"><div className="stage-heading"><div><span>03 · RESEARCH</span><h2>资料核验</h2></div><span className={`readiness ${research.readyForDraft ? "ready" : "blocked"}`}>{research.readyForDraft ? "READY FOR DRAFT" : "NOT READY"}</span></div><article className="why-panel"><span>WHY HER TODAY</span><h3>{research.proposedWhyHerToday.shortReason}</h3><p>{research.proposedWhyHerToday.editorExplanation}</p></article>{blockers.length > 0 && <div className="blocker-list"><strong>还缺什么</strong>{blockers.map((item) => <p key={item}>— {item}</p>)}</div>}<div className="claim-list">{research.claims.map((claim) => <article className="claim-row" key={claim.id}><div className={`claim-status ${claim.verificationStatus}`}>{claim.verificationStatus.replace("_", " ")}</div><div><span>{claim.category} · {claim.confidence}</span><h3>{claim.claim}</h3><p>{claim.verificationReason}</p>{claim.quoteContext && <p className="quote-context">Speaker: {claim.quoteContext.attributedSpeakerType} {claim.quoteContext.attributedSpeakerName ?? ""}</p>}<div className="evidence-list">{claim.evidence.map((evidence) => { const source = sourceById.get(evidence.sourceId); return <p key={`${claim.id}-${evidence.sourceId}`}><b>{evidence.support}</b> · {evidence.locator ?? "无 locator"} · {evidence.excerpt ?? "无 excerpt"} {source && <>· <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></>}</p>; })}</div></div></article>)}</div><button className="primary-action compact" type="button" disabled={!research.readyForDraft || busy !== null} onClick={produceDraft}>{busy === "production" ? "正在生成编辑初稿…" : "生成编辑初稿"}</button></section>}

    {editorialPackage && <section className="editorial-stage production-stage"><div className="stage-heading"><div><span>04 · PRODUCTION</span><h2>编辑初稿</h2></div><span className="draft-domain">DOMAIN STATUS · {editorialPackage.status.toUpperCase()}</span></div><div className="production-grid"><section><h3>Reader Value</h3>{editorialPackage.valueModules.map((module, index) => <article className="value-card" key={`${module.type}-${index}`}><span>{module.type}</span><input value={module.title} onChange={(event) => editPackage((next) => { next.valueModules[index].title = event.target.value; })} /><textarea value={module.content} onChange={(event) => editPackage((next) => { next.valueModules[index].content = event.target.value; })} /><p><b>Reader benefit</b> · {module.readerBenefit}</p><small>Evidence · {module.evidenceClaimIds.join(", ")}</small></article>)}</section><section><h3>Titles</h3>{editorialPackage.draft.titles.map((title, index) => <label className="title-choice" key={index}><input type="radio" checked={preferredTitle === index} onChange={() => setPreferredTitle(index)} /><input value={title.text} onChange={(event) => editPackage((next) => { next.draft.titles[index].text = event.target.value; })} /><small>{title.angle} · {title.evidenceClaimIds.join(", ")}</small></label>)}</section></div>
      <section className="draft-section"><h3>Body · Draft Blocks</h3><div className="block-editor">{editorialPackage.draft.blocks.map((block, index) => <article key={block.id}><span>{block.role}</span><textarea value={block.text} onChange={(event) => editPackage((next) => { next.draft.blocks[index].text = event.target.value; next.draft.body = next.draft.blocks.map(({ text }) => text.trim()).join("\n\n"); })} /><details><summary>Evidence → Claim → Source</summary>{block.evidenceClaimIds.map((claimId) => { const claim = editorialPackage.verifiedContext.claims.find(({ id }) => id === claimId); return <div key={claimId}><b>{claim?.claim}</b>{claim?.evidence.map((evidence) => { const source = sourceById.get(evidence.sourceId); return source ? <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : null; })}</div>; })}</details></article>)}</div><div className="reading-view"><span>整篇阅读视图</span><h3>{editorialPackage.draft.titles[preferredTitle].text}</h3>{editorialPackage.draft.blocks.map((block) => <p key={block.id}>{block.text}</p>)}<p className="hashtags">{editorialPackage.draft.hashtags.join(" ")}</p></div></section>
      <section className="cards-section"><h3>Cards · {editorialPackage.draft.cards.length}</h3><div className="cards-grid">{editorialPackage.draft.cards.map((card, index) => <article key={card.order}><span>0{card.order} · {card.role}</span><input value={card.title} onChange={(event) => editPackage((next) => { next.draft.cards[index].title = event.target.value; })} /><textarea value={card.copy} onChange={(event) => editPackage((next) => { next.draft.cards[index].copy = event.target.value; })} /><p>{card.visualDirection}</p></article>)}</div></section>
      <section className="growth-section"><div className="growth-heading"><div><span>05 · GROWTH REVIEW</span><h3>{editorialPackage.review.recommendation}</h3></div>{reviewStale ? <strong className="stale">STALE · NEEDS RE-REVIEW</strong> : <strong className="current">CURRENT REVIEW</strong>}</div>{!reviewStale && <div className="growth-grid">{Object.entries(editorialPackage.review.growthNotes).map(([key, value]) => <article className={key === "followReason" ? "follow" : ""} key={key}><span>{key.replace("Reason", "")}</span><p>{value}</p></article>)}</div>}{editorialPackage.review.issues.map((issue) => <p className="issue" key={issue.code}>{issue.severity} · {issue.message}</p>)}{reviewStale && <button className="primary-action compact" type="button" onClick={rerunReview} disabled={busy !== null}>{busy === "review" ? "正在重新 Review…" : "重新运行 Review"}</button>}</section>
      <section className="approval-section"><div><span>06 · HUMAN REVIEW</span><h3>{humanReview.status === "approved" ? "人工审核已通过" : "等待人工决定"}</h3>{humanReview.status === "approved" && <p>{humanReview.approvedBy} · {humanReview.approvedAt}</p>}</div><div className="approval-actions"><button type="button" onClick={approve} disabled={reviewStale || editorialPackage.review.recommendation !== "ready_for_human_review"}>人工审核通过</button><button type="button" onClick={() => exportFile("md", false)}>导出 DRAFT Markdown</button><button type="button" onClick={() => exportFile("json", false)}>导出 DRAFT JSON</button><button className="approved-export" type="button" disabled={humanReview.status !== "approved"} onClick={() => exportFile("md", true)}>导出发布版 Markdown</button><button className="approved-export" type="button" disabled={humanReview.status !== "approved"} onClick={() => exportFile("json", true)}>导出发布版 JSON</button></div><p className="no-publish">不自动发布 · 不发送到小红书</p></section>
    </section>}
    <footer><span>HerLit · 阅读她们，也写下我们。</span><span>Human review remains the publishing gate.</span></footer>
  </main>;
}
