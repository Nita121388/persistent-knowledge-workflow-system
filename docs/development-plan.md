# 持续知识工作流系统开发计划

> 版本：v0.3
> 状态：开发计划草案
> 阶段：MVP 实施规划 + Phase 2 预留
> 更新日期：2026-07-01

## 1. 开发目标

第一阶段只验证一个核心闭环：

```text
Obsidian Web Clipper 生成收藏笔记并直接落地 Vault
  -> PKWS 发现新笔记
  -> PKWS 写入或读取最小 pkws_id
  -> 创建 Knowledge Anchor 与 Case
  -> AI 生成 Proposal
  -> 用户选择 Mark Done / Drop / Comment / Generate Patch
  -> 只有需要修改 Vault 时才生成 Patch Preview
  -> 用户 Approve & Apply
  -> Vault Safety Layer 安全写入 Vault
  -> Case Done
```

MVP 不追求完整平台能力，也不默认让 AI 生成整理后的 Markdown。

MVP 的核心成功标准：

- 用户能把网页收藏变成待处理 Case。
- Clipper 原始笔记直接成为 Vault 中的受管对象。
- PKWS 默认只写入最小 `pkws_id`，不污染笔记内容。
- AI 能给出可理解的整理 Proposal。
- 用户可以不修改 Vault，直接 Mark Done 或 Drop。
- 用户需要移动、补充、生成正式笔记时，系统才生成 Patch。
- 用户能在写入前看到会影响哪些文件。
- 系统只在用户批准具体 Patch 后写入 Vault。
- Apply 前有基础备份。
- 用户能回滚系统造成的一次 Apply。

## 2. MVP 范围约束

### 2.1 MVP 必须限制

```text
单用户
单 Vault
单 Inbox
单 AI Provider
单默认模型
本地运行
无 Electron
无 Obsidian Companion Plugin
无 Browser Companion Plugin
无自动 Apply
无自动长期记忆学习
无向量数据库
无内建 Agent Runtime（依赖本地 CLI）
无 Agent Runtime 常驻进程（Worker 做完 Job 可退出）
```

> Phase 2 引入 Agent Runtime 时（参见 [agent/agent-runtime.md](agent/agent-runtime.md)），需放开"单 AI Provider"约束以支持外部 CLI 作为独立 Agent 后端，同时放开"Worker 做完 Job 退出"约束为常驻 Agent Runtime 进程。

### 2.2 MVP 内容流约束

MVP 采用 Vault-first 内容流：

```text
Clipper Markdown in Vault
  -> pkws_id
  -> Case
  -> Proposal
  -> optional Patch
```

设计约束：

- 不把 Clipper 笔记复制到强制处理空间。
- 不默认生成整理后 Markdown。
- 不默认把 Proposal、Patch、Timeline 写入 Vault。
- Staging 只用于生成内容 Patch 时的预览草稿，不是每个 Case 的必经目录。
- Workspace 保存 Case、事件、Proposal、Patch、Job、规则和安全记录。

### 2.3 MVP Patch 白名单

第一版只允许：

```text
create_file
update_file
move_file
```

第一版禁止：

```text
delete_file
bulk_update
cross_vault_move
complex_merge
workspace_wide_refactor
```

### 2.4 MVP 记忆范围

第一版只做：

```text
Case Instruction Summary
Workspace Rules
```

不做：

```text
Learned Memory
Project Memory
black-box user profile
vector memory
```

## 3. 推荐技术栈

```text
Frontend:
  Vite
  React
  TypeScript
  TailwindCSS
  Radix UI / shadcn/ui
  React Router
  TanStack Query

Backend:
  Node.js
  TypeScript
  Fastify
  Zod

AI:
  ai / Vercel AI SDK
  @ai-sdk/openai
  OpenAI-compatible endpoint

Storage:
  SQLite
  better-sqlite3
  Drizzle ORM

Worker:
  SQLite jobs table
  p-queue

Files:
  chokidar
  fs-extra
  write-file-atomic
  proper-lockfile
  node:crypto

Markdown:
  gray-matter
  yaml
  unified
  remark-parse
  remark-gfm

Diff:
  jsdiff
  react-diff-view
```

## 4. 里程碑计划

## Milestone 0：文档收口与脚手架准备

目标：把实现边界固定，避免开发跑偏。

任务：

1. 确认 MVP 范围约束。
2. 确认技术栈。
3. 确认目录结构。
4. 确认数据模型初稿。
5. 确认 API 初稿。
6. 确认 Proposal / Patch 边界。
7. 确认 Vault Safety Layer 安全承诺。

输出：

- `docs/development-plan.md`
- `docs/data-model.md`
- `docs/api-design.md`
- `docs/proposal-patch-boundary.md`
- `docs/vault-safety.md`

完成标准：

- 可以开始创建项目脚手架。

## Milestone 1：项目脚手架

目标：搭建最小可运行本地 Web App。

任务：

1. 初始化 Vite + React + TypeScript。
2. 配置 TailwindCSS。
3. 搭建 Fastify 本地后端。
4. 建立前后端开发启动脚本。
5. 建立基础目录结构。
6. 建立 SQLite / Drizzle 基础配置。
7. 建立健康检查 API。

建议目录：

```text
apps/
  web/
  server/
packages/
  shared/
  core/
  storage/
  ai/
  vault/
```

MVP 可简化为：

```text
src/
  web/
  server/
  shared/
```

完成标准：

- 本地可以启动 Web Console。
- Web Console 可以调用 Backend health check。
- SQLite 可以创建基础表。

## Milestone 2：Setup Wizard 与 Settings

目标：让用户完成最小可用配置。

任务：

1. Vault Path 配置。
2. Inbox Path 配置。
3. Workspace Path 配置。
4. AI Provider / Base URL / API Key / Default Model 配置。
5. Test Model 按钮。
6. Workspace Rules 基础设置页面。
7. 配置校验和错误提示。

完成标准：

- 用户能完成初始化。
- 系统能验证 Vault / Inbox 是否可读写。
- 系统能验证 AI 模型可调用。

## Milestone 3：Inbox 扫描与 Case 创建

目标：从 Obsidian Web Clipper 输出的 Markdown 创建 Case。

任务：

1. 使用 chokidar 监听 Inbox。
2. 支持手动 Scan Inbox。
3. 读取 Markdown 和 Frontmatter。
4. 读取或写入 `pkws_id`。
5. 创建 Knowledge Anchor。
6. 创建 Artifact。
7. 创建 Case。
8. 记录基础 Timeline Event。
9. Dashboard 展示 Case 列表。

最小状态：

```text
Captured
Analyzing
ReviewRequired
PatchPreview
Applying
Done
Dropped
Error
RolledBack
```

完成标准：

- 用户用 Clipper 收藏一篇网页后，PKWS Dashboard 能看到一个新 Case。
- 这篇笔记只有最小 `pkws_id` 被写入 Vault。

## Milestone 4：AI Proposal 生成

目标：让 AI 针对 Case 生成整理提案。

任务：

1. 定义 Proposal Schema。
2. 定义 AI Prompt。
3. 读取 Artifact 内容。
4. 读取 Case Instruction Summary。
5. 读取 Workspace Rules。
6. 调用 AI SDK。
7. 使用 Zod 校验输出。
8. 保存 Proposal。
9. Case 进入 ReviewRequired。

Proposal 至少包含：

```text
title
summary
value_judgement
suggested_actions
suggested_target_path
reasoning_summary
risks
requires_patch
```

完成标准：

- Case Detail 能展示 AI Proposal。
- 用户可以基于 Proposal 选择 Mark Done、Drop、Comment 或 Generate Patch。
- AI 失败时 Case 进入 Error，并显示失败原因。

## Milestone 5：按需 Patch Manifest 与 Preview

目标：只有当用户选择具体改动动作时，系统才生成可预览 Patch。

触发场景：

```text
Move
Add / Update Frontmatter
Append Summary
Generate Formal Note
Create Index Link
```

任务：

1. 定义 Patch Intent。
2. 定义 Patch Manifest Schema。
3. 支持 create_file / update_file / move_file。
4. 对生成正式笔记场景，可在 Workspace Staging 中保存预览草稿。
5. 展示文件影响清单。
6. 展示最终 Markdown 或 frontmatter 预览。
7. 使用 jsdiff / react-diff-view 展示差异。
8. 禁止未审批 Patch Apply。

完成标准：

- 用户只有在请求修改 Vault 时才看到 Patch Preview。
- 用户能清楚知道会新增、修改或移动哪些文件。
- 原始 Clipper 笔记不会因为 Proposal 阶段被重写。

## Milestone 6：Approve & Apply

目标：审批后安全写入 Vault。

任务：

1. 实现 Approval Action。
2. Apply 前校验 Patch。
3. Apply 前检查目标文件状态。
4. Apply 前备份受影响文件。
5. 使用原子写入。
6. 更新 Case 状态。
7. 记录 Applied Event。
8. Case 进入 Done 或回到 ReviewRequired。

冲突策略：

```text
如果目标文件在 Patch 生成后被用户改动：
  -> 阻止 Apply
  -> Case 进入 Error / Blocked
  -> 用户选择重新生成 Patch / 另存为新文件 / 放弃
```

完成标准：

- 用户点击 Approve & Apply 后，Patch 安全写入 Vault。
- 原始受影响文件已备份。
- Dashboard 显示 Case Done 或明确后续待处理状态。

## Milestone 7：基础 Rollback

目标：支持撤销系统上一次 Apply。

任务：

1. 保存 Apply Manifest。
2. 保存受影响文件备份。
3. Rollback 前检测目标文件是否被用户修改。
4. 支持撤销新增文件。
5. 支持恢复被 update 的文件。
6. 支持恢复 move 的文件。
7. 记录 RolledBack Event。

完成标准：

- 用户能回滚系统造成的一次 Apply。
- 如果目标文件已被用户改动，系统不强行覆盖。

## Milestone 8：Case Memory 与 Workspace Rules

目标：让 AI 记住当前 Case 指示和用户手动偏好。

任务：

1. Case Detail 展示 Case Instruction Summary。
2. 用户可以编辑 Case Instruction Summary。
3. 用户可以标记某条指示失效。
4. Settings 支持 Workspace Rules。
5. AI Proposal 读取 Case Instruction Summary。
6. AI Proposal 读取 Workspace Rules。

完成标准：

- 用户补充指示后，下一次 Proposal 会遵守指示。
- Workspace Rules 会影响新的 Case Proposal。

## Milestone 9：真实内容试跑

目标：验证产品假设。

测试样本：

1. 长篇技术文章。
2. 工具清单。
3. 新闻/短文。
4. 教程。
5. 低价值网页。

观察指标：

```text
收藏到 Review 成功率
AI Proposal 可用率
用户 Mark Done / Drop / Generate Patch 比例
Approve & Apply 转化率
Apply 后手动修正率
Rollback 触发率
用户处理一个 Case 的时间
```

完成标准：

- 至少 5 条真实网页收藏完成闭环。
- 记录主要失败原因和下一轮优化点。

---

## 10. Phase 2：Agent Runtime 路线图

参考设计：[agent/agent-runtime.md](agent/agent-runtime.md)

### 短期优化：Worker 常驻 + 内存上下文（0.5 天）

在现有 Worker 基础上增加内存缓存，不改架构。

任务：

1. Worker 启动后不退出，进入 wait loop。
2. 内存中维护 `Map<caseId, Message[]>`。
3. 同一 Case 的连续调用共享消息历史。
4. 简单的 LRU eviction（超过 N 个 Case 时淘汰最久未活跃的）。

完成标准：

- 用户评论后，AI 知道之前说过什么。
- 连续 3 次评论同一个 Case，上下文累积，不丢失。

### M10.1：Agent Runtime Phase 1（3-5 天）

任务：

1. 创建 `packages/agent-runtime/` 包。
2. `CaseSession` 类型 + 内存管理（Map + eviction）。
3. `context-builder`：从 messages 构建 CLAUDE.md。
4. `cli-runner`：spawn CLI（Codex / Claude Code）+ 读取输出。
5. `scheduler`：优先级队列 + decideAction（continue / new_turn / compress）。
6. Settings 增加 Agent Runtime 配置项（主开关 + CLI 路径 + 资源限制）。
7. 集成到 Server：startAgentRuntime + onUserInput。

完成标准：

- Agent Runtime 进程常驻，多个 Case 的内存上下文共存。
- 用户评论 → 内存中追加 → CLI 子进程执行 → 输出更新 Case。
- 用户可通过配置开关 Agent Runtime。

### M10.2：Agent Runtime Phase 2（3-5 天）

任务：

1. 上下文压缩：消息 > 阈值时折叠旧消息。
2. 暂停/恢复：`awaitingUserInput` + waitQueue。
3. SQLite 持久化：eviction 时序列化，恢复时反序列化。
4. 多 Case 调度：并发活跃 Case 的优先级管理。
5. 输出解析：proposal.json / patch-operations.json 的 Zod 校验。
6. Settings 增加上下文管理配置项。

完成标准：

- 超过 20 轮交互后自动压缩上下文。
- Agent 等用户时不空转 LLM。
- 进程崩溃重启后，活跃 Case 从 SQLite 恢复。| 版本 | 日期 | 说明 |
|------|------|------|
| v0.2 | 2026-06-27 | MVP 初始版本 |
| v0.3 | 2026-07-01 | 增加 Phase 2 Agent Runtime 路线图 |

## 5. 初始数据模型清单

第一版需要这些对象：

```text
Settings
Case
TimelineEvent
KnowledgeAnchor
Artifact
CaseInstructionSummary
WorkspaceRule
Proposal
PatchIntent
PatchManifest
ApplyManifest
Job
```

详细设计见 `docs/data-model.md`。

## 6. 初始 API 清单

第一版 API 分为：

```text
Health
Settings
Inbox
Cases
Proposals
Patch Intents
Patch Preview
Approval / Apply
Rollback
Workspace Rules
Jobs
```

详细设计见 `docs/api-design.md`。

## 7. 开发顺序建议

严格按顺序做：

```text
脚手架
-> Settings
-> Inbox Scan
-> Case Dashboard
-> AI Proposal
-> 用户决策动作
-> 按需 Patch Preview
-> Apply
-> Rollback
-> Memory
-> 真实试跑
```

### MVP 后建议

```text
-> Agent Runtime Phase 1（常驻进程 + 内存上下文 + CLI 调用）
   ├─ 短期（0.5 天）：Worker 常驻 + 内存 Map<caseId, messages>
   ├─ Phase 1（3-5 天）：CaseSession + context-builder + cli-runner + scheduler
   └─ Phase 2（3-5 天）：上下文压缩 + SQLite 持久化 + eviction 恢复
```

详见 [agent/agent-runtime.md](agent/agent-runtime.md)。不要提前做：

- Electron。
- Obsidian 插件。
- 浏览器插件。
- 多 Agent。
- 自动长期记忆。
- 向量数据库。
- 复杂工作流平台。
- Agent Runtime（详见 Milestone 10）。

## 8. 第一轮开发风险

### 8.1 范围膨胀

风险：开发中又加入 Electron、插件、多模型、多 Agent。

应对：任何新能力必须先进入文档评审，不直接实现。

### 8.2 Proposal 和 Patch 混淆

风险：AI Proposal 阶段就开始生成文件内容，导致系统又变成 AI Markdown 生成器。

应对：Proposal 默认只回答价值、建议动作和理由；Patch 必须由用户选择具体动作后生成。

### 8.3 Vault 写入风险

风险：AI 生成错误路径或覆盖用户文件。

应对：Patch Preview、Apply 前备份、文件 hash 检查、禁止 delete。

### 8.4 AI 输出不稳定

风险：模型输出不符合 Schema。

应对：Zod 校验、失败进入 Error、允许重新生成。

### 8.5 Frontmatter 污染

风险：写入 `pkws_id` 时破坏用户原有 metadata。

应对：最小写入，只写 `pkws_id`，并尽量保留原字段。

### 8.6 用户上手失败

风险：Vault Path、Inbox Path、AI Key 配置失败。

应对：Setup Wizard、Test Model、Scan Inbox Test。

## 9. 下一步

开发前必须完成：

1. `docs/data-model.md`
2. `docs/api-design.md`
3. `docs/proposal-patch-boundary.md`
4. `docs/vault-safety.md`

然后进入脚手架开发。
