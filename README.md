# HerLit AI

## 产品定位

**HerLit** 是一个面向公众的女性文学内容品牌。它通过持续、可信、有辨识度、适合小红书传播的内容，连接真实读者，积累稳定粉丝与品牌资产，并探索可持续的商业价值。

**HerLit AI** 是 HerLit 背后的 AI 内容编辑系统。MVP 可以暂时由一位编辑操作，但产品不按私人兴趣工具定义；当前也不建设多租户 SaaS、账号、会员或支付系统。

当前核心任务是：每天找到“今天最值得讲的她”，说明为什么是今天、为什么是她，并把可靠资料加工成值得点开、读完、收藏和关注的小红书待审核内容包。

## 当前产品边界

- 工作流始终是：AI 草稿 → 编辑审核 → 图片制作 → 发布准备。
- 不自动发布到小红书；人工审核是不可绕过的硬门槛。
- 当前 MVP application runtime 是 TypeScript / Next server APIs，直接复用 Selection、Research 与 Production domain engines。
- `backend/` 中的 FastAPI 仅保留 health scaffold，不是 Phase 2 主链路，也不复制 TypeScript 评分、核验或 grounding 规则。
- 不在当前阶段开发用户注册、多租户、会员、支付、视频、Podcast、大型 CMS 或复杂 Agent Framework。
- 视觉基调沿用深墨绿 `#183d32`、暖象牙白 `#f4f0e8` 与少量朱红 `#a4472f`。
- 图片模型只负责无字背景或编辑视觉；中文、书名、年份和引语使用确定性排版。

## Phase 2 编辑数据流

```text
发布日期 + 可选编辑干预
  → 候选发现与评分（3–5 人）
  → EditorialSelectionResult + Proposed Why Her Today
  → Evidence Leads → Research Claims
  → Verification
  → Verified Why Her Today
  → Reader Value Modules（2–3 个）
  → 小红书审核稿 + Growth Notes + 卡片方案（3–6 张）
  → 人工审核
```

Selection、Research 与写作严格分离：Selection 只能提出待核验 Evidence Leads，不能生成 Research Claim ID；Research 创建并核验正式 claims；正文生成阶段只能使用已核验的 Why Her Today 与 Research Claims。找不到权威出处的引语必须省略；柔性日期关联必须明确标记为 editorial link。

## 目录结构

- `app/`：HerLit AI Web 界面。
- `app/api/editorial/`：candidates、research、produce、re-review、human approval 与 export 的 TypeScript server routes。
- `lib/editorial-workbench/`：应用编排、mock/live adapters、SSRF 防护、human approval 与 export。
- `types/editorial.ts`：Phase 2 编辑领域类型与数量约束。
- `prompts/`：选题、研究核验、读者价值、写作和编辑复核的分步规则。
- `daily/`：已生成的每日审核包与视觉样例。
- `素材/`、`project-data/`：品牌素材及可复用视觉资产。
- `backend/`、`worker/`、`db/`：后端、边缘运行与数据层的阶段性结构。
- `ROADMAP.md`：分步开发与验收边界。

本地依赖、npm 缓存和临时输出位于 `runtime/`、`cache/`、`exports/`，不会提交到 GitHub。

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

验证构建：

```bash
npm run build
npm test
npm run lint
npm run typecheck:editorial
```

## Provider 配置

默认 `EDITORIAL_PROVIDER_MODE=mock`，页面会明确显示 `MOCK DATA`。Live mode 通过 `.env.example` 中的 generic JSON model/search adapter 变量配置，不在仓库保存 secret，也不把供应商 response shape 写入领域类型。

Live Research 的顺序是 Search → 安全 Source Fetch → Claim Extraction → 现有 Verification Policy。模型记忆不能成为 ResearchSource；所有 source 必须来自实际抓取、可追溯的 URL。

当前 session 使用带 TTL 与容量上限的进程内短期存储，刷新、过期或 server restart 后可重新运行流程；正式 content history database 不在 Step 5 范围内。Human approval 由 server 绑定 package ID 与当前 review fingerprint，发布版导出会重新校验 package invariants、review freshness 与 approval binding。

编辑日期固定按 `Asia/Shanghai` 计算并验证真实日历日期。Live Source Fetch 将 DNS 验证结果绑定到实际连接 IP，每次 redirect 都重新解析、验证并绑定；单个来源失败只产生结构化 skip diagnostic，不会丢弃同批安全来源。

## 给协作者与 ChatGPT

优化时请优先阅读：

1. `ROADMAP.md`：当前步骤和不得越过的阶段边界。
2. `types/editorial.ts`：编辑数据契约。
3. `prompts/README.md`：分步 prompt 的职责与数据边界。
4. `app/page.tsx`：Live Editorial Workbench 与人工审核入口。
5. `daily/`：真实内容与视觉交付样例。

请保留“先审核、后制作图片、绝不自动发布”的人工把关机制。安装、构建成功或模型返回不等于内容验收成功；最终仍需编辑检查选题逻辑、来源、事实、表达与品牌价值。
