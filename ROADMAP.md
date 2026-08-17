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

### Step 3：Research Pack 与 Verification（已完成）

- 建立 Source → Evidence → Claim 分层、透明且可调试的 Research Pack。
- 对姓名、日期、作品原名、首版年份、奖项、重要事件、人物关系与引语逐项核验。
- 使用可替换 `ResearchEvidenceProvider`；当前只有明确标识的 mock provider，不接真实互联网。
- 用独立 Verification Policy 程序化处理来源质量、引语、冲突与放行状态。
- 每条 Evidence Lead 恰好产生一个 resolution，并保留 needs-review/rejected 失败信息。
- 只有日期关系、身份、作品和至少 4 条 claims 均达到门槛时才 `readyForDraft`。
- 引语没有可靠原文或权威出处时拒绝，但 quote 不是 draft-ready 的必需项。

### Step 3.1：Research runtime 边界收紧（已完成）

- `VerifiedWhyHerToday` 只能由 Evidence Lead Resolutions 与 verified claims 确定性重建，runtime 不接受另行拼装结果。
- `readyForDraft` 与程序 eligibility 双向一致，既拒绝错误放行，也拒绝满足条件后的错误阻塞。
- Quote policy 不读取 provider 自报的 attribution 结论，而是比较 claim attribution 与权威 evidence 中的真实 author、character、narrator 等 speaker context。

### Step 4：Reader Value、Grounded Writer 与 Growth Review（已实现，待 review）

- 从 ready Research Pack 确定性构建只含 verified claims 的 `VerifiedEditorialContext`。
- 独立 Reader Value Engine 生成并校验 2–3 个可收藏模块及其 claim provenance。
- Writer 只读取 verified context、已批准 Value Modules、风格和品牌规则。
- 标题、DraftBlocks 与 3–6 张卡片都保留 evidenceClaimIds；body 由 blocks 确定性渲染。
- Quote speaker context 从 Research 一直保留到 Value/Writer，程序拒绝 character、narrator 与 author 的互换。
- Writer 之后由独立 Editorial Review 输出 Growth Notes、issues 与人工审核建议。
- 所有自动结果固定为 draft；当前三个 provider 都是明确标识的 mock，不接互联网、API、UI 或发布。

### Step 4.1：Production runtime 边界收紧（已完成）

- 程序使用 canonical SHA-256 fingerprint/revision 将 Review 绑定到当前 VerifiedContext、Value Modules 与 GroundedDraft。
- Selection shortlist/selected candidate、Research、VerifiedContext 与 Draft 的 writer identity 必须一致。
- Quote 除真实 speaker attribution 外，还必须由权威 evidence excerpt 核验 canonical wording；下游不能改写引语正文。

### Step 5：Live Editorial Workbench（已实现，待 review）

- 以 Next/TypeScript server routes 直接编排既有 domain engines；FastAPI 只保留 health scaffold。
- candidates、research、produce、review API 使用结构化 stage errors 和短期 server session，拒绝客户端伪造程序字段。
- mock/live provider 通过 env 切换；Live Research 保持 Search、Source Fetch、Claim Extraction、Verification 分层。
- Source Fetch 实施协议、localhost/私网、redirect、timeout、size 与 content-type 基础 SSRF 边界。
- 文学编辑工作台分步展示 shortlist、Why Her Today、Research audit、Reader Value、grounded draft、cards 与 Growth Review。
- 人工编辑会使旧 review binding 失效；re-review 后才可人工批准。
- Human approval 是 DailyEditorialPackage 外层状态；自动领域状态仍为 draft，批准后仅允许 Markdown/JSON 导出，不自动发布。
- 当前 persistence 为进程内 editor session；未引入用户、权限、CMS 或 content history database。

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
