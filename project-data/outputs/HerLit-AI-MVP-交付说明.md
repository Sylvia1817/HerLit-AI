# HerLit AI 第一阶段交付

项目目录：`C:\Users\Sylvia\Documents\Codex\2026-07-30\ai-herlit-ai-ai-ai-saas`

## 已完成

- 女性文学内容工作台单页界面
- 日期、主题与四种表达风格输入
- 今日晨报、作家专题、60 秒脚本切换
- 模拟生成反馈、结果更新时间与复制全文
- 桌面和手机响应式布局
- FastAPI 健康接口骨架
- `content/`、`prompts/`、`output/` 项目目录
- 五阶段开发路线

## 运行

```powershell
cd C:\Users\Sylvia\Documents\Codex\2026-07-30\ai-herlit-ai-ai-ai-saas
npm.cmd run dev
```

构建检查：

```powershell
npm.cmd run build
```

## 存储策略

轻量源码保留在当前 Codex 工作区。后续模型缓存、媒体素材和每日生成结果优先迁移到：

`E:\AI项目\HerLitAI`

当前受管运行环境没有获得该目录的写权限，因此本次没有声称迁移已经完成。

## 当前产品方向

HerLit AI 已收缩为“小红书女性文学图文编辑部”。短视频脚本、分镜、字幕和视频合成功能暂停。

第二阶段将实现 FastAPI 生成接口、模型适配器、小红书正文、标题标签、3:4 图片卡片、资料核验步骤和本地历史记录。自动流程只生成草稿，经过人工审核后才进入发布清单。
