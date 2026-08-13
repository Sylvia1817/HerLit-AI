# HerLit AI

## 产品定位

**HerLit** 是一个面向公众的女性文学内容品牌。它通过持续、可信、有辨识度、适合小红书传播的内容，连接真实读者，积累稳定粉丝与品牌资产，并探索可持续的商业价值。

**HerLit AI** 是 HerLit 背后的 AI 内容编辑系统。MVP 可以暂时由一位编辑操作，但产品不按私人兴趣工具定义；当前也不建设多租户 SaaS、账号、会员或支付系统。

当前核心任务是：每天找到“今天最值得讲的她”，说明为什么是今天、为什么是她，并把可靠资料加工成值得点开、读完、收藏和关注的小红书待审核内容包。

## 当前产品边界

- 工作流始终是：AI 草稿 → 编辑审核 → 图片制作 → 发布准备。
- 不自动发布到小红书；人工审核是不可绕过的硬门槛。
- 当前前端仍是 Phase 1 模拟界面，候选、Research Pack 与成稿尚未接入真实接口。
- 不在当前阶段开发用户注册、多租户、会员、支付、视频、Podcast、大型 CMS 或复杂 Agent Framework。
- 视觉基调沿用深墨绿 `#183d32`、暖象牙白 `#f4f0e8` 与少量朱红 `#a4472f`。
- 图片模型只负责无字背景或编辑视觉；中文、书名、年份和引语使用确定性排版。

## Phase 2 编辑数据流

```text
发布日期 + 可选编辑干预
  → 候选发现与评分（3–5 人）
  → Today's Pick + Why Her Today
  → Research Pack
  → Verification
  → Reader Value Modules（2–3 个）
  → 小红书审核稿 + Growth Notes + 卡片方案（3–6 张）
  → 人工审核
```

Research 与写作严格分离：正文生成阶段只能使用已进入 Research Pack 且通过核验的信息。找不到权威出处的引语必须省略；柔性日期关联必须明确标记为 editorial link。

## 目录结构

- `app/`：HerLit AI Web 界面。
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
```

## 给协作者与 ChatGPT

优化时请优先阅读：

1. `ROADMAP.md`：当前步骤和不得越过的阶段边界。
2. `types/editorial.ts`：编辑数据契约。
3. `prompts/README.md`：分步 prompt 的职责与数据边界。
4. `app/page.tsx`：当前模拟界面与后续接入点。
5. `daily/`：真实内容与视觉交付样例。

请保留“先审核、后制作图片、绝不自动发布”的人工把关机制。安装、构建成功或模型返回不等于内容验收成功；最终仍需编辑检查选题逻辑、来源、事实、表达与品牌价值。
