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

用真实服务跑一次完整链路（不写库、不发布）：

```bash
npm run smoke:live -- --date 2026-11-02
```

## Provider 配置

默认 `EDITORIAL_PROVIDER_MODE=mock`，页面会明确显示 `MOCK DATA`。Live mode 需要两类外部服务：一个模型服务（OpenAI 兼容 chat 或 Anthropic Messages）与一个搜索服务（Brave / Tavily / Serper，或自建 normalized search），以及可访问公网来源的 outbound HTTPS。密钥只放在本地环境变量，不在仓库保存 secret，也不把供应商 response shape 写入领域类型。

协议必须显式声明，不能把任意模型 API 地址直接填进原有的 generic JSON task 协议：

| 变量 | 取值 |
| --- | --- |
| `EDITORIAL_MODEL_PROTOCOL` | `generic_json`（默认，HerLit JSON task 服务）/ `openai_chat` / `anthropic_messages` |
| `EDITORIAL_SEARCH_PROTOCOL` | `generic_json`（默认）/ `brave` / `tavily` / `serper` |

`generic_json` 期望的是 `{model, task, input}` → `{data}` 的自有任务服务，不是 LLM API；若 base URL 明显属于某个供应商而协议仍是 `generic_json`，配置会直接以 `LIVE_PROVIDER_CONFIG_MISMATCH` 失败，而不是给出难以诊断的解析错误。

每个任务都经过同一管线：任务 prompt → JSON 抽取 → 确定性归一化 → 一次携带违反项的重试 → 领域校验。归一化只修复程序所有字段（必需 hashtag、卡片顺序、`draft` 状态、quote 归属）并丢弃不可信输入（未抓取的 sourceId、非法类别），绝不补写编辑内容；无法修复时返回 `LIVE_CONTENT_CONTRACT_VIOLATION` 并列出具体违反项。

Live Research 的顺序仍是 Search → 安全 Source Fetch → Claim Extraction → 现有 Verification Policy，另外把抓取结果做 HTML 转文本、按声明 charset 解码，并限制每个任务的来源数量与字符预算。模型记忆不能成为 ResearchSource；所有 source 必须来自实际抓取、可追溯的 URL。

`/api/editorial/health` 与工作台页头会显示当前 mode、协议、模型名与端点 host（不含密钥），并列出缺失的变量；CI 覆盖协议形状、归一化与一条真实 adapter 的完整流程（使用假传输），但不调用付费服务。完整配置示例、错误码与已知边界见 [Live providers](docs/live-providers.md)。

## 给协作者与 ChatGPT

优化时请优先阅读：

1. `ROADMAP.md`：当前步骤和不得越过的阶段边界。
2. `types/editorial.ts`：编辑数据契约。
3. `prompts/README.md`：分步 prompt 的职责与数据边界。
4. `app/page.tsx`：Live Editorial Workbench 与人工审核入口。
5. `daily/`：真实内容与视觉交付样例。

请保留“先审核、后制作图片、绝不自动发布”的人工把关机制。安装、构建成功或模型返回不等于内容验收成功；最终仍需编辑检查选题逻辑、来源、事实、表达与品牌价值。

## CI 与合并验收

CI 检查领域类型、lint、生产构建与回归测试，另运行真实浏览器的 mock 编辑审核流程及 Git 历史 secret 扫描。新增 TypeScript 测试通过 `tests/*.test.ts` 自动发现。

管理员需要将 `Typecheck, lint and tests`、`Browser approval flow`、`Secret scan` 设置为 `main` 的必需检查；workflow 本身不会开启分支保护。配置步骤、失败门禁验收与尚未覆盖的内容语义边界见 [CI gates](docs/ci-gates.md)。
