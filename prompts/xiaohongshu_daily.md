# 已弃用：小红书日更单体 Prompt

这个文件不再承载“选题 + 检索 + 核验 + 写作 + 审核”的完整流程。

请按以下顺序调用：

1. `editorial_selection.md`
2. `research_verification.md`
3. `value_modules.md`
4. `xiaohongshu_writer.md`
5. `editorial_review.md`

共享结构见 `types/editorial.ts`。保留此文件只是为了让旧文档或调用方得到明确迁移提示；新实现不得把多个阶段重新合并到这里。
