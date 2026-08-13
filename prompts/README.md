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
| `editorial_selection.md` | 发现并比较 3–5 位候选，选出 Today's Pick，生成 Why Her Today | 写正文、补写未经核验的事实 |
| `research_verification.md` | 建立 Research Pack，逐条记录来源并核验 | 营销表达、正文润色 |
| `value_modules.md` | 从已核验事实中选择 2–3 个值得收藏的读者价值模块 | 发明冷知识或关系 |
| `xiaohongshu_writer.md` | 只用已核验事实和价值模块生成审核稿 | 搜索资料、判定事实真伪、自动批准 |
| `editorial_review.md` | 从事实、编辑、增长和品牌角度复核 | 自动发布、替代人工终审 |

共享数据契约见 `types/editorial.ts`。

## 运行原则

- `date` 是唯一必填输入；`topic`、`candidateWriter`、`style`、`excludeWriters` 都只是编辑干预。
- 每段输出都应是结构化数据，阶段之间不传递隐藏推理。
- Writer 只能读取 `verified: true` 的 Research Claims。
- 搜索摘要只能作为找来源的线索，不能独立支撑正文事实。
- 柔性日期关系必须明确标记为 `editorial link`。
- 引语只有可靠原文或权威出处支持时才可使用；小说人物台词不能变成作者名言。
- 所有自动生成结果保持 `draft`；只有人工编辑可以改为 `approved`。

`xiaohongshu_daily.md` 仅保留为旧入口迁移说明，不再承载完整生成规则。
