# HerLit AI 开发路线

## 产品判断

### HerLit

面向公众的女性文学内容品牌。

目标路径：真实读者 → 稳定粉丝 → 品牌资产 → 可持续商业价值。

### HerLit AI

HerLit 背后的 AI 内容编辑系统。MVP 可暂时由一位编辑操作，但不因此把产品定义为私人文学工具，也不在当前阶段建设多租户 SaaS。

当前只验证一个核心问题：HerLit 能否每天稳定找到“今天最值得讲的她”，并产出真正值得关注的内容。

## Phase 2：每日选题与编辑引擎

### Step 1：文档、类型与 Prompt 架构（已完成）

- 统一 HerLit 与 HerLit AI 的公众品牌定位。
- 定义候选评分、Why Her Today、Research Claim、Reader Value、卡片与完整审核包的数据契约。
- 将旧单体 prompt 拆为选题、研究核验、价值模块、写作和编辑复核五段。
- 保持现有页面可构建；本步骤不接真实数据。

### Step 1.1：Selection → Research 数据契约（已完成）

- Selection 使用 `ProposedWhyHerToday.evidenceLeads` 表达待核验依据，不生成 Research Claim ID。
- Research 把 leads 转成正式 claims；通过 Verification 后才生成引用 `evidenceClaimIds` 的 `VerifiedWhyHerToday`。
- Step 2 未来只返回一个 `EditorialSelectionResult`，其中 shortlist、decision 与 selectedCandidate 保持一致。
- `recentRepeatPenalty` 和 `weightedTotal` 均由程序确定性计算；具体权重与公式留到 Step 2。
- 本步骤只修复类型与 Prompt 契约，不实现候选算法、provider、API、搜索或真实执行。

### Step 2：每日候选与选题决策（已完成）

- 支持只输入日期运行；主题、指定人物、风格与排除人物均为可选编辑干预。
- 按当天强关联、当月强关联、编辑型柔性关联逐层发现候选。
- 每次返回 3–5 位候选并完成多维评分与近期重复惩罚。
- 确定候选维度权重、近期重复扣分与 `weightedTotal` 的程序计算公式。
- 输出 Today's Pick、独立 Why Her Today，以及“为什么选她而没有选其他人”。
- 初期允许 provider/mock，但必须明确标识。
- 当前实现使用可复现 mock candidate/history provider；尚未接入互联网检索或真实 Research。

### Step 3：Research Pack 与 Verification（已实现，待 review）

- 建立 Source → Evidence → Claim 分层、透明且可调试的 Research Pack。
- 对姓名、日期、作品原名、首版年份、奖项、重要事件、人物关系与引语逐项核验。
- 使用可替换 `ResearchEvidenceProvider`；当前只有明确标识的 mock provider，不接真实互联网。
- 用独立 Verification Policy 程序化处理来源质量、引语、冲突与放行状态。
- 每条 Evidence Lead 恰好产生一个 resolution，并保留 needs-review/rejected 失败信息。
- 只有日期关系、身份、作品和至少 4 条 claims 均达到门槛时才 `readyForDraft`。
- 引语没有可靠原文或权威出处时拒绝，但 quote 不是 draft-ready 的必需项。

### Step 4：Reader Value、Writer 与 Growth Notes

- 每篇选择 2–3 个真正值得收藏的 Reader Value Module。
- 仅允许 Writer 使用已核验的 Research Claims。
- 生成 3–5 个真实而有张力的标题、正文、标签与 3–6 张卡片方案。
- 输出不直接发布的 Growth Notes，解释点击、读完、收藏、评论与关注理由。

### Step 5：真实接口与编辑审核界面

- 以分步 FastAPI 接口接入候选、Research 与 Draft；开发阶段保留逐段检查能力。
- 第一屏先展示候选、Today's Pick 与 Why Her Today，正文置后。
- 清楚展示来源、置信度、核验状态、Reader Value 与 Growth Notes。
- 替换当前硬编码的伍尔夫模拟结果，并完善人工审核状态。

## 暂不开发

- 用户注册、登录、多租户
- 会员、支付
- 小红书自动发布
- 视频、Podcast
- 大型 CMS
- 一次性建设大规模作家数据库
- 复杂 Agent Framework

## 长期维护原则

- 按 Step 1 → 5 依次推进，每一步保持独立可构建、可检查。
- 选题、Research、Verification、Writer 与 Review 分层，问题可以定位到具体阶段。
- 重要事实必须有来源；引语找不到可靠出处时宁可省略。
- 柔性关联必须坦诚标识为 editorial link，不能伪装成“历史上的今天”。
- 人工审核始终是发布前硬门槛。
- 大体积缓存、媒体与输出优先保存在 `E:\AI项目\HerLit-AI`。
