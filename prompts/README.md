# Phase 2 Prompt 架构

Prompt 与业务代码分离，并按编辑数据流分成五段：

```text
editorial_selection.md
  → research_verification.md
  → value_modules.md
  → xiaohongshu_writer.md
  → editorial_review.md
```

## 职责边界

| Prompt | 只负责 | 不负责 |
| --- | --- | --- |
| `editorial_selection.md` | 发现并比较 3–5 位候选，输出唯一 `EditorialSelectionResult` 与待核验 `ProposedWhyHerToday` | 生成 Research Claim ID、写正文、补写未经核验的事实 |
| `research_verification.md` | 将 Source/Evidence/Claim 分层，把每条 Evidence Lead 解析为正式 claims，并按程序 policy 生成 `ResearchPack` | 自行决定 verified、营销表达、正文润色 |
| `value_modules.md` | 从已核验事实中选择 2–3 个值得收藏的读者价值模块 | 发明冷知识或关系 |
| `xiaohongshu_writer.md` | 只用已核验事实和价值模块生成审核稿 | 搜索资料、判定事实真伪、自动批准 |
| `editorial_review.md` | 从事实、编辑、增长和品牌角度复核 | 自动发布、替代人工终审 |

共享数据契约见 `types/editorial.ts`。

## 运行原则

- `date` 是唯一必填输入；`topic`、`candidateWriter`、`style`、`excludeWriterIds` 都只是编辑干预，其中排除 ID 是引擎必须执行的硬约束。
- 每段输出都应是结构化数据，阶段之间不传递隐藏推理。
- Selection 只输出 Evidence Leads；Evidence Lead ID 不是 Research Claim ID。
- Research 创建正式 claims；只有核验后的 Why Her Today 才引用 `evidenceClaimIds`。
- Research provider 只提供来源与证据候选；核验状态、冲突处理、quote 门槛和 `readyForDraft` 由程序规则决定。
- Writer 只能读取 `verified: true` 的 Research Claims。
- `recentRepeatPenalty` 和 `weightedTotal` 由程序按集中定义的 Step 2 公式确定性计算，模型不得自行填写。
- 搜索摘要只能作为找来源的线索，不能独立支撑正文事实。
- 柔性日期关系必须明确标记为 `editorial link`。
- 引语只有可靠原文或权威出处支持时才可使用；小说人物台词不能变成作者名言。
- 所有自动生成结果保持 `draft`；只有人工编辑可以改为 `approved`。

`xiaohongshu_daily.md` 仅保留为旧入口迁移说明，不再承载完整生成规则。
