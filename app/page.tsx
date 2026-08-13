"use client";

import { useMemo, useState } from "react";

type ResultTab = "brief" | "writer" | "cards";

const tabs: { id: ResultTab; label: string; count: string }[] = [
  { id: "brief", label: "小红书正文", count: "01" },
  { id: "writer", label: "作家资料卡", count: "02" },
  { id: "cards", label: "配图卡片", count: "03" },
];

const styles = ["克制 · 文学", "温柔 · 叙事", "锐利 · 评论", "轻盈 · 社交"];

function formatChineseDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

export default function Home() {
  const [date, setDate] = useState("2026-07-30");
  const [topic, setTopic] = useState("女性如何夺回自己的叙事");
  const [style, setStyle] = useState(styles[0]);
  const [activeTab, setActiveTab] = useState<ResultTab>("brief");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("今天 08:30");
  const [copied, setCopied] = useState(false);

  const displayDate = useMemo(() => formatChineseDate(date), [date]);

  const handleGenerate = () => {
    setIsGenerating(true);
    window.setTimeout(() => {
      setIsGenerating(false);
      setGeneratedAt(
        new Intl.DateTimeFormat("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
    }, 900);
  };

  const copyCurrent = async () => {
    const text = document.querySelector("[data-result-content]")?.textContent ?? "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="HerLit AI 首页">
          <span className="brand-mark">H</span>
          <span>
            <strong>HerLit AI</strong>
            <small>女性文学 AI 内容工作台</small>
          </span>
        </a>
        <div className="header-meta">
          <span className="status-dot" />
          <span>编辑部在线</span>
          <span className="rule" />
          <span>第 1 阶段 · 本地模拟</span>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span>XIAOHONGSHU LITERARY STUDIO</span></div>
        <h1>每天一篇文字，<br />让女性文学被看见。</h1>
        <p className="hero-copy">
          HerLit 为你准备小红书正文、标题标签与 3:4 图文卡片。<br />
          AI 完成初稿，你审核后发布。
        </p>
      </section>

      <section className="workspace" aria-label="内容生成工作台">
        <div className="input-panel">
          <div className="panel-heading">
            <span className="step-number">01</span>
            <div>
              <h2>今天想写什么？</h2>
              <p>给编辑部一个清晰的起点</p>
            </div>
          </div>

          <label>
            <span className="field-label">发布日期</span>
            <span className="date-field">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <span>{displayDate}</span>
            </span>
          </label>

          <label>
            <span className="field-label">内容主题</span>
            <textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              rows={3}
              placeholder="例如：女性友谊如何成为一种抵抗"
            />
            <span className="field-hint">可以是一位作家、一部作品，或一个你正在思考的问题。</span>
          </label>

          <fieldset>
            <legend className="field-label">表达风格</legend>
            <div className="style-options">
              {styles.map((item) => (
                <button
                  className={style === item ? "style-chip active" : "style-chip"}
                  type="button"
                  key={item}
                  onClick={() => setStyle(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="generate-row">
            <button className="generate-button" type="button" onClick={handleGenerate} disabled={isGenerating}>
              <span>{isGenerating ? "编辑部正在准备图文…" : "生成小红书图文包"}</span>
              <span aria-hidden="true">↗</span>
            </button>
            <p>约 30 秒 · 当前为模拟生成</p>
          </div>
        </div>

        <aside className="today-card">
          <span className="today-label">TODAY’S EDITION</span>
          <div className="edition-date">
            <strong>{new Date(`${date}T00:00:00`).getDate().toString().padStart(2, "0")}</strong>
            <span>
              {new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${date}T00:00:00`)).toUpperCase()}
              <br />{new Date(`${date}T00:00:00`).getFullYear()}
            </span>
          </div>
          <blockquote>“一个女人必须有钱和一间属于自己的房间。”</blockquote>
          <p>— 弗吉尼亚·伍尔夫<br /><i>A Room of One’s Own</i>, 1929</p>
          <div className="card-note">
            <span>编辑提示</span>
            <p>下一阶段将对日期、原文与引语出处进行资料核验，再进入写作。</p>
          </div>
        </aside>
      </section>

      <section className="results-section">
        <div className="section-intro">
          <div>
            <span className="section-kicker">DRAFT DESK</span>
            <h2>今日内容包</h2>
          </div>
          <p>最后更新 · {generatedAt}</p>
        </div>

        <div className="result-shell">
          <nav className="result-tabs" aria-label="内容类型">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                className={activeTab === tab.id ? "result-tab active" : "result-tab"}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.count}</span>{tab.label}
              </button>
            ))}
          </nav>

          <article className="result-paper" data-result-content>
            <div className="paper-toolbar">
              <span className="draft-badge">模拟初稿</span>
              <button type="button" onClick={copyCurrent}>{copied ? "已复制 ✓" : "复制全文"}</button>
            </div>

            {activeTab === "brief" && (
              <div className="article-copy">
                <p className="overline">{displayDate} · 今日小红书图文</p>
                <h3>一个女人真正开始写作，要先拥有一间房吗？</h3>
                <p className="lead">今天，我们从“{topic}”重新走近弗吉尼亚·伍尔夫。</p>
                <p>她写下的不只是女性需要一间房，更是一个创作者必须拥有的条件：不被打断的时间、不被解释的欲望，以及把自己的经验视为值得书写之物的勇气。</p>
                <p>近一个世纪后，这句话仍然在提醒我们：创作从来不只关乎灵感。它也关乎空间、资源，以及一个人是否被允许完整地成为自己。</p>
                <div className="pull-quote">“真正的自由，也许始于不再为自己的声音请求许可。”</div>
                <p className="hashtags">#女性文学　#女性作家　#弗吉尼亚伍尔夫　#阅读分享　#女性成长</p>
                <p className="editor-note"><strong>编辑注：</strong>此页为界面演示稿。真实生成上线后，事实与引语会在交付前完成来源核验。</p>
              </div>
            )}

            {activeTab === "writer" && (
              <div className="article-copy writer-profile">
                <p className="overline">WRITER FOCUS · 作家专题</p>
                <h3>弗吉尼亚·伍尔夫<br /><i>Virginia Woolf</i></h3>
                <div className="profile-grid">
                  <div><span>生卒</span><strong>1882 — 1941</strong></div>
                  <div><span>关键词</span><strong>意识流 · 空间 · 女性写作</strong></div>
                </div>
                <p>她把意识中最微小的波纹带进小说，也把“谁有资格写作”变成一项无法回避的公共追问。</p>
                <h4>从哪里开始读</h4>
                <ul>
                  <li><i>Mrs Dalloway</i>（1925）—— 一天之内，时间与记忆彼此穿行。</li>
                  <li><i>To the Lighthouse</i>（1927）—— 家庭、艺术与失去的漫长回声。</li>
                  <li><i>A Room of One’s Own</i>（1929）—— 关于女性与写作的经典论述。</li>
                </ul>
              </div>
            )}

            {activeTab === "cards" && (
              <div className="article-copy">
                <p className="overline">XIAOHONGSHU CAROUSEL · 3:4</p>
                <h3>今日图文卡片</h3>
                <div className="card-preview-grid">
                  <div className="social-card"><small>HERLIT · 今日女性文学</small><strong>一个女人<br />真正开始写作，<br />要先拥有一间房吗？</strong><span>Virginia Woolf · 1929</span></div>
                  <div className="card-copy"><h4>封面 · 01</h4><p>正式生成时会自动制作封面、核心观点和作品书单三张 3:4 图片。</p><button type="button">保存图片将在下一步接入</button></div>
                </div>
              </div>
            )}
          </article>

          <aside className="package-list">
            <span className="section-kicker">本次生成</span>
            {[
              ["小红书正文", "已完成"],
              ["3 个标题备选", "已完成"],
              ["标签建议", "已完成"],
              ["事实与引语", "待核验"],
              ["3:4 配图卡片", "可保存"],
              ["人工审核", "发布前必须"],
            ].map(([label, status], index) => (
              <div className="package-item" key={label}>
                <span>{(index + 1).toString().padStart(2, "0")}</span>
                <p>{label}<small>{status}</small></p>
              </div>
            ))}
          </aside>
        </div>
      </section>

      <footer>
        <span>HerLit AI · HerLit 的 AI 内容编辑系统</span>
        <span>阅读她们，也写下我们。</span>
      </footer>
    </main>
  );
}
